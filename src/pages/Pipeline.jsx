import React, { useMemo, useState } from 'react'
import { Search, GripVertical, Clock, Users, KanbanSquare, Layers } from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api, buildQuery } from '../api.js'
import { Avatar, ScorePill } from '../ui.jsx'
import { stageClass, stageBadgeStyle, stageColor, riskClass, fmtDate, daysFromNow, currentMonthRange } from '../lib.js'

const GROUP_FIELDS = [
  { id: 'stage', label: 'Stage' },
  { id: 'owner', label: 'Owner' },
  { id: 'status', label: 'Status' },
  { id: 'source', label: 'Source' },
  { id: 'location', label: 'Location' }
]
const COLUMN_PALETTE = ['#f43f5e', '#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#6366f1', '#14b8a6', '#f97316']

export default function Pipeline() {
  const { boot, lookup, openLead, refreshData, toast, dataVersion } = useApp()
  const [locationId, setLocationId] = useState('')
  const [associateId, setAssociateId] = useState('')
  const [search, setSearch] = useState('')
  const [hideEmpty, setHideEmpty] = useState(true)
  const [dragId, setDragId] = useState(null)
  const [groupBy, setGroupBy] = useState('stage')
  // Default view is current-month leads only; "All time" lifts the date scope.
  const [thisMonthOnly, setThisMonthOnly] = useState(true)
  const monthRange = thisMonthOnly ? currentMonthRange() : { dateFrom: '', dateTo: '' }

  const q = buildQuery({ locationId, associateId, search: search.trim() || undefined, ...monthRange, pageSize: 600 })
  const { data, loading } = useFetch(() => api.get(`/api/leads?${q}`), [q, dataVersion])
  const items = data?.items || []

  // Each segregator defines its bucket list, how to read a lead's bucket
  // key, and the patch to send when a card is dropped on a bucket — that's
  // the whole difference between "group by stage" and "group by owner".
  const groupDefs = {
    stage: {
      buckets: (boot?.stages || []).map(s => ({ key: s, label: s })),
      keyOf: l => l.stage,
      patchFor: key => ({ stage: key })
    },
    status: {
      buckets: [{ key: 'open', label: 'Open' }, { key: 'won', label: 'Won' }, { key: 'lost', label: 'Lost' }],
      keyOf: l => l.status || 'open',
      patchFor: key => ({ status: key })
    },
    owner: {
      buckets: [{ key: '', label: 'Unassigned' }, ...(boot?.associates || []).filter(a => a.active !== false).map(a => ({ key: a.id, label: a.name, color: a.color }))],
      keyOf: l => l.associateId || '',
      patchFor: key => ({ associateId: key || null })
    },
    source: {
      buckets: [{ key: '', label: 'No source' }, ...(boot?.sources || []).map(s => { const name = typeof s === 'string' ? s : s.name; return { key: name, label: name } })],
      keyOf: l => l.sourceName || '',
      patchFor: key => ({ sourceName: key })
    },
    location: {
      buckets: (boot?.locations || []).filter(loc => loc.active !== false).map(loc => ({ key: loc.id, label: loc.name })),
      keyOf: l => l.locationId,
      patchFor: key => ({ locationId: key })
    }
  }
  const def = groupDefs[groupBy]

  const columns = useMemo(() => {
    const map = {}
    for (const l of items) { const k = def.keyOf(l); (map[k] = map[k] || []).push(l) }
    return def.buckets
      .map((b, i) => ({ ...b, leads: map[b.key] || [], color: b.color || COLUMN_PALETTE[i % COLUMN_PALETTE.length] }))
      .filter(c => dragId || !hideEmpty || c.leads.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, groupBy, hideEmpty, dragId])

  const moveToBucket = async (leadId, key) => {
    setDragId(null)
    try {
      await api.patch(`/api/leads/${leadId}`, def.patchFor(key))
      refreshData()
    } catch (e) { toast(e.message, 'error') }
  }

  const total = data?.total ?? 0
  const won = items.filter(l => l.status === 'won').length
  const lost = items.filter(l => l.status === 'lost').length
  const open = total - won - lost

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-white text-[19px] flex items-center gap-2"><KanbanSquare size={20} className="text-rose-400" /> Sales Pipeline</h2>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Drag any lead card to a column to change its {GROUP_FIELDS.find(g => g.id === groupBy)?.label.toLowerCase()}.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip bg-white/5 border border-white/10 text-slate-300"><Users size={12} /> {total} leads</span>
          <span className="chip bg-emerald-500/10 border border-emerald-400/25 text-emerald-300">{won} won</span>
          <span className="chip bg-slate-500/10 border border-slate-400/20 text-slate-400">{open} open</span>
          {lost > 0 && <span className="chip bg-rose-500/10 border border-rose-400/25 text-rose-300">{lost} lost</span>}
        </div>
      </div>

      {/* toolbar */}
      <div className="px-6 pt-3 pb-3 flex flex-wrap items-center gap-3 border-b border-white/6">
        <div className="relative w-[240px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input !pl-9" placeholder="Search leads…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-2 py-1.5">
          <Layers size={13} className="text-slate-500 shrink-0" />
          <select className="input !w-auto !py-0 !text-[12px] !border-0 !bg-transparent" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
            {GROUP_FIELDS.map(g => <option key={g.id} value={g.id}>Group by: {g.label}</option>)}
          </select>
        </div>
        <select className="input !w-auto" value={locationId} onChange={e => setLocationId(e.target.value)}>
          <option value="">All locations</option>
          {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="input !w-auto" value={associateId} onChange={e => setAssociateId(e.target.value)}>
          <option value="">All associates</option>
          {(boot?.associates || []).filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button type="button" className={`btn ${thisMonthOnly ? 'btn-soft' : 'btn-ghost'} !py-2`} title={thisMonthOnly ? 'Showing this month only — click to show all time' : 'Showing all time — click to scope to this month'} onClick={() => setThisMonthOnly(v => !v)}>
          {thisMonthOnly ? 'This month' : 'All time'}
        </button>
        <label className="flex items-center gap-2 text-[12px] text-slate-400 cursor-pointer select-none ml-auto">
          <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} className="accent-rose-500" />
          Hide empty columns
        </label>
      </div>

      {loading && <div className="px-6 py-8 text-slate-500">Loading pipeline…</div>}

      <div className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin px-6 pb-6 pt-4">
        <div className="flex gap-4 h-full min-h-[420px]">
          {columns.map(col => {
            const count = col.leads.length
            return (
              <div
                key={col.key || 'none'}
                className={`pipeline-column flex flex-col w-[306px] shrink-0 rounded-2xl bg-white/[0.028] border border-white/6 ${dragId ? 'is-dragging' : ''}`}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.style.borderColor = 'rgba(244,63,94,.5)' }}
                onDragLeave={e => { e.currentTarget.style.borderColor = '' }}
                onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = ''; const id = e.dataTransfer.getData('text/lead'); if (id) moveToBucket(id, col.key) }}
              >
                <div className="pipeline-column-head px-3.5 py-3.5 flex items-center gap-2.5 border-b-2" style={{ borderBottomColor: col.color }}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col.color }} />
                  <div className="min-w-0 flex-1">
                    {groupBy === 'stage' ? (
                      <>
                        <div className={`pipeline-stage-badge ${stageClass(col.key)}`} style={stageBadgeStyle(col.key)} title={col.key}>{col.label}</div>
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">{(boot?.stageStatusGroups || {})[col.key]}</div>
                      </>
                    ) : (
                      <div className="font-display font-bold text-white text-[13.5px] truncate" title={col.label}>{col.label}</div>
                    )}
                  </div>
                  <span className="shrink-0 chip bg-white/6 border border-white/10 text-slate-300 mono !py-0.5 !px-2 text-[11.5px] font-semibold">{count}</span>
                </div>
                <div className="flex-1 px-2 pb-2 pt-2 space-y-2 overflow-y-auto scrollbar-thin">
                  {col.leads.map(l => (
                    <LeadCard key={l.id} lead={l} lookup={lookup} openLead={openLead} onDragStart={setDragId} />
                  ))}
                  {count === 0 && <div className="pipeline-drop-empty">Drop lead cards here</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function LeadCard({ lead, lookup, openLead, onDragStart }) {
  const owner = lookup.asnById[lead.associateId]
  const nextFu = lead.followUps?.find(f => f.date && !f.done && f.date !== '-')
  const dueIn = nextFu ? daysFromNow(nextFu.date) : null
  const overdue = dueIn !== null && dueIn < 0

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/lead', lead.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(lead.id) }}
      onDragEnd={() => onDragStart(null)}
      onClick={() => openLead(lead.id)}
      className="pipeline-lead-card card card-hover !rounded-xl p-3 cursor-grab active:cursor-grabbing select-none"
    >
      <div className="flex items-start gap-2 mb-2">
        <Avatar name={lead.fullName} color={owner?.color} size={30} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white truncate">{lead.fullName}</div>
          <div className="text-[11px] text-slate-500 truncate">{lead.phone || lead.email}</div>
        </div>
        <ScorePill score={lead.ai.score} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip bg-white/5 border border-white/10 text-slate-400 !py-0.5 !px-2 text-[10px]">{lead.sourceName}</span>
        <span className={`chip !py-0.5 !px-2 text-[10px] ${riskClass(lead.ai.risk)}`}>{lead.ai.risk}</span>
        {lead.classType && <span className="chip bg-white/5 border border-white/10 text-slate-400 !py-0.5 !px-2 text-[10px]">{lead.classType}</span>}
      </div>

      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-white/6">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <GripVertical size={12} className="text-slate-600" />
          {owner ? owner.name : 'Unassigned'}
        </span>
        {nextFu ? (
          <span className={`flex items-center gap-1 text-[11px] font-semibold ${overdue ? 'text-rose-400' : 'text-slate-400'}`}>
            <Clock size={11} />
            {overdue ? `${-dueIn}d overdue` : dueIn === 0 ? 'today' : fmtDate(nextFu.date)}
          </span>
        ) : (
          <span className="text-[11px] text-slate-600">—</span>
        )}
      </div>
    </div>
  )
}
