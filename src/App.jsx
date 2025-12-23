import { useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import AgentConfig from './routes/AgentConfig'
import KnowledgeBase from './routes/KnowledgeBase'
import AgentRunner from './routes/AgentRunner'
import CRM from './routes/CRM'
import Connections from './routes/Connections'
import Logbook from './routes/Logbook'
import Onboarding from './routes/Onboarding'
import Login from './routes/Login'
import Signup from './routes/Signup'
import { AuthProvider, useAuth } from './contexts/AuthContext'

// Protected Route wrapper
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // If user hasn't completed onboarding, redirect to onboarding
  if (!user.onboardingCompleted && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return children
}

const AppContent = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading) return

    // Redirect logic
    if (!user && location.pathname === '/') {
      navigate('/login')
    } else if (user && location.pathname === '/') {
      if (!user.onboardingCompleted) {
        navigate('/onboarding')
      } else {
        navigate('/runner')
      }
    }
  }, [location, navigate, user, loading])

  // Public routes (login/signup)
  const isPublicRoute = ['/login', '/signup'].includes(location.pathname)

  if (isPublicRoute) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
      </Routes>
    )
  }

  // Protected routes with sidebar
  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(prev => !prev)} />

      <main className={`flex-1 flex flex-col transition-all duration-300 ${sidebarCollapsed ? 'ml-20' : 'ml-72'}`}>
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 relative h-full">
          <Routes>
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/agents" element={<ProtectedRoute><AgentConfig /></ProtectedRoute>} />
            <Route path="/knowledge" element={<ProtectedRoute><KnowledgeBase /></ProtectedRoute>} />
            <Route path="/runner" element={<ProtectedRoute><AgentRunner /></ProtectedRoute>} />
            <Route path="/crm" element={<ProtectedRoute><CRM /></ProtectedRoute>} />
            <Route path="/connections" element={<ProtectedRoute><Connections /></ProtectedRoute>} />
            <Route path="/logbook" element={<ProtectedRoute><Logbook /></ProtectedRoute>} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

const App = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
