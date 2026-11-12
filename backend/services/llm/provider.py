"""LLM Provider - OpenAI 兼容接口（OpenAI / DeepSeek 通用）"""

import logging
import time
from typing import AsyncIterator

from openai import AsyncOpenAI

from config.settings import settings
from services.llm.base import LLMProvider

logger = logging.getLogger(__name__)

# 不同厂商的默认地址与模型（未在 .env 中显式配置时使用）
PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    "deepseek": {
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-v4-flash",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
}


def detect_provider() -> str:
    """根据 base_url 判断厂商，仅用于挑选默认值。"""
    base_url = (settings.LLM_BASE_URL or "").lower()
    return "deepseek" if "deepseek" in base_url else "openai"


class OpenAICompatLLMProvider(LLMProvider):
    """OpenAI 接口兼容实现（OpenAI / DeepSeek 及其他兼容网关共用）。"""

    def __init__(self) -> None:
        defaults = PROVIDER_DEFAULTS[detect_provider()]
        self.client = AsyncOpenAI(
            api_key=settings.LLM_API_KEY,
            base_url=settings.LLM_BASE_URL or defaults["base_url"],
            timeout=settings.LLM_TIMEOUT_S,
            max_retries=1,
        )
        self.model = settings.LLM_MODEL or defaults["model"]

    async def chat(self, messages: list[dict], max_tokens: int = 1024) -> str:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.7,
            max_tokens=max_tokens,
            timeout=settings.LLM_TIMEOUT_S,
        )
        return response.choices[0].message.content or ""

    async def stream_chat(
        self, messages: list[dict], max_tokens: int = 512
    ) -> AsyncIterator[str]:
        logger.info(f"[LLM] stream_chat 开始: model={self.model}, max_tokens={max_tokens}")
        t0 = time.time()
        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.7,
            max_tokens=max_tokens,
            stream=True,
            stream_options={"include_usage": True},
            timeout=settings.LLM_TIMEOUT_S,
        )

        chunk_count = 0
        async for chunk in stream:
            chunk_count += 1
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

            usage = getattr(chunk, "usage", None)
            if usage:
                logger.info(
                    f"[LLM] stream 结束: chunks={chunk_count}, "
                    f"耗时={(time.time() - t0) * 1000:.0f}ms"
                )
                # prompt_cache_* 是 DeepSeek 私有字段，OpenAI 原生接口没有，用 getattr 兜底
                cache_hit = getattr(usage, "prompt_cache_hit_tokens", 0)
                cache_miss = getattr(usage, "prompt_cache_miss_tokens", 0)
                if cache_hit:
                    logger.info(f"[LLM] cache HIT: {cache_hit} tokens")
                if cache_miss:
                    logger.info(f"[LLM] cache MISS: {cache_miss} tokens")

        if chunk_count == 0:
            logger.warning("[LLM] stream 没有收到任何 chunk")

    async def get_model_name(self) -> str:
        return self.model


def create_llm_provider() -> LLMProvider:
    """创建 LLM Provider（所有厂商共用 OpenAI 兼容实现）。"""
    return OpenAICompatLLMProvider()
