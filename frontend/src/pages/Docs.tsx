import { useEffect, useState } from 'react';
import { FileText, Loader2, AlertTriangle } from 'lucide-react';
import { fetchReadme } from '../services/api';

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'li'; text: string; ordered: boolean; marker?: string }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | { kind: 'table'; rows: string[][] };

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function parseMarkdown(md: string): Block[] {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      i += 1;
      continue;
    }

    // 代码块
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    // 分割线
    if (/^-{3,}$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    // 引用
    if (line.startsWith('>')) {
      blocks.push({ kind: 'quote', text: line.replace(/^>\s?/, '') });
      i += 1;
      continue;
    }

    // 表格
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i].trim();
        if (!/^\|[\s\-|:]+\|$/.test(row)) {
          rows.push(splitRow(row));
        }
        i += 1;
      }
      if (rows.length) blocks.push({ kind: 'table', rows });
      continue;
    }

    // 列表
    if (/^[-*]\s+/.test(line)) {
      blocks.push({ kind: 'li', text: line.replace(/^[-*]\s+/, ''), ordered: false });
      i += 1;
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      blocks.push({ kind: 'li', text: line.replace(/^\d+[.)]\s+/, ''), ordered: true });
      i += 1;
      continue;
    }

    blocks.push({ kind: 'p', text: line });
    i += 1;
  }

  // 为连续的有序列表编号，遇到其他块则重新计数
  let seq = 0;
  for (const block of blocks) {
    if (block.kind === 'li' && block.ordered) {
      seq += 1;
      block.marker = `${seq}.`;
    } else {
      seq = 0;
    }
  }

  return blocks;
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} style={{ color: '#f1f5f9' }}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              style={{
                background: 'rgba(148,163,184,0.12)',
                padding: '1px 6px',
                borderRadius: 4,
                fontSize: '0.8125rem',
                color: '#7dd3fc',
              }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default function Docs() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReadme()
      .then((data) => setContent(data?.content || ''))
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={32} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#fca5a5' }}>
          <AlertTriangle size={18} />
          文档加载失败：{error}
        </div>
      </div>
    );
  }

  const blocks = parseMarkdown(content);

  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <FileText size={20} style={{ color: '#3b82f6' }} />
        <h1 className="page-title" style={{ margin: 0 }}>使用说明</h1>
      </div>
      <p style={{ color: '#94a3b8', fontSize: '0.8125rem', marginBottom: 24 }}>
        应用内置文档（README.md），随 exe 一起打包，离线也能查看。
      </p>

      <div className="card" style={{ padding: '24px 28px', lineHeight: 1.9, fontSize: '0.875rem', color: '#cbd5e1' }}>
        {blocks.map((block, idx) => {
          switch (block.kind) {
            case 'h':
              return (
                <div
                  key={idx}
                  style={{
                    fontSize: block.level === 1 ? '1.4rem' : block.level === 2 ? '1.1rem' : '0.95rem',
                    fontWeight: 700,
                    color: '#f1f5f9',
                    margin: block.level === 1 ? '8px 0 16px' : '24px 0 10px',
                    paddingBottom: block.level <= 2 ? 8 : 0,
                    borderBottom: block.level <= 2 ? '1px solid rgba(148,163,184,0.12)' : 'none',
                  }}
                >
                  {block.text}
                </div>
              );
            case 'p':
              return (
                <p key={idx} style={{ margin: '8px 0' }}>
                  <Inline text={block.text} />
                </p>
              );
            case 'li':
              return (
                <div key={idx} style={{ display: 'flex', gap: 8, margin: '4px 0 4px 8px' }}>
                  <span style={{ color: '#3b82f6', minWidth: 14 }}>{block.marker ?? '•'}</span>
                  <span><Inline text={block.text} /></span>
                </div>
              );
            case 'code':
              return (
                <pre
                  key={idx}
                  style={{
                    background: 'rgba(2,6,23,0.7)',
                    border: '1px solid rgba(148,163,184,0.12)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    overflowX: 'auto',
                    fontSize: '0.8125rem',
                    color: '#a5f3fc',
                    margin: '12px 0',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {block.text}
                </pre>
              );
            case 'quote':
              return (
                <div
                  key={idx}
                  style={{
                    borderLeft: '3px solid rgba(59,130,246,0.6)',
                    padding: '6px 12px',
                    margin: '10px 0',
                    background: 'rgba(59,130,246,0.06)',
                    color: '#94a3b8',
                  }}
                >
                  <Inline text={block.text} />
                </div>
              );
            case 'hr':
              return <hr key={idx} style={{ border: 'none', borderTop: '1px solid rgba(148,163,184,0.12)', margin: '20px 0' }} />;
            case 'table':
              return (
                <div key={idx} style={{ overflowX: 'auto', margin: '12px 0' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8125rem' }}>
                    <tbody>
                      {block.rows.map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, c) => (
                            <td
                              key={c}
                              style={{
                                border: '1px solid rgba(148,163,184,0.12)',
                                padding: '6px 10px',
                                fontWeight: r === 0 ? 600 : 400,
                                color: r === 0 ? '#f1f5f9' : '#cbd5e1',
                                background: r === 0 ? 'rgba(148,163,184,0.06)' : 'transparent',
                              }}
                            >
                              <Inline text={cell} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
