import { useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import AgentConfig from './routes/AgentConfig'
import KnowledgeBase from './routes/KnowledgeBase'
import AgentRunner from './routes/AgentRunner'
import CRM from './routes/CRM'
import Connections from './routes/Connections'
import Logbook from './routes/Logbook'
import Onboarding from './routes/Onboarding'

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
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(prev => !prev)} />

      <main className={`flex-1 flex flex-col transition-all duration-300 ${sidebarCollapsed ? 'ml-20' : 'ml-72'}`}>
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 relative h-full">
          <Routes>
            <Route path="/agents" element={<AgentConfig />} />
            <Route path="/knowledge" element={<KnowledgeBase />} />
            <Route path="/runner" element={<AgentRunner />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="/logbook" element={<Logbook />} />
            <Route path="/onboarding" element={<Onboarding />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default App
