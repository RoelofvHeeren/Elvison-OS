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
import { IcpProvider } from './context/IcpContext'
import Profile from './routes/Profile'
import Optimize from './routes/Optimize'

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
  // UNLESS accessing /onboarding (create/edit) or /profile (manage)
  if (!user.onboardingCompleted && location.pathname !== '/onboarding' && location.pathname !== '/profile') {
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

  if (loading) return null

  const isAuthPage = ['/login', '/signup', '/onboarding'].includes(location.pathname)

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 overflow-hidden font-sans">
      {!isAuthPage && user && <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />}

      <main className={`flex-1 overflow-auto transition-all duration-300 ${!isAuthPage && user ? 'p-0' : ''}`}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

          <Route path="/runner" element={<ProtectedRoute><AgentRunner /></ProtectedRoute>} />
          <Route path="/crm" element={<ProtectedRoute><CRM /></ProtectedRoute>} />
          <Route path="/connections" element={<ProtectedRoute><Connections /></ProtectedRoute>} />
          <Route path="/kb" element={<ProtectedRoute><KnowledgeBase /></ProtectedRoute>} />
          <Route path="/agents" element={<ProtectedRoute><AgentConfig /></ProtectedRoute>} />
          <Route path="/logbook" element={<ProtectedRoute><Logbook /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/optimize" element={<ProtectedRoute><Optimize /></ProtectedRoute>} />

          <Route path="/" element={<div />} />
        </Routes>
      </main>
    </div>
  )
}

const App = () => {
  return (
    <AuthProvider>
      <IcpProvider>
        <AppContent />
      </IcpProvider>
    </AuthProvider>
  )
}

export default App
