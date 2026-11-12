"""FDE AI 客户模拟中心 - FastAPI 入口（REST + WebSocket + 前端静态资源）"""

import asyncio
import csv
import hashlib
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from agents.conversation_agent import ConversationAgent
from agents.customer_agent import parse_script_pairs
from agents.fde_analyzer import FDEAnalyzer
from config.settings import settings
from models.conversation import CustomerStatus
from models.customer import PRESET_CUSTOMERS, CustomerProfile
from models.scenario import PRESET_SCENARIOS
from services.audio.manager import AudioManager
from services.parser.scenario_parser import ScenarioParser
from services.rag.retriever import get_retriever
from services.tts.precache import ensure_precache_task
from services.tts.provider import create_tts_provider

logger = logging.getLogger(__name__)

HISTORY_LIMIT = 200          # 内存中保留的历史记录条数上限
AUDIO_CHUNK_BYTES = 3200     # ~100ms / 16kHz / 16bit 单声道

# 全局状态
conversation_history: list[dict] = []
custom_customers: dict[str, dict] = {}

retriever = get_retriever()


# ========== 应用初始化 ==========

def _setup_logging() -> Path:
    """控制台 + 文件双输出。"""
    settings.LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_file = settings.LOGS_DIR / "backend.log"

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    fmt = logging.Formatter(
        "%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    for handler in (logging.StreamHandler(), logging.FileHandler(str(log_file), encoding="utf-8")):
        handler.setFormatter(fmt)
        root.addHandler(handler)
    return log_file


@asynccontextmanager
async def lifespan(app: FastAPI):
    log_file = _setup_logging()
    logger.info(f"FDE Customer Agent 服务启动 (日志文件: {log_file})")
    yield
    logger.info("FDE Customer Agent 服务关闭")


app = FastAPI(title="FDE Customer Agent", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    """兜底异常处理器，防止未捕获异常导致服务崩溃。"""
    logger.error(f"未捕获异常 [{request.method} {request.url.path}]: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "服务器内部错误，请稍后重试", "code": 500},
    )


# ========== 工具函数 ==========

def _decode_text(content: bytes) -> str:
    """尽量正确地把上传文件字节解码成文本。"""
    if content.startswith((b"\xff\xfe", b"\xfe\xff")):
        return content.decode("utf-16", errors="replace")
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _extract_text(filename: str, content: bytes) -> str:
    """从 txt/md/docx/pdf 中提取纯文本。"""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("txt", "md", "docx", "pdf"):
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: .{ext}，支持 TXT / MD / DOCX / PDF",
        )

    if ext in ("txt", "md"):
        return _decode_text(content)

    if ext == "docx":
        try:
            import docx

            document = docx.Document(BytesIO(content))
            parts = [p.text for p in document.paragraphs]
            for table in document.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text.strip():
                            parts.append(cell.text)
            return "\n".join(parts)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"DOCX 解析失败: {e}")

    try:
        import PyPDF2

        reader = PyPDF2.PdfReader(BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF 解析失败: {e}")


def _evaluation_payload(report) -> dict:
    return {
        "total_score": report.total_score,
        "dimensions": [
            {"name": d.name, "score": d.score, "comment": d.comment}
            for d in report.dimensions
        ],
        "strengths": report.strengths,
        "weaknesses": report.weaknesses,
        "summary": report.summary,
    }


def _build_history_item(conversation: ConversationAgent, stats: dict, report) -> dict:
    """构建一条历史记录（含评分与逐句对话）。"""
    customer_agent = conversation.customer_agent
    return {
        "session_id": conversation.session_id,
        "customer_id": customer_agent.customer.id,
        "customer_name": customer_agent.customer.name,
        "scenario_id": customer_agent.scenario.id,
        "scenario_name": customer_agent.scenario.name,
        "difficulty": customer_agent.memory.difficulty,
        "duration_seconds": stats["duration_seconds"],
        "total_turns": stats["total_turns"],
        "avg_ttfa_ms": stats["avg_ttfa_ms"],
        "sla_compliance_pct": stats["sla_compliance_pct"],
        "total_score": report.total_score,
        "created_at": conversation.start_time.isoformat() if conversation.start_time else None,
        "evaluation": _evaluation_payload(report),
        "transcripts": [
            {"role": turn.role, "text": turn.content, "timestamp": turn.timestamp}
            for turn in customer_agent.memory.turns
        ],
    }


def _persist_session_artifacts(conversation: ConversationAgent) -> None:
    """把 AI 模拟对话记录落盘（JSON + 带 AI_SIMULATION 标识的 TXT）。"""
    try:
        manager = AudioManager()
        turns = [
            {"role": turn.role, "content": turn.content, "timestamp": turn.timestamp}
            for turn in conversation.customer_agent.memory.turns
        ]
        manager.save_conversation_log(conversation.session_id, turns)

        lines = ["=== AI 模拟交流 ==="]
        for turn in conversation.customer_agent.memory.turns:
            label = "FDE" if turn.role == "user" else "AI客户"
            lines.append(f"{label}：{turn.content}")
        manager.save_transcript(conversation.session_id, "\n".join(lines))
        logger.info(f"[归档] 会话 {conversation.session_id} 对话记录已保存 (turns={len(turns)})")
    except Exception as e:
        logger.warning(f"[归档] 会话记录保存失败: {e}", exc_info=True)


async def _finish_conversation(conversation: ConversationAgent) -> dict:
    """结束一轮会话：统计 → 评分 → 入库 → 归档，返回给前端的事件。"""
    stats = conversation.stop()

    report = await FDEAnalyzer().analyze(conversation.customer_agent.memory)
    conversation_history.append(_build_history_item(conversation, stats, report))
    if len(conversation_history) > HISTORY_LIMIT:
        del conversation_history[:-HISTORY_LIMIT]

    _persist_session_artifacts(conversation)
    return {
        "type": "conversation_end",
        "stats": stats,
        "evaluation": _evaluation_payload(report),
    }


async def _relay(websocket: WebSocket, events: AsyncIterator[dict]) -> None:
    """把 Agent 产生的事件转发到前端（音频走二进制帧，其余走 JSON）。"""
    async for event in events:
        if event["type"] == "audio":
            await websocket.send_bytes(event["data"])
        else:
            await websocket.send_json(event)


def _mask(value: str) -> str:
    """API Key 脱敏展示。"""
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 6}{value[-4:]}"


