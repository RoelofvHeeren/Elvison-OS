import PropTypes from 'prop-types'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ListChecks, Plug, Sparkles, Table, Wand2 } from 'lucide-react'

const navItems = [
  { to: '/crm', label: 'CRM', icon: LayoutDashboard },
  { to: '/status', label: 'Status', icon: ListChecks },
  { to: '/new-job', label: 'New Job', icon: Wand2 },
  { to: '/sheet', label: 'Sheet', icon: Table },
  { to: '/connections', label: 'Connections', icon: Plug },
]

const Sidebar = ({ collapsed, onToggle }) => (
  <aside
    className={`relative flex h-screen flex-col border-r border-glass-border bg-glass backdrop-blur-xl ${collapsed ? 'w-20' : 'w-64'
      } transition-all duration-300`}
  >
    <div className="flex items-center gap-3 px-4 py-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/20 text-primary shadow-glow-sm">
        <Sparkles className="h-5 w-5" />
      </div>
      {!collapsed && (
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-muted">LeadFlow</p>
          <p className="text-lg font-semibold text-white">Console</p>
        </div>
      )}
    </div>

    <nav className="mt-4 flex flex-1 flex-col gap-2 px-3">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-semibold transition-all duration-200',
                isActive
                  ? 'border-primary/20 bg-primary/10 text-primary shadow-glow-sm'
                  : 'border-transparent text-muted hover:border-primary/10 hover:bg-white/5 hover:text-gray-200',
              ].join(' ')
            }
          >
            <Icon className="h-4 w-4" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        )
      })}
    </nav>

    <div className="px-3 pb-5">
      <button
        type="button"
        onClick={onToggle}
        className="chip w-full justify-center text-sm font-semibold"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? 'Expand' : 'Collapse'}
      </button>
    </div>
  </aside>
)

Sidebar.propTypes = {
  collapsed: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
}

export default Sidebar
