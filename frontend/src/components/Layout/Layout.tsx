import { useState, useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/simulation': 'AI客户模拟',
  '/conversation': '实时对话',
  '/conversation/result': '对话结果',
  '/voice-center': '声音中心',
  '/history': '历史记录',
  '/performance': '能力分析',
  '/knowledge-base': '知识库',
  '/settings': '设置',
  '/docs': '使用说明',
};

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();

  const pageTitle = useMemo(() => {
    return pageTitles[location.pathname] || 'FDE AI';
  }, [location.pathname]);

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        background: '#0a0e1a',
        overflow: 'hidden',
      }}
    >
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 200,
          }}
        />
      )}

      {/* Desktop sidebar */}
      <div className="sidebar-desktop-wrapper">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
        />
      </div>

      {/* Mobile sidebar */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 300,
          transform: mobileSidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 250ms ease',
        }}
      >
        <Sidebar
          collapsed={false}
          onToggle={() => setMobileSidebarOpen(false)}
        />
      </div>

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          position: 'relative',
        }}
      >
        {/* Header */}
        <header
          className="glass"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '12px 24px',
            minHeight: 56,
            borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
            position: 'sticky',
            top: 0,
            zIndex: 50,
          }}
        >
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="btn btn-ghost btn-icon mobile-menu-btn"
          >
            <Menu size={20} />
          </button>

          <h1
            style={{
              fontSize: '1.125rem',
              fontWeight: 600,
              color: '#f1f5f9',
              margin: 0,
            }}
          >
            {pageTitle}
          </h1>
        </header>

        {/* Content */}
        <main
          style={{
            flex: 1,
            overflow: 'auto',
            position: 'relative',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
