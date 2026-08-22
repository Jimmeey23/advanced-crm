import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, SlidersHorizontal, ChevronDown, ChevronRight, X, Download, Upload,
  Table as TableIcon, LayoutGrid, Rows3, PieChart, KanbanSquare, CalendarDays,
  Phone, MessageCircle, Mail, MessageSquareText, Sparkles, Trash2, CheckSquare, Square,
  Users, TrendingUp, XCircle, Wallet, Clock, AlertTriangle, MoreHorizontal, Eye,
  Filter, ArrowUpDown, Pin, Settings2, Zap, Star, Flame, Target, UserX, Calendar,
  ArrowUp, ArrowDown, GripVertical, Copy, Edit3, Archive, Bookmark, Layers,
  Check, Plus, Minus, RotateCcw, SearchX, Inbox, Activity, BarChart3, Shield,
  ArrowRight, ExternalLink, PhoneCall, Video, FileText, Tag, Flag, Hash
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api, buildQuery } from '../api.js'
import { Avatar, ScorePill, Empty } from '../ui.jsx'
import { fmtDate, stageClass, riskClass, daysFromNow, downloadText, money, baseColumnValue, buildFormulaContext, evalFormula, lookupColumnValue, formatColumnValue } from '../lib.js'
import Tip from '../components/Tip.jsx'
import ComposeModal from '../components/ComposeModal.jsx'
import RespondioTemplateModal from '../components/RespondioTemplateModal.jsx'
import ColumnManager, { DEFAULT_COLUMNS } from '../components/ColumnManager.jsx'

