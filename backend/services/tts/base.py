"""TTS Provider 抽象基类"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator


@dataclass
class Voice:
    id: str
    name: str
    description: str
    tags: list[str] | None = None


class TTSProvider(ABC):
    @abstractmethod
    async def get_voices(self) -> list[Voice]:
        ...

    def recommend_voice(self, gender: str, age: int = 0) -> str:
        """根据性别和年龄推荐声音，子类可覆盖。"""
        return ""

    async def preview(self, text: str, voice_id: str) -> bytes:
        """试听：默认与正式合成走同一条链路。"""
        return await self.synthesize(text, voice_id)

    @abstractmethod
    async def synthesize(self, text: str, voice_id: str, **kwargs) -> bytes:
        ...

    @abstractmethod
    async def stream_synthesize(self, text: str, voice_id: str, **kwargs) -> AsyncIterator[bytes]:
        ...