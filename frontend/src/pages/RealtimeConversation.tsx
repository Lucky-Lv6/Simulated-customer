import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Square,
  Volume2,
  MessageSquare,
  Clock,
  Zap,
  AlertTriangle,
  Loader2,
  Phone,
  TrendingUp,
  Activity,
  ChevronDown,
  ChevronUp,
  Send,
} from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAudio } from '../hooks/useAudio';
import { fetchCustomers, fetchScenarios } from '../services/api';
import { matchScriptLine, stripEchoPrefix } from '../utils/scriptMatch';
import type { CustomerProfile, Scenario, CustomerStatusType, ScriptLine } from '../types';

const statusConfig: Record<CustomerStatusType, { label: string; color: string; dotClass: string }> = {
  idle: { label: '等待中', color: '#64748b', dotClass: 'offline' },
  listening: { label: '聆听中', color: '#3b82f6', dotClass: 'processing' },
  thinking: { label: '思考中', color: '#8b5cf6', dotClass: 'processing' },
  speaking: { label: '回复中', color: '#10b981', dotClass: 'success' },
  idle_timeout: { label: '已超时', color: '#f59e0b', dotClass: 'warning' },
};

export default function RealtimeConversation() {
  const navigate = useNavigate();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<{
    customer_id: string;
    scenario_id: string;
    difficulty: number;
    voice_id: string;
    uploaded_text?: string;
    uploaded_filename?: string;
    uploaded_material_id?: string;
    uploaded_script_lines?: ScriptLine[];
  } | null>(null);

  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [conversationActive, setConversationActive] = useState(false);
  const [bargeInEnabled, setBargeInEnabled] = useState(false);
  const [latencyPanelExpanded, setLatencyPanelExpanded] = useState(false);
  const [userInputText, setUserInputText] = useState('');
  const [canSend, setCanSend] = useState(false); // 用户是否可以发送消息
  const [localError, setLocalError] = useState<string | null>(null); // 本地错误（如麦克风权限）
  const speechStartedRef = useRef(false); // 防止重复启动语音识别
  const pendingUserTextRef = useRef('');   // 本轮累计的识别文本
  const fallbackTimerRef = useRef<number | null>(null); // 长停顿后的兜底发送定时器
  const nextScriptIndexRef = useRef(0);    // 下一句应匹配的资料序号
  const awaitingResponseRef = useRef(false); // 已提交用户发言，正在等客户回复
  const lastCustomerLineRef = useRef('');    // 客户最近一句台词（用于剥离回音）
  const [pendingRecognition, setPendingRecognition] = useState('');

  const ws = useWebSocket();
  const audio = useAudio();
  const wsStatusRef = useRef(ws.status);
  wsStatusRef.current = ws.status;
  const hasScriptLines = (config?.uploaded_script_lines?.length ?? 0) > 0;

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const resetPendingRecognition = useCallback(() => {
    clearFallbackTimer();
    pendingUserTextRef.current = '';
    setPendingRecognition('');
    awaitingResponseRef.current = false;
  }, [clearFallbackTimer]);

  /** 把本轮累计的识别文本发送给客户；matchedIndex 为资料中匹配到的序号 */
  const sendAccumulatedUserText = useCallback((matchedIndex?: number) => {
    if (awaitingResponseRef.current) return;
    const text = pendingUserTextRef.current.trim();
    clearFallbackTimer();
    pendingUserTextRef.current = '';
    setPendingRecognition('');
    if (!text) return;

    const scriptLines = config?.uploaded_script_lines || [];
    let scriptIndex = matchedIndex;
    if (scriptIndex === undefined && scriptLines.length > 0) {
      scriptIndex = nextScriptIndexRef.current;
    }
    if (scriptIndex !== undefined) {
      nextScriptIndexRef.current = scriptIndex + 1;
    }

    // 客户当前还在播放上一句时，先停掉当前音频，再提交本轮用户发言
    if (wsStatusRef.current === 'speaking') {
      ws.sendBargeIn();
      ws.stopPlayback();
    }
    awaitingResponseRef.current = true;
    setCanSend(false);
    ws.sendUserText(text, scriptIndex);
  }, [clearFallbackTimer, config, ws]);

  /** 收到一个语音识别片段：累计文本，并按资料台词做字符匹配 */
  const handleSpeechFragment = useCallback((fragment: string) => {
    if (awaitingResponseRef.current) return;
    if (wsStatusRef.current !== 'listening') return;
    // 客户语音正在播放或刚播放完（回音尾音）→ 直接忽略，避免“自己收到自己的声音”
    if (ws.isPlayingAudioRef.current) return;
    if (Date.now() - ws.lastPlaybackEndAtRef.current < 1200) return;
    const text = fragment.trim();
    if (!text) return;
    ws.sendActivity();

    let combined = (pendingUserTextRef.current + text).trim();
    const echo = lastCustomerLineRef.current;
    if (echo) {
      const stripped = stripEchoPrefix(combined, echo);
      if (stripped !== combined) {
        console.log('[回声过滤] 已剥离客户上一句回音:', echo.slice(0, 20));
        combined = stripped;
      }
    }
    pendingUserTextRef.current = combined;
    setPendingRecognition(combined);
    if (!combined) return;

    // ⚠️ 自动回应已停用：这里只做匹配检查与提示，
    // 客户不会自动说下一句；必须由用户点击“我说完了，让客户回应”按钮触发。
    const scriptLines = config?.uploaded_script_lines || [];
    const matched = scriptLines.length > 0
      ? matchScriptLine(combined, scriptLines, nextScriptIndexRef.current)
      : null;
    console.log(
      matched
        ? `[资料匹配] 本段已匹配到资料第${matched.index + 1}句 (${matched.score.toFixed(2)})，等待点击“我说完了”`
        : '[资料匹配] 本段暂未匹配到资料台词，等待点击“我说完了”',
    );
  }, [config, ws]);

  // Load config
  useEffect(() => {
    const saved = sessionStorage.getItem('simulation_config');
    if (!saved) {
      navigate('/simulation');
      return;
    }
    const parsed = JSON.parse(saved);
    setConfig(parsed);

    // Fetch customer and scenario details
    fetchCustomers()
      .then((data) => {
        const items = Array.isArray(data) ? data : [];
        const found = items.find((i: CustomerProfile) => i.id === parsed.customer_id);
        if (found) setCustomer(found);
      })
      .catch(() => setLocalError('客户列表加载失败，请确认后端服务是否正常'));

    fetchScenarios()
      .then((data) => {
        const items = Array.isArray(data) ? data : [];
        const found = items.find((i: Scenario) => i.id === parsed.scenario_id);
        if (found) setScenario(found);
      })
      .catch(() => setLocalError('场景列表加载失败，请确认后端服务是否正常'));
  }, [navigate]);

  // 资料更新后，重置匹配起点为第一句带「我」的台词
  useEffect(() => {
    const lines = config?.uploaded_script_lines || [];
    const first = lines.find((l) => l.fde && l.fde.trim());
    nextScriptIndexRef.current = first ? first.index : (lines[0]?.index ?? 0);
  }, [config]);

  // Auto-scroll transcripts
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ws.transcripts, ws.currentTranscript]);

  // 记录客户最近一句台词，用于剥离麦克风拾取到的回音
  useEffect(() => {
    const lastCustomer = [...ws.transcripts]
      .reverse()
      .find((t) => t.role === 'customer' && !t.isPartial);
    if (lastCustomer?.text) {
      lastCustomerLineRef.current = lastCustomer.text;
    }
  }, [ws.transcripts]);

  useEffect(() => {
    if (ws.evaluation && ws.stats) {
      sessionStorage.setItem('conversation_result', JSON.stringify({
        evaluation: ws.evaluation,
        stats: ws.stats,
        transcripts: ws.transcripts,
      }));
      ws.disconnect();
      if (audio.isRecording) audio.stopRecording();
      resetPendingRecognition();
      setConversationActive(false);
      navigate('/conversation/result');
    }
  }, [ws.evaluation, ws.stats, navigate, ws, audio, resetPendingRecognition]);

  const handleStart = useCallback(async () => {
    if (!config) return;
    // 先检查麦克风权限
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 获取到权限后立即释放
      stream.getTracks().forEach(t => t.stop());
    } catch (err: any) {
      const msg = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        ? '麦克风权限被拒绝，请在浏览器地址栏左侧点击锁图标，开启麦克风权限后重试'
        : '无法访问麦克风: ' + (err.message || String(err));
      setLocalError(msg);
      return;
    }

    setConversationActive(true);
    setLocalError(null);
    speechStartedRef.current = false;
    resetPendingRecognition();
    const scriptLines = config?.uploaded_script_lines || [];
    const first = scriptLines.find((l) => l.fde && l.fde.trim());
    nextScriptIndexRef.current = first ? first.index : (scriptLines[0]?.index ?? 0);
    ws.clearError();
    ws.startConversation(config);
    // 用户手势中启动浏览器语音识别（Chrome 要求）
    const speechStarted = audio.startSpeechRecognition(
      handleSpeechFragment,
      () => {
        // 资料模式：不要因为检测到人声就自动打断，否则用户读到一半会被反复打断。
        // 只有动态模式才保留“检测到人声立即打断”的行为。
        if (hasScriptLines) return;
        if (wsStatusRef.current === 'speaking') {
          ws.sendBargeIn();
          ws.stopPlayback();
          setCanSend(false);
        }
      },
    );
    speechStartedRef.current = speechStarted;
  }, [config, ws, audio, handleSpeechFragment, resetPendingRecognition, hasScriptLines]);

  // AI 开场结束进入 listening 后开放文本/语音发送能力
  useEffect(() => {
    if (conversationActive && ws.status === 'listening') {
      // 客户回复结束、重新进入聆听态 → 允许下一轮发言
      awaitingResponseRef.current = false;
      setCanSend(true);
    }
  }, [conversationActive, ws.status]);

  // 会话进行中每 5 秒发一次心跳，避免长时间朗读资料被后端误判空闲超时
  useEffect(() => {
    if (!conversationActive) return;
    const timer = window.setInterval(() => {
      ws.sendActivity();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [conversationActive, ws.sendActivity]);

  // 监听AI回复完成（回到listening），允许用户再次说话
  useEffect(() => {
    if (conversationActive && ws.status === 'listening' && ws.transcripts.length > 0) {
      setCanSend(true);
    }
  }, [conversationActive, ws.status, ws.transcripts.length]);

  const handleStop = useCallback(() => {
    ws.stopConversation();
    audio.stopRecording();
    resetPendingRecognition();
    setConversationActive(false);
    setCanSend(false);
  }, [ws, audio, resetPendingRecognition]);

  const handleSendMessage = useCallback(() => {
    const text = userInputText.trim();
    if (!text || !conversationActive) return;
    setCanSend(false);
    setUserInputText('');
    const scriptLines = config?.uploaded_script_lines || [];
    if (scriptLines.length > 0) {
      const matched = matchScriptLine(text, scriptLines, nextScriptIndexRef.current);
      const scriptIndex = matched ? matched.index : nextScriptIndexRef.current;
      nextScriptIndexRef.current = scriptIndex + 1;
      ws.sendUserText(text, scriptIndex);
    } else {
      ws.sendUserText(text);
    }
  }, [userInputText, conversationActive, ws, config]);

  /** 用户手动确认“我说完了”，立即把累计文本发给客户 */
  const handleSendNow = useCallback(() => {
    const text = pendingUserTextRef.current.trim();
    if (!text) return;
    const scriptLines = config?.uploaded_script_lines || [];
    const matched = scriptLines.length > 0
      ? matchScriptLine(text, scriptLines, nextScriptIndexRef.current)
      : null;
    sendAccumulatedUserText(matched ? matched.index : undefined);
  }, [config, sendAccumulatedUserText]);

  const handleBargeIn = useCallback(() => {
    setBargeInEnabled((v) => !v);
    ws.sendBargeIn();
    ws.stopPlayback();
    setCanSend(false);
  }, [ws]);

  const status = statusConfig[ws.status];

  return (
    <div
      className="page-container"
      style={{
        maxWidth: 900,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        paddingBottom: 0,
      }}
    >
      {/* Top Info Bar */}
      <div
        className="card-glass"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 20,
          padding: '12px 20px',
          animation: 'fade-in 0.3s ease forwards',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'rgba(59,130,246,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.2rem',
            }}
          >
            {customer?.avatar_emoji || '🤖'}
          </div>
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>
              {customer?.name || 'AI客户'}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {customer?.position} @ {customer?.company}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {scenario && (
            <span className="badge badge-blue">{scenario.name}</span>
          )}
          {config?.uploaded_filename && (
            <span
              className="badge badge-green"
              title={`本次使用的资料：${config.uploaded_filename}${config.uploaded_material_id ? `（ID ${config.uploaded_material_id}）` : ''}`}
            >
              资料：{config.uploaded_filename}
              {config.uploaded_material_id ? ` #${config.uploaded_material_id}` : ''}
            </span>
          )}
          <span className="badge badge-purple">Lv{config?.difficulty || 3}</span>
          <span
            className={`status-dot ${status.dotClass}`}
            style={{ marginLeft: 4 }}
          />
          <span style={{ fontSize: '0.75rem', color: status.color, fontWeight: 500 }}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Error Message Banner */}
      {ws.errorMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 10,
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.2)',
            color: '#fca5a5',
            fontSize: '0.8125rem',
            marginBottom: 16,
            animation: 'fade-in 0.3s ease forwards',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{ws.errorMessage}</span>
          <button
            className="btn btn-ghost"
            onClick={() => ws.clearError()}
            style={{
              padding: '2px 8px',
              height: 'auto',
              fontSize: '0.7rem',
              color: '#94a3b8',
            }}
          >
            关闭
          </button>
        </div>
      )}

      {/* Local Error Banner (e.g. microphone permission denied) */}
      {localError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 10,
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.2)',
            color: '#fca5a5',
            fontSize: '0.8125rem',
            marginBottom: 16,
            animation: 'fade-in 0.3s ease forwards',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{localError}</span>
        </div>
      )}

      {/* Main Conversation Area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflow: 'hidden',
        }}
      >
        {/* Customer Avatar */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '20px 0',
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 20,
              background: ws.status === 'speaking'
                ? 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(6,182,212,0.2))'
                : 'rgba(20,27,45,0.8)',
              border: ws.status === 'speaking'
                ? '2px solid rgba(16,185,129,0.4)'
                : '2px solid rgba(148,163,184,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              transition: 'all 250ms ease',
              boxShadow: ws.status === 'speaking' ? '0 0 30px rgba(16,185,129,0.15)' : 'none',
            }}
          >
            {customer?.avatar_emoji || '🤖'}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: '0.8125rem',
              color: status.color,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {ws.status === 'thinking' && (
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            )}
            {ws.status === 'speaking' && (
              <Volume2 size={14} />
            )}
            {status.label}
          </div>
          {/* 语音识别状态 */}
          {conversationActive && audio.isSpeechRecognition && (
            <div
              style={{
                marginTop: 4,
                fontSize: '0.7rem',
                color: audio.speechError ? '#ef4444' : '#22c55e',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: audio.speechError ? '#ef4444' : '#22c55e',
                animation: audio.speechError ? 'none' : 'pulse 1.5s infinite',
              }} />
              {audio.speechError
                ? audio.speechError
                : audio.speechText
                  ? `已识别: ${audio.speechText}`
                  : '正在聆听...'}
            </div>
          )}
          {conversationActive && pendingRecognition && !audio.speechError && (
            <div
              style={{
                marginTop: 4,
                fontSize: '0.7rem',
                color: '#94a3b8',
                maxWidth: 460,
                textAlign: 'center',
                lineHeight: 1.5,
              }}
            >
              已识别 {pendingRecognition.length} 字：{pendingRecognition.slice(-60)}
              {config?.uploaded_script_lines?.length
                ? '（说完后点下方按钮，客户才会说下一句）'
                : ''}
            </div>
          )}
          {conversationActive && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSendNow}
              disabled={!pendingRecognition}
              style={{ marginTop: 8 }}
            >
              我说完了，让客户回应
            </button>
          )}
        </div>

        {/* Transcript Area */}
        <div
          className="card"
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            maxHeight: 300,
          }}
        >
          <div
            style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 8,
            }}
          >
            <MessageSquare size={14} />
            实时对话
          </div>
          {ws.transcripts.length === 0 && !ws.currentTranscript && (
            <div
              style={{
                textAlign: 'center',
                padding: 40,
                color: '#64748b',
                fontSize: '0.875rem',
              }}
            >
              {conversationActive ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', animation: 'pulse 1.5s infinite' }} />
                    <span style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                      {config?.uploaded_text
                        ? '请先开始你的介绍，AI客户将按上传资料逐字回应'
                        : '聆听中，请开始说话'}
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 8 }}>
                    点击下方按钮开始对话
                  </div>
                </div>
              )}
            </div>
          )}
          {ws.transcripts.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
              }}
            >
              {msg.role === 'customer' && (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: 'rgba(16,185,129,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8rem',
                    flexShrink: 0,
                  }}
                >
                  {customer?.avatar_emoji || '🤖'}
                </div>
              )}
              <div
                style={{
                  padding: '8px 14px',
                  borderRadius: 12,
                  background: msg.role === 'user'
                    ? 'rgba(59,130,246,0.15)'
                    : 'rgba(148,163,184,0.08)',
                  border: `1px solid ${
                    msg.role === 'user'
                      ? 'rgba(59,130,246,0.2)'
                      : 'rgba(148,163,184,0.08)'
                  }`,
                  fontSize: '0.875rem',
                  lineHeight: 1.5,
                  color: '#f1f5f9',
                }}
              >
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4 }}>
                  {msg.role === 'user' ? '你' : customer?.name || 'AI客户'}
                </div>
                {msg.text}
              </div>
              {msg.role === 'user' && (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: 'rgba(59,130,246,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8rem',
                    flexShrink: 0,
                  }}
                >
                  👤
                </div>
              )}
            </div>
          ))}
          {ws.currentTranscript && (
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignSelf: ws.currentTranscript.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                opacity: 0.7,
              }}
            >
              <div
                style={{
                  padding: '8px 14px',
                  borderRadius: 12,
                  background: ws.currentTranscript.role === 'user'
                    ? 'rgba(59,130,246,0.1)'
                    : 'rgba(148,163,184,0.05)',
                  border: '1px solid rgba(148,163,184,0.05)',
                  fontSize: '0.875rem',
                  lineHeight: 1.5,
                  color: '#94a3b8',
                  fontStyle: 'italic',
                }}
              >
                {ws.currentTranscript.text}
              </div>
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* 文本输入区域 */}
        {conversationActive && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '8px 0',
            }}
          >
            <textarea
              className="input"
              rows={2}
              placeholder="在此输入您要说的话..."
              value={userInputText}
              onChange={(e) => setUserInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) handleSendMessage();
                }
              }}
              disabled={!canSend}
              style={{
                flex: 1,
                resize: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.5,
                fontSize: '0.875rem',
                opacity: canSend ? 1 : 0.5,
              }}
            />
            <button
              className="btn btn-primary"
              onClick={handleSendMessage}
              disabled={!canSend || !userInputText.trim()}
              style={{
                alignSelf: 'flex-end',
                padding: '10px 16px',
                height: 'auto',
                borderRadius: 10,
                flexShrink: 0,
              }}
            >
              <Send size={16} />
            </button>
          </div>
        )}

        {/* Latency Monitor */}
        {ws.latency && (
          <div
            className="card-glass"
            style={{
              padding: '10px 16px',
              fontSize: '0.75rem',
              animation: 'fade-in 0.3s ease forwards',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <Clock size={14} style={{ color: '#64748b' }} />
              <span style={{ color: '#94a3b8' }}>TTFA:</span>
              <span
                style={{
                  fontWeight: 600,
                  color: ws.latency.above_sla ? '#ef4444' : '#10b981',
                }}
              >
                {ws.latency.total_ttfa_ms}ms
              </span>
              {ws.latency.above_sla && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: 'rgba(239,68,68,0.15)',
                    color: '#ef4444',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                  }}
                >
                  <AlertTriangle size={10} />
                  SLA超时
                </span>
              )}
              <span style={{ color: '#64748b' }}>|</span>
              <span style={{ color: '#94a3b8' }}>VAD: {ws.latency.vad_ms}ms</span>
              <span style={{ color: '#64748b' }}>|</span>
              <span style={{ color: '#94a3b8' }}>STT: {ws.latency.stt_ms}ms</span>
              <span style={{ color: '#64748b' }}>|</span>
              <span style={{ color: '#94a3b8' }}>LLM: {ws.latency.llm_first_token_ms}ms</span>
              <span style={{ color: '#64748b' }}>|</span>
              <span style={{ color: '#94a3b8' }}>TTS: {ws.latency.tts_first_audio_ms}ms</span>

              {/* 展开/折叠按钮 */}
              <button
                className="btn btn-ghost"
                onClick={() => setLatencyPanelExpanded(v => !v)}
                style={{
                  marginLeft: 'auto',
                  padding: '4px 8px',
                  height: 'auto',
                  fontSize: '0.7rem',
                  color: '#64748b',
                }}
              >
                {latencyPanelExpanded ? (
                  <><ChevronUp size={12} style={{ marginRight: 4 }} />隐藏详情</>
                ) : (
                  <><ChevronDown size={12} style={{ marginRight: 4 }} />延迟详情</>
                )}
              </button>
            </div>

            {/* 展开的延迟面板 */}
            {latencyPanelExpanded && (
              <div style={{ marginTop: 12, borderTop: '1px solid rgba(148,163,184,0.1)', paddingTop: 12 }}>
                {/* 历史趋势迷你图 */}
                {ws.latencyHistory.length > 1 && (
                  <div style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        fontSize: '0.7rem',
                        color: '#64748b',
                        marginBottom: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <TrendingUp size={10} />
                      TTFA 趋势 (最近 {ws.latencyHistory.length} 轮)
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: 2,
                        height: 40,
                      }}
                    >
                      {ws.latencyHistory.map((item, i) => {
                        const maxVal = Math.max(...ws.latencyHistory.map(h => h.total_ttfa_ms), 2000);
                        const heightPct = Math.min((item.total_ttfa_ms / maxVal) * 100, 100);
                        return (
                          <div
                            key={i}
                            title={`${item.total_ttfa_ms}ms${item.above_sla ? ' (SLA超时)' : ''}`}
                            style={{
                              flex: 1,
                              height: `${Math.max(heightPct, 5)}%`,
                              borderRadius: '2px 2px 0 0',
                              background: item.above_sla
                                ? 'rgba(239,68,68,0.6)'
                                : 'rgba(16,185,129,0.5)',
                              transition: 'height 200ms ease',
                              minWidth: 4,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 延迟统计信息 */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'rgba(148,163,184,0.05)',
                    }}
                  >
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>VAD</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>
                      {ws.latency.vad_ms}ms
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'rgba(148,163,184,0.05)',
                    }}
                  >
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>STT</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>
                      {ws.latency.stt_ms}ms
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'rgba(148,163,184,0.05)',
                    }}
                  >
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>LLM首Token</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>
                      {ws.latency.llm_first_token_ms}ms
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'rgba(148,163,184,0.05)',
                    }}
                  >
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>TTS首音频</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>
                      {ws.latency.tts_first_audio_ms}ms
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'rgba(148,163,184,0.05)',
                    }}
                  >
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>总TTFA</div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        color: ws.latency.above_sla ? '#ef4444' : '#10b981',
                      }}
                    >
                      {ws.latency.total_ttfa_ms}ms
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 对话结束后的延迟统计 */}
        {ws.latencyStats && !conversationActive && (
          <div
            className="card"
            style={{
              animation: 'fade-in 0.3s ease forwards',
            }}
          >
            <div
              style={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 12,
              }}
            >
              <Activity size={14} />
              延迟性能报告
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(148,163,184,0.05)',
                }}
              >
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>平均TTFA</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>
                  {ws.latencyStats.avg_ttfa_ms}ms
                </div>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(148,163,184,0.05)',
                }}
              >
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>P50 / P95 / P99</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>
                  {ws.latencyStats.p50_ttfa_ms} / {ws.latencyStats.p95_ttfa_ms} / {ws.latencyStats.p99_ttfa_ms}ms
                </div>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(148,163,184,0.05)',
                }}
              >
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>最小值</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#10b981' }}>
                  {ws.latencyStats.min_ttfa_ms}ms
                </div>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(148,163,184,0.05)',
                }}
              >
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>最大值</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ef4444' }}>
                  {ws.latencyStats.max_ttfa_ms}ms
                </div>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(148,163,184,0.05)',
                }}
              >
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>SLA合规率</div>
                <div
                  style={{
                    fontSize: '1rem',
                    fontWeight: 700,
                    color: ws.latencyStats.sla_compliance_pct >= 95 ? '#10b981' : '#ef4444',
                  }}
                >
                  {ws.latencyStats.sla_compliance_pct}%
                </div>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(148,163,184,0.05)',
                }}
              >
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>SLA超限次数</div>
                <div
                  style={{
                    fontSize: '1rem',
                    fontWeight: 700,
                    color: ws.latencyStats.above_sla_count > 0 ? '#ef4444' : '#10b981',
                  }}
                >
                  {ws.latencyStats.above_sla_count}/{ws.latencyStats.total_records}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Waveform */}
        {audio.isRecording && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              height: 40,
              padding: '0 20px',
            }}
          >
            {audio.waveformData.map((h, i) => (
              <div
                key={i}
                style={{
                  width: 3,
                  height: h,
                  borderRadius: 2,
                  background: '#3b82f6',
                  transition: 'height 80ms ease',
                  opacity: h > 4 ? 0.8 : 0.3,
                }}
              />
            ))}
          </div>
        )}

        {/* Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: '16px 0',
          }}
        >
          {/* Barge-in */}
          <button
            className={`btn ${bargeInEnabled ? 'btn-secondary' : 'btn-ghost'}`}
            onClick={handleBargeIn}
            disabled={!conversationActive}
            style={{ width: 44, height: 44, padding: 0, borderRadius: 12 }}
            title="插话"
          >
            <Zap size={18} />
          </button>

          {/* Main mic button */}
          {conversationActive ? (
            <button
              className="btn"
              onClick={handleStop}
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                color: 'white',
                padding: 0,
                boxShadow: '0 4px 20px rgba(239,68,68,0.3)',
              }}
            >
              <Square size={22} />
            </button>
          ) : (
            <button
              className="btn"
              onClick={handleStart}
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: 'white',
                padding: 0,
                boxShadow: '0 4px 20px rgba(59,130,246,0.3)',
              }}
            >
              {config ? <Phone size={22} /> : <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />}
            </button>
          )}

          {/* Status */}
          <button
            className="btn btn-ghost"
            style={{ width: 44, height: 44, padding: 0, borderRadius: 12 }}
            title="连接状态"
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: ws.connected ? '#10b981' : '#64748b',
              }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

