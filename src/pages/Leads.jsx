import React, { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, SlidersHorizontal, ChevronDown, ChevronRight, X, Download,
  Table as TableIcon, LayoutGrid, Rows3, PieChart, KanbanSquare, CalendarDays,
  Phone, MessageCircle, Mail, MessageSquareText, Sparkles, Trash2, CheckSquare, Square,
  Users, TrendingUp, XCircle, Wallet, Clock, AlertTriangle, Flag,
  Trophy, PhoneOff, FlaskConical, CircleDot
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
  } catch (e) { /* ignore */ }
  return DEFAULT_COLUMNS.map(c => ({ ...c }))
}
function getColumnValue(col, l, lookup) {
  if (col.kind === 'formula') return evalFormula(col.formula, buildFormulaContext(l, lookup))
  if (col.kind === 'lookup') return lookupColumnValue(col.relatedTable, col.relatedField, l, lookup)
  return baseColumnValue(col.field, l, lookup)
}

const EMPTY_FILTERS = {
  locationId: '', stage: '', status: '', associateId: '', sourceName: '', channel: '',
  classType: '', risk: '', minScore: '', maxScore: '', dateFrom: '', dateTo: '', createdWithinDays: '', flagged: ''
}

const VIEWS = [
  { id: 'table', label: 'Table', icon: TableIcon },
  { id: 'cards', label: 'Cards', icon: LayoutGrid },
  { id: 'compact', label: 'Compact', icon: Rows3 },
  { id: 'summary', label: 'Summary', icon: PieChart },
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { id: 'timeline', label: 'Timeline', icon: CalendarDays }
]

const CHANNELS = {
  call: { icon: Phone, label: 'Call', color: '#38bdf8' },
  whatsapp: { icon: MessageCircle, label: 'WhatsApp', color: '#34d399' },
  email: { icon: Mail, label: 'Email', color: '#a78bfa' },
  sms: { icon: MessageSquareText, label: 'SMS', color: '#fbbf24' }
}

