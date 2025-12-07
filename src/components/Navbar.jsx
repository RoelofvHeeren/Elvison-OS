import PropTypes from 'prop-types'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, PlugZap, Sparkles } from 'lucide-react'

const linkClass = ({ isActive }) =>
  [
    'text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-lg transition-all duration-300',
    'hover:text-accent',
    isActive ? 'text-accent border-b-2 border-accent' : 'text-muted border-b-2 border-transparent',
  ].join(' ')

const Navbar = ({ onToggleSidebar }) => {
  const { pathname } = useLocation()
  const pageLabel =
    pathname === '/crm' ? 'CRM Dashboard' : pathname === '/status' ? 'Job Status' : 'New Job'

  return (
    <header className="sticky top-0 z-30 px-8 py-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between rounded-2xl border border-glass-border bg-white/70 px-8 py-4 shadow-luxury backdrop-blur-xl">
        <div className="flex items-center gap-8">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-muted transition-all duration-300 hover:bg-white hover:text-accent hover:shadow-sharp"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500"></div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">System Active</p>
            </div>
            <p className="text-lg font-bold text-accent tracking-tight">{pageLabel}</p>
          </div>
        </div>

        <nav className="flex items-center gap-6">
          <NavLink to="/crm" className={linkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/status" className={linkClass}>
            Status
          </NavLink>
          <NavLink to="/connections#activate-mcp" className={linkClass}>
            <PlugZap className="h-4 w-4" />
            <span className="uppercase tracking-widest text-[10px]">MCP Connect</span>
          </NavLink>
          <Link
            to="/new-job"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-lg transition-all duration-300 hover:bg-primary hover:shadow-xl hover:-translate-y-0.5"
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
