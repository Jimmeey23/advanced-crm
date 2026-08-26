import React, { useMemo, useState } from 'react'
import { Plus, Search, GripVertical, Clock, Users } from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api, buildQuery } from '../api.js'
import { Avatar, ScorePill } from '../ui.jsx'
import { stageClass, stageBadgeStyle, stageColor, riskClass, fmtDate, daysFromNow } from '../lib.js'

export default function Pipeline() {
  const { boot, lookup, openLead, refreshData, toast, dataVersion } = useApp()
  const [locationId, setLocationId] = useState('')
  const [associateId, setAssociateId] = useState('')
  const [search, setSearch] = useState('')
  const [hideEmpty, setHideEmpty] = useState(true)
  const [dragId, setDragId] = useState(null)

  const q = buildQuery({ locationId, associateId, search: search.trim() || undefined, pageSize: 600 })
  const { data, loading } = useFetch(() => api.get(`/api/leads?${q}`), [q, dataVersion])

  const columns = useMemo(() => {
    const stages = boot?.stages || []
    const map = {}
    for (const s of stages) map[s] = []
    for (const l of data?.items || []) (map[l.stage] = map[l.stage] || []).push(l)
    return stages
      .map(stage => ({ stage, leads: map[stage] || [] }))
      .filter(c => dragId || !hideEmpty || c.leads.length > 0)
  }, [data, boot, hideEmpty, dragId])

  const moveStage = async (leadId, stage) => {
    setDragId(null)
    try {
      await api.patch(`/api/leads/${leadId}`, { stage })
      refreshData()
    } catch (e) { toast(e.message, 'error') }
  }

  const total = data?.total ?? 0

  return (
    <div className="h-full flex flex-col">
      {/* toolbar */}
      <div className="px-6 pt-5 pb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-[260px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input !pl-9" placeholder="Search leads…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input !w-auto" value={locationId} onChange={e => setLocationId(e.target.value)}>
          <option value="">All locations</option>
          {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="input !w-auto" value={associateId} onChange={e => setAssociateId(e.target.value)}>
          <option value="">All associates</option>
          {(boot?.associates || []).filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[12px] text-slate-400 cursor-pointer select-none ml-auto">
          <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} className="accent-rose-500" />
          Hide empty stages
        </label>
        <span className="chip bg-white/5 border border-white/10 text-slate-300"><Users size={12} /> {total} leads</span>
      </div>

      {loading && <div className="px-6 py-8 text-slate-500">Loading pipeline…</div>}

      <div className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin px-6 pb-6">
        <div className="flex gap-4 h-full min-h-[420px]">
          {columns.map(col => {
            const count = col.leads.length
            return (
              <div
                key={col.stage}
                className={`pipeline-column flex flex-col w-[306px] shrink-0 rounded-2xl bg-white/[0.028] border border-white/6 ${dragId ? 'is-dragging' : ''}`}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'rgba(244,63,94,.5)' }}
                onDragLeave={e => { e.currentTarget.style.borderColor = '' }}
                onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = ''; const id = e.dataTransfer.getData('text/lead'); if (id && id !== dragId) moveStage(id, col.stage) }}
              >
                <div className="pipeline-column-head px-3.5 py-3 flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: stageColor(col.stage).solid }} />
                  <div className="min-w-0">
                    <div className={`pipeline-stage-badge ${stageClass(col.stage)}`} style={stageBadgeStyle(col.stage)} title={col.stage}>{col.stage}</div>
                    <div className="text-[10px] text-slate-500 truncate">{(boot?.stageStatusGroups || {})[col.stage]}</div>
                  </div>
                  <span className="ml-auto chip bg-white/6 border border-white/10 text-slate-400 mono !py-0.5 !px-2 text-[11px]">{count}</span>
                </div>
                <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto scrollbar-thin">
                  {col.leads.map(l => (
                    <LeadCard key={l.id} lead={l} lookup={lookup} openLead={openLead} onDragStart={setDragId} />
                  ))}
                  {count === 0 && <div className="pipeline-drop-empty">Drop member cards here</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Keyed by statusGroup (server/leadStatus.js), not the raw stage string —
// there are 30+ real stage strings but only 9 funnel groups, and this used
// to be keyed by a fabricated stage set ('New Lead', 'Trial Booked', ...)
// that never matched any real lead.stage value, so every column silently
// fell through to the default gray.
const STATUS_GROUP_COLOR = {
  'Pre-Trial': '#3b82f6', 'Unresponsive': '#94a3b8', 'Trial Scheduled': '#06b6d4',
  'Trial Completed': '#10b981', 'Post-Trial Follow-up': '#f59e0b',
  'Disqualified': '#64748b', 'Not Interested': '#f43f5e', 'Lost': '#71717a', 'Won': '#34d399'
}
function columnColor(statusGroup) {
  return STATUS_GROUP_COLOR[statusGroup] || '#94a3b8'
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
