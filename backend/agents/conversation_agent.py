"""对话管理 Agent - 管理整个对话生命周期（VAD → STT → LLM → TTS → 播放）"""

import csv
import json
import logging
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator

from agents.customer_agent import CustomerAgent
from config.settings import settings
from models.conversation import ConversationTurn, CustomerStatus, LatencyRecord
from models.customer import CustomerProfile
from models.scenario import Scenario
from services.stt.base import STTProvider
from services.stt.provider import create_stt_provider
from services.tts.base import TTSProvider
from services.tts.precache import get_precached_audio
from services.tts.provider import create_tts_provider
from services.vad.detector import VADDetector

logger = logging.getLogger(__name__)

# SLA 阈值（毫秒）
SLA_TTFA_THRESHOLD_MS = 2000

# 句子边界：命中后立即送去合成，边生成边播放
SENTENCE_BOUNDARIES = ("。", "？", "！", "\n", "，")

LATENCY_LOG_DIR = settings.DATA_DIR / "latency_logs"
LATENCY_CSV_HEADER = [
    "timestamp", "vad_ms", "stt_ms", "llm_first_token_ms",
    "tts_first_audio_ms", "total_ttfa_ms", "above_sla",
]


def compute_latency_stats(records: list[LatencyRecord]) -> dict:
    """统计一组延迟记录的分位数与 SLA 合规率（供会话汇总与接口共用）。"""
    ttfa_values = sorted(r.total_ttfa_ms for r in records if r.total_ttfa_ms > 0)
    n = len(ttfa_values)
    if not n:
        return {
            "total_records": 0,
            "above_sla_count": 0,
            "avg_ttfa_ms": 0,
            "min_ttfa_ms": 0,
            "max_ttfa_ms": 0,
            "p50_ttfa_ms": 0,
            "p90_ttfa_ms": 0,
            "p95_ttfa_ms": 0,
            "p99_ttfa_ms": 0,
            "sla_compliance_pct": 0,
        }

    def pct(p: float) -> float:
        return round(ttfa_values[min(n - 1, int(n * p))], 1)

    above_sla_count = sum(1 for r in records if r.above_sla)
    return {
        "total_records": len(records),
        "above_sla_count": above_sla_count,
        "avg_ttfa_ms": round(sum(ttfa_values) / n, 1),
        "min_ttfa_ms": round(ttfa_values[0], 1),
        "max_ttfa_ms": round(ttfa_values[-1], 1),
        "p50_ttfa_ms": round(ttfa_values[n // 2], 1),
        "p90_ttfa_ms": pct(0.9),
        "p95_ttfa_ms": pct(0.95),
        "p99_ttfa_ms": pct(0.99),
        "sla_compliance_pct": round((len(records) - above_sla_count) / len(records) * 100, 1),
    }


class ConversationAgent:
    """对话管理 Agent：一次模拟会话的完整生命周期。"""

    def __init__(self, customer: CustomerProfile, scenario: Scenario, difficulty: int = 3):
        self.session_id = str(uuid.uuid4())[:8]
        self.customer_agent = CustomerAgent(customer, scenario, difficulty)
        self.stt: STTProvider = create_stt_provider()
        self.tts: TTSProvider = create_tts_provider()
        self.vad = VADDetector()

        self.status: CustomerStatus = CustomerStatus.IDLE
        self.latency_records: list[LatencyRecord] = []
        self.is_running = False
        self.is_interrupted = False
        self.start_time: datetime | None = None
        self.last_activity_time: float = time.time()
        self.current_voice_id = "alloy"

    # ========== 对外流程 ==========

    async def process_text_input(
        self,
        user_text: str,
        script_index: int | None = None,
    ) -> AsyncIterator[dict]:
        """处理文本输入（跳过 VAD / STT，直接走资料台词或 LLM）。"""
        self.last_activity_time = time.time()
        self.status = CustomerStatus.THINKING
        yield {"type": "status", "status": "thinking"}
        yield {"type": "transcript", "role": "user", "text": user_text, "is_partial": False}

        t_start = time.time()
        timing = self._new_timing(t_start)

        script_reply = (
            self.customer_agent.take_script_line_at(script_index)
            if script_index is not None
            else self.customer_agent.match_script_line(user_text)
        )

        if script_reply is not None:
            # 严格资料模式：本地命中，0ms LLM，内容一字不落
            self._append_turn("user", user_text)
            self._append_turn("customer", script_reply)
            logger.info(f"[资料模式] 按资料返回客户台词: {script_reply[:30]!r}")
            yield {
                "type": "transcript", "role": "customer",
                "text": script_reply, "is_partial": False,
            }
            async for event in self._speak_full_text(script_reply, timing, prefer_precache=True):
                yield event
        elif self.customer_agent.is_script_mode:
            # 资料台词已播完：保持沉默，绝不交给 LLM 自由创作
            logger.info("[资料模式] 客户台词已播放完毕，本轮不再回复")
            self._end_turn()
            yield {"type": "status", "status": "listening"}
            return
        else:
            async for event in self._stream_llm_reply(user_text, timing):
                yield event

        async for event in self._finish_turn(t_start, timing):
            yield event

    async def process_user_input(self, audio_data: bytes) -> AsyncIterator[dict]:
        """处理音频输入（完整链路：VAD → STT → LLM → TTS）。"""
        self.last_activity_time = time.time()

        t_vad = time.time()
        vad_result = self.vad.process_audio(audio_data)
        vad_ms = (time.time() - t_vad) * 1000
        if vad_result != "speech_end":
            if vad_result == "speech_start":
                yield {"type": "status", "status": "listening"}
            return

        self.status = CustomerStatus.THINKING
        yield {"type": "status", "status": "thinking"}

        t_start = time.time()
        timing = self._new_timing(t_start)

        t_stt = time.time()
        user_text = await self.stt.transcribe(audio_data)
        stt_ms = (time.time() - t_stt) * 1000

        if not user_text.strip():
            self._end_turn()
            yield {"type": "status", "status": "listening"}
            return

        yield {"type": "transcript", "role": "user", "text": user_text, "is_partial": False}

        async for event in self._stream_llm_reply(user_text, timing):
            yield event

        async for event in self._finish_turn(t_start, timing, vad_ms=vad_ms, stt_ms=stt_ms):
            yield event

    def handle_barge_in(self) -> None:
        """用户打断：立即停止输出并回到监听态。"""
        logger.info(f"Barge-in 触发 (session: {self.session_id})")
        self.is_interrupted = True
        self.vad.reset()
        self.status = CustomerStatus.LISTENING

    # ========== 内部：一轮对话 ==========

    @staticmethod
    def _new_timing(t_start: float) -> dict:
        return {
            "t_start": t_start,
            "llm_start": time.time(),
            "llm_first_token_ms": 0.0,
            "llm_total_ms": 0.0,
            "tts_first_audio_ms": 0.0,
            "tts_total_ms": 0.0,
        }

    def _append_turn(self, role: str, content: str) -> None:
        self.customer_agent.memory.turns.append(
            ConversationTurn(role=role, content=content, timestamp=time.time())
        )

    def _end_turn(self) -> None:
        self.is_interrupted = False
        self.status = CustomerStatus.LISTENING

    async def _stream_llm_reply(self, user_text: str, timing: dict) -> AsyncIterator[dict]:
        """LLM 流式生成，并按句边界边生成边合成。"""
        reply_text = ""
        sentence = ""

        async for chunk in self.customer_agent.generate_response(user_text):
            if timing["llm_first_token_ms"] == 0:
                timing["llm_first_token_ms"] = (time.time() - timing["llm_start"]) * 1000

            reply_text += chunk
            sentence += chunk
            yield {
                "type": "transcript", "role": "customer",
                "text": reply_text, "is_partial": True,
            }

            if any(p in chunk for p in SENTENCE_BOUNDARIES):
                text = sentence.strip()
                sentence = ""
                if text and not self.is_interrupted:
                    async for event in self._stream_tts(text, timing):
                        yield event
                    if not self.is_interrupted:
                        yield {"type": "status", "status": "thinking"}

        timing["llm_total_ms"] = (time.time() - timing["llm_start"]) * 1000
        yield {
            "type": "transcript", "role": "customer",
            "text": reply_text, "is_partial": False,
        }

        remainder = sentence.strip()
        if remainder and not self.is_interrupted:
            async for event in self._stream_tts(remainder, timing):
                yield event

    async def _speak_full_text(
        self, text: str, timing: dict, prefer_precache: bool = False
    ) -> AsyncIterator[dict]:
        """整段文本合成播放；剧本模式优先读取预合成音频实现秒播。"""
        if not text.strip() or self.is_interrupted:
            return

        cached = None
        if prefer_precache and self.customer_agent.last_script_index >= 0:
            uploaded = self.customer_agent.memory.uploaded_text
            if uploaded:
                cached = get_precached_audio(
                    uploaded, self.current_voice_id, self.customer_agent.last_script_index
                )

        if cached:
            self.status = CustomerStatus.SPEAKING
            yield {"type": "status", "status": "speaking"}
            timing["tts_first_audio_ms"] = (time.time() - timing["t_start"]) * 1000
            timing["tts_total_ms"] = 0.0
            logger.info(
                f"[对话] 预合成命中秒播: index={self.customer_agent.last_script_index}, "
                f"audio_size={len(cached)}"
            )
            yield {"type": "audio", "data": cached}
            return

        async for event in self._stream_tts(text, timing):
            yield event

    async def _stream_tts(self, text: str, timing: dict) -> AsyncIterator[dict]:
        """合成一段文本并流式下发音频。"""
        self.status = CustomerStatus.SPEAKING
        yield {"type": "status", "status": "speaking"}

        t_tts = time.time()
        async for chunk in self.tts.stream_synthesize(text, self.current_voice_id):
            if self.is_interrupted:
                break
            if timing["tts_first_audio_ms"] == 0:
                timing["tts_first_audio_ms"] = (time.time() - t_tts) * 1000
            yield {"type": "audio", "data": chunk}
        timing["tts_total_ms"] += (time.time() - t_tts) * 1000

    async def _finish_turn(
        self,
        t_start: float,
        timing: dict,
        vad_ms: float = 0.0,
        stt_ms: float = 0.0,
    ) -> AsyncIterator[dict]:
        """记录延迟指标并回到监听态。"""
        total_ms = (time.time() - t_start) * 1000
        record = LatencyRecord(
            timestamp=time.time(),
            vad_ms=vad_ms,
            stt_ms=stt_ms,
            llm_first_token_ms=round(timing["llm_first_token_ms"], 1),
            tts_first_audio_ms=round(timing["tts_first_audio_ms"], 1),
            total_ttfa_ms=round(total_ms, 1),
            above_sla=total_ms > SLA_TTFA_THRESHOLD_MS,
        )
        self.latency_records.append(record)
        try:
            self._log_latency_csv(record)
        except Exception as e:
            logger.warning(f"延迟日志写入失败: {e}")

        logger.info(
            f"[对话] TTFA: VAD={vad_ms:.0f}ms, STT={stt_ms:.0f}ms, "
            f"首LLM={timing['llm_first_token_ms']:.0f}ms, LLM总={timing['llm_total_ms']:.0f}ms, "
            f"首TTS={timing['tts_first_audio_ms']:.0f}ms, TTS总={timing['tts_total_ms']:.0f}ms, "
            f"总链路={total_ms:.0f}ms"
        )

        yield {
            "type": "latency",
            "data": {
                "vad_ms": round(vad_ms, 1),
                "stt_ms": round(stt_ms, 1),
                "llm_first_token_ms": round(timing["llm_first_token_ms"], 1),
                "tts_first_audio_ms": round(timing["tts_first_audio_ms"], 1),
                "total_ttfa_ms": round(total_ms, 1),
                "above_sla": record.above_sla,
            },
        }

        self._end_turn()
        yield {"type": "status", "status": "listening"}

    # ========== 延迟日志 ==========

    def _ensure_log_dir(self) -> Path:
        LATENCY_LOG_DIR.mkdir(parents=True, exist_ok=True)
        return LATENCY_LOG_DIR

    def _log_latency_csv(self, record: LatencyRecord) -> None:
        """将单轮延迟追加写入 CSV。"""
        log_file = self._ensure_log_dir() / f"latency_{self.session_id}.csv"
        file_exists = log_file.exists()
        with open(log_file, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(LATENCY_CSV_HEADER)
            writer.writerow([
                record.timestamp,
                round(record.vad_ms, 1),
                round(record.stt_ms, 1),
                round(record.llm_first_token_ms, 1),
                round(record.tts_first_audio_ms, 1),
                round(record.total_ttfa_ms, 1),
                int(record.above_sla),
            ])

    def _log_latency_summary(self) -> None:
        """将会话延迟汇总写入 JSON。"""
        if not self.latency_records:
            return
        stats = compute_latency_stats(self.latency_records)
        if not stats["total_records"]:
            return

        summary = {
            "session_id": self.session_id,
            "customer_id": self.customer_agent.customer.id,
            "customer_name": self.customer_agent.customer.name,
            "scenario_id": self.customer_agent.scenario.id,
            "scenario_name": self.customer_agent.scenario.name,
            "difficulty": self.customer_agent.memory.difficulty,
            "timestamp": datetime.now().isoformat(),
            "total_turns": len(self.latency_records),
            **{k: v for k, v in stats.items() if k != "total_records"},
        }
        summary_file = self._ensure_log_dir() / f"summary_{self.session_id}.json"
        summary_file.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # ========== 状态查询 ==========

    @property
    def is_speaking_tts(self) -> bool:
        return self.status == CustomerStatus.SPEAKING

    @property
    def is_idle_timeout(self) -> bool:
        if not self.is_running:
            return False
        return (time.time() - self.last_activity_time) > settings.CONVERSATION_TIMEOUT_S

    def stop(self) -> dict:
        """结束对话并落盘延迟汇总与对话记忆。"""
        self.is_running = False
        duration = (
            (datetime.now() - self.start_time).total_seconds() if self.start_time else 0
        )
        stats = compute_latency_stats(self.latency_records)
        result = {
            "session_id": self.session_id,
            "duration_seconds": round(duration, 1),
            "total_turns": len(self.customer_agent.memory.turns) // 2,
            "total_latency_records": stats["total_records"],
            "above_sla_count": stats["above_sla_count"],
            "avg_ttfa_ms": stats["avg_ttfa_ms"],
            "min_ttfa_ms": stats["min_ttfa_ms"],
            "max_ttfa_ms": stats["max_ttfa_ms"],
            "p50_ttfa_ms": stats["p50_ttfa_ms"],
            "p90_ttfa_ms": stats["p90_ttfa_ms"],
            "p95_ttfa_ms": stats["p95_ttfa_ms"],
            "p99_ttfa_ms": stats["p99_ttfa_ms"],
            "sla_compliance_pct": stats["sla_compliance_pct"],
        }

        logger.info(
            f"对话结束 (session: {self.session_id}, duration: {duration:.1f}s, "
            f"turns: {result['total_turns']})"
        )

        for step, fn in (("延迟汇总", self._log_latency_summary),
                         ("对话记忆", lambda: self.customer_agent.save_memory(self.session_id))):
            try:
                fn()
            except Exception as e:
                logger.warning(f"{step}保存失败: {e}")

        return result
