"""客户台词预合成缓存。

上传文档后，后台对文档中解析出的全部「客户」台词调用 TTS 预合成；
命中脚本规则时直接播放缓存音频，实现近似 0ms 的合成延迟。
仅在识别为严格剧本模式（上传的是通话记录）时生效。
"""

import asyncio
import hashlib
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def cache_key(text: str, voice_id: str) -> str:
    """缓存键 = 文本哈希 + 音色（同一资料换音色需重新合成）。"""
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]
    return f"{digest}|{voice_id}"


class PreSynthCache:
    """预合成缓存。key=(文本hash|音色)，value={脚本组索引: WAV bytes}。

    只在事件循环内访问，无需加锁。
    """

    def __init__(self) -> None:
        self._cache: dict[str, dict[int, bytes]] = {}
        self._tasks: set[str] = set()  # 正在预合成的 key，防止重复启任务

    def get(self, text: str, voice_id: str, index: int) -> Optional[bytes]:
        """获取预合成音频；该组未合成完成则返回 None（调用方回退实时 TTS）。"""
        return self._cache.get(cache_key(text, voice_id), {}).get(index)

    def start_task(self, key: str) -> bool:
        """标记开始；若已在进行则返回 False（不重复启动）。"""
        if key in self._tasks:
            return False
        self._tasks.add(key)
        return True

    def store(self, key: str, index: int, audio: bytes) -> None:
        self._cache.setdefault(key, {})[index] = audio

    def mark_done(self, key: str) -> None:
        """标记该 key 已完成（即使没有任何客户台词也建空表，便于查询）。"""
        self._cache.setdefault(key, {})
        self._tasks.discard(key)


# 模块级单例 + 后台任务引用（防止任务被 GC）
_precache = PreSynthCache()
_background_tasks: set[asyncio.Task] = set()


def ensure_precache_task(text: str, voice_id: str) -> None:
    """确保对给定文本发起后台预合成任务（去重）。不阻塞调用方。"""
    if not text or not text.strip():
        return

    key = cache_key(text, voice_id)
    if not _precache.start_task(key):
        return

    task = asyncio.create_task(precache_script(text, voice_id))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def precache_script(text: str, voice_id: str) -> None:
    """解析脚本并预合成全部非空客户台词，串行合成以控制后端压力。"""
    from agents.customer_agent import parse_script_pairs
    from services.tts.provider import create_tts_provider

    key = cache_key(text, voice_id)
    logger.info(f"[预合成] 开始: text_len={len(text)}, voice={voice_id}")
    try:
        pairs = parse_script_pairs(text)
        targets = [(i, c.strip()) for i, (_, c) in enumerate(pairs) if c.strip()]
        logger.info(f"[预合成] 共 {len(pairs)} 组台词对，待合成 {len(targets)} 条")
        if not targets:
            return

        tts = create_tts_provider()
        for index, content in targets:
            try:
                audio = await tts.synthesize(content, voice_id)
                if not audio:
                    logger.warning(f"[预合成] 组{index} 返回空音频: {content[:20]!r}")
                    continue
                _precache.store(key, index, audio)
                logger.info(
                    f"[预合成] 组{index} 完成: {content[:20]!r}, "
                    f"audio_size={len(audio)}, 进度={index + 1}/{len(targets)}"
                )
            except Exception as e:
                logger.warning(f"[预合成] 组{index} 失败: {content[:20]!r}, err={e}")
    finally:
        _precache.mark_done(key)
        logger.info(f"[预合成] 结束: key={key[:24]}...")


def get_precached_audio(text: str, voice_id: str, index: int) -> Optional[bytes]:
    """开放查询接口，供 conversation_agent 使用。"""
    return _precache.get(text, voice_id, index)
