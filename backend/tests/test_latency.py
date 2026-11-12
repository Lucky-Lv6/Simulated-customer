"""延迟测试 - 全面的延迟基准测试套件"""

import asyncio
import time
import math
import pytest
from models.customer import PRESET_CUSTOMERS
from models.scenario import PRESET_SCENARIOS
from agents.customer_agent import CustomerAgent
from services.vad.detector import VADDetector


def generate_test_audio(duration_ms: int = 100, frequency: int = 440, sample_rate: int = 16000) -> bytes:
    """生成测试用音频数据（正弦波）"""
    import struct
    num_samples = sample_rate * duration_ms // 1000
    samples = []
    for i in range(num_samples):
        t = i / sample_rate
        value = int(16000 * math.sin(2 * math.pi * frequency * t))
        samples.append(max(-32768, min(32767, value)))
    return struct.pack(f"<{len(samples)}h", *samples)


def generate_silence(duration_ms: int = 100, sample_rate: int = 16000) -> bytes:
    """生成静音数据"""
    num_samples = sample_rate * duration_ms // 1000
    return b"\x00\x00" * num_samples


def compute_percentiles(values: list[float], percentiles: list[int]) -> dict[int, float]:
    """计算百分位值"""
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    result = {}
    for p in percentiles:
        idx = max(0, min(n - 1, int(math.ceil(p / 100 * n) - 1)))
        result[p] = round(sorted_vals[idx], 1)
    return result


def print_report(title: str, values: list[float], sla_threshold: float = 2000.0):
    """打印延迟统计报告"""
    if not values:
        print(f"  (无数据)")
        return

    avg = sum(values) / len(values)
    percentiles = compute_percentiles(values, [50, 90, 95, 99])
    above_sla = sum(1 for v in values if v > sla_threshold)
    sla_compliance = (len(values) - above_sla) / len(values) * 100

    print(f"\n{'='*60}")
    print(f" {title}")
    print(f"{'='*60}")
    print(f"  样本数:        {len(values)}")
    print(f"  平均值:        {avg:.1f}ms")
    print(f"  最小值:        {min(values):.1f}ms")
    print(f"  最大值:        {max(values):.1f}ms")
    print(f"  P50:           {percentiles[50]}ms")
    print(f"  P90:           {percentiles[90]}ms")
    print(f"  P95:           {percentiles[95]}ms")
    print(f"  P99:           {percentiles[99]}ms")
    print(f"  SLA合规 ({sla_threshold}ms): {sla_compliance:.1f}%")
    print(f"  SLA超限:       {above_sla}/{len(values)}")


