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
    className={`relative flex h-screen flex-col border-r border-glass-border bg-black/80 backdrop-blur-xl shadow-hud ${collapsed ? 'w-20' : 'w-72'
      } transition-all duration-300 z-50`}
  >
    <div className="flex items-center gap-4 px-6 py-8">
      <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-primary bg-primary/10 text-primary shadow-neon">
        <Sparkles className="h-6 w-6 animate-pulse" />
        <div className="absolute inset-0 rounded-full border border-primary opacity-50 blur-[2px]"></div>
      </div>
      {!collapsed && (
        <div className="flex flex-col">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-primary-dim">Elvison OS</p>
          <p className="text-xl font-bold tracking-wider text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">JARVIS</p>
        </div>
      )}
    </div>

    <nav className="mt-8 flex flex-1 flex-col gap-3 px-4">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [
                'group flex items-center gap-4 rounded-lg border px-4 py-4 text-sm font-bold uppercase tracking-wider transition-all duration-300',
                isActive
                  ? 'border-primary bg-primary/10 text-primary shadow-neon'
                  : 'border-transparent text-muted hover:border-primary/30 hover:bg-primary/5 hover:text-primary-glow',
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