# ========== REST API ==========

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "FDE Customer Agent"}


@app.get("/api/readme")
async def get_readme():
    """返回内置 README（优先 exe / 项目目录，其次打包资源）。"""
    for path in (settings.APP_DIR / "README.md", settings.RESOURCE_DIR / "README.md"):
        if path.exists():
            return {
                "content": path.read_text(encoding="utf-8", errors="replace"),
                "path": str(path),
            }
    return {"content": "# 使用说明\n\n未找到 README.md 文件。", "path": ""}


@app.get("/api/config")
async def get_config():
    """返回当前生效的配置（API Key 脱敏），供设置页只读展示。"""
    env_file = settings.APP_DIR / ".env"
    return {
        "env_file": str(env_file),
        "env_exists": env_file.exists(),
        "llm": {
            "base_url": settings.LLM_BASE_URL,
            "model": settings.LLM_MODEL,
            "api_key": _mask(settings.LLM_API_KEY),
            "configured": bool(settings.LLM_API_KEY),
        },
        "stt": {
            "base_url": settings.STT_BASE_URL or settings.LLM_BASE_URL,
            "model": settings.STT_MODEL,
            "api_key": _mask(settings.STT_API_KEY),
            "configured": bool(settings.STT_API_KEY),
        },
        "tts": {
            "base_url": settings.TTS_BASE_URL,
            "model": settings.TTS_MODEL,
            "api_key": _mask(settings.TTS_API_KEY),
            "appid": _mask(settings.TTS_APPID),
            "configured": bool(settings.TTS_API_KEY),
        },
        "server": {
            "host": settings.HOST,
            "port": settings.PORT,
            "conversation_timeout_s": settings.CONVERSATION_TIMEOUT_S,
        },
        "vad": {
            "silence_duration_ms": settings.VAD_SILENCE_DURATION_MS,
            "min_speech_duration_ms": settings.VAD_MIN_SPEECH_DURATION_MS,
            "max_speech_duration_ms": settings.VAD_MAX_SPEECH_DURATION_MS,
        },
    }


