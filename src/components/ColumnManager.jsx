import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2, Eye, EyeOff, ArrowUp, ArrowDown, Plus, Trash2, X, Sigma, Link2 } from 'lucide-react'

export const BASE_FIELD_OPTIONS = [
  { id: 'phone', label: 'Phone' }, { id: 'source', label: 'Source' }, { id: 'owner', label: 'Owner' },
  { id: 'location', label: 'Location' }, { id: 'score', label: 'AI score' }, { id: 'risk', label: 'AI risk' },
  { id: 'valueEstimate', label: 'Value estimate' }, { id: 'classType', label: 'Class type' },
  { id: 'missedCount', label: 'Missed follow-ups' }, { id: 'lastOutreachDays', label: 'Days since outreach' },
  { id: 'created', label: 'Created date' }, { id: 'remarks', label: 'Remarks' },
  { id: 'stage', label: 'Stage' }, { id: 'status', label: 'Status' }
]

export const DEFAULT_COLUMNS = [
  { id: 'phone', kind: 'base', field: 'phone', label: 'Phone', type: 'text', hidden: false },
  { id: 'source', kind: 'base', field: 'source', label: 'Source', type: 'text', hidden: false },
  { id: 'owner', kind: 'base', field: 'owner', label: 'Owner', type: 'text', hidden: false },
  { id: 'location', kind: 'base', field: 'location', label: 'Location', type: 'text', hidden: false },
  { id: 'score', kind: 'base', field: 'score', label: 'Score', type: 'number', decimals: 0, unit: '', hidden: false },
  { id: 'valueEstimate', kind: 'base', field: 'valueEstimate', label: 'Value', type: 'currency', decimals: 0, hidden: true },
  { id: 'classType', kind: 'base', field: 'classType', label: 'Class type', type: 'text', hidden: true },
  { id: 'missedCount', kind: 'base', field: 'missedCount', label: 'Missed follow-ups', type: 'number', decimals: 0, unit: '', hidden: true }
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
      <button className={`btn ${open ? 'btn-soft' : 'btn-ghost'} !py-2`} onClick={() => setOpen(o => !o)}>
        <Settings2 size={14} /> Columns
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[95]" onClick={() => setOpen(false)} />
          <div className="fixed right-6 top-[130px] w-[380px] card z-[96] shadow-2xl overflow-hidden" style={{ background: 'var(--tt-bg)', animation: 'fadeIn .12s ease' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
              <div className="font-display font-semibold text-white text-[13.5px]">Manage columns</div>
              <button className="btn btn-ghost !p-1.5" onClick={() => setOpen(false)}><X size={14} /></button>
            </div>
            <div className="max-h-[380px] overflow-y-auto scrollbar-thin p-2 space-y-1">
              {columns.map((c, idx) => (
                <ColumnRow key={c.id} col={c} idx={idx} last={idx === columns.length - 1}
                  move={move} toggleHidden={toggleHidden} removeCol={removeCol} patchCol={patchCol} />
              ))}
            </div>
            <div className="p-3 border-t border-white/8 space-y-2">
              {!adding && (
                <div className="flex gap-2">
                  <button className="btn btn-ghost flex-1 !py-1.5 !text-[12px]" onClick={() => setAdding('formula')}><Sigma size={13} /> Formula column</button>
                  <button className="btn btn-ghost flex-1 !py-1.5 !text-[12px]" onClick={() => setAdding('lookup')}><Link2 size={13} /> Related column</button>
                </div>
              )}
              {adding === 'formula' && <FormulaForm onAdd={addFormula} onCancel={() => setAdding(null)} />}
              {adding === 'lookup' && <LookupForm onAdd={addLookup} onCancel={() => setAdding(null)} />}
            </div>
          </div>
        </>,
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
        <span className="flex-1 text-[12.5px] text-slate-200 truncate">{col.label}</span>
        {col.kind === 'formula' && <span className="chip !px-1.5 !py-0.5 text-[9px] bg-fuchsia-500/15 text-fuchsia-300">fx</span>}
        {col.kind === 'lookup' && <span className="chip !px-1.5 !py-0.5 text-[9px] bg-cyan-500/15 text-cyan-300">rel</span>}
        <button className="btn btn-ghost !p-1.5" onClick={() => setEditing(e => !e)} title="Format"><Settings2 size={12} /></button>
        <button className="btn btn-ghost !p-1.5" onClick={() => toggleHidden(idx)} title={col.hidden ? 'Show' : 'Hide'}>
          {col.hidden ? <EyeOff size={12} className="text-slate-500" /> : <Eye size={12} className="text-emerald-400" />}
        </button>
        {custom && <button className="btn btn-ghost !p-1.5 text-rose-400" onClick={() => removeCol(idx)}><Trash2 size={12} /></button>}
      </div>
      {editing && (
        <div className="mt-2 pt-2 border-t border-white/6 flex flex-wrap items-center gap-2">
          <select className="input !w-auto !py-1 !text-[11.5px]" value={col.type} onChange={e => patchCol(idx, { type: e.target.value })}>
            {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {(col.type === 'number' || col.type === 'currency' || col.type === 'percent') && (
            <input className="input !w-[70px] !py-1 !text-[11.5px]" type="number" min={0} max={4} placeholder="decimals"
              value={col.decimals ?? 0} onChange={e => patchCol(idx, { decimals: Number(e.target.value) })} />
          )}
          {col.type === 'number' && (
            <input className="input !w-[80px] !py-1 !text-[11.5px]" placeholder="unit" value={col.unit || ''} onChange={e => patchCol(idx, { unit: e.target.value })} />
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
      <input className="input !py-1.5 !text-[12px]" placeholder="Column name (e.g. Commission)" value={label} onChange={e => setLabel(e.target.value)} />
      <input className="input !py-1.5 !text-[12px] mono" placeholder="Formula (e.g. valueEstimate * 0.1)" value={formula} onChange={e => setFormula(e.target.value)} />
      <div className="text-[10.5px] text-slate-500">Fields: fullName, phone, email, source, owner, location, score, risk, valueEstimate, classType, missedCount, lastOutreachDays, created, remarks, stage, status</div>
      <div className="flex items-center gap-2">
        <select className="input !w-auto !py-1.5 !text-[12px]" value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button className="btn btn-primary !py-1.5 !text-[12px] ml-auto" disabled={!label || !formula} onClick={() => onAdd(label, formula, type)}><Plus size={13} /> Add</button>
        <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={onCancel}>Cancel</button>
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
    ? [{ id: 'name', label: 'Name' }, { id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' }, { id: 'targetMonthly', label: 'Monthly target' }, { id: 'locationId', label: 'Location ID' }]
    : [{ id: 'name', label: 'Name' }, { id: 'city', label: 'City' }, { id: 'active', label: 'Active' }]
  return (
    <div className="space-y-2">
      <input className="input !py-1.5 !text-[12px]" placeholder="Column name (e.g. Owner target)" value={label} onChange={e => setLabel(e.target.value)} />
      <div className="flex items-center gap-2">
        <select className="input !w-auto !py-1.5 !text-[12px]" value={relatedTable} onChange={e => { setRelatedTable(e.target.value); setRelatedField('name') }}>
          <option value="associate">Associate</option>
          <option value="location">Location</option>
        </select>
        <select className="input !w-auto !py-1.5 !text-[12px]" value={relatedField} onChange={e => setRelatedField(e.target.value)}>
          {fieldsFor.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <select className="input !w-auto !py-1.5 !text-[12px]" value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button className="btn btn-primary !py-1.5 !text-[12px] ml-auto" disabled={!label} onClick={() => onAdd(label, relatedTable, relatedField, type)}><Plus size={13} /> Add</button>
        <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
