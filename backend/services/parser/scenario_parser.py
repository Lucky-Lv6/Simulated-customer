"""文本解析器 - 将上传的客户材料解析为结构化的 Scenario"""

import re
from models.scenario import Scenario


class ScenarioParser:
    """解析上传的客户材料文本，提取结构化信息"""

    SECTIONS = {
        "公司背景": "company_background",
        "行业": "industry",
        "公司规模": "company_size",
        "目前使用": "current_tools",
        "主要问题": "pain_points",
        "痛点": "pain_points",
        "希望": "goals",
        "目标": "goals",
        "客户关注": "concerns",
        "关注点": "concerns",
        "需求": "requirements",
        "技术要求": "technical_requirements",
        "业务需求": "business_requirements",
        "决策流程": "decision_process",
        "预算": "budget",
        "时间规划": "timeline",
        "时间": "timeline",
    }

    def parse(self, text: str, filename: str = "") -> Scenario:
        """解析文本内容，返回 Scenario 对象"""
        lines = text.strip().split("\n")
        current_section = ""
        known_facts: list[str] = []

        scenario = Scenario(
            id="uploaded",
            name=f"上传文本场景: {filename}",
            description="基于上传客户材料生成的交流场景",
            customer_goal="根据上传的客户材料进行交流",
        )

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # 检查是否是章节标题
            matched_section = None
            matched_section_key = ""
            for section_name, field_name in self.SECTIONS.items():
                if section_name in line:
                    matched_section = field_name
                    matched_section_key = section_name
                    current_section = matched_section
                    break

            if matched_section:
                value = (
                    line.replace(matched_section_key, "", 1)
                    .strip()
                    .strip("：:")
                    .strip()
                )
                if value:
                    self._append_value(scenario, current_section, value)
                    known_facts.append(f"{matched_section_key}: {value}")
                continue

            # 非标题行 - 归属当前章节或独立事实
            if current_section:
                self._append_value(scenario, current_section, line)
                known_facts.append(line)
            else:
                # 首段无标题文字通常为公司背景；但不要把文档标题/需求说明当背景
                title_markers = [
                    "说明", "需求", "材料", "通话记录", "标题", "文件",
                    "记录", "关注", "痛点", "目标",
                ]
                if (
                    not scenario.company_background
                    and not any(marker in line for marker in title_markers)
                    and len(line) <= 50
                ):
                    scenario.company_background = line
                known_facts.append(line)

        # 提取列表项 (以 1. 2. 3. 或 - 开头)
        for line in lines:
            line = line.strip()
            if re.match(r"^[\d]+[.、）)]", line) or line.startswith("- ") or line.startswith("* "):
                clean = re.sub(r"^[\d]+[.、）)]\s*", "", line)
                clean = clean.lstrip("- *").strip()
                if clean and len(clean) > 2:
                    if not current_section:
                        known_facts.append(clean)
                    # 智能分类
                    self._classify_fact(scenario, clean)

        scenario.known_facts = list(set(known_facts))
        return scenario

    def _append_value(self, scenario: Scenario, field: str, value: str) -> None:
        """向 scenario 的指定字段追加值"""
        if not value:
            return
        if field in ("current_tools", "pain_points", "goals", "concerns", "requirements",
                     "technical_requirements", "business_requirements", "known_facts"):
            existing = getattr(scenario, field, [])
            if value not in existing:
                existing.append(value)
                setattr(scenario, field, existing)
        elif field in ("company_background", "industry", "company_size", "decision_process", "budget", "timeline"):
            setattr(scenario, field, value)

    def _classify_fact(self, scenario: Scenario, fact: str) -> None:
        """尝试将事实归类到合适的字段"""
        fact_lower = fact.lower()

        if any(kw in fact_lower for kw in ["数据安全", "权限", "安全"]):
            if fact not in scenario.concerns:
                scenario.concerns.append(fact)
        elif any(kw in fact_lower for kw in ["成本", "价格", "预算", "费用"]):
            if fact not in scenario.concerns:
                scenario.concerns.append(fact)
        elif any(kw in fact_lower for kw in ["痛点", "问题", "困难", "麻烦", "效率低"]):
            if fact not in scenario.pain_points:
                scenario.pain_points.append(fact)
        elif any(kw in fact_lower for kw in ["希望", "想", "需要", "需求", "目标", "想要"]):
            if fact not in scenario.requirements:
                scenario.requirements.append(fact)
