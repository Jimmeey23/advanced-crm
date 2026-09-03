import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2, Eye, EyeOff, ArrowUp, ArrowDown, Plus, Trash2, X, Sigma, Link2 } from 'lucide-react'

export const BASE_FIELD_OPTIONS = [
  { id: 'phone', label: 'Phone' }, { id: 'source', label: 'Source' }, { id: 'owner', label: 'Owner' },
  { id: 'location', label: 'Location' }, { id: 'score', label: 'AI score' }, { id: 'risk', label: 'AI risk' },
  { id: 'valueEstimate', label: 'Value estimate' }, { id: 'classType', label: 'Class type' },
  { id: 'missedCount', label: 'Missed follow-ups' }, { id: 'lastOutreachDays', label: 'Days since outreach' },
  { id: 'created', label: 'Created date' }, { id: 'remarks', label: 'Remarks' },
  { id: 'stage', label: 'Stage' }, { id: 'status', label: 'Outcome' }, { id: 'statusGroup', label: 'Status' },
  { id: 'trialDate', label: 'Trial date' }, { id: 'firstPurchaseDate', label: 'First purchase' }
]

export const DEFAULT_COLUMNS = [
  { id: 'phone', kind: 'base', field: 'phone', label: 'Phone', type: 'text', hidden: false },
  { id: 'source', kind: 'base', field: 'source', label: 'Source', type: 'text', hidden: false },
  { id: 'owner', kind: 'base', field: 'owner', label: 'Owner', type: 'text', hidden: false },
  { id: 'location', kind: 'base', field: 'location', label: 'Location', type: 'text', hidden: false },
  { id: 'score', kind: 'base', field: 'score', label: 'Score', type: 'number', decimals: 0, unit: '', hidden: false },
  { id: 'statusGroup', kind: 'base', field: 'statusGroup', label: 'Status', type: 'text', hidden: false },
  { id: 'trialDate', kind: 'base', field: 'trialDate', label: 'Trial date', type: 'date', hidden: false },
  { id: 'firstPurchaseDate', kind: 'base', field: 'firstPurchaseDate', label: 'First purchase', type: 'date', hidden: false },
  { id: 'valueEstimate', kind: 'base', field: 'valueEstimate', label: 'Value', type: 'currency', decimals: 0, hidden: true },
  { id: 'classType', kind: 'base', field: 'classType', label: 'Class type', type: 'text', hidden: true },
  { id: 'missedCount', kind: 'base', field: 'missedCount', label: 'Missed follow-ups', type: 'number', decimals: 0, unit: '', hidden: true },
  // ---- Momence sales. Shown by default only where they answer the question
  // the table exists to answer: did this lead convert, and for how much.
  { id: 'conversionLabel', kind: 'base', field: 'conversionLabel', label: 'Conversion', type: 'text', hidden: false },
  { id: 'lifetimeValue', kind: 'base', field: 'lifetimeValue', label: 'Lifetime value', type: 'currency', decimals: 0, hidden: false },
  { id: 'purchaseCount', kind: 'base', field: 'purchaseCount', label: 'Purchases', type: 'number', decimals: 0, unit: '', hidden: false },
  { id: 'lastPurchaseDate', kind: 'base', field: 'lastPurchaseDate', label: 'Last purchase', type: 'date', hidden: true },
  { id: 'averageOrderValue', kind: 'base', field: 'averageOrderValue', label: 'Avg order value', type: 'currency', decimals: 0, hidden: true },
  { id: 'firstPurchaseItem', kind: 'base', field: 'firstPurchaseItem', label: 'First item bought', type: 'text', hidden: true },
  { id: 'firstPurchaseDateSales', kind: 'base', field: 'firstPurchaseDate', label: 'First purchase (paid)', type: 'date', hidden: true },
  { id: 'lastPurchaseItem', kind: 'base', field: 'lastPurchaseItem', label: 'Last item bought', type: 'text', hidden: true },
  { id: 'itemGroups', kind: 'base', field: 'itemGroups', label: 'What they bought', type: 'text', hidden: true },
  { id: 'daysToConvert', kind: 'base', field: 'daysToConvert', label: 'Days to convert', type: 'number', decimals: 0, unit: '', hidden: true },
  { id: 'daysSincePurchase', kind: 'base', field: 'daysSincePurchase', label: 'Days since purchase', type: 'number', decimals: 0, unit: '', hidden: true },
  { id: 'discountTotal', kind: 'base', field: 'discountTotal', label: 'Discount given', type: 'currency', decimals: 0, hidden: true },
  { id: 'discountCodes', kind: 'base', field: 'discountCodes', label: 'Discount codes', type: 'text', hidden: true },
  { id: 'refundedTotal', kind: 'base', field: 'refundedTotal', label: 'Refunded', type: 'currency', decimals: 0, hidden: true },
  { id: 'paidInCredits', kind: 'base', field: 'paidInCredits', label: 'Paid in credits', type: 'currency', decimals: 0, hidden: true },
  { id: 'purchaseLocations', kind: 'base', field: 'purchaseLocations', label: 'Bought at', type: 'text', hidden: true }
]