// Real stage names vary a lot ("Trial Completed - Unresponsive", "Called -
// Did Not Answer", ...) — far more than the ~10 hand-picked demo stages
// index.css has colors for — so this classifies by pattern into a handful
// of coarse categories with a consistent icon + color, rather than trying
// to hand-maintain a color per exact stage string.
const STAGE_CATEGORIES = [
  { test: /won|sold|member/i, icon: Trophy, color: '#34d399' },
  { test: /lost|unresponsive|no.?answer|invalid|not.?interested|didn.?t/i, icon: PhoneOff, color: '#fb7185' },
  { test: /trial/i, icon: FlaskConical, color: '#22d3ee' },
  { test: /new|enquiry/i, icon: Sparkles, color: '#818cf8' }
]
function stageVisual(stage) {
  const hit = STAGE_CATEGORIES.find(c => c.test.test(stage || ''))
  return hit || { icon: CircleDot, color: '#94a3b8' }
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

export default function Leads({ initialSearch = '' }) {
  const { boot, lookup, openLead, refreshData, toast, navigate, dataVersion } = useApp()
  const [search, setSearch] = useState(initialSearch)
  const [filters, setFilters] = useState(EMPTY_FILTERS)

  React.useEffect(() => { if (initialSearch) { setSearch(initialSearch); setPage(0) } }, [initialSearch])
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
  const [rowHeight, setRowHeight] = useState(() => Number(localStorage.getItem('p57_leads_row_height')) || 58)
  const [tableZoom, setTableZoom] = useState(() => Number(localStorage.getItem('p57_leads_table_zoom')) || 100)
  const [colWidths, setColWidths] = useState(() => {
    try { return JSON.parse(localStorage.getItem('p57_leads_col_widths') || '{}') } catch (e) { return {} }
  })
  const [aiAlertOpen, setAiAlertOpen] = useState(false)
  const [manualFlagOverrides, setManualFlagOverrides] = useState({})
  const tableJumpRef = useRef(null)
  const setColumns = (updater) => setColumnsRaw(prev => {
    const next = typeof updater === 'function' ? updater(prev) : updater
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)) } catch (e) { /* ignore */ }
    return next
  })
  const toggleDensity = () => setDensity(d => {
    const next = d === 'comfortable' ? 'compact' : 'comfortable'
    try { localStorage.setItem('p57_leads_density', next) } catch (e) { /* ignore */ }
    return next
  })
  const saveRowHeight = (next) => {
    setRowHeight(next)
    try { localStorage.setItem('p57_leads_row_height', String(next)) } catch (e) { /* ignore */ }
  }
  const saveTableZoom = (next) => {
    setTableZoom(next)
    try { localStorage.setItem('p57_leads_table_zoom', String(next)) } catch (e) { /* ignore */ }
  }
  const saveColWidths = (updater) => setColWidths(prev => {
    const next = typeof updater === 'function' ? updater(prev) : updater
    try { localStorage.setItem('p57_leads_col_widths', JSON.stringify(next)) } catch (e) { /* ignore */ }
    return next
  })
  const hasFilters = Object.values(filters).some(Boolean) || search
  const q = buildQuery({ ...filters, search: search.trim() || undefined, page, pageSize, sortBy, sortDir })

  const { data, loading, reload } = useFetch(() => api.get(`/api/leads?${q}`), [q, dataVersion])

  const setF = (k) => (e) => { setFilters(f => ({ ...f, [k]: e.target.value })); setPage(0) }
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setSearch(''); setPage(0) }

  const changeStage = async (lead, stage) => {
    try { await api.patch(`/api/leads/${lead.id}`, { stage }); refreshData() }
    catch (e) { toast(e.message, 'error') }
  }

  const toggleManualFlag = async (lead) => {
    const currentFlags = manualFlagOverrides[lead.id] || lead.manualFlags || []
    const flagged = currentFlags.some(f => f.id === 'focus')
    const manualFlags = flagged
      ? currentFlags.filter(f => f.id !== 'focus')
      : [...currentFlags, { id: 'focus', name: 'Manual priority flag', label: 'Flagged', color: '#e11d48' }]
    setManualFlagOverrides(prev => ({ ...prev, [lead.id]: manualFlags }))
    try {
      await api.patch(`/api/leads/${lead.id}`, { manualFlags })
      toast(flagged ? 'Flag removed' : 'Lead flagged')
      reload()
      refreshData()
    } catch (e) {
      setManualFlagOverrides(prev => ({ ...prev, [lead.id]: lead.manualFlags || [] }))
      toast(e.message, 'error')
    }
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
  const items = data?.items || []

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
    try { localStorage.setItem('p57_leads_pinned_cols', JSON.stringify(next)) } catch (e) { /* ignore */ }
  }
  const toggleHeaderPinned = () => setHeaderPinned(current => {
    const next = !current
    try { localStorage.setItem('p57_leads_header_pinned', String(next)) } catch (e) { /* ignore */ }
    return next
  })
  const jumpToTable = () => {
    const ids = [...new Set([...missedLeads, ...outreachLeads].map(l => l.id))]
    setFocusLeadIds(ids)
    setGroupBy('')
    setView('table')
    requestAnimationFrame(() => tableJumpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="p-6 space-y-4">
      {/* AI intelligence banner */}
      {(missedLeads.length > 0 || outreachLeads.length > 0) && (
        <div className={`ai-alert-compact ${aiAlertOpen ? 'is-open' : ''}`}>
          <button className="ai-alert-trigger" onClick={() => setAiAlertOpen(v => !v)} title="AI missed follow-up & outreach detection">
            <Sparkles size={15} />
            <span>{missedLeads.length + outreachLeads.length}</span>
          </button>
          {aiAlertOpen && (
            <div className="ai-alert-panel">
              <div className="font-display font-semibold text-white text-[13px]">AI missed follow-up & outreach detection</div>
              <div className="text-[12px] text-slate-400 mt-0.5">
                {missedLeads.length > 0 && <span className="text-amber-300 font-medium">{missedLeads.length} leads have missed follow-ups · </span>}
                {outreachLeads.length > 0 && <span className="text-rose-300 font-medium">{outreachLeads.length} leads need outreach (idle &gt; {cadenceDays}d)</span>}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={jumpToTable}>View in table</button>
                <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={() => setAiAlertOpen(false)}>Collapse</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* bulk selection toolbar */}
      {selected.size > 0 && (
        <div className="card p-3 flex flex-wrap items-center gap-3 border-rose-400/25" style={{ animation: 'fadeIn .15s ease' }}>
          <span className="chip bg-rose-500/15 border border-rose-400/30 text-rose-300 !px-2.5 !py-1 text-[12px] font-semibold">
            {selectAllMatching ? `All ${selected.size} matching leads selected` : `${selected.size} selected`}
          </span>
          {!selectAllMatching && selected.size === items.length && (data?.total || 0) > items.length && (
            <button className="btn btn-ghost !py-1.5 !text-[12.5px] text-rose-300" disabled={selectAllBusy} onClick={selectAllMatchingFilter}>
              {selectAllBusy ? 'Loading…' : `Select all ${data.total} matching leads`}
            </button>
          )}
          <select className="input !w-auto !py-1.5 !text-[12.5px]" disabled={bulkBusy} defaultValue="" onChange={e => { bulkChangeStage(e.target.value); e.target.value = '' }}>
            <option value="" disabled>Change stage…</option>
            {(boot?.stages || []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input !w-auto !py-1.5 !text-[12.5px]" disabled={bulkBusy} defaultValue="" onChange={e => { bulkAssign(e.target.value); e.target.value = '' }}>
            <option value="" disabled>Reassign owner…</option>
            {(boot?.associates || []).filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="btn btn-ghost !py-1.5 !text-[12.5px] text-rose-300 hover:!bg-rose-500/10" disabled={bulkBusy} onClick={bulkDelete}>
            <Trash2 size={13} /> Delete
          </button>
          <button className="btn btn-ghost !py-1.5 !text-[12.5px] ml-auto" onClick={clearSelection}>
            <X size={13} /> Clear selection
          </button>
        </div>
      )}

      {/* toolbar — nowrap + horizontal scroll instead of wrap: this row has
          enough controls (search, filters, grouping, sort, pin, density,
          columns, view switcher) that wrapping to a second row reads as
          broken layout rather than a deliberate two-row toolbar. */}
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-thin pb-1 [&>*]:shrink-0">
        <div className="relative w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input !pl-9" placeholder="Search name, phone, email…" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />
        </div>
        <button className={`btn ${panelOpen ? 'btn-soft' : 'btn-ghost'} !py-2`} onClick={() => setPanelOpen(o => !o)}>
          <SlidersHorizontal size={14} /> Filters {hasFilters && <span className="chip !px-1.5 !py-0.5 !text-[10px] bg-rose-500/20 text-rose-300">!</span>}
        </button>
        {hasFilters && <button className="btn btn-ghost !py-2" onClick={clearFilters}><X size={14} /> Clear</button>}
        <select className="input !w-auto !py-1.5" value={groupBy} onChange={e => { setGroupBy(e.target.value); setCollapsed({}) }}>
          {GROUP_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.id ? `Group by: ${g.label}` : 'No grouping'}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2 flex-nowrap [&>*]:shrink-0">
          <select className="input !w-auto !py-1.5" value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(0) }}>
            <option value="createdAt">Sort: Created</option>
            <option value="fullName">Sort: Name</option>
            <option value="stage">Sort: Stage</option>
            <option value="ai.score">Sort: Score</option>
          </select>
          <button className="btn btn-ghost !py-2" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
            <ChevronDown size={14} className={`transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`} />
          </button>
          <button className="btn btn-ghost !py-2" onClick={exportCsv}><Download size={14} /> Export</button>
          {view === 'table' && (
            <>
              <button className={`btn btn-ghost !py-2 ${pinnedCols.length ? 'btn-soft' : ''}`} onClick={() => savePinnedCols(pinnedCols.length ? [] : ['select', 'lead', 'stage'])} title="Pin the first 1–2 columns">
                <ColumnsToggleIcon pinned={pinnedCols.length > 0} /> {pinnedCols.length ? 'Pinned' : 'Pin cols'}
              </button>
              <button className={`btn btn-ghost !py-2 ${headerPinned ? 'btn-soft' : ''}`} onClick={toggleHeaderPinned} title="Pin or unpin the table header row">
                <TableIcon size={14} /> {headerPinned ? 'Header pinned' : 'Pin header'}
              </button>
              <button className="btn btn-ghost !py-2" onClick={toggleDensity} title="Row density">
                <Rows3 size={14} /> {density === 'compact' ? 'Compact' : 'Comfortable'}
              </button>
              <label className="table-control">
                <span>Row</span>
                <input type="range" min="42" max="86" value={rowHeight} onChange={e => saveRowHeight(Number(e.target.value))} />
              </label>
              <label className="table-control">
                <span>Zoom</span>
                <input type="range" min="88" max="116" value={tableZoom} onChange={e => saveTableZoom(Number(e.target.value))} />
              </label>
              <ColumnManager columns={columns} setColumns={setColumns} />
            </>
          )}
          <div className="flex rounded-xl overflow-hidden border border-white/10">
            {VIEWS.map(v => {
              const Icon = v.icon
              return (
                <button
                  key={v.id}
                  className={`px-2.5 py-2 ${view === v.id ? 'text-white bg-rose-500/25' : 'text-slate-400 hover:text-white bg-white/5'} border-l border-white/10 first:border-l-0 transition-colors`}
                  onClick={() => setView(v.id)}
                  title={v.label}
                >
                  <Icon size={14} />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* filter panel */}
      {panelOpen && (
        <div className="card p-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3" style={{ animation: 'fadeIn .15s ease' }}>
          <Filter label="Location" value={filters.locationId} onChange={setF('locationId')}>
            <option value="">All locations</option>
            {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Filter>
          <Filter label="Stage" value={filters.stage} onChange={setF('stage')}>
            <option value="">All stages</option>
            {(boot?.stages || []).map(s => <option key={s}>{s}</option>)}
          </Filter>
          <Filter label="Status" value={filters.status} onChange={setF('status')}>
            <option value="">All statuses</option>
            <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
          </Filter>
          <Filter label="Associate" value={filters.associateId} onChange={setF('associateId')}>
            <option value="">All associates</option>
            {(boot?.associates || []).filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Filter>
          <Filter label="Source" value={filters.sourceName} onChange={setF('sourceName')}>
            <option value="">All sources</option>
            {(boot?.sources || []).map(s => <option key={s}>{s}</option>)}
          </Filter>
          <Filter label="Channel" value={filters.channel} onChange={setF('channel')}>
            <option value="">All channels</option>
            {(boot?.channels || []).map(c => <option key={c}>{c}</option>)}
          </Filter>
          <Filter label="Class type" value={filters.classType} onChange={setF('classType')}>
            <option value="">All classes</option>
            {(boot?.classTypes || []).map(c => <option key={c}>{c}</option>)}
          </Filter>
          <Filter label="AI risk" value={filters.risk} onChange={setF('risk')}>
            <option value="">All</option>
            <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
          </Filter>
          <Filter label="Flags" value={filters.flagged} onChange={setF('flagged')}>
            <option value="">All leads</option>
            <option value="1">Flagged only</option>
          </Filter>
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Min score</label>
            <input className="input !py-1.5" type="number" min={0} max={100} placeholder="e.g. 70" value={filters.minScore} onChange={setF('minScore')} />
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Created in last</label>
            <select className="input !py-1.5" value={filters.createdWithinDays} onChange={setF('createdWithinDays')}>
              <option value="">Any time</option>
              <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
            </select>
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Created from</label>
            <input className="input !py-1.5" type="date" value={filters.dateFrom} onChange={setF('dateFrom')} />
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Created to</label>
            <input className="input !py-1.5" type="date" value={filters.dateTo} onChange={setF('dateTo')} />
          </div>
        </div>
      )}

      {view === 'summary' && <SummaryView items={items} boot={boot} lookup={lookup} />}
      {view === 'timeline' && <TimelineView items={items} lookup={lookup} openLead={openLead} />}
      {view === 'kanban' && <KanbanView items={items} boot={boot} lookup={lookup} openLead={openLead} changeStage={changeStage} />}

      {view !== 'summary' && view !== 'timeline' && view !== 'kanban' && (
        <div className="card overflow-hidden" ref={tableJumpRef}>
          {view === 'table' && (
            <TableView
              items={items} boot={boot} lookup={lookup} openLead={openLead}
              changeStage={changeStage} grouped={grouped} collapsed={collapsed} toggleGroup={toggleGroup}
              toggleManualFlag={toggleManualFlag}
                  onMessage={setComposeLead}
                  onTemplateMessage={setTemplateLead}
              selected={selected} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll}
              columns={columns} density={density} rowHeight={rowHeight} tableZoom={tableZoom} colWidths={colWidths} setColWidths={saveColWidths} manualFlagOverrides={manualFlagOverrides} pinnedCols={pinnedCols} headerPinned={headerPinned} focusLeadIds={focusLeadIds} clearFocus={() => setFocusLeadIds([])} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir}
            />
          )}
              {view === 'cards' && <CardsView items={items} lookup={lookup} openLead={openLead} grouped={grouped} collapsed={collapsed} toggleGroup={toggleGroup} boot={boot} onMessage={setComposeLead} onTemplateMessage={setTemplateLead} />}
              {view === 'compact' && <CompactView items={items} lookup={lookup} openLead={openLead} boot={boot} onMessage={setComposeLead} onTemplateMessage={setTemplateLead} />}
          {!loading && !items.length && <Empty icon={<Search size={20} />} title="No leads match your filters" subtitle="Try adjusting the filters, or import a CSV of leads." />}
        </div>
      )}

      {/* pagination */}
      <div className="flex items-center justify-between text-[12.5px] text-slate-400">
        <span>Showing {items.length} of {data?.total || 0} leads</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 mr-2">Rows
            <select className="input !w-auto !py-1.5 !px-2" value={pageSize} onChange={e => { const next = Number(e.target.value); setPageSize(next); setPage(0); localStorage.setItem('p57_leads_page_size', String(next)) }}>
              {[10, 25, 50, 100, 250].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button className="btn btn-ghost !py-1.5 !px-3" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</button>
          <span className="mono">{page + 1} / {pages}</span>
          <button className="btn btn-ghost !py-1.5 !px-3" disabled={page >= pages - 1} onClick={() => setPage(p => Math.min(pages - 1, p + 1))}>Next</button>
        </div>
      </div>

      <ComposeModal open={!!composeLead} onClose={() => setComposeLead(null)} lead={composeLead} />
      <RespondioTemplateModal open={!!templateLead} onClose={() => setTemplateLead(null)} lead={templateLead} />
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

function ColumnsToggleIcon({ pinned }) {
  return <span className={`inline-flex w-4 h-4 rounded border items-center justify-center text-[9px] ${pinned ? 'bg-rose-500/20 border-rose-400/30 text-rose-300' : 'bg-white/5 border-white/10 text-slate-400'}`}>▥</span>
}

function Metric({ icon: Icon, children, tone = 'neutral', title }) {
  const tones = {
    neutral: 'bg-white/5 border-white/10 text-slate-300',
    emerald: 'bg-emerald-500/10 border-emerald-400/25 text-emerald-300',
    amber: 'bg-amber-500/10 border-amber-400/25 text-amber-300',
    rose: 'bg-rose-500/10 border-rose-400/25 text-rose-300',
    fuchsia: 'bg-fuchsia-500/10 border-fuchsia-400/25 text-fuchsia-300',
    slate: 'bg-white/[0.03] border-white/8 text-slate-400'
  }
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium mono ${tones[tone]}`}>
      {Icon && <Icon size={11} className="shrink-0" />}
      {children}
    </span>
  )
}

function GroupSummary({ list }) {
  const total = list.length
  const won = list.filter(l => l.status === 'won').length
  const lost = list.filter(l => l.status === 'lost').length
  const conversion = total ? Math.round((won / total) * 100) : 0
  const openValue = list.reduce((s, l) => s + (l.status === 'open' ? (l.valueEstimate || 0) : 0), 0)
  const wonValue = list.reduce((s, l) => s + (l.status === 'won' ? (l.valueEstimate || 0) : 0), 0)
  const avgScore = total ? Math.round(list.reduce((s, l) => s + (l.ai?.score || 0), 0) / total) : 0
  const ages = list.map(l => l.createdAt ? -daysFromNow(l.createdAt) : null).filter(n => n !== null && n >= 0)
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null
  const missedFu = list.reduce((s, l) => s + (l.fu?.missedCount || 0), 0)
  const activity = list.map(l => l.fu?.lastOutreachDays).filter(n => n !== null && n !== undefined)
  const lastActivity = activity.length ? Math.min(...activity) : null

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Metric icon={Users} tone="neutral" title="Leads in this group">{total} lead{total === 1 ? '' : 's'}</Metric>
      <Metric icon={TrendingUp} tone="emerald" title="Won leads and conversion rate">{won} won · {conversion}%</Metric>
      {lost > 0 && <Metric icon={XCircle} tone="rose" title="Lost leads">{lost} lost</Metric>}
      <Metric icon={Wallet} tone="amber" title="Open pipeline value (open leads only)">{money(openValue)} open</Metric>
      {wonValue > 0 && <Metric icon={Wallet} tone="emerald" title="Closed-won value">{money(wonValue)} won</Metric>}
      <Metric icon={Sparkles} tone="fuchsia" title="Average AI score">{avgScore} avg score</Metric>
      {avgAge !== null && <Metric icon={Clock} tone="slate" title="Average lead age since creation">{avgAge}d avg age</Metric>}
      {missedFu > 0 && <Metric icon={AlertTriangle} tone="rose" title="Total missed follow-ups in this group">{missedFu} missed FU</Metric>}
      {lastActivity !== null && <Metric icon={Clock} tone="slate" title="Most recent outreach across the group">last activity {lastActivity}d ago</Metric>}
    </span>
  )
}

function TableView({ items, boot, lookup, openLead, changeStage, toggleManualFlag, grouped, collapsed, toggleGroup, onMessage, onTemplateMessage, selected, toggleSelect, toggleSelectAll, columns, density, rowHeight, tableZoom, colWidths, setColWidths, manualFlagOverrides, pinnedCols = [], headerPinned = true, focusLeadIds = [], clearFocus, sortBy, sortDir, setSortBy, setSortDir }) {
  const focusedItems = focusLeadIds.length ? items.filter(l => focusLeadIds.includes(l.id)) : items
  if (grouped) {
    return (
      <div className="divide-y divide-white/5">
        {grouped.map(g => {
          const isOpen = !collapsed[g.key]
          return (
            <div key={g.key}>
              <button className="w-full flex flex-wrap items-center gap-3 px-4 py-3 bg-white/[0.025] hover:bg-white/[0.045] border-b border-white/8 transition-colors text-left" onClick={() => toggleGroup(g.key)}>
                <ChevronRight size={14} className={`text-slate-500 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                <span className="font-display text-[13.5px] font-semibold text-white shrink-0">{g.key}</span>
                <GroupSummary list={g.list} />
              </button>
              {isOpen && <TableGrid items={focusLeadIds.length ? g.list.filter(l => focusLeadIds.includes(l.id)) : g.list} boot={boot} lookup={lookup} openLead={openLead} changeStage={changeStage} toggleManualFlag={toggleManualFlag} onMessage={onMessage} onTemplateMessage={onTemplateMessage} selected={selected} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} columns={columns} density={density} rowHeight={rowHeight} tableZoom={tableZoom} colWidths={colWidths} setColWidths={setColWidths} manualFlagOverrides={manualFlagOverrides} pinnedCols={pinnedCols} headerPinned={headerPinned} focusLeadIds={focusLeadIds} clearFocus={clearFocus} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} />}
            </div>
          )
        })}
      </div>
    )
  }
  return <TableGrid items={focusedItems} boot={boot} lookup={lookup} openLead={openLead} changeStage={changeStage} toggleManualFlag={toggleManualFlag} onMessage={onMessage} onTemplateMessage={onTemplateMessage} selected={selected} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} columns={columns} density={density} rowHeight={rowHeight} tableZoom={tableZoom} colWidths={colWidths} setColWidths={setColWidths} manualFlagOverrides={manualFlagOverrides} pinnedCols={pinnedCols} headerPinned={headerPinned} focusLeadIds={focusLeadIds} clearFocus={clearFocus} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} />
}

