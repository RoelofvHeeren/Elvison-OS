import PropTypes from 'prop-types'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ListChecks, Plug, Sparkles, Table, Wand2 } from 'lucide-react'

const navItems = [
  { to: '/crm', label: 'CRM', icon: LayoutDashboard },
  { to: '/new-job', label: 'New Job', icon: Wand2 },
  { to: '/connections', label: 'Connections', icon: Plug },
]

const Sidebar = ({ collapsed, onToggle }) => (
  <aside
    className={`relative flex h-screen flex-col border-r border-glass-border bg-white shadow-luxury ${collapsed ? 'w-20' : 'w-72'
      } transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] z-50`}
  >
    <div className="flex items-center gap-4 px-8 py-10">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20">
        <Sparkles className="h-5 w-5" />
      </div>
      {!collapsed && (
        <div className="flex flex-col">
          <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted">Elvison OS</p>
          <p className="text-xl font-bold tracking-tight text-accent">Elvison OS</p>
        </div>
      )}
    </div>

    <nav className="mt-8 flex flex-1 flex-col gap-2 px-4">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [
                'group flex items-center gap-4 rounded-xl px-4 py-3.5 text-sm font-medium transition-all duration-300',
                isActive
                  ? 'bg-surface text-primary shadow-sharp'
                  : 'text-muted hover:bg-surface/50 hover:text-accent',
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
