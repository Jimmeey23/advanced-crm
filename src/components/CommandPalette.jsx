import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, CornerDownLeft, LayoutDashboard, KanbanSquare, Users, UploadCloud,
  Settings as SettingsIcon, BarChart3, CalendarDays, CalendarRange, Inbox as InboxIcon,
  CalendarClock, Sun, Moon, RefreshCw, Plus, PanelLeft
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Avatar } from '../ui.jsx'

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
  { id: 'studio-weekly', label: 'Weekly studio report', icon: CalendarDays },
  { id: 'studio-monthly', label: 'Monthly studio report', icon: CalendarRange },
  { id: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
  { id: 'leads', label: 'Leads', icon: Users },
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'momence-schedule', label: 'Class schedule', icon: CalendarClock },
  { id: 'import', label: 'Import CSV', icon: UploadCloud, adminOnly: true },
  { id: 'team', label: 'Team & Studios', icon: Users },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

// Subsequence match: "wsr" finds "Weekly studio report". Scored so that
// hits on word starts and early characters sort above scattered ones.
function score(query, text) {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const direct = t.indexOf(q)
  if (direct === 0) return 1000
  if (direct > 0) return 800 - direct
  let ti = 0, points = 0
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at === -1) return -1
    points += at === 0 || t[at - 1] === ' ' ? 12 : 4
    ti = at + 1
  }
  return points
}

export default function CommandPalette() {
  const { boot, navigate, openLead, refreshData, theme, setTheme, toggleSidebar, role, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [leads, setLeads] = useState([])
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('p57:open-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('p57:open-palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) { setQuery(''); setLeads([]); setCursor(0); return }
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  // Lead search is remote and debounced; everything else matches locally.
  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) { setLeads([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      api.get(`/api/leads?search=${encodeURIComponent(q)}&pageSize=6`)
        .then(res => { if (!cancelled) setLeads(res?.items || []) })
        .catch(() => { if (!cancelled) setLeads([]) })
    }, 160)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, open])

  const close = useCallback(() => setOpen(false), [])

  const actions = useMemo(() => {
    const run = (fn) => () => { fn(); close() }
    return [
      { id: 'act-new-lead', group: 'Actions', label: 'Add lead', hint: 'Opens the new lead form', icon: Plus,
        perform: run(() => window.dispatchEvent(new CustomEvent('p57:add-lead'))) },
      { id: 'act-refresh', group: 'Actions', label: 'Refresh data', hint: 'Refetch everything from the server', icon: RefreshCw,
        perform: run(() => { refreshData(); toast('Data refreshed') }) },
      { id: 'act-theme', group: 'Actions', label: theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
        icon: theme === 'light' ? Moon : Sun, perform: run(() => setTheme(theme === 'light' ? 'dark' : 'light')) },
      { id: 'act-sidebar', group: 'Actions', label: 'Toggle sidebar', icon: PanelLeft, perform: run(toggleSidebar) }
    ]
  }, [theme, setTheme, navigate, refreshData, toggleSidebar, toast, close])

  const items = useMemo(() => {
    const q = query.trim()
    const pages = PAGES
      .filter(p => role === 'admin' || !p.adminOnly)
      .map(p => ({ id: `page-${p.id}`, group: 'Go to', label: p.label, icon: p.icon,
        perform: () => { navigate(p.id); close() } }))

    const associates = (boot?.associates || [])
      .filter(a => a.active !== false)
      .map(a => ({ id: `asn-${a.id}`, group: 'Team', label: a.name, hint: 'Filter leads by owner',
        avatar: a, perform: () => { navigate('leads', { associateId: a.id }); close() } }))

    const leadItems = leads.map(l => ({
      id: `lead-${l.id}`, group: 'Leads', label: l.fullName || l.email || l.phone || 'Untitled lead',
      hint: [l.stage, l.sourceName].filter(Boolean).join(' · '), icon: Users, alwaysShow: true,
      perform: () => { openLead(l.id); close() }
    }))

    const pool = [...leadItems, ...pages, ...actions, ...associates]
    if (!q) return pool.filter(i => i.group !== 'Team').slice(0, 12)

    return pool
      .map(i => ({ i, s: i.alwaysShow ? 900 : score(q, `${i.label} ${i.hint || ''}`) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 14)
      .map(x => x.i)
  }, [query, leads, boot, actions, role, navigate, openLead, close])

  useEffect(() => { setCursor(0) }, [items.length])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, items])

  if (!open) return null

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % Math.max(items.length, 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + items.length) % Math.max(items.length, 1)) }
    if (e.key === 'Enter') { e.preventDefault(); items[cursor]?.perform() }
  }

  let lastGroup = null

  return (
    <div className="cmdk-root" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cmdk-backdrop" onMouseDown={close} />
      <div className="cmdk-panel">
        <div className="cmdk-search">
          <Search size={16} className="text-slate-500" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search leads, pages and actions"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search leads, pages and actions"
            aria-activedescendant={items[cursor]?.id}
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>

        <div className="cmdk-list" ref={listRef} role="listbox">
          {!items.length && <p className="cmdk-empty">Nothing matches “{query}”. Try a lead name, a page, or “refresh”.</p>}
          {items.map((item, index) => {
            const Icon = item.icon
            const header = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <React.Fragment key={item.id}>
                {header && <div className="cmdk-group">{header}</div>}
                <button
                  type="button"
                  id={item.id}
                  role="option"
                  aria-selected={index === cursor}
                  data-active={index === cursor}
                  className="cmdk-item"
                  onMouseMove={() => setCursor(index)}
                  onClick={item.perform}
                >
                  {item.avatar
                    ? <Avatar size={20} name={item.avatar.name} color={item.avatar.color} photoUrl={item.avatar.photoUrl} />
                    : Icon ? <Icon size={15} /> : <span className="cmdk-dot" />}
                  <span className="cmdk-label">{item.label}</span>
                  {item.hint && <span className="cmdk-hint">{item.hint}</span>}
                  {index === cursor && <CornerDownLeft size={13} className="cmdk-enter" />}
                </button>
              </React.Fragment>
            )
          })}
        </div>

        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
