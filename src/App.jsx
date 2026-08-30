import React, { useEffect, useState } from 'react'
import {
  LayoutDashboard, KanbanSquare, Users, UploadCloud, Settings, Search,
  Plus, Zap, Link2, ShieldCheck, Sun, Moon, BarChart3, ChevronsLeft, ChevronsRight,
  CalendarDays, CalendarRange, Activity, Inbox as InboxIcon, CalendarClock, LogOut
} from 'lucide-react'
import { AppProvider, Toasts, useApp } from './store.jsx'
import { useFetch } from './hooks.js'
import { api } from './api.js'
import { supabase } from './lib/supabaseClient.js'
import LoginPage from './pages/LoginPage.jsx'
import { money } from './lib.js'
import Dashboard from './pages/Dashboard.jsx'
import Performance from './pages/Performance.jsx'
import Pipeline from './pages/Pipeline.jsx'
import Leads from './pages/Leads.jsx'
import Import from './pages/Import.jsx'
import Team from './pages/Team.jsx'
import StudioWeekly from './pages/StudioWeekly.jsx'
import StudioMonthly from './pages/StudioMonthly.jsx'
import Inbox from './pages/Inbox.jsx'
import SettingsPage from './pages/Settings.jsx'
import MomenceSchedule, { formatTone, personName, time as fmtSessionTime } from './pages/MomenceSchedule.jsx'
import LeadDrawer from './components/LeadDrawer.jsx'
import AddLeadModal from './components/AddLeadModal.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import AlertsDropdown from './components/AlertsDropdown.jsx'
import Logo from './components/Logo.jsx'
import { AppLoader } from './ui.jsx'

// Grouped because the sidebar's eleven destinations are not one flat list:
// two are standing overviews, two are periodic reports, four are the daily
// worklist, and three are administration. The labels encode that, and the
// grouping is what keeps a tall column from reading as a dead run of links.
const NAV_GROUPS = [
  { label: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', title: 'Executive Overview', icon: LayoutDashboard },
    { id: 'performance', label: 'Performance', title: 'Sales Performance', icon: BarChart3 }
  ] },
  { label: 'Reports', items: [
    { id: 'studio-weekly', label: 'Weekly studio report', title: 'Weekly Studio Pulse', icon: CalendarDays },
    { id: 'studio-monthly', label: 'Monthly studio report', title: 'Monthly Studio Review', icon: CalendarRange }
  ] },
  { label: 'Work', items: [
    { id: 'pipeline', label: 'Pipeline', title: 'Sales Pipeline', icon: KanbanSquare },
    { id: 'leads', label: 'Leads', title: 'Lead Directory', icon: Users },
    { id: 'inbox', label: 'Inbox', title: 'Unified Inbox', icon: InboxIcon },
    { id: 'momence-schedule', label: 'Class schedule', title: 'Momence Class Schedule', icon: CalendarClock }
  ] },
  { label: 'Manage', items: [
    { id: 'import', label: 'Import CSV', title: 'Lead Import Centre', icon: UploadCloud },
    { id: 'team', label: 'Team & Studios', title: 'Studios & Sales Team', icon: Users },
    { id: 'settings', label: 'Settings', title: 'Workspace Settings', icon: Settings }
  ] }
]

const NAV = NAV_GROUPS.flatMap(g => g.items)

