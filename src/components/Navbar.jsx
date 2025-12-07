import PropTypes from 'prop-types'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, PlugZap, Sparkles } from 'lucide-react'

const linkClass = ({ isActive }) =>
  [
    'text-xs font-bold uppercase tracking-wider px-4 py-3 rounded-lg transition-all duration-300 border',
    'hover:border-primary/50 hover:bg-primary/5 hover:text-primary hover:shadow-neon',
    isActive ? 'border-primary bg-primary/10 text-primary shadow-neon' : 'border-transparent text-muted',
  ].join(' ')

const Navbar = ({ onToggleSidebar }) => {
  const { pathname } = useLocation()
  const pageLabel =
    pathname === '/crm' ? 'CRM_DASHBOARD' : pathname === '/status' ? 'JOB_STATUS' : 'NEW_JOB_PROTOCOL'

  return (
    <header className="sticky top-0 z-30 px-6 py-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between rounded-xl border border-glass-border bg-black/80 px-6 py-4 shadow-hud backdrop-blur-xl">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex h-12 w-12 items-center justify-center rounded-lg border border-glass-border bg-glass text-primary-glow transition-all duration-300 hover:border-primary hover:bg-primary/10 hover:text-primary hover:shadow-neon"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary shadow-neon animate-pulse"></div>
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-primary-dim">SYSTEM_ACTIVE</p>
            </div>
            <p className="font-mono text-lg font-bold text-white tracking-widest">{pageLabel}</p>
          </div>
        </div>

        <nav className="flex items-center gap-4">
          <NavLink to="/crm" className={linkClass}>
            CRM
          </NavLink>
          <NavLink to="/status" className={linkClass}>
            STATUS
          </NavLink>
          <NavLink to="/connections#activate-mcp" className={linkClass}>
            <PlugZap className="h-4 w-4" />
            <span className="uppercase">Connect_MCP</span>
          </NavLink>
          <Link
            to="/new-job"
            className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary/10 px-6 py-3 text-xs font-bold uppercase tracking-widest text-primary shadow-neon transition-all duration-300 hover:bg-primary hover:text-black"
          >
            <Sparkles className="h-4 w-4" />
            Start New Job
          </Link>
        </nav>
      </div>
    </header>
  )
}

Navbar.propTypes = {
  onToggleSidebar: PropTypes.func.isRequired,
}

export default Navbar
