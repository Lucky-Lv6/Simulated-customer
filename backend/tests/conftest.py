"""测试共享夹具。

两个目标：
1. 单元测试不访问真实外部服务——LLM 统一替换为固定回复的假 Provider；
2. 真实链路基准测试标记为 integration，默认跳过，避免没配 Key 时整片飘红。
"""

import os

import pytest

from services.llm.base import LLMProvider

# 假 Provider 的固定回复（按片段 yield，模拟流式）
FAKE_REPLY_CHUNKS = ["我们", "目前", "知识", "比较", "分散。"]


class FakeLLM(LLMProvider):
    """固定回复的假 LLM，用于离线单元测试。"""

    async def chat(self, messages: list[dict], max_tokens: int = 1024) -> str:
        return "".join(FAKE_REPLY_CHUNKS)

    async def stream_chat(self, messages: list[dict], max_tokens: int = 512):
        for chunk in FAKE_REPLY_CHUNKS:
            yield chunk

    async def get_model_name(self) -> str:
        return "fake-llm"


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "integration: 需要真实 API 凭据的端到端/延迟基准测试"
    )


def pytest_collection_modifyitems(config, items):
    if os.getenv("RUN_INTEGRATION"):
        return
    skip = pytest.mark.skip(reason="需要真实服务凭据；设置 RUN_INTEGRATION=1 后运行")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def fake_llm_provider(monkeypatch):
    """把 CustomerAgent 使用到的 LLM Provider 替换成假实现。"""
    if os.getenv("RUN_INTEGRATION"):
        yield
        return

    import agents.customer_agent as customer_agent

    monkeypatch.setattr(customer_agent, "create_llm_provider", lambda: FakeLLM())
    yield
