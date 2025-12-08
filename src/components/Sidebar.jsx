import PropTypes from 'prop-types'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ListChecks, Plug, Sparkles, Table, Wand2 } from 'lucide-react'

const navItems = [
  { to: '/crm', label: 'CRM', icon: LayoutDashboard },
  { to: '/new-job', label: 'New Job', icon: Wand2 },
  { to: '/connections', label: 'Connections', icon: Plug },
]

const Sidebar = ({ collapsed }) => (
  <aside
    className={`fixed inset-y-0 left-0 z-50 flex h-screen flex-col border-r border-glass-border bg-white px-6 py-8 shadow-2xl ${collapsed ? 'w-20' : 'w-72'
      } transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)]`}
  >
    <div className={`mb-10 flex items-center gap-3 px-2 ${collapsed ? 'justify-center' : ''}`}>
      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-black shadow-luxury group overflow-hidden">
        <img src="/logo-columns.png" alt="Elvison OS" className="h-8 w-8 object-contain opacity-90" />
        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
      </div>
      {!collapsed && (
        <div className="flex flex-col whitespace-nowrap overflow-hidden transition-all duration-300">
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted font-medium">Elvison OS</span>
          <span className="font-serif text-2xl font-bold tracking-tight text-primary">Elvison OS</span>
        </div>
      )}
    </div>

    <nav className="flex flex-1 flex-col gap-2">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-lg px-4 py-3.5 text-sm font-medium transition-all duration-300 ${isActive
              ? 'bg-primary text-white shadow-3d translate-x-1'
              : 'text-muted hover:bg-surface hover:text-primary hover:translate-x-1'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon
                className={`h-5 w-5 shrink-0 transition-transform duration-300 group-hover:scale-110 ${isActive ? 'text-white' : 'text-teal-accent group-hover:drop-shadow-[0_0_8px_rgba(19,145,135,0.4)]'
                  }`}
              />
              {!collapsed && <span className="tracking-wide whitespace-nowrap overflow-hidden">{item.label}</span>}
              {isActive && (
                <div className="absolute inset-y-0 right-0 w-1 rounded-l-full bg-white/20" />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  </aside>
)

Sidebar.propTypes = {
  collapsed: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
}

export default Sidebar
