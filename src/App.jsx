import React, { useEffect, useState } from 'react'
import {
  LayoutDashboard, KanbanSquare, Users, UploadCloud, Settings, Search,
  Plus, Sun, Moon, BarChart3,
  CalendarDays, CalendarRange, Activity, Inbox as InboxIcon, CalendarClock, LogOut, Table2, BadgePercent, Package,
  RefreshCw, Receipt
} from 'lucide-react'
import { AppProvider, Toasts, useApp } from './store.jsx'
import { useFetch } from './hooks.js'
import { api } from './api.js'
import { supabase } from './lib/supabaseClient.js'
import LoginPage from './pages/LoginPage.jsx'
import { money, timeAgo, fmtDateTime } from './lib.js'
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
import Pivot from './pages/Pivot.jsx'
import MomenceSchedule, { formatTone, personName, time as fmtSessionTime } from './pages/MomenceSchedule.jsx'
import DiscountCodes from './pages/DiscountCodes.jsx'
import Sales from './pages/Sales.jsx'
import Memberships from './pages/Memberships.jsx'
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
    { id: 'studio-monthly', label: 'Monthly studio report', title: 'Monthly Studio Review', icon: CalendarRange },
    { id: 'sales', label: 'Live sales', title: 'Live Sales Dashboard', icon: Receipt },
    { id: 'pivot', label: 'Pivot builder', title: 'Pivot Builder', icon: Table2 }
  ] },
  { label: 'Work', items: [
    { id: 'pipeline', label: 'Pipeline', title: 'Sales Pipeline', icon: KanbanSquare },
    { id: 'leads', label: 'Leads', title: 'Lead Directory', icon: Users },
    { id: 'inbox', label: 'Inbox', title: 'Unified Inbox', icon: InboxIcon },
    { id: 'momence-schedule', label: 'Class schedule', title: 'Momence Class Schedule', icon: CalendarClock },
    { id: 'discount-codes', label: 'Discount codes', title: 'Momence Discount Codes', icon: BadgePercent },
    { id: 'memberships', label: 'Memberships', title: 'Memberships & Packages', icon: Package }
  ] },
  { label: 'Manage', items: [
    { id: 'import', label: 'Import CSV', title: 'Lead Import Centre', icon: UploadCloud },
    { id: 'team', label: 'Team & Studios', title: 'Studios & Sales Team', icon: Users },
    { id: 'settings', label: 'Settings', title: 'Workspace Settings', icon: Settings }
  ] }
]

const NAV = NAV_GROUPS.flatMap(g => g.items)

