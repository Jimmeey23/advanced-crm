import React, { useState } from 'react'
import {
  LayoutDashboard, KanbanSquare, Users, UploadCloud, Settings, Search,
  Bell, Plus, Zap, Link2, ShieldCheck, Sun, Moon, BarChart3
} from 'lucide-react'
import { AppProvider, Toasts, useApp } from './store.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Performance from './pages/Performance.jsx'
import Pipeline from './pages/Pipeline.jsx'
import Leads from './pages/Leads.jsx'
import Import from './pages/Import.jsx'
import Team from './pages/Team.jsx'
import SettingsPage from './pages/Settings.jsx'
import LeadDrawer from './components/LeadDrawer.jsx'
import AddLeadModal from './components/AddLeadModal.jsx'
import AlertsDropdown from './components/AlertsDropdown.jsx'
import Logo from './components/Logo.jsx'

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
  { id: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
  { id: 'leads', label: 'Leads', icon: Users },
  { id: 'import', label: 'Import CSV', icon: UploadCloud },
  { id: 'team', label: 'Team & Studios', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings }
]

function Sidebar() {
  const { view, navigate, boot, alerts } = useApp()
  const momenceOn = boot?.settings?.momence?.configured || boot?.settings?.momence?.connected
  const rrEnabled = boot?.settings?.roundRobin?.enabled
  const highCount = alerts.filter(a => a.level === 'high').length

  return (
    <aside className="w-[248px] shrink-0 h-full flex flex-col border-r border-white/6 bg-[#0a0d18]/80 backdrop-blur-xl">
      <div className="px-5 pt-6 pb-5 flex items-center gap-3">
        <Logo size={40} />
        <div>
          <div className="font-display font-bold text-white leading-tight text-[15px]">{boot?.settings?.org?.name || 'Lead Studio'}</div>
          <div className="text-[11px] text-slate-400 -mt-0.5 tracking-wide">{boot?.settings?.org?.brand || 'PHYSIQUE 57'}</div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto scrollbar-thin">
        {NAV.map(item => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
                active
                  ? 'bg-gradient-to-r from-rose-500/15 to-fuchsia-500/10 text-white border border-rose-400/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/5 border border-transparent'
              }`}
            >
              <Icon size={17} className={active ? 'text-rose-400' : ''} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.id === 'dashboard' && highCount > 0 && (
                <span className="chip !px-1.5 !py-0.5 text-[10px]" style={{ background: 'rgba(244,63,94,.2)', color: '#fda4af' }}>{highCount}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="px-4 pb-5 space-y-2.5">
        <div className="card !rounded-xl p-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-300 mb-1.5">
            <Zap size={13} className={rrEnabled ? 'text-amber-400' : 'text-slate-500'} />
            Round-robin assignment
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${rrEnabled ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            <span className="text-[11.5px] text-slate-400">{rrEnabled ? 'Auto-assigning new leads' : 'Manual assignment'}</span>
          </div>
        </div>
        <div className="card !rounded-xl p-3 flex items-center gap-3">
          {momenceOn ? <Link2 size={15} className="text-emerald-400" /> : <ShieldCheck size={15} className="text-slate-500" />}
          <div>
            <div className="text-[11.5px] font-semibold text-slate-300">{momenceOn ? 'Momence connected' : 'Momence not linked'}</div>
            <div className="text-[10.5px] text-slate-500">Sales & class history sync</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function Topbar({ onAdd }) {
  const { view, navigate, alerts, boot, theme, setTheme } = useApp()
  const [query, setQuery] = useState('')
  const title = NAV.find(n => n.id === view)?.label || 'Dashboard'
  const todayCount = alerts.filter(a => a.level === 'high').length

  return (
    <header className="relative z-30 h-[64px] shrink-0 flex items-center gap-4 px-6 border-b border-white/6 bg-[#080a12]/70 backdrop-blur-xl">
      <h1 className="font-display text-[19px] font-bold text-white flex-1">{title}</h1>

      <div className="relative w-[300px]">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="input !pl-9 !py-2 !rounded-xl"
          placeholder="Search leads, phone, email…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && query.trim()) {
              navigate('leads', { search: query.trim() })
            }
          }}
        />
      </div>

      <button
        className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <AlertsDropdown />

      <button className="btn btn-primary" onClick={onAdd}>
        <Plus size={15} /> Add Lead
      </button>

      <div className="hidden xl:flex items-center gap-2 chip bg-white/5 border border-white/10 text-slate-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        {boot?.locations?.length || 0} studios · {boot?.associates?.length || 0} associates
      </div>
    </header>
  )
}

export default function App() {
  const [addOpen, setAddOpen] = useState(false)
  return (
    <AppProvider>
      <div className="h-screen flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar onAdd={() => setAddOpen(true)} />
          <main className="flex-1 overflow-y-auto scrollbar-thin">
            <Shell />
          </main>
        </div>
      </div>
      <LeadDrawer />
      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} />
      <Toasts />
    </AppProvider>
  )
}

function Shell() {
  const { view, viewParams } = useApp()
  switch (view) {
    case 'dashboard': return <Dashboard />
    case 'performance': return <Performance />
    case 'pipeline': return <Pipeline />
    case 'leads': return <Leads initialSearch={viewParams.search} />
    case 'import': return <Import />
    case 'team': return <Team />
    case 'settings': return <SettingsPage />
    default: return <Dashboard />
  }
}
