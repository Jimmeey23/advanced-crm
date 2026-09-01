// Shared report primitives.
//
// Every reporting surface (Weekly, Monthly, Studio performance, Performance)
// used to hand-roll its own card, table and toggle out of Tailwind utilities,
// which is why no two of them looked or behaved alike. These are the pieces
// they all build from now: one section frame, one stat tile, one delta badge,
// one sortable rank table, one chart frame with the metric/type switchers, and
// one drill-down panel.
//
// Colour comes from the validated chart palette (src/chartPalette.js), never
// from ad-hoc hexes — a series keeps its slot when a filter removes its
// neighbours, and both themes are selected rather than flipped.
import React, { useMemo, useState } from 'react'
import { ArrowUpRight, ArrowDownRight, Minus, ChevronDown, ChevronUp, X, ExternalLink } from 'lucide-react'
import { Spinner } from '../../ui.jsx'
import { money, fmtDate } from '../../lib.js'

export { default as ChartFrame } from './ChartFrame.jsx'

/* ── Section frame ─────────────────────────────────────────── */
export function Section({ title, subtitle, icon: Icon, tone = 'default', actions, children, className = '', collapsible = false, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`rp-section ${className}`} data-tone={tone}>
      <header className="rp-section-head">
        {Icon && <span className="rp-section-icon"><Icon size={14} /></span>}
        <div className="rp-section-titles">
          <h3>{title}</h3>
          {subtitle && <small>{subtitle}</small>}
        </div>
        {actions && <div className="rp-section-actions">{actions}</div>}
        {collapsible && (
          <button type="button" className="rp-icon-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? `Collapse ${title}` : `Expand ${title}`}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </header>
      {(!collapsible || open) && <div className="rp-section-body">{children}</div>}
    </section>
  )
}

/* ── Numbers ───────────────────────────────────────────────── */
// A percentage-point change and a percentage change are different things and
// are labelled differently: `unit="pt"` for rates, the default for counts.
export function Delta({ value, unit = '%', invert = false, suffix = 'vs prev' }) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const rounded = Math.round(value * 10) / 10
  const flat = rounded === 0
  const good = invert ? rounded < 0 : rounded > 0
  const Icon = flat ? Minus : rounded > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`rp-delta ${flat ? 'is-flat' : good ? 'is-up' : 'is-down'}`}>
      <Icon size={11} />
      {flat ? '0' : `${rounded > 0 ? '+' : ''}${rounded}`}{unit}
      {suffix && <small>{suffix}</small>}
    </span>
  )
}

export function StatTile({ label, value, sub, delta, deltaUnit, invertDelta, tone, icon: Icon, onClick, active }) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      className={`rp-tile ${onClick ? 'is-clickable' : ''} ${active ? 'is-active' : ''}`}
      data-tone={tone}
      onClick={onClick}
    >
      <span className="rp-tile-label">{Icon && <Icon size={11} />}{label}</span>
      <strong className="rp-tile-value">{value}</strong>
      <span className="rp-tile-foot">
        {sub && <small>{sub}</small>}
        {delta !== undefined && <Delta value={delta} unit={deltaUnit} invert={invertDelta} suffix="" />}
      </span>
    </Wrapper>
  )
}

export function TileGrid({ children, cols = 4 }) {
  return <div className="rp-tile-grid" style={{ '--rp-cols': cols }}>{children}</div>
}

/* ── Insights ──────────────────────────────────────────────── */
// The server generates the sentences so the UI, the CSV and the PDF can never
// disagree about what the numbers mean.
export function InsightList({ insights = [], onDismissAll }) {
  const [hidden, setHidden] = useState(() => new Set())
  const visible = insights.filter((_, i) => !hidden.has(i))
  if (!visible.length) return null
  return (
    <div className="rp-insights">
      {visible.map((ins, i) => {
        const index = insights.indexOf(ins)
        return (
          <article key={index} className="rp-insight" data-tone={ins.tone}>
            <span className="rp-insight-dot" aria-hidden="true" />
            <div>
              <strong>{ins.title}</strong>
              <p>{ins.detail}</p>
            </div>
            <button type="button" className="rp-icon-btn" aria-label="Dismiss insight" onClick={() => setHidden(h => new Set(h).add(index))}><X size={12} /></button>
          </article>
        )
      })}
      {onDismissAll && visible.length > 1 && (
        <button type="button" className="rp-link-btn" onClick={onDismissAll}>Dismiss all</button>
      )}
    </div>
  )
}

/* ── Segmented control ─────────────────────────────────────── */
export function Segmented({ options, value, onChange, size = 'md', ariaLabel }) {
  return (
    <div className={`rp-segmented rp-segmented-${size}`} role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'is-active' : ''}
          onClick={() => onChange(o.value)}
          title={o.title || o.label}
        >
          {o.icon && <o.icon size={12} />}{o.label}
        </button>
      ))}
    </div>
  )
}

