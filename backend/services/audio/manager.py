"""音频归档服务 - 保存对话记录与转写文本"""

import json
from datetime import datetime
from pathlib import Path

from config.settings import settings


class AudioManager:
    """按会话归档 AI 模拟记录（JSON 结构化数据 + TXT 转写稿）。"""

    def __init__(self) -> None:
        self.recordings_dir = settings.RECORDINGS_DIR
        self.recordings_dir.mkdir(parents=True, exist_ok=True)

    def _session_dir(self, session_id: str) -> Path:
        """按日期/会话分层存放，避免单目录文件过多。"""
        session_dir = (
            self.recordings_dir / datetime.now().strftime("%Y-%m-%d") / session_id
        )
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir

    def save_conversation_log(self, session_id: str, turns: list[dict]) -> str:
        """保存对话日志 JSON。"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = self._session_dir(session_id) / f"AI_SIMULATION_{timestamp}.json"
        data = {
            "session_id": session_id,
            "timestamp": timestamp,
            "ai_simulation": True,
            "turns": turns,
        }
        filepath.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return str(filepath)

    def save_transcript(self, session_id: str, transcript: str) -> str:
        """保存对话文本稿。"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = self._session_dir(session_id) / f"AI_SIMULATION_{timestamp}.txt"
        filepath.write_text("=== AI 模拟交流 ===\n\n" + transcript, encoding="utf-8")
        return str(filepath)
