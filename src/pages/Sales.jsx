// Live sales dashboard over the cached Momence total-sales report.
//
// The table's row is a payment split (one row per way a sale was paid for),
// because that is the only grain at which "how was this paid" is answerable
// and because splits partition a sale, so nothing double counts. Sale-level
// aggregates always come from salesModel, never from ad-hoc sums here.
//
// Charts reuse the report kit's ChartFrame, so colour comes from the
// validated palette and both themes stay selected rather than flipped.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshCw, Search, Download, ChevronRight, ChevronDown, X, IndianRupee, Receipt,
  Users, Percent, Undo2, Wallet, Layers, Database, Filter, SlidersHorizontal, Tag,
  TrendingUp, Landmark
} from 'lucide-react'
import { api, buildQuery } from '../api.js'
import { useApp } from '../store.jsx'
import { Spinner, Empty, TableSkeleton } from '../ui.jsx'
import { Section, Segmented, ChartFrame, csvRows } from '../components/report/kit.jsx'
import MemberProfileModal from '../components/MemberProfileModal.jsx'
import { money, fmtDateTime } from '../lib.js'
import { salesKpis, groupSales, trendByDay, filterSales, distinctValues, istDay, GROUPINGS } from './salesModel.js'
import { ITEM_GROUPS } from './salesItems.js'
import { monthsInRange, planFetch, dedupeRows } from './salesCachePlan.js'
import { cachedMonths, readMonths, writeMonth, clearCache } from './salesLocalCache.js'

const MARKET_LABELS = { mumbai: 'Mumbai', blr: 'Bengaluru' }

const FILTER_FIELDS = [
  { field: 'market', label: 'Market', format: value => MARKET_LABELS[value] || value },
  { field: 'itemGroup', label: 'Item group' },
  { field: 'location', label: 'Location' },
  { field: 'paymentCategory', label: 'Category' },
  { field: 'membershipType', label: 'Membership type' },
  { field: 'splitPaymentMethod', label: 'Payment method' },
  { field: 'soldBy', label: 'Sold by' },
  { field: 'paymentStatus', label: 'Status' }
]

// Every column the table can show. `detail: true` ones are off by default —
// the report carries far more fields than fit a screen, and they are all
// still there in the row drawer and in the CSV export.
const COLUMNS = [
  { key: 'paymentDate', label: 'Paid at', width: 150, format: row => fmtDateTime(row.paymentDate) },
  { key: 'customerName', label: 'Customer', width: 180 },
  { key: 'itemName', label: 'Item', width: 210 },
  { key: 'itemGroup', label: 'Group', width: 150, format: row => <span className="sales-tag" data-tone={GROUP_TONES[row.itemGroup] ?? 8}>{row.itemGroup || '—'}</span> },
  { key: 'paymentCategory', label: 'Category', width: 110, detail: true },
  { key: 'paymentItem', label: 'Item (raw)', width: 240, detail: true },
  { key: 'itemTerm', label: 'Term', width: 100, detail: true },
  { key: 'location', label: 'Location', width: 180 },
  { key: 'splitPaymentMethod', label: 'Method', width: 130 },
  { key: 'paidInCurrency', label: 'Paid', width: 110, align: 'right', numeric: true, format: row => money(row.paidInCurrency) },
  { key: 'splitPaidInMoneyCredits', label: 'Credits', width: 110, align: 'right', numeric: true, format: row => money(row.splitPaidInMoneyCredits) },
  { key: 'paymentValue', label: 'Sale value', width: 120, align: 'right', numeric: true, format: row => (row.isPrimarySplit ? money(row.paymentValue) : <span className="sales-muted">—</span>) },
  { key: 'discountCode', label: 'Discount', width: 130, format: row => (row.discountCode ? <span className="sales-tag is-discount">{row.discountCode}</span> : <span className="sales-muted">—</span>) },
  { key: 'discountAmount', label: 'Disc. value', width: 115, align: 'right', numeric: true, format: row => (row.discountAmount ? money(row.discountAmount) : <span className="sales-muted">—</span>) },
  { key: 'grossBeforeDiscount', label: 'List price', width: 115, align: 'right', numeric: true, detail: true, format: row => (row.grossBeforeDiscount ? money(row.grossBeforeDiscount) : <span className="sales-muted">—</span>) },
  { key: 'discountType', label: 'Disc. type', width: 110, detail: true },
  { key: 'paymentSource', label: 'Sold through', width: 150, detail: true },
  { key: 'processorFeeHost', label: 'Processor fee', width: 125, align: 'right', numeric: true, detail: true, format: row => (row.processorFeeHost ? money(row.processorFeeHost) : <span className="sales-muted">—</span>) },
  { key: 'soldBy', label: 'Sold by', width: 200, detail: true },
  { key: 'membershipType', label: 'Membership type', width: 150, detail: true },
  { key: 'paymentStatus', label: 'Status', width: 110, detail: true },
  { key: 'refunded', label: 'Refunded', width: 110, align: 'right', numeric: true, detail: true, format: row => (row.refunded ? money(row.refunded) : <span className="sales-muted">—</span>) },
  { key: 'splitVatAmount', label: 'Tax', width: 100, align: 'right', numeric: true, detail: true, format: row => money(row.splitVatAmount) },
  { key: 'customerEmail', label: 'Email', width: 220, detail: true },
  { key: 'memberId', label: 'Member ID', width: 110, detail: true },
  { key: 'saleReference', label: 'Reference', width: 140, detail: true },
  { key: 'market', label: 'Market', width: 110, detail: true, format: row => MARKET_LABELS[row.market] || row.market }
]