@app.get("/api/customers")
async def get_customers():
    return [
        {
            "id": c.id,
            "name": c.name,
            "company": c.company,
            "position": c.position,
            "industry": c.industry,
            "personality": c.personality,
            "technical_level": c.technical_level,
            "pain_points": c.pain_points,
            "concerns": c.concerns,
            "avatar_emoji": c.avatar_emoji,
        }
        for c in PRESET_CUSTOMERS
    ]


@app.get("/api/scenarios")
async def get_scenarios():
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "feishu_products": s.feishu_products,
            "doubao_products": s.doubao_products,
            "tags": s.tags,
        }
        for s in PRESET_SCENARIOS
    ]


@app.get("/api/voices")
async def get_voices():
    voices = await create_tts_provider().get_voices()
    return [
        {"id": v.id, "name": v.name, "description": v.description, "tags": v.tags}
        for v in voices
    ]


def _voice_recommendation(gender: str, age: int) -> dict:
    tts = create_tts_provider()
    voice_id = tts.recommend_voice(gender, age)
    voice = getattr(tts, "VOICES", {}).get(voice_id)
    return {"voice_id": voice_id, "voice_name": voice.name if voice else ""}


@app.post("/api/voices/preview")
async def preview_voice(data: dict):
    voice_id = data.get("voice_id") or "alloy"
    text = data.get("text") or "你好，我今天主要想了解一下你们飞书和豆包企业版这边能够解决我们什么问题。"
    audio = await create_tts_provider().preview(text, voice_id)
    return {"audio": audio.hex()}


@app.get("/api/voices/recommend")
async def get_voice_recommendation(gender: str = "male", age: int = 30):
    return _voice_recommendation(gender, age)


@app.post("/api/upload/material")
async def upload_material(file: UploadFile = File(...)):
    filename = file.filename or "unknown"
    content = await file.read()
    text = _extract_text(filename, content)

    if not text.strip():
        raise HTTPException(status_code=400, detail="文件内容为空或无法解析出文本")

    scenario = ScenarioParser().parse(text, filename)

    # 同名内容也生成稳定 ID，同时把原始文件落盘，便于排查“新资料未生效”问题
    material_id = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
    saved_path = ""
    try:
        upload_dir = settings.DATA_DIR / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)
        target = upload_dir / f"{material_id}_{Path(filename).name}"
        target.write_bytes(content)
        saved_path = str(target)
    except Exception as e:
        logger.warning(f"[上传] 原始文件保存失败: {e}")

    # 把资料中的“我：/客户：”逐句配对返回给前端，供其做字符匹配
    script_lines = [
        {"index": i, "fde": fde, "customer": customer}
        for i, (fde, customer) in enumerate(parse_script_pairs(text))
        if customer.strip()
    ]
    logger.info(
        f"[上传] 文件={filename!r}, material_id={material_id}, text_len={len(text)}, "
        f"script_lines={len(script_lines)}, saved={saved_path!r}"
    )

    return {
        "filename": filename,
        "material_id": material_id,
        "parsed": True,
        "is_script": bool(script_lines),
        "script_lines": script_lines,
        "text": text,                 # 完整文本，前端会通过 WebSocket 原样回传
        "text_preview": text[:500],   # 仅用于前端预览
        "scenario": {
            "company_background": scenario.company_background,
            "industry": scenario.industry,
            "company_size": scenario.company_size,
            "pain_points": scenario.pain_points,
            "goals": scenario.goals,
            "concerns": scenario.concerns,
            "requirements": scenario.requirements,
            "known_facts": scenario.known_facts[:10],
        },
    }


@app.get("/api/history")
async def get_history():
    return conversation_history[-50:]


@app.get("/api/evaluation/{session_id}")
async def get_evaluation(session_id: str):
    for item in conversation_history:
        if item.get("session_id") == session_id:
            return item.get("evaluation", {})
    raise HTTPException(status_code=404, detail="未找到该对话记录")


@app.get("/api/latency/stats")
async def get_latency_stats():
    """所有会话的延迟汇总。"""
    log_dir = settings.DATA_DIR / "latency_logs"
    if not log_dir.exists():
        return {"total_sessions": 0, "summaries": []}

    summaries = []
    for path in sorted(log_dir.glob("summary_*.json")):
        try:
            summaries.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            continue
    return {"total_sessions": len(summaries), "summaries": summaries[-20:]}


