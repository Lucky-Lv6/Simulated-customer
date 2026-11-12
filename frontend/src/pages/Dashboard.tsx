import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic,
  Activity,
  Clock,
  Gauge,
  Users,
  Star,
  MessageSquare,
  ArrowRight,
  Zap,
  BarChart3,
} from 'lucide-react';
import { fetchHistory } from '../services/api';
import type { HistoryItem } from '../types';

interface StatsCard {
  title: string;
  value: string;
  change: string;
  icon: React.ReactNode;
  color: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory()
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  const recentHistory = useMemo(() => history.slice(-5).reverse(), [history]);

  const statsCards: StatsCard[] = useMemo(() => {
    const count = history.length;
    const scored = history.filter((h) => typeof h.total_score === 'number' && h.total_score > 0);
    const avgScore = scored.length
      ? scored.reduce((sum, h) => sum + h.total_score, 0) / scored.length
      : 0;
    const totalSeconds = history.reduce((sum, h) => sum + (h.duration_seconds || 0), 0);
    const totalTurns = history.reduce((sum, h) => sum + (h.total_turns || 0), 0);
    const latencies = history
      .map((h) => h.avg_ttfa_ms)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const avgLatency = latencies.length
      ? latencies.reduce((sum, v) => sum + v, 0) / latencies.length
      : 0;

    return [
      {
        title: '模拟次数',
        value: String(count),
        change: count ? `累计 ${totalTurns} 轮对话` : '尚无训练记录',
        icon: <Mic size={20} />,
        color: '#3b82f6',
      },
      {
        title: '平均评分',
        value: scored.length ? avgScore.toFixed(1) : '--',
        change: scored.length ? `基于 ${scored.length} 次评测` : '完成模拟后生成',
        icon: <Star size={20} />,
        color: '#8b5cf6',
      },
      {
        title: '总交流时长',
        value: totalSeconds ? `${(totalSeconds / 3600).toFixed(1)}h` : '0h',
        change: totalSeconds ? `共 ${Math.round(totalSeconds / 60)} 分钟` : '尚无训练记录',
        icon: <Clock size={20} />,
        color: '#06b6d4',
      },
      {
        title: '平均延迟',
        value: avgLatency ? `${(avgLatency / 1000).toFixed(2)}s` : '--',
        change: avgLatency ? '端到端首音频延迟' : '完成模拟后统计',
        icon: <Gauge size={20} />,
        color: '#10b981',
      },
    ];
  }, [history]);

  return (
    <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 32,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            Dashboard
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
            欢迎回来，查看你的客户模拟训练概览
          </p>
        </div>
        <button
          className="btn btn-primary btn-lg"
          onClick={() => navigate('/simulation')}
          style={{ gap: 10 }}
        >
          <Mic size={18} />
          开始模拟训练
          <ArrowRight size={16} />
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid-4" style={{ marginBottom: 32 }}>
        {statsCards.map((card) => (
          <div
            key={card.title}
            className="card"
            style={{
              position: 'relative',
              overflow: 'hidden',
              animation: 'fade-in 0.3s ease forwards',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 80,
                height: 80,
                borderRadius: '0 0 0 80px',
                background: `${card.color}08`,
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: `${card.color}15`,
                  color: card.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {card.icon}
              </div>
              <span style={{ color: '#94a3b8', fontSize: '0.8125rem', fontWeight: 500 }}>
                {card.title}
              </span>
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
              {card.value}
            </div>
            <div style={{ color: '#64748b', fontSize: '0.75rem' }}>{card.change}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions + Recent History */}
      <div
        className="grid-2-responsive"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 24,
        }}
      >
        {/* Quick Actions */}
        <div className="card" style={{ animation: 'fade-in 0.3s ease forwards', animationDelay: '0.1s' }}>
          <h3
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: '#f1f5f9',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Zap size={16} style={{ color: '#f59e0b' }} />
            快速操作
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { icon: Mic, label: '新客户模拟', desc: '选择一个客户场景开始训练', path: '/simulation', color: '#3b82f6' },
              { icon: BarChart3, label: '查看分析报告', desc: '了解你的表现和能力趋势', path: '/performance', color: '#8b5cf6' },
              { icon: Users, label: '浏览客户库', desc: '查看所有可用的客户角色', path: '/voice-center', color: '#06b6d4' },
              { icon: MessageSquare, label: '历史记录', desc: '回顾之前的对话记录', path: '/history', color: '#10b981' },
            ].map((action) => (
              <button
                key={action.label}
                className="btn btn-ghost"
                onClick={() => navigate(action.path)}
                style={{
                  justifyContent: 'flex-start',
                  padding: '12px 16px',
                  height: 'auto',
                  borderRadius: 10,
                  background: 'rgba(148,163,184,0.03)',
                  border: '1px solid transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(148,163,184,0.1)';
                  e.currentTarget.style.background = 'rgba(148,163,184,0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'transparent';
                  e.currentTarget.style.background = 'rgba(148,163,184,0.03)';
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: `${action.color}12`,
                    color: action.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <action.icon size={16} />
                </div>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#f1f5f9' }}>
                    {action.label}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                    {action.desc}
                  </div>
                </div>
                <ArrowRight size={14} style={{ color: '#64748b', flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>

        {/* Recent History */}
        <div className="card" style={{ animation: 'fade-in 0.3s ease forwards', animationDelay: '0.15s' }}>
          <h3
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: '#f1f5f9',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Clock size={16} style={{ color: '#06b6d4' }} />
            最近记录
          </h3>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>加载中...</div>
          ) : recentHistory.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: 40,
                color: '#64748b',
                fontSize: '0.875rem',
              }}
            >
              <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.5 }}>
                <Activity size={32} />
              </div>
              暂无历史记录
              <br />
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => navigate('/simulation')}
              >
                开始第一次模拟
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentHistory.map((item) => (
                <button
                  key={item.session_id}
                  className="btn btn-ghost"
                  onClick={() => navigate('/history')}
                  style={{
                    justifyContent: 'flex-start',
                    padding: '10px 12px',
                    height: 'auto',
                    borderRadius: 8,
                    fontSize: '0.8125rem',
                  }}
                >
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <span style={{ color: '#f1f5f9', fontWeight: 500 }}>
                      {item.customer_name}
                    </span>
                    <span style={{ color: '#64748b', marginLeft: 8 }}>
                      {item.scenario_name} · Lv{item.difficulty}
                    </span>
                  </div>
                  <div
                    className="badge badge-blue"
                    style={{ flexShrink: 0 }}
                  >
                    {item.total_score}分
                  </div>
                  <ArrowRight size={14} style={{ color: '#64748b', marginLeft: 8, flexShrink: 0 }} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}