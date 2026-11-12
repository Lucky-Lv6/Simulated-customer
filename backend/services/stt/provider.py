"""STT Provider 实现 - 支持 OpenAI Whisper 和 Mock 模式"""

import logging
from openai import AsyncOpenAI
from services.stt.base import STTProvider
from config.settings import settings

logger = logging.getLogger(__name__)


class MockSTTProvider(STTProvider):
    """Mock STT - 当无可用 STT API 时使用"""

    async def transcribe(self, audio_bytes: bytes) -> str:
        logger.info("Mock STT: 模拟语音识别返回占位文本")
        return "你好，我想了解一下你们的产品。"

    async def get_model_name(self) -> str:
        return "mock-stt"


class OpenAIWhisperProvider(STTProvider):
    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.STT_API_KEY or settings.LLM_API_KEY,
            base_url=settings.STT_BASE_URL or settings.LLM_BASE_URL,
            timeout=settings.STT_TIMEOUT_S,
            max_retries=1,
        )
        self.model = settings.STT_MODEL

    async def transcribe(self, audio_bytes: bytes) -> str:
        transcript = await self.client.audio.transcriptions.create(
            model=self.model,
            file=("audio.wav", audio_bytes, "audio/wav"),
            language="zh",
            timeout=settings.STT_TIMEOUT_S,
        )
        return transcript.text

    async def get_model_name(self) -> str:
        return self.model


def create_stt_provider() -> STTProvider:
    stt_base_url = (settings.STT_BASE_URL or settings.LLM_BASE_URL or "").lower()
    stt_api_key = settings.STT_API_KEY or settings.LLM_API_KEY or ""

    # DeepSeek 不支持音频转文字，使用 Mock STT
    if "deepseek" in stt_base_url:
        logger.warning("DeepSeek 不支持音频转文字，使用 Mock STT（仅返回占位文本）")
        return MockSTTProvider()

    return OpenAIWhisperProvider()