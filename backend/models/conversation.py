"""对话数据模型"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class CustomerState(str, Enum):
    INTRODUCTION = "INTRODUCTION"
    REQUIREMENT_DISCOVERY = "REQUIREMENT_DISCOVERY"
    PAIN_POINT = "PAIN_POINT"
    SOLUTION_DISCUSSION = "SOLUTION_DISCUSSION"
    TECHNICAL_DISCUSSION = "TECHNICAL_DISCUSSION"
    OBJECTION = "OBJECTION"
    CLARIFICATION = "CLARIFICATION"
    INTEREST = "INTEREST"
    DECISION = "DECISION"
    NEXT_STEP = "NEXT_STEP"
    ENDING = "ENDING"


class CustomerEmotion(str, Enum):
    NEUTRAL = "neutral"
    CURIOUS = "curious"
    INTERESTED = "interested"
    CONFUSED = "confused"
    SKEPTICAL = "skeptical"
    CONCERNED = "concerned"
    SATISFIED = "satisfied"
    IMPATIENT = "impatient"
    EXCITED = "excited"


class CustomerStatus(str, Enum):
    LISTENING = "LISTENING"
    THINKING = "THINKING"
    SPEAKING = "SPEAKING"
    IDLE = "IDLE"


class DifficultyLevel(int, Enum):
    EASY = 1
    NORMAL = 2
    HARD = 3
    EXPERT = 4
    DEVIL = 5


@dataclass
class EmotionRecord:
    """情绪记录"""
    emotion: str  # CustomerEmotion value
    trigger: str  # 触发原因
    intensity: float = 0.5  # 0.0 ~ 1.0
    timestamp: float = 0.0


@dataclass
class ConversationTurn:
    role: str  # "user" | "customer"
    content: str
    timestamp: float = 0.0
    latency_ms: float = 0.0
    emotion: str = ""  # 该轮次客户情绪


@dataclass
class ConversationMemory:
    customer_id: str
    scenario_id: str
    difficulty: int = 3
    state: CustomerState = CustomerState.INTRODUCTION
    emotion: CustomerEmotion = CustomerEmotion.NEUTRAL
    turns: list[ConversationTurn] = field(default_factory=list)
    emotion_history: list[EmotionRecord] = field(default_factory=list)
    disclosed_info: list[str] = field(default_factory=list)
    concerns_raised: list[str] = field(default_factory=list)
    questions_asked: list[str] = field(default_factory=list)
    fde_answers: list[str] = field(default_factory=list)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    uploaded_text: str = ""
    uploaded_file_name: str = ""

    # ========== 序列化 ==========

    def to_dict(self) -> dict:
        """序列化为字典"""
        return {
            "customer_id": self.customer_id,
            "scenario_id": self.scenario_id,
            "difficulty": self.difficulty,
            "state": self.state.value if self.state else "INTRODUCTION",
            "emotion": self.emotion.value if self.emotion else "neutral",
            "turns": [
                {
                    "role": t.role,
                    "content": t.content,
                    "timestamp": t.timestamp,
                    "latency_ms": t.latency_ms,
                    "emotion": t.emotion,
                }
                for t in self.turns
            ],
            "emotion_history": [
                {
                    "emotion": e.emotion,
                    "trigger": e.trigger,
                    "intensity": e.intensity,
                    "timestamp": e.timestamp,
                }
                for e in self.emotion_history
            ],
            "disclosed_info": self.disclosed_info,
            "concerns_raised": self.concerns_raised,
            "questions_asked": self.questions_asked,
            "fde_answers": self.fde_answers,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "uploaded_text": self.uploaded_text,
            "uploaded_file_name": self.uploaded_file_name,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ConversationMemory":
        """从字典反序列化"""
        memory = cls(
            customer_id=data.get("customer_id", ""),
            scenario_id=data.get("scenario_id", ""),
            difficulty=data.get("difficulty", 3),
            state=CustomerState(data.get("state", "INTRODUCTION")),
            emotion=CustomerEmotion(data.get("emotion", "neutral")),
            turns=[
                ConversationTurn(
                    role=t["role"],
                    content=t["content"],
                    timestamp=t.get("timestamp", 0.0),
                    latency_ms=t.get("latency_ms", 0.0),
                    emotion=t.get("emotion", ""),
                )
                for t in data.get("turns", [])
            ],
            emotion_history=[
                EmotionRecord(
                    emotion=e["emotion"],
                    trigger=e.get("trigger", ""),
                    intensity=e.get("intensity", 0.5),
                    timestamp=e.get("timestamp", 0.0),
                )
                for e in data.get("emotion_history", [])
            ],
            disclosed_info=data.get("disclosed_info", []),
            concerns_raised=data.get("concerns_raised", []),
            questions_asked=data.get("questions_asked", []),
            fde_answers=data.get("fde_answers", []),
            start_time=datetime.fromisoformat(data["start_time"]) if data.get("start_time") else None,
            end_time=datetime.fromisoformat(data["end_time"]) if data.get("end_time") else None,
            uploaded_text=data.get("uploaded_text", ""),
            uploaded_file_name=data.get("uploaded_file_name", ""),
        )
        return memory


@dataclass
class LatencyRecord:
    vad_ms: float = 0.0
    stt_ms: float = 0.0
    llm_first_token_ms: float = 0.0
    tts_first_audio_ms: float = 0.0
    total_ttfa_ms: float = 0.0
    timestamp: float = 0.0
    above_sla: bool = False