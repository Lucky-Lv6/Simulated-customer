"""Scenario Parser 单元测试"""

import pytest
from services.parser.scenario_parser import ScenarioParser


def test_parse_basic_text():
    text = """某制造企业
公司规模：500人
目前使用飞书
主要问题：知识分散
痛点：员工查找资料效率低
希望：AI改善知识查询
客户关注：数据安全"""

    parser = ScenarioParser()
    scenario = parser.parse(text, "test.txt")

    assert scenario.company_background == "某制造企业"
    assert "500人" in scenario.company_size
    assert "飞书" in scenario.current_tools
    assert len(scenario.pain_points) > 0
    assert len(scenario.concerns) > 0


def test_parse_empty_text():
    parser = ScenarioParser()
    scenario = parser.parse("", "empty.txt")

    assert scenario.company_background == ""
    assert scenario.known_facts == []


def test_parse_list_items():
    text = """客户需求：
1. 建立企业知识库
2. 使用AI回答员工问题
3. 与飞书整合"""

    parser = ScenarioParser()
    scenario = parser.parse(text)

    assert len(scenario.requirements) > 0


def test_parse_concerns():
    text = """客户关注：
1. 数据安全
2. 权限管理
3. 成本"""

    parser = ScenarioParser()
    scenario = parser.parse(text)

    assert len(scenario.concerns) > 0
    assert any("数据安全" in c for c in scenario.concerns)
    assert any("成本" in c for c in scenario.concerns)