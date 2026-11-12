import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Mic,
  Headphones,
  History,
  BarChart3,
  BookOpen,
  Settings,
  ChevronRight,
  FileText,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/simulation', icon: Mic, label: 'AI客户模拟' },
  { to: '/voice-center', icon: Headphones, label: '声音中心' },
  { to: '/history', icon: History, label: '历史记录' },
  { to: '/performance', icon: BarChart3, label: '能力分析' },
  { to: '/knowledge-base', icon: BookOpen, label: '知识库' },
  { to: '/docs', icon: FileText, label: '使用说明' },
  { to: '/settings', icon: Settings, label: '设置' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className="sidebar"
      style={{
        width: collapsed ? 64 : 240,
        background: '#0a0e1a',
        borderRight: '1px solid rgba(148, 163, 184, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 250ms ease',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        zIndex: 100,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: collapsed ? '16px 12px' : '20px 20px 16px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minHeight: 64,
        }}
      >
        {!collapsed && (
          <div style={{ flex: 1 }}>
            <div
              className="text-gradient"
              style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}
            >
              FDE AI
            </div>
            <div
              style={{
                fontSize: '0.7rem',
                color: '#64748b',
                marginTop: 2,
                letterSpacing: '0.05em',
              }}
            >
              智能客户模拟中心
            </div>
          </div>
        )}
        {collapsed && (
          <div
            className="text-gradient"
            style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 auto' }}
          >
            F
          </div>
        )}
      </div>

      {/* Nav Items */}
      <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: collapsed ? '10px 0' : '10px 12px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderRadius: 8,
              textDecoration: 'none',
              color: isActive ? '#f1f5f9' : '#94a3b8',
              background: isActive
                ? 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))'
                : 'transparent',
              border: isActive ? '1px solid rgba(59,130,246,0.2)' : '1px solid transparent',
              transition: 'all 150ms ease',
              fontSize: '0.875rem',
              fontWeight: isActive ? 500 : 400,
              position: 'relative',
            })}
            onMouseEnter={(e) => {
              if (!e.currentTarget.className.includes('active')) {
                e.currentTarget.style.background = 'rgba(148,163,184,0.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.currentTarget.className.includes('active')) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <item.icon size={18} />
            {!collapsed && <span>{item.label}</span>}
            {!collapsed && (
              <ChevronRight
                size={14}
                style={{ marginLeft: 'auto', opacity: 0.3 }}
              />
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse Toggle */}
      <button
        onClick={onToggle}
        className="btn btn-ghost btn-sm"
        style={{
          margin: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 250ms ease',
        }}
        title={collapsed ? '展开侧边栏' : '收起侧边栏'}
      >
        <ChevronRight size={16} />
      </button>
    </aside>
  );
}
