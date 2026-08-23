import React, { useState } from 'react'
import { Plus, Save, X, ChevronUp, ChevronDown } from 'lucide-react'

// Shared by lead webhooks and the Google Sheets import — both feed an
// external {key: value} record through the same server-side alias/mapping
// resolver, so they share this editor rather than forking the UI.
export const LEAD_FIELD_OPTIONS = [
  { id: 'fullName', label: 'Full name' },
  { id: 'firstName', label: 'First name' },
  { id: 'lastName', label: 'Last name' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'createdAt', label: 'Created at' },
  { id: 'convertedAt', label: 'Converted at' },
  { id: 'sourceId', label: 'Source ID' },
  { id: 'source', label: 'Source' },
  { id: 'notes', label: 'Notes' },
  { id: 'classType', label: 'Class type' },
  { id: 'channel', label: 'Channel' },
  { id: 'stage', label: 'Stage' },
  { id: 'status', label: 'Status' },
  { id: 'valueEstimate', label: 'Value estimate' },
  { id: 'associateId', label: 'Associate ID' },
  { id: 'associateName', label: 'Owner / associate name' },
  { id: 'locationId', label: 'Location ID' },
  { id: 'center', label: 'Center' },
  { id: 'memberId', label: 'Member ID' },
  { id: 'hostId', label: 'Host ID' },
  { id: 'period', label: 'Period' },
  { id: 'purchasesMade', label: 'Purchases made' },
  { id: 'visits', label: 'Visits' },
  { id: 'trialStatus', label: 'Trial status' },
  { id: 'conversionStatus', label: 'Conversion status' },
  { id: 'retentionStatus', label: 'Retention status' }
]

export default function FieldMappingEditor({
  fieldMapping, defaults, onSaveMapping, onSaveDefaults,
  keyLabel = 'incoming key', keyPlaceholder = 'incoming key, e.g. full_name',
  fieldOptions = LEAD_FIELD_OPTIONS
}) {
  const [mapping, setMapping] = useState(() => Object.entries(fieldMapping || {}).map(([k, v]) => ({ key: k, field: v })))
  const [mappingDirty, setMappingDirty] = useState(false)
  const [defs, setDefs] = useState(() => Object.entries(defaults || {}).map(([k, v]) => ({ field: k, value: v })))
  const [defaultsDirty, setDefaultsDirty] = useState(false)

  const addRow = () => { setMapping(m => [...m, { key: '', field: fieldOptions[0]?.id || '' }]); setMappingDirty(true) }
  const updateRow = (i, patch) => { setMapping(m => m.map((r, idx) => idx === i ? { ...r, ...patch } : r)); setMappingDirty(true) }
  const removeRow = (i) => { setMapping(m => m.filter((_, idx) => idx !== i)); setMappingDirty(true) }
  // Order matters when two rows target the same lead field — the first one
  // wins at resolve time — so letting the admin reorder is how they pick
  // which of two overlapping sheet columns/keys actually takes precedence.
  const moveRow = (i, dir) => {
    setMapping(m => {
      const j = i + dir
      if (j < 0 || j >= m.length) return m
      const next = m.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setMappingDirty(true)
  }
  const saveMapping = () => {
    const obj = {}
    for (const r of mapping) if (r.key.trim()) obj[r.key.trim()] = r.field
    onSaveMapping(obj)
    setMappingDirty(false)
  }

  const addDefault = () => { setDefs(d => [...d, { field: fieldOptions[0]?.id || '', value: '' }]); setDefaultsDirty(true) }
  const updateDefault = (i, patch) => { setDefs(d => d.map((r, idx) => idx === i ? { ...r, ...patch } : r)); setDefaultsDirty(true) }
  const removeDefault = (i) => { setDefs(d => d.filter((_, idx) => idx !== i)); setDefaultsDirty(true) }
  const saveDefaults = () => {
    const obj = {}
    for (const r of defs) if (r.field && String(r.value).trim()) obj[r.field] = r.value
    onSaveDefaults(obj)
    setDefaultsDirty(false)
  }

  return (
    <>
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Field mapping — {keyLabel} → lead field</div>
        <div className="space-y-1.5">
          {mapping.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex flex-col shrink-0">
                <button className="btn btn-ghost !p-0.5 !min-h-0 disabled:opacity-20" onClick={() => moveRow(i, -1)} disabled={i === 0} title="Move up"><ChevronUp size={11} /></button>
                <button className="btn btn-ghost !p-0.5 !min-h-0 disabled:opacity-20" onClick={() => moveRow(i, 1)} disabled={i === mapping.length - 1} title="Move down"><ChevronDown size={11} /></button>
              </div>
              <input className="input !py-1.5 !text-[12px] flex-1" placeholder={keyPlaceholder} value={r.key} onChange={e => updateRow(i, { key: e.target.value })} />
              <span className="text-slate-600 text-[11px]">→</span>
              <select className="input !py-1.5 !text-[12px] !w-auto" value={r.field} onChange={e => updateRow(i, { field: e.target.value })}>
                {fieldOptions.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <button className="btn btn-ghost !p-1.5 text-rose-400" onClick={() => removeRow(i)}><X size={12} /></button>
            </div>
          ))}
          {!mapping.length && <p className="text-[11px] text-slate-600">No manual mapping — common key spellings (name/full_name, phone/mobile, email, etc.) are auto-detected.</p>}
          {mapping.length > 1 && <p className="text-[10.5px] text-slate-600">Order matters if two rows target the same lead field — the top one wins. Use the arrows to reorder.</p>}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={addRow}><Plus size={12} /> Add field</button>
          {mappingDirty && <button className="btn btn-soft !py-1.5 !text-[12px]" onClick={saveMapping}><Save size={12} /> Save mapping</button>}
        </div>
      </div>

      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Default values — used when the source omits a field</div>
        <div className="space-y-1.5">
          {defs.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <select className="input !py-1.5 !text-[12px] !w-auto" value={r.field} onChange={e => updateDefault(i, { field: e.target.value })}>
                {fieldOptions.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <span className="text-slate-600 text-[11px]">=</span>
              <input className="input !py-1.5 !text-[12px] flex-1" placeholder="fixed value" value={r.value} onChange={e => updateDefault(i, { value: e.target.value })} />
              <button className="btn btn-ghost !p-1.5 text-rose-400" onClick={() => removeDefault(i)}><X size={12} /></button>
            </div>
          ))}
          {!defs.length && <p className="text-[11px] text-slate-600">No defaults set.</p>}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={addDefault}><Plus size={12} /> Add default</button>
          {defaultsDirty && <button className="btn btn-soft !py-1.5 !text-[12px]" onClick={saveDefaults}><Save size={12} /> Save defaults</button>}
        </div>
      </div>
    </>
  )
}