const TYPES = [
  { id: 'text', label: 'Text' }, { id: 'number', label: 'Number' },
  { id: 'currency', label: 'Currency' }, { id: 'percent', label: 'Percent' }, { id: 'date', label: 'Date' }
]

let uidSeq = 0
const newId = () => `col_${Date.now().toString(36)}_${(uidSeq++).toString(36)}`

export default function ColumnManager({ columns, setColumns }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(null) // 'formula' | 'lookup' | null
  useEffect(() => {
    if (!open) return
    const close = event => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open])

  const move = (idx, dir) => setColumns(cols => {
    const next = [...cols]
    const target = idx + dir
    if (target < 0 || target >= next.length) return cols
    ;[next[idx], next[target]] = [next[target], next[idx]]
    return next
  })
  const toggleHidden = (idx) => setColumns(cols => cols.map((c, i) => i === idx ? { ...c, hidden: !c.hidden } : c))
  const removeCol = (idx) => setColumns(cols => cols.filter((_, i) => i !== idx))
  const patchCol = (idx, patch) => setColumns(cols => cols.map((c, i) => i === idx ? { ...c, ...patch } : c))

  const addFormula = (label, formula, type) => {
    setColumns(cols => [...cols, { id: newId(), kind: 'formula', label, formula, type, decimals: 0, unit: '', hidden: false }])
    setAdding(null)
  }
  const addLookup = (label, relatedTable, relatedField, type) => {
    setColumns(cols => [...cols, { id: newId(), kind: 'lookup', label, relatedTable, relatedField, type, decimals: 0, unit: '', hidden: false }])
    setAdding(null)
  }

  return (
    <div className="relative inline-block">
      <button className={`btn ${open ? 'btn-soft' : 'btn-ghost'} !py-2`} onClick={() => setOpen(true)} aria-expanded={open} aria-haspopup="dialog">
        <Settings2 size={14} /> Columns
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" role="dialog" aria-label="Manage table columns">
          <div className="absolute inset-0 modal-backdrop" onClick={() => setOpen(false)} />
          <div className="relative card modal-panel column-manager-modal w-full max-w-[520px] shadow-2xl overflow-hidden" style={{ animation: 'fadeIn .12s ease' }}>
            <div className="modal-header flex items-start justify-between px-5 pt-5 pb-3 !mb-0">
              <div>
                <div className="font-display font-semibold text-white text-md">Manage columns</div>
                <p className="text-xs text-slate-500 mt-0.5">Show, hide, reorder, format, and add lead table columns.</p>
              </div>
              <button className="btn btn-ghost modal-close !p-1.5" onClick={() => setOpen(false)}><X size={14} /></button>
            </div>
            <div className="max-h-[48vh] overflow-y-auto scrollbar-thin p-3 space-y-1.5">
              {columns.map((c, idx) => (
                <ColumnRow key={c.id} col={c} idx={idx} last={idx === columns.length - 1}
                  move={move} toggleHidden={toggleHidden} removeCol={removeCol} patchCol={patchCol} />
              ))}
            </div>
            <div className="p-4 border-t border-white/8 space-y-2 bg-white/[0.02]">
              {!adding && (
                <div className="flex gap-2">
                  <button className="btn btn-ghost flex-1 !py-1.5 !text-sm" onClick={() => setAdding('formula')}><Sigma size={13} /> Formula column</button>
                  <button className="btn btn-ghost flex-1 !py-1.5 !text-sm" onClick={() => setAdding('lookup')}><Link2 size={13} /> Related column</button>
                </div>
              )}
              {adding === 'formula' && <FormulaForm onAdd={addFormula} onCancel={() => setAdding(null)} />}
              {adding === 'lookup' && <LookupForm onAdd={addLookup} onCancel={() => setAdding(null)} />}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function ColumnRow({ col, idx, last, move, toggleHidden, removeCol, patchCol }) {
  const [editing, setEditing] = useState(false)
  const custom = col.kind !== 'base'
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
      <div className="flex items-center gap-1.5">
        <div className="flex flex-col">
          <button className="text-slate-500 hover:text-white disabled:opacity-30" disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp size={11} /></button>
          <button className="text-slate-500 hover:text-white disabled:opacity-30" disabled={last} onClick={() => move(idx, 1)}><ArrowDown size={11} /></button>
        </div>
        <span className="flex-1 text-sm text-slate-200 truncate">{col.label}</span>
        {col.kind === 'formula' && <span className="chip !px-1.5 !py-0.5 text-2xs bg-fuchsia-500/15 text-fuchsia-300">fx</span>}
        {col.kind === 'lookup' && <span className="chip !px-1.5 !py-0.5 text-2xs bg-cyan-500/15 text-cyan-300">rel</span>}
        <button className="btn btn-ghost !p-1.5" onClick={() => setEditing(e => !e)} title="Format"><Settings2 size={12} /></button>
        <button className="btn btn-ghost !p-1.5" onClick={() => toggleHidden(idx)} title={col.hidden ? 'Show' : 'Hide'}>
          {col.hidden ? <EyeOff size={12} className="text-slate-500" /> : <Eye size={12} className="text-emerald-400" />}
        </button>
        {custom && <button className="btn btn-ghost !p-1.5 text-rose-400" onClick={() => removeCol(idx)}><Trash2 size={12} /></button>}
      </div>
      {editing && (
        <div className="mt-2 pt-2 border-t border-white/6 flex flex-wrap items-center gap-2">
          <select className="input !w-auto !py-1 !text-xs" value={col.type} onChange={e => patchCol(idx, { type: e.target.value })}>
            {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {(col.type === 'number' || col.type === 'currency' || col.type === 'percent') && (
            <input className="input !w-[70px] !py-1 !text-xs" type="number" min={0} max={4} placeholder="decimals"
              value={col.decimals ?? 0} onChange={e => patchCol(idx, { decimals: Number(e.target.value) })} />
          )}
          {col.type === 'number' && (
            <input className="input !w-[80px] !py-1 !text-xs" placeholder="unit" value={col.unit || ''} onChange={e => patchCol(idx, { unit: e.target.value })} />
          )}
        </div>
      )}
    </div>
  )
}

function FormulaForm({ onAdd, onCancel }) {
  const [label, setLabel] = useState('')
  const [formula, setFormula] = useState('')
  const [type, setType] = useState('number')
  return (
    <div className="space-y-2">
      <input className="input !py-1.5 !text-sm" placeholder="Column name (e.g. Commission)" value={label} onChange={e => setLabel(e.target.value)} />
      <input className="input !py-1.5 !text-sm mono" placeholder="Formula (e.g. valueEstimate * 0.1)" value={formula} onChange={e => setFormula(e.target.value)} />
      <div className="text-xs text-slate-500">Fields: fullName, phone, email, source, owner, location, score, risk, valueEstimate, classType, missedCount, lastOutreachDays, created, remarks, stage, status</div>
      <div className="flex items-center gap-2">
        <select className="input !w-auto !py-1.5 !text-sm" value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button className="btn btn-primary !py-1.5 !text-sm ml-auto" disabled={!label || !formula} onClick={() => onAdd(label, formula, type)}><Plus size={13} /> Add</button>
        <button className="btn btn-ghost !py-1.5 !text-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function LookupForm({ onAdd, onCancel }) {
  const [label, setLabel] = useState('')
  const [relatedTable, setRelatedTable] = useState('associate')
  const [relatedField, setRelatedField] = useState('name')
  const [type, setType] = useState('text')
  const fieldsFor = relatedTable === 'associate'
    ? [{ id: 'name', label: 'Name' }, { id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' }, { id: 'revenueTargetMonthly', label: 'Monthly revenue target' }, { id: 'conversionTargetPct', label: 'Conversion target %' }, { id: 'locationIds', label: 'Studio IDs' }]
    : [{ id: 'name', label: 'Name' }, { id: 'city', label: 'City' }, { id: 'active', label: 'Active' }]
  return (
    <div className="space-y-2">
      <input className="input !py-1.5 !text-sm" placeholder="Column name (e.g. Owner target)" value={label} onChange={e => setLabel(e.target.value)} />
      <div className="flex items-center gap-2">
        <select className="input !w-auto !py-1.5 !text-sm" value={relatedTable} onChange={e => { setRelatedTable(e.target.value); setRelatedField('name') }}>
          <option value="associate">Associate</option>
          <option value="location">Location</option>
        </select>
        <select className="input !w-auto !py-1.5 !text-sm" value={relatedField} onChange={e => setRelatedField(e.target.value)}>
          {fieldsFor.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <select className="input !w-auto !py-1.5 !text-sm" value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button className="btn btn-primary !py-1.5 !text-sm ml-auto" disabled={!label} onClick={() => onAdd(label, relatedTable, relatedField, type)}><Plus size={13} /> Add</button>
        <button className="btn btn-ghost !py-1.5 !text-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