@app.get("/api/latency/session/{session_id}")
async def get_session_latency(session_id: str):
    """某会话的延迟明细（CSV）与汇总（JSON）。"""
    log_dir = settings.DATA_DIR / "latency_logs"
    result: dict[str, Any] = {}

    summary_file = log_dir / f"summary_{session_id}.json"
    if summary_file.exists():
        try:
            result["summary"] = json.loads(summary_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    csv_file = log_dir / f"latency_{session_id}.csv"
    if csv_file.exists():
        try:
            with open(csv_file, "r", encoding="utf-8") as f:
                result["records"] = [
                    {
                        "timestamp": float(row.get("timestamp", 0)),
                        "vad_ms": float(row.get("vad_ms", 0)),
                        "stt_ms": float(row.get("stt_ms", 0)),
                        "llm_first_token_ms": float(row.get("llm_first_token_ms", 0)),
                        "tts_first_audio_ms": float(row.get("tts_first_audio_ms", 0)),
                        "total_ttfa_ms": float(row.get("total_ttfa_ms", 0)),
                        "above_sla": row.get("above_sla", "0") == "1",
                    }
                    for row in csv.DictReader(f)
                ]
        except Exception:
            pass

    if not result:
        raise HTTPException(status_code=404, detail="未找到该会话的延迟数据")
    return result


# ========== 知识库 RAG API ==========

@app.get("/api/knowledge/stats")
async def get_knowledge_stats():
    return retriever.get_stats()


@app.get("/api/knowledge/categories")
async def get_knowledge_categories():
    return retriever.get_categories()


@app.get("/api/knowledge/items")
async def get_knowledge_items(category: str = ""):
    return retriever.get_items_by_category(category) if category else retriever.get_all_items()


@app.get("/api/knowledge/item/{item_id}")
async def get_knowledge_item(item_id: str):
    item = retriever.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="未找到该知识条目")
    return item


@app.get("/api/knowledge/search")
async def search_knowledge(q: str = "", category: str = "", top_k: int = 10):
    if not q.strip():
        return []
    return retriever.search(q, category=category, top_k=top_k)


@app.post("/api/knowledge/retrieve")
async def retrieve_knowledge(data: dict):
    """RAG 检索 - 返回格式化的 LLM 上下文。"""
    query = data.get("query", "")
    top_k = data.get("top_k", 3)
    if not query.strip():
        return {"context": "", "results": []}
    return {
        "context": retriever.retrieve_for_llm(
            query, top_k=top_k, max_chars=data.get("max_chars", 1500)
        ),
        "results": retriever.search(query, top_k=top_k),
    }


# ========== 自定义客户 ==========

@app.post("/api/custom/customer")
async def create_custom_customer(data: dict):
    """创建自定义客户，返回客户对象 + 推荐声音。"""
    import uuid

    customer_id = f"custom_{uuid.uuid4().hex[:8]}"
    gender = data.get("gender", "male")
    age = int(data.get("age", 30) or 30)

    customer_info = {
        "id": customer_id,
        "name": data.get("name", "自定义客户"),
        "company": data.get("company", ""),
        "gender": gender,
        "age": age,
        "position": data.get("position", ""),
        "industry": data.get("industry", ""),
        "personality": data.get("personality", "友好"),
        "age_range": f"{age - 5}-{age + 5}",
        "technical_level": "中",
        "communication_style": "自然交流",
        "business_goal": "了解产品和服务",
        "pain_points": [],
        "concerns": [],
        "budget_level": "中",
        "decision_power": "建议",
        "feishu_knowledge": "低",
        "doubao_knowledge": "低",
        "avatar_emoji": "👤",
    }
    custom_customers[customer_id] = customer_info

    return {"customer": customer_info, "recommended_voice": _voice_recommendation(gender, age)}


def _build_customer(customer_id: str) -> CustomerProfile:
    """按 ID 构建客户对象（自定义客户优先，其次预设）。"""
    if customer_id.startswith("custom_") and customer_id in custom_customers:
        data = custom_customers[customer_id]
        fields = {k: data[k] for k in data if k in CustomerProfile.__dataclass_fields__}
        return CustomerProfile(**fields)
    return next((c for c in PRESET_CUSTOMERS if c.id == customer_id), PRESET_CUSTOMERS[0])


