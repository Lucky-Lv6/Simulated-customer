import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout/Layout'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Simulation = lazy(() => import('./pages/Simulation'))
const RealtimeConversation = lazy(() => import('./pages/RealtimeConversation'))
const ConversationResult = lazy(() => import('./pages/ConversationResult'))
const VoiceCenter = lazy(() => import('./pages/VoiceCenter'))
const History = lazy(() => import('./pages/History'))
const Performance = lazy(() => import('./pages/Performance'))
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'))
const Settings = lazy(() => import('./pages/Settings'))
const Docs = lazy(() => import('./pages/Docs'))

export default function App() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: '0.875rem',
          }}
        >
          页面加载中...
        </div>
      }
    >
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/simulation" element={<Simulation />} />
          <Route path="/conversation" element={<RealtimeConversation />} />
          <Route path="/conversation/result" element={<ConversationResult />} />
          <Route path="/voice-center" element={<VoiceCenter />} />
          <Route path="/history" element={<History />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/knowledge-base" element={<KnowledgeBase />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/docs" element={<Docs />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
