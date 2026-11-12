import { useCallback, useEffect, useState } from 'react';
import {
  Server,
  Mic,
  Volume2,
  Brain,
  Sliders,
  RefreshCw,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  FileCog,
} from 'lucide-react';
import { fetchConfig } from '../services/api';

interface ProviderSection {
  base_url: string;
  model: string;
  api_key: string;
  appid?: string;
  configured: boolean;
}

interface AppConfig {
  env_file: string;
  env_exists: boolean;
  llm: ProviderSection;
  stt: ProviderSection;
  tts: ProviderSection;
  server: {
    host: string;
    port: number;
    conversation_timeout_s: number;
  };
  vad: {
    silence_duration_ms: number;
    min_speech_duration_ms: number;
    max_speech_duration_ms: number;
  };
}

function Field({
  label,
  value,
  badge,
}: {
  label: string;
  value: string | number;
  badge?: boolean;
}) {
  const text = value === '' || value === undefined || value === null ? '—' : String(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{label}</span>
      <span
        style={{
          fontSize: '0.8125rem',
          color: '#e2e8f0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          wordBreak: 'break-all',
        }}
      >
        {text}
      </span>
      {badge && (
        <span
          className={`badge ${value ? 'badge-green' : 'badge-orange'}`}
          style={{ alignSelf: 'flex-start', fontSize: '0.65rem' }}
        >
          {value ? '已配置' : '未配置'}
        </span>
      )}
    </div>
  );
}

function ProviderCard({
  title,
  icon,
  color,
  section,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  section: ProviderSection;
}) {
  return (
    <div className="card">
      <h3
        style={{
          fontSize: '0.95rem',
          fontWeight: 600,
          color: '#f1f5f9',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ color }}>{icon}</span>
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Base URL / Endpoint" value={section.base_url} />
        <Field label="模型" value={section.model} />
        <Field label="API Key" value={section.api_key} badge={section.configured} />
        {section.appid !== undefined && <Field label="App ID" value={section.appid} />}
      </div>
    </div>
  );
}

export default function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'api' | 'runtime'>('api');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetchConfig()
      .then((data) => setConfig(data as AppConfig))
      .catch((e: Error) => setError(e.message || '加载配置失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const tabs = [
    { id: 'api', label: '服务配置', icon: Server },
    { id: 'runtime', label: '运行参数', icon: Sliders },
  ] as const;

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            设置
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
            当前生效的配置（只读）。修改请编辑 .env 文件后重启服务
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <RefreshCw size={16} />
          )}
          刷新
        </button>
      </div>

      {error && (
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
            color: '#fca5a5',
            borderColor: 'rgba(239,68,68,0.3)',
            fontSize: '0.8125rem',
          }}
        >
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {loading && !config ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={28} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : config ? (
        <>
          {/* Tabs */}
          <div className="card-glass" style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 24 }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="btn btn-sm"
                style={{
                  flex: 1,
                  background: activeTab === tab.id ? 'rgba(59,130,246,0.15)' : 'transparent',
                  color: activeTab === tab.id ? '#3b82f6' : '#94a3b8',
                  border:
                    activeTab === tab.id
                      ? '1px solid rgba(59,130,246,0.2)'
                      : '1px solid transparent',
                  gap: 6,
                }}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'api' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <ProviderCard
                title="LLM 配置"
                icon={<Brain size={16} />}
                color="#8b5cf6"
                section={config.llm}
              />
              <ProviderCard
                title="STT 配置"
                icon={<Mic size={16} />}
                color="#06b6d4"
                section={config.stt}
              />
              <ProviderCard
                title="TTS 配置"
                icon={<Volume2 size={16} />}
                color="#10b981"
                section={config.tts}
              />
            </div>
          )}

          {activeTab === 'runtime' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="card">
                <h3
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: '#f1f5f9',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Server size={16} style={{ color: '#3b82f6' }} />
                  服务
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="监听地址" value={config.server.host} />
                  <Field label="端口" value={config.server.port} />
                  <Field label="会话空闲超时" value={`${config.server.conversation_timeout_s} 秒`} />
                </div>
              </div>

              <div className="card">
                <h3
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: '#f1f5f9',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Sliders size={16} style={{ color: '#f59e0b' }} />
                  VAD 参数
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <Field label="静音判定时长" value={`${config.vad.silence_duration_ms} ms`} />
                  <Field label="最短语音时长" value={`${config.vad.min_speech_duration_ms} ms`} />
                  <Field label="最长语音时长" value={`${config.vad.max_speech_duration_ms} ms`} />
                </div>
              </div>

              <div className="card">
                <h3
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: '#f1f5f9',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <FileCog size={16} style={{ color: '#10b981' }} />
                  配置文件
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Field label=".env 路径" value={config.env_file} />
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: '0.8125rem',
                      color: config.env_exists ? '#10b981' : '#f59e0b',
                    }}
                  >
                    {config.env_exists ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    {config.env_exists ? '已找到配置文件' : '未找到 .env，当前使用环境变量或默认值'}
                  </div>
                </div>
              </div>

              <div
                className="card-glass"
                style={{
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: '0.8125rem',
                  color: '#94a3b8',
                }}
              >
                <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                服务运行中不读取配置变更，修改 .env 后需重启后端进程才会生效
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
