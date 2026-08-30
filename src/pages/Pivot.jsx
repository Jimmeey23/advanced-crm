import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Table2, Rows3, Columns3, Sigma, Filter as FilterIcon, Plus, X, Save, Trash2,
  Download, ChevronRight, ChevronDown, Settings2, Copy, Share2, RotateCcw, Search
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Empty, Spinner, CardSkeleton } from '../ui.jsx'
import {
  buildPivot, formatValue, pivotToCsv, EMPTY_SPEC,
  AGGREGATORS, DATE_GRAINS, NUMBER_STYLES, BLANK, dimensionValue
} from '../lib/pivot.js'

// The dataset arrives columnar and dictionary-encoded to keep the response
// small. Rehydrating it into plain row objects once here means the engine,
// the filter option lists and the CSV export all see ordinary strings and
// numbers, with no encoding knowledge leaking past this function.
function decodeDataset(payload) {
  const { columns = {}, dictionaries = {}, rowCount = 0 } = payload
  const fields = Object.keys(columns)
  const rows = new Array(rowCount)
  for (let i = 0; i < rowCount; i++) {
    const row = {}
    for (const field of fields) {
      const dict = dictionaries[field]
      const raw = columns[field][i]
      row[field] = dict ? (dict[raw] ?? '') : raw
    }
    rows[i] = row
  }
  return { ...payload, rows }
}

