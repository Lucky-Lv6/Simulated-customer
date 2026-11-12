"""Customer Agent - AI 客户模拟核心"""

import json
import logging
import os
import re
import time
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import AsyncIterator, Optional

from config.settings import settings
from models.conversation import (
    ConversationMemory,
    ConversationTurn,
    CustomerEmotion,
    CustomerState,
    EmotionRecord,
)
from models.customer import CustomerProfile
from models.scenario import Scenario
from services.llm.base import LLMProvider
from services.llm.provider import create_llm_provider
from services.rag.retriever import get_retriever

logger = logging.getLogger(__name__)


ROLE_ALIASES = {
    "客户": "customer",
    "我": "fde",
    "FDE": "fde",
    "fde": "fde",
    "飞书": "fde",
    "飞书工程师": "fde",
}

ROLE_PATTERN = r"(客户|飞书工程师|FDE|fde|飞书|我)"

# 说话人说明区里用来判断“真正的台词行开始了”的时间戳
_TIMESTAMP_RE = re.compile(r"\d{1,2}:\d{2}")


def _parse_role_header(line: str) -> tuple[str, str | None] | None:
    """解析一行是否为说话人标记，返回 (role, 行内台词或 None)。

    支持的通话/资料格式：
    - 客户：我们公司目前……
    - 我：你好，我是飞书……
    - 客户 00:00:41
    - 客户（单独一行）
    """
    # 行内格式：客户：xxx / 我：xxx
    m = re.match(rf"^{ROLE_PATTERN}\s*[:：]\s*(.*)$", line)
    if m:
        role = ROLE_ALIASES.get(m.group(1))
        content = m.group(2).strip()
        # 兼容“客户：00:00:41 内容”这种带时间戳的行内写法
        content = re.sub(r"^\d{1,2}:\d{2}(?::\d{2})?\s*", "", content).strip()
        return role, content

    # 独立标记行：客户 / 客户 00:00:41
    m = re.match(
        rf"^{ROLE_PATTERN}(?:\s+\d{{1,2}}:\d{{2}}(?::\d{{2}})?)?\s*$",
        line,
    )
    if m:
        return ROLE_ALIASES.get(m.group(1)), None

    return None


def parse_script_pairs(text: str) -> list[tuple[str, str]]:
    """解析客户资料，提取 (FDE台词, 客户台词) 配对。"""
    segments: list[tuple[str, str]] = []  # (role, content)
    current_role = None
    current_lines: list[str] = []
    in_speaker_notes = False

    def flush():
        if current_role and current_lines:
            content = "".join(current_lines).strip()
            if content:
                segments.append((current_role, content))

    for raw_line in text.split("\n"):
        line = raw_line.strip()

        # 跳过“说话人说明”元信息区，直到分隔线或真正的角色台词行
        if line.startswith("说话人说明"):
            in_speaker_notes = True
            continue
        if in_speaker_notes:
            header = _parse_role_header(line)
            if line.startswith("===") or (header and _TIMESTAMP_RE.search(line)):
                in_speaker_notes = False
            else:
                continue

        # 检测说话人标记行。只接受严格角色行，避免把客户材料里的
        # “客户关注：…”这类普通文本误当成客户台词。
        header = _parse_role_header(line)

        if header:
            role, inline_content = header
            flush()
            current_role = role
            current_lines = [inline_content] if inline_content else []
            continue

        # 跳过元信息行
        if not line or line.startswith("===") or line.startswith("说话人") \
           or line.startswith("通话记录") or line.startswith("时间") \
           or line.startswith("时长") \
           or re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", line):
            continue

        if current_role:
            current_lines.append(line)

    flush()

    # 配对：每个 FDE 段配其后最近的客户段
    pairs: list[tuple[str, str]] = []
    pending_fde: Optional[str] = None
    for role, content in segments:
        if role == "fde":
            pending_fde = content if pending_fde is None else pending_fde + content
        elif pending_fde is not None:
            pairs.append((pending_fde, content))
            pending_fde = None
        else:
            pairs.append(("", content))

    return pairs


def is_call_script_text(text: str) -> bool:
    """判断上传文本是否包含可逐句播放的客户台词。

    只要资料中明确写出客户台词（如“客户：……”），就进入严格资料模式，
    客户每轮按资料顺序逐字回复；“客户需求说明/客户关注”等普通材料
    不会被误判为台词。
    """
    if not text or not text.strip():
        return False
    return any(c.strip() for _, c in parse_script_pairs(text))


