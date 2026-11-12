"""业务场景数据模型"""

from dataclasses import dataclass, field


@dataclass
class Scenario:
    id: str
    name: str
    description: str
    customer_goal: str
    feishu_products: list[str] = field(default_factory=list)
    doubao_products: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)

    # 从上传文本解析时的补充信息
    company_background: str = ""
    industry: str = ""
    company_size: str = ""
    current_tools: list[str] = field(default_factory=list)
    pain_points: list[str] = field(default_factory=list)
    goals: list[str] = field(default_factory=list)
    concerns: list[str] = field(default_factory=list)
    requirements: list[str] = field(default_factory=list)
    technical_requirements: list[str] = field(default_factory=list)
    business_requirements: list[str] = field(default_factory=list)
    decision_process: str = ""
    budget: str = ""
    timeline: str = ""
    known_facts: list[str] = field(default_factory=list)


# 预置业务场景
PRESET_SCENARIOS: list[Scenario] = [
    Scenario(
        id="feishu-intro",
        name="飞书整体方案介绍",
        description="客户希望了解飞书套件的整体功能和价值",
        customer_goal="了解飞书如何提升企业办公效率",
        feishu_products=["飞书整体办公", "飞书文档", "飞书会议", "飞书审批"],
        tags=["飞书", "办公协同"],
    ),
    Scenario(
        id="feishu-base",
        name="飞书协同办公",
        description="客户关注企业协同办公场景",
        customer_goal="评估飞书协同办公能力",
        feishu_products=["飞书文档", "飞书多维表格", "飞书会议", "飞书项目"],
        tags=["飞书", "协同办公"],
    ),
    Scenario(
        id="feishu-bitable",
        name="飞书多维表格",
        description="客户对飞书多维表格（类似Notion/Excel）感兴趣",
        customer_goal="了解多维表格在业务管理中的应用",
        feishu_products=["飞书多维表格"],
        tags=["飞书", "多维表格", "数据管理"],
    ),
    Scenario(
        id="feishu-approval",
        name="飞书审批",
        description="客户关注企业审批流程数字化",
        customer_goal="了解飞书审批系统的功能和灵活性",
        feishu_products=["飞书审批", "飞书自动化"],
        tags=["飞书", "审批", "流程"],
    ),
    Scenario(
        id="feishu-knowledge",
        name="飞书知识库",
        description="客户希望建立企业知识库",
        customer_goal="评估飞书知识库能力",
        feishu_products=["飞书知识库", "飞书文档"],
        tags=["飞书", "知识库", "知识管理"],
    ),
    Scenario(
        id="feishu-automation",
        name="飞书自动化",
        description="客户对飞书自动化流程感兴趣",
        customer_goal="了解飞书自动化如何提升效率",
        feishu_products=["飞书自动化", "飞书审批"],
        tags=["飞书", "自动化"],
    ),
    Scenario(
        id="feishu-meeting",
        name="飞书会议",
        description="客户关注远程会议和协作",
        customer_goal="评估飞书会议的质量和功能",
        feishu_products=["飞书会议", "飞书文档"],
        tags=["飞书", "会议", "远程"],
    ),
    Scenario(
        id="feishu-project",
        name="飞书项目",
        description="客户对飞书项目管理感兴趣",
        customer_goal="了解飞书项目管理能力",
        feishu_products=["飞书项目", "飞书多维表格"],
        tags=["飞书", "项目管理"],
    ),
    Scenario(
        id="doubao-intro",
        name="豆包企业版介绍",
        description="客户希望了解豆包企业版的功能和价值",
        customer_goal="了解豆包企业版如何赋能企业AI",
        doubao_products=["豆包企业版", "企业AI"],
        tags=["豆包", "AI"],
    ),
    Scenario(
        id="doubao-knowledge",
        name="企业AI知识库",
        description="客户希望建立AI驱动的企业知识库",
        customer_goal="评估豆包企业版知识库方案",
        doubao_products=["豆包企业版", "企业知识库", "AI问答"],
        tags=["豆包", "知识库", "AI"],
    ),
    Scenario(
        id="doubao-agent",
        name="企业AI Agent",
        description="客户对AI Agent感兴趣",
        customer_goal="了解企业AI Agent的应用场景",
        doubao_products=["豆包企业版", "AI Agent"],
        tags=["豆包", "AI Agent", "AI"],
    ),
    Scenario(
        id="doubao-qa",
        name="企业内部智能问答",
        description="客户希望建立企业内部AI问答系统",
        customer_goal="评估豆包企业版的智能问答能力",
        doubao_products=["豆包企业版", "企业知识库", "AI问答"],
        tags=["豆包", "问答", "AI"],
    ),
    Scenario(
        id="ai-automation",
        name="企业AI自动化",
        description="客户对AI自动化办公感兴趣",
        customer_goal="了解AI如何自动化企业办公流程",
        doubao_products=["豆包企业版", "AI Agent", "企业AI"],
        tags=["AI", "自动化"],
    ),
    Scenario(
        id="ai-office",
        name="AI办公",
        description="客户关注AI在日常办公中的应用",
        customer_goal="了解AI办公的实际应用场景",
        feishu_products=["飞书文档", "飞书会议"],
        doubao_products=["豆包企业版", "企业AI"],
        tags=["AI", "办公", "飞书"],
    ),
    Scenario(
        id="feishu-doubao-combined",
        name="飞书 + 豆包联合解决方案",
        description="客户希望了解飞书和豆包企业版如何协同工作",
        customer_goal="评估飞书+豆包企业版整体解决方案",
        feishu_products=["飞书整体办公", "飞书知识库", "飞书文档"],
        doubao_products=["豆包企业版", "企业知识库", "AI问答", "AI Agent"],
        tags=["飞书", "豆包", "联合方案"],
    ),
]