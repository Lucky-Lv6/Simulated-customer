"""FDE 评分数据模型"""

from dataclasses import dataclass, field


@dataclass
class EvaluationDimension:
    name: str
    score: int  # /10
    comment: str = ""


@dataclass
class EvaluationReport:
    total_score: int  # /100
    dimensions: list[EvaluationDimension] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    weaknesses: list[str] = field(default_factory=list)
    summary: str = ""
