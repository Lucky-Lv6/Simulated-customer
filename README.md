# FDE AI 客户模拟中心

面向 FDE（售前工程师）的 **AI 客户陪练系统**：由 AI 扮演企业客户，与你进行实时语音交流，用于练习需求挖掘、方案讲解与异议处理。

支持上传客户资料，模拟客户会**严格按资料逐字回应**（一字不落），也可以不传资料、由 AI 动态扮演客户。

---

## 一、给使用者（同事）的操作说明

### 1. 启动

1. 解压整个文件夹（不要只拷贝 exe）；
2. 双击 `FDE-Customer-Agent.exe`；
3. 会弹出一个黑色窗口，**请保持打开**；
4. 约 2 秒后自动打开浏览器：`http://127.0.0.1:8765/`；
5. 使用结束后，**关闭黑色窗口即可退出程序**。

> 重复双击不会报错：程序检测到已在运行，会直接帮你再打开一次页面。

### 2. 使用流程

1. 进入「模拟配置」页面；
2. 上传客户资料（支持 `txt` / `md` / `docx` / `pdf`）；
3. 选择客户角色、业务场景、难度、声音；
4. 点击「开始模拟对话」；
5. **你先开口说话**，页面会实时显示识别到的文字；
6. 说完后点击页面上的 **「我说完了，让客户回应」** 按钮；
7. 模拟客户才会说出下一句，并逐条推进资料内容。

### 3. 资料格式要求（重要）

要让模拟客户「一字不落」地说出资料里的台词，资料里必须用 `我：` 和 `客户：` 标注双方台词，例如：

```text
我：各位领导好，我是飞书工程师小王，今天给大家演示飞书和豆包。
客户：好的，你直接开始吧。
我：我们先看飞书的消息和云文档功能……
客户：我们公司现在文档比较分散，能解决吗？
```

也支持通话记录格式（带时间戳）：

```text
客户 00:00:41
喂？

我 00:00:43
喂，你好，江总吗？
```

- 资料中「我：」后面是**你要说的话**；
- 「客户：」后面是**模拟客户要说的话**（会逐字播放，不会改写）；
- 如果资料只是普通说明文、没有 `我：/客户：` 标记，客户会走 AI 动态交流模式。

### 4. 语音相关建议

- 建议使用 **Chrome 或 Edge** 浏览器；
- 第一次使用请允许**麦克风权限**；
- **强烈建议佩戴耳机**：外放时音箱声音会被麦克风拾取（回音），可能影响识别；
- 调用 AI 接口需要**能访问外网**。

---

## 二、系统要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows 10 / 11（64 位） |
| Python | **不需要安装**（已内置在 exe 中） |
| Node.js | **不需要安装**（前端页面已内置） |
| 其他依赖 | **不需要**（已内置所有库与 VC 运行库） |
| 网络 | 需要能访问外网（调用大模型与语音合成） |
| 浏览器 | Chrome / Edge（推荐） |

---

## 三、文件夹内容说明

```text
FDE-AI客户模拟中心/
├── FDE-Customer-Agent.exe   主程序（约 26 MB，内置运行环境）
├── .env                    配置文件（含 API Key，请勿外发）
├── README.md               本说明文档
├── 使用说明.txt             简版说明
├── data/                   运行数据（对话历史、上传资料缓存）
├── audio/                  录音与音频文件
└── logs/                   运行日志（排查问题用）
```

`data`、`audio`、`logs` 三个目录会在首次运行时自动创建。

> ⚠️ 请连同 `.env` 一起复制整个文件夹；只拷贝 exe 会导致无法调用 AI 接口。

---

## 四、配置文件 `.env` 说明

用记事本打开 exe 同目录的 `.env`，修改后保存并重启程序即可。

```ini
# 大模型配置（必填）
LLM_API_KEY=你的_KEY
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-v4-flash

# 语音识别（可选；不配置则使用浏览器内置语音识别）
STT_API_KEY=
STT_BASE_URL=
STT_MODEL=whisper-1

# 语音合成（豆包/火山引擎，必填才有真人语音）
TTS_API_KEY=你的_KEY
TTS_APPID=                       # 旧版控制台需要，新版留空

# 服务端口
HOST=127.0.0.1
PORT=8765

# 空闲超时（秒）：长时间不说话的自动结束时间
CONVERSATION_TIMEOUT_S=600
```

如果 `.env` 丢失，程序首次运行会自动生成一份模板并用记事本打开，填写 Key 后重启即可。

---

## 五、常见问题（FAQ）

**Q1：双击后页面打不开？**
看黑色窗口是否有报错；确认端口 8765 没有被其他程序占用（程序自身会检测重复启动）。

**Q2：第一次启动比较慢？**
正常现象。单文件 exe 需要自解压，约 3~8 秒。

**Q3：客户一直不回应？**
确认页面已显示识别到的文字，然后点击「我说完了，让客户回应」按钮；如果资料没有 `我：/客户：` 标记，则不会进入逐字应答模式。

**Q4：系统好像收到了自己说的话（回音）？**
是音箱外放被麦克风拾取导致的。请佩戴耳机，并确保使用最新版本（已内置播放状态门控与回音过滤）。

**Q5：说话中途被打断？**
当前版本已关闭自动回应，只有点击按钮才会让客户开口。若仍出现异常，请提交 `logs/backend.log` 排查。