// Athena-style icon rail: one fixed 88px column, every destination an equal
// 48px tile with a short uppercase label under the glyph. Flat list — at rail
// width group headers cannot be set legibly, so the icons carry wayfinding.
function Sidebar() {
  const { view, navigate, boot, alerts, role } = useApp()
  const [railOpen, setRailOpen] = useState(false)
  const highCount = alerts.filter(a => a.level === 'high').length
  const items = NAV.filter(item => role === 'admin' || item.id !== 'import')

  useEffect(() => {
    const toggle = () => setRailOpen(o => !o)
    window.addEventListener('p57:toggle-rail', toggle)
    return () => window.removeEventListener('p57:toggle-rail', toggle)
  }, [])

  return (
    <aside className={`${railOpen ? 'fixed inset-y-0 left-0 z-40' : 'hidden'} app-sidebar shrink-0 flex-col lg:flex`}>
      <div className="app-rail-head">
        <button
          type="button"
          onClick={() => navigate('dashboard')}
          title={boot?.settings?.org?.name || 'Home'}
          aria-label="Go to dashboard"
          className="app-rail-logo"
        >
          <Logo size={36} />
        </button>
      </div>
      <nav className="app-rail scrollbar-thin">
        {items.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              title={item.label}
              data-active={view === item.id}
              onClick={() => { navigate(item.id); setRailOpen(false) }}
              className="rail-btn"
            >
              <Icon size={16} />
              <span>{railLabel(item.label)}</span>
              {item.id === 'dashboard' && highCount > 0 && <i className="rail-btn-dot" />}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

// Rail tiles fit roughly ten characters, so the label is the first meaningful
// word of the destination — the same trim Athena applies to "Multi-location".
function railLabel(label) {
  return label.split(/[\s-]/)[0]
}

// How fresh the sheet sync is, in the topbar. The sheet is the source of truth
// for the whole lead list, so "when did we last hear from it" is a standing
// question — and a sync that quietly stopped hours ago looks exactly like a
// sync that is working until someone goes looking in Settings.
//
// Thresholds are keyed to the reconcile interval (30 min): a gap under an hour
// is a normal pass, under four hours is late but survivable, beyond that
// something is wrong.
const SYNC_STALE_MS = 60 * 60 * 1000
const SYNC_BROKEN_MS = 4 * 60 * 60 * 1000

function SyncBadge() {
  const { dataVersion, navigate } = useApp()
  const [config, setConfig] = useState(null)
  // Re-renders the relative time without re-fetching, so "4m ago" does not sit
  // there saying "just now" for half an hour.
  const [, setNow] = useState(0)

  useEffect(() => {
    let alive = true
    const load = () => api.get('/api/google-sheets/config')
      .then(c => { if (alive) setConfig(c) })
      .catch(() => { if (alive) setConfig(null) })
    load()
    const poll = setInterval(load, 60000)
    const tick = setInterval(() => setNow(n => n + 1), 30000)
    return () => { alive = false; clearInterval(poll); clearInterval(tick) }
  }, [dataVersion])

  // Nothing to report until a sheet is actually connected — an unconfigured
  // workspace should not carry a permanently red badge for a feature it does
  // not use.
  if (!config?.sheetId) return null

  const at = config.lastSyncAt
  const age = at ? Date.now() - new Date(at).getTime() : Infinity
  // A failing pass is worse than an old one: the sync is not merely late, it is
  // actively being refused, and that is worth the red regardless of the age.
  const failing = Boolean(config.lastSyncError)
  const tone = failing || !at || age >= SYNC_BROKEN_MS ? 'bad' : age >= SYNC_STALE_MS ? 'warn' : 'good'
  const counts = config.lastSyncCounts
  const detail = failing
    ? `Last attempt ${config.lastSyncAttemptAt ? timeAgo(config.lastSyncAttemptAt) : 'unknown'} failed:\n${config.lastSyncError}`
    : counts
      ? `${counts.created || 0} created · ${counts.merged || 0} merged · ${counts.deleted || 0} deleted`
      : 'No counts recorded yet'

  return (
    <button
      type="button"
      className={`topbar-sync is-${tone}`}
      onClick={() => navigate('settings')}
      title={at ? `Google Sheet last synced ${fmtDateTime(at)}\n${detail}` : 'The Google Sheet has never been synced'}
    >
      <RefreshCw size={13} />
      <span className="topbar-sync-label">Sheet</span>
      <span className="topbar-sync-value">{failing ? 'failing' : at ? timeAgo(at) : 'never'}</span>
    </button>
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
      <button
        type="button"
        className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 lg:hidden"
        onClick={() => window.dispatchEvent(new CustomEvent('p57:toggle-rail'))}
        title="Show navigation"
      >
        <LayoutDashboard size={16} />
      </button>

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

      <SyncBadge />

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

// Three-state tone vocabulary: green when the number is the good direction,
// red when it is the bad one, blue for everything neutral. Amber is
// deliberately absent — with values scrolling past, two signal colours plus a
// neutral read faster than four.
function metricTone(label, value) {
  const text = String(value ?? '')
  const key = label.toLowerCase()
  const num = Number(text.replace(/[^\d.-]/g, ''))
  if (/^-/.test(text.trim())) return 'bad'
  if (/^\+/.test(text.trim())) return 'good'
  if (/unassigned|priority|high|flag|overdue|stalled|lost/.test(key)) return num > 0 ? 'bad' : 'good'
  if (/conversion|rate|growth|won|converted|completed|revenue|hot/.test(key)) return 'good'
  return 'plain'
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
          {items.map(item => <span key={item.label} data-tone={metricTone(item.label, item.value)}><small>{item.label}</small><strong>{item.value}</strong></span>)}
        </div>
        <div className="app-marquee-group" aria-hidden="true">
          {items.map(item => <span key={item.label} data-tone={metricTone(item.label, item.value)}><small>{item.label}</small><strong>{item.value}</strong></span>)}
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
              <PageErrorBoundary><Shell /></PageErrorBoundary>
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

// A render error in one page used to blank the whole app — the shell, the
// sidebar and every other route with it — leaving no way back except a manual
// reload. The boundary keeps the chrome alive and shows what broke.
class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[page error]', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    // A new page mounting is a fresh chance to render — without this the
    // boundary would keep showing the old error after navigating away.
    if (prevProps.children !== this.props.children && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="rp-page">
        <div className="rp-section">
          <div className="rp-section-head"><div className="rp-section-titles"><h3>This page hit an error</h3></div></div>
          <div className="rp-section-body">
            <p className="rp-empty" style={{ textAlign: 'left' }}>{this.state.error.message || String(this.state.error)}</p>
            <button type="button" className="rp-btn" onClick={() => this.setState({ error: null })}>Try again</button>
          </div>
        </div>
      </div>
    )
  }
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
    case 'sales': return <Sales />
    case 'discount-codes': return <DiscountCodes />
    case 'memberships': return <Memberships />
    case 'import': return <Import />
    case 'team': return <Team />
    case 'pivot': return <Pivot />
    case 'settings': return <SettingsPage jumpTo={viewParams} />
    default: return <Dashboard />
  }
}

function BootstrapGate({ children }) {
  const { boot } = useApp()
  if (!boot) return <AppLoader />
  return children
}
