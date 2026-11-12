"""FDE Analyzer - 对话结束后对 FDE 表现进行评分"""

import logging
import re

from config.settings import settings
from models.conversation import ConversationMemory
from models.evaluation import EvaluationDimension, EvaluationReport
from services.llm.base import LLMProvider
from services.llm.provider import create_llm_provider

logger = logging.getLogger(__name__)

DEFAULT_INSTRUCTIONS = "你是一个专业的 FDE 能力分析专家，需要对 FDE 的客户交流表现进行全面评估。"

# 输出格式约束：解析逻辑依赖这段结构，改格式要同步改 _parse_evaluation
OUTPUT_FORMAT = """输出格式（严格按此结构，不要输出其他内容）：

总分：XX/100

需求挖掘：X/10 - 评语
客户痛点识别：X/10 - 评语
飞书产品理解：X/10 - 评语
豆包企业版理解：X/10 - 评语
方案设计：X/10 - 评语
技术表达：X/10 - 评语
业务表达：X/10 - 评语
异议处理：X/10 - 评语
沟通逻辑：X/10 - 评语
客户引导：X/10 - 评语

优势：
1. ...
2. ...

不足：
1. ...
2. ...

总结：..."""

# 维度行：`需求挖掘：8/10 - 评语`
_DIMENSION_RE = re.compile(r"^([^:：]{2,20})\s*[:：]\s*(\d{1,2})\s*/\s*10\s*[-—:：]?\s*(.*)$")
_TOTAL_RE = re.compile(r"总分\s*[:：]\s*(\d{1,3})")
_ITEM_RE = re.compile(r"^(?:[-*]|\d+[.、)])\s*(.+)$")


def _load_instructions() -> str:
    path = settings.PROMPTS_DIR / "fde_evaluation.txt"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return DEFAULT_INSTRUCTIONS


class FDEAnalyzer:
    """在对话结束后，基于对话记录对 FDE 的表现做多维度评分。"""

    def __init__(self) -> None:
        self.llm: LLMProvider = create_llm_provider()
        self._instructions = _load_instructions()

    async def analyze(self, memory: ConversationMemory) -> EvaluationReport:
        """分析对话并生成评分报告。"""
        if not memory.turns:
            return EvaluationReport(total_score=0, summary="本次对话没有产生任何交流内容。")

        prompt = self._build_prompt(memory)
        try:
            raw = await self.llm.chat([{"role": "user", "content": prompt}], max_tokens=1200)
        except Exception as e:
            logger.warning(f"[评分] LLM 调用失败: {e}")
            return EvaluationReport(total_score=0, summary=f"评分服务暂不可用：{e}")

        return self._parse_evaluation(raw)

    def _build_prompt(self, memory: ConversationMemory) -> str:
        transcript = "\n".join(
            f"{'客户' if t.role == 'customer' else 'FDE'}：{t.content}"
            for t in memory.turns
        )
        return (
            f"{self._instructions}\n\n"
            f"交流场景：{memory.scenario_id}\n"
            f"客户角色：{memory.customer_id}\n"
            f"难度级别：Lv{memory.difficulty}\n\n"
            f"对话记录：\n{transcript}\n\n"
            f"{OUTPUT_FORMAT}"
        )

    def _parse_evaluation(self, text: str) -> EvaluationReport:
        """解析 LLM 返回的评分文本。"""
        report = EvaluationReport(total_score=0)
        section = ""

        for raw_line in text.split("\n"):
            line = raw_line.strip()
            if not line:
                continue

            total = _TOTAL_RE.search(line)
            if total:
                report.total_score = int(total.group(1))
                continue

            dimension = _DIMENSION_RE.match(line)
            if dimension:
                report.dimensions.append(
                    EvaluationDimension(
                        name=dimension.group(1).strip(),
                        score=int(dimension.group(2)),
                        comment=dimension.group(3).strip(),
                    )
                )
                continue

            if line.startswith(("优势", "优点")):
                section = "strengths"
                continue
            if line.startswith(("不足", "待提升", "改进")):
                section = "weaknesses"
                continue
            if line.startswith("总结"):
                section = "summary"
                report.summary = line.split("：", 1)[-1].split(":", 1)[-1].strip()
                continue

            item = _ITEM_RE.match(line)
            if item and section == "strengths":
                report.strengths.append(item.group(1).strip())
            elif item and section == "weaknesses":
                report.weaknesses.append(item.group(1).strip())

        # 模型没给总分时，用维度平均分兜底（维度满分 10，总分满分 100）
        if not report.total_score and report.dimensions:
            avg = sum(d.score for d in report.dimensions) / len(report.dimensions)
            report.total_score = round(avg * 10)

        return report