**Q6：想换 API Key 或模型？**
编辑 `.env` 中对应配置，保存后关闭黑窗口重新启动。

**Q7：杀毒软件报警？**
PyInstaller 打包的单文件 exe 可能被误报，添加信任即可。

---

## 六、开发与重新打包（开发者）

### 目录结构

```text
fde-customer-agent/
├── backend/           FastAPI 后端
│   ├── agents/        Customer Agent / Conversation Agent / FDE 评分
│   ├── services/      LLM / STT / TTS / VAD / 音频 / 解析器 / RAG
│   ├── prompts/       customer_system.txt（客户人设）、fde_evaluation.txt（评分指令）
│   ├── knowledge/     产品知识库
│   ├── models/        数据结构（客户、场景、对话、评分）
│   ├── tests/         pytest 测试（默认全部离线运行）
│   └── app.py         入口（同时提供前端静态资源）
├── frontend/          React + TypeScript + Vite 前端
│   └── src/
│       ├── pages/     页面（模拟配置、实时对话、历史、分析、设置等）
│       ├── hooks/     useAudio（语音识别/电平）、useWebSocket（对话通道）
│       ├── utils/     format / audio / scriptMatch 公共工具
│       └── services/  api.ts（REST 封装）
├── dist/              打包产物
├── release/           发布包（exe + .env + 说明文档）
└── README.md
```

> 前端「设置」页为**只读**：展示当前生效的 LLM / STT / TTS / VAD 与服务参数（API Key 已脱敏），修改请编辑 `backend/.env` 后重启后端。

### 开发运行

```powershell
# 后端（默认 http://127.0.0.1:8765）
cd backend
.venv\Scripts\python.exe app.py

# 前端（开发模式，默认 http://localhost:3000）
cd frontend
npm run dev
```

### 前端打包

```powershell
cd frontend
npm run build          # 先 tsc 类型检查，产物输出到 frontend/dist
```

### 测试

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests -q
```

- 单元测试默认**不访问外部服务**：`tests/conftest.py` 会把 LLM Provider 换成固定回复的假实现，没配 Key 也能全绿；
- 标了 `integration` 的延迟基准测试（真实调用 LLM / STT / TTS）默认跳过，需要实测时执行：

```powershell
$env:RUN_INTEGRATION=1; .venv\Scripts\python.exe -m pytest tests -q
```

### 打包 exe

```powershell
cd fde-customer-agent
backend\.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --onefile ^
  --name "FDE-Customer-Agent" ^
  --add-data "frontend/dist;frontend_dist" ^
  --add-data "backend/prompts;prompts" ^
  --add-data "backend/knowledge;knowledge" ^
  --add-data "backend/.env.example;." ^
  --add-data "README.md;." ^
  --paths backend ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.lifespan.on ^
  --hidden-import websockets.legacy ^
  --hidden-import websockets.legacy.server ^
  --hidden-import multipart ^
  --hidden-import python_multipart ^
  --copy-metadata openai --copy-metadata httpx --copy-metadata pydantic ^
  --copy-metadata fastapi --copy-metadata starlette --copy-metadata websockets ^
  backend/app.py
```

打包完成后：
- exe 位于 `dist\FDE-Customer-Agent.exe`；
- 发布包位于 `release\FDE-AI客户模拟中心\`，可直接压缩发给同事。

### 主要接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/config` | 当前生效配置（Key 脱敏），供设置页只读展示 |
| `GET /api/customers` | 客户角色列表 |
| `POST /api/custom/customer` | 用自定义资料创建客户角色 |
| `GET /api/scenarios` | 业务场景列表 |
| `GET /api/voices` | 声音列表 |
| `GET /api/voices/recommend` | 按客户/场景推荐声音 |
| `POST /api/voices/preview` | 声音试听（返回 hex 编码 WAV） |
| `POST /api/upload/material` | 上传资料并解析台词（`txt/md/docx/pdf`） |
| `GET /api/history` | 历史记录（含评分与逐句对话） |
| `GET /api/evaluation/{session_id}` | 单次会话评分 |
| `GET /api/latency/stats` | 全局延迟统计（p50/p90/p95/p99、SLA） |
| `GET /api/latency/session/{session_id}` | 单次会话延迟记录 |
| `GET /api/knowledge/categories` | 知识库分类 |
| `GET /api/knowledge/items` | 知识库条目 |
| `GET /api/knowledge/item/{item_id}` | 知识库单条详情 |
| `GET /api/knowledge/search?q=` | 知识库检索（RAG） |
| `POST /api/knowledge/retrieve` | 按上下文检索知识片段 |
| `GET /api/knowledge/stats` | 知识库统计 |
| `GET /api/readme` | 本说明文档内容 |
| `WS /ws/conversation` | 实时对话 WebSocket |

---

## 七、版本记录

| 版本 | 内容 |
| --- | --- |
| 1.0.0 | 首个完整版本：实时语音陪练、资料逐字应答、回音过滤、手动确认应答、单文件 exe 打包 |
| 1.1.0 | 代码整理：合并重复的 LLM Provider、统一对话与评分的公共流程、抽离前端公共工具；修正评分类异常兜底与 WebSocket 断开报错；看板/分析/历史改为真实统计不再使用假数据；设置页改为只读展示后端配置；测试默认离线运行 |

---

有任何问题或改进建议，欢迎随时反馈。
