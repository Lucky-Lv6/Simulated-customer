"""LLM Provider 抽象基类"""

from abc import ABC, abstractmethod
from typing import AsyncIterator


class LLMProvider(ABC):
    @abstractmethod
    async def chat(self, messages: list[dict], max_tokens: int = 1024) -> str:
        """非流式对话"""
        ...

    @abstractmethod
    async def stream_chat(self, messages: list[dict], max_tokens: int = 512) -> AsyncIterator[str]:
        """流式对话"""
        ...

    @abstractmethod
    async def get_model_name(self) -> str:
        ...