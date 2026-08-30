import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { supabase } from './lib/supabaseClient.js'

const Ctx = createContext(null)

const SESSION_ACCENTS = ['crimson', 'blue', 'purple', 'rani', 'bottle', 'ash', 'blood', 'deep', 'teal', 'gold', 'graphite', 'mono']
const randomAccent = () => 'blue'

export function useApp() {
  return useContext(Ctx)
}

export function AppProvider({ children }) {
  const [boot, setBoot] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [drawerLeadId, setDrawerLeadId] = useState(null)
  const [view, setView] = useState('dashboard')
  const [viewParams, setViewParams] = useState({})
  const [dataVersion, setDataVersion] = useState(0)
  // Lets the schedule page feed its live session list into the single
  // top-of-app marquee instead of rendering a second ticker of its own.
  const [scheduleSessions, setScheduleSessions] = useState([])
  const [toasts, setToasts] = useState([])
  const toastId = useRef(0)

  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem('p57_theme') || 'light' } catch (e) { return 'light' }
  })

  const [accent, setAccentState] = useState(() => {
    return randomAccent()
  })

  useEffect(() => {
    if (boot?.settings?.ui?.theme && !localStorage.getItem('p57_theme')) {
      setThemeState(boot.settings.ui.theme)
    }
  }, [boot])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-accent', accent)
    try {
      localStorage.setItem('p57_theme', theme)
    } catch (e) { /* ignore */ }
  }, [theme, accent])

  const setTheme = useCallback((t) => setThemeState(t === 'light' ? 'light' : 'dark'), [])
  const setAccent = useCallback((a) => setAccentState(SESSION_ACCENTS.includes(a) ? a : 'blue'), [])

  const refreshData = useCallback((opts = {}) => {
    setDataVersion(v => v + 1)
    const p = api.get('/api/bootstrap').then(setBoot)
    // Background callers (SSE, polling) swallow failures on purpose; an
    // explicit user click (the Topbar Refresh button) wants to know when
    // the request actually failed instead of the button silently no-op'ing.
    return opts.surfaceErrors ? p : p.catch(() => {})
  }, [])
  const refreshAlerts = useCallback(async () => {
    try { setAlerts(await api.get('/api/alerts')) } catch (e) { /* ignore */ }
  }, [])

  useEffect(() => {
    api.get('/api/bootstrap').then(setBoot).catch(() => {})
    refreshAlerts()
  }, [refreshAlerts])

  // Two-way sync: when Supabase reports a remote change (edited directly in
  // Supabase, or by another server instance), refetch instead of going stale.
  useEffect(() => {
    let es = null
    let cancelled = false
    // EventSource can't set an Authorization header, so /api/events (and only
    // that route) accepts the same Supabase access token as ?token=.
    Promise.all([api.resolveBase(), supabase.auth.getSession().catch(() => ({ data: { session: null } }))])
      .then(([base, { data: { session } }]) => {
        if (cancelled || !session) return
        es = new EventSource(`${base}/api/events?token=${encodeURIComponent(session.access_token)}`)
        es.onmessage = () => { refreshData(); refreshAlerts() }
        es.onerror = () => { /* browser auto-reconnects */ }
      })
    return () => { cancelled = true; es?.close() }
  }, [refreshData, refreshAlerts])

  useEffect(() => {
    refreshAlerts()
    const t = setInterval(refreshAlerts, 60000)
    return () => clearInterval(t)
  }, [refreshAlerts, dataVersion])

  const navigate = useCallback((name, params = {}) => {
    setView(name)
    setViewParams(params)
  }, [])

  const openLead = useCallback((leadId) => setDrawerLeadId(leadId), [])
  const closeLead = useCallback(() => setDrawerLeadId(null), [])

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('p57_sidebar_collapsed') === '1' } catch (e) { return false }
  })
  const setSidebarCollapsedPersist = useCallback((v) => {
    setSidebarCollapsed(v)
    try { localStorage.setItem('p57_sidebar_collapsed', v ? '1' : '0') } catch (e) { /* ignore */ }
  }, [])
  const toggleSidebar = useCallback(() => setSidebarCollapsedPersist(!sidebarCollapsed), [sidebarCollapsed, setSidebarCollapsedPersist])

  // Escape: close the lead drawer (if open) and collapse the sidebar in one press.
  useEffect(() => {
    const h = (e) => {
      if (e.key !== 'Escape') return
      setDrawerLeadId(id => id ? null : id)
      setSidebarCollapsedPersist(true)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setSidebarCollapsedPersist])

  const dismissToast = useCallback((id) => setToasts(t => t.filter(x => x.id !== id)), [])

  // `action` turns a toast into the undo affordance for an optimistic write:
  // { label, onClick }. Undoable toasts linger longer — 3.5s is not enough
  // time to notice a mistake and reach for the button.
  const toast = useCallback((message, kind = 'success', options = {}) => {
    const id = ++toastId.current
    const { action = null, duration = action ? 8000 : 3500 } = options
    setToasts(t => [...t, { id, message, kind, action }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration)
    return id
  }, [])

  const lookup = useMemo(() => {
    if (!boot) return {}
    const locById = Object.fromEntries(boot.locations.map(l => [l.id, l]))
    const asnById = Object.fromEntries(boot.associates.map(a => [a.id, a]))
    return { locById, asnById }
  }, [boot])

  const value = {
    boot, lookup, alerts, toasts, drawerLeadId, view, viewParams, theme, setTheme, accent, setAccent,
    sidebarCollapsed, toggleSidebar,
    refreshData, refreshAlerts, navigate, openLead, closeLead, toast, dismissToast, dataVersion,
    scheduleSessions, setScheduleSessions,
    role: boot?.authUser?.role || 'agent',
    locationIds: boot?.authUser?.locationIds || [],
    associateId: boot?.authUser?.associateId || null,
    signOut: () => supabase.auth.signOut()
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map(t => (
        <div key={t.id} className={`toast is-${t.kind}`} role="status">
          <span className="toast-mark" aria-hidden="true">{t.kind === 'error' ? '\u2715' : '\u2713'}</span>
          <span className="toast-message">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => { t.action.onClick(); dismissToast(t.id) }}
            >{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}
