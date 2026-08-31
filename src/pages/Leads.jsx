import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, SlidersHorizontal, ChevronDown, ChevronRight, X, Download,
  Table as TableIcon, LayoutGrid, Rows3, PieChart, KanbanSquare, CalendarDays,
  Phone, MessageCircle, Mail, MessageSquareText, Sparkles, Trash2, CheckSquare, Square,
  Users, TrendingUp, XCircle, Wallet, Clock, AlertTriangle, Flag,
  Trophy, PhoneOff, FlaskConical, CircleDot, PanelTop, Check, Pencil,
  MoreVertical, Tags, UserPlus, CalendarPlus, CreditCard, Eye, Lock, Keyboard,
  Pin, PinOff, Calendar, Copy, ExternalLink, RefreshCw, IndianRupee, Plus, Minus, Trash
, Bookmark
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api, buildQuery } from '../api.js'
import { Avatar, ScorePill, Empty, Spinner, TableSkeleton } from '../ui.jsx'
import { fmtDate, fmtDateCompact, stageClass, stageBadgeStyle, stageColor, riskClass, daysFromNow, downloadText, money, baseColumnValue, buildFormulaContext, evalFormula, lookupColumnValue, formatColumnValue, phoneCountryFlag, currentMonthRange } from '../lib.js'
import Tip from '../components/Tip.jsx'
import ComposeModal from '../components/ComposeModal.jsx'
import RespondioTemplateModal from '../components/RespondioTemplateModal.jsx'
import ColumnManager, { DEFAULT_COLUMNS } from '../components/ColumnManager.jsx'
import { Modal, ModalHeader } from '../ui.jsx'
import LeadsIntegrationRail from '../components/LeadsIntegrationRail.jsx'