/* ── Sortable rank table ───────────────────────────────────── */
// `columns` entries: { key, label, align, format, tone, sortable, width }.
// Rows carry whatever the caller has; the table only sorts and renders.
export function RankTable({ columns, rows, initialSort, rankKey, onRowClick, emptyText = 'No data for this period.', maxHeight }) {
  const [sort, setSort] = useState(() => initialSort || { key: columns[1]?.key, dir: 'desc' })
  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sort.key)
    if (!col) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key]
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va ?? '').localeCompare(String(vb ?? '')) * dir
    })
  }, [rows, sort, columns])

  const toggle = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' })

  return (
    <div className="rp-table-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className="rp-table">
        <thead>
          <tr>
            {rankKey && <th className="rp-th-rank">#</th>}
            {columns.map(c => (
              <th
                key={c.key}
                className={`${c.align === 'right' ? 'is-right' : c.align === 'center' ? 'is-center' : ''} ${c.sortable === false ? '' : 'is-sortable'} ${sort.key === c.key ? 'is-sorted' : ''}`}
                style={c.width ? { width: c.width } : undefined}
                onClick={c.sortable === false ? undefined : () => toggle(c.key)}
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.label}
                {sort.key === c.key && (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.id || row.key || i} className={onRowClick ? 'is-clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {rankKey && <td className="rp-td-rank">{i + 1}</td>}
              {columns.map(c => (
                <td key={c.key} className={c.align === 'right' ? 'is-right' : c.align === 'center' ? 'is-center' : ''} data-tone={typeof c.tone === 'function' ? c.tone(row) : c.tone}>
                  {c.format ? c.format(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
          {!sorted.length && <tr><td colSpan={columns.length + (rankKey ? 1 : 0)} className="rp-empty">{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

/* ── Drill-down ────────────────────────────────────────────── */
// One panel for every "show me the leads behind this number" on the page. It
// renders the lead detail the report endpoint returns — owner, source, value,
// follow-ups and the latest remark — so it answers the follow-up question too,
// instead of being a list of names that has to be clicked one at a time.
export function DrillPanel({ drill, data, loading, onClose, onOpenLead, onExport }) {
  if (!drill) return null
  const leads = data?.leads || []
  return (
    <div className="rp-drill">
      <header className="rp-drill-head">
        <div>
          <strong>{drill.label}</strong>
          <small>{loading ? 'Loading…' : `${data?.total ?? 0} lead${(data?.total ?? 0) === 1 ? '' : 's'}${data?.truncated ? ` · showing first ${leads.length}` : ''}`}</small>
        </div>
        {onExport && !!leads.length && <button type="button" className="rp-btn" onClick={() => onExport(leads, drill)}>Export CSV</button>}
        <button type="button" className="rp-icon-btn" onClick={onClose} aria-label="Close drill-down"><X size={14} /></button>
      </header>
      <div className="rp-drill-body">
        {loading && <div className="rp-loading"><Spinner size={18} /></div>}
        {!loading && !leads.length && <p className="rp-empty">No leads match this selection.</p>}
        {!loading && !!leads.length && (
          <table className="rp-table rp-table-drill">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Owner</th>
                <th>Stage</th>
                <th>Source</th>
                <th className="is-right">Value</th>
                <th className="is-center">FUs</th>
                <th className="is-right">Created</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {leads.map(l => (
                <tr key={l.id} className="is-clickable" onClick={() => onOpenLead(l.id)}>
                  <td>
                    <span className="rp-lead-name">{l.fullName}</span>
                    {l.lastRemark && <span className="rp-lead-remark" title={l.lastRemark}>{l.lastRemark}</span>}
                  </td>
                  <td className="rp-dim">{l.associateName || '—'}</td>
                  <td><span className="rp-pill" data-status={l.status}>{l.stage || '—'}</span></td>
                  <td className="rp-dim">{l.source || '—'}</td>
                  <td className="is-right rp-num">{l.revenue ? money(l.revenue) : '—'}</td>
                  <td className="is-center rp-num">{l.followUpsDone}</td>
                  <td className="is-right rp-dim">{fmtDate(l.createdAt)}</td>
                  <td className="rp-td-open"><ExternalLink size={12} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ── Saved views ───────────────────────────────────────────── */
// State lives in the URL hash as well as localStorage: the hash makes a report
// shareable, the store makes a favourite one click away. Both hold exactly the
// serialised control state, so restoring one is the same code path as loading
// a link someone sent you.
const VIEW_STORE_KEY = 'p57_report_views'

export function loadSavedViews() {
  try { return JSON.parse(localStorage.getItem(VIEW_STORE_KEY) || '[]') } catch (e) { return [] }
}
export function persistSavedViews(views) {
  try { localStorage.setItem(VIEW_STORE_KEY, JSON.stringify(views.slice(0, 24))) } catch (e) { /* quota — the URL still works */ }
}

export function SavedViews({ page, state, onApply, onCopyLink }) {
  const [views, setViews] = useState(() => loadSavedViews().filter(v => v.page === page))
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const all = loadSavedViews().filter(v => !(v.page === page && v.name === trimmed))
    const next = [{ id: `${page}-${Date.now()}`, page, name: trimmed, state }, ...all]
    persistSavedViews(next)
    setViews(next.filter(v => v.page === page))
    setNaming(false); setName('')
  }
  const remove = (id) => {
    const next = loadSavedViews().filter(v => v.id !== id)
    persistSavedViews(next)
    setViews(next.filter(v => v.page === page))
  }

  return (
    <div className="rp-views">
      {views.map(v => (
        <span key={v.id} className="rp-view-chip">
          <button type="button" onClick={() => onApply(v.state)}>{v.name}</button>
          <button type="button" className="rp-view-x" aria-label={`Delete saved view ${v.name}`} onClick={() => remove(v.id)}><X size={10} /></button>
        </span>
      ))}
      {naming ? (
        <span className="rp-view-name">
          <input
            autoFocus className="input" placeholder="View name" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setNaming(false); setName('') } }}
          />
          <button type="button" className="rp-btn rp-btn-primary" onClick={save}>Save</button>
        </span>
      ) : (
        <button type="button" className="rp-btn" onClick={() => setNaming(true)}>Save view</button>
      )}
      <button type="button" className="rp-btn" onClick={onCopyLink}>Copy link</button>
    </div>
  )
}

/* ── Small helpers shared by the report pages ──────────────── */
export const pctChange = (now, before) => (before ? ((now - before) / before) * 100 : null)

export const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
export const csvRows = (rows) => rows.map(r => r.map(csvEscape).join(',')).join('\n')