# ========== WebSocket 实时对话 ==========

@app.websocket("/ws/conversation")
async def websocket_conversation(websocket: WebSocket):
    await websocket.accept()
    conversation: ConversationAgent | None = None
    audio_buffer = bytearray()
    idle_check_interval = 5

    try:
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive(), timeout=idle_check_interval
                )
            except asyncio.TimeoutError:
                # 空闲超时：用户长时间无输入则自动结束并出分
                if conversation and conversation.is_idle_timeout:
                    logger.info(f"对话空闲超时，自动结束 (session: {conversation.session_id})")
                    await websocket.send_json({
                        "type": "status", "status": "idle_timeout",
                        "message": "对话已空闲超时，自动结束",
                    })
                    if conversation.is_running:
                        await websocket.send_json(await _finish_conversation(conversation))
                    conversation = None
                continue

            if data.get("type") == "websocket.disconnect":
                # 客户端已断开：直接跳出循环，交给 finally 收尾
                break

            if "text" in data:
                msg = json.loads(data["text"])
                msg_type = msg.get("type", "")

                # 任何消息（含前端心跳 activity）都刷新活动时间，
                # 避免用户长时间朗读资料时被误判为空闲超时。
                if conversation is not None:
                    conversation.last_activity_time = time.time()

                if msg_type == "start":
                    customer_id = msg.get("customer_id", "it-director")
                    scenario_id = msg.get("scenario_id", "feishu-doubao-combined")
                    difficulty = msg.get("difficulty", 3)
                    voice_id = msg.get("voice_id", "alloy")
                    uploaded_text = msg.get("uploaded_text", "") or ""
                    uploaded_filename = msg.get("uploaded_filename", "") or "uploaded.txt"

                    logger.info(
                        f"[WS Start] customer_id={customer_id}, scenario_id={scenario_id}, "
                        f"uploaded_filename={uploaded_filename!r}, text_len={len(uploaded_text)}"
                    )

                    customer = _build_customer(customer_id)
                    scenario = next(
                        (s for s in PRESET_SCENARIOS if s.id == scenario_id), PRESET_SCENARIOS[0]
                    )

                    conversation = ConversationAgent(customer, scenario, difficulty)
                    conversation.current_voice_id = voice_id
                    if uploaded_text:
                        conversation.customer_agent.set_uploaded_text(uploaded_text, uploaded_filename)
                        # 只有通话记录剧本才预合成；客户材料动态交流不做预合成
                        if conversation.customer_agent.is_script_mode:
                            ensure_precache_task(uploaded_text, voice_id)

                    # 本产品流程：客户不做开场白，由 FDE 先发言
                    conversation.is_running = True
                    conversation.start_time = datetime.now()
                    conversation.last_activity_time = time.time()
                    conversation.status = CustomerStatus.LISTENING

                    await websocket.send_json({
                        "type": "session_id", "session_id": conversation.session_id,
                    })
                    await websocket.send_json({"type": "status", "status": "listening"})

                elif msg_type == "stop" and conversation:
                    await websocket.send_json(await _finish_conversation(conversation))

                elif msg_type == "barge_in" and conversation:
                    conversation.handle_barge_in()
                    await websocket.send_json({"type": "status", "status": "listening"})

                elif msg_type == "user_text" and conversation:
                    text = (msg.get("text") or "").strip()
                    script_index = msg.get("script_index")
                    if script_index is not None:
                        try:
                            script_index = int(script_index)
                        except (TypeError, ValueError):
                            script_index = None
                    if text:
                        logger.info(
                            f"[WS] user_text: script_index={script_index}, "
                            f"len={len(text)}, head={text[:40]!r}"
                        )
                        await _relay(
                            websocket,
                            conversation.process_text_input(text, script_index=script_index),
                        )

            elif "bytes" in data:
                if not (conversation and conversation.is_running):
                    continue

                chunk = data["bytes"]
                # 客户还在说话时收到音频 → 视为用户插话
                if conversation.is_speaking_tts:
                    conversation.handle_barge_in()
                    await websocket.send_json({"type": "status", "status": "listening"})
                    audio_buffer.clear()

                audio_buffer.extend(chunk)
                if len(audio_buffer) < AUDIO_CHUNK_BYTES:
                    continue

                audio_data = bytes(audio_buffer)
                audio_buffer.clear()
                await _relay(websocket, conversation.process_user_input(audio_data))

    except WebSocketDisconnect:
        session = conversation.session_id if conversation else "unknown"
        logger.info(f"WebSocket 断开连接 (session: {session})")
    except asyncio.TimeoutError:
        logger.error("WebSocket 处理超时")
        try:
            await websocket.send_json({"type": "error", "message": "处理超时，请重试"})
        except Exception:
            pass
    except Exception as e:
        logger.error(f"WebSocket 错误: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": f"对话出错: {str(e)[:100]}"})
        except Exception:
            pass
    finally:
        if conversation and conversation.is_running:
            try:
                conversation.stop()
            except Exception:
                pass