const DEFAULT_COLUMNS = COLUMNS.filter(column => !column.detail).map(column => column.key)

// The order groups render in, so a filter that drops one never reshuffles the
// rest. Matches ITEM_GROUPS.
const GROUP_TONES = Object.fromEntries(ITEM_GROUPS.map((group, index) => [group, index % 8]))

// Twelve cards, six to a row. The ones with a `series` are also the chart's
// selectable measures: clicking a card re-plots the trend below it, so the
// headline number and the shape behind it are never separate questions.
const METRICS = [
  { key: 'netRevenue', label: 'Net revenue', icon: IndianRupee, tone: 'emerald',
    value: k => money(k.netRevenue), detail: k => `${money(k.grossRevenue)} gross`,
    series: [{ key: 'netRevenue', label: 'Net of refunds' }, { key: 'grossRevenue', label: 'Gross' }] },
  { key: 'grossRevenue', label: 'Gross revenue', icon: TrendingUp, tone: 'emerald',
    value: k => money(k.grossRevenue), detail: (k, d) => `${money(d.dailyAverage)} per day`,
    series: [{ key: 'grossRevenue', label: 'Gross revenue' }] },
  { key: 'transactions', label: 'Transactions', icon: Receipt, tone: 'blue',
    value: k => k.transactions.toLocaleString('en-IN'), detail: k => `${k.splits.toLocaleString('en-IN')} payment splits`,
    money: false, series: [{ key: 'transactions', label: 'Sales' }] },
  { key: 'uniqueMembers', label: 'Unique members', icon: Users, tone: 'blue',
    value: k => k.uniqueMembers.toLocaleString('en-IN'), detail: (k, d) => `${d.salesPerMember} sales each`,
    money: false, series: [{ key: 'uniqueMembers', label: 'Members buying' }] },
  { key: 'averageTransactionValue', label: 'Avg transaction', icon: Percent, tone: 'violet',
    value: k => money(k.averageTransactionValue), detail: k => `across ${k.transactions.toLocaleString('en-IN')} sales`,
    series: [{ key: 'averageTransactionValue', label: 'ATV' }] },
  { key: 'averageRevenuePerMember', label: 'Revenue / member', icon: Users, tone: 'violet',
    value: k => money(k.averageRevenuePerMember), detail: k => `${k.uniqueMembers.toLocaleString('en-IN')} members`,
    series: [{ key: 'averageRevenuePerMember', label: 'Revenue per member' }] },
  { key: 'paidInCurrency', label: 'Paid in currency', icon: Wallet, tone: 'blue',
    value: k => money(k.paidInCurrency), detail: (k, d) => `${d.currencyShare} of collections`,
    series: [{ key: 'paidInCurrency', label: 'Currency' }] },
  { key: 'paidInMoneyCredits', label: 'Paid in credits', icon: Layers, tone: 'violet',
    value: k => money(k.paidInMoneyCredits), detail: (k, d) => `${d.creditShare} of collections`,
    series: [{ key: 'paidInMoneyCredits', label: 'Credits' }] },
  { key: 'discount', label: 'Discounts given', icon: Tag, tone: 'amber',
    value: k => money(k.discount), detail: k => `${k.discountedTransactions} sale${k.discountedTransactions === 1 ? '' : 's'} · ${money(k.listRevenue)} at list`,
    series: [{ key: 'discount', label: 'Discount given' }] },
  { key: 'refunded', label: 'Refunds', icon: Undo2, tone: k => (k.refunded ? 'rose' : 'emerald'),
    value: k => money(k.refunded), detail: k => `${k.refundedTransactions} transaction${k.refundedTransactions === 1 ? '' : 's'}`,
    series: [{ key: 'refunded', label: 'Refunded' }] },
  { key: 'vat', label: 'Tax collected', icon: Landmark, tone: 'amber',
    value: k => money(k.vat), detail: (k, d) => `${d.taxShare} of gross`,
    series: [{ key: 'vat', label: 'Tax' }] },
  { key: 'coverage', label: 'Discount detail', icon: Database, tone: 'blue',
    value: (k, d) => d.enrichedShare, detail: (k, d) => `${d.enrichedRows.toLocaleString('en-IN')} of ${d.totalRows.toLocaleString('en-IN')} rows priced` }
]

const PRESETS = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-90', label: 'Last 90 days' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last-year', label: 'Last year' },
  { id: 'all', label: 'All time' }
]

const iso = date => date.toISOString().slice(0, 10)

function presetRange(preset) {
  const today = new Date()
  const day = istDay(today.toISOString())
  const [year, month] = day.split('-').map(Number)
  switch (preset) {
    case 'last-month': {
      const from = new Date(Date.UTC(month === 1 ? year - 1 : year, month === 1 ? 11 : month - 2, 1))
      const to = new Date(Date.UTC(year, month - 1, 0))
      return { from: iso(from), to: iso(to) }
    }
    case 'last-90': {
      const from = new Date(today.getTime() - 89 * 86400000)
      return { from: iso(from), to: day }
    }
    case 'ytd': return { from: `${year}-01-01`, to: day }
    case 'last-year': return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
    case 'all': return { from: '', to: '' }
    case 'this-month':
    default: return { from: `${day.slice(0, 7)}-01`, to: day }
  }
}

const pct = value => `${Math.round((value || 0) * 1000) / 10}%`

/* ── Metric card ──────────────────────────────────────────────
   Same anatomy as the lead drawer's Momence metrics (icon chip, uppercase
   label, big value, detail line, tinted corner wash) so a number means the
   same thing and looks the same wherever it appears in the app. */
