import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  MessageSquare,
  ChevronRight,
  Loader2,
  Search,
  Calendar,
} from 'lucide-react';
import { fetchHistory } from '../services/api';
import { formatDuration, getScoreColor } from '../utils/format';
import type { HistoryItem } from '../types';

export default function History() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'score' | 'duration'>('date');
  const [filterDifficulty, setFilterDifficulty] = useState<number | null>(null);

  useEffect(() => {
    fetchHistory()
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return history
      .filter((item) => {
        if (filterDifficulty && item.difficulty !== filterDifficulty) return false;
        if (!q) return true;
        return (
          item.customer_name.toLowerCase().includes(q) ||
          item.scenario_name.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'score':
            return b.total_score - a.total_score;
          case 'duration':
            return b.duration_seconds - a.duration_seconds;
          default: {
            const ta = a.created_at ? Date.parse(a.created_at) : 0;
            const tb = b.created_at ? Date.parse(b.created_at) : 0;
            return tb - ta;
          }
        }
      });
  }, [history, searchQuery, sortBy, filterDifficulty]);

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 className="page-title">历史记录</h1>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 24,
          alignItems: 'center',
        }}
      >
        <div className="card-glass" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ color: '#64748b' }} />
          <input
            className="input"
            placeholder="搜索客户或场景..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: 'none', background: 'transparent', padding: '4px 0', fontSize: '0.8125rem' }}
          />
        </div>

        <select
          className="select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          style={{ width: 'auto', minWidth: 120, padding: '8px 28px 8px 12px', fontSize: '0.8125rem' }}
        >
          <option value="date">按日期</option>
          <option value="score">按评分</option>
          <option value="duration">按时长</option>
        </select>

        <select
          className="select"
          value={filterDifficulty ?? ''}
          onChange={(e) => setFilterDifficulty(e.target.value ? Number(e.target.value) : null)}
          style={{ width: 'auto', minWidth: 100, padding: '8px 28px 8px 12px', fontSize: '0.8125rem' }}
        >
          <option value="">全部难度</option>
          {[1, 2, 3, 4, 5].map((d) => (
            <option key={d} value={d}>Lv{d}</option>
          ))}
        </select>
      </div>

      {/* History List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
          <Clock size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          <div>暂无历史记录</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((item, index) => (
            <button
              key={item.session_id}
              className="card glass-hover"
              onClick={() => {
                sessionStorage.setItem('conversation_result', JSON.stringify({
                  evaluation: item.evaluation || {
                    total_score: item.total_score,
                    dimensions: [],
                    strengths: [],
                    weaknesses: [],
                    summary: '',
                  },
                  stats: item,
                  transcripts: item.transcripts || [],
                }));
                navigate('/conversation/result');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '14px 20px',
                cursor: 'pointer',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                animation: 'fade-in 0.3s ease forwards',
                animationDelay: `${index * 0.03}s`,
                opacity: 0,
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'rgba(59,130,246,0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.2rem',
                  flexShrink: 0,
                }}
              >
                🧑‍💼
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#f1f5f9', marginBottom: 4 }}>
                  {item.customer_name}
                  <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 8, fontSize: '0.8125rem' }}>
                    {item.scenario_name}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: '0.75rem', color: '#64748b', flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Calendar size={12} />
                    {(item.created_at
                      ? new Date(item.created_at).toLocaleDateString('zh-CN')
                      : new Date().toLocaleDateString('zh-CN'))}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} />
                    {formatDuration(item.duration_seconds)}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MessageSquare size={12} />
                    {item.total_turns}轮
                  </span>
                  <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
                    Lv{item.difficulty}
                  </span>
                </div>
              </div>

              {/* Score */}
              <div
                style={{
                  textAlign: 'center',
                  flexShrink: 0,
                  padding: '0 12px',
                }}
              >
                <div
                  style={{
                    fontSize: '1.3rem',
                    fontWeight: 700,
                    color: getScoreColor(item.total_score),
                  }}
                >
                  {item.total_score}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#64748b' }}>分</div>
              </div>

              <ChevronRight size={16} style={{ color: '#64748b', flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}

      {/* Stats footer */}
      {history.length > 0 && (
        <div
          className="card-glass"
          style={{
            marginTop: 24,
            padding: '12px 20px',
            display: 'flex',
            justifyContent: 'space-around',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4 }}>总模拟次数</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#f1f5f9' }}>{history.length}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4 }}>平均评分</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#10b981' }}>
              {Math.round(history.reduce((a, b) => a + b.total_score, 0) / history.length)}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4 }}>总时长</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#f1f5f9' }}>
              {formatDuration(history.reduce((a, b) => a + b.duration_seconds, 0))}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4 }}>平均延迟</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#3b82f6' }}>
              {Math.round(history.reduce((a, b) => a + b.avg_ttfa_ms, 0) / history.length)}ms
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
