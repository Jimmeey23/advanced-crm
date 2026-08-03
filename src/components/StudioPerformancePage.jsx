import React, { useEffect, useState } from 'react'
import {
  Building2, ChevronLeft, ChevronRight, ChevronDown, Trophy, IndianRupee,
  Users, CalendarCheck2, Crown, TrendingDown
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Spinner } from '../ui.jsx'
import { money } from '../lib.js'

export default function StudioPerformancePage({ range, title, desc }) {
  const { openLead, dataVersion } = useApp()
  const [offset, setOffset] = useState(range === 'week' ? 1 : 0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [openLoc, setOpenLoc] = useState(null)

  useEffect(() => {
    setLoading(true)
    api.get(`/api/analytics/performance/by-location?range=${range}&offset=${offset}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [range, offset, dataVersion])

  const rows = data?.rows || []
  const totals = rows.reduce((acc, r) => ({
    newLeads: acc.newLeads + r.newLeads, trials: acc.trials + r.trials, won: acc.won + r.won,
    revenue: acc.revenue + r.revenue, followUps: acc.followUps + r.followUps, missed: acc.missed + r.missed
  }), { newLeads: 0, trials: 0, won: 0, revenue: 0, followUps: 0, missed: 0 })
  const followUpRate = totals.followUps ? Math.round(((totals.followUps - totals.missed) / totals.followUps) * 100) : 0

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[18px] font-bold text-white flex items-center gap-2">
            <Building2 size={18} className="text-rose-400" /> {title}
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">{desc}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 p-1">
          <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10" onClick={() => setOffset(o => o + 1)}>
            <ChevronLeft size={15} />
          </button>
          <span className="px-2 text-[12.5px] font-semibold text-white min-w-[160px] text-center">{data?.label || '—'}</span>
          <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - 1))}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {loading && <div className="py-20 text-center text-slate-500"><Spinner size={22} /></div>}

      {!loading && data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Summary icon={<Users size={14} />} label="New leads" value={totals.newLeads} color="#8b5cf6" />
            <Summary icon={<Crown size={14} />} label="Trials" value={totals.trials} color="#06b6d4" />
            <Summary icon={<Trophy size={14} />} label="Won deals" value={totals.won} color="#10b981" />
            <Summary icon={<IndianRupee size={14} />} label="Revenue" value={money(totals.revenue)} color="#f43f5e" />
            <Summary icon={<CalendarCheck2 size={14} />} label="Follow-up completion" value={`${followUpRate}%`} color="#fbbf24" sub={`${totals.missed} missed of ${totals.followUps}`} />
          </div>

          <div className="space-y-3">
            {rows.map(r => {
              const isOpen = openLoc === r.locationId
              const rate = r.followUps ? Math.round(((r.followUps - r.missed) / r.followUps) * 100) : 0
              return (
                <div key={r.locationId} className="card overflow-hidden">
                  <button className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors" onClick={() => setOpenLoc(isOpen ? null : r.locationId)}>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-semibold text-white text-[13.5px]">{r.locationName}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{r.newLeads} new · {r.trials} trials · {r.won} won</div>
                    </div>
                    <Metric label="Revenue" value={money(r.revenue)} color="#34d399" />
                    <Metric label="Follow-up" value={`${rate}%`} color="#fbbf24" />
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/5 border border-white/10 text-slate-400 shrink-0">
                      <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-white/8 grid grid-cols-1 md:grid-cols-4 gap-3">
                      <AssociateCard label="Top associate" icon={<Crown size={13} className="text-amber-400" />} associate={r.topAssociate} />
                      <AssociateCard label="Needs support" icon={<TrendingDown size={13} className="text-slate-500" />} associate={r.bottomAssociate} />
                      <DetailList title="New leads" color="#a78bfa" items={r.newLeadDetails} openLead={openLead} />
                      <DetailList title="Won" color="#34d399" items={r.wonDetails} openLead={openLead} moneyValue />
                    </div>
                  )}
                </div>
              )
            })}
            {!rows.length && <div className="text-center text-slate-500 py-10 text-[12.5px]">No studios found.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, color }) {
  return (
    <div className="text-right shrink-0 hidden sm:block">
      <div className="text-[9.5px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-[13px] font-semibold mono" style={{ color }}>{value}</div>
    </div>
  )
}

function AssociateCard({ label, icon, associate }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 flex items-center gap-1.5">{icon}{label}</div>
      {associate ? (
        <div className="text-[12px] text-slate-300 bg-white/[0.03] border border-white/8 rounded-lg px-2.5 py-1.5">
          <div className="font-semibold text-white">{associate.name}</div>
          <div className="text-emerald-400 mono">{money(associate.revenue)}</div>
        </div>
      ) : <div className="text-[12px] text-slate-500">No wins yet</div>}
    </div>
  )
}

function DetailList({ title, color, items, openLead, moneyValue }) {
  if (!items?.length) return <div className="text-[12px] text-slate-500">{title}: none</div>
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider font-bold mb-1.5" style={{ color }}>{title} ({items.length})</div>
      <div className="space-y-1 max-h-[160px] overflow-y-auto scrollbar-thin">
        {items.map(it => (
          <button key={it.id} className="w-full text-left flex items-center justify-between gap-2 text-[12px] text-slate-300 bg-white/[0.03] border border-white/8 rounded-lg px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors" onClick={() => openLead(it.id)}>
            <span className="truncate">{it.fullName}</span>
            {moneyValue ? <span className="mono text-emerald-400 shrink-0">{money(it.revenue)}</span> : <span className="chip !px-1.5 !py-0.5 text-[9px] bg-white/5 border border-white/10 text-slate-400">{it.stage}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function Summary({ icon, label, value, color, sub }) {
  return (
    <div className="card !rounded-xl px-3.5 py-3 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1" style={{ color }}>{icon}{label}</div>
        <div className="font-display text-[18px] font-bold mono" style={{ color }}>{value}</div>
        {sub && <div className="text-[10.5px] text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}
