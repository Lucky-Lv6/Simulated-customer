import { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Gauge,
  Star,
  Clock,
  Target,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  X,
  Activity,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import { fetchHistory } from '../services/api';
import { getScoreColor, getScoreLabel } from '../utils/format';
import type { HistoryItem } from '../types';

const colors = {
  blue: '#3b82f6',
  purple: '#8b5cf6',
  cyan: '#06b6d4',
  green: '#10b981',
  orange: '#f59e0b',
  red: '#ef4444',
};

const tooltipStyle = {
  background: '#141b2d',
  border: '1px solid rgba(148,163,184,0.15)',
  borderRadius: 8,
  color: '#f1f5f9',
  fontSize: '0.8125rem',
};

type TimeRange = 'all' | 'month' | 'quarter';

const RANGE_DAYS: Record<Exclude<TimeRange, 'all'>, number> = {
  month: 30,
  quarter: 90,
};

function filterByRange(history: HistoryItem[], range: TimeRange): HistoryItem[] {
  if (range === 'all') return history;
  const cutoff = Date.now() - RANGE_DAYS[range] * 24 * 3600 * 1000;
  return history.filter((h) => {
    if (!h.created_at) return false;
    const ts = Date.parse(h.created_at);
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

/** 把各次评测的维度分数按维度名求平均，分值统一换算到百分制 */
function extractDimensionData(
  history: HistoryItem[]
): Array<{ dimension: string; score: number; fullMark: number }> {
  const totals = new Map<string, { sum: number; count: number }>();

  history.forEach((item) => {
    item.evaluation?.dimensions?.forEach((dim) => {
      if (!dim?.name || typeof dim.score !== 'number') return;
      const entry = totals.get(dim.name) ?? { sum: 0, count: 0 };
      // 维度分是 10 分制，换算成百分制便于与前端的 0-100 雷达图对齐
      entry.sum += dim.score * 10;
      entry.count += 1;
      totals.set(dim.name, entry);
    });
  });

  return Array.from(totals.entries()).map(([dimension, { sum, count }]) => ({
    dimension,
    score: Math.round(sum / count),
    fullMark: 100,
  }));
}

function buildLatencyDistribution(history: HistoryItem[]) {
  const labels = ['<500ms', '500-1s', '1-2s', '2-3s', '>3s'];
  const fills = [colors.green, colors.cyan, colors.blue, colors.orange, colors.red];
  const buckets = new Array(labels.length).fill(0) as number[];

  history.forEach((h) => {
    const lat = h.avg_ttfa_ms;
    if (!lat || lat <= 0) return;
    if (lat < 500) buckets[0]++;
    else if (lat < 1000) buckets[1]++;
    else if (lat < 2000) buckets[2]++;
    else if (lat < 3000) buckets[3]++;
    else buckets[4]++;
  });

  return labels.map((name, i) => ({ name, count: buckets[i], fill: fills[i] }));
}

function ChartEmpty({ text }: { text: string }) {
  return (
    <div
      style={{
        height: 180,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b',
        fontSize: '0.8125rem',
      }}
    >
      {text}
    </div>
  );
}

export default function Performance() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [selectedSession, setSelectedSession] = useState<HistoryItem | null>(null);

  useEffect(() => {
    fetchHistory()
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  const scoped = useMemo(() => filterByRange(history, timeRange), [history, timeRange]);

  const avgScore = useMemo(() => {
    if (!scoped.length) return 0;
    return Math.round(scoped.reduce((a, b) => a + b.total_score, 0) / scoped.length);
  }, [scoped]);

  const avgLatency = useMemo(() => {
    const values = scoped.map((h) => h.avg_ttfa_ms).filter((v) => v > 0);
    if (!values.length) return 0;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }, [scoped]);

  const totalMinutes = useMemo(
    () => Math.round(scoped.reduce((a, b) => a + (b.duration_seconds || 0), 0) / 60),
    [scoped]
  );

  // 图表按时间正序展示
  const trendData = useMemo(
    () =>
      scoped
        .map((h, i) => ({
          name: `#${i + 1}`,
          score: h.total_score,
          latency: h.avg_ttfa_ms,
          session_id: h.session_id,
        }))
        .reverse(),
    [scoped]
  );

  const slaTrendData = useMemo(
    () =>
      scoped
        .map((h, i) => ({
          name: `#${i + 1}`,
          compliance: h.sla_compliance_pct ?? null,
        }))
        .reverse(),
    [scoped]
  );

  const dimensionData = useMemo(() => extractDimensionData(scoped), [scoped]);
  const latencyDistribution = useMemo(() => buildLatencyDistribution(scoped), [scoped]);
  const hasLatencyData = latencyDistribution.some((b) => b.count > 0);
  const hasSlaData = slaTrendData.some((d) => d.compliance !== null);

  if (loading) {
    return (
      <div
        className="page-container"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
      >
        <Loader2 size={32} style={{ color: colors.blue, animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
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
            能力分析
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
            追踪你的表现趋势，发现提升空间
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['all', 'month', 'quarter'] as const).map((range) => (
            <button
              key={range}
              className={`btn btn-sm ${timeRange === range ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setTimeRange(range)}
            >
              {range === 'all' ? '全部' : range === 'month' ? '本月' : '本季度'}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          {
            icon: Star,
            label: '最新评分',
            value: scoped.length > 0 ? `${scoped[scoped.length - 1].total_score}` : '--',
            sub: '/100',
            color: colors.purple,
          },
          { icon: TrendingUp, label: '平均评分', value: scoped.length ? `${avgScore}` : '--', sub: '/100', color: colors.blue },
          { icon: Gauge, label: '平均延迟', value: avgLatency ? `${avgLatency}` : '--', sub: 'ms', color: colors.cyan },
          { icon: Clock, label: '总训练时长', value: `${totalMinutes}`, sub: '分钟', color: colors.green },
        ].map((card) => (
          <div key={card.label} className="card" style={{ textAlign: 'center', padding: '16px 12px' }}>
            <card.icon size={18} style={{ color: card.color, margin: '0 auto 8px' }} />
            <div
              style={{
                fontSize: '0.7rem',
                color: '#64748b',
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {card.label}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>
              {card.value}
              <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#64748b', marginLeft: 4 }}>
                {card.sub}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Score Trend Chart */}
      <div className="card" style={{ marginBottom: 24, animation: 'fade-in 0.3s ease forwards' }}>
        <h3
          style={{
            fontSize: '0.95rem',
            fontWeight: 600,
            color: '#f1f5f9',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <TrendingUp size={16} style={{ color: colors.blue }} />
          评分趋势
        </h3>
        {trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
              <YAxis yAxisId="left" stroke="#64748b" fontSize={12} domain={[0, 100]} />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#64748b"
                fontSize={12}
                domain={[0, 3000]}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="score"
                stroke={colors.blue}
                strokeWidth={2}
                dot={{ fill: colors.blue, r: 4 }}
                activeDot={{ r: 6 }}
                name="评分"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="latency"
                stroke={colors.orange}
                strokeWidth={2}
                dot={{ fill: colors.orange, r: 4 }}
                name="延迟(ms)"
              />
              <Legend wrapperStyle={{ fontSize: '0.75rem', color: '#94a3b8' }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty text="选取的时间范围内没有训练记录" />
        )}
      </div>

      {/* SLA Compliance Trend */}
      <div
        className="card"
        style={{ marginBottom: 24, animation: 'fade-in 0.3s ease forwards', animationDelay: '0.05s' }}
      >
        <h3
          style={{
            fontSize: '0.95rem',
            fontWeight: 600,
            color: '#f1f5f9',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Activity size={16} style={{ color: colors.green }} />
          SLA 合规率趋势
        </h3>
        {hasSlaData ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={slaTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
              <YAxis domain={[0, 100]} stroke="#64748b" fontSize={12} unit="%" />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="compliance"
                stroke={colors.green}
                fill={colors.green}
                fillOpacity={0.1}
                strokeWidth={2}
                name="SLA合规率"
                connectNulls
              />
              <ReferenceLine
                y={95}
                stroke={colors.green}
                strokeDasharray="5 5"
                label={{ value: '目标 95%', fill: '#64748b', fontSize: 11, position: 'insideTopRight' }}
              />
              <Legend wrapperStyle={{ fontSize: '0.75rem', color: '#94a3b8' }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty text="暂无 SLA 统计数据" />
        )}
      </div>

      {/* Dimension Radar + Latency Distribution */}
      <div
        className="grid-2-responsive"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}
      >
        <div className="card" style={{ animation: 'fade-in 0.3s ease forwards', animationDelay: '0.1s' }}>
          <h3
            style={{
              fontSize: '0.95rem',
              fontWeight: 600,
              color: '#f1f5f9',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Target size={16} style={{ color: colors.purple }} />
            能力维度
          </h3>
          {dimensionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={dimensionData}>
                <PolarGrid stroke="rgba(148,163,184,0.1)" />
                <PolarAngleAxis dataKey="dimension" stroke="#94a3b8" fontSize={11} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#64748b" fontSize={10} />
                <Radar
                  name="评分"
                  dataKey="score"
                  stroke={colors.purple}
                  fill={colors.purple}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Tooltip contentStyle={tooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty text="完成带评测的模拟后可查看维度分析" />
          )}
        </div>

        <div className="card" style={{ animation: 'fade-in 0.3s ease forwards', animationDelay: '0.15s' }}>
          <h3
            style={{
              fontSize: '0.95rem',
              fontWeight: 600,
              color: '#f1f5f9',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Gauge size={16} style={{ color: colors.cyan }} />
            延迟分布
          </h3>
          {hasLatencyData ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={latencyDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name="次数" radius={[4, 4, 0, 0]}>
                  {latencyDistribution.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty text="暂无延迟数据" />
          )}
        </div>
      </div>

      {/* Recent Sessions */}
      <div
        className="card"
        style={{ marginBottom: 24, animation: 'fade-in 0.3s ease forwards', animationDelay: '0.2s' }}
      >
        <h3
          style={{
            fontSize: '0.95rem',
            fontWeight: 600,
            color: '#f1f5f9',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <BarChart3 size={16} style={{ color: colors.green }} />
          最近训练记录
        </h3>
        {scoped.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
                  {['客户', '场景', '难度', '评分', '延迟', '轮次', '操作'].map((label) => (
                    <th
                      key={label}
                      style={{
                        textAlign: label === '客户' || label === '场景' ? 'left' : 'center',
                        padding: '8px 12px',
                        color: '#64748b',
                        fontWeight: 500,
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scoped
                  .slice(-10)
                  .reverse()
                  .map((h) => (
                    <tr
                      key={h.session_id}
                      style={{
                        borderBottom: '1px solid rgba(148,163,184,0.05)',
                        transition: 'background 0.2s',
                        cursor: 'pointer',
                      }}
                      onClick={() => setSelectedSession(h)}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(148,163,184,0.03)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>{h.customer_name}</td>
                      <td style={{ padding: '10px 12px', color: '#94a3b8' }}>{h.scenario_name}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span className="badge badge-purple">Lv{h.difficulty}</span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ fontWeight: 600, color: getScoreColor(h.total_score) }}>
                          {h.total_score}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8' }}>
                        {h.avg_ttfa_ms}ms
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8' }}>
                        {h.total_turns}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSession(h);
                          }}
                        >
                          详情
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: '0.875rem' }}>
            暂无训练记录，开始模拟训练后将在此处显示
          </div>
        )}
      </div>

      {/* Session Detail Modal */}
      {selectedSession && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setSelectedSession(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: 600,
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto',
              animation: 'fade-in 0.2s ease forwards',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 20,
              }}
            >
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#f1f5f9', marginBottom: 4 }}>
                  {selectedSession.customer_name}
                </h3>
                <div style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>
                  {selectedSession.scenario_name} · Lv{selectedSession.difficulty}
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedSession(null)}
                style={{ padding: 4, width: 32, height: 32 }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Score */}
            <div
              style={{
                textAlign: 'center',
                padding: '20px 0',
                borderBottom: '1px solid rgba(148,163,184,0.1)',
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: '2.5rem',
                  fontWeight: 700,
                  color: getScoreColor(selectedSession.total_score),
                }}
              >
                {selectedSession.total_score}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
                {getScoreLabel(selectedSession.total_score)}
              </div>
            </div>

            {/* Metrics */}
            <div className="grid-3" style={{ marginBottom: 16 }}>
              {[
                { label: '时长', value: `${Math.floor(selectedSession.duration_seconds / 60)}分${selectedSession.duration_seconds % 60}秒` },
                { label: '对话轮次', value: `${selectedSession.total_turns}轮` },
                { label: '平均延迟', value: `${selectedSession.avg_ttfa_ms}ms` },
              ].map((metric) => (
                <div key={metric.label} style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 4 }}>{metric.label}</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>{metric.value}</div>
                </div>
              ))}
            </div>

            {/* SLA Compliance */}
            {selectedSession.sla_compliance_pct !== undefined && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background:
                    selectedSession.sla_compliance_pct >= 95
                      ? 'rgba(16,185,129,0.1)'
                      : 'rgba(239,68,68,0.1)',
                  marginBottom: 16,
                  fontSize: '0.8125rem',
                }}
              >
                {selectedSession.sla_compliance_pct >= 95 ? (
                  <CheckCircle2 size={14} style={{ color: colors.green }} />
                ) : (
                  <AlertTriangle size={14} style={{ color: colors.red }} />
                )}
                <span style={{ color: '#94a3b8' }}>SLA合规率:</span>
                <span
                  style={{
                    fontWeight: 600,
                    color: selectedSession.sla_compliance_pct >= 95 ? colors.green : colors.red,
                  }}
                >
                  {selectedSession.sla_compliance_pct}%
                </span>
              </div>
            )}

            {/* Evaluation Details */}
            {selectedSession.evaluation && (
              <>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: '#94a3b8',
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Target size={14} />
                  评分维度
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                  {selectedSession.evaluation.dimensions.map((dim) => (
                    <div key={dim.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: '0.8125rem', color: '#f1f5f9' }}>{dim.name}</span>
                        <span
                          style={{ fontSize: '0.8125rem', fontWeight: 600, color: getScoreColor(dim.score * 10) }}
                        >
                          {dim.score}/10
                        </span>
                      </div>
                      <div
                        style={{
                          width: '100%',
                          height: 4,
                          background: 'rgba(148,163,184,0.1)',
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${dim.score * 10}%`,
                            height: '100%',
                            borderRadius: 2,
                            background: `linear-gradient(90deg, ${getScoreColor(dim.score * 10)}, ${colors.blue})`,
                          }}
                        />
                      </div>
                      {dim.comment && (
                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                          {dim.comment}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Strengths & Weaknesses */}
                <div className="grid-2" style={{ marginBottom: 16 }}>
                  <div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: colors.green,
                        marginBottom: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <TrendingUp size={12} />
                      优势
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {selectedSession.evaluation.strengths.map((s, i) => (
                        <li
                          key={i}
                          style={{
                            fontSize: '0.75rem',
                            color: '#94a3b8',
                            marginBottom: 4,
                            display: 'flex',
                            gap: 4,
                          }}
                        >
                          <CheckCircle2 size={10} style={{ color: colors.green, flexShrink: 0, marginTop: 2 }} />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: colors.red,
                        marginBottom: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <TrendingDown size={12} />
                      待提升
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {selectedSession.evaluation.weaknesses.map((w, i) => (
                        <li
                          key={i}
                          style={{
                            fontSize: '0.75rem',
                            color: '#94a3b8',
                            marginBottom: 4,
                            display: 'flex',
                            gap: 4,
                          }}
                        >
                          <AlertTriangle size={10} style={{ color: colors.red, flexShrink: 0, marginTop: 2 }} />
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {selectedSession.evaluation.summary && (
                  <div
                    style={{
                      fontSize: '0.8125rem',
                      color: '#64748b',
                      lineHeight: 1.5,
                      padding: '12px 16px',
                      borderRadius: 8,
                      background: 'rgba(148,163,184,0.05)',
                    }}
                  >
                    {selectedSession.evaluation.summary}
                  </div>
                )}
              </>
            )}

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setSelectedSession(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
