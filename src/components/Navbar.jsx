import PropTypes from 'prop-types'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, PlugZap, Sparkles } from 'lucide-react'

const linkClass = ({ isActive }) =>
  [
    'text-sm font-semibold px-3 py-2 rounded-xl transition-all duration-200 ease-in-out',
    'hover:text-primary hover:bg-mint/60 hover:-translate-y-[1px]',
    isActive ? 'text-primary bg-white/90 border border-outline/80' : 'text-muted',
  ].join(' ')

const Navbar = ({ onToggleSidebar }) => {
  const { pathname } = useLocation()
  const pageLabel =
    pathname === '/crm' ? 'CRM Dashboard' : pathname === '/status' ? 'Job Status' : 'New Job'

  return (
    <header className="sticky top-0 z-30 px-4 py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between rounded-3xl border border-outline/70 bg-white/70 px-4 py-3 shadow-soft backdrop-blur-lg md:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-outline/80 bg-white text-primary transition-all duration-200 hover:-translate-y-[1px] hover:border-primary/50 hover:bg-mint/50"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-muted">LeadFlow</p>
            <p className="text-lg font-semibold text-ink">{pageLabel}</p>
          </div>
        </div>

        <nav className="flex items-center gap-2 md:gap-3">
          <NavLink to="/crm" className={linkClass}>
            CRM
          </NavLink>
          <NavLink to="/status" className={linkClass}>
            Status
          </NavLink>
          <NavLink to="/connections#activate-mcp" className={linkClass}>
            <PlugZap className="h-4 w-4" />
            Activate MCP
          </NavLink>
          <Link
            to="/new-job"
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-brand transition-all duration-200 hover:-translate-y-[1px] hover:bg-primaryDark"
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
