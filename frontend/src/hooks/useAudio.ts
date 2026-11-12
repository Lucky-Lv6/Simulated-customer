import { useRef, useCallback, useState } from 'react';

// Web Speech API 类型声明（浏览器标准未收录，这里按需声明）
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start(): void;
    stop(): void;
    abort(): void;
    onstart: ((event: any) => void) | null;
    onend: ((event: any) => void) | null;
    onerror: ((event: any) => void) | null;
    onresult: ((event: any) => void) | null;
    onaudiostart: ((event: any) => void) | null;
    onspeechstart: ((event: any) => void) | null;
  }
}

const MAX_RETRY_COUNT = 5;      // 连续重启次数上限
const SPEECH_ERROR_SILENCE = '未检测到语音，请说话...';

/**
 * 麦克风与语音识别 Hook。
 *
 * 只使用浏览器 Web Speech API 做识别（不向后端推流音频），
 * 同时用 WebAudio 做电平检测，判断用户是否还在说话。
 */
export function useAudio() {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const waveformAnimFrameRef = useRef<number | null>(null);
  const levelStreamRef = useRef<MediaStream | null>(null);
  const levelCtxRef = useRef<AudioContext | null>(null);
  const onSpeechResultRef = useRef<((text: string) => void) | null>(null);
  const onSpeechStartRef = useRef<(() => void) | null>(null);
  const speechRecoRestartingRef = useRef(false);
  const consecutiveErrorCountRef = useRef(0);
  const lastVoiceAtRef = useRef(0);   // 最后一次检测到用户人声的时间戳（ms）

  const [isRecording, setIsRecording] = useState(false);
  const [isSpeechRecognition, setIsSpeechRecognition] = useState(false);
  const [waveformData, setWaveformData] = useState<number[]>(new Array(32).fill(2));
  const [speechText, setSpeechText] = useState('');
  const [speechError, setSpeechError] = useState<string | null>(null);

  const _setupRecognition = useCallback((onSpeechResult: (text: string) => void) => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setSpeechError('浏览器不支持语音识别，请使用 Chrome 浏览器');
      return null;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setSpeechError(null);
      setIsSpeechRecognition(true);
    };

    recognition.onaudiostart = () => setSpeechError(null);

    recognition.onspeechstart = () => {
      setSpeechError(null);
      onSpeechStartRef.current?.();
    };

    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      if (!result.isFinal) return;

      const text = String(result[0].transcript || '').trim();
      if (!text) return;

      consecutiveErrorCountRef.current = 0;
      setSpeechText(text);
      setSpeechError(null);
      // 每个识别片段立即上报；由上层累计并按“资料台词匹配”决定何时发送
      onSpeechResultRef.current?.(text);
    };

    recognition.onerror = (event: any) => {
      console.warn('[SpeechRecognition] 错误:', event.error);

      // not-allowed / service-not-allowed 不可恢复
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setSpeechError(`麦克风权限被拒绝 (${event.error})`);
        recognitionRef.current = null;
        return;
      }
      // no-speech 是正常超时，用户没有说话，不计入错误次数
      if (event.error === 'no-speech') {
        setSpeechError(SPEECH_ERROR_SILENCE);
        return;
      }

      consecutiveErrorCountRef.current += 1;
      if (consecutiveErrorCountRef.current >= MAX_RETRY_COUNT) {
        setSpeechError('语音识别服务连接失败，已停止重试。请检查网络连接或刷新页面重试。');
        recognitionRef.current = null;
        return;
      }
      setSpeechError(
        `语音识别错误: ${event.error}（剩余重试 ${MAX_RETRY_COUNT - consecutiveErrorCountRef.current} 次）`,
      );
    };

    // onend 自动重启（含失败退避）。recognitionRef 被 stopRecording 清空时不再重启。
    let restartAttempt = 0;
    const scheduleRestart = () => {
      if (!recognitionRef.current) return;
      if (speechRecoRestartingRef.current) {
        setTimeout(scheduleRestart, 200); // 等待上轮重启完成
        return;
      }

      speechRecoRestartingRef.current = true;
      const delay = 200 + restartAttempt * 150;
      restartAttempt += 1;

      setTimeout(() => {
        speechRecoRestartingRef.current = false;
        if (!recognitionRef.current) return;

        // _setupRecognition 内部已调用 start()，这里只挂载实例，不要重复 start()，
        // 否则 "对已启动实例重复 start()" 会抛 InvalidStateError，导致识别永久静默。
        const newRecognition = _setupRecognition(onSpeechResultRef.current || onSpeechResult);
        if (newRecognition) {
          recognitionRef.current = newRecognition;
          restartAttempt = 0;
        } else {
          setTimeout(scheduleRestart, 400); // Chrome 状态未释放，稍后重试
        }
      }, delay);
    };

    recognition.onend = () => {
      if (!recognitionRef.current) return; // stopRecording 已清空
      scheduleRestart();
    };

    try {
      recognition.start();
    } catch (e) {
      setSpeechError('语音识别启动失败: ' + String(e));
      return null;
    }

    return recognition;
  }, []);

  /** 停止麦克风电平检测动画与音频流 */
  const stopLevelMonitor = useCallback(() => {
    if (waveformAnimFrameRef.current !== null) {
      cancelAnimationFrame(waveformAnimFrameRef.current);
      waveformAnimFrameRef.current = null;
    }
    levelStreamRef.current?.getTracks().forEach((t) => t.stop());
    levelStreamRef.current = null;
    if (levelCtxRef.current) {
      levelCtxRef.current.close().catch(() => {});
      levelCtxRef.current = null;
    }
  }, []);

  /**
   * 启动语音识别（必须在用户手势中调用，Chrome 要求）。
   * @returns 是否启动成功
   */
  const startSpeechRecognition = useCallback((
    onSpeechResult: (text: string) => void,
    onSpeechStart?: () => void,
  ) => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setSpeechError('浏览器不支持语音识别，请使用 Chrome 浏览器');
      return false;
    }

    consecutiveErrorCountRef.current = 0;
    onSpeechResultRef.current = onSpeechResult;
    onSpeechStartRef.current = onSpeechStart || null;

    // 停止旧实例
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    const recognition = _setupRecognition(onSpeechResult);
    if (!recognition) return false;

    recognitionRef.current = recognition;
    setIsRecording(true);
    setIsSpeechRecognition(true);
    setSpeechText('');
    setSpeechError(null);

    // 真实麦克风电平检测：判断用户是否仍在说话，
    // 避免“识别不出新文字”被误判成“说完了”而提前让客户回应。
    lastVoiceAtRef.current = 0;
    const startLevelMonitor = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        levelStreamRef.current = stream;
        const ctx = new AudioContext();
        levelCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);

        const tick = () => {
          if (!recognitionRef.current) {
            waveformAnimFrameRef.current = null;
            return;
          }
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          if (rms > 0.02) lastVoiceAtRef.current = Date.now();

          const bars: number[] = [];
          for (let i = 0; i < 32; i++) {
            const v = Math.abs(data[i * 8] - 128) / 6;
            bars.push(Math.max(2, Math.round(v)));
          }
          setWaveformData(bars);
          waveformAnimFrameRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // 无法获取麦克风电平：退化为随机波形（不影响识别本身）
        const animateWaveform = () => {
          if (!recognitionRef.current) {
            waveformAnimFrameRef.current = null;
            return;
          }
          setWaveformData(
            Array.from({ length: 32 }, () => Math.max(2, Math.round(Math.random() * 20))),
          );
          waveformAnimFrameRef.current = requestAnimationFrame(animateWaveform);
        };
        waveformAnimFrameRef.current = requestAnimationFrame(animateWaveform);
      }
    };
    void startLevelMonitor();

    return true;
  }, [_setupRecognition]);

  const stopRecording = useCallback(() => {
    // 先置空 ref 阻止 onend 自动重启，再清理其他引用
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    stopLevelMonitor();
    onSpeechStartRef.current = null;
    setIsRecording(false);
    setIsSpeechRecognition(false);
    setSpeechError(null);
  }, [stopLevelMonitor]);

  return {
    isRecording,
    isSpeechRecognition,
    waveformData,
    speechText,
    speechError,
    lastVoiceAtRef,
    startSpeechRecognition,
    stopRecording,
  };
}
