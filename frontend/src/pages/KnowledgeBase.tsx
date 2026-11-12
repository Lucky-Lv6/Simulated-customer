import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Search,
  Building2,
  Bot,
  HelpCircle,
  Puzzle,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { fetchKnowledgeSearch, fetchKnowledgeCategories, fetchKnowledgeItems } from '../services/api';

interface KnowledgeItem {
  id: string;
  category: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  relevance_score?: number;
}

interface KnowledgeCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  count: number;
}

const iconMap: Record<string, React.ReactNode> = {
  building: <Building2 size={18} />,
  bot: <Bot size={18} />,
  help: <HelpCircle size={18} />,
  puzzle: <Puzzle size={18} />,
  file: <FileText size={18} />,
};

const categoryColors: Record<string, string> = {
  feishu: '#3b82f6',
  doubao: '#8b5cf6',
  faq: '#06b6d4',
  solutions: '#10b981',
};

export default function KnowledgeBase() {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('feishu');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  // Load data from backend
  useEffect(() => {
    Promise.all([
      fetchKnowledgeCategories().catch(() => []),
      fetchKnowledgeItems().catch(() => []),
    ])
      .then(([cats, allItems]) => {
        if (Array.isArray(cats)) setCategories(cats);
        if (Array.isArray(allItems)) setItems(allItems);
      })
      .finally(() => setLoading(false));
  }, []);

  // Search handler
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setSearchError(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const results = await fetchKnowledgeSearch(searchQuery);
        if (Array.isArray(results)) {
          setSearchResults(results);
        } else {
          setSearchResults(null);
        }
      } catch {
        // Fallback: local search
        setSearchError(true);
        const localResults = localSearch(searchQuery, items);
        setSearchResults(localResults);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, items]);

  const toggleCategory = (id: string) => {
    setExpandedCategory(expandedCategory === id ? null : id);
    setExpandedItem(null);
  };

  const toggleItem = (id: string) => {
    setExpandedItem(expandedItem === id ? null : id);
  };

  const handleSearchResultClick = (item: KnowledgeItem) => {
    setExpandedItem(item.id);
    if (item.category) {
      setExpandedCategory(item.category);
    }
    setSearchQuery('');
    setSearchResults(null);
  };

  const getCategoryItems = (catId: string): KnowledgeItem[] => {
    return items.filter((i) => i.category === catId);
  };

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto' }}>
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
          <h1 className="page-title" style={{ marginBottom: 4 }}>知识库</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
            飞书与豆包企业版产品知识，助你更好完成客户模拟
          </p>
        </div>
        <div className="card-glass" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', minWidth: 240 }}>
          <Search size={16} style={{ color: '#64748b' }} />
          <input
            className="input"
            placeholder="搜索知识库..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: 'none', background: 'transparent', padding: '4px 0', fontSize: '0.8125rem' }}
          />
          {searching && (
            <Loader2 size={14} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
          )}
        </div>
      </div>

      {/* Search Results */}
      {searchResults !== null && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Search size={12} />
            {searchError ? '本地搜索' : 'RAG搜索'} 结果 ({searchResults.length})
            {searchError && (
              <span style={{ color: '#f59e0b', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={10} />
                后端API不可用，使用本地搜索
              </span>
            )}
          </div>
          {searchResults.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
              <Search size={24} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
              未找到相关内容
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  className="btn btn-ghost"
                  onClick={() => handleSearchResultClick(item)}
                  style={{
                    justifyContent: 'flex-start',
                    padding: '10px 14px',
                    height: 'auto',
                    borderRadius: 8,
                  }}
                >
                  <FileText size={14} style={{ color: categoryColors[item.category] || '#3b82f6', flexShrink: 0 }} />
                  <div style={{ textAlign: 'left', marginLeft: 8, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '0.875rem', color: '#f1f5f9', fontWeight: 500 }}>{item.title}</span>
                      {item.relevance_score !== undefined && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: item.relevance_score > 5 ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.1)',
                            color: item.relevance_score > 5 ? '#10b981' : '#64748b',
                          }}
                        >
                          {Math.round(item.relevance_score * 10)}%
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{item.summary}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {item.tags.slice(0, 2).map((t) => (
                      <span key={t} className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category accordion */}
      {categories.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b', fontSize: '0.875rem' }}>
          <FileText size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          知识库暂无内容
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {categories.map((category) => {
          const catItems = getCategoryItems(category.id);
          const color = categoryColors[category.id] || '#3b82f6';

          return (
            <div key={category.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Category header */}
              <button
                onClick={() => toggleCategory(category.id)}
                className="btn btn-ghost"
                style={{
                  width: '100%',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  height: 'auto',
                  borderRadius: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: `${color}15`,
                      color: color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {iconMap[category.icon] || <FileText size={18} />}
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#f1f5f9' }}>
                      {category.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {catItems.length} 篇文章
                    </div>
                  </div>
                </div>
                {expandedCategory === category.id ? (
                  <ChevronDown size={16} style={{ color: '#64748b' }} />
                ) : (
                  <ChevronRight size={16} style={{ color: '#64748b' }} />
                )}
              </button>

              {/* Items */}
              {expandedCategory === category.id && (
                <div style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
                  {catItems.map((item) => (
                    <div key={item.id}>
                      <button
                        onClick={() => toggleItem(item.id)}
                        className="btn btn-ghost"
                        style={{
                          width: '100%',
                          justifyContent: 'space-between',
                          padding: '12px 20px 12px 68px',
                          height: 'auto',
                          borderRadius: 0,
                        }}
                      >
                        <div style={{ textAlign: 'left', flex: 1 }}>
                          <div style={{ fontSize: '0.875rem', color: '#f1f5f9', fontWeight: 500, marginBottom: 2 }}>
                            {item.title}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{item.summary}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {item.tags.slice(0, 2).map((t) => (
                              <span key={t} className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
                                {t}
                              </span>
                            ))}
                          </div>
                          {expandedItem === item.id ? (
                            <ChevronDown size={14} style={{ color: '#64748b', marginLeft: 8 }} />
                          ) : (
                            <ChevronRight size={14} style={{ color: '#64748b', marginLeft: 8 }} />
                          )}
                        </div>
                      </button>

                      {expandedItem === item.id && (
                        <div
                          style={{
                            padding: '0 20px 16px 68px',
                            fontSize: '0.8125rem',
                            color: '#94a3b8',
                            lineHeight: 1.7,
                          }}
                        >
                          <div
                            style={{
                              padding: '12px 16px',
                              background: 'rgba(148,163,184,0.03)',
                              borderRadius: 8,
                              border: '1px solid rgba(148,163,184,0.06)',
                            }}
                          >
                            {item.content}
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                            {item.tags.map((t) => (
                              <span key={t} className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {catItems.length === 0 && (
                    <div style={{ padding: '16px 20px 16px 68px', color: '#64748b', fontSize: '0.8125rem' }}>
                      暂无内容
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Local fallback search
function localSearch(query: string, items: KnowledgeItem[]): KnowledgeItem[] {
  const q = query.toLowerCase();
  return items
    .filter((item) => {
      const text = `${item.title} ${item.summary} ${item.content} ${item.tags.join(' ')}`.toLowerCase();
      return text.includes(q);
    })
    .map((item) => ({
      ...item,
      relevance_score: item.title.toLowerCase().includes(q) ? 8 : 5,
    }));
}