function Sidebar() {
  const { view, navigate, boot, alerts, sidebarCollapsed, toggleSidebar, role } = useApp()
  const momenceOn = boot?.integrations?.momence
  const rrEnabled = boot?.settings?.roundRobin?.enabled
  const highCount = alerts.filter(a => a.level === 'high').length

  return (
    <aside className={`${sidebarCollapsed ? 'w-[72px]' : 'w-[248px]'} shrink-0 h-full flex flex-col app-sidebar transition-[width] duration-200`}>
      <div className={`px-5 pt-6 pb-5 flex items-center gap-3 ${sidebarCollapsed ? '!px-0 justify-center' : ''}`}>
        <button type="button" onClick={() => navigate('dashboard')} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400" aria-label="Go to dashboard" title="Home">
          <Logo size={40} />
        </button>
        {!sidebarCollapsed && (
          <div className="min-w-0">
            <div className="font-display font-bold text-white leading-tight text-md truncate">{boot?.settings?.org?.name || 'Lead Studio'}</div>
            <div className="text-xs text-slate-400 -mt-0.5 tracking-wide truncate">{boot?.settings?.org?.brand || 'PHYSIQUE 57'}</div>
          </div>
        )}
      </div>

      <nav className="app-nav flex-1 px-3 overflow-y-auto scrollbar-thin">
        {NAV_GROUPS.map(group => {
          const groupItems = group.items.filter(item => role === 'admin' || item.id !== 'import')
          if (!groupItems.length) return null
          return (
            <div className="app-nav-group" key={group.label}>
              {!sidebarCollapsed && <div className="app-nav-group-label">{group.label}</div>}
              {groupItems.map(item => {
                const Icon = item.icon
                const active = view === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`app-nav-item ${sidebarCollapsed ? 'is-collapsed' : ''} ${active ? 'is-active' : ''}`}
                  >
                    <Icon size={16} />
                    {!sidebarCollapsed && <span className="flex-1 text-left">{item.label}</span>}
                    {!sidebarCollapsed && item.id === 'dashboard' && highCount > 0 && (
                      <span className="app-nav-count">{highCount}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      {!sidebarCollapsed && (
        <div className="px-4 pb-5 space-y-2.5">
          <button
            type="button"
            onClick={() => navigate('settings', { tab: 'alerts', section: 'settings-round-robin' })}
            title="Open Round-robin settings"
            className="card !rounded-xl p-3 w-full text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-1.5">
              <Zap size={13} className={rrEnabled ? 'text-amber-400' : 'text-slate-500'} />
              Round-robin assignment
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${rrEnabled ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              <span className="text-xs text-slate-400">{rrEnabled ? 'Auto-assigning new leads' : 'Manual assignment'}</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('momence-schedule')}
            title="Open Momence class schedule"
            className="card !rounded-xl p-3 flex items-center gap-3 w-full text-left hover:bg-white/5 transition-colors"
          >
            {momenceOn ? <Link2 size={15} className="text-emerald-400" /> : <ShieldCheck size={15} className="text-slate-500" />}
            <div>
              <div className="text-xs font-semibold text-slate-300">{momenceOn ? 'Momence connected' : 'Momence not linked'}</div>
              <div className="text-xs text-slate-500">Sales & class history sync</div>
            </div>
          </button>
        </div>
      )}

      <button
        className="mx-3 mb-3 flex items-center justify-center gap-2 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 border border-white/8 text-xs font-medium transition-colors"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sidebarCollapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} /> Collapse</>}
      </button>
    </aside>
  )
}

function Topbar({ onAdd }) {
  const { view, navigate, alerts, boot, theme, setTheme, refreshData, toast, signOut } = useApp()
  const [refreshing, setRefreshing] = useState(false)
  const title = NAV.find(n => n.id === view)?.title || 'Executive Overview'

  const doRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshData({ surfaceErrors: true })
      toast('Workspace refreshed')
    } catch (e) {
      toast(`Refresh failed — ${e.message}`, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <header className="relative z-30 h-[74px] shrink-0 flex items-center gap-4 px-6 app-topbar">
      <div className="app-page-title flex-1" key={view}>
        <span className="app-page-title-icon"><Activity size={15} /></span>
        <div>
          <span className="app-page-title-kicker">CRM workspace</span>
          <h1 className="font-display">{title}</h1>
        </div>
      </div>

      {/* One search entry point. The palette handles leads, pages and
          actions, so the topbar only needs to point at it. */}
      <button
        type="button"
        className="topbar-search"
        onClick={() => window.dispatchEvent(new CustomEvent('p57:open-palette'))}
      >
        <Search size={15} />
        <span>Search leads, pages, actions</span>
        <kbd>⌘K</kbd>
      </button>

      <button
        className="btn btn-ghost !h-9 !py-0 !px-3 text-sm"
        onClick={doRefresh}
        disabled={refreshing}
        title="Refresh workspace data"
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>

      <button
        className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <AlertsDropdown />

      <button
        className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        onClick={signOut}
        title="Sign out"
      >
        <LogOut size={16} />
      </button>

      <button className="btn btn-primary" onClick={onAdd}>
        <Plus size={15} /> Add Lead
      </button>
    </header>
  )
}

function MarqueeBanner() {
  const { boot, alerts, dataVersion, view, scheduleSessions } = useApp()
  const { data: metrics } = useFetch(() => api.get('/api/analytics/overview'), [dataVersion])

  if (view === 'momence-schedule') {
    const items = [...scheduleSessions].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)).slice(0, 24)
    if (!items.length) return null
    const track = items.map(s => (
      <span key={s.id} className={`tone-${formatTone(s.name)}`}>
        <i />
        <b>{fmtSessionTime(s.startsAt)}</b>
        {s.name}
        <em>{personName(s.teacher)}</em>
        <u>{s.bookingCount}/{s.capacity ?? '∞'} IN</u>
      </span>
    ))
    return (
      <div className="app-marquee is-schedule-marquee" aria-label="Live class schedule" key={view}>
        <div className="app-marquee-track">
          <div className="app-marquee-group">{track}</div>
          <div className="app-marquee-group" aria-hidden="true">{track}</div>
        </div>
      </div>
    )
  }
  const highPriority = alerts.filter(alert => alert.level === 'high').length
  const integrationCount = boot ? Object.values(boot.integrations || {}).filter(value => value === true).length : 0
  const analytics = metrics || {}
  const loaded = (items) => items.filter(item => item.value !== undefined && item.value !== null)
  const pageMetrics = {
    dashboard: loaded([
      { label: 'Total leads', value: analytics.totalLeads }, { label: 'Open pipeline', value: analytics.openLeads },
      { label: 'New this month', value: analytics.newThisMonth },
      { label: 'Conversion', value: analytics.conversionRate !== undefined ? `${analytics.conversionRate}%` : undefined },
      { label: 'Trials completed', value: analytics.trialCompleted },
      { label: 'Trial rate', value: analytics.trialRate !== undefined ? `${analytics.trialRate}%` : undefined },
      { label: 'Revenue this month', value: analytics.revenueThisMonth !== undefined ? money(analytics.revenueThisMonth) : undefined },
      { label: 'Avg deal', value: analytics.avgDealValue !== undefined ? money(analytics.avgDealValue) : undefined },
      { label: 'Top source', value: analytics.topSource?.label ? `${analytics.topSource.label} · ${analytics.topSource.count}` : undefined },
      { label: 'Priority alerts', value: highPriority }
    ]),
    performance: loaded([
      { label: 'Won deals', value: analytics.won }, { label: 'Conversion', value: analytics.conversionRate !== undefined ? `${analytics.conversionRate}%` : undefined },
      { label: 'MoM growth', value: analytics.wonDeltaPct !== undefined ? `${analytics.wonDeltaPct >= 0 ? '+' : ''}${analytics.wonDeltaPct}%` : undefined },
      { label: 'Average deal', value: analytics.avgDealValue !== undefined ? money(analytics.avgDealValue) : undefined },
      { label: 'Monthly revenue', value: analytics.revenueThisMonth !== undefined ? money(analytics.revenueThisMonth) : undefined },
      { label: 'Top owner', value: analytics.topOwner?.label ? `${analytics.topOwner.label} · ${analytics.topOwner.count}` : undefined },
      { label: 'Reporting months', value: 12 }, { label: 'Studios measured', value: boot?.locations?.length }
    ]),
    'studio-weekly': loaded([
      { label: 'Active studios', value: boot?.locations?.filter(location => location.active !== false).length },
      { label: 'Sales associates', value: boot?.associates?.filter(associate => associate.active !== false).length },
      { label: 'Open pipeline', value: analytics.openLeads },
      { label: 'Hot leads', value: analytics.hotLeads },
      { label: 'Conversion', value: analytics.conversionRate !== undefined ? `${analytics.conversionRate}%` : undefined },
      { label: 'Unassigned', value: analytics.unassigned },
      { label: 'High priority', value: highPriority }
    ]),
    'studio-monthly': loaded([
      { label: 'New this month', value: analytics.newThisMonth }, { label: 'Won this month', value: analytics.wonThisMonth },
      { label: 'Conversion', value: analytics.conversionRate !== undefined ? `${analytics.conversionRate}%` : undefined },
      { label: 'Avg deal', value: analytics.avgDealValue !== undefined ? money(analytics.avgDealValue) : undefined },
      { label: 'Monthly revenue', value: analytics.revenueThisMonth !== undefined ? money(analytics.revenueThisMonth) : undefined },
      { label: 'Monthly target', value: analytics.monthlyTarget }, { label: 'Studios reporting', value: boot?.locations?.length }
    ]),
    pipeline: loaded([
      { label: 'Open opportunities', value: analytics.openLeads }, { label: 'Hot opportunities', value: analytics.hotLeads },
      { label: 'Trials booked', value: analytics.trialBooked }, { label: 'Trials completed', value: analytics.trialCompleted },
      { label: 'Conversion', value: analytics.conversionRate !== undefined ? `${analytics.conversionRate}%` : undefined },
      { label: 'Avg deal', value: analytics.avgDealValue !== undefined ? money(analytics.avgDealValue) : undefined },
      { label: 'Top stage', value: analytics.topStage?.label ? `${analytics.topStage.label} · ${analytics.topStage.count}` : undefined },
      { label: 'Unassigned', value: analytics.unassigned },
      { label: 'Pipeline stages', value: boot?.stages?.length }
    ]),
    leads: loaded([
      { label: 'Leads received', value: analytics.newThisMonth },
      { label: 'Open pipeline', value: analytics.openLeads },
      { label: 'Hot leads', value: analytics.hotLeads },
      { label: 'Top source', value: analytics.topSource?.label ? `${analytics.topSource.label} · ${analytics.topSource.count}` : undefined },
      { label: 'Top stage', value: analytics.topStage?.label ? `${analytics.topStage.label} · ${analytics.topStage.count}` : undefined },
      { label: 'Converted', value: analytics.wonThisMonth },
      { label: 'Conversion rate', value: analytics.conversionRate !== undefined ? `${analytics.conversionRate}%` : undefined },
      { label: 'Trials completed', value: analytics.trialCompleted },
      { label: 'Trial rate', value: analytics.trialRate !== undefined ? `${analytics.trialRate}%` : undefined },
      { label: 'Avg deal', value: analytics.avgDealValue !== undefined ? money(analytics.avgDealValue) : undefined },
      { label: 'MoM conversion growth', value: analytics.wonDeltaPct !== undefined ? `${analytics.wonDeltaPct >= 0 ? '+' : ''}${analytics.wonDeltaPct}%` : undefined },
      { label: 'Top owner', value: analytics.topOwner?.label ? `${analytics.topOwner.label} · ${analytics.topOwner.count}` : undefined },
      { label: 'Unassigned', value: analytics.unassigned }
    ]),
    import: loaded([
      { label: 'Import destinations', value: boot?.locations?.length }, { label: 'Available sources', value: boot?.sources?.length },
      { label: 'Pipeline stages', value: boot?.stages?.length }, { label: 'Assignable owners', value: boot?.associates?.length },
      { label: 'Active studios', value: boot?.locations?.filter(location => location.active !== false).length }
    ]),
    team: loaded([
      { label: 'Studio locations', value: boot?.locations?.length }, { label: 'Team members', value: boot?.associates?.length },
      { label: 'Hot leads', value: analytics.hotLeads },
      { label: 'Conversion', value: analytics.conversionRate !== undefined ? `${analytics.conversionRate}%` : undefined },
      { label: 'Monthly team target', value: analytics.monthlyTarget }, { label: 'Open assignments', value: analytics.openLeads },
      { label: 'Unassigned', value: analytics.unassigned }
    ]),
    settings: loaded([
      { label: 'Pipeline stages', value: boot?.stages?.length }, { label: 'Lead sources', value: boot?.sources?.length },
      { label: 'Outreach channels', value: boot?.channels?.length }, { label: 'Connected services', value: integrationCount },
      { label: 'Active studios', value: boot?.locations?.filter(location => location.active !== false).length },
      { label: 'Team members', value: boot?.associates?.length }
    ])
  }
  const items = pageMetrics[view]?.length ? pageMetrics[view] : [{ label: 'Active alerts', value: alerts.length }, { label: 'High priority', value: highPriority }]

  return (
    <div className="app-marquee" aria-label={`Live metrics for ${view}`} key={view}>
      <div className="app-marquee-track">
        <div className="app-marquee-group">
          {items.map(item => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong></span>)}
        </div>
        <div className="app-marquee-group" aria-hidden="true">
          {items.map(item => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong></span>)}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [addOpen, setAddOpen] = useState(false)
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    }).catch((err) => {
      console.warn('supabase.auth.getSession() failed; treating as unauthenticated', err)
      setSession(null)
      setAuthLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // The command palette lives below AppProvider and can't reach this state
  // directly, so "Add lead" is dispatched as an event and handled here.
  useEffect(() => {
    const open = () => setAddOpen(true)
    window.addEventListener('p57:add-lead', open)
    return () => window.removeEventListener('p57:add-lead', open)
  }, [])

  if (authLoading) return <AppLoader />
  if (!session) return <LoginPage />

  return (
    <AppProvider>
      <BootstrapGate>
        <div className="h-screen flex overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <Topbar onAdd={() => setAddOpen(true)} />
            <main className="flex-1 overflow-y-auto scrollbar-thin">
              <MarqueeBanner />
              <Shell />
            </main>
          </div>
        </div>
      </BootstrapGate>
      <LeadDrawer />
      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} />
      <CommandPalette />
      <Toasts />
    </AppProvider>
  )
}

function Shell() {
  const { view, viewParams } = useApp()
  switch (view) {
    case 'dashboard': return <Dashboard />
    case 'performance': return <Performance />
    case 'studio-weekly': return <StudioWeekly />
    case 'studio-monthly': return <StudioMonthly />
    case 'pipeline': return <Pipeline />
    case 'leads': return <Leads initialSearch={viewParams.search} initialAssociateId={viewParams.associateId} />
    case 'inbox': return <Inbox />
    case 'momence-schedule': return <MomenceSchedule />
    case 'import': return <Import />
    case 'team': return <Team />
    case 'settings': return <SettingsPage jumpTo={viewParams} />
    default: return <Dashboard />
  }
}

function BootstrapGate({ children }) {
  const { boot } = useApp()
  if (!boot) return <AppLoader />
  return children
}
