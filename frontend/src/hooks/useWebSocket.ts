import { useRef, useCallback, useState } from 'react';
import { createConversationWs } from '../services/api';
import type { CustomerStatusType, LatencyData, LatencyHistoryItem, LatencyStats, TranscriptMessage, EvaluationReport, ConversationStats, WSMessage } from '../types';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Blob[]>([]);
  const isPlayingRef = useRef(false);
  const isPlayingAudioRef = useRef(false);      // 客户语音是否正在播放
  const lastPlaybackEndAtRef = useRef(0);       // 客户语音播放结束时间
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<CustomerStatusType>('idle');
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState<TranscriptMessage | null>(null);
  const [latency, setLatency] = useState<LatencyData | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistoryItem[]>([]);
  const [latencyStats, setLatencyStats] = useState<LatencyStats | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationReport | null>(null);
  const [stats, setStats] = useState<ConversationStats | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 使用 Web Audio API 播放音频（绕过 Chrome 自动播放限制）
  const playNextAudio = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      isPlayingAudioRef.current = false;
      lastPlaybackEndAtRef.current = Date.now();
      return;
    }
    isPlayingRef.current = true;
    const blob = audioQueueRef.current.shift()!;

    blob.arrayBuffer().then((arrayBuffer) => {
      const ctx = audioCtxRef.current;
      if (!ctx) {
        sourceRef.current = null;
        isPlayingRef.current = false;
        return;
      }
      ctx.decodeAudioData(arrayBuffer).then((buffer) => {
        const source = ctx.createBufferSource();
        sourceRef.current = source;
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
          sourceRef.current = null;
          if (audioQueueRef.current.length === 0) {
            isPlayingAudioRef.current = false;
            lastPlaybackEndAtRef.current = Date.now();
          }
          playNextAudio();
        };
        isPlayingAudioRef.current = true;
        source.start(0);
      }).catch(() => {
        // 解码失败，跳过
        sourceRef.current = null;
        playNextAudio();
      });
    }).catch(() => {
      sourceRef.current = null;
      isPlayingRef.current = false;
      isPlayingAudioRef.current = false;
      lastPlaybackEndAtRef.current = Date.now();
    });
  }, []);

  // 立即停止当前播放并清空待播队列（用于 Barge-in）
  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
      } catch {
        // source 已结束或未启动
      }
      sourceRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isPlayingAudioRef.current = false;
    lastPlaybackEndAtRef.current = Date.now();
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = createConversationWs();
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        // 播放音频数据
        audioQueueRef.current.push(event.data);
        if (!isPlayingRef.current) {
          playNextAudio();
        }
        return;
      }

      try {
        const msg: WSMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'session_id':
            setSessionId(msg.session_id);
            break;
          case 'status':
            setStatus(msg.status);
            if (msg.status === 'idle_timeout') {
              setErrorMessage(msg.message || '对话已空闲超时');
            }
            break;
          case 'transcript':
            if (msg.is_partial) {
              setCurrentTranscript({ role: msg.role, text: msg.text, isPartial: true });
            } else {
              setTranscripts(prev => [...prev, { role: msg.role, text: msg.text, isPartial: false }]);
              setCurrentTranscript(null);
            }
            break;
          case 'latency': {
            setLatency(msg.data);
            setLatencyHistory(prev => {
              const item: LatencyHistoryItem = {
                timestamp: Date.now(),
                vad_ms: msg.data.vad_ms,
                stt_ms: msg.data.stt_ms,
                llm_first_token_ms: msg.data.llm_first_token_ms,
                tts_first_audio_ms: msg.data.tts_first_audio_ms,
                total_ttfa_ms: msg.data.total_ttfa_ms,
                above_sla: msg.data.above_sla,
              };
              return [...prev, item];
            });
            break;
          }
          case 'error':
            setErrorMessage(msg.message);
            break;
          case 'conversation_end': {
            setEvaluation(msg.evaluation);
            setStats(msg.stats);
            // 计算延迟统计
            if (msg.stats) {
              setLatencyStats({
                avg_ttfa_ms: msg.stats.avg_ttfa_ms,
                min_ttfa_ms: msg.stats.min_ttfa_ms,
                max_ttfa_ms: msg.stats.max_ttfa_ms,
                p50_ttfa_ms: msg.stats.p50_ttfa_ms,
                p95_ttfa_ms: msg.stats.p95_ttfa_ms,
                p99_ttfa_ms: msg.stats.p99_ttfa_ms,
                sla_compliance_pct: msg.stats.sla_compliance_pct,
                above_sla_count: msg.stats.above_sla_count,
                total_records: msg.stats.total_latency_records,
              });
            }
            break;
          }
        }
      } catch {
        // Not JSON - might be audio binary
      }
    };
  }, [playNextAudio]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const startConversation = useCallback((params: {
    customer_id: string;
    scenario_id: string;
    difficulty: number;
    voice_id: string;
    uploaded_text?: string;
    uploaded_filename?: string;
    uploaded_material_id?: string;
  }) => {
    setTranscripts([]);
    setCurrentTranscript(null);
    setLatency(null);
    setLatencyHistory([]);
    setLatencyStats(null);
    setEvaluation(null);
    setStats(null);
    // 创建 AudioContext（用户手势中创建，避免 Chrome 自动播放限制）
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    connect();

    // 等待连接就绪后再发 start（最多等 5 秒，避免连接失败时无限轮询）
    let waited = 0;
    const timer = window.setInterval(() => {
      waited += 100;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        window.clearInterval(timer);
        send({ type: 'start', ...params });
      } else if (waited >= 5000) {
        window.clearInterval(timer);
        setErrorMessage('无法连接后端服务，请确认服务已启动后重试');
      }
    }, 100);
  }, [connect, send]);

  const stopConversation = useCallback(() => {
    send({ type: 'stop' });
  }, [send]);

  const sendBargeIn = useCallback(() => {
    send({ type: 'barge_in' });
  }, [send]);

  const sendUserText = useCallback((text: string, scriptIndex?: number) => {
    send({ type: 'user_text', text, script_index: scriptIndex });
  }, [send]);

  // 心跳：用户正在朗读资料、尚未产生识别结果时，告诉后端“我还在说话”
  const sendActivity = useCallback(() => {
    send({ type: 'activity' });
  }, [send]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    // 停止音频播放
    stopPlayback();
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  }, [stopPlayback]);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  return {
    connected,
    sessionId,
    status,
    transcripts,
    currentTranscript,
    latency,
    latencyHistory,
    latencyStats,
    evaluation,
    stats,
    errorMessage,
    startConversation,
    stopConversation,
    sendBargeIn,
    stopPlayback,
    isPlayingAudioRef,
    lastPlaybackEndAtRef,
    sendUserText,
    sendActivity,
    disconnect,
    clearError,
  };
}
