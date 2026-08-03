import React, { useEffect, useState } from 'react'
import {
  Users, Trophy, IndianRupee, CalendarCheck2, CalendarClock, ChevronDown,
  BarChart3, RotateCcw, TrendingUp
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Spinner } from '../ui.jsx'
import { money } from '../lib.js'

const COLORS = { newLeads: '#8b5cf6', won: '#10b981', missed: '#fbbf24' }

export default function Performance() {
  const { openLead, dataVersion } = useApp()
  const [range, setRange] = useState('week')
  const [data, setData] = useState(null)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [openIdx, setOpenIdx] = useState(null)

  useEffect(() => {
    setLoading(true)
    setOpenIdx(null)
    Promise.all([
      api.get(`/api/analytics/performance?range=${range}`),
      api.get(`/api/analytics/performance/details?range=${range}`)
    ])
      .then(([p, d]) => { setData(p); setDetails(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [range, dataVersion])

  const chartData = (data?.buckets || []).map(b => ({ ...b, missed: b.missed || 0 }))
  const t = data?.totals || {}

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[18px] font-bold text-white flex items-center gap-2">
            <BarChart3 size={18} className="text-rose-400" /> Performance
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">Leads, wins, revenue and follow-up discipline across the funnel.</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 p-1">
            {['week', 'month'].map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  range === r ? 'bg-gradient-to-r from-rose-500/20 to-fuchsia-500/15 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r === 'week' ? 'Last 7 days' : 'Last 12 months'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="py-20 text-center text-slate-500"><Spinner size={22} /></div>
      )}

      {!loading && data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Summary icon={<Users size={14} />} label="New leads" value={t.newLeads} color="#8b5cf6" />
            <Summary icon={<Trophy size={14} />} label="Won deals" value={t.won} color="#10b981" />
            <Summary icon={<IndianRupee size={14} />} label="Revenue" value={money(t.revenue)} color="#f43f5e" />
            <Summary icon={<CalendarCheck2 size={14} />} label="Follow-up completion" value={`${t.followUpRate || 0}%`} color="#fbbf24" sub={`${t.missed || 0} missed of ${t.followUps || 0}`} />
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-4 text-[11px] text-slate-400 mb-3">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.newLeads }} /> New</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.won }} /> Won</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.missed }} /> Missed FU</span>
            </div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'var(--axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={tooltipStyle()} />
                  <Bar dataKey="newLeads" name="New leads" fill={COLORS.newLeads} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="won" name="Won" fill={COLORS.won} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="missed" name="Missed follow-ups" fill={COLORS.missed} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
              <CalendarClock size={13} className="text-cyan-400" /> Bucket breakdown
              <span className="ml-auto flex items-center gap-1.5 text-[11px] font-normal text-slate-500"><TrendingUp size={12} /> Click a row to drill into the leads</span>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-white/8">
                    <th className="px-4 py-2.5 font-semibold">Period</th>
                    <th className="px-3 py-2.5 font-semibold text-center">New</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Won</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Missed</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Revenue</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((b, i) => {
                    const det = details?.buckets?.find(x => x.key === b.key)
                    const isOpen = openIdx === i
                    const hasDetail = (det?.newLeads?.length || 0) + (det?.won?.length || 0) + (det?.missed?.length || 0) > 0
                    return (
                      <React.Fragment key={b.key}>
                        <tr className="border-b border-white/5 hover:bg-white/[0.035] cursor-pointer" onClick={() => hasDetail && setOpenIdx(isOpen ? null : i)}>
                          <td className="px-4 py-2.5 text-[12.5px] text-slate-300">{b.label}</td>
                          <td className="px-3 py-2.5 text-center text-[12.5px] text-violet-400 mono">{b.newLeads || 0}</td>
                          <td className="px-3 py-2.5 text-center text-[12.5px] text-emerald-400 mono">{b.won || 0}</td>
                          <td className="px-3 py-2.5 text-center text-[12.5px] mono">{b.missed ? <span className="text-rose-400">{b.missed}</span> : <span className="text-slate-500">0</span>}</td>
                          <td className="px-3 py-2.5 text-center text-[12.5px] text-slate-200 mono">{money(b.revenue || 0)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-white/5 border border-white/10 text-slate-400">
                              <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </span>
                          </td>
                        </tr>
                        {isOpen && det && (
                          <tr className="border-b border-white/5 bg-white/[0.02]">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <DetailList title="New leads" color="#a78bfa" items={det.newLeads || []} openLead={openLead} />
                                <DetailList title="Won" color="#34d399" items={det.won || []} openLead={openLead} moneyValue />
                                <DetailList title="Missed follow-ups" color="#fbbf24" items={det.missed || []} openLead={openLead} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <RotateCcw size={12} /> Refreshes automatically when leads change.
          </div>
        </div>
      )}
    </div>
  )
}

function DetailList({ title, color, items, openLead, moneyValue }) {
  if (!items.length) return <div className="text-[12px] text-slate-500">{title}: none</div>
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider font-bold mb-1.5" style={{ color }}>{title} ({items.length})</div>
      <div className="space-y-1 max-h-[180px] overflow-y-auto scrollbar-thin">
        {items.map(it => (
          <button key={it.id} className="w-full text-left flex items-center justify-between gap-2 text-[12px] text-slate-300 bg-white/[0.03] border border-white/8 rounded-lg px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors" onClick={() => openLead(it.id)}>
            <span className="truncate">{it.fullName}</span>
            {moneyValue && it.value ? <span className="mono text-emerald-400 shrink-0">{money(it.value)}</span> : it.comments ? <span className="text-slate-500 truncate max-w-[120px]">{it.comments}</span> : <span className="chip !px-1.5 !py-0.5 text-[9px] bg-white/5 border border-white/10 text-slate-400">{it.stage}</span>}
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

function tooltipStyle() {
  return {
    background: 'var(--tt-bg)',
    border: '1px solid var(--tt-border)',
    borderRadius: 12,
    fontSize: 12,
    color: 'var(--tt-color)',
    boxShadow: '0 10px 30px rgba(0,0,0,.5)'
  }
}