const COLUMNS_KEY = 'p57_leads_columns_v1'
function loadColumns() {
  try {
    const raw = localStorage.getItem(COLUMNS_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { }
  return DEFAULT_COLUMNS.map(c => ({ ...c }))
}
function getColumnValue(col, l, lookup) {
  if (col.kind === 'formula') return evalFormula(col.formula, buildFormulaContext(l, lookup))
  if (col.kind === 'lookup') return lookupColumnValue(col.relatedTable, col.relatedField, l, lookup)
  return baseColumnValue(col.field, l, lookup)
}

const EMPTY_FILTERS = {
  locationId: '', stage: '', status: '', associateId: '', sourceName: '', channel: '',
  classType: '', risk: '', minScore: '', maxScore: '', dateFrom: '', dateTo: '', createdWithinDays: ''
}

const VIEWS = [
  { id: 'table', label: 'Table', icon: TableIcon, desc: 'Detailed rows' },
  { id: 'cards', label: 'Board', icon: LayoutGrid, desc: 'Visual cards' },
  { id: 'compact', label: 'List', icon: Rows3, desc: 'Compact list' },
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare, desc: 'Stage columns' },
  { id: 'timeline', label: 'Timeline', icon: CalendarDays, desc: 'By date' },
  { id: 'summary', label: 'Insights', icon: PieChart, desc: 'Analytics' }
]

const CHANNELS = {
  call: { icon: Phone, label: 'Call', color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  whatsapp: { icon: MessageCircle, label: 'WhatsApp', color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  email: { icon: Mail, label: 'Email', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  sms: { icon: MessageSquareText, label: 'SMS', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' }
}

const GROUP_OPTIONS = [
  { id: '', label: 'No grouping' },
  { id: 'locationId', label: 'Location' },
  { id: 'stage', label: 'Stage' },
  { id: 'status', label: 'Status' },
  { id: 'sourceName', label: 'Source' },
  { id: 'associateId', label: 'Owner' },
  { id: 'classType', label: 'Class type' },
  { id: 'risk', label: 'AI risk' }
]

const QUICK_FILTERS = [
  { id: 'all', label: 'All Leads', icon: Users, countKey: 'total', filters: {} },
  { id: 'hot', label: 'Hot', icon: Flame, color: '#f43f5e', filters: { risk: 'hot' } },
  { id: 'overdue', label: 'Overdue FU', icon: AlertTriangle, color: '#f59e0b', filters: { _special: 'overdue' } },
  { id: 'unassigned', label: 'Unassigned', icon: UserX, color: '#94a3b8', filters: { _special: 'unassigned' } },
  { id: 'new_today', label: 'New Today', icon: Star, color: '#8b5cf6', filters: { createdWithinDays: '1' } },
  { id: 'high_value', label: 'High Value', icon: Wallet, color: '#10b981', filters: { _special: 'high_value' } },
  { id: 'needs_outreach', label: 'Needs Outreach', icon: PhoneCall, color: '#06b6d4', filters: { _special: 'needs_outreach' } },
]

const STAGE_COLORS = {
  'New Lead': { dot: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.25)', text: '#93c5fd' },
  'Contacted': { dot: '#6366f1', bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.25)', text: '#a5b4fc' },
  'Trial Booked': { dot: '#06b6d4', bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.25)', text: '#67e8f9' },
  'Trial Completed': { dot: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.25)', text: '#6ee7b7' },
  'Follow Up': { dot: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)', text: '#fcd34d' },
  'Proposal Sent': { dot: '#a855f7', bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.25)', text: '#d8b4fe' },
  'Negotiation': { dot: '#ec4899', bg: 'rgba(236,72,153,0.12)', border: 'rgba(236,72,153,0.25)', text: '#f9a8d4' },
  'Won': { dot: '#34d399', bg: 'rgba(52,211,153,0.18)', border: 'rgba(52,211,153,0.35)', text: '#34d399' },
  'Lost': { dot: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.20)', text: '#94a3b8' },
}

export default function Leads({ initialSearch = '' }) {
  const { boot, lookup, openLead, refreshData, toast, navigate, dataVersion } = useApp()
  const [search, setSearch] = useState(initialSearch)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [quickFilter, setQuickFilter] = useState('all')

  useEffect(() => { if (initialSearch) { setSearch(initialSearch); setPage(0) } }, [initialSearch])
  const [panelOpen, setPanelOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')
  const [view, setView] = useState('table')
  const [groupBy, setGroupBy] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const [composeLead, setComposeLead] = useState(null)
  const [templateLead, setTemplateLead] = useState(null)
  const [focusLeadIds, setFocusLeadIds] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [selectAllMatching, setSelectAllMatching] = useState(false)
  const [selectAllBusy, setSelectAllBusy] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [columns, setColumnsRaw] = useState(loadColumns)
  const [pinnedCols, setPinnedCols] = useState(() => {
    try { return JSON.parse(localStorage.getItem('p57_leads_pinned_cols') || '[]') } catch (e) { return [] }
  })
  const [headerPinned, setHeaderPinned] = useState(() => localStorage.getItem('p57_leads_header_pinned') !== 'false')
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('p57_leads_page_size')) || 25)
  const [density, setDensity] = useState(() => localStorage.getItem('p57_leads_density') || 'comfortable')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [columnWidths, setColumnWidths] = useState(() => {
    try { return JSON.parse(localStorage.getItem('p57_leads_col_widths') || '{}') } catch { return {} }
  })
  const tableJumpRef = useRef(null)
  const searchInputRef = useRef(null)

  const setColumns = (updater) => setColumnsRaw(prev => {
    const next = typeof updater === 'function' ? updater(prev) : updater
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)) } catch (e) { }
    return next
  })

  const toggleDensity = () => setDensity(d => {
    const next = d === 'comfortable' ? 'compact' : 'comfortable'
    try { localStorage.setItem('p57_leads_density', next) } catch (e) { }
    return next
  })

  const hasFilters = Object.values(filters).some(Boolean) || search || quickFilter !== 'all'
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (search ? 1 : 0) + (quickFilter !== 'all' ? 1 : 0)

  // Build query with quick filter logic handled client-side for special cases
  const qFilters = { ...filters }
  if (quickFilter === 'hot') qFilters.risk = 'hot'
  if (quickFilter === 'new_today') qFilters.createdWithinDays = '1'

  const q = buildQuery({ ...qFilters, search: search.trim() || undefined, page, pageSize, sortBy, sortDir })
  const { data, loading, reload } = useFetch(() => api.get(`/api/leads?${q}`), [q, dataVersion])

  const setF = (k) => (e) => { setFilters(f => ({ ...f, [k]: e.target.value })); setPage(0) }
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setSearch(''); setQuickFilter('all'); setPage(0) }

  const changeStage = async (lead, stage) => {
    try { await api.patch(`/api/leads/${lead.id}`, { stage }); refreshData() }
    catch (e) { toast(e.message, 'error') }
  }

  const toggleSelect = (id) => setSelected(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const toggleSelectAll = () => {
    setSelectAllMatching(false)
    setSelected(s => s.size === items.length ? new Set() : new Set(items.map(l => l.id)))
  }

  const clearSelection = () => { setSelected(new Set()); setSelectAllMatching(false) }

  const selectAllMatchingFilter = async () => {
    setSelectAllBusy(true)
    try {
      const { ids } = await api.get(`/api/leads/ids?${q}`)
      setSelected(new Set(ids))
      setSelectAllMatching(true)
    } catch (e) { toast(e.message, 'error') }
    setSelectAllBusy(false)
  }

  const bulkChangeStage = async (stage) => {
    if (!stage || !selected.size) return
    setBulkBusy(true)
    try {
      const { updated } = await api.patch('/api/leads/bulk', { ids: [...selected], patch: { stage } })
      toast(`Moved ${updated} lead${updated === 1 ? '' : 's'} to ${stage}`)
      clearSelection(); refreshData()
    } catch (e) { toast(e.message, 'error') }
    setBulkBusy(false)
  }

  const bulkAssign = async (associateId) => {
    if (!associateId || !selected.size) return
    setBulkBusy(true)
    try {
      const { updated } = await api.patch('/api/leads/bulk', { ids: [...selected], patch: { associateId } })
      toast(`Reassigned ${updated} lead${updated === 1 ? '' : 's'}`)
      clearSelection(); refreshData()
    } catch (e) { toast(e.message, 'error') }
    setBulkBusy(false)
  }

  const bulkDelete = async () => {
    if (!selected.size) return
    if (!window.confirm(`Delete ${selected.size} lead${selected.size === 1 ? '' : 's'}? This can't be undone.`)) return
    setBulkBusy(true)
    try {
      const { deleted } = await api.delete('/api/leads/bulk', { ids: [...selected] })
      toast(`Deleted ${deleted} lead${deleted === 1 ? '' : 's'}`)
      clearSelection(); refreshData()
    } catch (e) { toast(e.message, 'error') }
    setBulkBusy(false)
  }

  const exportCsv = () => {
    const rows = data?.items || []
    const head = ['Full Name', 'Phone', 'Email', 'Source', 'Stage', 'Status', 'Owner', 'Location', 'Class Type', 'AI Score', 'Created At', 'Remarks', 'Missed Follow-ups']
    const lines = [head.join(',')]
    for (const l of rows) {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
      lines.push([l.fullName, l.phone, l.email, l.sourceName, l.stage, l.status, lookup.asnById[l.associateId]?.name || '', lookup.locById[l.locationId]?.name || '', l.classType, l.ai.score, l.createdAt, l.remarks, l.fu?.missedCount || 0].map(esc).join(','))
    }
    downloadText(`leads-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'))
    toast('Exported CSV')
  }

  const pages = Math.max(1, Math.ceil((data?.total || 0) / pageSize))
  let items = data?.items || []

  // Apply client-side quick filters for special cases
  if (quickFilter === 'overdue') {
    items = items.filter(l => l.fu?.missedCount > 0 || (l.followUps?.some(f => f.date && !f.done && f.date < new Date().toISOString().slice(0, 10))))
  } else if (quickFilter === 'unassigned') {
    items = items.filter(l => !l.associateId)
  } else if (quickFilter === 'high_value') {
    items = items.filter(l => (l.valueEstimate || 0) > 50000)
  } else if (quickFilter === 'needs_outreach') {
    const cadenceDays = boot?.settings?.cadence?.outreachDays || 7
    items = items.filter(l => l.status === 'open' && (l.fu?.lastOutreachDays || 0) > cadenceDays)
  }

  const cadenceDays = boot?.settings?.cadence?.outreachDays || 7
  const missedLeads = items.filter(l => l.fu?.missedCount > 0)
  const outreachLeads = items.filter(l => l.status === 'open' && l.fu?.lastOutreachDays > cadenceDays)

  const grouped = useMemo(() => {
    if (!groupBy) return null
    const map = new Map()
    for (const l of items) {
      const k = groupKey(l, groupBy, lookup)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(l)
    }
    return [...map.entries()].map(([key, list]) => ({ key, list }))
  }, [items, groupBy, lookup])

  const toggleGroup = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }))
  const savePinnedCols = (next) => {
    setPinnedCols(next)
    try { localStorage.setItem('p57_leads_pinned_cols', JSON.stringify(next)) } catch (e) { }
  }
  const toggleHeaderPinned = () => setHeaderPinned(current => {
    const next = !current
    try { localStorage.setItem('p57_leads_header_pinned', String(next)) } catch (e) { }
    return next
  })
  const jumpToTable = () => {
    const ids = [...new Set([...missedLeads, ...outreachLeads].map(l => l.id))]
    setFocusLeadIds(ids)
    setGroupBy('')
    setView('table')
    requestAnimationFrame(() => tableJumpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if (e.key === '?' && e.shiftKey) {
        setShowShortcuts(s => !s)
      }
      if (e.key === 'Escape') {
        setContextMenu(null)
        setShowShortcuts(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleContextMenu = (e, lead) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, lead })
  }

  const handleColumnResize = (colId, newWidth) => {
    const widths = { ...columnWidths, [colId]: newWidth }
    setColumnWidths(widths)
    try { localStorage.setItem('p57_leads_col_widths', JSON.stringify(widths)) } catch {}
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_80%_-20%,rgba(37,99,235,0.08),transparent),radial-gradient(900px_500px_at_0%_0%,rgba(139,92,246,0.06),transparent)]">
      <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Users size={18} className="text-white" />
              </div>
              <div>
                <h1 className="font-display text-[22px] font-bold tracking-tight text-white">Leads Command Center</h1>
                <p className="text-[12.5px] text-slate-400 mt-0.5 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {data?.total || 0} total leads</span>
                  <span className="text-slate-600">•</span>
                  <span>{items.length} filtered</span>
                  {selected.size > 0 && <><span className="text-slate-600">•</span><span className="text-violet-300 font-medium">{selected.size} selected</span></>}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost !py-2 !px-3 !text-[12.5px] border border-white/10 hover:border-white/20" onClick={() => setShowShortcuts(true)}>
              <span className="hidden sm:inline">Shortcuts</span> <span className="chip !px-1.5 !py-0 text-[10px] bg-white/10 border border-white/10">?</span>
            </button>
            <button className="btn btn-ghost !py-2 !text-[12.5px]" onClick={() => navigate('import')}>
              <Upload size={14} /> Import
            </button>
            <button className="btn btn-ghost !py-2 !text-[12.5px]" onClick={exportCsv}>
              <Download size={14} /> Export
            </button>
          </div>
        </div>

        {/* Quick Filters */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1 -mx-1 px-1">
          {QUICK_FILTERS.map(qf => {
            const Icon = qf.icon
            const isActive = quickFilter === qf.id
            return (
              <button
                key={qf.id}
                onClick={() => { setQuickFilter(qf.id); setPage(0) }}
                className={`group flex items-center gap-2 px-3.5 py-2 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-all border ${
                  isActive
                    ? 'bg-white text-slate-900 border-white shadow-lg shadow-black/10 scale-[1.02]'
                    : 'bg-white/[0.04] text-slate-400 border-white/10 hover:bg-white/[0.08] hover:text-white hover:border-white/15'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${isActive ? 'bg-slate-900 text-white' : 'bg-white/10 group-hover:bg-white/15'}`} style={isActive ? {} : { background: qf.color ? `${qf.color}18` : undefined, color: qf.color || undefined }}>
                  <Icon size={12} />
                </span>
                {qf.label}
                {qf.id === 'all' && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${isActive ? 'bg-slate-900 text-white' : 'bg-white/10 text-slate-400'}`}>{data?.total || 0}</span>}
              </button>
            )
          })}
          <div className="h-6 w-px bg-white/10 mx-1 shrink-0" />
          <button
            onClick={clearFilters}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[12.5px] font-medium border transition-colors ${hasFilters ? 'bg-amber-500/10 text-amber-300 border-amber-500/20 hover:bg-amber-500/15' : 'bg-white/[0.02] text-slate-500 border-white/5 hover:bg-white/[0.04]'}`}
          >
            <RotateCcw size={12} /> Clear {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>
        </div>

        {/* AI Intelligence Banner */}
        {(missedLeads.length > 0 || outreachLeads.length > 0) && (
          <div className="relative overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.08] via-orange-500/[0.05] to-rose-500/[0.05] backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(600px_200px_at_0%_0%,rgba(245,158,11,0.12),transparent)] pointer-events-none" />
            <div className="relative p-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <Sparkles size={16} className="text-white" />
                </div>
                <div>
                  <div className="font-display font-semibold text-white text-[13px] flex items-center gap-2">
                    AI detected attention needed
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-[10px] font-bold uppercase tracking-wider">Live</span>
                  </div>
                  <div className="text-[12px] text-slate-300 mt-0.5 flex flex-wrap gap-3">
                    {missedLeads.length > 0 && <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> <strong className="text-rose-300">{missedLeads.length} missed follow-ups</strong></span>}
                    {outreachLeads.length > 0 && <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> <strong className="text-amber-300">{outreachLeads.length} need outreach</strong> (idle &gt; {cadenceDays}d)</span>}
                  </div>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="hidden md:flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Zap size={12} className="text-amber-400" /> AI suggests next best actions on hover
                </div>
                <button className="btn btn-ghost !py-1.5 !text-[12px] bg-white/5 border border-white/10 hover:bg-white/10" onClick={jumpToTable}>
                  View in table <ArrowRight size={12} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Toolbar */}
        <div className="card !rounded-2xl p-3 flex flex-wrap items-center gap-2.5 backdrop-blur-xl bg-white/[0.03] border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="relative group">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-violet-400 transition-colors" />
            <input
              ref={searchInputRef}
              className="input !pl-9 !pr-9 !py-2 !rounded-xl !w-[280px] bg-white/[0.04] border-white/10 focus:bg-white/[0.06] focus:border-violet-500/30 focus:ring-2 focus:ring-violet-500/10 transition-all text-[13px]"
              placeholder="Search leads, phone, email… ( / )"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="h-6 w-px bg-white/10" />

          <button className={`btn !py-2 !px-3 !text-[12.5px] !rounded-xl border transition-all ${panelOpen ? 'bg-violet-500/15 border-violet-500/30 text-violet-300 shadow-[0_0_20px_rgba(139,92,246,0.15)]' : 'btn-ghost border-white/10 hover:border-white/20'}`} onClick={() => setPanelOpen(o => !o)}>
            <SlidersHorizontal size={14} /> Filters
            {activeFilterCount > 0 && <span className="ml-1 w-5 h-5 rounded-full bg-violet-500 text-white text-[10px] font-bold flex items-center justify-center">{activeFilterCount}</span>}
          </button>

          <select className="input !w-auto !py-2 !px-3 !rounded-xl !text-[12.5px] bg-white/[0.04] border-white/10 hover:bg-white/[0.06] cursor-pointer" value={groupBy} onChange={e => { setGroupBy(e.target.value); setCollapsed({}) }}>
            {GROUP_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.id ? `Group: ${g.label}` : 'No grouping'}</option>)}
          </select>

          <select className="input !w-auto !py-2 !px-3 !rounded-xl !text-[12.5px] bg-white/[0.04] border-white/10" value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(0) }}>
            <option value="createdAt">Created</option>
            <option value="fullName">Name</option>
            <option value="stage">Stage</option>
            <option value="ai.score">AI Score</option>
            <option value="valueEstimate">Value</option>
          </select>

          <button className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:border-white/15 flex items-center justify-center text-slate-400 hover:text-white transition-all" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
            <ArrowUpDown size={14} className={`transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`} />
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            {view === 'table' && (
              <>
                <div className="hidden lg:flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                  <button className={`px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium transition-all flex items-center gap-1.5 ${density === 'comfortable' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`} onClick={toggleDensity}>
                    <Rows3 size={12} /> Cozy
                  </button>
                  <button className={`px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium transition-all flex items-center gap-1.5 ${density === 'compact' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`} onClick={toggleDensity}>
                    <Layers size={12} /> Compact
                  </button>
                </div>
                <ColumnManager columns={columns} setColumns={setColumns} />
              </>
            )}

            <div className="flex rounded-xl overflow-hidden border border-white/10 bg-white/[0.03] p-1 gap-1">
              {VIEWS.map(v => {
                const Icon = v.icon
                const isActive = view === v.id
                return (
                  <button
                    key={v.id}
                    className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 text-[12px] font-medium transition-all ${isActive ? 'bg-white text-slate-900 shadow-sm shadow-black/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                    onClick={() => setView(v.id)}
                    title={`${v.label} - ${v.desc}`}
                  >
                    <Icon size={13} />
                    <span className="hidden xl:inline">{v.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Active Filter Chips */}
        {hasFilters && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active:</span>
            {search && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[12px]">
                <Search size={11} /> "{search}" <button onClick={() => setSearch('')} className="ml-1 hover:text-white"><X size={11} /></button>
              </span>
            )}
            {quickFilter !== 'all' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 text-[12px]">
                {QUICK_FILTERS.find(q => q.id === quickFilter)?.label} <button onClick={() => setQuickFilter('all')} className="ml-1 hover:text-white"><X size={11} /></button>
              </span>
            )}
            {Object.entries(filters).filter(([_, v]) => v).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 text-[12px]">
                {k}: {String(v).slice(0, 20)} <button onClick={() => setFilters(f => ({ ...f, [k]: '' }))} className="ml-1 hover:text-white"><X size={11} /></button>
              </span>
            ))}
            <button onClick={clearFilters} className="text-[11px] text-slate-500 hover:text-white ml-2 flex items-center gap-1"><RotateCcw size={11} /> Reset all</button>
          </div>
        )}

        {/* Filter Panel */}
        {panelOpen && (
          <div className="card !rounded-2xl p-5 border-white/[0.06] bg-white/[0.02] backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.2)] animate-[fadeIn_0.2s_ease]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-white text-[14px] flex items-center gap-2"><Filter size={14} className="text-violet-400" /> Advanced Filters</h3>
              <button onClick={() => setPanelOpen(false)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
              <FilterSelect label="Location" value={filters.locationId} onChange={setF('locationId')} icon={Target}>
                <option value="">All locations</option>
                {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </FilterSelect>
              <FilterSelect label="Stage" value={filters.stage} onChange={setF('stage')} icon={Layers}>
                <option value="">All stages</option>
                {(boot?.stages || []).map(s => <option key={s}>{s}</option>)}
              </FilterSelect>
              <FilterSelect label="Status" value={filters.status} onChange={setF('status')} icon={Activity}>
                <option value="">All statuses</option>
                <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
              </FilterSelect>
              <FilterSelect label="Owner" value={filters.associateId} onChange={setF('associateId')} icon={Users}>
                <option value="">All owners</option>
                {(boot?.associates || []).filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </FilterSelect>
              <FilterSelect label="Source" value={filters.sourceName} onChange={setF('sourceName')} icon={ExternalLink}>
                <option value="">All sources</option>
                {(boot?.sources || []).map(s => <option key={s}>{s}</option>)}
              </FilterSelect>
              <FilterSelect label="Channel" value={filters.channel} onChange={setF('channel')} icon={MessageCircle}>
                <option value="">All channels</option>
                {(boot?.channels || []).map(c => <option key={c}>{c}</option>)}
              </FilterSelect>
              <FilterSelect label="Class Type" value={filters.classType} onChange={setF('classType')} icon={Tag}>
                <option value="">All types</option>
                {(boot?.classTypes || []).map(c => <option key={c}>{c}</option>)}
              </FilterSelect>
              <FilterSelect label="AI Risk" value={filters.risk} onChange={setF('risk')} icon={Flame}>
                <option value="">All risk</option>
                <option value="hot">🔥 Hot</option><option value="warm">☀️ Warm</option><option value="cold">❄️ Cold</option>
              </FilterSelect>
              <div className="space-y-1.5">
                <label className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1"><BarChart3 size={10} /> Min Score</label>
                <input className="input !py-2 !rounded-xl !text-[13px] bg-white/[0.04] border-white/10 focus:border-violet-500/30" type="number" min={0} max={100} placeholder="0-100" value={filters.minScore} onChange={setF('minScore')} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1"><Calendar size={10} /> Created Within</label>
                <select className="input !py-2 !rounded-xl !text-[13px] bg-white/[0.04] border-white/10" value={filters.createdWithinDays} onChange={setF('createdWithinDays')}>
                  <option value="">Any time</option>
                  <option value="1">Today</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1"><Calendar size={10} /> From Date</label>
                <input className="input !py-2 !rounded-xl !text-[13px] bg-white/[0.04] border-white/10" type="date" value={filters.dateFrom} onChange={setF('dateFrom')} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1"><Calendar size={10} /> To Date</label>
                <input className="input !py-2 !rounded-xl !text-[13px] bg-white/[0.04] border-white/10" type="date" value={filters.dateTo} onChange={setF('dateTo')} />
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {view === 'summary' && <SummaryView items={items} boot={boot} lookup={lookup} />}
        {view === 'timeline' && <TimelineView items={items} lookup={lookup} openLead={openLead} />}
        {view === 'kanban' && <KanbanView items={items} boot={boot} lookup={lookup} openLead={openLead} changeStage={changeStage} />}

        {view !== 'summary' && view !== 'timeline' && view !== 'kanban' && (
          <div className="card !rounded-2xl overflow-hidden border-white/[0.06] bg-white/[0.02] backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.05)]" ref={tableJumpRef}>
            {view === 'table' && (
              <ModernTableView
                items={items} boot={boot} lookup={lookup} openLead={openLead}
                changeStage={changeStage} grouped={grouped} collapsed={collapsed} toggleGroup={toggleGroup}
                onMessage={setComposeLead} onTemplateMessage={setTemplateLead}
                selected={selected} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll}
                columns={columns} density={density} pinnedCols={pinnedCols} headerPinned={headerPinned}
                focusLeadIds={focusLeadIds} clearFocus={() => setFocusLeadIds([])}
                sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir}
                loading={loading} columnWidths={columnWidths} onColumnResize={handleColumnResize}
                onContextMenu={handleContextMenu}
              />
            )}
            {view === 'cards' && <CardsView items={items} lookup={lookup} openLead={openLead} grouped={grouped} collapsed={collapsed} toggleGroup={toggleGroup} boot={boot} onMessage={setComposeLead} onTemplateMessage={setTemplateLead} />}
            {view === 'compact' && <CompactView items={items} lookup={lookup} openLead={openLead} boot={boot} onMessage={setComposeLead} onTemplateMessage={setTemplateLead} />}
            {!loading && !items.length && (
              <div className="py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto mb-4">
                  <SearchX size={24} className="text-slate-500" />
                </div>
                <h3 className="font-display font-semibold text-white text-[15px]">No leads match your filters</h3>
                <p className="text-[13px] text-slate-500 mt-1 max-w-sm mx-auto">Try adjusting your filters, search terms, or quick filters to find what you're looking for.</p>
                <button className="btn btn-ghost !mt-4 !py-2 !text-[12.5px]" onClick={clearFilters}><RotateCcw size={14} /> Clear all filters</button>
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Showing <strong className="text-white font-semibold">{items.length}</strong> of <strong className="text-white font-semibold">{data?.total || 0}</strong> leads
              {loading && <span className="ml-2 inline-flex items-center gap-1.5 text-violet-400"><span className="w-3 h-3 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" /> Loading...</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-slate-400">
              <span className="text-[11px] uppercase tracking-wider font-semibold">Rows</span>
              <select className="input !w-auto !py-1.5 !px-2.5 !rounded-xl !text-[12.5px] bg-white/[0.04] border-white/10" value={pageSize} onChange={e => { const next = Number(e.target.value); setPageSize(next); setPage(0); localStorage.setItem('p57_leads_page_size', String(next)) }}>
                {[10, 25, 50, 100, 250].map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/10">
              <button className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-white/10 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                <ChevronRight size={14} className="rotate-180" />
              </button>
              <span className="px-3 py-1 text-[12px] font-medium text-white mono bg-white/[0.06] rounded-lg border border-white/10">{page + 1} / {pages}</span>
              <button className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-white/10 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all" disabled={page >= pages - 1} onClick={() => setPage(p => Math.min(pages - 1, p + 1))}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Floating Bulk Bar */}
        {selected.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)]">
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900/90 backdrop-blur-2xl border border-white/15 shadow-[0_16px_48px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.05),inset_0_1px_0_rgba(255,255,255,0.1)]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-violet-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
                  <Check size={14} className="text-white" />
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-white">{selectAllMatching ? `All ${selected.size} matching` : `${selected.size} selected`}</div>
                  <div className="text-[11px] text-slate-400 -mt-0.5">Bulk actions available</div>
                </div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              {!selectAllMatching && selected.size === items.length && (data?.total || 0) > items.length && (
                <button className="btn btn-ghost !py-1.5 !px-3 !text-[11.5px] !rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-violet-300" disabled={selectAllBusy} onClick={selectAllMatchingFilter}>
                  {selectAllBusy ? 'Loading…' : `Select all ${data.total}`}
                </button>
              )}
              <select className="input !w-auto !py-1.5 !px-3 !text-[12px] !rounded-xl bg-white/[0.06] border-white/15 text-white" disabled={bulkBusy} defaultValue="" onChange={e => { bulkChangeStage(e.target.value); e.target.value = '' }}>
                <option value="" disabled>Change stage…</option>
                {(boot?.stages || []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input !w-auto !py-1.5 !px-3 !text-[12px] !rounded-xl bg-white/[0.06] border-white/15 text-white" disabled={bulkBusy} defaultValue="" onChange={e => { bulkAssign(e.target.value); e.target.value = '' }}>
                <option value="" disabled>Assign owner…</option>
                {(boot?.associates || []).filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button className="w-8 h-8 rounded-xl bg-white/5 hover:bg-rose-500/10 border border-white/10 hover:border-rose-500/20 flex items-center justify-center text-slate-400 hover:text-rose-400 transition-colors" disabled={bulkBusy} onClick={bulkDelete} title="Delete selected">
                <Trash2 size={14} />
              </button>
              <div className="w-px h-8 bg-white/10" />
              <button className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors" onClick={clearSelection}>
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <ComposeModal open={!!composeLead} onClose={() => setComposeLead(null)} lead={composeLead} />
        <RespondioTemplateModal open={!!templateLead} onClose={() => setTemplateLead(null)} lead={templateLead} />

        {/* Context Menu */}
        {contextMenu && createPortal(
          <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onAction={(action) => {
            const lead = contextMenu.lead
            if (action === 'view') openLead(lead.id)
            if (action === 'message') setComposeLead(lead)
            if (action === 'template') setTemplateLead(lead)
            if (action === 'copy_phone') { navigator.clipboard.writeText(lead.phone); toast('Phone copied') }
            if (action === 'copy_email') { navigator.clipboard.writeText(lead.email); toast('Email copied') }
            setContextMenu(null)
          }} />,
          document.body
        )}

        {/* Shortcuts Modal */}
        {showShortcuts && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" onClick={() => setShowShortcuts(false)} />
            <div className="relative card !rounded-2xl p-6 w-full max-w-md bg-slate-900/90 backdrop-blur-2xl border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.5)] animate-[fadeIn_0.2s_ease]">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-display font-bold text-white text-[16px] flex items-center gap-2"><Zap size={16} className="text-violet-400" /> Keyboard Shortcuts</h3>
                <button onClick={() => setShowShortcuts(false)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white"><X size={14} /></button>
              </div>
              <div className="space-y-3 text-[12.5px]">
                {[
                  { keys: ['/'], desc: 'Focus search' },
                  { keys: ['⌘', 'K'], desc: 'Focus search' },
                  { keys: ['?'], desc: 'Toggle shortcuts' },
                  { keys: ['Esc'], desc: 'Clear selection / close' },
                  { keys: ['Click'], desc: 'Open lead drawer' },
                  { keys: ['Shift', 'Click'], desc: 'Range select (coming soon)' },
                  { keys: ['Right Click'], desc: 'Context menu' },
                ].map(item => (
                  <div key={item.desc} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <span className="text-slate-400">{item.desc}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map(k => <span key={k} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-white text-[11px] font-medium mono">{k}</span>)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>

      <style>{`
        @keyframes slideUp { from { transform: translate(-50%, 100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}

function groupKey(l, by, lookup) {
  switch (by) {
    case 'locationId': return lookup.locById[l.locationId]?.name || 'Unassigned'
    case 'stage': return l.stage || 'Unknown'
    case 'status': return (l.status || 'open').toUpperCase()
    case 'sourceName': return l.sourceName || 'Unknown'
    case 'associateId': return lookup.asnById[l.associateId]?.name || 'Unassigned'
    case 'classType': return l.classType || 'None'
    case 'risk': return l.ai?.risk || 'cold'
    default: return ''
  }
}

function FilterSelect({ label, value, onChange, children, icon: Icon }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1">
        {Icon && <Icon size={10} className="text-slate-500" />} {label}
      </label>
      <select className="input !py-2 !rounded-xl !text-[12.5px] bg-white/[0.04] border-white/10 focus:border-violet-500/30 focus:bg-white/[0.06] w-full" value={value} onChange={onChange}>{children}</select>
    </div>
  )
}

function ContextMenu({ menu, onClose, onAction }) {
  const ref = useRef(null)
  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('keydown', handleEsc)
    return () => { document.removeEventListener('mousedown', handleClick, true); document.removeEventListener('keydown', handleEsc) }
  }, [onClose])

  const x = Math.min(menu.x, window.innerWidth - 220)
  const y = Math.min(menu.y, window.innerHeight - 300)

  return (
    <div ref={ref} className="fixed z-[9999] w-[200px] rounded-xl bg-slate-900/95 backdrop-blur-2xl border border-white/10 shadow-[0_16px_48px_rgba(0,0,0,0.4)] p-1.5 animate-[fadeIn_0.15s_ease]" style={{ left: x, top: y }}>
      <div className="px-2.5 py-2 border-b border-white/5 mb-1">
        <div className="text-[12px] font-semibold text-white truncate">{menu.lead.fullName}</div>
        <div className="text-[11px] text-slate-400 truncate">{menu.lead.phone}</div>
      </div>
      {[
        { id: 'view', label: 'View details', icon: Eye },
        { id: 'message', label: 'Send message', icon: MessageCircle },
        { id: 'template', label: 'Send template', icon: Sparkles },
        { id: 'divider' },
        { id: 'copy_phone', label: 'Copy phone', icon: Copy },
        { id: 'copy_email', label: 'Copy email', icon: Mail },
        { id: 'divider' },
        { id: 'edit', label: 'Edit lead', icon: Edit3, disabled: true },
      ].map(item => item.id === 'divider' ? <div key={Math.random()} className="h-px bg-white/5 my-1" /> : (
        <button key={item.id} disabled={item.disabled} onClick={() => !item.disabled && onAction(item.id)} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left">
          <item.icon size={13} className="text-slate-500" /> {item.label}
        </button>
      ))}
    </div>
  )
}

function ModernTableView({ items, boot, lookup, openLead, changeStage, grouped, collapsed, toggleGroup, onMessage, onTemplateMessage, selected, toggleSelect, toggleSelectAll, columns, density, pinnedCols = [], headerPinned = true, focusLeadIds = [], clearFocus, sortBy, sortDir, setSortBy, setSortDir, loading, columnWidths, onColumnResize, onContextMenu }) {
  const focusedItems = focusLeadIds.length ? items.filter(l => focusLeadIds.includes(l.id)) : items
  if (grouped) {
    return (
      <div className="divide-y divide-white/[0.04]">
        {grouped.map(g => {
          const isOpen = !collapsed[g.key]
          return (
            <div key={g.key}>
              <button className="w-full flex flex-wrap items-center gap-3 px-5 py-3.5 bg-white/[0.02] hover:bg-white/[0.04] border-b border-white/[0.04] transition-colors text-left group" onClick={() => toggleGroup(g.key)}>
                <div className="w-7 h-7 rounded-lg bg-white/[0.04] group-hover:bg-white/[0.08] border border-white/10 flex items-center justify-center transition-colors">
                  <ChevronRight size={14} className={`text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </div>
                <span className="font-display text-[13.5px] font-semibold text-white">{g.key}</span>
                <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400 text-[11px] font-medium">{g.list.length} leads</span>
                <GroupSummary list={g.list} />
              </button>
              {isOpen && <ModernTableGrid items={focusLeadIds.length ? g.list.filter(l => focusLeadIds.includes(l.id)) : g.list} boot={boot} lookup={lookup} openLead={openLead} changeStage={changeStage} onMessage={onMessage} onTemplateMessage={onTemplateMessage} selected={selected} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} columns={columns} density={density} pinnedCols={pinnedCols} headerPinned={headerPinned} focusLeadIds={focusLeadIds} clearFocus={clearFocus} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} loading={loading} columnWidths={columnWidths} onColumnResize={onColumnResize} onContextMenu={onContextMenu} />}
            </div>
          )
        })}
      </div>
    )
  }
  return <ModernTableGrid items={focusedItems} boot={boot} lookup={lookup} openLead={openLead} changeStage={changeStage} onMessage={onMessage} onTemplateMessage={onTemplateMessage} selected={selected} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} columns={columns} density={density} pinnedCols={pinnedCols} headerPinned={headerPinned} focusLeadIds={focusLeadIds} clearFocus={clearFocus} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} loading={loading} columnWidths={columnWidths} onColumnResize={onColumnResize} onContextMenu={onContextMenu} />
}

function ModernTableGrid({ items, boot, lookup, openLead, changeStage, onMessage, onTemplateMessage, selected, toggleSelect, toggleSelectAll, columns, density, pinnedCols = [], headerPinned = true, focusLeadIds = [], clearFocus, sortBy, sortDir, setSortBy, setSortDir, loading, columnWidths, onColumnResize, onContextMenu }) {
  const cadenceDays = boot?.settings?.cadence?.outreachDays || 7
  const allChecked = items.length > 0 && items.every(l => selected?.has(l.id))
  const visibleCols = (columns || []).filter(c => !c.hidden && c.field !== 'created')
  const py = density === 'compact' ? 'py-2' : 'py-3'
  const rowHeight = density === 'compact' ? 'h-[52px]' : 'h-[68px]'

  return (
    <div className="relative">
      {focusLeadIds.length > 0 && (
        <div className="sticky top-0 z-20 px-5 py-3 flex items-center gap-3 bg-amber-500/5 border-b border-amber-500/10 backdrop-blur-xl">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/20 text-amber-300 text-[11px] font-medium"><AlertTriangle size={11} /> {focusLeadIds.length} highlighted</span>
          <button className="btn btn-ghost !py-1 !px-2.5 !text-[11px] !rounded-full bg-white/5 border border-white/10 hover:bg-white/10" onClick={clearFocus}>Show all</button>
        </div>
      )}

      <div className="overflow-auto scrollbar-thin max-h-[68vh] relative" style={{ scrollbarGutter: 'stable' }}>
        <table className="w-full border-collapse" style={{ minWidth: 1200 }}>
          <thead className={headerPinned ? 'sticky top-0 z-10' : ''}>
            <tr className="border-b border-white/[0.06] bg-[#0f1220]/80 backdrop-blur-2xl">
              <th className={`px-3 ${py} w-[48px] text-left ${pinnedCols.includes('select') ? 'sticky left-0 z-20 bg-[#0f1220]/95 backdrop-blur-xl' : ''}`}>
                <button onClick={toggleSelectAll} className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${allChecked ? 'bg-violet-500 border-violet-500 text-white shadow-[0_0_12px_rgba(139,92,246,0.3)]' : 'bg-white/[0.04] border-white/15 hover:border-white/25 hover:bg-white/[0.08] text-slate-500'}`}>
                  {allChecked ? <Check size={12} /> : null}
                </button>
              </th>
              <ModernSortHead label="Lead" field="fullName" width={columnWidths['lead'] || 280} pinned={pinnedCols.includes('lead')} left={48} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} onResize={(w) => onColumnResize('lead', w)} />
              <ModernSortHead label="Stage" field="stage" width={columnWidths['stage'] || 160} pinned={pinnedCols.includes('stage')} left={328} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} onResize={(w) => onColumnResize('stage', w)} />
              <ModernSortHead label="Owner" field="owner" width={columnWidths['owner'] || 160} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} onResize={(w) => onColumnResize('owner', w)} />
              <ModernSortHead label="Score" field="ai.score" width={80} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} />
              {visibleCols.slice(0, 3).map(c => (
                <ModernSortHead key={c.id} label={c.label} field={c.field || c.id} width={columnWidths[c.id] || 140} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} onResize={(w) => onColumnResize(c.id, w)} />
              ))}
              <th className="px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Follow-up</th>
              <th className="px-2 py-3 text-center text-[10.5px] font-bold uppercase tracking-wider text-slate-500 w-[120px]">Channels</th>
              <th className="px-3 py-3 text-right text-[10.5px] font-bold uppercase tracking-wider text-slate-500 w-[100px]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-3 py-3"><div className="w-5 h-5 rounded-md bg-white/5" /></td>
                  <td className="px-4 py-3"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-full bg-white/5" /><div className="space-y-1.5"><div className="w-24 h-3 rounded bg-white/5" /><div className="w-16 h-2 rounded bg-white/5" /></div></div></td>
                  <td className="px-4 py-3"><div className="w-20 h-6 rounded-full bg-white/5" /></td>
                  <td className="px-4 py-3"><div className="w-16 h-6 rounded-full bg-white/5" /></td>
                  <td className="px-4 py-3"><div className="w-8 h-8 rounded-full bg-white/5" /></td>
                  <td colSpan={5}><div className="h-3 rounded bg-white/5 w-3/4" /></td>
                </tr>
              ))
            ) : (
              items.map(l => {
                const owner = lookup.asnById[l.associateId]
                const nextFu = l.followUps?.find(f => f.date && f.done === false && f.date !== '-')
                const dueIn = nextFu ? daysFromNow(nextFu.date) : null
                const isSelected = selected?.has(l.id)
                const isFocused = focusLeadIds.includes(l.id)
                const stageStyle = STAGE_COLORS[l.stage] || STAGE_COLORS['New Lead']

                return (
                  <tr
                    key={l.id}
                    onClick={() => openLead(l.id)}
                    onContextMenu={(e) => onContextMenu(e, l)}
                    className={`group relative transition-all cursor-pointer ${rowHeight} ${
                      isSelected ? 'bg-violet-500/[0.06] !border-violet-500/20' : isFocused ? 'bg-amber-500/[0.06] ring-1 ring-amber-500/20' : 'hover:bg-white/[0.03] hover:backdrop-blur-sm'
                    }`}
                  >
                    <td className={`px-3 ${py} ${pinnedCols.includes('select') ? 'sticky left-0 z-10 bg-inherit backdrop-blur-xl' : ''}`} onClick={e => e.stopPropagation()}>
                      <button onClick={() => toggleSelect(l.id)} className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${isSelected ? 'bg-violet-500 border-violet-500 text-white shadow-[0_0_12px_rgba(139,92,246,0.3)]' : 'bg-white/[0.03] border-white/10 group-hover:border-white/20 group-hover:bg-white/[0.06] text-transparent group-hover:text-slate-400'}`}>
                        {isSelected ? <Check size={12} /> : <span className="w-2 h-2 rounded-[2px] bg-current opacity-0 group-hover:opacity-100 transition-opacity" />}
                      </button>
                    </td>

                    <td className={`px-4 ${py} ${pinnedCols.includes('lead') ? 'sticky left-[48px] z-10 bg-inherit backdrop-blur-xl' : ''}`} style={{ width: columnWidths['lead'] || 280 }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative">
                          <Avatar name={l.fullName} color={owner?.color} size={density === 'compact' ? 32 : 40} />
                          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0f1220] ${l.status === 'won' ? 'bg-emerald-400' : l.status === 'lost' ? 'bg-slate-500' : l.fu?.missedCount > 0 ? 'bg-rose-400' : l.ai?.risk === 'hot' ? 'bg-orange-400' : 'bg-emerald-400'}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13.5px] font-semibold text-white truncate group-hover:text-violet-200 transition-colors">{l.fullName}</span>
                            {l.ai?.score >= 80 && <span className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm"><Star size={8} className="text-white fill-white" /></span>}
                            {(l.flags || []).slice(0, 2).map(f => (
                              <span key={f.id} className="px-1.5 py-0.5 rounded-full text-[9px] font-bold border" style={{ background: `${f.color}15`, color: f.color, borderColor: `${f.color}30` }}>{f.label.slice(0, 6)}</span>
                            ))}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-slate-500 truncate max-w-[140px]">{l.email !== '-' ? l.email : l.phone}</span>
                            {l.sourceName && <span className="px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-slate-400">{l.sourceName.split(' ')[0]}</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className={`px-3 ${py} ${pinnedCols.includes('stage') ? 'sticky left-[328px] z-10 bg-inherit backdrop-blur-xl' : ''}`} onClick={e => e.stopPropagation()}>
                      <div className="relative group/stage">
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11.5px] font-medium cursor-pointer hover:scale-[1.02] transition-all" style={{ background: stageStyle.bg, borderColor: stageStyle.border, color: stageStyle.text }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: stageStyle.dot, boxShadow: `0 0 8px ${stageStyle.dot}` }} />
                          {l.stage}
                          <ChevronDown size={11} className="opacity-60 group-hover/stage:opacity-100 transition-opacity" />
                        </div>
                        <select className="absolute inset-0 opacity-0 cursor-pointer w-full" value={l.stage} onChange={e => changeStage(l, e.target.value)}>
                          {(boot?.stages || []).map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </td>

                    <td className={`px-3 ${py}`}>
                      <div className="flex items-center gap-2">
                        {owner ? (
                          <>
                            <Avatar name={owner.name} color={owner.color} size={24} />
                            <span className="text-[12.5px] text-slate-300 truncate max-w-[80px]">{owner.name.split(' ')[0]}</span>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px]"><UserX size={11} /> Unassigned</span>
                        )}
                      </div>
                    </td>

                    <td className={`px-3 ${py}`}>
                      <div className="flex items-center gap-2">
                        <div className="relative w-8 h-8">
                          <svg className="w-8 h-8 rotate-[-90deg]" viewBox="0 0 32 32">
                            <circle cx="16" cy="16" r="12" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
                            <circle cx="16" cy="16" r="12" fill="none" stroke={l.ai.score >= 70 ? '#f43f5e' : l.ai.score >= 45 ? '#f59e0b' : '#64748b'} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 12}`} strokeDashoffset={`${2 * Math.PI * 12 * (1 - l.ai.score / 100)}`} style={{ transition: 'stroke-dashoffset 0.6s ease', filter: `drop-shadow(0 0 4px ${l.ai.score >= 70 ? '#f43f5e' : l.ai.score >= 45 ? '#f59e0b' : '#64748b'}60)` }} />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white mono">{l.ai.score}</span>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${l.ai.risk === 'hot' ? 'bg-rose-500/15 text-rose-300 border-rose-500/20' : l.ai.risk === 'warm' ? 'bg-amber-500/15 text-amber-300 border-amber-500/20' : 'bg-slate-500/15 text-slate-400 border-slate-500/20'}`}>{l.ai.risk}</span>
                      </div>
                    </td>

                    {visibleCols.slice(0, 3).map(c => {
                      const val = getColumnValue(c, l, lookup)
                      return (
                        <td key={c.id} className={`px-3 ${py} text-[12.5px] ${c.type === 'number' || c.type === 'currency' ? 'mono text-slate-300 font-medium' : 'text-slate-400'}`} style={{ width: columnWidths[c.id] || 140 }}>
                          <span className="truncate block max-w-[130px]">{formatColumnValue(val, c)}</span>
                        </td>
                      )
                    })}

                    <td className={`px-3 ${py}`}>
                      {nextFu ? (
                        <div className="space-y-1">
                          <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium border ${dueIn < 0 ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : dueIn === 0 ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-white/5 border-white/10 text-slate-400'}`}>
                            <Clock size={10} /> {fmtDate(nextFu.date)} {dueIn < 0 ? `• ${-dueIn}d overdue` : dueIn === 0 ? '• today' : ''}
                          </div>
                          {(l.fu?.missedCount > 0 || (l.status === 'open' && l.fu?.lastOutreachDays > cadenceDays)) && (
                            <div className="flex gap-1">
                              {l.fu?.missedCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/20 text-rose-300 text-[9px] font-bold">{l.fu.missedCount} missed</span>}
                              {l.status === 'open' && l.fu?.lastOutreachDays > cadenceDays && <span className="px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/15 text-amber-300 text-[9px]">idle {l.fu.lastOutreachDays}d</span>}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/[0.03] border border-white/5 text-slate-500 text-[11px]"><Calendar size={10} /> No FU</span>
                      )}
                    </td>

                    <td className="px-2 py-2">
                      <div className="flex items-center justify-center gap-1">
                        {['call', 'whatsapp', 'email', 'sms'].map(ch => (
                          <FuCell key={ch} lead={l} ch={ch} />
                        ))}
                      </div>
                    </td>

                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                        <button className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-violet-500/15 border border-white/5 hover:border-violet-500/20 flex items-center justify-center text-slate-400 hover:text-violet-300 transition-colors" onClick={() => openLead(l.id)} title="View">
                          <Eye size={12} />
                        </button>
                        <button className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-emerald-500/15 border border-white/5 hover:border-emerald-500/20 flex items-center justify-center text-slate-400 hover:text-emerald-300 transition-colors" onClick={() => onMessage(l)} title="Message">
                          <MessageCircle size={12} />
                        </button>
                        <button className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-fuchsia-500/15 border border-white/5 hover:border-fuchsia-500/20 flex items-center justify-center text-slate-400 hover:text-fuchsia-300 transition-colors" onClick={() => onTemplateMessage(l)} title="Template">
                          <Sparkles size={12} />
                        </button>
                        <button className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-white/15 flex items-center justify-center text-slate-500 hover:text-white transition-colors" onClick={(e) => onContextMenu(e, l)} title="More">
                          <MoreHorizontal size={12} />
                        </button>
                      </div>
                      <div className="flex items-center justify-end gap-1 group-hover:hidden">
                        <span className="w-1 h-1 rounded-full bg-slate-600" />
                        <span className="w-1 h-1 rounded-full bg-slate-600" />
                        <span className="w-1 h-1 rounded-full bg-slate-600" />
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ModernSortHead({ label, field, width, pinned, left, sortBy, sortDir, setSortBy, setSortDir, onResize }) {
  const active = sortBy === field
  const [resizing, setResizing] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const handleMouseDown = (e) => {
    if (!onResize) return
    setResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = width
    e.preventDefault()
  }

  useEffect(() => {
    if (!resizing) return
    const handleMouseMove = (e) => {
      const diff = e.clientX - startXRef.current
      const newWidth = Math.max(80, startWidthRef.current + diff)
      onResize(newWidth)
    }
    const handleMouseUp = () => setResizing(false)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp) }
  }, [resizing, onResize])

  return (
    <th
      className={`group relative px-4 py-3 text-left select-none ${pinned ? 'sticky z-20 bg-[#0f1220]/95 backdrop-blur-xl' : ''}`}
      style={{ width, ...(pinned ? { left } : {}) }}
    >
      <button className="flex items-center gap-1.5 w-full text-left" onClick={() => { setSortBy(field); setSortDir(active && sortDir === 'asc' ? 'desc' : 'asc') }}>
        <span className={`text-[10.5px] font-bold uppercase tracking-wider transition-colors ${active ? 'text-violet-300' : 'text-slate-500 group-hover:text-slate-300'}`}>{label}</span>
        <span className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${active ? 'bg-violet-500/15 text-violet-300' : 'bg-white/[0.03] text-slate-600 group-hover:bg-white/[0.06] group-hover:text-slate-400'}`}>
          <ChevronDown size={11} className={`transition-transform ${active && sortDir === 'asc' ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {onResize && (
        <div className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-violet-500/50 group-hover:bg-white/10 transition-colors" onMouseDown={handleMouseDown} title="Drag to resize">
          <div className="absolute inset-y-2 right-0 w-px bg-white/10 group-hover:bg-white/20" />
        </div>
      )}
    </th>
  )
}

function FuCell({ lead, ch }) {
  const o = lead.fu?.outreach?.[ch]
  const filled = !!o?.filled
  const missed = filled && o?.pending
  const today = new Date().toISOString().slice(0, 10)
  const isMissed = missed && missed < today
  const suggestion = lead.ai?.followupSuggestions?.find(s => s.channel === ch)?.text
  const Icon = CHANNELS[ch].icon
  const anchorRef = useRef(null)
  const [popOpen, setPopOpen] = useState(false)
  const [pos, setPos] = useState(null)

  const openPopover = (e) => {
    e.stopPropagation()
    const r = anchorRef.current.getBoundingClientRect()
    setPos({ x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom + 6) })
    setPopOpen(true)
  }

  return (
    <>
      <Tip content={<FuTip lead={lead} ch={ch} o={o} suggestion={suggestion} isMissed={isMissed} />}>
        <button
          ref={anchorRef}
          onClick={openPopover}
          className={`w-7 h-7 rounded-lg flex items-center justify-center border transition-all hover:scale-110 hover:shadow-lg ${
            filled ? (isMissed ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.15)]' : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.15)]') : 'bg-white/[0.03] border-white/10 text-slate-600 hover:bg-white/[0.06] hover:border-white/15 hover:text-slate-400'
          }`}
        >
          {filled ? <Icon size={12} /> : <span className="text-[10px]">—</span>}
        </button>
      </Tip>
      {popOpen && pos && createPortal(
        <QuickFollowUpPopover lead={lead} ch={ch} pos={pos} onClose={() => setPopOpen(false)} />,
        document.body
      )}
    </>
  )
}

function QuickFollowUpPopover({ lead, ch, pos, onClose }) {
  const { toast, refreshData } = useApp()
  const [channel, setChannel] = useState(ch)
  const [comments, setComments] = useState('')
  const [saving, setSaving] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    const handleClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onClose() }
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const submit = async (e) => {
    e.preventDefault()
    if (!comments.trim()) return
    setSaving(true)
    try {
      await api.post(`/api/leads/${lead.id}/followups`, {
        date: new Date().toISOString().slice(0, 10),
        comments: comments.trim(),
        channel
      })
      toast('Follow-up logged')
      refreshData()
      onClose()
    } catch (err) { toast(err.message, 'error') }
    finally { setSaving(false) }
  }

  const vw = window.innerWidth
  const half = 145
  const x = Math.max(half + 12, Math.min(pos.x, vw - half - 12))

  return (
    <div className="fixed pointer-events-none z-[2147483000]" style={{ left: 0, top: 0, transform: `translate(${x}px, ${pos.y}px) translate(-50%, 0)` }}>
      <form ref={boxRef} onSubmit={submit} onClick={e => e.stopPropagation()} className="pointer-events-auto rounded-2xl p-4 shadow-2xl space-y-3 bg-slate-900/95 backdrop-blur-2xl border border-white/10 w-[300px] animate-[fadeIn_0.15s_ease]">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-white flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center"><MessageCircle size={12} className="text-violet-400" /></span> Log follow-up</span>
          <button type="button" className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors" onClick={onClose}><X size={12} /></button>
        </div>
        <div className="flex gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/5">
          {Object.entries(CHANNELS).map(([key, meta]) => {
            const ChanIcon = meta.icon
            const active = channel === key
            return (
              <button key={key} type="button" onClick={() => setChannel(key)} className={`flex-1 h-8 rounded-lg flex items-center justify-center border transition-all ${active ? 'bg-white text-slate-900 border-white shadow-sm' : 'bg-transparent border-transparent text-slate-500 hover:text-white hover:bg-white/5'}`}>
                <ChanIcon size={13} />
              </button>
            )
          })}
        </div>
        <input autoFocus className="input !py-2.5 !rounded-xl !text-[12px] bg-white/[0.04] border-white/10 focus:border-violet-500/30 focus:bg-white/[0.06]" placeholder="Note / outcome…" value={comments} onChange={e => setComments(e.target.value)} />
        <button className="btn btn-primary w-full !py-2.5 !rounded-xl !text-[12px] font-semibold shadow-[0_4px_16px_rgba(139,92,246,0.2)]" type="submit" disabled={saving || !comments.trim()}>
          {saving ? 'Saving…' : 'Log follow-up'}
        </button>
      </form>
    </div>
  )
}

function FuTip({ lead, ch, o, suggestion, isMissed }) {
  const meta = CHANNELS[ch]
  return (
    <div className="space-y-2.5 min-w-[240px]">
      <div className="flex items-center gap-2.5">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center border" style={{ background: meta.bg, borderColor: `${meta.color}30`, color: meta.color }}>
          <meta.icon size={13} />
        </span>
        <span className="text-[12px] font-bold text-white">{meta.label}</span>
        {isMissed && <span className="px-1.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/20 text-rose-300 text-[9px] font-bold uppercase">missed</span>}
        {o?.filled && !isMissed && <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 text-[9px] font-bold uppercase">done</span>}
        {o?.date && <span className="ml-auto text-[11px] text-slate-400 mono">{fmtDate(o.date)}</span>}
      </div>
      <div className="text-[11.5px] text-slate-300 leading-relaxed bg-white/[0.03] border border-white/5 rounded-xl p-2.5">{o?.comments || `No ${meta.label} follow-up logged yet.`}</div>
      {suggestion && (
        <div className="rounded-xl bg-gradient-to-br from-fuchsia-500/10 to-violet-500/10 border border-fuchsia-400/20 p-2.5">
          <div className="text-[9.5px] uppercase tracking-wider text-fuchsia-300 font-bold mb-1 flex items-center gap-1"><Sparkles size={10} /> AI suggested</div>
          <div className="text-[11.5px] text-slate-200 leading-relaxed">"{suggestion}"</div>
        </div>
      )}
    </div>
  )
}

function GroupSummary({ list }) {
  const total = list.length
  const won = list.filter(l => l.status === 'won').length
  const conversion = total ? Math.round((won / total) * 100) : 0
  const openValue = list.reduce((s, l) => s + (l.status === 'open' ? (l.valueEstimate || 0) : 0), 0)
  const avgScore = total ? Math.round(list.reduce((s, l) => s + (l.ai?.score || 0), 0) / total) : 0

  return (
    <span className="flex flex-wrap items-center gap-1.5 ml-auto">
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400 text-[11px]"><Users size={11} /> {total}</span>
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]"><TrendingUp size={11} /> {conversion}%</span>
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px]"><Wallet size={11} /> {money(openValue)}</span>
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-300 text-[11px]"><Sparkles size={11} /> {avgScore}</span>
    </span>
  )
}

// Keep existing Cards, Compact, Summary, Kanban, Timeline but with improved styling wrappers
function CardsView({ items, lookup, openLead, grouped, collapsed, toggleGroup, boot, onMessage, onTemplateMessage }) {
  const inner = (list) => (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 p-5">
      {list.map(l => {
        const owner = lookup.asnById[l.associateId]
        const nextFu = l.followUps?.find(f => f.date && f.done === false && f.date !== '-')
        const stageStyle = STAGE_COLORS[l.stage] || STAGE_COLORS['New Lead']
        return (
          <div key={l.id} className="group relative card !rounded-2xl p-4 hover:!border-violet-500/20 hover:shadow-[0_8px_32px_rgba(0,0,0,0.2),0_0_0_1px_rgba(139,92,246,0.1)] hover:-translate-y-0.5 transition-all cursor-pointer bg-white/[0.02] backdrop-blur-xl border-white/[0.06]" onClick={() => openLead(l.id)}>
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            <div className="relative">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <Avatar name={l.fullName} color={owner?.color} size={40} />
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#141829] ${l.status === 'won' ? 'bg-emerald-400' : l.fu?.missedCount > 0 ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                  </div>
                  <div>
                    <div className="text-[13.5px] font-semibold text-white group-hover:text-violet-200 transition-colors">{l.fullName}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1"><Target size={10} /> {lookup.locById[l.locationId]?.name?.split(',')[0] || '—'}</div>
                  </div>
                </div>
                <ScorePill score={l.ai.score} />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10.5px] font-medium" style={{ background: stageStyle.bg, borderColor: stageStyle.border, color: stageStyle.text }}><span className="w-1 h-1 rounded-full" style={{ background: stageStyle.dot }} /> {l.stage}</span>
                <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${l.ai.risk === 'hot' ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : 'bg-white/5 border-white/10 text-slate-400'}`}>{l.ai.risk}</span>
                <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400 text-[10px]">{l.sourceName?.split(' ')[0]}</span>
              </div>
              <div className="text-[11.5px] text-slate-400 line-clamp-2 mb-3 min-h-[32px] bg-white/[0.02] border border-white/[0.03] rounded-xl p-2.5">{l.ai?.nextAction?.text || 'No AI suggestion'}</div>
              <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5"><Avatar name={owner?.name || 'Unassigned'} size={16} /> {owner ? owner.name.split(' ')[0] : 'Unassigned'}</span>
                <div className="flex items-center gap-1">
                  {['call', 'whatsapp', 'email', 'sms'].map(ch => {
                    const filled = !!l.fu?.outreach?.[ch]?.filled
                    const Icon = CHANNELS[ch].icon
                    return <span key={ch} className={`w-6 h-6 rounded-lg flex items-center justify-center border ${filled ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/[0.03] border-white/5 text-slate-600'}`}><Icon size={10} /></span>
                  })}
                </div>
              </div>
              <div className="flex gap-1.5 mt-3 opacity-0 group-hover:opacity-100 transition-all">
                <button className="flex-1 py-2 rounded-xl bg-violet-500/10 hover:bg-violet-500/15 border border-violet-500/20 text-violet-300 text-[11px] font-medium flex items-center justify-center gap-1" onClick={e => { e.stopPropagation(); openLead(l.id) }}><Eye size={11} /> View</button>
                <button className="flex-1 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium flex items-center justify-center gap-1" onClick={e => { e.stopPropagation(); onMessage(l) }}><MessageCircle size={11} /> Message</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
  if (grouped) {
    return (
      <div className="divide-y divide-white/[0.04]">
        {grouped.map(g => {
          const isOpen = !collapsed[g.key]
          return (
            <div key={g.key}>
              <button className="w-full flex items-center gap-3 px-5 py-3.5 bg-white/[0.02] hover:bg-white/[0.04] text-left" onClick={() => toggleGroup(g.key)}>
                <ChevronRight size={14} className={`text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                <span className="font-display font-semibold text-white text-[13px]">{g.key}</span>
                <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400 text-[11px]">{g.list.length}</span>
              </button>
              {isOpen && inner(g.list)}
            </div>
          )
        })}
      </div>
    )
  }
  return inner(items)
}

function CompactView({ items, lookup, openLead, boot, onMessage, onTemplateMessage }) {
  return (
    <div className="divide-y divide-white/[0.03]">
      {items.map(l => {
        const owner = lookup.asnById[l.associateId]
        const nextFu = l.followUps?.find(f => f.date && f.done === false && f.date !== '-')
        return (
          <div key={l.id} className="group flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] cursor-pointer transition-colors" onClick={() => openLead(l.id)}>
            <Avatar name={l.fullName} color={owner?.color} size={32} />
            <div className="min-w-0 w-[200px]">
              <div className="text-[13px] font-medium text-white truncate group-hover:text-violet-200 transition-colors">{l.fullName}</div>
              <div className="text-[11px] text-slate-500 truncate">{l.phone}</div>
            </div>
            <span className={`px-2 py-1 rounded-full text-[10px] font-medium border hidden sm:inline-flex ${l.ai.risk === 'hot' ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : 'bg-white/5 border-white/10 text-slate-400'}`}>{l.ai.risk}</span>
            <span className="text-[12px] text-slate-400 w-[130px] truncate hidden md:block">{l.stage}</span>
            <span className="text-[12px] text-slate-500 w-[120px] truncate hidden lg:block">{owner?.name || 'Unassigned'}</span>
            <div className="flex items-center gap-1.5 ml-auto">
              {['call', 'whatsapp', 'email', 'sms'].map(ch => {
                const filled = !!l.fu?.outreach?.[ch]?.filled
                const Icon = CHANNELS[ch].icon
                return <span key={ch} className={`w-6 h-6 rounded-lg flex items-center justify-center border ${filled ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/[0.03] border-white/5 text-slate-600'}`}><Icon size={10} /></span>
              })}
              {nextFu && <span className={`text-[11px] mono ml-2 px-2 py-1 rounded-full border ${daysFromNow(nextFu.date) < 0 ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-white/5 border-white/10 text-slate-500'}`}>{fmtDate(nextFu.date)}</span>}
              <ScorePill score={l.ai.score} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SummaryView({ items, boot, lookup }) {
  const byStage = {}
  const bySource = {}
  const byOwner = {}
  let open = 0, won = 0, lost = 0, hot = 0, estValue = 0, scores = []
  for (const l of items) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1
    bySource[l.sourceName] = (bySource[l.sourceName] || 0) + 1
    const oname = lookup.asnById[l.associateId]?.name || 'Unassigned'
    byOwner[oname] = (byOwner[oname] || 0) + 1
    if (l.status === 'open') { open++; if (l.ai?.risk === 'hot') hot++ }
    if (l.status === 'won') won++
    if (l.status === 'lost') lost++
    estValue += l.valueEstimate || 0
    scores.push(l.ai?.score || 0)
  }
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  const maxStage = Math.max(1, ...Object.values(byStage))
  const stageCols = { 'New Lead': '#3b82f6', Contacted: '#6366f1', 'Trial Booked': '#06b6d4', 'Trial Completed': '#10b981', 'Follow Up': '#f59e0b', 'Proposal Sent': '#a855f7', Negotiation: '#ec4899', Won: '#34d399', Lost: '#94a3b8' }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
      <div className="card !rounded-2xl p-5 bg-white/[0.02] border-white/[0.06]">
        <h3 className="font-display font-semibold text-white text-[13px] mb-4 flex items-center gap-2"><BarChart3 size={14} className="text-violet-400" /> Pipeline value</h3>
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <Mini label="Open leads" value={open} color="#06b6d4" />
          <Mini label="Hot now" value={hot} color="#fb7185" />
          <Mini label="Won" value={won} color="#34d399" />
          <Mini label="Lost" value={lost} color="#94a3b8" />
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/5"><span className="text-[12px] text-slate-400">Est. pipeline</span><span className="font-display font-bold text-white mono">{money(estValue)}</span></div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-fuchsia-500/5 border border-fuchsia-500/10"><span className="text-[12px] text-slate-400">Avg score</span><span className="mono text-fuchsia-300 font-semibold">{avgScore}</span></div>
        </div>
      </div>
      <div className="card !rounded-2xl p-5 bg-white/[0.02] border-white/[0.06]">
        <h3 className="font-display font-semibold text-white text-[13px] mb-4 flex items-center gap-2"><Layers size={14} className="text-indigo-400" /> Stage distribution</h3>
        <div className="space-y-2.5">
          {Object.entries(byStage).map(([stage, count]) => (
            <div key={stage} className="group flex items-center gap-3 text-[12px] p-2 rounded-xl hover:bg-white/[0.03] transition-colors">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stageCols[stage] || '#94a3b8', boxShadow: `0 0 8px ${stageCols[stage] || '#94a3b8'}60` }} />
              <span className="w-[110px] text-slate-400 truncate group-hover:text-white transition-colors">{stage}</span>
              <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${(count / maxStage) * 100}%`, background: stageCols[stage] || '#94a3b8' }} /></div>
              <span className="mono text-white font-medium w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card !rounded-2xl p-5 bg-white/[0.02] border-white/[0.06]">
        <h3 className="font-display font-semibold text-white text-[13px] mb-4 flex items-center gap-2"><ExternalLink size={14} className="text-cyan-400" /> Source mix</h3>
        <div className="space-y-2.5">
          {Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([src, count], i) => (
            <div key={src} className="group flex items-center gap-3 text-[12px] p-2 rounded-xl hover:bg-white/[0.03] transition-colors">
              <span className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[10px] font-bold text-slate-400">{i + 1}</span>
              <span className="flex-1 text-slate-300 truncate group-hover:text-white transition-colors">{src}</span>
              <div className="w-16 h-2 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-violet-400/70" style={{ width: `${(count / Math.max(1, ...Object.values(bySource))) * 100}%` }} /></div>
              <span className="mono text-white font-medium w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Mini({ label, value, color }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 hover:bg-white/[0.05] hover:border-white/10 transition-colors group">
      <div className="font-display text-[20px] font-bold mono group-hover:scale-105 transition-transform" style={{ color }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-1 font-semibold">{label}</div>
    </div>
  )
}

function KanbanView({ items, boot, lookup, openLead, changeStage }) {
  const map = {}
  for (const s of boot?.stages || []) map[s] = []
  for (const l of items) (map[l.stage] = map[l.stage] || []).push(l)
  const cols = (boot?.stages || []).map(s => ({ stage: s, leads: map[s] || [] }))
  return (
    <div className="flex gap-4 overflow-x-auto scrollbar-thin p-5">
      {cols.map(col => (
        <div key={col.stage} className="flex flex-col w-[300px] shrink-0 rounded-2xl bg-white/[0.02] border border-white/[0.06] backdrop-blur-xl">
          <div className="px-4 py-3.5 flex items-center gap-2.5 border-b border-white/[0.04]">
            <span className="w-2 h-2 rounded-full" style={{ background: STAGE_COLORS[col.stage]?.dot || '#94a3b8', boxShadow: `0 0 8px ${STAGE_COLORS[col.stage]?.dot || '#94a3b8'}60` }} />
            <span className="font-display text-[13px] font-semibold text-white">{col.stage}</span>
            <span className="ml-auto px-2 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400 mono text-[11px] font-medium">{col.leads.length}</span>
          </div>
          <div className="flex-1 p-2.5 space-y-2.5 max-h-[600px] overflow-y-auto scrollbar-thin">
            {col.leads.map(l => {
              const owner = lookup.asnById[l.associateId]
              return (
                <div key={l.id} className="card !rounded-xl p-3.5 cursor-pointer hover:!border-violet-500/20 hover:shadow-[0_4px_20px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 transition-all bg-white/[0.03] border-white/10" onClick={() => openLead(l.id)}>
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <Avatar name={l.fullName} color={owner?.color} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-white truncate">{l.fullName}</div>
                      <div className="text-[11px] text-slate-500 truncate">{owner?.name || 'Unassigned'}</div>
                    </div>
                    <ScorePill score={l.ai.score} />
                  </div>
                  <div className="flex gap-1">
                    {['call', 'whatsapp', 'email', 'sms'].map(ch => {
                      const filled = !!l.fu?.outreach?.[ch]?.filled
                      const Icon = CHANNELS[ch].icon
                      return <span key={ch} className={`w-6 h-6 rounded-lg flex items-center justify-center border ${filled ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/[0.03] border-white/5 text-slate-600'}`}><Icon size={10} /></span>
                    })}
                  </div>
                </div>
              )
            })}
            {!col.leads.length && <div className="text-[12px] text-slate-600 text-center py-8 flex flex-col items-center gap-2"><Inbox size={20} className="opacity-50" /> No leads</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function TimelineView({ items, lookup, openLead }) {
  const groups = useMemo(() => {
    const map = new Map()
    for (const l of items) {
      const key = (l.createdAt || '').slice(0, 7) || 'unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(l)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [items])

  return (
    <div className="space-y-4 p-5">
      {groups.map(([month, list]) => (
        <div key={month} className="card !rounded-2xl p-5 bg-white/[0.02] border-white/[0.06]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <CalendarDays size={16} className="text-white" />
            </div>
            <div>
              <div className="font-display font-semibold text-white text-[14px]">{new Date(month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' })}</div>
              <div className="text-[11px] text-slate-500">{list.length} leads • {list.filter(l => l.status === 'won').length} won</div>
            </div>
            <div className="ml-auto flex gap-2">
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400 text-[11px]">{list.length} leads</span>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">{list.filter(l => l.status === 'won').length} won</span>
            </div>
          </div>
          <div className="space-y-1">
            {list.map(l => {
              const owner = lookup.asnById[l.associateId]
              return (
                <button key={l.id} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.04] text-left transition-colors group" onClick={() => openLead(l.id)}>
                  <Avatar name={l.fullName} color={owner?.color} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-white truncate group-hover:text-violet-200 transition-colors">{l.fullName}</div>
                    <div className="text-[11px] text-slate-500 truncate">{l.ai?.nextAction?.text}</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium border ${stageClass(l.stage)}`}>{l.stage}</span>
                  <span className="text-[11px] text-slate-500 mono hidden sm:block">{fmtDate(l.createdAt)}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
