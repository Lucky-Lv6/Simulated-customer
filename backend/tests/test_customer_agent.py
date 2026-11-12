"""Customer Agent 单元测试"""

import pytest
from models.customer import PRESET_CUSTOMERS
from models.scenario import PRESET_SCENARIOS
from agents.customer_agent import CustomerAgent, is_call_script_text, parse_script_pairs


@pytest.mark.asyncio
async def test_customer_agent_initialization():
    customer = PRESET_CUSTOMERS[0]
    scenario = PRESET_SCENARIOS[0]
    agent = CustomerAgent(customer, scenario, difficulty=3)

    assert agent.customer.id == "it-director"
    assert agent.scenario.id == "feishu-intro"
    assert agent.memory.difficulty == 3
    assert agent.memory.state.value == "INTRODUCTION"


@pytest.mark.asyncio
async def test_customer_agent_generate_response():
    customer = PRESET_CUSTOMERS[0]
    scenario = PRESET_SCENARIOS[0]
    agent = CustomerAgent(customer, scenario, difficulty=1)

    response = ""
    async for chunk in agent.generate_response("你好，我是飞书的FDE工程师，今天想了解一下你们的需求。"):
        response += chunk

    assert len(response) > 0
    assert len(agent.memory.turns) == 2
    assert agent.memory.turns[0].role == "user"
    assert agent.memory.turns[1].role == "customer"


@pytest.mark.asyncio
async def test_customer_agent_opening():
    customer = PRESET_CUSTOMERS[0]
    scenario = PRESET_SCENARIOS[0]
    agent = CustomerAgent(customer, scenario)

    response = ""
    async for chunk in agent.generate_opening():
        response += chunk

    assert len(response) > 0


@pytest.mark.asyncio
async def test_customer_agent_uploaded_text():
    customer = PRESET_CUSTOMERS[0]
    scenario = PRESET_SCENARIOS[0]
    agent = CustomerAgent(customer, scenario)

    agent.set_uploaded_text("某500人制造企业，目前已经使用飞书。", "test.txt")
    assert agent.memory.uploaded_text == "某500人制造企业，目前已经使用飞书。"
    assert agent.memory.uploaded_file_name == "test.txt"


def test_customer_material_not_treated_as_call_script():
    """客户材料即使包含“客户”字样，也必须走动态交流而不是剧本模式。"""
    material = """某制造企业客户需求说明

客户关注：
1. 数据安全 - 企业知识是核心资产
2. 权限管理

希望实现：
1. 建立统一的企业知识库
2. 使用AI回答员工常见问题
"""

    customer = PRESET_CUSTOMERS[0]
    scenario = PRESET_SCENARIOS[0]
    agent = CustomerAgent(customer, scenario)

    assert not is_call_script_text(material)
    agent.set_uploaded_text(material, "客户需求说明.txt")
    assert not agent.is_script_mode
    assert agent.script_pairs == []


def test_call_record_detected_as_call_script():
    """带说话人标记的真实通话记录应被识别为可逐句播放的剧本。"""
    transcript = """通话记录：豆包工作客户回访
时间：2026-09-02 22:01:45

客户 00:00:41
喂？

我 00:00:43
喂，你好，江总吗？

客户 00:00:46
哎哎哎，我是啊。

我 00:00:49
你好，我是飞书客户服务，想了解一下你们的使用情况。
"""

    pairs = parse_script_pairs(transcript)
    assert is_call_script_text(transcript)
    assert len(pairs) >= 2

    customer = PRESET_CUSTOMERS[0]
    scenario = PRESET_SCENARIOS[0]
    agent = CustomerAgent(customer, scenario)
    agent.set_uploaded_text(transcript, "回访记录.txt")
    assert agent.is_script_mode
    assert len(agent.script_pairs) == len(pairs)


def test_colon_format_material_is_strict_script():
    """“我：/客户：”冒号格式的资料也必须进入严格逐字模式。"""
    material = """我：你好，我是飞书工程师小王。
客户：你好，我们目前知识比较分散。
我：我们可以通过飞书知识库解决。
客户：那权限怎么控制？"""

    agent = CustomerAgent(PRESET_CUSTOMERS[0], PRESET_SCENARIOS[0])
    agent.set_uploaded_text(material, "对话资料.txt")
    assert agent.is_script_mode

    assert agent.match_script_line("你好，我是飞书工程师小王。") == "你好，我们目前知识比较分散。"
    assert agent.match_script_line("我们可以通过飞书知识库解决。") == "那权限怎么控制？"


def test_customer_only_material_replies_in_exact_order():
    """资料只有客户台词时，也按顺序一字不落地回应，播完即沉默。"""
    material = """客户：我们公司目前知识比较分散。
客户：部门之间的权限也比较复杂。"""

    agent = CustomerAgent(PRESET_CUSTOMERS[0], PRESET_SCENARIOS[0])
    agent.set_uploaded_text(material, "客户台词.txt")
    assert agent.is_script_mode

    assert agent.match_script_line("我先介绍一下飞书。") == "我们公司目前知识比较分散。"
    assert agent.match_script_line("好的，我继续介绍。") == "部门之间的权限也比较复杂。"
    assert agent.match_script_line("还有吗？") is None


def test_take_script_line_at_returns_exact_material_line():
    """前端字符匹配成功后传入序号，必须返回资料中对应的原文台词。"""
    material = """我：你好，我是飞书工程师小王。
客户：你好，我们目前知识比较分散。
我：我们可以通过飞书知识库解决。
客户：那权限怎么控制？"""

    agent = CustomerAgent(PRESET_CUSTOMERS[0], PRESET_SCENARIOS[0])
    agent.set_uploaded_text(material, "对话资料.txt")

    assert agent.take_script_line_at(1) == "那权限怎么控制？"
    assert agent.take_script_line_at(2) is None


@pytest.mark.asyncio
async def test_customer_agent_state_progression():
    customer = PRESET_CUSTOMERS[0]
    scenario = PRESET_SCENARIOS[0]
    agent = CustomerAgent(customer, scenario)

    assert agent.memory.state.value == "INTRODUCTION"

    for i in range(5):
        async for _ in agent.generate_response(f"测试消息 {i}"):
            pass

    assert agent.memory.state.value != "INTRODUCTION"
