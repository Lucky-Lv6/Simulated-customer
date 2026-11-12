"""TTS Provider 实现 - OpenAI TTS + 豆包 TTS + Mock 降级"""

import base64
import io
import json
import logging
import math
import struct
import uuid
import wave
from typing import AsyncIterator

import httpx
from openai import AsyncOpenAI

from config.settings import settings
from services.tts.base import TTSProvider, Voice

logger = logging.getLogger(__name__)


class MockTTSProvider(TTSProvider):
    """Mock TTS Provider - 当 API 不支持 TTS 时降级使用，生成简单的提示音"""

    SAMPLE_RATE = 22050

    def _generate_tone(self, duration_ms: int = 300, freq: float = 440) -> bytes:
        """生成简单的正弦波 WAV 音频"""
        num_samples = int(self.SAMPLE_RATE * duration_ms / 1000)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.SAMPLE_RATE)
            samples = []
            for i in range(num_samples):
                t = i / self.SAMPLE_RATE
                envelope = min(1.0, i / 200) * min(1.0, (num_samples - i) / 200)
                val = int(16000 * envelope * math.sin(2 * math.pi * freq * t))
                samples.append(struct.pack("<h", val))
            wf.writeframes(b"".join(samples))
        return buf.getvalue()

    def recommend_voice(self, gender: str, age: int = 0) -> str:
        return "default"

    async def get_voices(self) -> list[Voice]:
        return [
            Voice(id="default", name="默认提示音", description="系统默认提示音（TTS 服务不可用时的降级方案）", tags=["默认"]),
        ]

    async def synthesize(self, text: str, voice_id: str, **kwargs) -> bytes:
        return self._generate_tone(500, 523)

    async def stream_synthesize(self, text: str, voice_id: str, **kwargs) -> AsyncIterator[bytes]:
        yield self._generate_tone(500, 523)


class OpenAITTSProvider(TTSProvider):
    def __init__(self, api_key: str | None = None, base_url: str | None = None, model: str | None = None):
        self.client = AsyncOpenAI(
            api_key=api_key or settings.TTS_API_KEY or settings.LLM_API_KEY,
            base_url=base_url or settings.TTS_BASE_URL or settings.LLM_BASE_URL,
            timeout=settings.TTS_TIMEOUT_S,
            max_retries=1,
        )
        self.model = model or settings.TTS_MODEL

    async def get_voices(self) -> list[Voice]:
        return [
            Voice(id="alloy", name="沉稳男声", description="30-40岁 专业 / 理性 / 沉稳", tags=["男声", "沉稳"]),
            Voice(id="echo", name="成熟男声", description="40-50岁 成熟 / 谨慎 / 稳重", tags=["男声", "成熟"]),
            Voice(id="fable", name="专业男声", description="25-35岁 自然 / 专业 / 清晰", tags=["男声", "专业"]),
            Voice(id="onyx", name="深沉男声", description="35-45岁 深沉 / 自信 / 有力", tags=["男声", "深沉"]),
            Voice(id="nova", name="亲和女声", description="25-35岁 自然 / 亲和 / 温暖", tags=["女声", "亲和"]),
            Voice(id="shimmer", name="专业女声", description="30-40岁 自然 / 专业 / 亲切", tags=["女声", "专业"]),
        ]

    def recommend_voice(self, gender: str, age: int = 0) -> str:
        return "alloy" if gender == "male" else "nova"

    async def synthesize(self, text: str, voice_id: str, **kwargs) -> bytes:
        response = await self.client.audio.speech.create(
            model=self.model,
            voice=voice_id,
            input=text,
        )
        return response.content

    async def stream_synthesize(self, text: str, voice_id: str, **kwargs) -> AsyncIterator[bytes]:
        async with self.client.audio.speech.with_streaming_response.create(
            model=self.model,
            voice=voice_id,
            input=text,
        ) as response:
            async for chunk in response.iter_bytes():
                yield chunk