const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 8)}`
const LAYOUTS = [
  { id: 'outline', label: 'Outline', hint: 'Each level on its own line, indented' },
  { id: 'compact', label: 'Compact', hint: 'Levels share one column' },
  { id: 'tabular', label: 'Tabular', hint: 'One column per level, repeated' }
]

export default function Pivot() {
  const { toast } = useApp()
  const [dataset, setDataset] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [spec, setSpec] = useState(() => structuredClone(EMPTY_SPEC))
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [views, setViews] = useState({ mine: [], shared: [] })
  const [activeViewId, setActiveViewId] = useState('')
  const [fieldQuery, setFieldQuery] = useState('')
  const [showOptions, setShowOptions] = useState(true)
  const dragged = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get('/api/pivot/dataset')
      .then(d => { if (!cancelled) { setDataset(decodeDataset(d)); setError('') } })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    api.get('/api/pivot-views').then(v => { if (!cancelled) setViews(v) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const fields = dataset?.fields || []
  const rows = dataset?.rows || []

  const pivot = useMemo(() => {
    if (!rows.length) return null
    try { return buildPivot(rows, spec, collapsed) }
    catch (e) { return { error: e.message } }
  }, [rows, spec, collapsed])

  /* ---------------- shelf mutations ---------------- */

  const fieldMeta = useCallback((name) => fields.find(f => f.field === name), [fields])

  const addToZone = (zone, fieldName) => {
    const meta = fieldMeta(fieldName)
    if (!meta) return
    if (zone === 'measures') {
      setSpec(s => ({
        ...s,
        measures: [...s.measures, {
          id: uid('m'),
          agg: meta.type === 'number' ? 'sum' : 'count',
          field: meta.field,
          label: meta.label,
          format: { style: meta.currency ? 'compactIndian' : 'plain', decimals: meta.currency ? 1 : 0, currency: Boolean(meta.currency) }
        }]
      }))
      return
    }
    if (zone === 'filters') {
      setSpec(s => s.filters.some(f => f.field === fieldName) ? s : ({
        ...s, filters: [...s.filters, { field: fieldName, label: meta.label, mode: 'include', values: [] }]
      }))
      return
    }
    setSpec(s => {
      if (s[zone].some(d => d.field === fieldName)) return s
      const dim = { field: meta.field, label: meta.label, type: meta.type, sortBy: 'key', sortDir: 'asc', renames: {} }
      if (meta.type === 'date') dim.grain = 'month'
      if (meta.type === 'number') dim.buckets = [25, 50, 75]
      return { ...s, [zone]: [...s[zone], dim] }
    })
  }

  const removeFrom = (zone, index) =>
    setSpec(s => ({ ...s, [zone]: s[zone].filter((_, i) => i !== index) }))

  const patchDim = (zone, index, patch) =>
    setSpec(s => ({ ...s, [zone]: s[zone].map((d, i) => i === index ? { ...d, ...patch } : d) }))

  const moveDim = (zone, from, to) =>
    setSpec(s => {
      const list = [...s[zone]]
      const [item] = list.splice(from, 1)
      list.splice(to, 0, item)
      return { ...s, [zone]: list }
    })

  const setOption = (key, value) =>
    setSpec(s => ({ ...s, options: { ...s.options, [key]: value } }))

  const toggleCollapse = (pathKey) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(pathKey) ? next.delete(pathKey) : next.add(pathKey)
      return next
    })

  /* ---------------- saved views ---------------- */

  const persistViews = async (nextMine) => {
    setViews(v => ({ ...v, mine: nextMine }))
    try { await api.put('/api/pivot-views', { views: nextMine }) }
    catch (e) { toast(e.message, 'error') }
  }

  const saveView = async () => {
    const existing = views.mine.find(v => v.id === activeViewId)
    const name = window.prompt('Name this view', existing?.name || 'Untitled view')
    if (!name) return
    const next = existing
      ? views.mine.map(v => v.id === existing.id ? { ...v, name, spec } : v)
      : [...views.mine, { id: uid('pv'), name, shared: false, spec }]
    await persistViews(next)
    if (!existing) setActiveViewId(next[next.length - 1].id)
    toast(`Saved “${name}”`)
  }

  const loadView = (view) => {
    setSpec(structuredClone({ ...EMPTY_SPEC, ...view.spec, options: { ...EMPTY_SPEC.options, ...(view.spec.options || {}) } }))
    setCollapsed(new Set())
    setActiveViewId(view.readOnly ? '' : view.id)
  }

  const deleteView = async (id) => {
    const view = views.mine.find(v => v.id === id)
    if (!view || !window.confirm(`Delete “${view.name}”?`)) return
    await persistViews(views.mine.filter(v => v.id !== id))
    if (activeViewId === id) setActiveViewId('')
  }

  const toggleShare = async (id) =>
    persistViews(views.mine.map(v => v.id === id ? { ...v, shared: !v.shared } : v))

  const exportCsv = () => {
    if (!pivot || pivot.error) return
    const blob = new Blob([pivotToCsv(pivot, spec)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `pivot-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  /* ---------------- drag and drop ---------------- */

  const onDragStart = (payload) => (e) => {
    dragged.current = payload
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', payload.field || '') } catch (err) { /* Safari */ }
  }
  const onDropZone = (zone) => (e) => {
    e.preventDefault()
    const payload = dragged.current
    dragged.current = null
    if (!payload) return
    if (payload.from && payload.from !== zone) removeFrom(payload.from, payload.index)
    addToZone(zone, payload.field)
  }

  const visibleFields = fields.filter(f =>
    !fieldQuery || f.label.toLowerCase().includes(fieldQuery.toLowerCase()))

  if (loading) return <div className="pivot-page"><CardSkeleton lines={5} /></div>
  if (error) return <div className="pivot-page"><Empty icon={<Table2 size={20} />} title="Could not load the dataset" subtitle={error} /></div>

  return (
    <div className="pivot-page">
      <header className="pivot-topbar">
        <div className="pivot-title">
          <h2>Pivot builder</h2>
          <span>{(pivot?.filteredCount ?? 0).toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')} leads</span>
        </div>
        <div className="pivot-topbar-actions">
          <select
            className="input !w-auto"
            value={activeViewId}
            onChange={e => {
              const all = [...views.mine, ...views.shared]
              const v = all.find(x => x.id === e.target.value)
              if (v) loadView(v)
              else { setActiveViewId(''); setSpec(structuredClone(EMPTY_SPEC)) }
            }}
            aria-label="Saved views"
          >
            <option value="">New view</option>
            {views.mine.length > 0 && (
              <optgroup label="My views">
                {views.mine.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            )}
            {views.shared.length > 0 && (
              <optgroup label="Shared with me">
                {views.shared.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            )}
          </select>
          <button className="btn btn-ghost" onClick={saveView}><Save size={14} /> Save</button>
          {activeViewId && (
            <>
              <button className="btn btn-ghost !p-2" title="Share with the workspace" onClick={() => toggleShare(activeViewId)}>
                <Share2 size={14} className={views.mine.find(v => v.id === activeViewId)?.shared ? 'text-emerald-400' : ''} />
              </button>
              <button className="btn btn-ghost !p-2" title="Delete view" onClick={() => deleteView(activeViewId)}><Trash2 size={14} /></button>
            </>
          )}
          <button className="btn btn-ghost !p-2" title="Reset" onClick={() => { setSpec(structuredClone(EMPTY_SPEC)); setCollapsed(new Set()); setActiveViewId('') }}><RotateCcw size={14} /></button>
          <button className="btn btn-ghost" onClick={exportCsv}><Download size={14} /> CSV</button>
          <button className={`btn ${showOptions ? 'btn-soft' : 'btn-ghost'} !p-2`} title="Layout options" onClick={() => setShowOptions(o => !o)}><Settings2 size={14} /></button>
        </div>
      </header>

      <div className="pivot-body">
        <aside className="pivot-shelf">
          <div className="pivot-field-search">
            <Search size={13} />
            <input value={fieldQuery} onChange={e => setFieldQuery(e.target.value)} placeholder="Find a field" aria-label="Find a field" />
          </div>
          <div className="pivot-field-list">
            {visibleFields.map(f => (
              <div
                key={f.field}
                className={`pivot-field is-${f.type}`}
                draggable
                onDragStart={onDragStart({ field: f.field })}
                title={`Drag into rows, columns, values or filters`}
              >
                <span className="pivot-field-type">{f.type === 'date' ? 'D' : f.type === 'number' ? '#' : 'A'}</span>
                <span className="pivot-field-name">{f.label}</span>
                <span className="pivot-field-add">
                  <button type="button" title="Add to rows" onClick={() => addToZone('rows', f.field)}><Rows3 size={11} /></button>
                  <button type="button" title="Add to columns" onClick={() => addToZone('cols', f.field)}><Columns3 size={11} /></button>
                  <button type="button" title="Add to values" onClick={() => addToZone('measures', f.field)}><Sigma size={11} /></button>
                  <button type="button" title="Add to filters" onClick={() => addToZone('filters', f.field)}><FilterIcon size={11} /></button>
                </span>
              </div>
            ))}
            {!visibleFields.length && <p className="pivot-empty-note">No field matches “{fieldQuery}”.</p>}
          </div>

          <Zone
            title="Rows" icon={Rows3} zone="rows" items={spec.rows}
            onDrop={onDropZone('rows')} onRemove={i => removeFrom('rows', i)}
            onPatch={(i, p) => patchDim('rows', i, p)} onMove={(a, b) => moveDim('rows', a, b)}
            onDragStart={onDragStart} rows={rows}
          />
          <Zone
            title="Columns" icon={Columns3} zone="cols" items={spec.cols}
            onDrop={onDropZone('cols')} onRemove={i => removeFrom('cols', i)}
            onPatch={(i, p) => patchDim('cols', i, p)} onMove={(a, b) => moveDim('cols', a, b)}
            onDragStart={onDragStart} rows={rows}
          />
          <MeasureZone
            measures={spec.measures} fields={fields}
            onDrop={onDropZone('measures')}
            onRemove={i => removeFrom('measures', i)}
            onPatch={(i, p) => setSpec(s => ({ ...s, measures: s.measures.map((m, j) => j === i ? { ...m, ...p } : m) }))}
            onAdd={() => setSpec(s => ({ ...s, measures: [...s.measures, { id: uid('m'), agg: 'count', label: 'Count', format: { style: 'plain', decimals: 0 } }] }))}
          />
          <FilterZone
            filters={spec.filters} rows={rows}
            onDrop={onDropZone('filters')}
            onRemove={i => removeFrom('filters', i)}
            onPatch={(i, p) => setSpec(s => ({ ...s, filters: s.filters.map((f, j) => j === i ? { ...f, ...p } : f) }))}
          />
        </aside>

        <section className="pivot-canvas">
          {showOptions && <OptionsBar options={spec.options} setOption={setOption} />}
          {pivot?.error
            ? <Empty icon={<Table2 size={20} />} title="That combination could not be built" subtitle={pivot.error} />
            : <PivotTable pivot={pivot} spec={spec} onToggle={toggleCollapse} />}
        </section>
      </div>
    </div>
  )
}

/* ==================================================================== *
 * Shelf zones
 * ==================================================================== */

function Zone({ title, icon: Icon, zone, items, onDrop, onRemove, onPatch, onMove, onDragStart, rows }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="pivot-zone" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      <div className="pivot-zone-head"><Icon size={12} /> {title}<span>{items.length}</span></div>
      {!items.length && <p className="pivot-zone-empty">Drag a field here</p>}
      {items.map((dim, i) => (
        <div key={dim.field} className="pivot-pill" draggable onDragStart={onDragStart({ field: dim.field, from: zone, index: i })}>
          <button type="button" className="pivot-pill-main" onClick={() => setOpen(open === i ? null : i)}>
            <span className="pivot-pill-label">{dim.label}</span>
            {dim.type === 'date' && <em>{DATE_GRAINS.find(g => g.id === dim.grain)?.label}</em>}
          </button>
          <span className="pivot-pill-tools">
            {i > 0 && <button type="button" title="Move up" onClick={() => onMove(i, i - 1)}>↑</button>}
            {i < items.length - 1 && <button type="button" title="Move down" onClick={() => onMove(i, i + 1)}>↓</button>}
            <button type="button" title="Remove" onClick={() => onRemove(i)}><X size={11} /></button>
          </span>

          {open === i && (
            <div className="pivot-pill-panel">
              <label>
                <span>Rename</span>
                <input className="input" value={dim.label} onChange={e => onPatch(i, { label: e.target.value })} />
              </label>
              {dim.type === 'date' && (
                <label>
                  <span>Bucket by</span>
                  <select className="input" value={dim.grain} onChange={e => onPatch(i, { grain: e.target.value })}>
                    {DATE_GRAINS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                </label>
              )}
              {dim.type === 'number' && (
                <label>
                  <span>Bucket edges</span>
                  <input
                    className="input"
                    value={(dim.buckets || []).join(', ')}
                    placeholder="25, 50, 75"
                    onChange={e => onPatch(i, { buckets: e.target.value.split(',').map(v => Number(v.trim())).filter(Number.isFinite) })}
                  />
                </label>
              )}
              <label>
                <span>Sort</span>
                <select className="input" value={`${dim.sortBy}:${dim.sortDir}`} onChange={e => {
                  const [sortBy, sortDir] = e.target.value.split(':')
                  onPatch(i, { sortBy, sortDir })
                }}>
                  <option value="key:asc">Natural ascending</option>
                  <option value="key:desc">Natural descending</option>
                  <option value="label:asc">Label A–Z</option>
                  <option value="label:desc">Label Z–A</option>
                </select>
              </label>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function MeasureZone({ measures, fields, onDrop, onRemove, onPatch, onAdd }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="pivot-zone" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      <div className="pivot-zone-head">
        <Sigma size={12} /> Values<span>{measures.length}</span>
        <button type="button" className="pivot-zone-add" onClick={onAdd} title="Add a value"><Plus size={12} /></button>
      </div>
      {measures.map((m, i) => {
        const agg = AGGREGATORS.find(a => a.id === m.agg)
        return (
          <div key={m.id} className="pivot-pill is-measure">
            <button type="button" className="pivot-pill-main" onClick={() => setOpen(open === i ? null : i)}>
              <span className="pivot-pill-label">{m.label || agg?.label}</span>
              <em>{agg?.label}</em>
            </button>
            <span className="pivot-pill-tools">
              <button type="button" title="Remove" onClick={() => onRemove(i)}><X size={11} /></button>
            </span>
            {open === i && (
              <div className="pivot-pill-panel">
                <label>
                  <span>Label</span>
                  <input className="input" value={m.label || ''} onChange={e => onPatch(i, { label: e.target.value })} />
                </label>
                <label>
                  <span>Aggregate</span>
                  <select className="input" value={m.agg} onChange={e => onPatch(i, { agg: e.target.value })}>
                    {AGGREGATORS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </label>
                {agg?.needsField && (
                  <label>
                    <span>Of field</span>
                    <select className="input" value={m.field || ''} onChange={e => onPatch(i, { field: e.target.value })}>
                      <option value="">Choose a field</option>
                      {fields.filter(f => f.type === 'number' || m.agg === 'countDistinct').map(f => (
                        <option key={f.field} value={f.field}>{f.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <span>Number style</span>
                  <select className="input" value={m.format?.style || 'plain'} onChange={e => onPatch(i, { format: { ...m.format, style: e.target.value } })}>
                    {NUMBER_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                <div className="pivot-field-row">
                  <label>
                    <span>Decimals</span>
                    <select className="input" value={m.format?.decimals ?? 0} onChange={e => onPatch(i, { format: { ...m.format, decimals: Number(e.target.value) } })}>
                      {[0, 1, 2, 3].map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </label>
                  <label className="pivot-check">
                    <input type="checkbox" checked={Boolean(m.format?.currency)} onChange={e => onPatch(i, { format: { ...m.format, currency: e.target.checked } })} />
                    <span>₹ prefix</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )
      })}
      {!measures.length && <p className="pivot-zone-empty">Add at least one value</p>}
    </div>
  )
}

function FilterZone({ filters, rows, onDrop, onRemove, onPatch }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="pivot-zone" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      <div className="pivot-zone-head"><FilterIcon size={12} /> Filters<span>{filters.length}</span></div>
      {!filters.length && <p className="pivot-zone-empty">Drag a field here</p>}
      {filters.map((f, i) => {
        const options = [...new Set(rows.map(r => {
          const v = r[f.field]
          return v === null || v === undefined || v === '' ? BLANK : String(v)
        }))].sort().slice(0, 400)
        return (
          <div key={f.field} className="pivot-pill is-filter">
            <button type="button" className="pivot-pill-main" onClick={() => setOpen(open === i ? null : i)}>
              <span className="pivot-pill-label">{f.label}</span>
              <em>{f.values?.length ? `${f.mode === 'exclude' ? 'not ' : ''}${f.values.length}` : 'any'}</em>
            </button>
            <span className="pivot-pill-tools">
              <button type="button" title="Remove" onClick={() => onRemove(i)}><X size={11} /></button>
            </span>
            {open === i && (
              <div className="pivot-pill-panel">
                <label>
                  <span>Mode</span>
                  <select className="input" value={f.mode} onChange={e => onPatch(i, { mode: e.target.value })}>
                    <option value="include">Include selected</option>
                    <option value="exclude">Exclude selected</option>
                  </select>
                </label>
                <div className="pivot-filter-values">
                  {options.map(opt => (
                    <label key={opt} className="pivot-check">
                      <input
                        type="checkbox"
                        checked={(f.values || []).includes(opt)}
                        onChange={e => onPatch(i, {
                          values: e.target.checked
                            ? [...(f.values || []), opt]
                            : (f.values || []).filter(v => v !== opt)
                        })}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
                {(f.values || []).length > 0 && (
                  <button type="button" className="btn btn-ghost !py-1 !text-sm" onClick={() => onPatch(i, { values: [] })}>Clear selection</button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OptionsBar({ options, setOption }) {
  const toggles = [
    ['rowSubtotals', 'Row subtotals'],
    ['grandTotalRow', 'Grand total row'],
    ['grandTotalCol', 'Total column'],
    ['stripes', 'Banded rows'],
    ['heatmap', 'Heatmap'],
    ['compact', 'Compact rows']
  ]
  return (
    <div className="pivot-options">
      <label className="pivot-option-select">
        <span>Layout</span>
        <select className="input" value={options.layout} onChange={e => setOption('layout', e.target.value)}>
          {LAYOUTS.map(l => <option key={l.id} value={l.id} title={l.hint}>{l.label}</option>)}
        </select>
      </label>
      {toggles.map(([key, label]) => (
        <label key={key} className="pivot-check">
          <input type="checkbox" checked={Boolean(options[key])} onChange={e => setOption(key, e.target.checked)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

/* ==================================================================== *
 * Rendered table
 * ==================================================================== */

function PivotTable({ pivot, spec, onToggle }) {
  if (!pivot) return <Empty icon={<Table2 size={20} />} title="No data to pivot" subtitle="Nothing matched the current filters." />
  const { body, leaves, headerLevels, measures, grandCells, grandTotal, rowDims } = pivot
  const { options } = spec
  const tabular = options.layout === 'tabular'
  const labelCols = tabular ? Math.max(1, rowDims.length) : 1

  // Heatmap scales per measure across body cells only — including the grand
  // total would flatten every real cell to the palest step.
  const ranges = measures.map((m, mi) => {
    let min = Infinity, max = -Infinity
    for (const r of body) {
      if (r.kind === 'subtotal') continue
      for (const c of r.cells) {
        const v = c[mi]
        if (typeof v === 'number' && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v) }
      }
    }
    return Number.isFinite(min) ? { min, max } : null
  })

  const heat = (value, mi) => {
    if (!options.heatmap || typeof value !== 'number') return undefined
    const r = ranges[mi]
    if (!r || r.max === r.min) return undefined
    const t = (value - r.min) / (r.max - r.min)
    return { background: `color-mix(in srgb, var(--accent) ${Math.round(t * 26)}%, transparent)` }
  }

  return (
    <div className={`pivot-table-wrap ${options.compact ? 'is-compact' : ''} ${options.stripes ? 'is-striped' : ''}`}>
      <table className="pivot-table">
        <thead>
          {headerLevels.map((level, li) => (
            <tr key={li}>
              {li === 0 && <th className="pivot-corner" colSpan={labelCols} rowSpan={headerLevels.length || 1}>
                {rowDims.map(d => d.label).join(' › ') || 'All leads'}
              </th>}
              {level.map((cell, ci) => (
                <th key={`${cell.key}-${ci}`} colSpan={cell.span * measures.length} className="pivot-col-head">{cell.label}</th>
              ))}
              {li === 0 && options.grandTotalCol && (
                <th className="pivot-col-head is-total" colSpan={measures.length} rowSpan={headerLevels.length || 1}>Total</th>
              )}
            </tr>
          ))}
          <tr>
            {!headerLevels.length && <th className="pivot-corner" colSpan={labelCols}>{rowDims.map(d => d.label).join(' › ') || 'All leads'}</th>}
            {leaves.map((leaf, li) => measures.map(m => (
              <th key={`${li}-${m.id}`} className="pivot-measure-head">{m.label}</th>
            )))}
            {options.grandTotalCol && measures.map(m => (
              <th key={`t-${m.id}`} className="pivot-measure-head is-total">{m.label}</th>
            ))}
            {!headerLevels.length && options.grandTotalCol && null}
          </tr>
        </thead>

        <tbody>
          {body.map(row => {
            const depth = row.node.depth || 0
            const isSubtotal = row.kind === 'subtotal'
            return (
              <tr key={`${row.pathKey}-${row.kind}`} className={`pivot-row ${isSubtotal ? 'is-subtotal' : ''} depth-${depth}`}>
                {tabular
                  ? Array.from({ length: labelCols }).map((_, ci) => (
                    <td key={ci} className="pivot-row-head">
                      {ci === depth ? (isSubtotal ? `${row.node.label} total` : row.node.label) : ''}
                    </td>
                  ))
                  : (
                    <td className="pivot-row-head" style={{ paddingLeft: 10 + depth * 16 }}>
                      {row.hasChildren && !isSubtotal && (
                        <button type="button" className="pivot-toggle" onClick={() => onToggle(row.pathKey)} aria-label={row.collapsed ? 'Expand' : 'Collapse'}>
                          {row.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        </button>
                      )}
                      <span>{isSubtotal ? `${row.node.label} total` : row.node.label}</span>
                    </td>
                  )}
                {row.cells.map((cell, ci) => cell.map((value, mi) => (
                  <td key={`${ci}-${mi}`} className="pivot-cell" style={heat(value, mi)}>
                    {formatValue(value, measures[mi].format)}
                  </td>
                )))}
                {options.grandTotalCol && row.total.map((value, mi) => (
                  <td key={`rt-${mi}`} className="pivot-cell is-total">{formatValue(value, measures[mi].format)}</td>
                ))}
              </tr>
            )
          })}
        </tbody>

        {options.grandTotalRow && (
          <tfoot>
            <tr className="pivot-row is-grand">
              <td className="pivot-row-head" colSpan={labelCols}>Grand total</td>
              {grandCells.map((cell, ci) => cell.map((value, mi) => (
                <td key={`g-${ci}-${mi}`} className="pivot-cell">{formatValue(value, measures[mi].format)}</td>
              )))}
              {options.grandTotalCol && grandTotal.map((value, mi) => (
                <td key={`gt-${mi}`} className="pivot-cell is-total">{formatValue(value, measures[mi].format)}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
