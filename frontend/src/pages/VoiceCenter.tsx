import { useState, useEffect } from 'react';
import {
  Headphones,
  Play,
  CheckCircle2,
  Volume2,
  Tag,
  Loader2,
  Search,
} from 'lucide-react';
import { fetchVoices, previewVoice } from '../services/api';
import { playHexAudio } from '../utils/audio';
import type { Voice } from '../types';

export default function VoiceCenter() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(
    () => sessionStorage.getItem('selected_voice')
  );
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchVoices()
      .then((data) => setVoices(Array.isArray(data) ? data : []))
      .catch(() => setVoices([]))
      .finally(() => setLoading(false));
  }, []);

  const handlePreview = async (voiceId: string) => {
    setPreviewing(voiceId);
    try {
      const result = await previewVoice(voiceId, '您好，我是AI客户模拟助手，很高兴为您服务。');
      if (!result?.audio || !(await playHexAudio(result.audio))) {
        console.warn('试听失败：未获取到可播放的音频数据');
      }
    } catch {
      console.warn('试听失败：TTS 服务不可用');
    } finally {
      setPreviewing(null);
    }
  };

  const handleSelect = (voiceId: string) => {
    setSelectedVoice(voiceId);
    // Save to sessionStorage for use in simulation
    sessionStorage.setItem('selected_voice', voiceId);
  };

  const filteredVoices = voices.filter(
    (v) =>
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
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
            声音中心
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
            选择AI客户的声音，预览并设置默认声音
          </p>
        </div>
        <div className="card-glass" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', minWidth: 240 }}>
          <Search size={16} style={{ color: '#64748b' }} />
          <input
            className="input"
            placeholder="搜索声音..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: 'none', background: 'transparent', padding: '4px 0', fontSize: '0.8125rem' }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        {filteredVoices.map((voice, index) => (
          <div
            key={voice.id}
            className="card"
            style={{
              animation: 'fade-in 0.3s ease forwards',
              animationDelay: `${index * 0.05}s`,
              opacity: 0,
              position: 'relative',
              border: selectedVoice === voice.id
                ? '1px solid rgba(59,130,246,0.4)'
                : '1px solid rgba(148,163,184,0.1)',
              boxShadow: selectedVoice === voice.id ? '0 0 20px rgba(59,130,246,0.1)' : 'none',
            }}
          >
            {selectedVoice === voice.id && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  background: 'rgba(59,130,246,0.15)',
                  color: '#3b82f6',
                  padding: '2px 10px',
                  borderRadius: 9999,
                  fontSize: '0.7rem',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CheckCircle2 size={12} />
                当前使用
              </div>
            )}

            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(6,182,212,0.15))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Volume2 size={22} style={{ color: '#8b5cf6' }} />
            </div>

            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f1f5f9', marginBottom: 4 }}>
              {voice.name}
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', marginBottom: 12, lineHeight: 1.5 }}>
              {voice.description}
            </p>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {voice.tags.map((tag) => (
                <span key={tag} className="badge badge-blue" style={{ fontSize: '0.7rem' }}>
                  <Tag size={10} style={{ marginRight: 2 }} />
                  {tag}
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={`btn ${previewing === voice.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => handlePreview(voice.id)}
                disabled={previewing === voice.id}
              >
                {previewing === voice.id ? (
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Play size={14} />
                )}
                {previewing === voice.id ? '播放中...' : '试听'}
              </button>
              <button
                className={`btn ${selectedVoice === voice.id ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1 }}
                onClick={() => handleSelect(voice.id)}
              >
                {selectedVoice === voice.id ? '已选择' : '选择'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredVoices.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
          <Headphones size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          <div>未找到匹配的声音</div>
        </div>
      )}
    </div>
  );
}