@pytest.mark.asyncio
async def test_vad_latency():
    """测试 VAD 处理延迟"""
    vad = VADDetector()
    test_audio = generate_test_audio(100)
    silence = generate_silence(50)

    latencies = []
    n = 100  # 测试次数

    for _ in range(n):
        start = time.time()
        vad.process_audio(test_audio)
        elapsed = (time.time() - start) * 1000
        latencies.append(elapsed)

    # 混合静音测试
    for _ in range(n):
        vad.process_audio(silence)
        start = time.time()
        vad.process_audio(test_audio)
        elapsed = (time.time() - start) * 1000
        latencies.append(elapsed)

    print_report("VAD 延迟测试", latencies, sla_threshold=50)
    avg = sum(latencies) / len(latencies)
    assert avg < 50, f"VAD 平均延迟 {avg:.1f}ms 超过 50ms 阈值"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_llm_latency():
    """测试 LLM 首 token 延迟（多轮）"""
    customer = PRESET_CUSTOMERS[0]
    scenario = PRESET_SCENARIOS[0]
    agent = CustomerAgent(customer, scenario, difficulty=1)

    first_token_latencies = []
    total_latencies = []
    n = 3  # 测试轮次

    for i in range(n):
        print(f"\n  [LLM 测试轮次 {i+1}/{n}]")

        start = time.time()
        first_token = True
        token_count = 0

        async for chunk in agent.generate_opening():
            if first_token:
                ft_latency = (time.time() - start) * 1000
                first_token_latencies.append(ft_latency)
                first_token = False
            token_count += 1

        total = (time.time() - start) * 1000
        total_latencies.append(total)

        print(f"    首 token: {ft_latency:.1f}ms | 总生成: {total:.1f}ms | tokens: {token_count}")

    print_report("LLM 首 Token 延迟", first_token_latencies, sla_threshold=500)
    print_report("LLM 总生成时间", total_latencies, sla_threshold=2000)

    avg_ft = sum(first_token_latencies) / len(first_token_latencies)
    assert avg_ft < 2000, f"LLM 首 token 平均延迟 {avg_ft:.1f}ms 过高"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_tts_latency():
    """测试 TTS 首音频延迟（多句式）"""
    from services.tts.provider import create_tts_provider

    tts = create_tts_provider()

    test_texts = [
        "你好，我今天主要想了解一下你们飞书和豆包企业版这边能够解决我们什么问题。",
        "我们公司目前有200多人，也在考虑数字化办公这块。",
        "价格方面你们是怎么收费的？",
        "嗯，这个功能听起来不错，能具体说说吗？",
        "好的，我了解了，谢谢你的介绍。",
    ]

    ttfa_latencies = []
    total_latencies = []

    for text in test_texts:
        start = time.time()
        first_audio = True
        chunk_count = 0

        async for chunk in tts.stream_synthesize(text, "alloy"):
            if first_audio:
                ttfa = (time.time() - start) * 1000
                ttfa_latencies.append(ttfa)
                first_audio = False
            chunk_count += 1

        total = (time.time() - start) * 1000
        total_latencies.append(total)

        print(f"  [{text[:20]}...] TTFA: {ttfa:.1f}ms | 总耗时: {total:.1f}ms | chunks: {chunk_count}")

    print_report("TTS 首音频延迟 (TTFA)", ttfa_latencies, sla_threshold=1000)
    print_report("TTS 总生成时间", total_latencies, sla_threshold=3000)

    avg_ttfa = sum(ttfa_latencies) / len(ttfa_latencies)
    assert avg_ttfa < 3000, f"TTS 平均 TTFA {avg_ttfa:.1f}ms 过高"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_stt_latency():
    """测试 STT 识别延迟（模拟音频）"""
    from services.stt.provider import create_stt_provider

    stt = create_stt_provider()
    test_audio = generate_test_audio(500)  # 500ms 音频

    latencies = []
    n = 3

    for i in range(n):
        start = time.time()
        text = await stt.transcribe(test_audio)
        elapsed = (time.time() - start) * 1000
        latencies.append(elapsed)
        print(f"  [STT 测试轮次 {i+1}/{n}] {elapsed:.1f}ms | 识别结果: '{text[:30]}...'")

    print_report("STT 识别延迟", latencies, sla_threshold=2000)
    avg = sum(latencies) / len(latencies)
    assert avg < 5000, f"STT 平均延迟 {avg:.1f}ms 过高"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_full_pipeline_latency():
    """测试端到端管线延迟（VAD → STT → LLM → TTS）"""
    from services.tts.provider import create_tts_provider
    from services.stt.provider import create_stt_provider

    customer = PRESET_CUSTOMERS[0]
    scenario = PRESET_SCENARIOS[0]
    agent = CustomerAgent(customer, scenario, difficulty=1)
    tts = create_tts_provider()
    vad = VADDetector()
    test_audio = generate_test_audio(500)

    pipeline_ttfa = []
    n = 2

    for i in range(n):
        print(f"\n  [Pipeline 测试轮次 {i+1}/{n}]")
        overall_start = time.time()

        # VAD
        vad_start = time.time()
        vad.process_audio(test_audio)
        vad_ms = (time.time() - vad_start) * 1000

        # STT (mock)
        stt_start = time.time()
        stt_text = "你好，我想了解一下你们的产品有什么功能。"
        stt_ms = (time.time() - stt_start) * 1000

        # LLM
        llm_start = time.time()
        llm_text = ""
        first_token = True
        async for chunk in agent.generate_response(stt_text):
            if first_token:
                llm_ft_ms = (time.time() - llm_start) * 1000
                first_token = False
            llm_text += chunk

        # TTS
        tts_start = time.time()
        first_audio = True
        async for chunk in tts.stream_synthesize(llm_text[:50], "alloy"):
            if first_audio:
                tts_ttfa = (time.time() - tts_start) * 1000
                first_audio = False
                break

        total_ttfa = (time.time() - overall_start) * 1000
        pipeline_ttfa.append(total_ttfa)

        print(f"  VAD: {vad_ms:.1f}ms | STT: {stt_ms:.1f}ms | LLM FT: {llm_ft_ms:.1f}ms | TTS: {tts_ttfa:.1f}ms | Total: {total_ttfa:.1f}ms")

    print_report("端到端管线 TTFA", pipeline_ttfa, sla_threshold=2000)
    avg = sum(pipeline_ttfa) / len(pipeline_ttfa)
    assert avg < 5000, f"管线平均 TTFA {avg:.1f}ms 过高"


@pytest.mark.asyncio
async def test_latency_consistency():
    """测试延迟一致性（多轮 VAD 处理）"""
    vad = VADDetector()
    test_audio = generate_test_audio(50)
    silence = generate_silence(30)

    latencies = []
    n = 500

    for i in range(n):
        # 交替音频和静音
        vad.process_audio(silence)
        start = time.time()
        result = vad.process_audio(test_audio)
        elapsed = (time.time() - start) * 1000
        latencies.append(elapsed)

    percentiles = compute_percentiles(latencies, [50, 95, 99])
    p95_p50_ratio = percentiles[95] / percentiles[50] if percentiles[50] > 0 else 0

    print_report("VAD 延迟一致性 (500次)", latencies, sla_threshold=50)
    print(f"  P95/P50 比值: {p95_p50_ratio:.2f}x")
    print(f"  标准差: {math.sqrt(sum((x - sum(latencies)/len(latencies))**2 for x in latencies) / len(latencies)):.2f}ms")

    assert p95_p50_ratio < 5, f"延迟抖动过大: P95/P50 = {p95_p50_ratio:.2f}x"