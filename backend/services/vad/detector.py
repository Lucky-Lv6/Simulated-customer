"""VAD (Voice Activity Detection) 服务"""

import time
from collections import deque
from config.settings import settings


class VADDetector:
    """
    简单的 VAD 检测器。
    基于音频能量阈值进行语音活动检测。
    实际生产环境建议使用 webrtcvad 或 silero-vad。
    """

    def __init__(self):
        self.silence_duration_ms = settings.VAD_SILENCE_DURATION_MS
        self.min_speech_duration_ms = settings.VAD_MIN_SPEECH_DURATION_MS
        self.max_speech_duration_ms = settings.VAD_MAX_SPEECH_DURATION_MS
        self._energy_threshold = 500
        self._is_speaking = False
        self._speech_start_time = 0.0
        self._silence_start_time = 0.0
        self._recent_energy = deque(maxlen=10)

    def _calculate_energy(self, audio_chunk: bytes) -> float:
        """计算音频块的 RMS 能量"""
        if len(audio_chunk) < 2:
            return 0.0
        samples = [int.from_bytes(audio_chunk[i:i+2], 'little', signed=True)
                   for i in range(0, len(audio_chunk) - 1, 2)]
        if not samples:
            return 0.0
        energy = sum(s * s for s in samples) / len(samples)
        return energy ** 0.5

    def _adaptive_threshold(self, energy: float) -> None:
        """自适应调整能量阈值"""
        self._recent_energy.append(energy)
        if len(self._recent_energy) >= 5:
            noise_floor = sum(sorted(self._recent_energy)[:3]) / 3
            self._energy_threshold = max(noise_floor * 2.5, 300)

    def process_audio(self, audio_chunk: bytes) -> str:
        """
        处理音频块，返回状态。
        返回值: "speech_start" / "speaking" / "speech_end" / "silence" / "timeout"
        """
        energy = self._calculate_energy(audio_chunk)
        self._adaptive_threshold(energy)

        now = time.time()
        is_voice = energy > self._energy_threshold

        if is_voice and not self._is_speaking:
            self._is_speaking = True
            self._speech_start_time = now
            return "speech_start"

        if is_voice and self._is_speaking:
            self._silence_start_time = 0.0
            duration = (now - self._speech_start_time) * 1000
            if duration > self.max_speech_duration_ms:
                self._is_speaking = False
                return "speech_end"
            return "speaking"

        if not is_voice and self._is_speaking:
            if self._silence_start_time == 0.0:
                self._silence_start_time = now
            silence_duration = (now - self._silence_start_time) * 1000

            if silence_duration > self.silence_duration_ms:
                self._is_speaking = False
                return "speech_end"
            return "speaking"

        return "silence"

    @property
    def is_speaking(self) -> bool:
        return self._is_speaking

    def reset(self) -> None:
        self._is_speaking = False
        self._speech_start_time = 0.0
        self._silence_start_time = 0.0