function TableGrid({ items, boot, lookup, openLead, changeStage, toggleManualFlag, onMessage, onTemplateMessage, selected, toggleSelect, toggleSelectAll, columns, density, rowHeight = 58, tableZoom = 100, colWidths = {}, setColWidths, manualFlagOverrides = {}, pinnedCols = [], headerPinned = true, focusLeadIds = [], clearFocus, sortBy, sortDir, setSortBy, setSortDir }) {
  const cadenceDays = boot?.settings?.cadence?.outreachDays || 7
  const allChecked = items.length > 0 && items.every(l => selected?.has(l.id))
  const visibleCols = (columns || []).filter(c => !c.hidden && c.field !== 'created')
  const py = density === 'compact' ? 'py-1.5' : ''
  const [scoreTip, setScoreTip] = useState(null)
  const widthOf = (id, fallback) => colWidths[id] || fallback
  const autoFitColumns = () => {
    const next = { select: 76, lead: 240, stage: 190, createdAt: 140, remarksField: 160, message: 112 }
    for (const c of visibleCols) next[c.id] = c.field === 'owner' ? 180 : c.field === 'score' ? 104 : 145
    for (const ch of Object.keys(CHANNELS)) next[`fu_${ch}`] = 54
    setColWidths?.(next)
  }
  const startResize = (id, fallback) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = widthOf(id, fallback)
    const onMove = (ev) => {
      const next = Math.max(48, Math.min(540, Math.round(startWidth + ev.clientX - startX)))
      setColWidths?.(prev => ({ ...prev, [id]: next }))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return (
    <div className="lead-table-scroll scrollbar-thin" style={{ '--lead-row-height': `${rowHeight}px`, '--lead-table-zoom': tableZoom / 100 }}>
      {focusLeadIds.length > 0 && (
        <div className="px-4 pt-4 pb-3 flex items-center gap-2">
          <span className="chip bg-rose-500/15 border border-rose-400/25 text-rose-300">{focusLeadIds.length} highlighted lead{focusLeadIds.length === 1 ? '' : 's'}</span>
          <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={clearFocus}>Show all leads</button>
        </div>
      )}
      <table className="data-table leads-data-table">
        <thead className={headerPinned ? 'is-pinned' : 'is-unpinned'}>
          <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-white/8">
            <th className={`resizable-th px-3 py-3 font-semibold ${pinnedCols.includes('select') ? 'sticky left-0 z-40 table-sticky-surface' : ''}`} style={{ width: widthOf('select', 76), minWidth: widthOf('select', 76) }}>
              <button className="flex items-center justify-center text-slate-400 hover:text-white" onClick={toggleSelectAll} title={allChecked ? 'Deselect all' : 'Select all'}>
                {allChecked ? <CheckSquare size={15} className="text-rose-400" /> : <Square size={15} />}
              </button>
              <span className="col-resize-handle" onDoubleClick={autoFitColumns} onMouseDown={startResize('select', widthOf('select', 76))} title="Drag to resize column. Double-click to auto-fit all columns." />
            </th>
            <SortHead label="Lead" field="fullName" width={widthOf('lead', 260)} onResize={startResize} onAutoFit={autoFitColumns} className={`px-4 py-3 font-semibold ${pinnedCols.includes('lead') ? 'sticky left-[76px] z-30 table-sticky-surface' : ''}`} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} />
            <SortHead label="Stage" field="stage" width={widthOf('stage', 190)} onResize={startResize} onAutoFit={autoFitColumns} className={`px-4 py-3 font-semibold ${pinnedCols.includes('stage') ? 'sticky left-[336px] z-30 table-sticky-surface' : ''}`} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} />
            <SortHead label="Created" field="createdAt" width={widthOf('createdAt', 150)} onResize={startResize} onAutoFit={autoFitColumns} className="px-4 py-3 font-semibold" sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} />
            {visibleCols.map(c => <SortHead key={c.id} label={c.label} field={c.field || c.id} resizeId={c.id} width={widthOf(c.id, c.field === 'owner' ? 190 : c.field === 'score' ? 112 : 150)} onResize={startResize} onAutoFit={autoFitColumns} className="px-4 py-3 font-semibold" sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} />)}
            <th className="resizable-th px-4 py-3 font-semibold" style={{ width: widthOf('remarksField', 160), minWidth: widthOf('remarksField', 160) }}>
              <span>Remarks</span>
              <span className="col-resize-handle" onDoubleClick={autoFitColumns} onMouseDown={startResize('remarksField', widthOf('remarksField', 160))} title="Drag to resize column. Double-click to auto-fit all columns." />
            </th>
            {Object.entries(CHANNELS).map(([ch, c], i) => (
              <th key={ch} className="resizable-th px-2 py-3 font-semibold text-center" style={{ width: widthOf(`fu_${ch}`, 56), minWidth: widthOf(`fu_${ch}`, 56) }} title={`${c.label} follow-up status`}>
                <span>FU{i + 1}</span>
                <span className="col-resize-handle" onDoubleClick={autoFitColumns} onMouseDown={startResize(`fu_${ch}`, widthOf(`fu_${ch}`, 56))} title="Drag to resize column. Double-click to auto-fit all columns." />
              </th>
            ))}
            <th className="resizable-th px-4 py-3 font-semibold" style={{ width: widthOf('message', 118), minWidth: widthOf('message', 118) }}>
              <span>Message</span>
              <span className="col-resize-handle" onDoubleClick={autoFitColumns} onMouseDown={startResize('message', widthOf('message', 118))} title="Drag to resize column. Double-click to auto-fit all columns." />
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map(l => {
            const owner = lookup.asnById[l.associateId]
            const nextFu = l.followUps?.find(f => f.date && f.done === false && f.date !== '-')
            const dueIn = nextFu ? daysFromNow(nextFu.date) : null
            const cadenceMissedOpen = l.status === 'open' && ((l.fu?.missedCount || 0) > 0 || (l.fu?.lastOutreachDays || 0) > cadenceDays || (nextFu && dueIn < 0))
            const rowManualFlags = manualFlagOverrides[l.id] || l.manualFlags || []
            const rowFlagged = rowManualFlags.some(f => f.id === 'focus')
            return (
              <tr key={l.id} className={`border-b border-white/5 hover:bg-white/[0.035] cursor-pointer transition-colors ${selected?.has(l.id) ? 'bg-rose-500/[0.05]' : ''} ${focusLeadIds.includes(l.id) ? 'ring-1 ring-rose-400/30 bg-rose-500/[0.08]' : ''}`} onClick={() => openLead(l.id)}>
                <td className={`px-3 ${py} ${pinnedCols.includes('select') ? 'sticky left-0 z-20 table-sticky-surface' : ''}`} onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <button className="flex items-center justify-center text-slate-400 hover:text-white" onClick={() => toggleSelect(l.id)}>
                      {selected?.has(l.id) ? <CheckSquare size={15} className="text-rose-400" /> : <Square size={15} />}
                    </button>
                    <button type="button" className={`lead-row-flag ${rowFlagged ? 'is-active' : ''}`} title={rowFlagged ? 'Remove row flag' : 'Flag this member'} onClick={(e) => { e.stopPropagation(); toggleManualFlag({ ...l, manualFlags: rowManualFlags }) }}>
                      <Flag size={14} />
                    </button>
                  </div>
                </td>
                <td className={`px-4 ${py} w-[260px] ${pinnedCols.includes('lead') ? 'sticky left-[76px] z-20 table-sticky-surface' : ''}`}>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-white truncate max-w-[220px] flex items-center gap-1.5">
                      {l.fullName}
                      {[...rowManualFlags, ...(l.flags || [])].map(f => (
                        <span key={f.id} title={f.name} className="chip !px-1.5 !py-0 text-[9px]" style={{ background: `${f.color}22`, color: f.color, border: `1px solid ${f.color}44` }}>{f.label}</span>
                      ))}
                    </div>
                    {density !== 'compact' && <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{l.email}</div>}
                  </div>
                </td>
                <td className={`px-4 ${py} min-w-[190px] ${pinnedCols.includes('stage') ? 'sticky left-[336px] z-20 table-sticky-surface' : ''}`}>
                  {(() => {
                    const { icon: StageIcon, color } = stageVisual(l.stage)
                    return (
                          <div className="relative w-full max-w-[170px] shrink-0">
                        <StageIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color }} />
                        <select
                          className="input stage-select !py-1 !pl-7 !text-[11.5px] !w-[170px] !rounded-full truncate"
                          style={{ background: `${color}14`, borderColor: `${color}40`, color }}
                          title={l.stage} value={l.stage} onClick={e => e.stopPropagation()} onChange={e => changeStage(l, e.target.value)}
                        >
                          {(boot?.stages || []).map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    )
                  })()}
                </td>
                <td className={`px-4 ${py} w-[190px] text-[12px] text-slate-400 mono`}>{fmtDate(l.createdAt)}</td>
                {visibleCols.map(c => {
                  if (c.field === 'source') {
                    return (
                      <td key={c.id} className={`px-4 ${py} text-[12.5px] text-slate-400 truncate`}>
                        {l.sourceName || '—'}
                      </td>
                    )
                  }
                  if (c.field === 'owner') {
                    return (
                      <td key={c.id} className={`px-4 ${py}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar name={owner?.name || '?'} color={owner?.color} photoUrl={owner?.photoUrl} size={28} />
                          <span className="text-[12px] text-slate-300 truncate max-w-[110px]">{owner?.name || 'Unassigned'}</span>
                        </div>
                      </td>
                    )
                  }
                  if (c.field === 'score') {
                    return (
                      <td key={c.id} className={`px-4 ${py} text-[12.5px] mono text-slate-300`} onClick={e => e.stopPropagation()}>
                        <button className="score-detail-trigger" onClick={(e) => setScoreTip({ lead: l, x: e.clientX, y: e.clientY })} title="View score calculation">
                          <ScorePill score={l.ai?.score || 0} />
                        </button>
                      </td>
                    )
                  }
                  const val = getColumnValue(c, l, lookup)
                  return (
                    <td key={c.id} className={`px-4 ${py} text-[12.5px] ${c.type === 'number' || c.type === 'currency' || c.type === 'percent' ? 'mono text-slate-300' : 'text-slate-400'}`}>
                      <span className="table-cell-fit" title={String(formatColumnValue(val, c) ?? '')}>{formatColumnValue(val, c)}</span>
                    </td>
                  )
                })}
                <td className={`px-4 ${py}`}>
                  <span className="table-remarks-wrap">
                    <span className="table-remarks" title={l.remarks || ''}>{l.remarks || '—'}</span>
                  </span>
                </td>
                {['call', 'whatsapp', 'email', 'sms'].map(ch => (
                  <td key={ch} className="px-1 text-center">
                    <FuCell lead={l} ch={ch} forceMissed={cadenceMissedOpen} />
                  </td>
                ))}
                <td className="px-4 text-left" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-ghost !p-1.5 !text-[11px] mr-1" onClick={() => onMessage(l)} title="Send a message via Respond.io">
                    <MessageCircle size={13} className="text-emerald-400" />
                  </button>
                  <button className="btn btn-ghost !p-1.5 !text-[11px]" onClick={() => onTemplateMessage(l)} title="Send an approved WhatsApp template via Respond.io">
                    <Sparkles size={13} className="text-fuchsia-400" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {scoreTip && <ScoreDetailsPopover tip={scoreTip} onClose={() => setScoreTip(null)} />}
    </div>
  )
}

function SortHead({ label, field, resizeId, width, onResize, onAutoFit, className = '', sortBy, sortDir, setSortBy, setSortDir }) {
  const active = sortBy === field
  const nextDir = active && sortDir === 'asc' ? 'desc' : 'asc'
  return (
    <th className={`resizable-th ${className} cursor-pointer select-none`} style={{ width, minWidth: width }} onClick={() => { setSortBy(field); setSortDir(nextDir) }}>
      <span className="inline-flex items-center gap-1.5">
        {label}
        <ChevronDown size={11} className={`transition-transform ${active && sortDir === 'asc' ? 'rotate-180' : ''} ${active ? 'text-rose-400' : 'text-slate-500'}`} />
      </span>
      <span className="col-resize-handle" onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onAutoFit?.() }} onMouseDown={onResize(resizeId || field, width)} title="Drag to resize column. Double-click a header edge to auto-fit all columns." />
    </th>
  )
}

function ScoreDetailsPopover({ tip, onClose }) {
  const { lead, x, y } = tip
  const factors = [
    { label: 'Intent score', value: lead.ai?.score ?? 0, detail: 'Weighted from stage, source, recency, risk, value, and follow-up state.' },
    { label: 'Risk band', value: lead.ai?.risk || '—', detail: 'Derived from score and lead status.' },
    { label: 'Sentiment', value: lead.ai?.sentiment || '—', detail: 'Heuristic/GPT sentiment when available.' },
    { label: 'Cadence', value: `${lead.fu?.missedCount || 0} missed`, detail: `${lead.fu?.lastOutreachDays ?? '—'} days since outreach.` }
  ]
  const left = Math.max(14, Math.min(window.innerWidth - 334, x - 150))
  const top = Math.max(14, Math.min(window.innerHeight - 260, y + 12))
  return createPortal(
    <div className="fixed inset-0 z-[120]" onClick={onClose}>
      <div className="score-detail-popover" style={{ left, top }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          <ScorePill score={lead.ai?.score || 0} />
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-white truncate">{lead.fullName}</div>
            <div className="text-[11px] text-slate-500">Score calculation details</div>
          </div>
          <button className="ml-auto btn btn-ghost !p-1.5" onClick={onClose}><X size={12} /></button>
        </div>
        <div className="space-y-1.5">
          {factors.map(f => (
            <div key={f.label} className="score-factor-row">
              <span>{f.label}</span>
              <strong>{f.value}</strong>
              <small>{f.detail}</small>
            </div>
          ))}
        </div>
        {lead.ai?.summary && <p className="mt-2 text-[11.5px] text-slate-400 leading-relaxed">{lead.ai.summary}</p>}
      </div>
    </div>,
    document.body
  )
}

function FuCell({ lead, ch, forceMissed = false }) {
  const o = lead.fu?.outreach?.[ch]
  const filled = !!o?.filled
  const missed = filled && o?.pending
  const today = new Date().toISOString().slice(0, 10)
  const isMissed = missed && missed < today
  // channelOutreach() (server/ai.js) only tracks entries that already have a
  // comment logged, so a follow-up scheduled on this channel but never
  // actioned (no comment yet) is invisible to `o` — check the lead's raw
  // follow-ups directly so an overdue-but-never-logged one still shows red
  // instead of silently looking identical to "never scheduled."
  const hasOverduePending = forceMissed || (!filled && (lead.followUps || []).some(f => f.channel === ch && f.done === false && f.date && f.date !== '-' && f.date < today))
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

  const boxClass = filled
    ? (isMissed ? 'border-rose-400/50 bg-rose-400/15' : 'border-emerald-400/50 bg-emerald-400/15')
    : hasOverduePending
      ? 'border-rose-400/50 bg-rose-400/15'
      : 'border-white/8 bg-white/[0.03]'
  const iconColor = filled ? (isMissed ? 'var(--fu-rose)' : 'var(--fu-emerald)') : hasOverduePending ? 'var(--fu-rose)' : 'var(--fu-slate)'
  const title = filled
    ? `Last ${CHANNELS[ch].label}: ${o.date} — click to log another`
    : hasOverduePending
      ? `${CHANNELS[ch].label} follow-up overdue — click to log`
      : `No ${CHANNELS[ch].label} logged — click to log`

  return (
    <>
      <Tip content={<FuTip lead={lead} ch={ch} o={o} suggestion={suggestion} isMissed={isMissed || hasOverduePending} />}>
        <span
          ref={anchorRef}
          onClick={openPopover}
          className={`fu-cell-box inline-flex w-7 h-7 rounded-lg items-center justify-center border transition-all cursor-pointer hover:brightness-125 hover:-translate-y-px hover:shadow-md ${boxClass}`}
          title={title}
        >
          {!filled && !hasOverduePending
            ? <XCircle size={12} style={{ color: iconColor }} />
            : <Icon size={12} style={{ color: iconColor }} />}
        </span>
      </Tip>
      {popOpen && pos && createPortal(
        <QuickFollowUpPopover lead={lead} ch={ch} pos={pos} onClose={() => setPopOpen(false)} />,
        document.body
      )}
    </>
  )
}

// Lightweight click-triggered popover for logging a single follow-up without
// opening the full LeadDrawer. Posts to the same endpoint/payload shape as
// LeadDrawer's addFollowUp (see src/components/LeadDrawer.jsx ~line 87).
function QuickFollowUpPopover({ lead, ch, pos, onClose }) {
  const { toast, refreshData } = useApp()
  const [channel, setChannel] = useState(ch)
  const [comments, setComments] = useState('')
  const [saving, setSaving] = useState(false)
  const boxRef = useRef(null)

  React.useEffect(() => {
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
    <div
      className="fixed pointer-events-none"
      style={{ left: 0, top: 0, zIndex: 2147483000, transform: `translate(${x}px, ${pos.y}px) translate(-50%, 0)` }}
    >
      <form
        ref={boxRef}
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="pointer-events-auto card !rounded-xl p-3 shadow-2xl space-y-2"
        style={{ width: 290, background: 'var(--tt-bg)', animation: 'fadeIn .12s ease' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] font-semibold text-white flex-1">Log follow-up</span>
          <button type="button" className="text-slate-500 hover:text-white" onClick={onClose}><X size={13} /></button>
        </div>
        <div className="flex gap-1.5">
          {Object.entries(CHANNELS).map(([key, meta]) => {
            const ChanIcon = meta.icon
            const active = channel === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setChannel(key)}
                title={meta.label}
                className={`flex-1 flex items-center justify-center h-7 rounded-lg border transition-colors ${active ? 'border-white/30' : 'border-white/8 hover:border-white/20'}`}
                style={active ? { background: `${meta.color}22`, color: meta.color, borderColor: `${meta.color}55` } : { color: '#64748b' }}
              >
                <ChanIcon size={13} />
              </button>
            )
          })}
        </div>
        <input
          autoFocus
          className="input !py-1.5 !text-[12px]"
          placeholder="Note / outcome…"
          value={comments}
          onChange={e => setComments(e.target.value)}
        />
        <button className="btn btn-primary !py-1.5 !text-[12px] w-full" type="submit" disabled={saving || !comments.trim()}>
          {saving ? 'Saving…' : 'Log follow-up'}
        </button>
      </form>
    </div>
  )
}

function FuTip({ lead, ch, o, suggestion, isMissed }) {
  const meta = CHANNELS[ch]
  return (
    <div className="space-y-1.5 min-w-[220px]">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}1e`, color: meta.color }}>
          <meta.icon size={12} />
        </span>
        <span className="text-[12px] font-bold text-white">{meta.label}</span>
        {isMissed && <span className="chip !px-1.5 !py-0.5 text-[9px] bg-rose-500/20 text-rose-300">missed</span>}
        {o?.filled && !isMissed && <span className="chip !px-1.5 !py-0.5 text-[9px] bg-emerald-500/15 text-emerald-300">done</span>}
        {o?.date && <span className="ml-auto text-[11px] text-slate-500 mono">{fmtDate(o.date)}</span>}
      </div>
      <div className="text-[11.5px] text-slate-400 leading-relaxed">{o?.comments || `No ${meta.label} follow-up logged yet.`}</div>
      {suggestion && (
        <div className="rounded-lg bg-fuchsia-500/10 border border-fuchsia-400/20 px-2.5 py-2">
          <div className="text-[9.5px] uppercase tracking-wider text-fuchsia-300 font-bold mb-0.5 flex items-center gap-1"><Sparkles size={10} /> AI suggested message</div>
          <div className="text-[11.5px] text-slate-300 leading-relaxed">“{suggestion}”</div>
        </div>
      )}
    </div>
  )
}

function CardsView({ items, lookup, openLead, grouped, collapsed, toggleGroup, boot, onMessage, onTemplateMessage }) {
  const inner = (list) => (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 p-4">
      {list.map(l => {
        const owner = lookup.asnById[l.associateId]
        const nextFu = l.followUps?.find(f => f.date && f.done === false && f.date !== '-')
        return (
          <button key={l.id} className="text-left card card-hover !rounded-xl p-3.5" onClick={() => openLead(l.id)}>
            <div className="flex items-center gap-2.5 mb-2">
              <Avatar name={l.fullName} color={owner?.color} size={34} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-white truncate flex items-center gap-1.5">
                  {l.fullName}
                  {(l.flags || []).map(f => <span key={f.id} title={f.name} className="chip !px-1.5 !py-0 text-[9px]" style={{ background: `${f.color}22`, color: f.color, border: `1px solid ${f.color}44` }}>{f.label}</span>)}
                </div>
                <div className="text-[11px] text-slate-500 truncate">{lookup.locById[l.locationId]?.name?.split(',')[0] || '—'}</div>
              </div>
              <ScorePill score={l.ai.score} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
              <span className={`chip !py-0.5 !px-2 text-[10px] ${riskClass(l.ai.risk)}`}>{l.ai.risk}</span>
              <span className="chip bg-white/5 border border-white/10 text-slate-400 !py-0.5 !px-2 text-[10px]">{l.stage}</span>
              <span className="chip bg-white/5 border border-white/10 text-slate-400 !py-0.5 !px-2 text-[10px]">{l.sourceName}</span>
            </div>
            <div className="text-[11.5px] text-slate-400 truncate mb-2.5">{l.ai?.nextAction?.text}</div>
            <div className="flex items-center gap-2 border-t border-white/6 pt-2">
              <span className="text-[11px] text-slate-500 truncate flex-1">{owner ? owner.name : 'Unassigned'}</span>
              {['call', 'whatsapp', 'email', 'sms'].map(ch => {
                const filled = !!l.fu?.outreach?.[ch]?.filled
                const Icon = CHANNELS[ch].icon
                return (
                  <span key={ch} className={`inline-flex w-5 h-5 rounded-md items-center justify-center border ${filled ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-400' : 'border-white/8 bg-white/[0.03] text-slate-600'}`} title={`${CHANNELS[ch].label}: ${filled ? 'done' : 'not logged'}`}>
                    <Icon size={10} />
                  </span>
                )
              })}
              {nextFu && <span className="text-[11px] mono text-slate-500">{fmtDate(nextFu.date)}</span>}
              <span role="button" tabIndex={0} className="inline-flex w-6 h-6 rounded-md items-center justify-center border border-emerald-400/40 bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20" title="Message via Respond.io" onClick={e => { e.stopPropagation(); onMessage(l) }}>
                <MessageCircle size={11} />
              </span>
              <span role="button" tabIndex={0} className="inline-flex w-6 h-6 rounded-md items-center justify-center border border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300 hover:bg-fuchsia-400/20" title="Send approved WhatsApp template" onClick={e => { e.stopPropagation(); onTemplateMessage(l) }}>
                <Sparkles size={11} />
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )

  if (grouped) {
    return (
      <div className="divide-y divide-white/5">
        {grouped.map(g => {
          const isOpen = !collapsed[g.key]
          return (
            <div key={g.key}>
              <button className="w-full flex flex-wrap items-center gap-3 px-4 py-3 bg-white/[0.025] hover:bg-white/[0.045] border-b border-white/8 text-left transition-colors" onClick={() => toggleGroup(g.key)}>
                <ChevronRight size={14} className={`text-slate-500 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                <span className="font-display text-[13.5px] font-semibold text-white shrink-0">{g.key}</span>
                <GroupSummary list={g.list} />
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
    <div className="divide-y divide-white/5">
      {items.map(l => {
        const owner = lookup.asnById[l.associateId]
        const nextFu = l.followUps?.find(f => f.date && f.done === false && f.date !== '-')
        return (
          <button key={l.id} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] text-left transition-colors" onClick={() => openLead(l.id)}>
            <Avatar name={l.fullName} color={owner?.color} size={28} />
            <div className="min-w-0 w-[200px]">
              <div className="text-[12.5px] font-semibold text-white truncate">{l.fullName}</div>
              <div className="text-[10.5px] text-slate-500 truncate">{l.phone}</div>
            </div>
            <span className={`chip !py-0.5 !px-2 text-[10px] hidden sm:inline-flex ${riskClass(l.ai.risk)}`}>{l.ai.risk}</span>
            <span className="text-[12px] text-slate-400 w-[130px] truncate hidden md:block">{l.stage}</span>
            <span className="text-[12px] text-slate-400 w-[120px] truncate hidden lg:block">{owner?.name || 'Unassigned'}</span>
            <div className="flex items-center gap-1.5 ml-auto">
              {['call', 'whatsapp', 'email', 'sms'].map(ch => {
                const filled = !!l.fu?.outreach?.[ch]?.filled
                const Icon = CHANNELS[ch].icon
                return (
                  <span key={ch} className={`inline-flex w-5 h-5 rounded-md items-center justify-center border ${filled ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-400' : 'border-white/8 bg-white/[0.03] text-slate-600'}`}>
                    <Icon size={10} />
                  </span>
                )
              })}
              {nextFu && <span className={`text-[11px] mono ml-1 ${daysFromNow(nextFu.date) < 0 ? 'text-rose-400' : 'text-slate-500'}`}>{fmtDate(nextFu.date)}</span>}
              <ScorePill score={l.ai.score} />
              <span role="button" tabIndex={0} className="inline-flex w-6 h-6 rounded-md items-center justify-center border border-emerald-400/40 bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20" title="Message via Respond.io" onClick={e => { e.stopPropagation(); onMessage(l) }}>
                <MessageCircle size={11} />
              </span>
              <span role="button" tabIndex={0} className="inline-flex w-6 h-6 rounded-md items-center justify-center border border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300 hover:bg-fuchsia-400/20" title="Send approved WhatsApp template" onClick={e => { e.stopPropagation(); onTemplateMessage(l) }}>
                <Sparkles size={11} />
              </span>
            </div>
          </button>
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
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div className="card p-4">
        <h3 className="font-display font-semibold text-white text-[13px] mb-3">Pipeline value</h3>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <Mini label="Open leads" value={open} color="#06b6d4" />
          <Mini label="Hot right now" value={hot} color="#fb7185" />
          <Mini label="Won" value={won} color="#34d399" />
          <Mini label="Lost" value={lost} color="#94a3b8" />
        </div>
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-slate-400">Est. pipeline</span>
          <span className="font-display font-bold text-white mono">{money(estValue)}</span>
        </div>
        <div className="flex items-center justify-between text-[12px] mt-1.5">
          <span className="text-slate-400">Avg intent score</span>
          <span className="mono text-fuchsia-300 font-semibold">{avgScore}</span>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-display font-semibold text-white text-[13px] mb-3">Stage distribution</h3>
        <div className="space-y-2">
          {Object.entries(byStage).map(([stage, count]) => (
            <div key={stage} className="flex items-center gap-2 text-[12px]">
              <span className="w-[120px] text-slate-400 truncate">{stage}</span>
              <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(count / maxStage) * 100}%`, background: stageCols[stage] || '#94a3b8' }} />
              </div>
              <span className="mono text-slate-300 w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-display font-semibold text-white text-[13px] mb-3">Source mix</h3>
        <div className="space-y-2">
          {Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
            <div key={src} className="flex items-center gap-2 text-[12px]">
              <span className="w-[140px] text-slate-400 truncate">{src}</span>
              <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full bg-violet-400/70" style={{ width: `${(count / Math.max(1, ...Object.values(bySource))) * 100}%` }} />
              </div>
              <span className="mono text-slate-300 w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4 md:col-span-2 xl:col-span-1">
        <h3 className="font-display font-semibold text-white text-[13px] mb-3">Owner load</h3>
        <div className="space-y-2">
          {Object.entries(byOwner).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
            <div key={name} className="flex items-center gap-2 text-[12px]">
              <span className="w-[140px] text-slate-400 truncate">{name}</span>
              <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${(count / Math.max(1, ...Object.values(byOwner))) * 100}%` }} />
              </div>
              <span className="mono text-slate-300 w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Mini({ label, value, color }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/6 px-3 py-2">
      <div className="font-display text-[19px] font-bold mono" style={{ color }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

function KanbanView({ items, boot, lookup, openLead, changeStage }) {
  const map = {}
  for (const s of boot?.stages || []) map[s] = []
  for (const l of items) (map[l.stage] = map[l.stage] || []).push(l)
  const cols = (boot?.stages || []).map(s => ({ stage: s, leads: map[s] || [] }))
  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-thin pb-2 -mx-1 px-1">
      {cols.map(col => (
        <div key={col.stage} className="flex flex-col w-[240px] shrink-0 rounded-2xl bg-white/[0.03] border border-white/6">
          <div className="px-3 py-2.5 flex items-center gap-2">
            <span className="font-display text-[12.5px] font-semibold text-slate-200">{col.stage}</span>
            <span className="ml-auto chip bg-white/6 border border-white/10 text-slate-400 mono !py-0.5 !px-2 text-[11px]">{col.leads.length}</span>
          </div>
          <div className="flex-1 px-2 pb-2 space-y-2 max-h-[560px] overflow-y-auto scrollbar-thin">
            {col.leads.map(l => {
              const owner = lookup.asnById[l.associateId]
              return (
                <div key={l.id} className="card card-hover !rounded-xl p-3 cursor-pointer" onClick={() => openLead(l.id)}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Avatar name={l.fullName} color={owner?.color} size={26} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold text-white truncate flex items-center gap-1">
                        {l.fullName}
                        {(l.flags || []).map(f => <span key={f.id} title={f.name} className="chip !px-1 !py-0 text-[8.5px]" style={{ background: `${f.color}22`, color: f.color, border: `1px solid ${f.color}44` }}>{f.label}</span>)}
                      </div>
                      <div className="text-[10.5px] text-slate-500 truncate">{owner?.name || 'Unassigned'}</div>
                    </div>
                    <ScorePill score={l.ai.score} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {['call', 'whatsapp', 'email', 'sms'].map(ch => {
                      const filled = !!l.fu?.outreach?.[ch]?.filled
                      const Icon = CHANNELS[ch].icon
                      return (
                        <span key={ch} className={`inline-flex w-4.5 h-4.5 rounded items-center justify-center border ${filled ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-400' : 'border-white/8 bg-white/[0.03] text-slate-600'}`}>
                          <Icon size={9} />
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {!col.leads.length && <div className="text-[11px] text-slate-600 text-center py-5">No leads</div>}
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
    <div className="space-y-4">
      {groups.map(([month, list]) => (
        <div key={month} className="card p-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="font-display font-semibold text-white text-[13px]">{new Date(month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
            <span className="chip bg-white/5 border border-white/10 text-slate-400 !px-2 !py-0.5">{list.length} leads</span>
            <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20 !px-2 !py-0.5">{list.filter(l => l.status === 'won').length} won</span>
          </div>
          <div className="space-y-1">
            {list.map(l => {
              const owner = lookup.asnById[l.associateId]
              return (
                <button key={l.id} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.04] text-left transition-colors" onClick={() => openLead(l.id)}>
                  <Avatar name={l.fullName} color={owner?.color} size={26} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-white truncate">{l.fullName}</div>
                    <div className="text-[11px] text-slate-500 truncate">{l.ai?.nextAction?.text}</div>
                  </div>
                  <span className={`chip !py-0.5 !px-2 text-[10px] ${stageClass(l.stage)}`}>{l.stage}</span>
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

function Filter({ label, value, onChange, children }) {
  return (
    <div>
      <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">{label}</label>
      <select className="input !py-1.5" value={value} onChange={onChange}>{children}</select>
    </div>
  )
}
