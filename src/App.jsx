import { useRef, useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import AgentConfig from './routes/AgentConfig'
import KnowledgeBase from './routes/KnowledgeBase'
import AgentRunner from './routes/AgentRunner'

const App = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/runner')
    }
  }, [location, navigate])

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />

      <main className={`flex-1 flex flex-col transition-all duration-300 ${sidebarCollapsed ? 'ml-20' : 'ml-0'}`}>
        {/* Top Navbar */}
        <div className="h-16 border-b border-white/10 bg-surface/50 backdrop-blur-md flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-400">Environment:</span>
            <span className="px-2 py-0.5 rounded text-xs bg-[#139187]/10 text-[#139187] border border-[#139187]/20 font-mono">
              Development
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-[#139187] to-cyan-400"></div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden p-6 relative">
          <Routes>
            <Route path="/agents" element={<AgentConfig />} />
            <Route path="/knowledge" element={<KnowledgeBase />} />
            <Route path="/runner" element={<AgentRunner />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default App
