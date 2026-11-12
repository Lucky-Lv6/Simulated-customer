import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  FileText,
  Clock,
  MessageSquare,
  Gauge,
  TrendingUp,
  TrendingDown,
  Zap,
  Target,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { formatDurationCN, getScoreColor, getScoreLabel } from '../utils/format';
import type { EvaluationReport, ConversationStats, TranscriptMessage } from '../types';

export default function ConversationResult() {
  const navigate = useNavigate();
  const [evaluation, setEvaluation] = useState<EvaluationReport | null>(null);
  const [stats, setStats] = useState<ConversationStats | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]); // 完整对话逐句记录
  const [showTranscript, setShowTranscript] = useState(false); // 是否展开完整对话

  useEffect(() => {
    const saved = sessionStorage.getItem('conversation_result');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      setEvaluation(parsed.evaluation ?? null);
      setStats(parsed.stats ?? null);
      setTranscripts(parsed.transcripts ?? []);
    } catch {
      // 数据损坏时按“暂无结果”处理，避免白屏
    }
  }, []);

  if (!evaluation || !stats) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>
          <Zap size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
          <div>暂无结果数据</div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => navigate('/simulation')}>
            开始新模拟
          </button>
        </div>
      </div>
    );
  }

  const formatDuration = formatDurationCN;

  const handleExportReport = () => {
    if (!evaluation || !stats) return;
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const lines: string[] = [];
    lines.push('# AI 客户模拟交流报告');
    lines.push('');
    lines.push('> AI_SIMULATION：本记录由 AI 客户模拟系统生成，用于 FDE 售前培训/内部演示。');
    lines.push('');
    lines.push(`- 会话编号：${stats.session_id}`);
    lines.push(`- 交流时长：${formatDuration(stats.duration_seconds)}`);
    lines.push(`- 交流轮次：${stats.total_turns} 轮`);
    lines.push(`- 平均延迟：${stats.avg_ttfa_ms}ms（P95 ${stats.p95_ttfa_ms}ms）`);
    lines.push(`- 综合评分：${evaluation.total_score} / 100`);
    lines.push('');
    lines.push('## 评分维度');
    lines.push('');
    for (const dim of evaluation.dimensions) {
      lines.push(`- **${dim.name}**：${dim.score}/10${dim.comment ? ` —— ${dim.comment}` : ''}`);
    }
    if (evaluation.strengths.length) {
      lines.push('');
      lines.push('## 优势');
      evaluation.strengths.forEach((s) => lines.push(`- ${s}`));
    }
    if (evaluation.weaknesses.length) {
      lines.push('');
      lines.push('## 待提升');
      evaluation.weaknesses.forEach((w) => lines.push(`- ${w}`));
    }
    if (evaluation.summary) {
      lines.push('');
      lines.push('## 总结');
      lines.push('');
      lines.push(evaluation.summary);
    }
    if (transcripts.length) {
      lines.push('');
      lines.push('## 完整对话');
      lines.push('');
      for (const t of transcripts) {
        lines.push(`**${t.role === 'user' ? '我' : 'AI客户'}**：${t.text}`);
        lines.push('');
      }
    }

    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI_SIMULATION_${stamp}_report.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Back button */}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => navigate('/simulation')}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={16} />
        返回配置
      </button>

      {/* Total Score */}
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '32px 20px',
          marginBottom: 24,
          animation: 'fade-in 0.3s ease forwards',
        }}
      >
        <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: 12 }}>
          综合评分
        </div>
        <div
          style={{
            fontSize: '3.5rem',
            fontWeight: 700,
            color: getScoreColor(evaluation.total_score),
            lineHeight: 1,
            marginBottom: 8,
          }}
        >
          {evaluation.total_score}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span
            className={`badge ${
              evaluation.total_score >= 80
                ? 'badge-green'
                : evaluation.total_score >= 60
                  ? 'badge-orange'
                  : 'badge-red'
            }`}
          >
            {getScoreLabel(evaluation.total_score)}
          </span>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { icon: Clock, label: '对话时长', value: formatDuration(stats.duration_seconds), color: '#06b6d4' },
          { icon: MessageSquare, label: '总轮次', value: `${stats.total_turns} 轮`, color: '#8b5cf6' },
          { icon: Gauge, label: '平均延迟', value: `${stats.avg_ttfa_ms}ms`, color: '#3b82f6' },
          { icon: Zap, label: 'SLA达标', value: `${stats.sla_compliance_pct}%`, color: '#10b981' },
        ].map((item) => (
          <div key={item.label} className="card" style={{ textAlign: 'center', padding: '16px 12px' }}>
            <item.icon size={18} style={{ color: item.color, margin: '0 auto 8px' }} />
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#f1f5f9' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Dimensions Breakdown */}
      <div className="card" style={{ marginBottom: 24, animation: 'fade-in 0.3s ease forwards', animationDelay: '0.1s' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f1f5f9', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={16} style={{ color: '#8b5cf6' }} />
          评分维度
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {evaluation.dimensions.map((dim) => {
            // 维度满分 10 分，进度条按百分制换算
            const pct = Math.max(0, Math.min(100, dim.score * 10));
            return (
              <div key={dim.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.875rem', color: '#f1f5f9', fontWeight: 500 }}>{dim.name}</span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: getScoreColor(pct) }}>
                    {dim.score}/10
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: 6,
                    background: 'rgba(148,163,184,0.1)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      borderRadius: 3,
                      background: `linear-gradient(90deg, ${getScoreColor(Math.max(pct - 20, 0))}, ${getScoreColor(pct)})`,
                      transition: 'width 0.5s ease',
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>{dim.comment}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Strengths & Weaknesses */}
      <div
        className="grid-2-responsive"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ animation: 'fade-in 0.3s ease forwards', animationDelay: '0.15s' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={16} style={{ color: '#10b981' }} />
            优势
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {evaluation.strengths.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, fontSize: '0.8125rem', color: '#94a3b8' }}>
                <CheckCircle2 size={14} style={{ color: '#10b981', flexShrink: 0, marginTop: 2 }} />
                {s}
              </li>
            ))}
          </ul>
        </div>

        <div className="card" style={{ animation: 'fade-in 0.3s ease forwards', animationDelay: '0.2s' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingDown size={16} style={{ color: '#ef4444' }} />
            待提升
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {evaluation.weaknesses.map((w, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, fontSize: '0.8125rem', color: '#94a3b8' }}>
                <AlertTriangle size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
                {w}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Summary */}
      <div className="card-glass" style={{ marginBottom: 24, padding: '16px 20px' }}>
        <div style={{ fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.6 }}>{evaluation.summary}</div>
      </div>

      {/* 完整对话 */}
      {showTranscript && (
        <div className="card" style={{ marginBottom: 24, padding: '20px 20px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f1f5f9', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={16} style={{ color: '#3b82f6' }} />
            完整对话记录
            <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>共 {transcripts.length} 条</span>
          </h3>
          {transcripts.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: '0.8125rem' }}>暂无对话记录数据</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflow: 'auto' }}>
              {transcripts.map((t, i) => {
                const isUser = t.role === 'user';
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: isUser ? 'flex-start' : 'flex-end',
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '75%',
                        padding: '8px 12px',
                        borderRadius: 10,
                        fontSize: '0.8125rem',
                        lineHeight: 1.5,
                        background: isUser ? 'rgba(59,130,246,0.12)' : 'rgba(16,185,129,0.12)',
                        color: '#e2e8f0',
                      }}
                    >
                      <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 4 }}>
                        {isUser ? '我' : '客户'}
                      </div>
                      {t.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 32 }}>
        <button className="btn btn-secondary" onClick={() => setShowTranscript(v => !v)}>
          <FileText size={16} />
          {showTranscript ? '收起完整对话' : '查看完整对话'}
        </button>
        <button className="btn btn-primary" onClick={handleExportReport}>
          <Download size={16} />
          导出报告
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('/simulation')}>
          <ArrowLeft size={16} />
          再试一次
        </button>
      </div>
    </div>
  );
}
