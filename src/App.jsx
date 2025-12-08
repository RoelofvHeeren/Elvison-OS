import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import CRM from './routes/CRM'
import Connections from './routes/Connections'
import NewJob from './routes/NewJob'

const App = () => {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <BrowserRouter>
      <div className="flex min-h-screen text-gray-200">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
        <div className={`flex min-h-screen flex-1 flex-col transition-[margin] duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] ${collapsed ? 'ml-20' : 'ml-72'}`}>
          <Navbar onToggleSidebar={() => setCollapsed((v) => !v)} />
          <main className="pb-12">
            <div className="mx-auto max-w-6xl px-4 sm:px-8">
              <Routes>
                <Route path="/" element={<Navigate to="/crm" replace />} />
                <Route path="/crm" element={<CRM />} />
                <Route path="/new-job" element={<NewJob />} />
                <Route path="/connections" element={<Connections />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </BrowserRouter>
  )
}

export default App