class DoubaoTTSProvider(TTSProvider):
    """豆包（火山引擎语音合成）TTS Provider - V3 HTTP Chunked 接口"""

    TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"

    # 豆包语音合成模型2.0 音色列表（官方 voice_type）
    VOICES = {
        "zh_female_vv_uranus_bigtts": Voice(id="zh_female_vv_uranus_bigtts", name="Vivi 2.0", description="通用 / 支持多语种方言", tags=["女声", "通用"]),
        "zh_female_xiaohe_uranus_bigtts": Voice(id="zh_female_xiaohe_uranus_bigtts", name="小何 2.0", description="通用 / 温暖亲切", tags=["女声", "温暖"]),
        "zh_male_m191_uranus_bigtts": Voice(id="zh_male_m191_uranus_bigtts", name="云舟 2.0", description="通用 / 沉稳专业", tags=["男声", "沉稳"]),
        "zh_male_taocheng_uranus_bigtts": Voice(id="zh_male_taocheng_uranus_bigtts", name="小天 2.0", description="通用 / 亲和友好", tags=["男声", "亲和"]),
        "zh_female_kefunvsheng_uranus_bigtts": Voice(id="zh_female_kefunvsheng_uranus_bigtts", name="暖阳女声 2.0", description="客服场景 / 温暖耐心", tags=["女声", "客服"]),
        "zh_female_shuangkuaisisi_uranus_bigtts": Voice(id="zh_female_shuangkuaisisi_uranus_bigtts", name="爽快思思 2.0", description="通用 / 爽快干练", tags=["女声", "爽快"]),
        "zh_female_qinqienv_uranus_bigtts": Voice(id="zh_female_qinqienv_uranus_bigtts", name="亲切女声 2.0", description="通用 / 亲切随和", tags=["女声", "亲切"]),
        "zh_female_gaolengyujie_uranus_bigtts": Voice(id="zh_female_gaolengyujie_uranus_bigtts", name="高冷御姐 2.0", description="通用 / 高冷知性", tags=["女声", "高冷"]),
        "zh_male_liufei_uranus_bigtts": Voice(id="zh_male_liufei_uranus_bigtts", name="刘飞 2.0", description="通用 / 沉稳男声", tags=["男声", "沉稳"]),
        "zh_male_shenyeboke_uranus_bigtts": Voice(id="zh_male_shenyeboke_uranus_bigtts", name="深夜播客 2.0", description="通用 / 磁性低沉", tags=["男声", "磁性"]),
        # === 扩充特色音色（豆包语音合成模型2.0 / seed-tts-2.0 官方可用 voice_type）===
        "zh_female_sophie_uranus_bigtts": Voice(id="zh_female_sophie_uranus_bigtts", name="魅力苏菲 2.0", description="通用 / 成熟知性", tags=["女声", "知性"]),
        "zh_female_qingxinnvsheng_uranus_bigtts": Voice(id="zh_female_qingxinnvsheng_uranus_bigtts", name="清新女声 2.0", description="通用 / 清新自然", tags=["女声", "清新"]),
        "zh_female_cancan_uranus_bigtts": Voice(id="zh_female_cancan_uranus_bigtts", name="知性灿灿 2.0", description="通用 / 知性温婉", tags=["女声", "知性"]),
        "zh_female_tianmeixiaoyuan_uranus_bigtts": Voice(id="zh_female_tianmeixiaoyuan_uranus_bigtts", name="甜美小源 2.0", description="通用 / 甜美青春", tags=["女声", "甜美"]),
        "zh_female_tianmeitaozi_uranus_bigtts": Voice(id="zh_female_tianmeitaozi_uranus_bigtts", name="甜美桃子 2.0", description="通用 / 可爱甜润", tags=["女声", "甜美"]),
        "zh_female_linjianvhai_uranus_bigtts": Voice(id="zh_female_linjianvhai_uranus_bigtts", name="邻家女孩 2.0", description="通用 / 亲切邻家", tags=["女声", "亲切"]),
        "zh_female_meilinvyou_uranus_bigtts": Voice(id="zh_female_meilinvyou_uranus_bigtts", name="魅力女友 2.0", description="通用 / 温柔知性", tags=["女声", "温柔"]),
        "zh_female_wenroumama_uranus_bigtts": Voice(id="zh_female_wenroumama_uranus_bigtts", name="温柔妈妈 2.0", description="通用 / 温柔成熟", tags=["女声", "成熟"]),
        "zh_male_shaonianzixin_uranus_bigtts": Voice(id="zh_male_shaonianzixin_uranus_bigtts", name="少年梓辛 2.0", description="通用 / 少年活力", tags=["男声", "少年"]),
        "zh_male_ruyayichen_uranus_bigtts": Voice(id="zh_male_ruyayichen_uranus_bigtts", name="儒雅逸辰 2.0", description="通用 / 儒雅温润", tags=["男声", "儒雅"]),
        "zh_male_dayi_uranus_bigtts": Voice(id="zh_male_dayi_uranus_bigtts", name="大壹 2.0", description="通用 / 沉稳有力", tags=["男声", "沉稳"]),
        "zh_male_wennuanahu_uranus_bigtts": Voice(id="zh_male_wennuanahu_uranus_bigtts", name="温暖阿虎 2.0", description="通用 / 温暖亲切", tags=["男声", "温暖"]),
        # === 写实真人音色（豆包 seed-tts-2.0，供不同客户角色选择）===
        # 女声
        "zh_female_tvbnv_uranus_bigtts": Voice(id="zh_female_tvbnv_uranus_bigtts", name="TVB女声 2.0", description="港剧腔 / 知性大方", tags=["女声", "知性"]),
        "zh_female_zhishuaiyingzi_uranus_bigtts": Voice(id="zh_female_zhishuaiyingzi_uranus_bigtts", name="直率英子 2.0", description="通用 / 直率干练", tags=["女声", "干练"]),
        "zh_female_popo_uranus_bigtts": Voice(id="zh_female_popo_uranus_bigtts", name="婆婆 2.0", description="老年 / 慈祥和蔼", tags=["女声", "老年"]),
        "zh_female_wenroushunv_uranus_bigtts": Voice(id="zh_female_wenroushunv_uranus_bigtts", name="温柔淑女 2.0", description="通用 / 温婉端庄", tags=["女声", "温婉"]),
        "zh_female_kailangjiejie_uranus_bigtts": Voice(id="zh_female_kailangjiejie_uranus_bigtts", name="开朗姐姐 2.0", description="通用 / 热情开朗", tags=["女声", "开朗"]),
        "zh_female_tiexinnvsheng_uranus_bigtts": Voice(id="zh_female_tiexinnvsheng_uranus_bigtts", name="贴心女声 2.0", description="通用 / 体贴耐心", tags=["女声", "贴心"]),
        "zh_female_wenjingmaomao_uranus_bigtts": Voice(id="zh_female_wenjingmaomao_uranus_bigtts", name="文静毛毛 2.0", description="通用 / 文静内敛", tags=["女声", "文静"]),
        "zh_female_zhixingnv_uranus_bigtts": Voice(id="zh_female_zhixingnv_uranus_bigtts", name="知性女声 2.0", description="通用 / 知性优雅", tags=["女声", "知性"]),
        "zh_female_qingchezizi_uranus_bigtts": Voice(id="zh_female_qingchezizi_uranus_bigtts", name="清澈梓梓 2.0", description="通用 / 清澈干净", tags=["女声", "清澈"]),
        "zh_female_tianmeiyueyue_uranus_bigtts": Voice(id="zh_female_tianmeiyueyue_uranus_bigtts", name="甜美悦悦 2.0", description="通用 / 甜美温柔", tags=["女声", "甜美"]),
        "zh_female_roumeinvyou_uranus_bigtts": Voice(id="zh_female_roumeinvyou_uranus_bigtts", name="柔美女友 2.0", description="通用 / 柔美温和", tags=["女声", "温柔"]),
        "zh_female_wenrouxiaoya_uranus_bigtts": Voice(id="zh_female_wenrouxiaoya_uranus_bigtts", name="温柔小雅 2.0", description="通用 / 温柔细腻", tags=["女声", "温柔"]),
        "zh_female_linxiao_uranus_bigtts": Voice(id="zh_female_linxiao_uranus_bigtts", name="林潇 2.0", description="通用 / 文艺知性", tags=["女声", "文艺"]),
        "zh_female_lingling_uranus_bigtts": Voice(id="zh_female_lingling_uranus_bigtts", name="玲玲姐姐 2.0", description="通用 / 亲切温柔", tags=["女声", "亲切"]),
        # 男声
        "zh_male_jieshuoxiaoming_uranus_bigtts": Voice(id="zh_male_jieshuoxiaoming_uranus_bigtts", name="解说小明 2.0", description="通用 / 解说风格", tags=["男声", "沉稳"]),
        "zh_male_yizhipiannan_uranus_bigtts": Voice(id="zh_male_yizhipiannan_uranus_bigtts", name="译制片男 2.0", description="通用 / 译制腔", tags=["男声", "沉稳"]),
        "zh_male_linjiananhai_uranus_bigtts": Voice(id="zh_male_linjiananhai_uranus_bigtts", name="邻家男孩 2.0", description="通用 / 亲切阳光", tags=["男声", "阳光"]),
        "zh_male_ruyaqingnian_uranus_bigtts": Voice(id="zh_male_ruyaqingnian_uranus_bigtts", name="儒雅青年 2.0", description="通用 / 儒雅温和", tags=["男声", "儒雅"]),
        "zh_male_aojiaobazong_uranus_bigtts": Voice(id="zh_male_aojiaobazong_uranus_bigtts", name="傲娇霸总 2.0", description="通用 / 沉稳强势", tags=["男声", "沉稳"]),
        "zh_male_huolixiaoge_uranus_bigtts": Voice(id="zh_male_huolixiaoge_uranus_bigtts", name="活力小哥 2.0", description="通用 / 活泼阳光", tags=["男声", "阳光"]),
        "zh_male_baqiqingshu_uranus_bigtts": Voice(id="zh_male_baqiqingshu_uranus_bigtts", name="霸气青叔 2.0", description="通用 / 稳重成熟", tags=["男声", "成熟"]),
        "zh_male_cixingjieshuonan_uranus_bigtts": Voice(id="zh_male_cixingjieshuonan_uranus_bigtts", name="磁性解说男声 2.0", description="通用 / 磁性低沉", tags=["男声", "磁性"]),
        "zh_male_gaolengchenwen_uranus_bigtts": Voice(id="zh_male_gaolengchenwen_uranus_bigtts", name="高冷沉稳 2.0", description="通用 / 高冷稳重", tags=["男声", "沉稳"]),
        "zh_male_kuailexiaodong_uranus_bigtts": Voice(id="zh_male_kuailexiaodong_uranus_bigtts", name="快乐小东 2.0", description="通用 / 开朗明快", tags=["男声", "开朗"]),
        "zh_male_kailangxuezhang_uranus_bigtts": Voice(id="zh_male_kailangxuezhang_uranus_bigtts", name="开朗学长 2.0", description="通用 / 亲和开朗", tags=["男声", "开朗"]),
        "zh_male_youyoujunzi_uranus_bigtts": Voice(id="zh_male_youyoujunzi_uranus_bigtts", name="悠悠君子 2.0", description="通用 / 温润君子", tags=["男声", "温润"]),
        "zh_male_qingshuangnanda_uranus_bigtts": Voice(id="zh_male_qingshuangnanda_uranus_bigtts", name="清爽男大 2.0", description="通用 / 清爽阳光", tags=["男声", "阳光"]),
        "zh_male_yuanboxiaoshu_uranus_bigtts": Voice(id="zh_male_yuanboxiaoshu_uranus_bigtts", name="渊博小叔 2.0", description="通用 / 成熟可靠", tags=["男声", "成熟"]),
        "zh_male_yangguangqingnian_uranus_bigtts": Voice(id="zh_male_yangguangqingnian_uranus_bigtts", name="阳光青年 2.0", description="通用 / 阳光开朗", tags=["男声", "阳光"]),
        "zh_male_wenrouxiaoge_uranus_bigtts": Voice(id="zh_male_wenrouxiaoge_uranus_bigtts", name="温柔小哥 2.0", description="通用 / 温柔体贴", tags=["男声", "温柔"]),
        "zh_male_dongfanghaoran_uranus_bigtts": Voice(id="zh_male_dongfanghaoran_uranus_bigtts", name="东方浩然 2.0", description="通用 / 沉稳大气", tags=["男声", "沉稳"]),
    }

    def __init__(self):
        self.api_key = settings.TTS_API_KEY or ""
        self.appid = settings.TTS_APPID or ""
        self.resource_id = "seed-tts-2.0"

    # 按性别分类的声音列表
    MALE_VOICES = [
        "zh_male_m191_uranus_bigtts",      # 云舟 2.0 - 沉稳专业
        "zh_male_taocheng_uranus_bigtts",  # 小天 2.0 - 亲和友好
        "zh_male_liufei_uranus_bigtts",    # 刘飞 2.0 - 沉稳男声
        "zh_male_shenyeboke_uranus_bigtts",# 深夜播客 2.0 - 磁性低沉
        "zh_male_shaonianzixin_uranus_bigtts",  # 少年梓辛 2.0 - 少年活力
        "zh_male_ruyayichen_uranus_bigtts",     # 儒雅逸辰 2.0 - 儒雅温润
        "zh_male_dayi_uranus_bigtts",           # 大壹 2.0 - 沉稳有力
        "zh_male_wennuanahu_uranus_bigtts",     # 温暖阿虎 2.0 - 温暖亲切
        "zh_male_jieshuoxiaoming_uranus_bigtts",     # 解说小明 2.0
        "zh_male_yizhipiannan_uranus_bigtts",        # 译制片男 2.0
        "zh_male_linjiananhai_uranus_bigtts",        # 邻家男孩 2.0
        "zh_male_ruyaqingnian_uranus_bigtts",        # 儒雅青年 2.0
        "zh_male_aojiaobazong_uranus_bigtts",        # 傲娇霸总 2.0
        "zh_male_huolixiaoge_uranus_bigtts",         # 活力小哥 2.0
        "zh_male_baqiqingshu_uranus_bigtts",         # 霸气青叔 2.0
        "zh_male_cixingjieshuonan_uranus_bigtts",    # 磁性解说男声 2.0
        "zh_male_gaolengchenwen_uranus_bigtts",      # 高冷沉稳 2.0
        "zh_male_kuailexiaodong_uranus_bigtts",      # 快乐小东 2.0
        "zh_male_kailangxuezhang_uranus_bigtts",     # 开朗学长 2.0
        "zh_male_youyoujunzi_uranus_bigtts",         # 悠悠君子 2.0
        "zh_male_qingshuangnanda_uranus_bigtts",     # 清爽男大 2.0
        "zh_male_yuanboxiaoshu_uranus_bigtts",       # 渊博小叔 2.0
        "zh_male_yangguangqingnian_uranus_bigtts",   # 阳光青年 2.0
        "zh_male_wenrouxiaoge_uranus_bigtts",        # 温柔小哥 2.0
        "zh_male_dongfanghaoran_uranus_bigtts",      # 东方浩然 2.0
    ]

    FEMALE_VOICES = [
        "zh_female_vv_uranus_bigtts",          # Vivi 2.0 - 通用
        "zh_female_xiaohe_uranus_bigtts",      # 小何 2.0 - 温暖亲切
        "zh_female_kefunvsheng_uranus_bigtts", # 暖阳女声 2.0 - 耐心
        "zh_female_shuangkuaisisi_uranus_bigtts", # 爽快思思 2.0 - 干练
        "zh_female_qinqienv_uranus_bigtts",    # 亲切女声 2.0 - 亲切随和
        "zh_female_gaolengyujie_uranus_bigtts",# 高冷御姐 2.0 - 高冷
        "zh_female_sophie_uranus_bigtts",      # 魅力苏菲 2.0 - 知性
        "zh_female_qingxinnvsheng_uranus_bigtts",  # 清新女声 2.0 - 清新
        "zh_female_cancan_uranus_bigtts",      # 知性灿灿 2.0 - 知性
        "zh_female_tianmeixiaoyuan_uranus_bigtts", # 甜美小源 2.0 - 甜美
        "zh_female_tianmeitaozi_uranus_bigtts",    # 甜美桃子 2.0 - 可爱
        "zh_female_linjianvhai_uranus_bigtts",     # 邻家女孩 2.0 - 亲切
        "zh_female_meilinvyou_uranus_bigtts",      # 魅力女友 2.0 - 温柔
        "zh_female_wenroumama_uranus_bigtts",      # 温柔妈妈 2.0 - 成熟
        "zh_female_tvbnv_uranus_bigtts",           # TVB女声 2.0
        "zh_female_zhishuaiyingzi_uranus_bigtts",  # 直率英子 2.0
        "zh_female_popo_uranus_bigtts",            # 婆婆 2.0
        "zh_female_wenroushunv_uranus_bigtts",     # 温柔淑女 2.0
        "zh_female_kailangjiejie_uranus_bigtts",   # 开朗姐姐 2.0
        "zh_female_tiexinnvsheng_uranus_bigtts",   # 贴心女声 2.0
        "zh_female_wenjingmaomao_uranus_bigtts",   # 文静毛毛 2.0
        "zh_female_zhixingnv_uranus_bigtts",       # 知性女声 2.0
        "zh_female_qingchezizi_uranus_bigtts",     # 清澈梓梓 2.0
        "zh_female_tianmeiyueyue_uranus_bigtts",   # 甜美悦悦 2.0
        "zh_female_roumeinvyou_uranus_bigtts",     # 柔美女友 2.0
        "zh_female_wenrouxiaoya_uranus_bigtts",    # 温柔小雅 2.0
        "zh_female_linxiao_uranus_bigtts",         # 林潇 2.0
        "zh_female_lingling_uranus_bigtts",        # 玲玲姐姐 2.0
    ]

    def recommend_voice(self, gender: str, age: int = 0) -> str:
        """根据性别和年龄推荐声音"""
        if gender == "male":
            # 按年龄选择男声：年轻→亲和，中年→沉稳，年长→深沉
            if age <= 0 or age >= 55:
                return "zh_male_taocheng_uranus_bigtts"  # 默认亲和男声
            if age < 30:
                return "zh_male_taocheng_uranus_bigtts"   # 小天 2.0 - 亲和
            if age < 45:
                return "zh_male_m191_uranus_bigtts"       # 云舟 2.0 - 沉稳专业
            if age < 55:
                return "zh_male_liufei_uranus_bigtts"     # 刘飞 2.0 - 沉稳
            return "zh_male_shenyeboke_uranus_bigtts"     # 深夜播客 2.0 - 磁性低沉
        else:
            # 按年龄选择女声：年轻→爽快/亲切，中年→亲切/温暖，年长→温暖
            if age <= 0 or age >= 50:
                return "zh_female_vv_uranus_bigtts"       # 默认女声
            if age < 30:
                return "zh_female_shuangkuaisisi_uranus_bigtts"  # 爽快思思 2.0
            if age < 40:
                return "zh_female_xiaohe_uranus_bigtts"   # 小何 2.0 - 温暖亲切
            return "zh_female_kefunvsheng_uranus_bigtts"  # 暖阳女声 2.0 - 温暖耐心

    def _build_headers(self) -> dict:
        """根据配置选择鉴权方式。"""
        headers = {
            "X-Api-Resource-Id": self.resource_id,
            "X-Api-Request-Id": str(uuid.uuid4()),
            "Content-Type": "application/json; charset=utf-8",
        }
        if self.appid:
            # 旧版控制台鉴权: X-Api-App-Key + X-Api-Access-Key
            headers["X-Api-App-Key"] = self.appid
            headers["X-Api-Access-Key"] = self.api_key
        else:
            # 新版控制台鉴权: X-Api-Key
            headers["X-Api-Key"] = self.api_key
        return headers

    async def _call_tts(self, text: str, voice_id: str) -> bytes:
        """调用豆包语音合成 V3 HTTP Chunked 接口。"""
        speaker = voice_id if voice_id in self.VOICES else "zh_female_vv_uranus_bigtts"
        logger.info(f"[TTS] 开始合成: speaker={speaker}, text_len={len(text)}")

        payload = {
            "user": {"uid": "fde-customer-agent"},
            "req_params": {
                "text": text,
                "speaker": speaker,
                "audio_params": {
                    "format": "pcm",
                    "sample_rate": 24000,
                },
            },
        }

        headers = self._build_headers()
        logger.info(f"[TTS] 请求头: { {k:v for k,v in headers.items() if k != 'X-Api-Access-Key' and k != 'X-Api-Key'} }")

        async with httpx.AsyncClient(timeout=settings.TTS_TIMEOUT_S) as client:
            response = await client.post(
                self.TTS_URL,
                headers=headers,
                json=payload,
            )
            logger.info(f"[TTS] HTTP 响应: status={response.status_code}, body_size={len(response.content)}")
            response.raise_for_status()

            content = response.content

            # 解析所有 JSON 块，提取 base64 音频数据
            pcm_data = bytearray()
            pos = 0
            json_count = 0
            while pos < len(content):
                json_start = content.find(b"{", pos)
                if json_start == -1:
                    break
                json_end = content.find(b"}", json_start)
                if json_end == -1:
                    break

                json_part = content[json_start : json_end + 1]
                try:
                    result = json.loads(json_part)
                except json.JSONDecodeError:
                    pos = json_end + 1
                    continue

                json_count += 1
                code = result.get("code", -1)
                if code not in (0, 20000000):
                    raise RuntimeError(
                        f"TTS API 错误: code={code}, message={result.get('message', '')}"
                    )

                audio_b64 = result.get("data", "")
                if audio_b64:
                    try:
                        audio_chunk = base64.b64decode(audio_b64)
                        pcm_data.extend(audio_chunk)
                        logger.info(f"[TTS] 解析到第 {json_count} 个 JSON 块, data_size={len(audio_chunk)}")
                    except Exception as e:
                        logger.warning(f"[TTS] base64 解码失败: {e}")

                pos = json_end + 1

            logger.info(f"[TTS] 解析完成: json_count={json_count}, total_pcm_size={len(pcm_data)}")

            if not pcm_data:
                raise RuntimeError("TTS API 返回了空音频数据")

            if pcm_data[:4] == b"RIFF":
                logger.info(f"[TTS] 返回 WAV 格式, size={len(pcm_data)}")
                return bytes(pcm_data)

            # PCM → WAV 封装
            channels = 1
            bits = 16
            sample_rate = 24000
            byte_rate = sample_rate * channels * bits // 8
            block_align = channels * bits // 8
            riff_size = 36 + len(pcm_data)
            wav_header = struct.pack(
                '<4sI4s4sIHHIIHH4sI',
                b'RIFF', riff_size, b'WAVE',
                b'fmt ', 16, 1, channels, sample_rate,
                byte_rate, block_align, bits,
                b'data', len(pcm_data)
            )
            result = wav_header + bytes(pcm_data)
            logger.info(f"[TTS] PCM 封装为 WAV, total_size={len(result)}")
            return result

    async def get_voices(self) -> list[Voice]:
        return list(self.VOICES.values())

    async def synthesize(self, text: str, voice_id: str, **kwargs) -> bytes:
        return await self._call_tts(text, voice_id)

    async def stream_synthesize(self, text: str, voice_id: str, **kwargs) -> AsyncIterator[bytes]:
        audio = await self._call_tts(text, voice_id)
        yield audio


def create_tts_provider() -> TTSProvider:
    """根据配置创建 TTS Provider"""
    tts_api_key = settings.TTS_API_KEY or ""
    tts_base_url = (settings.TTS_BASE_URL or settings.LLM_BASE_URL or "").lower()

    # 配置了 TTS API Key → 使用豆包 TTS（V3 HTTP Chunked 接口）
    if tts_api_key:
        logger.info("使用豆包语音合成 TTS（V3 HTTP Chunked 接口）")
        return DoubaoTTSProvider()

    # DeepSeek 等纯 LLM API 不支持 TTS，降级到 Mock
    if "deepseek" in tts_base_url:
        logger.warning("DeepSeek 不支持 TTS，降级到 MockTTSProvider")
        return MockTTSProvider()

    return OpenAITTSProvider()