# ========== 前端静态资源（打包 exe 后与后端同端口提供） ==========

_frontend_dist = settings.FRONTEND_DIST_DIR
if _frontend_dist.exists():
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        if full_path.startswith(("api/", "ws/")):
            return JSONResponse(status_code=404, content={"error": "接口不存在"})
        candidate = _frontend_dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        index_file = _frontend_dist / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        return JSONResponse(status_code=404, content={"error": "前端资源未找到"})

    logger.info(f"前端静态资源目录: {_frontend_dist}")
else:
    logger.warning(f"未找到前端构建产物: {_frontend_dist}（请先执行 npm run build）")


# ========== 启动入口 ==========

def _port_in_use(port: int) -> bool:
    """检测端口是否已被占用（用于避免重复双击时启动失败）。"""
    import socket

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", port))
            return False
    except OSError:
        return True


def _prepare_console() -> None:
    """控制台统一 UTF-8，避免同事电脑上中文乱码。"""
    import sys

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        import ctypes

        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleTitleW("FDE AI 客户模拟中心 - 关闭此窗口即退出")
    except Exception:
        pass


def _ensure_env_file() -> None:
    """打包后的首次运行：.env 缺失时从内置模板生成并打开。"""
    import os
    import shutil
    import sys

    if not getattr(sys, "frozen", False):
        return

    env_path = settings.APP_DIR / ".env"
    example_path = settings.RESOURCE_DIR / ".env.example"
    if env_path.exists() or not example_path.exists():
        return

    try:
        shutil.copyfile(example_path, env_path)
        print("=" * 60, flush=True)
        print("  首次运行：已生成配置文件 .env", flush=True)
        print(f"  请填写 API Key 后重新启动: {env_path}", flush=True)
        print("=" * 60, flush=True)
        try:
            os.startfile(str(env_path))  # 用记事本打开
        except Exception:
            pass
        time.sleep(2.0)
    except Exception as e:
        print(f"  创建 .env 失败: {e}", flush=True)


def main() -> None:
    import sys
    import threading
    import webbrowser

    import uvicorn

    url = f"http://127.0.0.1:{settings.PORT}/"
    _prepare_console()
    _ensure_env_file()

    if _port_in_use(settings.PORT):
        print("=" * 60, flush=True)
        print("  检测到程序已经在运行，直接为你打开页面…", flush=True)
        print(f"  访问地址: {url}", flush=True)
        print("=" * 60, flush=True)
        webbrowser.open(url)
        time.sleep(1.5)
        raise SystemExit(0)

    print("=" * 60, flush=True)
    print("  FDE AI 客户模拟中心 已启动", flush=True)
    print(f"  访问地址: {url}", flush=True)
    print("  关闭此窗口即退出程序", flush=True)
    print("=" * 60, flush=True)
    threading.Thread(
        target=lambda: (time.sleep(2.0), webbrowser.open(url)), daemon=True
    ).start()

    # 桌面版只在本机使用：固定绑定 127.0.0.1，避免 Windows 防火墙弹窗
    host = settings.HOST
    if getattr(sys, "frozen", False) and host in ("0.0.0.0", "::", ""):
        host = "127.0.0.1"
    uvicorn.run(app, host=host, port=settings.PORT)


if __name__ == "__main__":
    main()