class CustomerAgent:
    """
    AI Customer Agent 核心类。
    模拟企业客户与 FDE 进行实时交流。
    """

    # 情绪关键词映射
    EMOTION_KEYWORDS = {
        CustomerEmotion.CURIOUS: ["是什么", "怎么做", "能介绍一下", "有什么功能", "怎么样", "能实现"],
        CustomerEmotion.INTERESTED: ["不错", "好的", "可以", "感兴趣", "有用", "有价值", "有帮助"],
        CustomerEmotion.CONFUSED: ["不理解", "不明白", "什么意思", "没明白", "能再说一遍"],
        CustomerEmotion.SKEPTICAL: ["真的吗", "确定吗", "能保证吗", "靠谱吗", "可信吗", "可能吗"],
        CustomerEmotion.CONCERNED: ["担心", "怕", "安全", "成本", "费用", "价格", "时间", "风险"],
        CustomerEmotion.SATISFIED: ["满意", "好", "很好", "不错", "明白了", "清楚了", "谢谢"],
        CustomerEmotion.IMPATIENT: ["简单点", "直接说", "别废话", "快点", "太复杂", "简洁"],
        CustomerEmotion.EXCITED: ["太好了", "厉害", "很棒", "有意思", "很感兴趣", "非常期待"],
    }

    def __init__(self, customer: CustomerProfile, scenario: Scenario, difficulty: int = 3):
        self.customer = customer
        self.scenario = scenario
        self.llm: LLMProvider = create_llm_provider()
        self.memory = ConversationMemory(
            customer_id=customer.id,
            scenario_id=scenario.id,
            difficulty=difficulty,
        )
        self._load_prompts()

        # 严格脚本模式：解析后的台词对 [(fde台词, 客户台词), ...] 与当前进度游标
        self.script_pairs: list[tuple[str, str]] = []
        self.script_cursor: int = 0
        # 最近一次规则匹配命中的组索引（预合成时用其从缓存取音频），未命中为 -1
        self.last_script_index: int = -1

    @property
    def is_script_mode(self) -> bool:
        """是否为严格通话记录剧本模式（上传材料被识别为逐句剧本）。"""
        return bool(
            self.script_pairs
            and any(c.strip() for _, c in self.script_pairs)
        )

    def _load_prompts(self) -> None:
        """加载系统提示词模板（其余角色设定已在下方代码内动态拼装）。"""
        path = settings.PROMPTS_DIR / "customer_system.txt"
        if path.exists():
            self._system_prompt = path.read_text(encoding="utf-8")
        else:
            self._system_prompt = "你是企业客户，正在参加一次AI模拟客户交流。"

    def _build_system_prompt(self) -> str:
        """构建系统提示词"""
        parts = [self._system_prompt]

        # 客户画像
        profile = self.customer
        parts.append(f"\n## 你的身份\n")
        parts.append(f"姓名：{profile.name}")
        parts.append(f"职位：{profile.position}")
        parts.append(f"企业：{profile.company}")
        parts.append(f"行业：{profile.industry}")
        parts.append(f"性格：{profile.personality}")
        parts.append(f"沟通风格：{profile.communication_style}")
        parts.append(f"业务目标：{profile.business_goal}")
        parts.append(f"技术背景：{profile.technical_level}")

        # 痛点
        if profile.pain_points:
            parts.append(f"\n## 你的痛点\n")
            for p in profile.pain_points:
                parts.append(f"- {p}")

        # 疑虑
        if profile.concerns:
            parts.append(f"\n## 你的疑虑\n")
            for c in profile.concerns:
                parts.append(f"- {c}")

        # 业务场景
        parts.append(f"\n## 当前交流场景\n")
        parts.append(f"场景：{self.scenario.name}")
        parts.append(f"场景描述：{self.scenario.description}")
        if self.scenario.feishu_products:
            parts.append(f"涉及的飞书产品：{', '.join(self.scenario.feishu_products)}")
        if self.scenario.doubao_products:
            parts.append(f"涉及的豆包产品：{', '.join(self.scenario.doubao_products)}")

        # 难度
        parts.append(f"\n## 难度级别：Lv{self.memory.difficulty}\n")
        difficulty_map = {
            1: "容易沟通，问题简单，容易认可",
            2: "普通客户，有基本问题",
            3: "困难客户，有明确质疑，需要深入回答",
            4: "专家客户，技术深入，问题刁钻",
            5: "魔鬼客户，极度挑剔，善于质疑",
        }
        parts.append(difficulty_map.get(self.memory.difficulty, ""))

        # 上传文本场景
        if self.memory.uploaded_text:
            # 严格脚本模式：只有真正解析出角色对话的通话记录才启用
            if self.is_script_mode:
                parts.append(f"\n## 上传的客户资料 - 严格逐字模式\n")
                parts.append("这是客户提供的完整交流资料，你必须严格按照资料逐字回复。")
                parts.append('资料中「客户」部分是你需要说的话，「我」部分是FDE说的话。')
                parts.append(f"\n完整资料（按顺序，共 {len(self.script_pairs)} 组）:\n")
                for idx, (fde_line, customer_line) in enumerate(self.script_pairs):
                    if customer_line:
                        parts.append(f"[第{idx + 1}组]")
                        if fde_line:
                            parts.append(f"FDE：{fde_line}")
                        else:
                            parts.append("（客户台词，无对应FDE台词）")
                        parts.append(f"客户：{customer_line}")
                parts.append("\n\n## 行为指令（严格模式）\n")
                parts.append("1. 当FDE说一句话后，你只输出资料中对应位置的「客户」台词，一字不落原文照说")
                parts.append("2. 逐句推进，FDE说一句，你回一句客户台词，严格按资料顺序，不得跳句")
                parts.append("3. 回复时只输出客户台词原文，不要添加任何额外文字、前缀或后缀")
                parts.append("4. 如果FDE的话和资料不完全一致，仍按资料顺序继续下一句客户台词")
                parts.append("5. 不要自行创作、改写、总结或补充资料中不存在的客户台词")
            else:
                # 普通客户材料模式（动态交流）
                parts.append(f"\n## 上传的客户材料\n")
                parts.append(f"文件：{self.memory.uploaded_file_name}")
                parts.append(f"内容摘要：\n{self.memory.uploaded_text[:6000]}")

        return "\n".join(parts)

    def _build_context_prompt(self) -> str:
        """构建对话上下文"""
        parts = []

        # 判断是否处于严格脚本模式（真正的通话记录，而不是含“客户”二字的普通材料）
        is_script_mode = self.is_script_mode

        if not is_script_mode:
            # 非脚本模式：包含状态和情绪信息
            # 当前状态和情绪
            parts.append(f"\n当前状态：{self.memory.state.value}")
            parts.append(f"当前情绪：{self.memory.emotion.value}")

            # 情绪变化历史（最近3条）
            recent_emotions = self.memory.emotion_history[-3:] if self.memory.emotion_history else []
            if recent_emotions:
                parts.append("\n## 近期情绪变化\n")
                for e in recent_emotions:
                    parts.append(f"- {e.emotion} ({e.trigger})")

        # 最近对话（限制最近 10 轮减少 token，严格脚本模式也保留）
        recent_turns = self.memory.turns[-10:] if self.memory.turns else []
        if recent_turns:
            parts.append("\n## 最近对话记录\n")
            for turn in recent_turns:
                label = "客户" if turn.role == "customer" else "FDE"
                emotion_tag = f" [{turn.emotion}]" if turn.emotion else ""
                parts.append(f"{label}{emotion_tag}：{turn.content}")

        # 严格脚本模式：直接跳过所有 RAG 和客户状态信息（上传文本本身就是剧本）
        if is_script_mode:
            parts.append("\n（此为严格脚本模式，后续对话将按上传的通话记录剧本逐句回复）")
            return "\n".join(parts)

        # 已披露信息
        if self.memory.disclosed_info:
            parts.append("\n## 你已经披露的信息\n")
            for info in self.memory.disclosed_info[-5:]:
                parts.append(f"- {info}")

        # 已提出的疑虑
        if self.memory.concerns_raised:
            parts.append("\n## 你已提出的疑虑\n")
            for c in self.memory.concerns_raised[-3:]:
                parts.append(f"- {c}")

        # RAG 知识检索：如果 FDE 最近问了产品相关问题，注入相关知识
        if recent_turns and recent_turns[-1].role == "user":
            last_fde_input = recent_turns[-1].content
            # 检测是否涉及产品知识
            product_keywords = ["飞书", "豆包", "功能", "产品", "方案", "AI", "智能", "助手",
                               "文档", "会议", "客服", "知识库", "部署", "价格", "安全"]
            if any(kw in last_fde_input for kw in product_keywords):
                try:
                    retriever = get_retriever()
                    knowledge = retriever.retrieve_for_llm(last_fde_input, top_k=3, max_chars=1200)
                    if knowledge:
                        parts.append(f"\n## 产品知识参考\n{knowledge}")
                        logger.info(f"RAG 知识注入成功: query='{last_fde_input[:50]}', knowledge_len={len(knowledge)}")
                    else:
                        logger.debug(f"RAG 知识检索无结果: query='{last_fde_input[:50]}'")
                except Exception as e:
                    logger.warning(f"RAG 知识检索失败: {e}")

        return "\n".join(parts)

    def _get_state_instruction(self) -> str:
        """根据当前状态返回行为指令"""
        instructions = {
            CustomerState.INTRODUCTION: "先自我介绍，说明来意。不要一次说太多，等对方回应。",
            CustomerState.REQUIREMENT_DISCOVERY: "说明你的业务需求，等待对方了解你的情况。",
            CustomerState.PAIN_POINT: "主动提出你在工作中遇到的具体问题和痛点。",
            CustomerState.SOLUTION_DISCUSSION: "倾听对方的方案介绍，提出你关心的问题。",
            CustomerState.TECHNICAL_DISCUSSION: "讨论技术细节，关注实现方式。",
            CustomerState.OBJECTION: "提出你的疑虑和担心，等待对方解答。",
            CustomerState.CLARIFICATION: "要求对方进一步解释不清楚的地方。",
            CustomerState.INTEREST: "表达对方案的兴趣，但不要过早认可。",
            CustomerState.DECISION: "开始考虑是否推进，但不要轻易做决定。",
            CustomerState.NEXT_STEP: "讨论下一步行动计划。",
            CustomerState.ENDING: "结束交流，总结收获。",
        }
        return instructions.get(self.memory.state, "自然交流，保持客户身份。")

    # ========== 情绪分析 ==========

    def _analyze_emotion(self, user_input: str, response: str) -> tuple[CustomerEmotion, str, float]:
        """
        分析对话内容，确定客户情绪。
        返回 (情绪, 触发原因, 强度)
        """
        combined = user_input + response

        # 检查关键词匹配
        for emotion, keywords in self.EMOTION_KEYWORDS.items():
            for kw in keywords:
                if kw in combined:
                    intensity = 0.6 + 0.1 * self.memory.difficulty / 5
                    return emotion, f"触发关键词: {kw}", min(intensity, 1.0)

        # 基于状态推断情绪
        state_emotion_map = {
            CustomerState.INTRODUCTION: (CustomerEmotion.CURIOUS, "初次交流，好奇了解", 0.4),
            CustomerState.PAIN_POINT: (CustomerEmotion.CONCERNED, "表达痛点，情绪低落", 0.5),
            CustomerState.OBJECTION: (CustomerEmotion.SKEPTICAL, "提出质疑，保持怀疑", 0.6),
            CustomerState.SOLUTION_DISCUSSION: (CustomerEmotion.INTERESTED, "讨论方案，产生兴趣", 0.5),
            CustomerState.TECHNICAL_DISCUSSION: (CustomerEmotion.CURIOUS, "技术细节交流", 0.4),
            CustomerState.INTEREST: (CustomerEmotion.INTERESTED, "产生兴趣", 0.6),
            CustomerState.DECISION: (CustomerEmotion.NEUTRAL, "考虑决策", 0.3),
            CustomerState.ENDING: (CustomerEmotion.SATISFIED, "交流结束", 0.5),
        }

        if self.memory.state in state_emotion_map:
            emotion, trigger, intensity = state_emotion_map[self.memory.state]
            return emotion, trigger, intensity

        return CustomerEmotion.NEUTRAL, "情绪平稳", 0.3

    def _update_emotion(self, user_input: str, response: str) -> None:
        """更新客户情绪"""
        now = time.time()
        new_emotion, trigger, intensity = self._analyze_emotion(user_input, response)

        # 记录情绪历史
        self.memory.emotion_history.append(EmotionRecord(
            emotion=new_emotion.value,
            trigger=trigger,
            intensity=intensity,
            timestamp=now,
        ))

        # 更新当前情绪
        self.memory.emotion = new_emotion

    def _get_emotion_instruction(self) -> str:
        """根据当前情绪生成行为指令，影响回复风格"""
        emotion = self.memory.emotion
        instructions = {
            CustomerEmotion.NEUTRAL: "保持正常交流态度。",
            CustomerEmotion.CURIOUS: "表现出好奇和兴趣，多问问题。",
            CustomerEmotion.INTERESTED: "表现出积极兴趣，但不要过早认可方案。",
            CustomerEmotion.CONFUSED: "表现出困惑，要求对方进一步解释。",
            CustomerEmotion.SKEPTICAL: "保持怀疑态度，要求对方提供证据或案例。",
            CustomerEmotion.CONCERNED: "表达你的担忧，要求对方给出具体解决方案。",
            CustomerEmotion.SATISFIED: "表示满意，但仍保持一定的谨慎。",
            CustomerEmotion.IMPATIENT: "表现出不耐烦，要求对方简洁直接。",
            CustomerEmotion.EXCITED: "表现热情，但不要轻易承诺。",
        }
        return instructions.get(emotion, "保持正常交流态度。")

    # ========== 记忆持久化 ==========

    @property
    def _memory_dir(self) -> Path:
        """记忆存储目录"""
        mem_dir = settings.DATA_DIR / "conversations" / "memories"
        mem_dir.mkdir(parents=True, exist_ok=True)
        return mem_dir

    def save_memory(self, session_id: str = "unsaved") -> str:
        """保存当前记忆到文件"""
        self.memory.end_time = datetime.now()
        data = self.memory.to_dict()
        filepath = self._memory_dir / f"memory_{session_id}.json"
        filepath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(filepath)

    async def generate_response(self, user_input: str) -> AsyncIterator[str]:
        """根据用户输入生成客户回复（流式）"""
        t_enter = time.time()
        # 记录用户输入
        self.memory.turns.append(ConversationTurn(
            role="user", content=user_input, timestamp=time.time()
        ))
        self.memory.fde_answers.append(user_input)

        # 判断是否处于严格脚本模式（用于提前决定一些参数）
        is_script_mode = self.is_script_mode
        # 正常脚本对话已由本地规则匹配处理（0ms LLM）；走到这里说明规则未命中，
        # 用 LLM 兜底。deepseek-v4-flash 是推理模型会先产出 reasoning，需给足 token 预算，
        # 否则 reasoning 耗尽 max_tokens 导致 content 为空。
        llm_max_tokens = 1024 if is_script_mode else 512

        # 构建消息
        t_build_start = time.time()
        system_prompt = self._build_system_prompt()
        context_prompt = self._build_context_prompt()
        state_instruction = self._get_state_instruction()
        emotion_instruction = self._get_emotion_instruction()
        t_build_ms = (time.time() - t_build_start) * 1000

        # 合并系统提示词为单个 system message，减少 token 开销
        closing_instruction = (
            "这是严格脚本模式。你只输出上传通话记录中对应位置的「客户」台词原文，一个字都不要改。"
            if is_script_mode else
            "请用中文回复，保持客户身份，自然交流，不要说教。回复控制在50-100字之间。"
        )
        full_system = (
            f"{system_prompt}\n\n"
            f"## 你的当前对话上下文\n{context_prompt}\n\n"
            f"## 行为指令\n{state_instruction}\n\n"
            f"## 当前情绪\n你的情绪是：{self.memory.emotion.value}。{emotion_instruction}\n\n"
            f"{closing_instruction}"
        )

        if is_script_mode:
            # 统计已完成的轮次，确定当前应该回复哪句客户台词
            customer_turn_count = sum(1 for t in self.memory.turns if t.role == "customer")
            turn_hint = f"这是第 {customer_turn_count + 1} 轮客户回复。"
        else:
            turn_hint = ""

        messages = [
            {"role": "system", "content": full_system},
            {"role": "user", "content": user_input},
        ]

        if turn_hint:
            # 将轮次提示作为单独的 system message 来强调
            messages.insert(1, {"role": "system", "content": turn_hint})

        # 记录请求信息
        t_llm_start = time.time()
        logger.info(
            f"[对话] 准备调用 LLM: script_mode={is_script_mode}, max_tokens={llm_max_tokens}, "
            f"user_input_len={len(user_input)}, system_prompt_len={len(full_system)}, "
            f"prompt_build_ms={t_build_ms:.0f}"
        )

        # 调用 LLM Streaming
        full_response = ""
        first_chunk_received = False
        t_first_token = None

        async for chunk in self.llm.stream_chat(messages, max_tokens=llm_max_tokens):
            if not first_chunk_received:
                first_chunk_received = True
                t_first_token = time.time()
                ttft_ms = (t_first_token - t_llm_start) * 1000
                logger.info(f"[对话] LLM 首 Token 延迟: {ttft_ms:.0f}ms ({'脚本模式' if is_script_mode else '自由模式'})")
            full_response += chunk
            yield chunk

        t_llm_done = time.time()
        llm_total_ms = (t_llm_done - t_llm_start) * 1000
        if not first_chunk_received:
            # 没有收到任何 chunk
            logger.warning("[对话] LLM 未返回任何内容")
        else:
            total_ms = (t_llm_done - t_enter) * 1000
            logger.info(
                f"[对话] LLM 完成: 总耗时={llm_total_ms:.0f}ms, "
                f"首Token={t_first_token and (t_first_token - t_llm_start) * 1000:.0f}ms, "
                f"回复长度={len(full_response)}字, 总链路={total_ms:.0f}ms"
            )

        # 记录客户回复
        turn = ConversationTurn(
            role="customer", content=full_response, timestamp=time.time()
        )
        # 更新情绪并为该轮次记录情绪
        self._update_emotion(user_input, full_response)
        turn.emotion = self.memory.emotion.value
        self.memory.turns.append(turn)

        # 自动状态推进
        self._advance_state(user_input, full_response)

    async def generate_opening(self) -> AsyncIterator[str]:
        """生成开场白"""
        system_prompt = self._build_system_prompt()
        role_info = (
            f"你是{self.customer.name}，{self.customer.position}，来自{self.customer.company}。"
            f"你正在参加关于{self.scenario.name}的交流。"
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "system", "content": role_info},
            {"role": "system", "content": "请用一句话开场，说明你的来意。保持自然，不要长篇大论。"},
            {"role": "user", "content": "你好，请开始我们的交流。"},
        ]

        full_response = ""
        async for chunk in self.llm.stream_chat(messages):
            full_response += chunk
            yield chunk

        self.memory.turns.append(ConversationTurn(
            role="customer", content=full_response, timestamp=time.time()
        ))

    def _advance_state(self, user_input: str, response: str) -> None:
        """根据对话内容推进状态机"""
        current = self.memory.state

        if current == CustomerState.INTRODUCTION and len(self.memory.turns) > 2:
            self.memory.state = CustomerState.REQUIREMENT_DISCOVERY
        elif current == CustomerState.REQUIREMENT_DISCOVERY and len(self.memory.turns) > 4:
            self.memory.state = CustomerState.PAIN_POINT
        elif current == CustomerState.PAIN_POINT and len(self.memory.turns) > 6:
            self.memory.state = CustomerState.SOLUTION_DISCUSSION
        elif current == CustomerState.SOLUTION_DISCUSSION and len(self.memory.turns) > 8:
            self.memory.state = CustomerState.TECHNICAL_DISCUSSION
        elif current == CustomerState.TECHNICAL_DISCUSSION and len(self.memory.turns) > 10:
            self.memory.state = CustomerState.OBJECTION
        elif current == CustomerState.OBJECTION and len(self.memory.turns) > 12:
            self.memory.state = CustomerState.INTEREST
        elif current == CustomerState.INTEREST and len(self.memory.turns) > 14:
            self.memory.state = CustomerState.DECISION
        elif current == CustomerState.DECISION and len(self.memory.turns) > 16:
            self.memory.state = CustomerState.NEXT_STEP
        elif current == CustomerState.NEXT_STEP and len(self.memory.turns) > 18:
            self.memory.state = CustomerState.ENDING

    def set_uploaded_text(self, text: str, filename: str) -> None:
        """设置上传文本"""
        logger.info(f"[文档] set_uploaded_text: filename={filename!r}, text_len={len(text)}")
        self.memory.uploaded_text = text
        self.memory.uploaded_file_name = filename
        # 解析脚本台词对
        self._parse_script_pairs(text)

    def _parse_script_pairs(self, text: str) -> None:
        """解析通话记录，提取 (FDE台词, 客户台词) 配对，用于规则匹配。

        只有被识别为通话记录的文本才启用剧本配对；客户材料一律保留为空，
        走 Customer Agent 动态交流模式。
        """
        pairs = parse_script_pairs(text)
        if not any(c.strip() for _, c in pairs):
            self.script_pairs = []
            self.script_cursor = 0
            logger.info("[脚本] 上传文本不是通话记录，未启用剧本模式")
            return

        self.script_pairs = pairs
        self.script_cursor = 0
        self.last_script_index = -1
        logger.info(f"[脚本] 解析完成: 共 {len(pairs)} 组台词对")
        for i, (f, c) in enumerate(pairs[:5]):
            logger.info(f"[脚本] 对{i}: FDE={f[:30]!r} -> 客户={c[:30]!r}")

    def match_script_line(self, user_input: str) -> Optional[str]:
        """
        严格资料模式：按资料顺序返回下一句客户台词，内容一字不落。

        - 默认严格顺序推进：FDE 说完后，返回资料中的下一条客户台词；
        - 若 FDE 的话与资料中某条 FDE 台词高度相似（>=0.6），则跳到该条对应客户台词；
        - 资料全部播完返回 None，绝不再交给 LLM 自由生成。
        """
        if not self.script_pairs:
            return None

        user_clean = (user_input or "").strip()

        def norm(s: str) -> str:
            return re.sub(r"[，。？！、,.!?\s]", "", s)

        def coverage(a: str, b: str) -> float:
            """Dice/Sorensen 相似度 = 2*匹配字符数 / (lenA+lenB)。

            避免旧实现的 bug：当脚本台词是极短词（如"嗯""对"）时，
            matched/min_len 会因用户长句含该字而刷到 1.0，导致客户台词被错误跳到其他段落。
            """
            na, nb = norm(a), norm(b)
            if not na or not nb:
                return 0.0
            sm = SequenceMatcher(None, na, nb)
            matched = sum(m.size for m in sm.get_matching_blocks())
            return 2.0 * matched / (len(na) + len(nb))

        # 顺序候选：优先使用“有 FDE 台词”的配对；资料只有客户台词时全部按序使用
        cursor = max(0, self.script_cursor)
        remaining = range(cursor, len(self.script_pairs))
        candidate_indices = [
            i for i in remaining
            if self.script_pairs[i][1].strip() and self.script_pairs[i][0].strip()
        ] or [i for i in remaining if self.script_pairs[i][1].strip()]

        if not candidate_indices:
            self.last_script_index = -1
            logger.info("[资料模式] 客户台词已全部播放完毕")
            return None

        # 默认严格按资料顺序推进
        chosen = candidate_indices[0]
        best_score = 0.0

        # 只有在高置信匹配时（>=0.6）才允许跳到对应台词，避免乱跳句
        if user_clean:
            for i in [i for i in candidate_indices[:5] if self.script_pairs[i][0].strip()]:
                s = coverage(user_clean, self.script_pairs[i][0])
                if s > best_score:
                    best_score = s
                    chosen = i
            if best_score < 0.6:
                chosen = candidate_indices[0]

        customer_line = self.script_pairs[chosen][1]
        self.script_cursor = chosen + 1
        self.last_script_index = chosen
        logger.info(
            f"[资料模式] 用户={norm(user_clean)[:24]!r}, 顺序候选={candidate_indices[0]}, "
            f"选择组={chosen}, 匹配分数={best_score:.2f}, "
            f"客户台词={customer_line[:40]!r}, 游标→{self.script_cursor}"
        )
        return customer_line

    def take_script_line_at(self, index: int) -> Optional[str]:
        """按前端字符匹配到的资料序号，返回对应客户台词（一字不落）。

        前端只有在用户当前这段话与资料中某句「我」台词匹配成功后，
        才会把该句的序号传过来；这里据此精确返回对应的客户台词。
        """
        if not self.script_pairs:
            return None

        start = max(0, int(index))
        for i in range(start, len(self.script_pairs)):
            customer_line = self.script_pairs[i][1]
            if customer_line.strip():
                self.script_cursor = i + 1
                self.last_script_index = i
                logger.info(
                    f"[资料模式] 前端匹配序号={index}, 返回组{i}, "
                    f"客户台词={customer_line[:40]!r}, 游标→{self.script_cursor}"
                )
                return customer_line

        self.last_script_index = -1
        logger.info(f"[资料模式] 序号 {index} 之后已无客户台词")
        return None