function Metric({ icon: Icon, label, value, detail, tone, onClick, active, disabled }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`momence-metric tone-${tone} ${onClick && !disabled ? 'is-clickable' : ''} ${active ? 'is-active' : ''}`}
      onClick={disabled ? undefined : onClick}
      aria-pressed={onClick ? Boolean(active) : undefined}
    >
      <span className="momence-metric-icon"><Icon size={15} /></span>
      <div className="momence-metric-label">{label}</div>
      <div className="momence-metric-value" title={String(value)}>{value}</div>
      <div className="momence-metric-detail">{detail}</div>
    </Tag>
  )
}

/* ── Multi-select filter chip ─────────────────────────────── */
function FilterMenu({ label, options, selected, onChange, format }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const toggle = value => onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])

  return (
    <div className="sales-filter" ref={ref}>
      <button type="button" className={`sales-filter-btn ${selected.length ? 'is-active' : ''}`} onClick={() => setOpen(o => !o)}>
        {label}
        {selected.length > 0 && <span className="sales-filter-count">{selected.length}</span>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="sales-filter-menu scrollbar-thin">
          {!options.length && <div className="sales-filter-empty">Nothing to filter on</div>}
          {options.map(option => (
            <label key={option} className="sales-filter-option">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              <span>{format ? format(option) : option}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" className="sales-filter-clear" onClick={() => onChange([])}>Clear</button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Expanded transaction detail ──────────────────────────── */
// Sections rather than one flat dump: what was sold, how it was paid, what was
// taken off, and the raw identifiers underneath. Discount and fee detail is
// not in the sales report, so the first time a row is opened its transaction
// is fetched (and cached server-side from then on).
const DETAIL_SECTIONS = [
  { title: 'Sale', fields: ['paymentDate', 'serviceDate', 'customerName', 'customerEmail', 'memberId', 'paymentItem', 'itemGroup', 'itemTerm', 'itemSize', 'paymentCategory', 'membershipType', 'quantity', 'paymentValue', 'paymentVat', 'refunded', 'paymentStatus', 'soldBy', 'location', 'market'] },
  { title: 'Discount', fields: ['discountCode', 'discountType', 'discountAmount', 'discountAmountExcludingTax', 'grossBeforeDiscount', 'discountCodeId', 'priceRuleId', 'unitPriceExcludingTax', 'unitTaxAmount'] },
  { title: 'Transaction', fields: ['paymentSource', 'purchaseType', 'paidInCurrencyTotal', 'paidInMoneyCreditsTotal', 'paidInEventCredits', 'processorFeeHost', 'processorFeeCustomer', 'platformFeeHost', 'platformFeeCustomer', 'usedMembershipName', 'usedMembershipType', 'usedGiftCardCode', 'customPaymentMethod', 'isApplePay', 'isGooglePay', 'failureReason', 'refundedInCurrency', 'refundCount', 'lastRefundAt'] },
  { title: 'Linked records', fields: ['paymentTransactionId', 'saleItemId', 'saleId', 'saleReference', 'boughtMembershipId', 'membershipId', 'sessionId', 'sessionBookingId', 'sessionName', 'sessionStartsAt', 'appointmentName', 'productId', 'productOrderId', 'variantId', 'productName', 'productVariant', 'openArea', 'targetMemberId', 'targetMemberName', 'stripeToken', 'isBookingCancelled'] }
]

const MONEY_FIELDS = new Set(['paymentValue', 'paymentVat', 'refunded', 'discountAmount', 'discountAmountExcludingTax', 'grossBeforeDiscount', 'unitPriceExcludingTax', 'unitTaxAmount', 'paidInCurrencyTotal', 'paidInMoneyCreditsTotal', 'processorFeeHost', 'processorFeeCustomer', 'platformFeeHost', 'platformFeeCustomer', 'refundedInCurrency'])
const DATE_FIELDS = new Set(['paymentDate', 'serviceDate', 'sessionStartsAt', 'lastRefundAt'])

const LABELS = {
  paymentDate: 'Paid at', serviceDate: 'Service date', salePaidInMoneyCredits: 'Sale credits',
  paidInCurrencyTotal: 'Transaction paid', paidInMoneyCreditsTotal: 'Transaction credits',
  processorFeeHost: 'Processor fee (studio)', processorFeeCustomer: 'Processor fee (customer)',
  platformFeeHost: 'Platform fee (studio)', platformFeeCustomer: 'Platform fee (customer)',
  grossBeforeDiscount: 'List price', discountAmountExcludingTax: 'Discount ex-tax'
}

const humanise = key => LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).replace(/ Id\b/, ' ID')

function detailValue(key, value) {
  if (value === null || value === undefined || value === '') return null
  if (MONEY_FIELDS.has(key)) return money(value)
  if (DATE_FIELDS.has(key)) return fmtDateTime(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function RowDetail({ row, siblings, onOpenMember }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  // Only rows the background pass has not reached yet need a fetch.
  useEffect(() => {
    if (row.enriched || !row.paymentTransactionId) return
    let alive = true
    setLoading(true)
    api.get(`/api/sales/transactions/${row.paymentTransactionId}?${buildQuery({ market: row.market })}`)
      .then(data => {
        if (!alive) return
        const entry = data.transaction
        setDetail({ ...(entry?.transaction || {}), ...(entry?.bySaleItem?.[String(row.saleItemId)] || {}) })
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [row.enriched, row.paymentTransactionId, row.saleItemId, row.market])

  const full = useMemo(() => ({ ...row, ...(detail || {}) }), [row, detail])
  const splitTotal = siblings.reduce((sum, split) => sum + split.paidInCurrency + split.splitPaidInMoneyCredits, 0)

  return (
    <div className="sales-detail">
      <div className="sales-detail-head">
        <div className="sales-detail-title">
          <strong>{full.itemName || full.paymentItem || 'Sale'}</strong>
          <small>
            {fmtDateTime(full.paymentDate)} · ref {full.saleReference || full.paymentTransactionId}
            {full.itemGroup ? ` · ${full.itemGroup}` : ''}
          </small>
        </div>
        {loading && <Spinner size={13} />}
        {full.discountCode && (
          <span className="sales-tag is-discount">{full.discountCode} · −{money(full.discountAmount)}</span>
        )}
        {full.memberId != null && (
          <button type="button" className="sales-link-btn" onClick={() => onOpenMember(full)}>
            Member profile <ChevronRight size={12} />
          </button>
        )}
      </div>

      <div className="sales-detail-block">
        <h5>Payment splits <span>{siblings.length} · {money(splitTotal)}</span></h5>
        <div className="sales-nested-wrap">
          <table className="sales-nested">
            <thead>
              <tr><th>Method</th><th className="is-right">Paid</th><th className="is-right">Credits</th><th className="is-right">Tax</th><th className="is-right">Share</th><th>Membership used</th></tr>
            </thead>
            <tbody>
              {siblings.map(split => (
                <tr key={split.id} className={split.id === row.id ? 'is-current' : ''}>
                  <td>{split.splitPaymentMethod || '—'}</td>
                  <td className="is-right">{money(split.paidInCurrency)}</td>
                  <td className="is-right">{money(split.splitPaidInMoneyCredits)}</td>
                  <td className="is-right">{money(split.splitVatAmount)}</td>
                  <td className="is-right">{split.paymentMethodWeight == null ? '—' : `${Math.round(split.paymentMethodWeight * 100)}%`}</td>
                  <td>{split.splitMembershipName || split.splitMembershipType || full.usedMembershipName || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="is-right">{money(siblings.reduce((sum, s) => sum + s.paidInCurrency, 0))}</td>
                <td className="is-right">{money(siblings.reduce((sum, s) => sum + s.splitPaidInMoneyCredits, 0))}</td>
                <td className="is-right">{money(siblings.reduce((sum, s) => sum + s.splitVatAmount, 0))}</td>
                <td className="is-right">100%</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {DETAIL_SECTIONS.map(section => {
        const entries = section.fields
          .map(field => [field, detailValue(field, full[field])])
          .filter(([, value]) => value !== null)
        if (!entries.length) return null
        return (
          <div key={section.title} className="sales-detail-block">
            <h5>{section.title}</h5>
            <div className="sales-detail-fields">
              {entries.map(([field, value]) => (
                <div key={field} className="sales-detail-field">
                  <small>{humanise(field)}</small>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Sales() {
  const { toast } = useApp()
  const [preset, setPreset] = useState('this-month')
  const [range, setRange] = useState(() => presetRange('this-month'))
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0, truncated: false })
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchingMonths, setFetchingMonths] = useState(0)
  const [enriching, setEnriching] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({})
  const [groupBy, setGroupBy] = useState('paymentItem')
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_COLUMNS)
  const [showColumns, setShowColumns] = useState(false)
  const [sort, setSort] = useState({ key: 'paymentDate', dir: 'desc' })
  const [expanded, setExpanded] = useState(null)
  const [expandedGroup, setExpandedGroup] = useState(null)
  const [chartMetric, setChartMetric] = useState('netRevenue')
  const [limit, setLimit] = useState(100)
  const [member, setMember] = useState(null)

  const loadStatus = useCallback(async () => {
    try {
      const next = await api.get('/api/sales/status')
      setStatus(next)
      return next
    } catch { return null }
  }, [])

  // Rows are cached per calendar month in IndexedDB. A closed month is fetched
  // once, ever; only the month in progress is re-requested, and even that is
  // trusted for a couple of minutes. So the second visit to this page is one
  // small request rather than a re-download of the whole history.
  const load = useCallback(async ({ force = false } = {}) => {
    setError('')
    const state = await loadStatus()
    const coverage = {
      earliest: Object.values(state?.markets || {}).map(m => m.earliestMonth).filter(Boolean).sort()[0],
      latest: Object.values(state?.markets || {}).map(m => m.latestMonth).filter(Boolean).sort().slice(-1)[0]
    }
    const months = monthsInRange(range.from, range.to, coverage)
    if (!months.length) { setRows([]); setLoading(false); return }

    try {
      const cached = await cachedMonths()
      const { rows: cachedRows, fetchedAt, enriched } = await readMonths(months.filter(month => cached.includes(month)))
      const currentMonth = state?.currentMonth || months[months.length - 1]
      const plan = planFetch({
        months, cached, currentMonth, force,
        liveFetchedAt: fetchedAt[currentMonth],
        enrichedNow: state?.enrichedTransactions || 0,
        enrichedByMonth: enriched
      })

      // Show what is already on the device immediately; the network fills in
      // the gaps behind it.
      const byMonth = new Map()
      for (const row of cachedRows) {
        if (!byMonth.has(row.month)) byMonth.set(row.month, [])
        byMonth.get(row.month).push(row)
      }
      if (plan.reuse.length) {
        setRows(dedupeRows(plan.reuse.flatMap(month => byMonth.get(month) || [])))
        setLoading(false)
      }

      if (plan.fetch.length) {
        setFetchingMonths(plan.fetch.length)
        // In chunks, so a year-wide range streams in rather than blocking on
        // one enormous response.
        for (let index = 0; index < plan.fetch.length; index += 3) {
          const chunk = plan.fetch.slice(index, index + 3)
          const data = await api.get(`/api/sales/months?${buildQuery({ months: chunk.join(','), refresh: force ? undefined : '0' })}`)
          for (const [month, monthRows] of Object.entries(data.months || {})) {
            byMonth.set(month, monthRows)
            // The live month is written too — it is re-fetched on age, not on
            // absence, so caching it saves the repeat within a session.
            writeMonth(month, monthRows, data.enrichedTransactions)
          }
          setRows(dedupeRows(months.flatMap(month => byMonth.get(month) || [])))
          setFetchingMonths(plan.fetch.length - Math.min(plan.fetch.length, index + 3))
        }
      } else {
        setRows(dedupeRows(months.flatMap(month => byMonth.get(month) || [])))
      }
      const total = months.reduce((sum, month) => sum + (byMonth.get(month)?.length || 0), 0)
      setMeta({ total, truncated: false })
    } catch (e) {
      setError(e.message || 'Could not load sales')
    } finally {
      setFetchingMonths(0)
      setLoading(false)
    }
  }, [range.from, range.to, loadStatus])

  useEffect(() => { setLoading(true); load() }, [load])

  // While the server is still backfilling, its coverage grows under the page.
  // Poll the cheap status endpoint and reload only when the row count moved.
  useEffect(() => {
    const done = status?.backfill && Object.values(status.backfill).length && Object.values(status.backfill).every(state => state?.done)
    if (done && !status?.running) return
    const timer = setInterval(async () => {
      const next = await api.get('/api/sales/status').catch(() => null)
      if (!next) return
      setStatus(previous => {
        if (previous && next.rows !== previous.rows) load()
        return next
      })
    }, 20000)
    return () => clearInterval(timer)
  }, [status?.running, status?.backfill, load])

  const refresh = async ({ backfill = false } = {}) => {
    setRefreshing(true)
    try {
      await api.post('/api/sales/refresh', backfill ? { backfill: true, maxMonths: 12 } : {})
      await load({ force: backfill })
      toast?.(backfill ? 'Backfilled another year of sales' : 'Sales refreshed from Momence')
    } catch (e) {
      toast?.(e.message || 'Refresh failed', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  // Discount detail is one Momence call per transaction, so the background
  // pass fills it in slowly. This asks for the visible range now.
  const enrichRange = async () => {
    setEnriching(true)
    try {
      const { result } = await api.post('/api/sales/enrich', { from: range.from, to: range.to, limit: 600 })
      await clearCache()
      await load({ force: true })
      toast?.(result.remaining
        ? `Fetched ${result.fetched} transactions — ${result.remaining} still to go, run it again`
        : `Discount detail complete for this range (${result.fetched} fetched)`)
    } catch (e) {
      toast?.(e.message || 'Could not fetch discount detail', 'error')
    } finally {
      setEnriching(false)
    }
  }

  const rebuildCache = async () => {
    await clearCache()
    setLoading(true)
    await load({ force: true })
    toast?.('Local cache rebuilt')
  }

  const applyPreset = id => { setPreset(id); setRange(presetRange(id)) }

  const filtered = useMemo(() => filterSales(rows, { ...filters, search }), [rows, filters, search])
  const kpis = useMemo(() => salesKpis(filtered), [filtered])
  const groups = useMemo(() => groupSales(filtered, groupBy), [filtered, groupBy])
  const trend = useMemo(() => trendByDay(filtered), [filtered])
  const options = useMemo(() => {
    const out = {}
    // Options come from the unfiltered rows so a filter never hides its own
    // alternatives once applied.
    for (const { field } of FILTER_FIELDS) out[field] = distinctValues(rows, field)
    return out
  }, [rows])

  // Splits of one sale are indexed by their sale, so a parent row can expand
  // into its own children rather than each payment method being a top-level
  // row competing with the sale it belongs to.
  const splitsBySale = useMemo(() => {
    const index = new Map()
    for (const row of filtered) {
      const key = `${row.paymentTransactionId}:${row.saleItemId}`
      if (!index.has(key)) index.set(key, [])
      index.get(key).push(row)
    }
    return index
  }, [filtered])

  const parents = useMemo(() => {
    // A filter can hide a sale's primary split (filtering to "cash" when the
    // cash part is the second split); the first surviving split then stands in
    // for the sale, so the row never disappears entirely.
    const seen = new Set()
    const out = []
    for (const row of filtered) {
      const key = `${row.paymentTransactionId}:${row.saleItemId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(splitsBySale.get(key).find(split => split.isPrimarySplit) || row)
    }
    return out
  }, [filtered, splitsBySale])

  const sorted = useMemo(() => {
    const column = COLUMNS.find(c => c.key === sort.key)
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...parents].sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key]
      if (column?.numeric) return ((Number(va) || 0) - (Number(vb) || 0)) * dir
      if (sort.key === 'paymentDate') return (new Date(va) - new Date(vb)) * dir
      return String(va ?? '').localeCompare(String(vb ?? '')) * dir
    })
  }, [parents, sort])

  const page = useMemo(() => sorted.slice(0, limit), [sorted, limit])
  const columns = useMemo(() => COLUMNS.filter(column => visibleColumns.includes(column.key)), [visibleColumns])
  const splitsOf = useCallback(
    row => splitsBySale.get(`${row.paymentTransactionId}:${row.saleItemId}`) || [row],
    [splitsBySale]
  )
  const toggleGroup = key => setExpandedGroup(previous => (previous === key ? null : key))

  // The largest sales inside one breakdown group, for its child rows.
  const groupChildren = useCallback(key => {
    // Same bucketing rule groupSales uses, so a group's children are exactly
    // the sales its numbers were computed from.
    const bucketOf = row => {
      const value = row?.[groupBy]
      return value === null || value === undefined || value === '' ? 'Unspecified' : String(value)
    }
    return parents
      .filter(row => bucketOf(row) === key)
      .sort((a, b) => b.paymentValue - a.paymentValue)
      .slice(0, 8)
  }, [parents, groupBy])

  const rowKey = row => `${row.paymentTransactionId}:${row.saleItemId}`
  const toggleRow = row => setExpanded(previous => (previous === rowKey(row) ? null : rowKey(row)))

  const exportCsv = () => {
    const keys = [...new Set([...COLUMNS.map(c => c.key), ...Object.keys(sorted[0] || {})])]
    const csv = csvRows([keys, ...sorted.map(row => keys.map(key => row[key]))])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `momence-sales-${range.from || 'all'}-${range.to || 'now'}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Everything a card's detail line needs that is not a raw KPI.
  const derived = useMemo(() => {
    const collections = kpis.paidInCurrency + kpis.paidInMoneyCredits
    const enrichedRows = filtered.filter(row => row.enriched).length
    const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—')
    return {
      dailyAverage: trend.length ? kpis.grossRevenue / trend.length : 0,
      salesPerMember: kpis.uniqueMembers ? (kpis.transactions / kpis.uniqueMembers).toFixed(1) : '0',
      currencyShare: share(kpis.paidInCurrency, collections),
      creditShare: share(kpis.paidInMoneyCredits, collections),
      taxShare: share(kpis.vat, kpis.grossRevenue),
      enrichedRows,
      totalRows: filtered.length,
      enrichedShare: share(enrichedRows, filtered.length)
    }
  }, [kpis, trend, filtered])

  const activeMetric = useMemo(
    () => METRICS.find(metric => metric.key === chartMetric && metric.series) || METRICS[0],
    [chartMetric]
  )

  const activeFilterCount = Object.values(filters).reduce((sum, values) => sum + (values?.length || 0), 0)
  const backfillLine = useMemo(() => {
    if (!status?.backfill) return null
    const parts = Object.entries(status.backfill).map(([market, state]) => {
      if (state?.done) return `${MARKET_LABELS[market] || market} complete from ${state.earliestMonth || '—'}`
      return `${MARKET_LABELS[market] || market} back to ${state?.cursor || '—'}`
    })
    return parts.join(' · ')
  }, [status])

  return (
    <div className="page sales-page">
      <header className="sales-head">
        <div>
          <h2>Live sales</h2>
          <p>
            Every Momence transaction across both hosts, split by how it was paid.
            {status?.rows ? ` ${status.rows.toLocaleString('en-IN')} rows cached.` : ''}
          </p>
        </div>
        <div className="sales-head-actions">
          {status && (
            <span className={`sales-live ${status.running || fetchingMonths ? 'is-running' : ''}`}>
              <span className="sales-live-dot" />
              {fetchingMonths
                ? `Loading ${fetchingMonths} month${fetchingMonths === 1 ? '' : 's'}…`
                : status.running
                  ? 'Syncing…'
                  : `Updated ${status.lastRun?.at ? fmtDateTime(status.lastRun.at) : 'on next run'}`}
            </span>
          )}
          <button type="button" className="btn" onClick={() => refresh()} disabled={refreshing}>
            {refreshing ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh
          </button>
          <button type="button" className="btn" onClick={exportCsv} disabled={!sorted.length}>
            <Download size={14} /> Export
          </button>
          <button type="button" className="sales-link-btn" onClick={enrichRange} disabled={enriching} title="Fetch discount and fee detail from Momence for every transaction in this range">
            {enriching ? 'Fetching discounts…' : 'Fetch discount detail'}
          </button>
          <button type="button" className="sales-link-btn" onClick={rebuildCache} title="Discard the months cached in this browser and fetch them again">
            Rebuild cache
          </button>
        </div>
      </header>

      {backfillLine && (
        <div className="sales-backfill">
          <Database size={13} />
          <span>History: {backfillLine}</span>
          {status?.enrichedTransactions != null && (
            <span className="sales-backfill-sep">Discount detail: {status.enrichedTransactions.toLocaleString('en-IN')} transactions</span>
          )}
          {!Object.values(status.backfill).every(state => state?.done) && (
            <button type="button" className="sales-link-btn" onClick={() => refresh({ backfill: true })} disabled={refreshing}>
              Fetch more history
            </button>
          )}
        </div>
      )}

      <div className="sales-toolbar">
        <Segmented options={PRESETS.map(p => ({ value: p.id, label: p.label }))} value={preset} onChange={applyPreset} ariaLabel="Date range" />
        <div className="sales-dates">
          <input type="date" value={range.from} onChange={e => { setPreset('custom'); setRange(r => ({ ...r, from: e.target.value })) }} aria-label="From" />
          <span>→</span>
          <input type="date" value={range.to} onChange={e => { setPreset('custom'); setRange(r => ({ ...r, to: e.target.value })) }} aria-label="To" />
        </div>
        <div className="sales-search">
          <Search size={14} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, item, reference, member ID…" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={12} /></button>}
        </div>
      </div>

      <div className="sales-filters">
        <span className="sales-filters-label"><Filter size={12} /> Filters</span>
        {FILTER_FIELDS.map(({ field, label, format }) => (
          <FilterMenu
            key={field}
            label={label}
            options={options[field] || []}
            selected={filters[field] || []}
            format={format}
            onChange={values => setFilters(previous => ({ ...previous, [field]: values }))}
          />
        ))}
        {activeFilterCount > 0 && (
          <button type="button" className="sales-link-btn" onClick={() => setFilters({})}>Clear all ({activeFilterCount})</button>
        )}
      </div>

      {error && <div className="sales-error">{error}</div>}

      <div className="sales-kpis momence-metric-grid">
        {METRICS.map(metric => (
          <Metric
            key={metric.key}
            icon={metric.icon}
            label={metric.label}
            value={metric.value(kpis, derived)}
            detail={metric.detail(kpis, derived)}
            tone={typeof metric.tone === 'function' ? metric.tone(kpis) : metric.tone}
            onClick={metric.series ? () => setChartMetric(metric.key) : undefined}
            active={chartMetric === metric.key}
          />
        ))}
      </div>

      <Section
        title={`${activeMetric.label} over time`}
        subtitle={activeMetric.chartSubtitle || 'Per day, in the selected range — pick a card above to change the series'}
        icon={activeMetric.icon}
      >
        {loading
          ? <TableSkeleton rows={4} cols={2} />
          : <ChartFrame
              data={trend.map(point => ({ label: point.date, ...point }))}
              series={activeMetric.series}
              xKey="label"
              defaultType="area"
              height={250}
              valueFormat={value => (activeMetric.money === false ? value.toLocaleString('en-IN') : money(value))}
              emptyText="No sales in this range."
            />}
      </Section>

      <Section
        title="Breakdown"
        subtitle="Money always comes from the payment split; sale counts stay one per sale"
        icon={Layers}
        actions={<span className="sales-section-note">{groups.length} {groups.length === 1 ? 'group' : 'groups'}</span>}
      >
        <div className="sales-dimensions" role="tablist" aria-label="Group by">
          <span className="sales-dimensions-label"><Layers size={11} /> Group by</span>
          {GROUPINGS.map(dimension => (
            <button
              key={dimension.field}
              type="button"
              role="tab"
              aria-selected={groupBy === dimension.field}
              className={`sales-dimension ${groupBy === dimension.field ? 'is-active' : ''}`}
              onClick={() => { setGroupBy(dimension.field); setExpandedGroup(null) }}
            >
              {dimension.label}
              {groupBy === dimension.field && <span className="sales-dimension-count">{groups.length}</span>}
            </button>
          ))}
        </div>

        <div className="sales-breakdown-wrap scrollbar-thin">
          <table className="sales-table sales-breakdown">
            <thead>
              <tr>
                <th className="sales-th-expand" />
                <th>{GROUPINGS.find(g => g.field === groupBy)?.label || 'Group'}</th>
                <th className="is-right">Sales</th>
                <th className="is-right">Members</th>
                <th className="is-right">Gross</th>
                <th className="is-right">Currency</th>
                <th className="is-right">Credits</th>
                <th className="is-right">Discount</th>
                <th className="is-right">Refunded</th>
                <th className="is-right">ATV</th>
                <th className="is-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {groups.slice(0, 60).map(group => {
                const isOpen = expandedGroup === group.key
                return (
                  <React.Fragment key={group.key}>
                    <tr
                      className={`is-clickable ${isOpen ? 'is-expanded' : ''}`}
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={isOpen}
                    >
                      <td className="sales-td-expand">{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                      <td>
                        <div className="sales-group-cell">
                          {groupBy === 'itemGroup'
                            ? <span className="sales-tag" data-tone={GROUP_TONES[group.key] ?? 8}>{group.key}</span>
                            : <span className="sales-group-name" title={group.key}>{group.key}</span>}
                          <span className="sales-group-bar" aria-hidden="true">
                            <span style={{ width: `${Math.max(1, Math.round((group.share || 0) * 100))}%` }} />
                          </span>
                        </div>
                      </td>
                      <td className="is-right">{group.transactions.toLocaleString('en-IN')}</td>
                      <td className="is-right">{group.uniqueMembers.toLocaleString('en-IN')}</td>
                      <td className="is-right">{money(group.grossRevenue)}</td>
                      <td className="is-right">{money(group.paidInCurrency)}</td>
                      <td className="is-right">{money(group.paidInMoneyCredits)}</td>
                      <td className="is-right">{group.discount ? money(group.discount) : <span className="sales-muted">—</span>}</td>
                      <td className="is-right">{group.refunded ? money(group.refunded) : <span className="sales-muted">—</span>}</td>
                      <td className="is-right">{money(group.averageTransactionValue)}</td>
                      <td className="is-right">{pct(group.share)}</td>
                    </tr>

                    {/* Child rows: the biggest sales inside this group, plus a
                        way to push the group into the table's filters. */}
                    {isOpen && groupChildren(group.key).map(child => (
                      <tr key={`${group.key}-${child.id}`} className="sales-child-row" onClick={() => toggleGroup(group.key)}>
                        <td className="sales-td-expand" />
                        <td><span className="sales-child-marker">{child.customerName || 'Unnamed'}</span></td>
                        <td className="is-right">{fmtDateTime(child.paymentDate)}</td>
                        <td className="is-right">{child.itemName || child.paymentItem}</td>
                        <td className="is-right">{money(child.paymentValue)}</td>
                        <td className="is-right">{money(child.paidInCurrency)}</td>
                        <td className="is-right">{money(child.splitPaidInMoneyCredits)}</td>
                        <td className="is-right">{child.discountAmount ? money(child.discountAmount) : <span className="sales-muted">—</span>}</td>
                        <td className="is-right">{child.refunded ? money(child.refunded) : <span className="sales-muted">—</span>}</td>
                        <td className="is-right">{child.splitPaymentMethod || '—'}</td>
                        <td className="is-right">{child.location || '—'}</td>
                      </tr>
                    ))}
                    {isOpen && (
                      <tr className="sales-child-row is-child-foot" onClick={event => event.stopPropagation()}>
                        <td className="sales-td-expand" />
                        <td colSpan={10}>
                          <button
                            type="button"
                            className="sales-link-btn"
                            onClick={() => setFilters(previous => ({ ...previous, [groupBy]: [group.key] }))}
                          >
                            Filter the whole dashboard to {group.key} <ChevronRight size={12} />
                          </button>
                          <span className="sales-child-note">
                            Showing the {Math.min(8, group.transactions)} largest of {group.transactions.toLocaleString('en-IN')} sales
                          </span>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              {!groups.length && (
                <tr><td colSpan={11} className="sales-empty-cell">Nothing matches these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Transactions"
        subtitle={`${sorted.length.toLocaleString('en-IN')} payment splits · click a row for the full transaction`}
        icon={Receipt}
        actions={
          <div className="sales-col-picker">
            <button type="button" className="sales-filter-btn" onClick={() => setShowColumns(open => !open)}>
              <SlidersHorizontal size={12} /> Columns
            </button>
            {showColumns && (
              <div className="sales-filter-menu scrollbar-thin">
                {COLUMNS.map(column => (
                  <label key={column.key} className="sales-filter-option">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(column.key)}
                      onChange={() => setVisibleColumns(previous =>
                        previous.includes(column.key) ? previous.filter(key => key !== column.key) : [...previous, column.key])}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
                <button type="button" className="sales-filter-clear" onClick={() => setVisibleColumns(DEFAULT_COLUMNS)}>Reset</button>
              </div>
            )}
          </div>
        }
      >
        {loading
          ? <TableSkeleton rows={10} cols={columns.length} />
          : !page.length
            ? <Empty icon={Receipt} title="No transactions" subtitle="Widen the date range or clear a filter." />
            : (
              <>
                <div className="sales-table-wrap scrollbar-thin">
                  <table className="rp-table sales-table">
                    <thead>
                      <tr>
                        <th className="sales-th-expand" />
                        {columns.map(column => (
                          <th
                            key={column.key}
                            className={`is-sortable ${column.align === 'right' ? 'is-right' : ''} ${sort.key === column.key ? 'is-sorted' : ''}`}
                            style={{ width: column.width }}
                            onClick={() => setSort(previous => previous.key === column.key ? { key: column.key, dir: previous.dir === 'desc' ? 'asc' : 'desc' } : { key: column.key, dir: 'desc' })}
                            aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                          >
                            {column.label}
                            {sort.key === column.key && (
                              <span className="sales-sort">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {page.map(row => {
                        const key = rowKey(row)
                        const splits = splitsOf(row)
                        const isOpen = expanded === key
                        return (
                          <React.Fragment key={key}>
                            <tr
                              className={`is-clickable ${isOpen ? 'is-expanded' : ''}`}
                              onClick={() => toggleRow(row)}
                              aria-expanded={isOpen}
                            >
                              <td className="sales-td-expand">
                                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </td>
                              {columns.map(column => (
                                <td key={column.key} className={column.align === 'right' ? 'is-right' : ''}>
                                  {column.key === 'splitPaymentMethod' && splits.length > 1
                                    ? <span className="sales-split-count">{splits.length} methods</span>
                                    : column.format ? column.format(row) : (row[column.key] ?? <span className="sales-muted">—</span>)}
                                </td>
                              ))}
                            </tr>

                            {/* Child rows: one per payment split, in the same
                                columns as their parent so the numbers line up. */}
                            {isOpen && splits.length > 1 && splits.map(split => (
                              <tr key={`${key}-${split.id}`} className="sales-child-row" onClick={() => toggleRow(row)}>
                                <td className="sales-td-expand" />
                                {columns.map(column => (
                                  <td key={column.key} className={column.align === 'right' ? 'is-right' : ''}>
                                    {column.key === 'splitPaymentMethod'
                                      ? <span className="sales-child-marker">{split.splitPaymentMethod || '—'}</span>
                                      : ['paidInCurrency', 'splitPaidInMoneyCredits', 'splitVatAmount'].includes(column.key)
                                        ? money(split[column.key])
                                        : column.key === 'paymentValue'
                                          ? <span className="sales-muted">{split.paymentMethodWeight == null ? '—' : `${Math.round(split.paymentMethodWeight * 100)}%`}</span>
                                          : <span className="sales-muted">—</span>}
                                  </td>
                                ))}
                              </tr>
                            ))}

                            {isOpen && (
                              <tr className="sales-detail-row">
                                <td colSpan={columns.length + 1}>
                                  <RowDetail row={row} siblings={splits} onOpenMember={r => setMember({ memberId: r.memberId, locationId: r.location })} />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {sorted.length > page.length && (
                  <button type="button" className="sales-more" onClick={() => setLimit(value => value + 200)}>
                    Show 200 more · {(sorted.length - page.length).toLocaleString('en-IN')} remaining
                  </button>
                )}
              </>
            )}
      </Section>

      {member && (
        <MemberProfileModal
          memberId={member.memberId}
          locationId={member.locationId}
          onClose={() => setMember(null)}
        />
      )}
    </div>
  )
}
