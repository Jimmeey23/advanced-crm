import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, API_BASE } from './api.js'

const Ctx = createContext(null)

const SESSION_ACCENTS = ['crimson', 'blue', 'purple', 'rani', 'bottle', 'ash', 'blood', 'deep']
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

  const refreshData = useCallback(() => {
    setDataVersion(v => v + 1)
    api.get('/api/bootstrap').then(setBoot).catch(() => {})
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
    const es = new EventSource(API_BASE + '/api/events')
    es.onmessage = () => { refreshData(); refreshAlerts() }
    es.onerror = () => { /* browser auto-reconnects */ }
    return () => es.close()
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

  const toast = useCallback((message, kind = 'success') => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, message, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
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
    refreshData, refreshAlerts, navigate, openLead, closeLead, toast, dataVersion
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function Toasts() {
  const { toasts } = useApp()
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id}
          className="card px-4 py-3 text-[13px] font-medium flex items-center gap-2 animate-[fadeIn_.2s_ease]"
          style={{ borderColor: t.kind === 'error' ? 'rgba(244,63,94,.5)' : 'rgba(52,211,153,.45)', color: t.kind === 'error' ? '#fecdd3' : '#d1fae5' }}>
          <span style={{ color: t.kind === 'error' ? '#f87171' : '#34d399' }}>{t.kind === 'error' ? '✕' : '✓'}</span>
          {t.message}
        </div>
      ))}
    </div>
  )
}