const COLUMNS_KEY = 'p57_leads_columns_v1'
const followUpText = value => {
  const text = String(value ?? '').trim()
  return text === '-' || text === '\u2014' ? '' : text
}
const cleanDate = value => {
  const text = String(value ?? '').trim()
  return !text || text === '-' || text === '\u2014' ? '' : text
}
const properName = value => String(value || '').trim().toLocaleLowerCase('en-IN').replace(/(^|[\s.'\-’])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('en-IN')}`)
function withLifecycleColumns(configured) {
  const missing = DEFAULT_COLUMNS.filter(column => ['trialDate', 'firstPurchaseDate'].includes(column.field) && !configured.some(existing => existing.field === column.field))
  return missing.length ? [...configured, ...missing.map(c => ({ ...c }))] : configured
}
function loadColumns() {
  try {
    const raw = localStorage.getItem(COLUMNS_KEY)
    if (raw) return withLifecycleColumns(JSON.parse(raw))
  } catch (e) { /* ignore */ }
  return DEFAULT_COLUMNS.map(c => ({ ...c }))
}
function getColumnValue(col, l, lookup) {
  if (col.kind === 'formula') return evalFormula(col.formula, buildFormulaContext(l, lookup))
  if (col.kind === 'lookup') return lookupColumnValue(col.relatedTable, col.relatedField, l, lookup)
  if (col.kind === 'conditional' || col.kind === 'dependent') {
    const actual = baseColumnValue(col.dependsOn, l, lookup)
    const expected = col.expectedValue ?? ''
    const matches = col.operator === 'not_equals' ? String(actual) !== String(expected)
      : col.operator === 'contains' ? String(actual || '').toLowerCase().includes(String(expected).toLowerCase())
        : col.operator === 'greater_than' ? Number(actual) > Number(expected)
          : col.operator === 'less_than' ? Number(actual) < Number(expected)
            : col.operator === 'is_empty' ? actual === null || actual === undefined || actual === ''
              : col.operator === 'is_not_empty' ? actual !== null && actual !== undefined && actual !== ''
                : String(actual) === String(expected)
    if (col.kind === 'dependent') return matches ? (baseColumnValue(col.trueValue, l, lookup) || col.trueValue || '') : ''
    return matches ? col.trueValue : col.falseValue
  }
  return baseColumnValue(col.field, l, lookup)
}

const EMPTY_FILTERS = {
  locationId: '', stage: '', status: '', statusGroup: '', associateId: '', sourceName: '', channel: '',
  classType: '', risk: '', minScore: '', maxScore: '', dateFrom: '', dateTo: '', createdWithinDays: '', flagged: ''
}
// One-click answers to the questions an associate actually opens this page
// with. Each preset is a full filter set, not an additive toggle, so the
// state after clicking is always exactly what the chip says.
const QUICK_VIEWS = [
  { id: 'hot', label: 'Hot leads', hint: 'Score 80 and above, still open', patch: { status: 'open', minScore: '80' } },
  { id: 'unassigned', label: 'Unassigned', hint: 'Open leads with no owner', patch: { status: 'open', associateId: 'none' } },
  { id: 'flagged', label: 'Flagged', hint: 'Manually flagged for attention', patch: { flagged: '1' } },
  { id: 'new', label: 'New this week', hint: 'Created in the last 7 days', patch: { createdWithinDays: '7' } },
  { id: 'won', label: 'Won', hint: 'Converted leads', patch: { status: 'won' } }
]

// Default view: current calendar month. "Clear filters" (EMPTY_FILTERS) or
// manually editing the date fields is how a user widens back out to all time.
const DEFAULT_FILTERS = { ...EMPTY_FILTERS, ...currentMonthRange() }

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
  sms: { icon: MessageSquareText, label: 'SMS', color: '#fbbf24' },
  in_person: { icon: Users, label: 'In person', color: '#fb7185' }
}
const channelMeta = (channel) => CHANNELS[channel] || { icon: MessageCircle, label: String(channel || 'Other').replace(/_/g, ' '), color: '#94a3b8' }

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
  return { icon: hit?.icon || CircleDot, color: stageColor(stage).solid }
}

// A sentinel (rather than a literal "—") for an empty cell, so it can be
// rendered as a subtle muted marker instead of a heavy dash glyph.
const EMPTY_CELL = Symbol('empty-cell')
const EmptyCell = () => <span className="cell-empty" aria-label="No data" />

const GROUP_OPTIONS = [
  { id: '', label: 'No grouping' },
  { id: 'locationId', label: 'Location' },
  { id: 'stage', label: 'Stage' },
  { id: 'status', label: 'Outcome' },
  { id: 'statusGroup', label: 'Status' },
  { id: 'sourceName', label: 'Source' },
  { id: 'associateId', label: 'Owner' },
  { id: 'classType', label: 'Class type' },
  { id: 'risk', label: 'AI risk' }
]

const FILTER_LABELS = {
  locationId: 'Location',
  stage: 'Stage',
  status: 'Outcome',
  statusGroup: 'Status',
  associateId: 'Owner',
  sourceName: 'Source',
  channel: 'Channel',
  classType: 'Class',
  risk: 'Risk',
  minScore: 'Min score',
  maxScore: 'Max score',
  createdWithinDays: 'Created',
  flagged: 'Flagged'
}

export default function Leads({ initialSearch = '', initialAssociateId = '' }) {
  const { boot, lookup, openLead, refreshData, toast, navigate, dataVersion, role, locationIds, associateId: myAssociateId } = useApp()
  const [search, setSearch] = useState(initialSearch)
  const [onlyMine, setOnlyMine] = useState(() => localStorage.getItem('p57_leads_only_mine') !== '0')
  const [filters, setFilters] = useState(() => role === 'agent' && locationIds[0]
    ? { ...DEFAULT_FILTERS, locationId: locationIds[0] }
    : DEFAULT_FILTERS)

  // boot/locationIds arrive after first render, so re-apply the agent lock
  // once they do (the lazy initializer above sees an empty list).
  React.useEffect(() => {
    if (role !== 'agent' || !locationIds[0]) return
    setFilters(f => (f.locationId === locationIds[0] ? f : { ...f, locationId: locationIds[0] }))
  }, [role, locationIds[0]])

  // Default view is "my leads only" — applies to every role, not just agents.
  // Toggling it off keeps whatever location/other filters were set and just
  // stops constraining by owner.
  React.useEffect(() => {
    if (!myAssociateId) return
    setFilters(f => {
      if (onlyMine) return f.associateId === myAssociateId ? f : { ...f, associateId: myAssociateId }
      return f.associateId === myAssociateId ? { ...f, associateId: '' } : f
    })
  }, [onlyMine, myAssociateId])

  const toggleOnlyMine = () => {
    setOnlyMine(v => {
      const next = !v
      try { localStorage.setItem('p57_leads_only_mine', next ? '1' : '0') } catch (e) { /* ignore */ }
      return next
    })
    setPage(0)
  }

  React.useEffect(() => { if (initialSearch) { setSearch(initialSearch); setPage(0) } }, [initialSearch])
  React.useEffect(() => { if (initialAssociateId) { setFilters(f => ({ ...f, associateId: initialAssociateId })); setPage(0) } }, [initialAssociateId])
  const [panelOpen, setPanelOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')
  const [view, setView] = useState('table')
  const [groupBy, setGroupBy] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const [composeLead, setComposeLead] = useState(null)
  const [templateLead, setTemplateLead] = useState(null)
  const [chatLead, setChatLead] = useState(null)
  const [quickActionLead, setQuickActionLead] = useState(null)
  const [quickActionMode, setQuickActionMode] = useState('book')
  const [quickActionClass, setQuickActionClass] = useState('')
  const [quickActionAmount, setQuickActionAmount] = useState('')
  const [quickActionName, setQuickActionName] = useState('')
  const [quickActionUrl, setQuickActionUrl] = useState('')
  const [quickActionStatus, setQuickActionStatus] = useState('')
  const [quickActionSessionId, setQuickActionSessionId] = useState('')
  const [quickActionMembershipId, setQuickActionMembershipId] = useState('')
  const [quickActionPaymentMethodId, setQuickActionPaymentMethodId] = useState('')
  const [quickActionPurchaseMembershipId, setQuickActionPurchaseMembershipId] = useState('')
  const [quickActionStripeItems, setQuickActionStripeItems] = useState([])
  const [quickActionStripeOptions, setQuickActionStripeOptions] = useState({
    promotionMode: 'none', promotionCodeId: '', addressCollection: 'none', shippingCountries: ['IN'],
    collectPhone: false, collectTaxId: false, automaticTax: false, adjustableQuantity: false,
    createCustomer: true, invoiceCreation: false, requireTerms: false, submitType: 'auto',
    customFields: [], afterCompletion: 'hosted', redirectUrl: '', thankYouMessage: 'Thank you. Your payment was successful.',
    limitPayments: true, completedSessionsLimit: 1, inactiveMessage: 'This payment link is no longer available.',
    customTextSubmit: '', customTextAfterSubmit: ''
  })
  const [focusLeadIds, setFocusLeadIds] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  // Server-truth rows are overlaid with in-flight edits so the table
  // never flashes back to the old value while the PATCH is in the air.
  const [pendingPatches, setPendingPatches] = useState({})
  const [activeQuickView, setActiveQuickView] = useState('')
  const [selectAllMatching, setSelectAllMatching] = useState(false)
  const [selectAllBusy, setSelectAllBusy] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [columns, setColumnsRaw] = useState(loadColumns)
  React.useEffect(() => {
    const configured = boot?.settings?.leadColumns
    if (!Array.isArray(configured) || !configured.length) return
    const next = withLifecycleColumns(configured.map(column => ({ ...column })))
    setColumnsRaw(next)
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)) } catch (e) { /* ignore */ }
  }, [boot?.settings?.leadColumns])
  const [headerPinned, setHeaderPinned] = useState(() => localStorage.getItem('p57_leads_header_pinned') !== 'false')
  const [fixedCols, setFixedCols] = useState(() => localStorage.getItem('p57_leads_fixed_cols') === 'true')
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('p57_leads_page_size')) || 25)
  const [density, setDensity] = useState(() => localStorage.getItem('p57_leads_density') || 'comfortable')
  const [rowHeight, setRowHeight] = useState(() => Math.max(32, Math.min(88, Number(localStorage.getItem('p57_leads_row_height')) || 40)))
  const [tableZoom, setTableZoom] = useState(() => Number(localStorage.getItem('p57_leads_table_zoom')) || 100)
  const [tableStyle, setTableStyle] = useState(() => ({
    zebra: true,
    gridLines: true,
    fontScale: 100
  }))
  const [segments, setSegments] = useState([])
  const [selectedSegmentId, setSelectedSegmentId] = useState('')
  const [colWidths, setColWidths] = useState(() => {
    try { return JSON.parse(localStorage.getItem('p57_leads_col_widths') || '{}') } catch (e) { return {} }
  })
  const [aiAlertOpen, setAiAlertOpen] = useState(false)
  const [aiAlertPosition, setAiAlertPosition] = useState(null)
  const [manualFlagOverrides, setManualFlagOverrides] = useState({})
  const tableJumpRef = useRef(null)
  const aiAlertRef = useRef(null)
  const remotePrefsHydrated = useRef(false)
  useEffect(() => {
    if (!boot || remotePrefsHydrated.current) return
    api.get('/api/user-preferences').then(data => {
      const prefs = data?.leadTablePrefs || {}
      remotePrefsHydrated.current = true
      setSegments(Array.isArray(data?.leadSegments) ? data.leadSegments : [])
      // Row heights stored under the old airy cell design (56, 68, ...) leave
      // the redrawn 40px cells floating in empty space, so anything above the
      // new comfortable ceiling is migrated down once. Heights the user picked
      // at or below it are their choice and are restored untouched.
      if (prefs.rowHeight != null) saveRowHeight(prefs.rowHeight > 48 ? 40 : prefs.rowHeight)
      if (prefs.tableZoom != null) saveTableZoom(prefs.tableZoom)
      if (prefs.density) setDensity(prefs.density)
      if (typeof prefs.headerPinned === 'boolean') setHeaderPinned(prefs.headerPinned)
      if (typeof prefs.fixedCols === 'boolean') setFixedCols(prefs.fixedCols)
      if (prefs.colWidths && typeof prefs.colWidths === 'object') setColWidths(prefs.colWidths)
      setTableStyle(current => ({ ...current, zebra: prefs.zebra !== false, gridLines: prefs.gridLines !== false, fontScale: Number(prefs.fontScale) || 100 }))
    }).catch(() => { remotePrefsHydrated.current = true })
  }, [boot])
  useEffect(() => {
    if (!aiAlertOpen) return
    const closeOnKey = event => { if (event.key === 'Escape') setAiAlertOpen(false) }
    const closeOutside = event => { if (!event.target.closest?.('.ai-alert-compact, .ai-alert-panel')) setAiAlertOpen(false) }
    const positionPanel = () => {
      const rect = aiAlertRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(420, window.innerWidth - 24)
      setAiAlertPosition({
        top: Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 260)),
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        width
      })
    }
    positionPanel()
    document.addEventListener('keydown', closeOnKey)
    document.addEventListener('mousedown', closeOutside, true)
    window.addEventListener('resize', positionPanel)
    window.addEventListener('scroll', positionPanel, true)
    return () => {
      document.removeEventListener('keydown', closeOnKey)
      document.removeEventListener('mousedown', closeOutside, true)
      window.removeEventListener('resize', positionPanel)
      window.removeEventListener('scroll', positionPanel, true)
    }
  }, [aiAlertOpen])
  const setColumns = (updater) => setColumnsRaw(prev => {
    const next = typeof updater === 'function' ? updater(prev) : updater
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)) } catch (e) { /* ignore */ }
    return next
  })
  const toggleDensity = () => setDensity(d => {
    const next = d === 'comfortable' ? 'compact' : 'comfortable'
    try { localStorage.setItem('p57_leads_density', next) } catch (e) { /* ignore */ }
    const nextHeight = next === 'compact' ? 40 : 68
    saveRowHeight(nextHeight)
    return next
  })
  const saveRowHeight = (next) => {
    const capped = Math.max(32, Math.min(88, Number(next) || 56))
    setRowHeight(capped)
    try { localStorage.setItem('p57_leads_row_height', String(capped)) } catch (e) { /* ignore */ }
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
  const saveSegment = async () => {
    const name = window.prompt('Name this segment')?.trim()
    if (!name) return
    const segment = { id: `segment_${Date.now()}`, name, filters, search, groupBy, sortBy, sortDir, createdAt: new Date().toISOString() }
    const next = [...segments.filter(item => item.name.toLocaleLowerCase() !== name.toLocaleLowerCase()), segment]
    try {
      await api.put('/api/user-preferences', { leadSegments: next })
      setSegments(next)
      setSelectedSegmentId(segment.id)
      toast(`Saved segment “${name}”`)
    } catch (e) { toast(e.message, 'error') }
  }
  const applySegment = (id) => {
    const segment = segments.find(item => item.id === id)
    if (!segment) return
    setSelectedSegmentId(id)
    setFilters({ ...DEFAULT_FILTERS, ...(segment.filters || {}) })
    setSearch(segment.search || '')
    setGroupBy(segment.groupBy || '')
    setSortBy(segment.sortBy || 'createdAt')
    setSortDir(segment.sortDir || 'desc')
    setPage(0)
  }
  const deleteSegment = async (id) => {
    const segment = segments.find(item => item.id === id)
    if (!segment || !window.confirm(`Delete saved segment “${segment.name}”?`)) return
    try {
      const next = segments.filter(item => item.id !== id)
      await api.put('/api/user-preferences', { leadSegments: next })
      setSegments(next)
      setSelectedSegmentId('')
      toast('Saved segment deleted')
    } catch (e) { toast(e.message, 'error') }
  }
  useEffect(() => {
    if (!boot || !remotePrefsHydrated.current) return
    const timer = setTimeout(() => {
      api.put('/api/user-preferences', { leadTablePrefs: { rowHeight, tableZoom, density, headerPinned, fixedCols, colWidths, ...tableStyle } }).catch(() => {})
    }, 700)
    return () => clearTimeout(timer)
  }, [boot, rowHeight, tableZoom, density, headerPinned, fixedCols, colWidths, tableStyle])
  const hasFilters = Object.values(filters).some(Boolean) || search
  const q = buildQuery({ ...filters, search: search.trim() || undefined, page, pageSize, sortBy, sortDir })
  const columnCountsQuery = buildQuery({ ...filters, search: search.trim() || undefined })

  const { data, loading, reload } = useFetch(() => api.get(`/api/leads?${q}`), [q, dataVersion])

  const setF = (k) => (e) => {
    if (k === 'associateId' && onlyMine) setOnlyMine(false)
    setFilters(f => ({ ...f, [k]: e.target.value })); setPage(0)
  }
  // A quick view replaces the filter set rather than layering onto it, and
  // clicking the active one returns to the default month view.
  const applyQuickView = (view) => {
    setActiveQuickView(current => {
      const next = current === view.id ? '' : view.id
      setFilters(next ? { ...EMPTY_FILTERS, ...view.patch } : DEFAULT_FILTERS)
      return next
    })
    setOnlyMine(false)
    setPage(0)
  }

  const clearFilters = () => {
    setOnlyMine(false)
    try { localStorage.setItem('p57_leads_only_mine', '0') } catch (e) { /* ignore */ }
    setFilters(EMPTY_FILTERS); setSearch(''); setPage(0)
  }

  // Optimistic single-lead writes. The row updates on click, the request
  // follows, and a failure rolls the row back. `undo` gets the previous
  // values so the toast can put them back with one more PATCH.
  const applyOptimistic = (leadId, patch) =>
    setPendingPatches(prev => ({ ...prev, [leadId]: { ...(prev[leadId] || {}), ...patch } }))

  const clearOptimistic = (leadId, keys) =>
    setPendingPatches(prev => {
      const current = prev[leadId]
      if (!current) return prev
      const next = { ...current }
      keys.forEach(k => { delete next[k] })
      const out = { ...prev }
      if (Object.keys(next).length) out[leadId] = next
      else delete out[leadId]
      return out
    })

  const patchLead = async (lead, patch, { message, undoLabel = 'Undo' } = {}) => {
    const keys = Object.keys(patch)
    const previous = Object.fromEntries(keys.map(k => [k, lead[k] ?? null]))
    applyOptimistic(lead.id, patch)
    try {
      await api.patch(`/api/leads/${lead.id}`, patch)
      if (message) {
        toast(message, 'success', {
          action: {
            label: undoLabel,
            onClick: async () => {
              applyOptimistic(lead.id, previous)
              try {
                await api.patch(`/api/leads/${lead.id}`, previous)
                refreshData()
              } catch (err) {
                clearOptimistic(lead.id, keys)
                toast(err.message, 'error')
              }
            }
          }
        })
      }
      refreshData()
    } catch (e) {
      clearOptimistic(lead.id, keys)
      toast(e.message, 'error')
    }
  }

  const changeStage = (lead, stage) =>
    patchLead(lead, { stage }, { message: `${lead.fullName || 'Lead'} moved to ${stage}` })

  const changeAssociate = (lead, associateId) =>
    patchLead(lead, { associateId: associateId || null }, {
      message: associateId
        ? `Assigned to ${lookup.asnById?.[associateId]?.name || 'associate'}`
        : 'Owner cleared'
    })

  const changeLeadField = (lead, patch) => patchLead(lead, patch)

  const leadBillingPreset = (lead, classType = '') => {
    const loc = String(lookup.locById[lead.locationId]?.name || '').toLowerCase()
    const cls = String(classType || lead.classType || '').toLowerCase()
    if (loc.includes('kwality')) {
      if (cls.includes('barre')) return { mode: 'momence', title: 'Open Barre membership', membershipName: 'Open Barre' }
      if (cls.includes('strength') || cls.includes('powercycle') || cls.includes('power cycle')) return { mode: 'momence', title: 'Newcomers 2 For 1 membership', membershipName: 'Newcomers 2 For 1' }
    }
    if (loc.includes('kenkere')) return { mode: 'momence', title: 'New Client Intro Pack', membershipName: 'New Client Intro Pack' }
    if (loc.includes('copper')) return { mode: 'momence', title: 'Copper & Cloves single class', membershipName: 'Copper & Cloves' }
    if (loc.includes('plash')) return { mode: 'momence', title: 'Studio Single Class', membershipName: 'Studio Single Class' }
    return { mode: 'momence', title: 'Select a billing package', membershipName: '' }
  }

  const openQuickAction = (lead, mode = 'book') => {
    const preset = leadBillingPreset(lead)
    setQuickActionLead(lead)
    setQuickActionMode(mode)
    setQuickActionClass(lead.classType || '')
    setQuickActionAmount('')
    setQuickActionName(preset.title)
    setQuickActionUrl('')
    setQuickActionStatus('')
    setQuickActionSessionId('')
    setQuickActionMembershipId('')
    setQuickActionPaymentMethodId('')
    setQuickActionPurchaseMembershipId('')
    setQuickActionStripeItems([])
    setQuickActionStripeOptions({ promotionMode: 'none', promotionCodeId: '', addressCollection: 'none', shippingCountries: ['IN'], collectPhone: false, collectTaxId: false, automaticTax: false, adjustableQuantity: false, createCustomer: true, invoiceCreation: false, requireTerms: false, submitType: 'auto', customFields: [], afterCompletion: 'hosted', redirectUrl: '', thankYouMessage: 'Thank you. Your payment was successful.', limitPayments: true, completedSessionsLimit: 1, inactiveMessage: 'This payment link is no longer available.', customTextSubmit: '', customTextAfterSubmit: '' })
  }

  const submitQuickAction = async () => {
    if (!quickActionLead) return
    try {
      if (quickActionMode === 'stripe') {
        if (!quickActionStripeItems.length && !(Number(quickActionAmount) > 0)) throw new Error('Select at least one Stripe product or enter a custom amount.')
        const result = await api.post('/api/stripe/payment-links', {
          leadId: quickActionLead.id,
          items: quickActionStripeItems,
          amount: quickActionStripeItems.length ? undefined : Number(quickActionAmount),
          name: quickActionName || `Payment for ${quickActionLead.fullName}`,
          description: `Created for ${quickActionLead.fullName} in Physique 57 CRM`,
          ...quickActionStripeOptions
        })
        setQuickActionUrl(result.payment.checkoutUrl)
        setQuickActionStatus(result.payment.status)
        toast('Stripe payment link created')
        refreshData()
        return
      }
      let memberId = quickActionLead.memberId || quickActionLead.momence?.memberId
      if (!memberId) {
        const nameParts = String(quickActionLead.fullName || '').trim().split(/\s+/).filter(Boolean)
        const firstName = nameParts.shift() || ''
        const lastName = nameParts.join(' ') || 'Member'
        const created = await api.post(`/api/momence/create/${quickActionLead.id}`, {
          firstName,
          lastName,
          email: quickActionLead.email,
          phoneNumber: quickActionLead.phone,
          homeLocationId: quickActionLead.locationId
        })
        memberId = created.memberId
        setQuickActionLead(current => current ? { ...current, memberId } : current)
        toast('Lead converted to a Momence member')
      }
      if (!quickActionSessionId) throw new Error('Select a Studio Session first.')
      if (quickActionPurchaseMembershipId) {
        await api.post(`/api/momence/members/${memberId}/memberships`, { membershipId: quickActionPurchaseMembershipId, paymentMethodId: quickActionPaymentMethodId, locationId: quickActionLead.locationId, isEmailSent: false })
      }
      const result = await api.post(`/api/momence/sessions/${quickActionSessionId}/bookings`, { memberId, membershipId: quickActionMembershipId || undefined, locationId: quickActionLead.locationId, recurringBooking: false, waitlist: false })
      const membership = result?.result || result
      setQuickActionStatus(membership?.status || 'booked')
      toast('Lead booked successfully')
      refreshData()
    } catch (e) {
      toast(e.message, 'error')
    }
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
  const selectAllMatchingFilter = async () => {
    setSelectAllBusy(true)
    try {
      const { ids } = await api.get(`/api/leads/ids?${q}`)
      setSelected(new Set(ids))
      setSelectAllMatching(true)
    } catch (e) { toast(e.message, 'error') }
    setSelectAllBusy(false)
  }

  const toggleSelectAll = () => {
    if (selected.size > 0) { clearSelection(); return }
    // Select only the currently visible rows first. If more filtered leads
    // exist beyond this page, a follow-up prompt offers to select all of them.
    setSelectAllMatching(false)
    setSelected(new Set(items.map(l => l.id)))
  }
  const clearSelection = () => { setSelected(new Set()); setSelectAllMatching(false) }

  // Bulk undo restores each lead's own previous value, so a mixed
  // selection goes back to exactly where it was rather than to one
  // shared stage or owner.
  const restorePrevious = (field, before) => async () => {
    const groups = new Map()
    for (const [id, value] of Object.entries(before)) {
      const key = JSON.stringify(value ?? null)
      if (!groups.has(key)) groups.set(key, { value: value ?? null, ids: [] })
      groups.get(key).ids.push(id)
    }
    try {
      for (const { value, ids } of groups.values()) {
        await api.patch('/api/leads/bulk', { ids, patch: { [field]: value } })
      }
      toast('Change reverted')
      refreshData()
    } catch (e) { toast(e.message, 'error') }
  }

  const bulkChangeStage = async (stage) => {
    if (!stage || !selected.size) return
    const before = Object.fromEntries(items.filter(l => selected.has(l.id)).map(l => [l.id, l.stage ?? null]))
    setBulkBusy(true)
    try {
      const { updated } = await api.patch('/api/leads/bulk', { ids: [...selected], patch: { stage } })
      toast(`Moved ${updated} lead${updated === 1 ? '' : 's'} to ${stage}`, 'success',
        Object.keys(before).length ? { action: { label: 'Undo', onClick: restorePrevious('stage', before) } } : {})
      clearSelection(); refreshData()
    } catch (e) { toast(e.message, 'error') }
    setBulkBusy(false)
  }

  const bulkAssign = async (associateId) => {
    if (!associateId || !selected.size) return
    const before = Object.fromEntries(items.filter(l => selected.has(l.id)).map(l => [l.id, l.associateId ?? null]))
    setBulkBusy(true)
    try {
      const { updated } = await api.patch('/api/leads/bulk', { ids: [...selected], patch: { associateId } })
      toast(`Reassigned ${updated} lead${updated === 1 ? '' : 's'}`, 'success',
        Object.keys(before).length ? { action: { label: 'Undo', onClick: restorePrevious('associateId', before) } } : {})
      clearSelection(); refreshData()
    } catch (e) { toast(e.message, 'error') }
    setBulkBusy(false)
  }
  const bulkPatchField = async (patch, message) => {
    if (!selected.size) return
    setBulkBusy(true)
    try {
      const { updated } = await api.patch('/api/leads/bulk', { ids: [...selected], patch })
      toast(`${message} for ${updated} lead${updated === 1 ? '' : 's'}`)
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
    const head = ['Full Name', 'Phone', 'Email', 'Source', 'Stage', 'Status', 'Outcome', 'Owner', 'Location', 'Class Type', 'AI Score', 'Created At', 'Remarks', 'Missed Follow-ups']
    const lines = [head.join(',')]
    for (const l of rows) {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
      lines.push([l.fullName, l.phone, l.email, l.sourceName, l.stage, l.statusGroup, l.status, lookup.asnById[l.associateId]?.name || '', lookup.locById[l.locationId]?.name || '', l.classType, l.ai.score, l.createdAt, l.remarks, l.fu?.missedCount || 0].map(esc).join(','))
    }
    downloadText(`leads-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'))
    toast('Exported CSV')
  }

  const pages = Math.max(1, Math.ceil((data?.total || 0) / pageSize))
  const rawItems = data?.items || []
  const items = React.useMemo(
    () => Object.keys(pendingPatches).length
      ? rawItems.map(l => (pendingPatches[l.id] ? { ...l, ...pendingPatches[l.id] } : l))
      : rawItems,
    [rawItems, pendingPatches]
  )

  // Faces are only useful while they stay recognisable, so the row shows the
  // owners actually present in the current result set (busiest first) and
  // caps at eight; the full roster stays in the Owners menu.
  const quickAssociates = useMemo(() => {
    const counts = new Map()
    for (const lead of items) if (lead.associateId) counts.set(lead.associateId, (counts.get(lead.associateId) || 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => lookup.asnById?.[id])
      .filter(a => a && a.active !== false)
      .slice(0, 8)
  }, [items, lookup])

  // Once a refetch returns the same value the overlay was holding, the
  // overlay has served its purpose — drop it so it can't mask later edits.
  React.useEffect(() => {
    if (!Object.keys(pendingPatches).length || !rawItems.length) return
    const byId = Object.fromEntries(rawItems.map(l => [l.id, l]))
    setPendingPatches(prev => {
      let changed = false
      const next = {}
      for (const [id, patch] of Object.entries(prev)) {
        const server = byId[id]
        if (!server) { next[id] = patch; continue }
        const unresolved = Object.fromEntries(
          Object.entries(patch).filter(([k, v]) => (server[k] ?? null) !== (v ?? null))
        )
        if (Object.keys(unresolved).length) next[id] = unresolved
        if (Object.keys(unresolved).length !== Object.keys(patch).length) changed = true
      }
      return changed ? next : prev
    })
  }, [rawItems])

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
  const toggleHeaderPinned = () => setHeaderPinned(current => {
    const next = !current
    try { localStorage.setItem('p57_leads_header_pinned', String(next)) } catch (e) { /* ignore */ }
    return next
  })
  const toggleFixedCols = () => setFixedCols(current => {
    const next = !current
    try { localStorage.setItem('p57_leads_fixed_cols', String(next)) } catch (e) { /* ignore */ }
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
    <div className="leads-workspace">
      {/* bulk selection toolbar */}
      {selected.size > 0 && (
        <div className="card p-3 flex flex-wrap items-center gap-3 border-rose-400/25" style={{ animation: 'fadeIn .15s ease' }}>
          <span className="chip bg-rose-500/15 border border-rose-400/30 text-rose-300 !px-2.5 !py-1 text-sm font-semibold">
            {selectAllMatching ? `All ${selected.size} matching leads selected` : `${selected.size} selected`}
          </span>
          {!selectAllMatching && selected.size === items.length && (data?.total || 0) > items.length && (
            <button className="btn btn-ghost !py-1.5 !text-sm text-rose-300" disabled={selectAllBusy} onClick={selectAllMatchingFilter}>
              {selectAllBusy ? 'Loading…' : `Select all ${data.total} matching leads`}
            </button>
          )}
          <select className="input !w-auto !py-1.5 !text-sm" disabled={bulkBusy} defaultValue="" onChange={e => { bulkChangeStage(e.target.value); e.target.value = '' }}>
            <option value="" disabled>Change stage…</option>
            {(boot?.stages || []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input !w-auto !py-1.5 !text-sm" disabled={bulkBusy} defaultValue="" onChange={e => { bulkAssign(e.target.value); e.target.value = '' }}>
            <option value="" disabled>Reassign owner…</option>
            {(boot?.associates || []).filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="input !w-auto !py-1.5 !text-sm" disabled={bulkBusy} defaultValue="" onChange={e => { if (e.target.value) bulkPatchField({ sourceName: e.target.value }, 'Source updated'); e.target.value = '' }}>
            <option value="" disabled>Change source…</option>
            {(boot?.sources || []).map(source => { const name = typeof source === 'string' ? source : source.name; return <option key={name} value={name}>{name}</option> })}
          </select>
          <select className="input !w-auto !py-1.5 !text-sm" disabled={bulkBusy} defaultValue="" onChange={e => { if (e.target.value) bulkPatchField({ locationId: e.target.value }, 'Studio updated'); e.target.value = '' }}>
            <option value="" disabled>Change studio…</option>
            {(boot?.locations || []).filter(location => location.active !== false).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          {role !== 'agent' && (
            <button className="btn btn-ghost !py-1.5 !text-sm text-rose-300 hover:!bg-rose-500/10" disabled={bulkBusy} onClick={bulkDelete}>
              <Trash2 size={13} /> Delete
            </button>
          )}
          <button className="btn btn-ghost !py-1.5 !text-sm ml-auto" onClick={clearSelection}>
            <X size={13} /> Clear selection
          </button>
        </div>
      )}

      {/* Quick views sit above the controls: the five questions this page
          gets opened with, answered in one click each. */}
      <div className="leads-quickviews" role="group" aria-label="Quick views">
        <button
          type="button"
          className={`quickview ${!activeQuickView && !hasFilters ? 'is-active' : ''}`}
          onClick={() => { setActiveQuickView(''); setFilters(DEFAULT_FILTERS); setOnlyMine(false); setPage(0) }}
        >All open</button>
        {myAssociateId && (
          <button
            type="button"
            className={`quickview ${onlyMine ? 'is-active' : ''}`}
            onClick={toggleOnlyMine}
            title="Only leads assigned to you"
          >My leads</button>
        )}
        {QUICK_VIEWS.map(v => (
          <button
            key={v.id}
            type="button"
            title={v.hint}
            className={`quickview ${activeQuickView === v.id ? 'is-active' : ''}`}
            onClick={() => applyQuickView(v)}
          >{v.label}</button>
        ))}
        {segments.length > 0 && <span className="quickview-sep" aria-hidden="true" />}
        {segments.map(segment => (
          <button
            key={segment.id}
            type="button"
            className={`quickview is-segment ${selectedSegmentId === segment.id ? 'is-active' : ''}`}
            onClick={() => applySegment(selectedSegmentId === segment.id ? '' : segment.id)}
            title={`Saved segment · ${segment.name}`}
          >
            <Bookmark size={11} /> {segment.name}
          </button>
        ))}

        {/* Owner filter as faces: recognising a colleague by their photo is
            faster than reading their name out of a select. */}
        {quickAssociates.length > 0 && <span className="quickview-sep" aria-hidden="true" />}
        <div className="quickview-people">
          {quickAssociates.map(a => (
            <button
              key={a.id}
              type="button"
              title={`Only ${a.name}'s leads`}
              aria-pressed={filters.associateId === a.id}
              className={`quickview-person ${filters.associateId === a.id ? 'is-active' : ''}`}
              onClick={() => { if (onlyMine) setOnlyMine(false); setFilters(f => ({ ...f, associateId: f.associateId === a.id ? '' : a.id })); setPage(0) }}
            >
              <Avatar name={a.name} color={a.color} photoUrl={a.photoUrl} photoZoom={a.photoZoom} photoPosX={a.photoPosX} photoPosY={a.photoPosY} size={22} fallback="👤" />
            </button>
          ))}
        </div>

        <span className="leads-quickviews-count">{data?.total ?? 0} leads</span>
      </div>

      {/* toolbar — filters, owners, view controls in one cohesive bar */}
      <div className="leads-toolbar">
        <div className="leads-toolbar-group leads-toolbar-primary">
          <button className={`btn ${panelOpen ? 'btn-soft' : 'btn-ghost'} !py-2`} onClick={() => setPanelOpen(o => !o)}>
            <SlidersHorizontal size={14} /> Filters {hasFilters && <span className="filter-dot" />}
          </button>
        </div>

        {hasFilters && (
          <div className="leads-toolbar-chips" style={{ animation: 'fadeIn .15s ease' }}>
            {Object.entries(filters).filter(([k, v]) => v && k !== 'dateFrom' && k !== 'dateTo').map(([k, v]) => {
              let label = v
              if (k === 'locationId') label = lookup.locById[v]?.name || v
              if (k === 'associateId') label = lookup.asnById[v]?.name || v
              if (k === 'stage') label = v
              if (k === 'status') label = v.toUpperCase()
              return (
                <button key={k} className="active-filter-chip" onClick={() => { setFilters(f => ({ ...f, [k]: '' })); setPage(0) }}>
                  <span className="active-filter-key">{FILTER_LABELS[k] || k}</span>
                  <span className="active-filter-value">{label}</span>
                  <X size={10} />
                </button>
              )
            })}
            {filters.dateFrom && filters.dateTo && (
              <button className="active-filter-chip" onClick={() => { setFilters(f => ({ ...f, dateFrom: '', dateTo: '' })); setPage(0) }}>
                <span className="active-filter-key">Date</span>
                <span className="active-filter-value">{fmtDateCompact(filters.dateFrom)} – {fmtDateCompact(filters.dateTo)}</span>
                <X size={10} />
              </button>
            )}
            <button className="active-filter-clear" onClick={clearFilters}>Clear all</button>
          </div>
        )}

        <div className="leads-toolbar-divider" />

        <div className="leads-toolbar-group leads-toolbar-owners">
          <div className="saved-segments-control">
            <select className="input !w-auto !py-1.5" value={selectedSegmentId} onChange={e => applySegment(e.target.value)} aria-label="Open saved segment">
              <option value="">Saved segments</option>
              {segments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
            </select>
            <button type="button" className="btn btn-ghost !py-2 !px-3" onClick={saveSegment}>Save</button>
            {selectedSegmentId && <button type="button" className="btn btn-ghost !py-2 !px-3" onClick={() => deleteSegment(selectedSegmentId)} title="Delete selected segment"><Trash2 size={13} /></button>}
          </div>
          <OwnerFilter associates={(boot?.associates || []).filter(a => a.active !== false && (!filters.locationId || (a.locationIds || [a.locationId]).includes(filters.locationId)))} selected={filters.associateId} onSelect={id => { if (onlyMine) setOnlyMine(false); setFilters(f => ({ ...f, associateId: f.associateId === id ? '' : id })); setPage(0) }} />
          <select className="input !w-auto !py-1.5" value={groupBy} onChange={e => { setGroupBy(e.target.value); setCollapsed({}) }}>
            {GROUP_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.id ? `Group by ${g.label}` : 'No grouping'}</option>)}
          </select>
          {grouped && (
            <div className="flex items-center gap-1">
              <Tip content="Expand all groups"><button className="btn btn-ghost !py-2 !px-3" onClick={() => setCollapsed({})}><ChevronRight size={14} className="rotate-90" /></button></Tip>
              <Tip content="Collapse all groups"><button className="btn btn-ghost !py-2 !px-3" onClick={() => setCollapsed(Object.fromEntries(grouped.map(g => [g.key, true])))}><ChevronRight size={14} /></button></Tip>
            </div>
          )}
        </div>

        <div className="leads-toolbar-divider" />

        <div className="leads-toolbar-group leads-toolbar-view">
          {(missedLeads.length > 0 || outreachLeads.length > 0) && (
            <div ref={aiAlertRef} className={`ai-alert-compact ${aiAlertOpen ? 'is-open' : ''}`}>
              <button className="ai-alert-trigger" onClick={() => setAiAlertOpen(v => !v)} title="AI missed follow-up and outreach detection" aria-expanded={aiAlertOpen}>
                <span className="ai-alert-pulse" />
                <Sparkles size={14} />
                <span>AI alerts</span>
                <span className="ai-alert-count">{missedLeads.length + outreachLeads.length}</span>
              </button>
              {aiAlertOpen && aiAlertPosition && createPortal(
                <div className="ai-alert-panel ai-alert-panel-portal" style={aiAlertPosition}>
                  <div className="ai-alert-panel-head">
                    <span className="ai-alert-panel-icon"><Sparkles size={13} /></span>
                    <div>
                      <div className="ai-alert-panel-title">AI follow-up intelligence</div>
                      <div className="ai-alert-panel-sub">Live scan of {items.length} leads in view</div>
                    </div>
                  </div>
                  <div className="ai-alert-metric-grid">
                    <div className="ai-alert-metric is-amber">
                      <span className="ai-alert-metric-value">{missedLeads.length}</span>
                      <span className="ai-alert-metric-label">Missed follow-ups</span>
                    </div>
                    <div className="ai-alert-metric is-rose">
                      <span className="ai-alert-metric-value">{outreachLeads.length}</span>
                      <span className="ai-alert-metric-label">Idle &gt; {cadenceDays}d</span>
                    </div>
                    <div className="ai-alert-metric is-slate">
                      <span className="ai-alert-metric-value">{missedLeads.filter(l => l.fu?.missedCount > 1).length}</span>
                      <span className="ai-alert-metric-label">Critical (2+ missed)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button className="btn btn-ghost !py-1.5 !text-sm" onClick={jumpToTable}>View in table</button>
                    <button className="btn btn-ghost !py-1.5 !text-sm" onClick={() => setAiAlertOpen(false)}>Close</button>
                  </div>
                </div>,
                document.body
              )}
            </div>
          )}
          <button className="btn btn-ghost !py-2" onClick={exportCsv}><Download size={14} /> Export</button>
          {view === 'table' && (
            <>
              <ViewMenu rowHeight={rowHeight} tableZoom={tableZoom} headerPinned={headerPinned} fixedCols={fixedCols} density={density} tableStyle={tableStyle} onTableStyle={setTableStyle} onRowHeight={saveRowHeight} onZoom={saveTableZoom} onPinHeader={toggleHeaderPinned} onFixedCols={toggleFixedCols} onDensity={toggleDensity} columnsComponent={<ColumnManager columns={columns} setColumns={setColumns} />} />
            </>
          )}
          <div className="leads-view-switcher">
            {VIEWS.map(v => {
              const Icon = v.icon
              const active = view === v.id
              return (
                <Tip key={v.id} content={v.label}>
                  <button
                    className={active ? 'is-active' : ''}
                    onClick={() => setView(v.id)}
                    aria-label={v.label}
                    aria-current={active}
                  >
                    <Icon size={14} />
                  </button>
                </Tip>
              )
            })}
          </div>
        </div>
      </div>

      {/* filter panel */}
      {panelOpen && (
        <div className="card p-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3" style={{ animation: 'fadeIn .15s ease' }}>
          <Filter label="Location" value={filters.locationId} onChange={setF('locationId')} disabled={role === 'agent'}>
            <option value="">All locations</option>
            {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Filter>
          <Filter label="Stage" value={filters.stage} onChange={setF('stage')}>
            <option value="">All stages</option>
            {(boot?.stages || []).map(s => <option key={s}>{s}</option>)}
          </Filter>
          <Filter label="Outcome" value={filters.status} onChange={setF('status')}>
            <option value="">All outcomes</option>
            <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
          </Filter>
          <Filter label="Status" value={filters.statusGroup} onChange={setF('statusGroup')}>
            <option value="">All statuses</option>
            {(boot?.statusGroups || []).map(s => <option key={s}>{s}</option>)}
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
            <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Min score</label>
            <input className="input !py-1.5" type="number" min={0} max={100} placeholder="e.g. 70" value={filters.minScore} onChange={setF('minScore')} />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Created in last</label>
            <select className="input !py-1.5" value={filters.createdWithinDays} onChange={setF('createdWithinDays')}>
              <option value="">Any time</option>
              <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Created from</label>
            <input className="input !py-1.5" type="date" value={filters.dateFrom} onChange={setF('dateFrom')} />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Created to</label>
            <input className="input !py-1.5" type="date" value={filters.dateTo} onChange={setF('dateTo')} />
          </div>
        </div>
      )}

      {view === 'summary' && <SummaryView items={items} boot={boot} lookup={lookup} />}
      {view === 'timeline' && <TimelineView items={items} lookup={lookup} openLead={openLead} />}
      {view === 'kanban' && <KanbanView items={items} boot={boot} lookup={lookup} openLead={openLead} changeStage={changeStage} changeLeadField={changeLeadField} groupBy={groupBy} />}

      {view !== 'summary' && view !== 'timeline' && view !== 'kanban' && (
        <div className={`leads-table-shell card overflow-hidden ${tableStyle.zebra ? 'has-zebra' : 'no-zebra'} ${tableStyle.gridLines ? 'has-grid-lines' : 'no-grid-lines'}`} style={{ '--table-font-scale': tableStyle.fontScale / 100 }} ref={tableJumpRef}>
          {view === 'table' && (
            <TableView
              items={items} boot={boot} lookup={lookup} openLead={openLead} openQuickAction={openQuickAction}
              changeStage={changeStage} changeAssociate={changeAssociate} changeLeadField={changeLeadField} grouped={grouped} collapsed={collapsed} toggleGroup={toggleGroup}
              toggleManualFlag={toggleManualFlag}
              onMessage={setComposeLead}
              onTemplateMessage={setTemplateLead}
              selected={selected} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll}
              columns={columns} density={density} rowHeight={rowHeight} tableZoom={tableZoom} colWidths={colWidths} setColWidths={saveColWidths} manualFlagOverrides={manualFlagOverrides} headerPinned={headerPinned} fixedCols={fixedCols} focusLeadIds={focusLeadIds} clearFocus={() => setFocusLeadIds([])} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir}
              columnCountsQuery={columnCountsQuery}
              integrationRail={<LeadsIntegrationRail boot={boot} leads={items} refreshData={refreshData} toast={toast} />}
            />
          )}
          {view === 'cards' && <CardsView items={items} lookup={lookup} openLead={openLead} grouped={grouped} collapsed={collapsed} toggleGroup={toggleGroup} boot={boot} onMessage={setComposeLead} onTemplateMessage={setTemplateLead} />}
          {view === 'compact' && <CompactView items={items} lookup={lookup} openLead={openLead} boot={boot} onMessage={setComposeLead} onTemplateMessage={setTemplateLead} />}
          {loading && !items.length && <TableSkeleton rows={Math.min(pageSize, 10)} cols={Math.min(columns.filter(c => c.visible !== false).length || 7, 9)} />}
          {!loading && !items.length && <Empty icon={<Search size={20} />} title="No leads match your filters" subtitle="Try adjusting the filters, or import a CSV of leads." />}
        </div>
      )}

      {/* pagination */}
      <div className="flex items-center justify-between text-sm text-slate-400">
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
      <QuickActionModal
        lead={quickActionLead}
        mode={quickActionMode}
        classType={quickActionClass}
        amount={quickActionAmount}
        name={quickActionName}
        sessionId={quickActionSessionId}
        url={quickActionUrl}
        status={quickActionStatus}
        membershipId={quickActionMembershipId}
        purchaseMembershipId={quickActionPurchaseMembershipId}
        paymentMethodId={quickActionPaymentMethodId}
        stripeItems={quickActionStripeItems}
        stripeOptions={quickActionStripeOptions}
        onClose={() => setQuickActionLead(null)}
        onSubmit={submitQuickAction}
        setClassType={setQuickActionClass}
        setAmount={setQuickActionAmount}
        setName={setQuickActionName}
        setSessionId={setQuickActionSessionId}
        setMembershipId={setQuickActionMembershipId}
        setPurchaseMembershipId={setQuickActionPurchaseMembershipId}
        setPaymentMethodId={setQuickActionPaymentMethodId}
        setStripeItems={setQuickActionStripeItems}
        setStripeOptions={setQuickActionStripeOptions}
      />
    </div>
  )
}

