"""应用配置管理"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv


def _is_frozen() -> bool:
    """是否运行在 PyInstaller 打包后的 exe 中。"""
    return bool(getattr(sys, "frozen", False))


def _app_dir() -> Path:
    """可写目录：开发时是 backend/，打包后是 exe 所在目录。"""
    if _is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def _resource_dir() -> Path:
    """只读资源目录：打包后是 PyInstaller 解包目录，开发时是 backend/。"""
    if _is_frozen():
        return Path(getattr(sys, "_MEIPASS", _app_dir()))
    return Path(__file__).resolve().parent.parent


APP_DIR = _app_dir()
RESOURCE_DIR = _resource_dir()

# .env 统一放在可写目录：开发时 backend/.env，打包后与 exe 同目录
_env_file = APP_DIR / ".env"
if _env_file.exists():
    load_dotenv(_env_file)
else:
    load_dotenv()


class Settings:
    # 运行目录（打包后 = exe 所在目录；开发时 = backend/）
    APP_DIR: Path = APP_DIR
    RESOURCE_DIR: Path = RESOURCE_DIR

    # LLM 配置
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gpt-4o-mini")

    # STT 配置
    STT_API_KEY: str = os.getenv("STT_API_KEY", "")
    STT_BASE_URL: str = os.getenv("STT_BASE_URL", "")
    STT_MODEL: str = os.getenv("STT_MODEL", "whisper-1")

    # TTS 配置
    TTS_API_KEY: str = os.getenv("TTS_API_KEY", "")
    TTS_BASE_URL: str = os.getenv("TTS_BASE_URL", "")
    TTS_MODEL: str = os.getenv("TTS_MODEL", "tts-1")
    TTS_APPID: str = os.getenv("TTS_APPID", "")  # 旧版控制台 AppID（与 Access Token 配对使用）

    # VAD 配置
    VAD_SILENCE_DURATION_MS: int = int(os.getenv("VAD_SILENCE_DURATION_MS", "400"))
    VAD_MIN_SPEECH_DURATION_MS: int = int(os.getenv("VAD_MIN_SPEECH_DURATION_MS", "200"))
    VAD_MAX_SPEECH_DURATION_MS: int = int(os.getenv("VAD_MAX_SPEECH_DURATION_MS", "30000"))

    # 服务器配置
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8765"))

    # 音频配置
    SAMPLE_RATE: int = 16000
    CHANNELS: int = 1

    # 可写数据路径（打包后位于 exe 同目录，保证可写）
    DATA_DIR: Path = APP_DIR / "data"
    CONVERSATIONS_DIR: Path = DATA_DIR / "conversations"
    AUDIO_DIR: Path = APP_DIR / "audio"
    RECORDINGS_DIR: Path = AUDIO_DIR / "recordings"
    LOGS_DIR: Path = APP_DIR / "logs"

    # 只读资源路径（prompts / knowledge 随 exe 打包）
    PROMPTS_DIR: Path = RESOURCE_DIR / "prompts"
    KNOWLEDGE_DIR: Path = RESOURCE_DIR / "knowledge"

    # 前端静态资源目录：打包后在 _MEIPASS/frontend_dist，开发时在 frontend/dist
    FRONTEND_DIST_DIR: Path = (
        RESOURCE_DIR / "frontend_dist"
        if _is_frozen()
        else RESOURCE_DIR.parent / "frontend" / "dist"
    )

    # 超时配置（秒）
    LLM_TIMEOUT_S: int = int(os.getenv("LLM_TIMEOUT_S", "30"))
    STT_TIMEOUT_S: int = int(os.getenv("STT_TIMEOUT_S", "20"))
    TTS_TIMEOUT_S: int = int(os.getenv("TTS_TIMEOUT_S", "10"))
    CONVERSATION_TIMEOUT_S: int = int(os.getenv("CONVERSATION_TIMEOUT_S", "300"))


settings = Settings()
