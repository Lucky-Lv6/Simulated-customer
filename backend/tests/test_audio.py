"""VAD 检测器测试"""

import pytest
from services.vad.detector import VADDetector


def test_vad_initialization():
    vad = VADDetector()
    assert not vad.is_speaking
    assert vad.silence_duration_ms == 400


def test_vad_silence():
    vad = VADDetector()
    # 静音数据
    silence = b'\x00\x00' * 1600
    result = vad.process_audio(silence)
    assert result == "silence"


def test_vad_speech():
    vad = VADDetector()
    # 模拟语音数据（高能量）
    speech = b'\xff\x7f' * 1600
    result = vad.process_audio(speech)
    assert result in ("speech_start", "speaking")


def test_vad_reset():
    vad = VADDetector()
    vad._is_speaking = True
    vad.reset()
    assert not vad.is_speaking