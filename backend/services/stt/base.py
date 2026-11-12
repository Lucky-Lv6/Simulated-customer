"""STT Provider 抽象基类"""

from abc import ABC, abstractmethod


class STTProvider(ABC):
    @abstractmethod
    async def transcribe(self, audio_bytes: bytes) -> str:
        """语音识别：PCM/WAV 音频 → 文本"""
        ...

    @abstractmethod
    async def get_model_name(self) -> str:
        ...