function QuickActionModal({ lead, mode, classType, amount, name, sessionId, membershipId, purchaseMembershipId, paymentMethodId, stripeItems, stripeOptions, url, status, onClose, onSubmit, setClassType, setAmount, setName, setSessionId, setMembershipId, setPurchaseMembershipId, setPaymentMethodId, setStripeItems, setStripeOptions }) {
  const isPay = mode === 'stripe'
  const [sessions, setSessions] = useState([])
  const [activeMemberships, setActiveMemberships] = useState([])
  const [catalog, setCatalog] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [payments, setPayments] = useState([])
  const [promotionCodes, setPromotionCodes] = useState([])
  const [refreshingPayment, setRefreshingPayment] = useState('')
  const locationId = lead?.locationId
  const memberId = lead?.memberId || lead?.momence?.memberId
  const selectedCatalogItem = catalog.find(item => String(item.id) === String(purchaseMembershipId))
  const selectedPrice = Number(selectedCatalogItem?.price ?? selectedCatalogItem?.priceInCurrency ?? selectedCatalogItem?.defaultPrice ?? 0)
  useEffect(() => {
    if (!lead) return
    let alive = true
    setLoadingOptions(true)
    const requests = isPay ? [
      api.get('/api/stripe/catalog').then(data => alive && setCatalog(data.products || [])),
      api.get('/api/stripe/promotion-codes').then(data => alive && setPromotionCodes(data.promotionCodes || [])),
      api.get(`/api/stripe/payments?${buildQuery({ leadId: lead.id })}`).then(data => alive && setPayments(data.payments || []))
    ] : [
      api.get(`/api/momence/host-memberships?${buildQuery({ locationId })}`).then(data => alive && setCatalog((data.memberships || []).filter(m => m.disabled !== true && m.isDeleted !== true))),
      api.get(`/api/momence/payment-methods?${buildQuery({ locationId })}`).then(data => alive && setPaymentMethods(data.paymentMethods || []))
    ]
    if (!isPay) requests.push(api.get(`/api/momence/sessions?${buildQuery({ startAfter: new Date().toISOString(), startBefore: new Date(Date.now() + 45 * 86400000).toISOString(), locationId })}`).then(data => alive && setSessions(data.sessions || [])))
    Promise.allSettled(requests).finally(() => alive && setLoadingOptions(false))
    return () => { alive = false }
  }, [lead, isPay, locationId])
  useEffect(() => {
    if (!memberId || !sessionId || isPay) return
    api.get(`/api/momence/members/${memberId}/session-memberships?${buildQuery({ sessionId, locationId, recurringBooking: false })}`).then(data => setActiveMemberships(data.memberships || [])).catch(() => setActiveMemberships([]))
  }, [memberId, sessionId, locationId, isPay])
  const toggleStripeItem = product => setStripeItems(current => current.some(item => item.priceId === product.priceId)
    ? current.filter(item => item.priceId !== product.priceId)
    : [...current, { priceId: product.priceId, quantity: 1, recurring: Boolean(product.recurring) }])
  const updateStripeQuantity = (priceId, quantity) => setStripeItems(current => current.map(item => item.priceId === priceId ? { ...item, quantity: Math.max(1, Math.min(99, quantity)) } : item))
  const setStripeOption = (key, value) => setStripeOptions(current => ({ ...current, [key]: value }))
  const selectedProducts = stripeItems.map(item => ({ ...catalog.find(product => product.priceId === item.priceId), ...item })).filter(item => item.priceId)
  const subtotal = selectedProducts.length ? selectedProducts.reduce((sum, item) => sum + Number(item.amount || 0) * Number(item.quantity || 1), 0) : Number(amount || 0)
  const selectedPromotion = promotionCodes.find(code => code.id === stripeOptions?.promotionCodeId)
  const discount = stripeOptions?.promotionMode === 'auto' && selectedPromotion
    ? Math.min(subtotal, selectedPromotion.percentOff != null ? subtotal * Number(selectedPromotion.percentOff) / 100 : Number(selectedPromotion.amountOff || 0)) : 0
  const total = Math.max(0, subtotal - discount)
  const refreshPayment = async paymentId => {
    setRefreshingPayment(paymentId)
    try {
      const result = await api.get(`/api/stripe/payment-links/${paymentId}`)
      setPayments(current => current.map(payment => payment.id === paymentId ? result.payment : payment))
    } finally { setRefreshingPayment('') }
  }
  return <Modal open={!!lead} onClose={onClose} width={isPay ? 1080 : 760}>
    <ModalHeader title={isPay ? 'Create Stripe payment link' : 'Book a Studio Session'} subtitle={lead ? `${lead.fullName} · ${lead.email || lead.phone || 'No contact details'}` : ''} onClose={onClose} />
    <div className="quick-sale-modal space-y-3">
      <section className="quick-sale-section"><span>Your location</span><strong>{lead?.center || 'Lead studio'}</strong></section>
      <section className="quick-sale-section"><span>Customer</span><div className="quick-sale-customer"><strong>{lead?.fullName}</strong><small>{lead?.email || lead?.phone || 'Contact details required'}</small><em>{isPay ? 'Stripe Checkout' : (memberId ? `Momence #${memberId}` : 'Will be converted to a Momence member before checkout')}</em></div></section>
      {isPay && <div className="stripe-builder-layout">
        <div className="stripe-builder-main">
          <section className="quick-sale-section stripe-product-picker">
            <span>Products and pricing</span>
            {loadingOptions ? <div className="stripe-payment-empty"><Spinner size={16} /> Loading Stripe catalogue…</div> : catalog.length ? <div className="stripe-product-grid">{catalog.map(product => {
              const selected = stripeItems.some(item => item.priceId === product.priceId)
              return <button type="button" key={product.priceId} className={`stripe-product-option ${selected ? 'is-selected' : ''}`} onClick={() => toggleStripeItem(product)}>
                <i>{selected ? <Check size={13} /> : null}</i><strong>{product.name}</strong><small>{product.description || (product.recurring ? `Billed every ${product.recurring.interval}` : 'One-time payment')}</small><b>{money(product.amount)}{product.recurring ? ` / ${product.recurring.interval}` : ''}</b>
              </button>
            })}</div> : <div className="stripe-payment-empty">No active prices found. Create a custom one-time payment below.</div>}
            {!!selectedProducts.length && <div className="stripe-selected-cart">{selectedProducts.map(product => <div key={product.priceId}><div><strong>{product.name}</strong><small>{money(product.amount)} each</small></div><div className="stripe-quantity"><button type="button" onClick={() => updateStripeQuantity(product.priceId, product.quantity - 1)}><Minus size={12} /></button><span>{product.quantity}</span><button type="button" onClick={() => updateStripeQuantity(product.priceId, product.quantity + 1)}><Plus size={12} /></button></div><b>{money(product.amount * product.quantity)}</b><button type="button" className="stripe-remove" onClick={() => toggleStripeItem(product)}><Trash size={13} /></button></div>)}</div>}
          </section>
          <section className="quick-sale-section stripe-custom-payment">
            <span>Custom payment</span>
            <div><label><small>Payment title</small><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={`Payment for ${lead?.fullName || 'lead'}`} /></label><label><small>Amount (INR)</small><input className="input" type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" disabled={stripeItems.length > 0} /></label></div>
            {stripeItems.length > 0 && <small className="stripe-helper">Remove selected products to create a custom-priced link.</small>}
          </section>

          <details className="stripe-option-group" open><summary><span>Checkout options</span><small>Customer details, tax and receipts</small></summary><div className="stripe-option-content">
            <StripeToggle label="Allow customers to adjust quantity" description="Show quantity controls on Stripe Checkout." checked={stripeOptions.adjustableQuantity} onChange={value => setStripeOption('adjustableQuantity', value)} />
            <StripeToggle label="Collect phone number" description="Add a required phone field at checkout." checked={stripeOptions.collectPhone} onChange={value => setStripeOption('collectPhone', value)} />
            <StripeToggle label="Collect tax ID" description="Allow eligible business customers to enter a tax ID." checked={stripeOptions.collectTaxId} onChange={value => setStripeOption('collectTaxId', value)} />
            <StripeToggle label="Automatic tax" description="Let Stripe calculate tax from the customer's address." checked={stripeOptions.automaticTax} onChange={value => setStripeOption('automaticTax', value)} />
            <StripeToggle label="Create a Stripe customer" description="Save customer details for one-time payments." checked={stripeOptions.createCustomer} onChange={value => setStripeOption('createCustomer', value)} />
            <StripeToggle label="Create paid invoice" description="Generate an invoice after a one-time payment." checked={stripeOptions.invoiceCreation} onChange={value => setStripeOption('invoiceCreation', value)} />
            <StripeToggle label="Require terms acceptance" description="Require agreement to the Terms of Service." checked={stripeOptions.requireTerms} onChange={value => setStripeOption('requireTerms', value)} />
            <label className="stripe-control-field"><span>Address collection</span><select className="input" value={stripeOptions.addressCollection} onChange={e => setStripeOption('addressCollection', e.target.value)}><option value="none">Do not collect</option><option value="billing">Billing address</option><option value="shipping">Billing and shipping address</option></select></label>
            <label className="stripe-control-field"><span>Button label</span><select className="input" value={stripeOptions.submitType} onChange={e => setStripeOption('submitType', e.target.value)}><option value="auto">Automatic</option><option value="pay">Pay</option><option value="book">Book</option><option value="donate">Donate</option><option value="subscribe">Subscribe</option></select></label>
          </div></details>

          <details className="stripe-option-group"><summary><span>Custom fields</span><small>Collect up to 3 additional details</small></summary><div className="stripe-option-content is-stacked">
            {(stripeOptions.customFields || []).map((field, index) => <div className="stripe-custom-field" key={index}><input className="input" placeholder="Field label" value={field.label} onChange={e => setStripeOption('customFields', stripeOptions.customFields.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} /><select className="input" value={field.type} onChange={e => setStripeOption('customFields', stripeOptions.customFields.map((item, i) => i === index ? { ...item, type: e.target.value } : item))}><option value="text">Text</option><option value="numeric">Number</option><option value="dropdown">Dropdown</option></select>{field.type === 'dropdown' && <input className="input" placeholder="Options, comma separated" value={field.options || ''} onChange={e => setStripeOption('customFields', stripeOptions.customFields.map((item, i) => i === index ? { ...item, options: e.target.value } : item))} />}<label><input type="checkbox" checked={field.required} onChange={e => setStripeOption('customFields', stripeOptions.customFields.map((item, i) => i === index ? { ...item, required: e.target.checked } : item))} /> Required</label><button type="button" className="stripe-remove" onClick={() => setStripeOption('customFields', stripeOptions.customFields.filter((_, i) => i !== index))}><Trash size={13} /></button></div>)}
            {(stripeOptions.customFields || []).length < 3 && <button type="button" className="btn btn-soft stripe-add-field" onClick={() => setStripeOption('customFields', [...(stripeOptions.customFields || []), { key: `custom_${Date.now()}`, label: '', type: 'text', required: false, options: '' }])}><Plus size={13} /> Add custom field</button>}
          </div></details>

          <details className="stripe-option-group"><summary><span>After payment</span><small>Confirmation, redirect and link limits</small></summary><div className="stripe-option-content is-stacked">
            <div className="stripe-segmented"><button type="button" className={stripeOptions.afterCompletion === 'hosted' ? 'is-active' : ''} onClick={() => setStripeOption('afterCompletion', 'hosted')}>Stripe confirmation</button><button type="button" className={stripeOptions.afterCompletion === 'redirect' ? 'is-active' : ''} onClick={() => setStripeOption('afterCompletion', 'redirect')}>Redirect page</button></div>
            {stripeOptions.afterCompletion === 'redirect' ? <label className="stripe-control-field"><span>Redirect URL</span><input className="input" type="url" value={stripeOptions.redirectUrl} onChange={e => setStripeOption('redirectUrl', e.target.value)} placeholder="https://your-site.com/thank-you" /></label> : <label className="stripe-control-field"><span>Thank-you message</span><textarea className="input" rows="2" value={stripeOptions.thankYouMessage} onChange={e => setStripeOption('thankYouMessage', e.target.value)} /></label>}
            <StripeToggle label="Limit completed payments" description="Deactivate this link after the chosen number of successful checkouts." checked={stripeOptions.limitPayments} onChange={value => setStripeOption('limitPayments', value)} />
            {stripeOptions.limitPayments && <div className="stripe-inline-fields"><label><span>Payment limit</span><input className="input" type="number" min="1" value={stripeOptions.completedSessionsLimit} onChange={e => setStripeOption('completedSessionsLimit', e.target.value)} /></label><label><span>Inactive link message</span><input className="input" value={stripeOptions.inactiveMessage} onChange={e => setStripeOption('inactiveMessage', e.target.value)} /></label></div>}
          </div></details>

          {!!payments.length && <section className="quick-sale-section stripe-payment-history"><span>Payment history</span><div className="stripe-payment-list">{payments.map(payment => <div key={payment.id}><span className={`stripe-payment-status is-${payment.status}`}>{payment.status}</span><div><strong>{payment.items?.length ? `${payment.items.length} Stripe item${payment.items.length > 1 ? 's' : ''}` : payment.metadata?.leadName || 'Custom payment'}</strong><small>{new Date(payment.createdAt).toLocaleString('en-IN')} · {money(payment.amount || 0)}</small></div><button type="button" className="btn btn-ghost !p-1.5" onClick={() => refreshPayment(payment.id)} aria-label="Refresh payment status">{refreshingPayment === payment.id ? <Spinner size={13} /> : <RefreshCw size={13} />}</button>{payment.checkoutUrl && <a className="btn btn-ghost !p-1.5" href={payment.checkoutUrl} target="_blank" rel="noreferrer" aria-label="Open payment link"><ExternalLink size={13} /></a>}</div>)}</div></section>}
        </div>
        <aside className="stripe-builder-summary">
          <div className="stripe-summary-card"><span>Order summary</span>{selectedProducts.length ? selectedProducts.map(product => <div className="stripe-summary-line" key={product.priceId}><small>{product.name} × {product.quantity}</small><b>{money(product.amount * product.quantity)}</b></div>) : <div className="stripe-summary-line"><small>{name || 'Custom payment'}</small><b>{money(subtotal)}</b></div>}<div className="stripe-summary-line"><small>Subtotal</small><b>{money(subtotal)}</b></div>{discount > 0 && <div className="stripe-summary-line is-discount"><small>{selectedPromotion?.code}</small><b>−{money(discount)}</b></div>}<div className="stripe-summary-total"><span>Total</span><strong>{money(total)}</strong></div></div>
          <div className="stripe-summary-card"><span>Promotion codes</span><div className="stripe-promo-modes"><label><input type="radio" name="promo-mode" checked={stripeOptions.promotionMode === 'none'} onChange={() => setStripeOption('promotionMode', 'none')} /> No discounts</label><label><input type="radio" name="promo-mode" checked={stripeOptions.promotionMode === 'customer'} onChange={() => setStripeOption('promotionMode', 'customer')} /> Let customers enter a code</label><label><input type="radio" name="promo-mode" checked={stripeOptions.promotionMode === 'auto'} onChange={() => setStripeOption('promotionMode', 'auto')} /> Auto-apply dashboard code</label></div>{stripeOptions.promotionMode === 'auto' && <label className="stripe-control-field"><span>Dashboard promotion code</span><select className="input" value={stripeOptions.promotionCodeId} onChange={e => setStripeOption('promotionCodeId', e.target.value)}><option value="">Select active code</option>{promotionCodes.map(code => <option key={code.id} value={code.id}>{code.code} · {code.percentOff != null ? `${code.percentOff}% off` : `${money(code.amountOff || 0)} off`}</option>)}</select></label>}<small className="stripe-summary-note">Codes and eligibility come directly from your Stripe Dashboard.</small></div>
          <div className="stripe-summary-card stripe-customer-preview"><span>Customer</span><strong>{lead?.fullName}</strong><small>{lead?.email || 'Email collected at checkout'}</small><em>Payment methods are controlled by your Stripe Dashboard.</em></div>
        </aside>
      </div>}
      {!isPay && <>
        <label className="block"><span className="text-xs text-slate-500">Studio Session</span><select className="input mt-1" value={sessionId} onChange={e => { setSessionId(e.target.value); setMembershipId('') }} disabled={loadingOptions}><option value="">{loadingOptions ? 'Loading classes…' : 'Choose a class'}</option>{sessions.map(s => <option key={s.id} value={s.id}>{new Date(s.startsAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {s.name} · {s.inPersonLocation?.name || 'Studio'}</option>)}</select></label>
        <label className="block"><span className="text-xs text-slate-500">Active membership</span><select className="input mt-1" value={membershipId} onChange={e => { setMembershipId(e.target.value); setPurchaseMembershipId('') }} disabled={!sessionId}><option value="">{sessionId ? (activeMemberships.length ? 'Choose active membership' : 'No active membership — choose POS below') : 'Select a class first'}</option>{activeMemberships.map(m => <option key={m.bookingMembershipId || m.id} value={m.bookingMembershipId || m.id}>{m.name || m.membership?.name || 'Active membership'}{m.classesLeft != null ? ` · ${m.classesLeft} classes left` : ''}</option>)}</select></label>
      </>}
      {!isPay && !membershipId && <><section className="quick-sale-section quick-sale-cart"><span>Cart</span><div className="quick-sale-item"><b>Membership</b><select className="input" value={purchaseMembershipId} onChange={e => setPurchaseMembershipId(e.target.value)}><option value="">Select featured membership</option>{catalog.map(m => { const price = Number(m.price ?? m.priceInCurrency ?? m.defaultPrice ?? 0); return <option key={m.id} value={m.id}>{m.name} · ₹{price.toLocaleString('en-IN')}</option> })}</select>{selectedCatalogItem && <div><strong>{selectedCatalogItem.name}</strong><small>Featured Momence membership</small><b>₹{selectedPrice.toLocaleString('en-IN')}</b></div>}</div></section><div className="quick-sale-summary"><section className="quick-sale-section"><span>Discounts</span><small>Discount eligibility is validated by Momence during checkout.</small></section><section className="quick-sale-section"><span>Totals</span><div><small>Selected item</small><strong>₹{selectedPrice.toLocaleString('en-IN')}</strong></div><div><small>Total submitted to Momence POS</small><strong>₹{selectedPrice.toLocaleString('en-IN')}</strong></div></section></div><section className="quick-sale-section"><span>Payment</span><div className="quick-sale-payment-tabs"><button type="button" className="active">Other</button></div><select className="input" value={paymentMethodId} onChange={e => setPaymentMethodId(e.target.value)}><option value="">Select payment method</option>{paymentMethods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></section></>}
      {url && <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm"><strong className="block text-emerald-400">Payment link created</strong><a className="break-all text-slate-300 underline" href={url} target="_blank" rel="noreferrer">{url}</a></div>}
      {status && !url && <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-400">{isPay ? 'Checkout' : 'Booking'} status: {status}</div>}
      <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>{url && <button className="btn btn-soft" onClick={() => navigator.clipboard?.writeText(url)}><Copy size={13} /> Copy link</button>}<button className="btn btn-primary" disabled={isPay ? ((!stripeItems.length && !(Number(amount) > 0)) || (stripeOptions.promotionMode === 'auto' && !stripeOptions.promotionCodeId) || (stripeOptions.afterCompletion === 'redirect' && !stripeOptions.redirectUrl)) : (!sessionId || (!membershipId && (!purchaseMembershipId || !paymentMethodId)))} onClick={onSubmit}>{isPay ? 'Create payment link' : purchaseMembershipId ? 'Confirm purchase & book' : 'Book member'}</button></div>
    </div>
  </Modal>
}

function StripeToggle({ label, description, checked, onChange }) {
  return <label className="stripe-toggle-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={Boolean(checked)} onChange={event => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

function groupKey(l, by, lookup) {
  switch (by) {
    case 'locationId': return lookup.locById[l.locationId]?.name || 'Unassigned'
    case 'stage': return l.stage || 'Unknown'
    case 'status': return (l.status || 'open').toUpperCase()
    case 'statusGroup': return l.statusGroup || 'Unknown'
    case 'sourceName': return l.sourceName || 'Unknown'
    case 'associateId': return lookup.asnById[l.associateId]?.name || 'Unassigned'
    case 'classType': return l.classType || 'None'
    case 'risk': return l.ai?.risk || 'cold'
    default: return ''
  }
}

function ColumnsToggleIcon({ pinned }) {
  return <span className={`inline-flex w-4 h-4 rounded border items-center justify-center text-2xs ${pinned ? 'bg-rose-500/20 border-rose-400/30 text-rose-300' : 'bg-white/5 border-white/10 text-slate-400'}`}>▥</span>
}

function OwnerFilter({ associates, selected, onSelect }) {
  const selectedAssoc = associates.find(a => a.id === selected)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])
  const toggle = () => {
    if (!open) {
      const r = ref.current?.getBoundingClientRect()
      if (r) setPos({ left: r.left, top: r.bottom + 6 })
    }
    setOpen(o => !o)
  }
  return (
    <div className="owner-filter" ref={ref}>
      <button type="button" className={`owner-filter-trigger ${selectedAssoc ? 'is-active' : ''}`} onClick={toggle}>
        {selectedAssoc ? (
          <>
            <Avatar className="avatar" name={selectedAssoc.name} color={selectedAssoc.color} photoUrl={selectedAssoc.photoUrl} photoZoom={selectedAssoc.photoZoom} photoPosX={selectedAssoc.photoPosX} photoPosY={selectedAssoc.photoPosY} size={20} fallback="👤" />
            <span className="owner-filter-name">{selectedAssoc.name}</span>
          </>
        ) : (
          <>
            <Users size={14} />
            <span>Owners</span>
          </>
        )}
        <ChevronDown size={12} />
      </button>
      {open && pos && createPortal(
        <div className="owner-filter-menu" ref={menuRef} style={{ position: 'fixed', left: pos.left, top: pos.top }}>
          <button type="button" className="owner-filter-option" onClick={() => { onSelect(''); setOpen(false) }}>
            <span className="owner-filter-avatar-placeholder"><Users size={12} /></span>
            <span>All owners</span>
          </button>
          {associates.map(a => (
            <button key={a.id} type="button" className={`owner-filter-option ${selected === a.id ? 'is-active' : ''}`} onClick={() => { onSelect(a.id); setOpen(false) }}>
              <Avatar className="avatar" name={a.name} color={a.color} photoUrl={a.photoUrl} photoZoom={a.photoZoom} photoPosX={a.photoPosX} photoPosY={a.photoPosY} size={22} fallback="👤" />
              <span>{a.name}</span>
              {selected === a.id && <Check size={13} />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

function ViewMenu({ rowHeight, tableZoom, headerPinned, fixedCols, density, tableStyle, onTableStyle, onRowHeight, onZoom, onPinHeader, onFixedCols, onDensity, columnsComponent }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const panelRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (!ref.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])
  const toggle = () => {
    if (!open) {
      const r = ref.current?.getBoundingClientRect()
      if (r) setPos({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 })
    }
    setOpen(o => !o)
  }
  return (
    <div className="view-menu" ref={ref}>
      <button type="button" className={`btn btn-ghost !py-2 ${open ? 'btn-soft' : ''}`} onClick={toggle}>
        <Rows3 size={14} /> View
      </button>
      {open && pos && createPortal(
        <div className="view-menu-panel" ref={panelRef} style={{ position: 'fixed', top: pos.top, right: pos.right }}>
          <div className="view-menu-section">
            <span className="view-menu-label">Density</span>
            <div className="view-menu-toggle">
              <button type="button" className={density === 'compact' ? 'is-active' : ''} onClick={() => { onDensity(); setOpen(false) }}><Rows3 size={13} /> Compact</button>
              <button type="button" className={density === 'comfortable' ? 'is-active' : ''} onClick={() => { onDensity(); setOpen(false) }}><LayoutGrid size={13} /> Comfortable</button>
            </div>
          </div>
          <div className="view-menu-section">
            <span className="view-menu-label">Row height</span>
            <label className="view-menu-range">
              <input type="range" min="32" max="88" value={rowHeight} onChange={e => onRowHeight(Number(e.target.value))} />
              <span>{rowHeight}px</span>
            </label>
          </div>
          <div className="view-menu-section">
            <span className="view-menu-label">Zoom</span>
            <label className="view-menu-range">
              <input type="range" min="88" max="116" value={tableZoom} onChange={e => onZoom(Number(e.target.value))} />
              <span>{tableZoom}%</span>
            </label>
          </div>
          <div className="view-menu-section">
            <span className="view-menu-label">Text size</span>
            <label className="view-menu-range">
              <input type="range" min="90" max="115" value={tableStyle.fontScale} onChange={e => onTableStyle(current => ({ ...current, fontScale: Number(e.target.value) }))} />
              <span>{tableStyle.fontScale}%</span>
            </label>
          </div>
          <div className="view-menu-section view-menu-switches">
            <button type="button" className={headerPinned ? 'is-active' : ''} onClick={() => onPinHeader()}>
              <PanelTop size={13} /> {headerPinned ? 'Header pinned' : 'Pin header'}
            </button>
            <button type="button" className={fixedCols ? 'is-active' : ''} onClick={() => onFixedCols()}>
              {fixedCols ? <Pin size={13} /> : <PinOff size={13} />} {fixedCols ? 'Columns frozen' : 'Freeze columns'}
            </button>
            <button type="button" className={tableStyle.zebra ? 'is-active' : ''} onClick={() => onTableStyle(current => ({ ...current, zebra: !current.zebra }))}>Zebra rows</button>
            <button type="button" className={tableStyle.gridLines ? 'is-active' : ''} onClick={() => onTableStyle(current => ({ ...current, gridLines: !current.gridLines }))}>Grid lines</button>
          </div>
          <div className="view-menu-section">{columnsComponent}</div>
        </div>,
        document.body
      )}
    </div>
  )
}

function Metric({ icon: Icon, children, tone = 'neutral', title }) {
  const tones = {
    neutral: 'text-slate-300',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
    fuchsia: 'text-fuchsia-400',
    slate: 'text-slate-500'
  }
  return (
    <span title={title} className="group-stat">
      {Icon && <Icon size={12} className={`shrink-0 ${tones[tone]}`} />}
      <span className={`group-stat-value ${tones[tone]}`}>{children}</span>
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
    <span className="group-stat-row">
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

function TableView({ items, boot, lookup, openLead, openQuickAction, changeStage, changeAssociate, changeLeadField, toggleManualFlag, grouped, collapsed, toggleGroup, onMessage, onTemplateMessage, selected, toggleSelect, toggleSelectAll, columns, density, rowHeight, tableZoom, colWidths, setColWidths, manualFlagOverrides, headerPinned = true, fixedCols = false, focusLeadIds = [], clearFocus, sortBy, sortDir, setSortBy, setSortDir, columnCountsQuery, integrationRail }) {
  const focusedItems = focusLeadIds.length ? items.filter(l => focusLeadIds.includes(l.id)) : items
  if (grouped) {
    return (
      <div className="lead-group-stack">
        {grouped.map(g => {
          const isOpen = !collapsed[g.key]
          return (
            <div key={g.key} className={`lead-group-block ${isOpen ? 'is-open' : ''}`}>
              <button className="lead-group-header" onClick={() => toggleGroup(g.key)}>
                <span className="lead-group-chevron">
                  <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </span>
                <span className="lead-group-title-wrap">
                  <span className="lead-group-kicker">Grouped segment</span>
                  <span className="lead-group-title">{g.key}</span>
                </span>
                <GroupSummary list={g.list} />
              </button>
              {isOpen && (
                <div className="lead-group-table">
                  <TableGrid items={focusLeadIds.length ? g.list.filter(l => focusLeadIds.includes(l.id)) : g.list} boot={boot} lookup={lookup} openLead={openLead} openQuickAction={openQuickAction} changeStage={changeStage} changeAssociate={changeAssociate} changeLeadField={changeLeadField} toggleManualFlag={toggleManualFlag} onMessage={onMessage} onTemplateMessage={onTemplateMessage} selected={selected} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} columns={columns} density={density} rowHeight={rowHeight} tableZoom={tableZoom} colWidths={colWidths} setColWidths={setColWidths} manualFlagOverrides={manualFlagOverrides} headerPinned={headerPinned} fixedCols={fixedCols} focusLeadIds={focusLeadIds} clearFocus={clearFocus} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} columnCountsQuery={columnCountsQuery} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }
  return <TableGrid items={focusedItems} boot={boot} lookup={lookup} openLead={openLead} openQuickAction={openQuickAction} changeStage={changeStage} changeAssociate={changeAssociate} changeLeadField={changeLeadField} toggleManualFlag={toggleManualFlag} onMessage={onMessage} onTemplateMessage={onTemplateMessage} selected={selected} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} columns={columns} density={density} rowHeight={rowHeight} tableZoom={tableZoom} colWidths={colWidths} setColWidths={setColWidths} manualFlagOverrides={manualFlagOverrides} headerPinned={headerPinned} fixedCols={fixedCols} focusLeadIds={focusLeadIds} clearFocus={clearFocus} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} columnCountsQuery={columnCountsQuery} />
}

function TableGrid({ items, boot, lookup, openLead, openQuickAction, changeStage, changeAssociate, changeLeadField, toggleManualFlag, onMessage, onTemplateMessage, selected, toggleSelect, toggleSelectAll, columns, density, rowHeight = 58, tableZoom = 100, colWidths = {}, setColWidths, manualFlagOverrides = {}, headerPinned = true, fixedCols = false, focusLeadIds = [], clearFocus, sortBy, sortDir, setSortBy, setSortDir, columnCountsQuery }) {
  const { role } = useApp()
  // Agents may now edit name/phone/email/status/source (owner stays locked
  // behind the request flow) — confirm first since these are core lead
  // fields, easy to change by accident from an inline table select.
  const changeLeadFieldConfirmed = (lead, patchBody, fieldLabel) => {
    if (role === 'agent' && !window.confirm(`Change ${fieldLabel} for ${lead.fullName}?`)) return
    changeLeadField(lead, patchBody)
  }
  const cadenceDays = boot?.settings?.cadence?.outreachDays || 7
  const activeChannels = ['fu1', 'fu2', 'fu3', 'fu4']
  const [columnSearch, setColumnSearch] = useState({})
  const compactEmbeddedFields = new Set(['phone', 'source', 'owner'])
  const visibleCols = (columns || []).filter(c => !c.hidden && c.field !== 'created' && !(density === 'compact' && compactEmbeddedFields.has(c.field)))
  const searchValue = (lead, field) => {
    if (field === 'fullName') return lead.fullName
    if (field === 'stage') return lead.stage
    if (field === 'createdAt') return fmtDate(lead.createdAt)
    if (field === 'trialDate') return lead.trialDate || lead.momenceEvidence?.trialDate || ''
    if (field === 'firstPurchaseDate') return lead.firstPurchaseDate || lead.momenceEvidence?.firstPurchaseDate || lead.convertedAt || ''
    if (field === 'source') return lead.sourceName
    if (field === 'owner') return lookup.asnById[lead.associateId]?.name
    if (field === 'location') return lookup.locById[lead.locationId]?.name
    if (field === 'score') return lead.ai?.score
    if (field === 'statusGroup') return lead.statusGroup
    if (field === 'status') return lead.status
    return getColumnValue(visibleCols.find(c => (c.field || c.id) === field) || { field }, lead, lookup)
  }
  const displayedItems = items.filter(lead => Object.entries(columnSearch).every(([field, query]) => !query || String(searchValue(lead, field) ?? '').toLowerCase().includes(query.toLowerCase())))
  const allChecked = displayedItems.length > 0 && displayedItems.every(l => selected?.has(l.id))

  // Sheet-style shortcuts, scoped to what's actually safely editable in-grid:
  // remarks is the one free-text cell, so undo/redo and paste target it;
  // copy/select-all work over the row selection everyone already has.
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const remarksChange = async (lead, remarks) => {
    const prev = lead.remarks || ''
    if (prev === remarks) return
    await changeLeadField(lead, { remarks })
    setUndoStack(s => [...s, { leadId: lead.id, prev, next: remarks }])
    setRedoStack([])
  }
  const undoRemarks = () => {
    setUndoStack(s => {
      if (!s.length) return s
      const entry = s[s.length - 1]
      changeLeadField({ id: entry.leadId }, { remarks: entry.prev })
      setRedoStack(r => [...r, entry])
      return s.slice(0, -1)
    })
  }
  const redoRemarks = () => {
    setRedoStack(r => {
      if (!r.length) return r
      const entry = r[r.length - 1]
      changeLeadField({ id: entry.leadId }, { remarks: entry.next })
      setUndoStack(s => [...s, entry])
      return r.slice(0, -1)
    })
  }
  const copySelection = () => {
    const rows = displayedItems.filter(l => selected?.has(l.id))
    if (!rows.length) return
    const text = rows.map(l => [l.fullName, l.phone || '', l.email || '', l.stage || '', lookup.asnById[l.associateId]?.name || ''].join('\t')).join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
  }
  const pasteIntoSelection = async () => {
    if (selected?.size !== 1) return
    const lead = displayedItems.find(l => selected.has(l.id))
    if (!lead) return
    try {
      const text = await navigator.clipboard.readText()
      const value = text.split(/\r?\n/)[0].split('\t')[0]
      if (value !== undefined) remarksChange(lead, value)
    } catch (e) { /* clipboard permission denied */ }
  }
  const onGridKeyDown = (e) => {
    const tag = e.target.tagName
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || e.target.isContentEditable) return
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    if (e.key === 'a') { e.preventDefault(); toggleSelectAll() }
    else if (e.key === 'c') { e.preventDefault(); copySelection() }
    else if (e.key === 'v') { e.preventDefault(); pasteIntoSelection() }
    else if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoRemarks() }
    else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redoRemarks() }
  }
  const py = ''
  const [scoreTip, setScoreTip] = useState(null)
  // Keyboard triage: j/k or arrows walk the rows, Enter opens the drawer,
  // x selects. Typing into an input or select never steals these keys.
  const [cursorIndex, setCursorIndex] = useState(-1)
  const rowCount = displayedItems.length
  useEffect(() => { if (cursorIndex >= rowCount) setCursorIndex(rowCount - 1) }, [rowCount, cursorIndex])
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key
      if (key === 'j' || key === 'ArrowDown') { e.preventDefault(); setCursorIndex(i => Math.min(i + 1, rowCount - 1)) }
      else if (key === 'k' || key === 'ArrowUp') { e.preventDefault(); setCursorIndex(i => Math.max(i - 1, 0)) }
      else if (key === 'Enter' && cursorIndex >= 0) { e.preventDefault(); openLead(displayedItems[cursorIndex]?.id) }
      else if (key === 'x' && cursorIndex >= 0) { e.preventDefault(); toggleSelect(displayedItems[cursorIndex]?.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rowCount, cursorIndex, displayedItems, openLead, toggleSelect])

  useEffect(() => {
    if (cursorIndex < 0) return
    document.querySelector(`[data-row-index="${cursorIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursorIndex])

  // Left-rail heat: how long an open lead has gone untouched. Turns the
  // directory into a worklist you can triage without reading a single cell.
  // Won and lost rows are done, so they never carry heat.
  const stalenessOf = (lead) => {
    if (lead.status !== 'open') return 'none'
    const idle = Number(lead.fu?.lastOutreachDays ?? 0)
    if ((lead.fu?.missedCount || 0) > 1 || idle > cadenceDays * 3) return 'critical'
    if ((lead.fu?.missedCount || 0) > 0 || idle > cadenceDays) return 'warn'
    if (idle > cadenceDays / 2) return 'soon'
    return 'ok'
  }

  // These are floors, not fixed widths. They were set high enough (owner 260,
  // location 280) that any drag below them was silently discarded and the
  // column looked unresizable. They now only guard against collapsing a
  // column to unreadability.
  const requiredMinWidths = { stage: 120, source: 110, owner: 120, location: 120, status: 96, statusGroup: 110, score: 72 }
  // Dates render as a short compact string; they never needed a 150px column.
  const DEFAULT_COL_WIDTH = { owner: 190, location: 190, source: 150, stage: 178, status: 120, statusGroup: 140, score: 84, trialDate: 104, firstPurchaseDate: 104 }
  const widthOf = (id, fallback) => Math.max(requiredMinWidths[id] || 0, Number(colWidths[id]) || fallback)
  const selectW = widthOf('select', 76)
  const leadW = Math.round((Number(colWidths.lead) || 260) * .9)
  const stageW = widthOf('stage', 178)
  const setColSearch = field => value => setColumnSearch(current => ({ ...current, [field]: value }))
  const autoFitColumns = () => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context) context.font = '500 12px Inter, system-ui, sans-serif'
    const measure = (values, min = 80, max = 320, chrome = 58) => Math.max(
      min,
      Math.min(max, Math.ceil(Math.max(...values.map(value => context?.measureText(String(value || '')).width || 0)) + chrome))
    )
    const next = {
      select: 64,
      lead: measure([`Lead (${displayedItems.length})`, ...displayedItems.flatMap(lead => [properName(lead.fullName), lead.email])], 210, 360, 54),
      stage: measure(['Stage', ...displayedItems.map(lead => lead.stage)], 150, 300, 74),
      createdAt: measure(['Created', ...displayedItems.map(lead => fmtDateCompact(lead.createdAt))], 150, 210, 70),
      remarksField: Number(colWidths.remarksField) || 420,
      actions: 82
    }
    for (const c of visibleCols) {
      const field = c.field || c.id
      next[c.id] = measure([c.label, ...displayedItems.map(lead => searchValue(lead, field))], field === 'score' ? 104 : 120, field === 'location' ? 380 : 300, 66)
    }
    for (const ch of activeChannels) next[ch] = 54
    setColWidths?.(next)
  }
  const startResize = (id, fallback) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = widthOf(id, fallback)
    const onMove = (ev) => {
      const next = Math.max(48, Math.min(1200, Math.round(startWidth + ev.clientX - startX)))
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
    <div className="lead-table-scroll scrollbar-thin" tabIndex={0} onKeyDown={onGridKeyDown} style={{ zoom: tableZoom / 100 }}>
      {focusLeadIds.length > 0 && (
        <div className="px-4 pt-4 pb-3 flex items-center gap-2">
          <span className="chip bg-rose-500/15 border border-rose-400/25 text-rose-300">{focusLeadIds.length} highlighted lead{focusLeadIds.length === 1 ? '' : 's'}</span>
          <button className="btn btn-ghost !py-1.5 !text-sm" onClick={clearFocus}>Show all leads</button>
        </div>
      )}
      <div className="lead-table-horizontal-stage">
      <table className={`data-table leads-data-table is-${density} ${fixedCols ? 'has-sticky-cols' : ''}`} style={{ '--lead-row-height': `${rowHeight}px`, '--col-select-width': `${selectW}px`, '--col-lead-width': `${leadW}px`, '--col-stage-width': `${stageW}px` }}>
        <thead className={headerPinned ? 'is-pinned' : 'is-unpinned'}>
          <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-white/8">
            <th className={`resizable-th sticky-col sticky-col-select px-3 py-3 font-semibold`} style={{ width: selectW, minWidth: selectW }}>
              <button className="flex items-center justify-center text-slate-400 hover:text-white" onClick={toggleSelectAll}>
                {allChecked ? <CheckSquare size={15} className="text-rose-400" /> : <Square size={15} />}
              </button>
              <span className="col-resize-handle" onDoubleClick={autoFitColumns} onMouseDown={startResize('select', widthOf('select', 76))} />
            </th>
            <SortHead label={`Lead (${displayedItems.length})`} field="fullName" width={leadW} onResize={startResize} onAutoFit={autoFitColumns} className={`resizable-th sticky-col sticky-col-lead px-4 py-3 font-semibold`} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} searchValue={columnSearch.fullName || ''} onSearch={setColSearch('fullName')} columnCountsQuery={columnCountsQuery} lookup={lookup} />
            <SortHead label="Stage" field="stage" width={stageW} onResize={startResize} onAutoFit={autoFitColumns} className={`resizable-th sticky-col sticky-col-stage px-4 py-3 font-semibold`} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} searchValue={columnSearch.stage || ''} onSearch={setColSearch('stage')} columnCountsQuery={columnCountsQuery} lookup={lookup} />
            <SortHead label="Created" field="createdAt" width={widthOf('createdAt', 180)} onResize={startResize} onAutoFit={autoFitColumns} className="px-4 py-3 font-semibold" sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} searchValue={columnSearch.createdAt || ''} onSearch={setColSearch('createdAt')} columnCountsQuery={columnCountsQuery} lookup={lookup} />
            {visibleCols.map(c => { const field = c.field || c.id; return <SortHead key={c.id} label={c.label} field={field} resizeId={c.id} width={widthOf(c.id, DEFAULT_COL_WIDTH[c.field] || 150)} onResize={startResize} onAutoFit={autoFitColumns} className="px-4 py-3 font-semibold" sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} searchValue={columnSearch[field] || ''} onSearch={setColSearch(field)} columnCountsQuery={columnCountsQuery} lookup={lookup} /> })}
            <th className="resizable-th px-4 py-3 font-semibold" style={{ width: widthOf('remarksField', 420), minWidth: widthOf('remarksField', 420) }}>
              <span>Remarks</span>
              <span className="col-resize-handle" onDoubleClick={autoFitColumns} onMouseDown={startResize('remarksField', widthOf('remarksField', 420))} title="Drag to resize column. Double-click to auto-fit all columns." />
            </th>
            {activeChannels.map((ch, i) => {
              return (
              <th key={ch} className="resizable-th px-2 py-3 font-semibold text-center" style={{ width: widthOf(ch, 56), minWidth: widthOf(ch, 56) }}>
                <span>FU{i + 1}</span>
                <span className="col-resize-handle" onDoubleClick={autoFitColumns} onMouseDown={startResize(ch, widthOf(ch, 56))} title="Drag to resize column. Double-click to auto-fit all columns." />
              </th>
              )
            })}
            <th className="resizable-th px-3 py-3 font-semibold text-center" style={{ width: widthOf('actions', 82), minWidth: widthOf('actions', 82) }}>
              <span>Actions</span>
              <span className="col-resize-handle" onDoubleClick={autoFitColumns} onMouseDown={startResize('actions', widthOf('actions', 82))} title="Drag to resize column. Double-click to auto-fit all columns." />
            </th>
          </tr>
        </thead>
        <tbody>
          {displayedItems.map((l, idx) => {
            const owner = lookup.asnById[l.associateId]
            const nextFu = l.followUps?.find(f => f.date && f.done === false && f.date !== '-')
            const dueIn = nextFu ? daysFromNow(nextFu.date) : null
            const cadenceMissedOpen = l.status === 'open' && ((l.fu?.missedCount || 0) > 0 || (l.fu?.lastOutreachDays || 0) > cadenceDays || (nextFu && dueIn < 0))
            const rowManualFlags = manualFlagOverrides[l.id] || l.manualFlags || []
            const rowFlagged = rowManualFlags.some(f => f.id === 'focus')
            return (
              <tr
                key={l.id}
                data-row-index={idx}
                data-lead-id={l.id}
                tabIndex={-1}
                className={`border-b border-white/5 hover:bg-white/[0.035] cursor-pointer transition-colors ${selected?.has(l.id) ? 'is-selected' : ''} ${focusLeadIds.includes(l.id) ? 'is-focused' : ''} ${cursorIndex === idx ? 'is-cursor' : ''} stale-${stalenessOf(l)}`}
                style={{ '--row-index': idx }}
                onClick={() => openLead(l.id)}
              >
                <td className={`sticky-col sticky-col-select px-3 ${py}`} style={{ width: selectW, minWidth: selectW }} onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <button className="flex items-center justify-center text-slate-400 hover:text-white" onClick={() => toggleSelect(l.id)}>
                      {selected?.has(l.id) ? <CheckSquare size={15} className="text-rose-400" /> : <Square size={15} />}
                    </button>
                    <button type="button" className={`lead-row-flag ${rowFlagged ? 'is-active' : ''}`} title={rowFlagged ? 'Remove row flag' : 'Flag this member'} onClick={(e) => { e.stopPropagation(); toggleManualFlag({ ...l, manualFlags: rowManualFlags }) }}>
                      <Flag size={14} />
                    </button>
                  </div>
                </td>
                <td className={`sticky-col sticky-col-lead px-4 ${py}`} style={{ width: leadW, minWidth: leadW }}>
                  <div className="min-w-0">
                    <div className="lead-name truncate flex items-center gap-1.5">
                      {properName(l.fullName)}
                      {l.stripePayment && <Tip content={l.stripePayment.status === 'paid' ? `Payment captured${l.stripePayment.paidAt ? ` · ${new Date(l.stripePayment.paidAt).toLocaleDateString('en-IN')}` : ''}` : `Payment link · ${l.stripePayment.status}`}><button type="button" className={`lead-payment-indicator ${l.stripePayment.status === 'paid' ? 'is-paid' : 'is-pending'}`} onClick={event => { event.stopPropagation(); openQuickAction(l, 'stripe') }} aria-label={`Stripe payment ${l.stripePayment.status}`}><IndianRupee size={11} /></button></Tip>}
                      {[...rowManualFlags, ...(l.flags || [])].map(f => (
                        <span key={f.id} title={f.name} className="chip !px-1.5 !py-0 text-2xs" style={{ background: `${f.color}22`, color: f.color, border: `1px solid ${f.color}44` }}>{f.label}</span>
                      ))}
                    </div>
                    {density === 'compact' && <div className="lead-compact-meta"><span>{l.sourceName || 'No source'}</span><span>{owner?.name || 'Unassigned'}</span></div>}
                  </div>
                </td>
                <td className={`sticky-col sticky-col-stage px-4 ${py}`} style={{ width: stageW, minWidth: stageW }} onClick={e => e.stopPropagation()}>
                  {(() => {
                    const { icon: StageIcon } = stageVisual(l.stage)
                    const badgeStyle = stageBadgeStyle(l.stage)
                    const compact = density === 'compact'
                    return (
                      <Tip content={l.stage || 'No stage'}>
                        <div className={`stage-badge-wrap ${compact ? 'is-compact' : ''}`} style={badgeStyle}>
                          <span className="stage-badge-icon"><StageIcon size={compact ? 12 : 14} /></span>
                          <select
                            className={`stage-badge-select ${stageClass(l.stage)}`}
                            style={badgeStyle}
                            value={l.stage} onClick={e => e.stopPropagation()} onChange={e => changeStage(l, e.target.value)}
                            aria-label={`Change stage for ${l.fullName}`}
                          >
                            {(boot?.stages || []).map(s => <option key={s}>{s}</option>)}
                          </select>
                        </div>
                      </Tip>
                    )
                  })()}
                </td>
                <td className={`px-4 ${py} lead-date-cell`} style={{ width: widthOf('createdAt', 180), minWidth: widthOf('createdAt', 180) }}>
                  {l.createdAt
                    ? (
                      <Tip content={<span className="text-xs">{fmtDate(l.createdAt)}</span>}>
                        <span className="lead-date-value"><Calendar size={12} /> {fmtDateCompact(l.createdAt)}</span>
                      </Tip>
                    )
                    : <EmptyCell />}
                </td>
                {visibleCols.map(c => {
                  if (c.field === 'phone') {
                    return (
                      <td key={c.id} className={`px-4 ${py} text-sm mono text-slate-400`}>
                        {l.phone
                          ? <span className="inline-flex items-center gap-1.5"><span aria-hidden="true">{phoneCountryFlag(l.phone)}</span>{l.phone}</span>
                          : <span className="table-empty-icon" title="No phone number"><PhoneOff size={13} /></span>}
                      </td>
                    )
                  }
                  if (c.field === 'trialDate' || c.field === 'firstPurchaseDate') {
                    const cleaned = cleanDate(c.field === 'trialDate'
                      ? (l.trialDate || l.momenceEvidence?.trialDate)
                      : (l.firstPurchaseDate || l.momenceEvidence?.firstPurchaseDate || l.convertedAt))
                    const raw = cleaned && fmtDateCompact(cleaned) !== '—' ? cleaned : ''
                    return (
                      <td key={c.id} className={`px-4 ${py} lead-date-cell`}>
                        {raw
                          ? (
                            <Tip content={<span className="text-xs">{fmtDate(raw)}</span>}>
                              <span className="lead-date-value"><CalendarDays size={12} /> {fmtDateCompact(raw)}</span>
                            </Tip>
                          )
                          : <span className="table-empty-icon"><CalendarDays size={13} /></span>}
                      </td>
                    )
                  }
                  if (c.field === 'source') {
                    return (
                      <td key={c.id} className={`px-4 ${py} text-sm text-slate-400 truncate`}>
                        <select className="table-inline-select" value={l.sourceName || ''} onClick={e => e.stopPropagation()} onChange={e => changeLeadFieldConfirmed(l, { sourceName: e.target.value }, 'source')}>
                          <option value="">No source</option>
                          {(boot?.sources || []).map(source => { const name = typeof source === 'string' ? source : source.name; return <option key={typeof source === 'string' ? source : source.id || name} value={name}>{name}</option> })}
                        </select>
                      </td>
                    )
                  }
                  if (c.field === 'owner') {
                    return (
                      <td key={c.id} className={`px-4 ${py}`} onClick={e => e.stopPropagation()}>
                        <AssociateCell lead={l} owner={owner} associates={boot?.associates || []} onChange={associateId => changeAssociate(l, associateId)} />
                      </td>
                    )
                  }
                  if (c.field === 'location') {
                    return <td key={c.id} className={`px-4 ${py}`} onClick={e => e.stopPropagation()}><select className="table-inline-select" value={l.locationId || ''} onChange={e => changeLeadField(l, { locationId: e.target.value })}>{(boot?.locations || []).filter(location => location.active !== false).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></td>
                  }
                  if (c.field === 'status') {
                    return <td key={c.id} className={`px-4 ${py}`}><span className={`status-readonly status-${l.status || 'open'}`}>{l.status || 'open'}</span></td>
                  }
                  if (c.field === 'statusGroup') {
                    return <td key={c.id} className={`px-4 ${py} text-sm text-left ${l.statusGroup === 'Membership Sold' ? 'text-emerald-400' : l.statusGroup === 'Trial Completed' ? 'text-sky-400' : 'text-slate-400'}`}>{l.statusGroup || 'Pre-Trial'}</td>
                  }
                  if (c.field === 'score') {
                    return (
                      <td key={c.id} className={`px-4 ${py} text-sm mono text-slate-300`} onClick={e => e.stopPropagation()}>
                        <button className="score-detail-trigger" onClick={(e) => setScoreTip({ lead: l, x: e.clientX, y: e.clientY })} title="View score calculation">
                          <ScorePill score={l.ai?.score || 0} />
                        </button>
                      </td>
                    )
                  }
                  const val = getColumnValue(c, l, lookup)
                  const formatted = formatColumnValue(val, c)
                  return (
                    <td key={c.id} className={`px-4 ${py} text-sm ${c.type === 'number' || c.type === 'currency' || c.type === 'percent' ? 'mono text-slate-300' : 'text-slate-400'}`}>
                      {formatted === '—' ? <EmptyCell /> : <span className="table-cell-fit" title={String(formatted ?? '')} style={{ maxWidth: '100%' }}>{formatted}</span>}
                    </td>
                  )
                })}
                <td className={`px-4 ${py}`}>
                  <InlineRemark lead={l} onSave={remarks => remarksChange(l, remarks)} />
                </td>
                {activeChannels.map((ch, fuIndex) => (
                  <td key={ch} className="px-1 text-center" onClick={e => e.stopPropagation()}>
                    <FuCell lead={l} fuIndex={fuIndex} forceMissed={cadenceMissedOpen} />
                  </td>
                ))}
                <td className="px-3 text-center" onClick={e => e.stopPropagation()}>
                  <RowActionsMenu lead={l} openLead={openLead} openQuickAction={openQuickAction} onMessage={onMessage} onTemplateMessage={onTemplateMessage} toggleManualFlag={() => toggleManualFlag({ ...l, manualFlags: rowManualFlags })} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="leads-integration-dock">{integrationRail}</div>
      </div>
      {scoreTip && <ScoreDetailsPopover tip={scoreTip} onClose={() => setScoreTip(null)} />}
    </div>
  )
}

function RowActionsMenu({ lead, openLead, openQuickAction, onMessage, onTemplateMessage, toggleManualFlag }) {
  const { toast, refreshData } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const buttonRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = event => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open])
  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      const menuHeight = 340
      setPosition({ left: Math.max(12, Math.min(window.innerWidth - 250, rect.right - 232)), top: rect.bottom + menuHeight > window.innerHeight ? Math.max(12, rect.top - menuHeight) : rect.bottom + 6 })
    }
    setOpen(true)
  }
  const run = (action) => { setOpen(false); action() }
  const createMember = async () => {
    setBusy(true)
    try {
      const parts = String(lead.fullName || '').trim().split(/\s+/).filter(Boolean)
      const firstName = parts.shift() || ''
      const result = await api.post(`/api/momence/create/${lead.id}`, { firstName, lastName: parts.join(' ') || 'Member', email: lead.email, phoneNumber: lead.phone, homeLocationId: lead.locationId })
      toast(result.warning || `Momence member #${result.memberId} created and linked`)
      refreshData()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false); setOpen(false) }
  }
  return <>
    <button ref={buttonRef} type="button" className="lead-actions-trigger" aria-label={`Actions for ${lead.fullName}`} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={show}><MoreVertical size={16} /></button>
    {open && createPortal(<div className="lead-actions-layer"><button className="lead-actions-dismiss" aria-label="Close actions" onClick={() => setOpen(false)} /><div className="lead-actions-menu" role="menu" style={position}>
      <div className="lead-actions-menu-head"><span>Lead actions</span><strong>{lead.fullName}</strong></div>
      <button role="menuitem" onClick={() => run(() => openLead(lead.id))}><Eye /><span><b>Open details</b><small>View the complete lead record</small></span></button>
      <button role="menuitem" onClick={() => run(() => openQuickAction(lead, 'book'))}><CalendarPlus /><span><b>Book into class</b><small>Choose session and membership</small></span></button>
      <button role="menuitem" onClick={() => run(() => openQuickAction(lead, 'stripe'))}><CreditCard /><span><b>Take payment</b><small>Open Momence Quick Sale</small></span></button>
      <div className="lead-actions-divider" />
      <button role="menuitem" onClick={() => run(() => { openLead(lead.id); toast('Open the Momence profile section to review and assign member tags.') })}><Tags /><span><b>Assign tags</b><small>Manage Momence member tags</small></span></button>
      <button role="menuitem" disabled={!!lead.memberId} onClick={createMember}><UserPlus /><span><b>{lead.memberId ? 'Member already linked' : 'Create member'}</b><small>{lead.memberId ? `Momence #${lead.memberId}` : 'Convert lead before checkout'}</small></span></button>
      <div className="lead-actions-divider" />
      <button role="menuitem" onClick={() => run(() => onMessage(lead))}><MessageCircle /><span><b>Send message</b><small>Compose through Respond.io</small></span></button>
      <button role="menuitem" onClick={() => run(() => onTemplateMessage(lead))}><Sparkles /><span><b>WhatsApp template</b><small>Send an approved template</small></span></button>
      <button role="menuitem" onClick={() => run(toggleManualFlag)}><Flag /><span><b>Toggle priority flag</b><small>Highlight this lead for follow-up</small></span></button>
    </div></div>, document.body)}
  </>
}

function AssociateCell({ lead, owner, associates, onChange }) {
  const { role, openLead } = useApp()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 250 })
  const buttonRef = useRef(null)
  const choices = associates.filter(a => a.active !== false && (a.locationIds || [a.locationId]).includes(lead.locationId))
  useEffect(() => {
    if (!open) return
    const close = event => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open])
  const show = () => {
    if (role !== 'admin') { openLead(lead.id); return }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPosition({ left: Math.min(rect.left, window.innerWidth - 270), top: Math.min(rect.bottom + 6, window.innerHeight - 330), width: Math.max(250, rect.width) })
    setOpen(true)
  }
  if (role !== 'admin') {
    return (
      <button type="button" className="associate-cell-trigger !cursor-not-allowed" onClick={show} title="Open lead to request an owner change">
        <Avatar className="avatar" name={owner?.name || '?'} color={owner?.color} photoUrl={owner?.photoUrl} photoZoom={owner?.photoZoom} photoPosX={owner?.photoPosX} photoPosY={owner?.photoPosY} size={27} fallback="👤" />
        <span>{owner?.name || 'Unassigned'}</span><Lock size={11} className="text-slate-500" />
      </button>
    )
  }
  return (
    <>
      <button ref={buttonRef} type="button" className="associate-cell-trigger" onClick={show} aria-haspopup="listbox" aria-expanded={open}>
        <Avatar className="avatar" name={owner?.name || '?'} color={owner?.color} photoUrl={owner?.photoUrl} photoZoom={owner?.photoZoom} photoPosX={owner?.photoPosX} photoPosY={owner?.photoPosY} size={27} fallback="👤" />
        <span>{owner?.name || 'Unassigned'}</span><ChevronDown size={12} />
      </button>
      {open && createPortal(<>
        <button className="fixed inset-0 z-[108] cursor-default" aria-label="Close associate options" onClick={() => setOpen(false)} />
        <div className="associate-cell-menu" role="listbox" style={position}>
          <div className="associate-cell-menu-head">Assign associate <span>{choices.length} available</span></div>
          <button className="associate-cell-option" onClick={() => { onChange(''); setOpen(false) }}><Avatar className="avatar" name="?" color="#64748b" size={28} /><span><b>Unassigned</b><small>Clear current owner</small></span>{!lead.associateId && <Check size={14} />}</button>
          {choices.map(associate => <button key={associate.id} className="associate-cell-option" onClick={() => { onChange(associate.id); setOpen(false) }}>
            <Avatar className="avatar" name={associate.name} color={associate.color} photoUrl={associate.photoUrl} photoZoom={associate.photoZoom} photoPosX={associate.photoPosX} photoPosY={associate.photoPosY} size={28} fallback="👤" />
            <span><b>{associate.name}</b><small>{associate.role || 'Associate'}</small></span>
            {lead.associateId === associate.id && <Check size={14} />}
          </button>)}
        </div>
      </>, document.body)}
    </>
  )
}

function InlineRemark({ lead, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(lead.remarks || '')
  React.useEffect(() => { if (!editing) setDraft(lead.remarks || '') }, [lead.remarks, editing])
  const save = async () => {
    const next = draft.trim()
    setEditing(false)
    if (next !== (lead.remarks || '')) await onSave(next)
  }
  if (editing) return <textarea autoFocus className="inline-remark-editor" value={draft} onClick={e => e.stopPropagation()} onChange={e => setDraft(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Escape') { setDraft(lead.remarks || ''); setEditing(false) }; if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save() }} />
  return <button type="button" className="inline-remark-trigger" title={lead.remarks || 'Add remark'} onClick={e => { e.stopPropagation(); setEditing(true) }}><span>{lead.remarks || 'Add remark…'}</span><Pencil size={11} /></button>
}

function SortHead({ label, field, resizeId, width, style, onResize, onAutoFit, className = '', sortBy, sortDir, setSortBy, setSortDir, searchValue = '', onSearch, columnCountsQuery, lookup }) {
  const active = sortBy === field
  const nextDir = active && sortDir === 'asc' ? 'desc' : 'asc'
  const thStyle = style || { width, minWidth: width }
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef(null)
  useEffect(() => { if (searchOpen) searchRef.current?.focus() }, [searchOpen])
  const showSearch = searchOpen || !!searchValue
  const [countsOpen, setCountsOpen] = useState(false)
  const [counts, setCounts] = useState(null)
  const [countsLoading, setCountsLoading] = useState(false)
  const [countsExpanded, setCountsExpanded] = useState(true)
  const [countsPos, setCountsPos] = useState({ left: 0, top: 0 })
  const countsBtnRef = useRef(null)
  useEffect(() => {
    if (!countsOpen && !searchOpen) return
    const close = (event) => {
      if (event.key !== 'Escape') return
      setCountsOpen(false)
      setCountsExpanded(false)
      setSearchOpen(false)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [countsOpen, searchOpen])
  const openCounts = async () => {
    const rect = countsBtnRef.current?.getBoundingClientRect()
    if (rect) setCountsPos({ left: Math.min(rect.left, window.innerWidth - 276), top: Math.min(rect.bottom + 6, window.innerHeight - 300) })
    setCountsOpen(o => !o)
    if (counts || countsLoading) return
    setCountsLoading(true)
    try {
      const resp = await api.get(`/api/leads?${columnCountsQuery}&pageSize=5000`)
      const key = field === 'createdAt' ? 'created' : field
      const tally = new Map()
      for (const l of (resp?.items || [])) {
        const raw = baseColumnValue(key, l, lookup)
        const val = (raw === null || raw === undefined || raw === '') ? 'Blank' : String(raw)
        tally.set(val, (tally.get(val) || 0) + 1)
      }
      setCounts([...tally.entries()].sort((a, b) => b[1] - a[1]))
    } catch (e) { setCounts([]) }
    finally { setCountsLoading(false) }
  }
  const countsTotal = counts?.reduce((sum, [, n]) => sum + n, 0) || 0
  const countsPalette = ['#fb7185', '#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#f97316', '#22d3ee', '#e879f9', '#94a3b8']
  return (
    <th className={`resizable-th ${className} select-none`} style={thStyle}>
      <div className="th-head-row">
        <Tip content={`Sort by ${label}`}>
          <button type="button" className="th-sort-trigger" onClick={() => { setSortBy(field); setSortDir(nextDir) }}>
            <span>{label}</span>
            <ChevronDown size={11} className={`shrink-0 transition-transform ${active && sortDir === 'asc' ? 'rotate-180' : ''} ${active ? 'text-rose-400' : 'text-slate-500'}`} />
          </button>
        </Tip>
        {onSearch && (
          <Tip content={`Search ${label}`}>
            <button
              type="button"
              className={`th-search-toggle ${showSearch ? 'is-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSearchOpen(o => !o) }}
              aria-label={`Search ${label} column`}
            >
              <Search size={12} />
            </button>
          </Tip>
        )}
        {(
          <Tip content={`${label} value breakdown`}>
            <button
              ref={countsBtnRef}
              type="button"
              className={`th-search-toggle th-counts-toggle ${countsOpen ? 'is-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); openCounts() }}
              aria-label={`Value counts for ${label} column`}
            >
              <PieChart size={12} />
            </button>
          </Tip>
        )}
      </div>
      {countsOpen && createPortal(<>
        <button className="fixed inset-0 z-[108] cursor-default" aria-label="Close value counts" onClick={() => { setCountsOpen(false); setCountsExpanded(false) }} />
        <div className="column-counts-pop" style={{ position: 'fixed', left: countsPos.left, top: countsPos.top }} onClick={e => e.stopPropagation()}>
          <div className="column-counts-head">
            <span>{label} breakdown</span>
            <button type="button" className="btn btn-ghost !p-1" onClick={() => { setCountsOpen(false); setCountsExpanded(false) }}><X size={12} /></button>
          </div>
          {countsLoading && <div className="column-counts-loading"><Spinner size={16} /></div>}
          {!countsLoading && counts && counts.length === 0 && <div className="column-counts-empty">No data</div>}
          {!countsLoading && counts && counts.length > 0 && (
            <div className="column-counts-list">
              {counts.slice(0, countsExpanded ? counts.length : 12).map(([val, n], i) => (
                <div key={val} className="column-counts-row">
                  <span className="column-counts-label" title={val}>{val}</span>
                  <div className="column-counts-bar-track">
                    <div className="column-counts-bar" style={{ width: `${Math.max(4, Math.round((n / countsTotal) * 100))}%`, background: countsPalette[i % countsPalette.length] }} />
                  </div>
                  <span className="column-counts-count">{n}</span>
                </div>
              ))}
              {!countsExpanded && counts.length > 12 && (
                <button type="button" className="column-counts-more column-counts-more-btn" onClick={() => setCountsExpanded(true)}>+{counts.length - 12} more values</button>
              )}
            </div>
          )}
        </div>
      </>, document.body)}
      {onSearch && showSearch && (
        <div className="th-search-pop" onClick={e => e.stopPropagation()}>
          <input
            ref={searchRef}
            className="column-header-search"
            value={searchValue}
            onChange={e => onSearch(e.target.value)}
            onBlur={() => { if (!searchValue) setSearchOpen(false) }}
            onKeyDown={e => { if (e.key === 'Escape') { onSearch(''); setSearchOpen(false) } }}
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label} column`}
          />
        </div>
      )}
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
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[120]" onClick={onClose}>
      <div className="score-detail-popover" style={{ left, top }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          <ScorePill score={lead.ai?.score || 0} />
          <div className="min-w-0">
            <div className="text-base font-bold text-white truncate">{lead.fullName}</div>
            <div className="text-xs text-slate-500">Score calculation details</div>
          </div>
          <button className="ml-auto btn btn-ghost !p-1.5" onClick={onClose}><X size={12} /></button>
        </div>
        <div className="space-y-1.5">
          {factors.map(f => (
            <div key={f.label} className="score-factor-row">
              <span>{f.label}</span>
              <strong>{f.value === '—' ? <EmptyCell /> : f.value}</strong>
              <small>{f.detail}</small>
            </div>
          ))}
        </div>
        {lead.ai?.summary && <p className="mt-2 text-xs text-slate-400 leading-relaxed">{lead.ai.summary}</p>}
      </div>
    </div>,
    document.body
  )
}

function FuCell({ lead, fuIndex, forceMissed = false }) {
  const followUpItem = lead.followUps && lead.followUps[fuIndex];
  const comments = followUpText(followUpItem?.comments)
  const filled = Boolean(comments)
  const scheduledDate = followUpText(followUpItem?.date) || null
  const isDone = filled && followUpItem?.done !== false

  const today = new Date().toISOString().slice(0, 10)
  const isMissed = !filled && scheduledDate && scheduledDate !== '-' && scheduledDate < today && !isDone;

  const hasOverduePending = forceMissed || isMissed

  const channel = followUpItem && followUpItem.channel ? followUpItem.channel : 'other';
  const meta = channelMeta(channel)
  const Icon = meta.icon || MessageCircle
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
    ? 'border-emerald-400/50 bg-emerald-400/15'
    : hasOverduePending
      ? 'border-rose-400/50 bg-rose-400/15'
      : (scheduledDate && scheduledDate !== '-' ? 'border-sky-400/50 bg-sky-400/15' : 'border-white/8 bg-white/[0.03]')

  const iconColor = filled ? 'var(--fu-emerald)' : hasOverduePending ? 'var(--fu-rose)' : (scheduledDate && scheduledDate !== '-' ? 'var(--fu-sky, #38bdf8)' : 'var(--fu-slate)')
  const isEmpty = !filled && !hasOverduePending && !(scheduledDate && scheduledDate !== '-')

  const box = (
    <span
      ref={anchorRef}
      onClick={openPopover}
      className={`fu-cell-box inline-flex w-7 h-7 rounded-lg items-center justify-center border transition-all cursor-pointer ${boxClass}`}
    >
      {filled || (scheduledDate && scheduledDate !== '-')
        ? <Icon size={13} style={{ color: iconColor }} />
        : <XCircle size={13} style={{ color: iconColor }} />}
    </span>
  )

  return (
    <>
      {isEmpty ? box : (
        <Tip content={<FuTip lead={lead} followUpItem={followUpItem} isMissed={isMissed || hasOverduePending} />}>
          {box}
        </Tip>
      )}
      {popOpen && pos && createPortal(
        <QuickFollowUpPopover lead={lead} fuIndex={fuIndex} followUpItem={followUpItem} pos={pos} onClose={() => setPopOpen(false)} />,
        document.body
      )}
    </>
  )
}

// Lightweight click-triggered popover for logging a single follow-up without
// opening the full LeadDrawer. Posts to the same endpoint/payload shape as
// LeadDrawer's addFollowUp (see src/components/LeadDrawer.jsx ~line 87).
function QuickFollowUpPopover({ lead, fuIndex, followUpItem, pos, onClose }) {
  const { toast, refreshData } = useApp()
  const channelAssigned = followUpItem && followUpItem.channel ? followUpItem.channel : 'call'
  const [channel, setChannel] = useState(channelAssigned)
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
        channel,
        replaceId: followUpItem ? followUpItem.id : undefined // Custom arg so the backend can replace the pending item directly
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
          <span className="text-xs font-semibold text-white flex-1">Log follow-up</span>
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
          className="input !py-1.5 !text-sm"
          placeholder="Note / outcome…"
          value={comments}
          onChange={e => setComments(e.target.value)}
        />
        <button className="btn btn-primary !py-1.5 !text-sm w-full" type="submit" disabled={saving || !comments.trim()}>
          {saving ? 'Saving…' : 'Log follow-up'}
        </button>
      </form>
    </div>
  )
}

function FuTip({ lead, followUpItem, isMissed }) {
  const channel = followUpItem && followUpItem.channel ? followUpItem.channel : 'other';
  const comments = followUpText(followUpItem?.comments)
  const date = followUpText(followUpItem?.date)
  const meta = channelMeta(channel)
  return (
    <div className="space-y-1.5 min-w-[220px]">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}1e`, color: meta.color }}>
          <meta.icon size={12} />
        </span>
        <span className="text-sm font-bold text-white">{meta.label}</span>
        {isMissed && <span className="chip !px-1.5 !py-0.5 text-2xs bg-rose-500/20 text-rose-300">missed</span>}
        {comments && !isMissed && <span className="chip !px-1.5 !py-0.5 text-2xs bg-emerald-500/15 text-emerald-300">done</span>}
        {date && <span className="ml-auto text-xs text-slate-500 mono">{fmtDate(date)}</span>}
      </div>
      <div className="text-xs text-slate-400 leading-relaxed">{comments || `No ${meta.label} follow-up logged yet.`}</div>
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
                <div className="text-base font-semibold text-white truncate flex items-center gap-1.5">
                  {l.fullName}
                  {(l.flags || []).map(f => <span key={f.id} title={f.name} className="chip !px-1.5 !py-0 text-2xs" style={{ background: `${f.color}22`, color: f.color, border: `1px solid ${f.color}44` }}>{f.label}</span>)}
                </div>
                <div className="text-xs text-slate-500 truncate">{lookup.locById[l.locationId]?.name?.split(',')[0] || '—'}</div>
              </div>
              <ScorePill score={l.ai.score} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
              <span className={`chip !py-0.5 !px-2 text-xs ${riskClass(l.ai.risk)}`}>{l.ai.risk}</span>
              <span className={`chip stage-badge !py-0.5 !px-2 !w-auto !h-auto text-xs`} style={stageBadgeStyle(l.stage)}>{l.stage}</span>
              <span className="chip bg-white/5 border border-white/10 text-slate-400 !py-0.5 !px-2 text-xs">{l.sourceName}</span>
            </div>
            <div className="text-xs text-slate-400 truncate mb-2.5">{l.ai?.nextAction?.text}</div>
            <div className="flex items-center gap-2 border-t border-white/6 pt-2">
              <span className="text-xs text-slate-500 truncate flex-1">{owner ? owner.name : 'Unassigned'}</span>
              {Object.keys(CHANNELS).map(ch => {
                const filled = !!l.fu?.outreach?.[ch]?.filled
                const Icon = CHANNELS[ch].icon
                return (
                  <span key={ch} className={`inline-flex w-5 h-5 rounded-md items-center justify-center border ${filled ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-400' : 'border-white/8 bg-white/[0.03] text-slate-600'}`} title={`${CHANNELS[ch].label}: ${filled ? 'done' : 'not logged'}`}>
                    <Icon size={10} />
                  </span>
                )
              })}
              {nextFu && <span className="text-xs mono text-slate-500">{fmtDate(nextFu.date)}</span>}
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
                <span className="font-display text-base font-semibold text-white shrink-0">{g.key}</span>
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
              <div className="text-sm font-semibold text-white truncate">{l.fullName}</div>
              <div className="text-xs text-slate-500 truncate">{l.phone}</div>
            </div>
            <span className={`chip !py-0.5 !px-2 text-xs hidden sm:inline-flex ${riskClass(l.ai.risk)}`}>{l.ai.risk}</span>
            <span className="text-sm text-slate-400 w-[130px] truncate hidden md:block">{l.stage}</span>
            <span className="text-sm text-slate-400 w-[120px] truncate hidden lg:block">{owner?.name || 'Unassigned'}</span>
            <div className="flex items-center gap-1.5 ml-auto">
              {Object.keys(CHANNELS).map(ch => {
                const filled = !!l.fu?.outreach?.[ch]?.filled
                const Icon = CHANNELS[ch].icon
                return (
                  <span key={ch} className={`inline-flex w-5 h-5 rounded-md items-center justify-center border ${filled ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-400' : 'border-white/8 bg-white/[0.03] text-slate-600'}`}>
                    <Icon size={10} />
                  </span>
                )
              })}
              {nextFu && <span className={`text-xs mono ml-1 ${daysFromNow(nextFu.date) < 0 ? 'text-rose-400' : 'text-slate-500'}`}>{fmtDate(nextFu.date)}</span>}
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
  const stageStatusGroups = boot?.stageStatusGroups || {}
  const stageCols = { 'Pre-Trial': '#3b82f6', 'Unresponsive': '#94a3b8', 'Trial Scheduled': '#06b6d4', 'Trial Completed': '#10b981', 'Post-Trial Follow-up': '#f59e0b', 'Disqualified': '#64748b', 'Not Interested': '#f43f5e', 'Lost': '#71717a', 'Won': '#34d399' }
  const colorForStage = (stage) => stageCols[stageStatusGroups[stage]] || '#94a3b8'

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div className="card p-4">
        <h3 className="font-display font-semibold text-white text-base mb-3">Pipeline value</h3>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <Mini label="Open leads" value={open} color="#06b6d4" />
          <Mini label="Hot right now" value={hot} color="#fb7185" />
          <Mini label="Won" value={won} color="#34d399" />
          <Mini label="Lost" value={lost} color="#94a3b8" />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Est. pipeline</span>
          <span className="font-display font-bold text-white mono">{money(estValue)}</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-1.5">
          <span className="text-slate-400">Avg intent score</span>
          <span className="mono text-fuchsia-300 font-semibold">{avgScore}</span>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-display font-semibold text-white text-base mb-3">Stage distribution</h3>
        <div className="space-y-2">
          {Object.entries(byStage).map(([stage, count]) => (
            <div key={stage} className="flex items-center gap-2 text-sm">
              <span className="w-[120px] text-slate-400 truncate">{stage}</span>
              <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(count / maxStage) * 100}%`, background: colorForStage(stage) }} />
              </div>
              <span className="mono text-slate-300 w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-display font-semibold text-white text-base mb-3">Source mix</h3>
        <div className="space-y-2">
          {Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
            <div key={src} className="flex items-center gap-2 text-sm">
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
        <h3 className="font-display font-semibold text-white text-base mb-3">Owner load</h3>
        <div className="space-y-2">
          {Object.entries(byOwner).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
            <div key={name} className="flex items-center gap-2 text-sm">
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
      <div className="font-display text-lg font-bold mono" style={{ color }}>{value}</div>
      <div className="text-xs uppercase tracking-wider text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

function KanbanView({ items, boot, lookup, openLead, changeStage, changeLeadField, groupBy }) {
  const field = groupBy || 'stage'
  const [dragOver, setDragOver] = useState('')
  const descriptors = useMemo(() => {
    if (field === 'stage') return (boot?.stages || []).map(value => ({ value, label: value }))
    if (field === 'locationId') return [...(boot?.locations || []).filter(x => x.active !== false).map(x => ({ value: x.id, label: x.name })), { value: '', label: 'Unassigned' }]
    if (field === 'associateId') return [...(boot?.associates || []).filter(x => x.active !== false).map(x => ({ value: x.id, label: x.name })), { value: '', label: 'Unassigned' }]
    if (field === 'status') return ['open', 'won', 'lost'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))
    const values = [...new Set(items.map(l => field === 'risk' ? (l.ai?.risk || 'cold') : (l[field] || 'Unknown')))]
    return values.map(value => ({ value, label: value }))
  }, [field, boot, items])
  const valueFor = lead => {
    if (field === 'risk') return lead.ai?.risk || 'cold'
    return lead[field] || (field === 'locationId' || field === 'associateId' ? '' : 'Unknown')
  }
  const cols = descriptors.map(col => ({ ...col, leads: items.filter(l => String(valueFor(l)) === String(col.value)) }))
  const moveLead = async (leadId, value) => {
    const lead = items.find(item => String(item.id) === String(leadId))
    if (!lead || String(valueFor(lead)) === String(value)) return
    if (field === 'stage') await changeStage(lead, value)
    else if (field === 'risk') await changeLeadField(lead, { ai: { ...(lead.ai || {}), risk: value } })
    else await changeLeadField(lead, { [field]: value || null })
  }
  return (
    <div className="kanban-board flex gap-3 overflow-x-auto scrollbar-thin pb-2 -mx-1 px-1">
      {cols.map(col => (
        <div key={String(col.value)} className={`kanban-column flex flex-col w-[240px] shrink-0 rounded-2xl bg-white/[0.03] border border-white/6 ${dragOver === String(col.value) ? 'is-drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(String(col.value)) }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver('') }}
          onDrop={e => { e.preventDefault(); const leadId = e.dataTransfer.getData('text/lead-id'); setDragOver(''); moveLead(leadId, col.value) }}>
          <div className="px-3 py-2.5 flex items-center gap-2">
            <span className={`pipeline-stage-badge ${field === 'stage' ? stageClass(col.label) : ''}`} style={field === 'stage' ? stageBadgeStyle(col.label) : undefined} title={col.label}>{col.label}</span>
            <span className="ml-auto chip bg-white/6 border border-white/10 text-slate-400 mono !py-0.5 !px-2 text-xs">{col.leads.length}</span>
          </div>
          <div className="flex-1 px-2 pb-2 space-y-2 max-h-[560px] overflow-y-auto scrollbar-thin">
            {col.leads.map(l => {
              const owner = lookup.asnById[l.associateId]
              return (
                <div key={l.id} draggable className="kanban-lead-card card card-hover !rounded-xl p-3 cursor-grab active:cursor-grabbing" onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/lead-id', String(l.id)) }} onDragEnd={() => setDragOver('')} onClick={() => openLead(l.id)}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Avatar name={l.fullName} color={owner?.color} size={26} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate flex items-center gap-1">
                        {l.fullName}
                        {(l.flags || []).map(f => <span key={f.id} title={f.name} className="chip !px-1 !py-0 text-2xs" style={{ background: `${f.color}22`, color: f.color, border: `1px solid ${f.color}44` }}>{f.label}</span>)}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{owner?.name || 'Unassigned'}</div>
                    </div>
                    <ScorePill score={l.ai.score} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {Object.keys(CHANNELS).map(ch => {
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
            {!col.leads.length && <div className="text-xs text-slate-600 text-center py-5">No leads</div>}
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
            <span className="font-display font-semibold text-white text-base">{new Date(month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
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
                    <div className="text-sm font-semibold text-white truncate">{l.fullName}</div>
                    <div className="text-xs text-slate-500 truncate">{l.ai?.nextAction?.text}</div>
                  </div>
                  <span className={`chip !py-0.5 !px-2 text-xs ${stageClass(l.stage)}`} style={stageBadgeStyle(l.stage)}>{l.stage}</span>
                  <span className="text-xs text-slate-500 mono hidden sm:block">{fmtDate(l.createdAt)}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Filter({ label, value, onChange, children, disabled }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 block">{label}</label>
      <select className="input !py-1.5" value={value} onChange={onChange} disabled={disabled}>{children}</select>
    </div>
  )
}
