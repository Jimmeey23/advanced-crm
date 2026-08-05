import React, { useEffect, useMemo, useState } from 'react'
import {
  Building2, ChevronLeft, ChevronRight, ChevronDown, Trophy, IndianRupee,
  Users, CalendarCheck2, Crown, TrendingDown, ArrowUpRight, ArrowDownRight,
  ArrowUp, ArrowDown, Filter, ListFilter, Tags
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell
} from 'recharts'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Spinner } from '../ui.jsx'
import { money } from '../lib.js'

const tooltipStyle = () => ({
  background: 'var(--tt-bg)', border: '1px solid var(--tt-border)', borderRadius: 12,
  fontSize: 12, color: 'var(--tt-color)', boxShadow: '0 10px 30px rgba(0,0,0,.5)'
})
const AXIS = { fill: 'var(--axis)', fontSize: 10.5 }
const FUNNEL_COLORS = { new: '#8b5cf6', trial: '#06b6d4', won: '#10b981', lost: '#f43f5e' }

function deltaPct(curr, prev) {
  if (prev === undefined || prev === null) return null
  const c = Number(curr) || 0, p = Number(prev) || 0
  if (p === 0) return c === 0 ? 0 : 100
  return Math.round(((c - p) / p) * 100)
}

export default function StudioPerformancePage({ range, title, desc }) {
  const { openLead, dataVersion } = useApp()
  const [offset, setOffset] = useState(range === 'week' ? 1 : 0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [openLoc, setOpenLoc] = useState(null)
  const [funnelLocationId, setFunnelLocationId] = useState('')
  const [locHistory, setLocHistory] = useState({})
  const [locHistoryLoading, setLocHistoryLoading] = useState({})

  useEffect(() => {
    setLoading(true)
    setOpenLoc(null)
    setLocHistory({})
    api.get(`/api/analytics/performance/by-location?range=${range}&offset=${offset}&history=12`)
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
  const prev = data?.previous || null
  const history = data?.history || []

  const funnelSource = funnelLocationId
    ? data?.funnel?.byLocation?.find(f => f.locationId === funnelLocationId)
    : data?.funnel
  const funnelData = funnelSource ? [
    { stage: 'New', key: 'new', count: funnelSource.new },
    { stage: 'Trial', key: 'trial', count: funnelSource.trial },
    { stage: 'Won', key: 'won', count: funnelSource.won },
    { stage: 'Lost', key: 'lost', count: funnelSource.lost }
  ] : []

  const toggleRow = (locId) => {
    const next = openLoc === locId ? null : locId
    setOpenLoc(next)
    if (next && !locHistory[next] && !locHistoryLoading[next]) {
      setLocHistoryLoading(s => ({ ...s, [next]: true }))
      api.get(`/api/analytics/performance/by-location?range=${range}&offset=${offset}&history=12&location=${next}`)
        .then(res => setLocHistory(s => ({ ...s, [next]: res.history || [] })))
        .catch(() => {})
        .finally(() => setLocHistoryLoading(s => ({ ...s, [next]: false })))
    }
  }

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
            <Summary icon={<Users size={14} />} label="New leads" value={totals.newLeads} color="#8b5cf6" delta={deltaPct(totals.newLeads, prev?.newLeads)} history={history} dataKey="newLeads" />
            <Summary icon={<Crown size={14} />} label="Trials" value={totals.trials} color="#06b6d4" delta={deltaPct(totals.trials, prev?.trials)} history={history} dataKey="trials" />
            <Summary icon={<Trophy size={14} />} label="Won deals" value={totals.won} color="#10b981" delta={deltaPct(totals.won, prev?.won)} history={history} dataKey="won" />
            <Summary icon={<IndianRupee size={14} />} label="Revenue" value={money(totals.revenue)} color="#f43f5e" delta={deltaPct(totals.revenue, prev?.revenue)} history={history} dataKey="revenue" />
            <Summary icon={<CalendarCheck2 size={14} />} label="Follow-up completion" value={`${followUpRate}%`} color="#fbbf24" sub={`${totals.missed} missed of ${totals.followUps}`} delta={deltaPct(followUpRate, prev?.followUpRate)} history={history} dataKey="followUpRate" />
          </div>

          {history.length > 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <TrendChart title="New leads" color="#8b5cf6" dataKey="newLeads" data={history} />
              <TrendChart title="Revenue" color="#f43f5e" dataKey="revenue" data={history} valueFmt={money} />
              <TrendChart title="Won deals" color="#10b981" dataKey="won" data={history} />
              <TrendChart title="Follow-up rate" color="#fbbf24" dataKey="followUpRate" data={history} valueFmt={v => `${v}%`} />
            </div>
          )}

          {funnelData.length > 0 && (
            <div className="card p-5">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Filter size={14} className="text-cyan-400" />
                  <h3 className="font-display font-semibold text-white text-[13.5px]">Pipeline funnel</h3>
                </div>
                <select className="input !w-auto !py-1.5 !text-[12px] ml-auto" value={funnelLocationId} onChange={e => setFunnelLocationId(e.target.value)}>
                  <option value="">All studios</option>
                  {rows.map(r => <option key={r.locationId} value={r.locationId}>{r.locationName}</option>)}
                </select>
              </div>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="stage" width={60} tick={AXIS} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="count" name="Leads" radius={[0, 6, 6, 0]}>
                      {funnelData.map(d => <Cell key={d.key} fill={FUNNEL_COLORS[d.key]} opacity={0.9} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {rows.map(r => {
              const isOpen = openLoc === r.locationId
              const rate = r.followUps ? Math.round(((r.followUps - r.missed) / r.followUps) * 100) : 0
              const sparkData = locHistory[r.locationId]
              return (
                <div key={r.locationId} className="card overflow-hidden">
                  <button className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors" onClick={() => toggleRow(r.locationId)}>
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
                    <div className="px-4 pb-4 pt-1 border-t border-white/8 space-y-3">
                      <div className="rounded-lg bg-white/[0.02] border border-white/8 px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500">Revenue trend (12 periods)</span>
                          {locHistoryLoading[r.locationId] && <Spinner size={12} />}
                        </div>
                        {sparkData?.length > 1 ? (
                          <div className="h-[46px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={sparkData} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                                <Tooltip contentStyle={tooltipStyle()} formatter={(v) => money(v)} labelFormatter={(l) => l} />
                                <Line type="monotone" dataKey="revenue" stroke="#34d399" strokeWidth={1.75} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-600 py-2">{locHistoryLoading[r.locationId] ? 'Loading…' : 'No history yet'}</div>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <AssociateCard label="Top associate" icon={<Crown size={13} className="text-amber-400" />} associate={r.topAssociate} />
                        <AssociateCard label="Needs support" icon={<TrendingDown size={13} className="text-slate-500" />} associate={r.bottomAssociate} />
                        <DetailList title="New leads" color="#a78bfa" items={r.newLeadDetails} openLead={openLead} />
                        <DetailList title="Won" color="#34d399" items={r.wonDetails} openLead={openLead} moneyValue />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {!rows.length && <div className="text-center text-slate-500 py-10 text-[12.5px]">No studios found.</div>}
          </div>

          <LeaderboardSection leaderboard={data?.leaderboard || []} />
          <SourceBreakdownSection sourceBreakdown={data?.sourceBreakdown || []} />
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

function Summary({ icon, label, value, color, sub, delta, history, dataKey }) {
  const sparkData = (history || []).filter(h => h[dataKey] !== undefined)
  return (
    <div className="card !rounded-xl px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1" style={{ color }}>{icon}{label}</div>
          <div className="font-display text-[18px] font-bold mono truncate" style={{ color }}>{value}</div>
          {sub && <div className="text-[10.5px] text-slate-500 mt-0.5">{sub}</div>}
        </div>
        {sparkData.length > 1 && (
          <div className="w-16 h-8 shrink-0 hidden sm:block">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.75} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {delta !== null && delta !== undefined && (
        <div className={`mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {delta >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {Math.abs(delta)}% vs prev period
        </div>
      )}
    </div>
  )
}

function TrendChart({ title, color, dataKey, data, valueFmt }) {
  return (
    <div className="card p-4">
      <div className="text-[11.5px] font-semibold text-slate-300 mb-2">{title}</div>
      <div className="h-[110px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="periodLabel" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle()} formatter={valueFmt ? (v) => valueFmt(v) : undefined} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const LEADERBOARD_COLS = [
  { key: 'name', label: 'Associate', align: 'left' },
  { key: 'newLeads', label: 'New leads' },
  { key: 'trials', label: 'Trials' },
  { key: 'won', label: 'Won' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'followUpRate', label: 'Follow-up' }
]

function LeaderboardSection({ leaderboard }) {
  const [sort, setSort] = useState({ key: 'revenue', dir: 'desc' })

  const sorted = useMemo(() => {
    const list = [...leaderboard]
    list.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      let cmp
      if (typeof av === 'string' || typeof bv === 'string') cmp = String(av || '').localeCompare(String(bv || ''))
      else cmp = (Number(av) || 0) - (Number(bv) || 0)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [leaderboard, sort])

  const toggleSort = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))

  if (!leaderboard.length) return null

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
        <ListFilter size={13} className="text-fuchsia-400" /> Associate leaderboard
        <span className="ml-auto text-[11px] font-normal text-slate-500">{leaderboard.length} associates · click a column to sort</span>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-white/8">
              {LEADERBOARD_COLS.map(c => (
                <th
                  key={c.key}
                  className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-300 ${c.align === 'left' ? 'text-left' : 'text-center'}`}
                  onClick={() => toggleSort(c.key)}
                >
                  <span className={`inline-flex items-center gap-1 ${c.align === 'left' ? '' : 'justify-center'}`}>
                    {c.label}
                    {sort.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(a => (
              <tr key={a.associateId} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                <td className="px-4 py-2.5 text-[12.5px] font-semibold text-white">{a.name}</td>
                <td className="px-3 py-2.5 text-[12px] text-slate-300 text-center mono">{a.newLeads}</td>
                <td className="px-3 py-2.5 text-[12px] text-slate-300 text-center mono">{a.trials}</td>
                <td className="px-3 py-2.5 text-[12px] text-slate-300 text-center mono">{a.won}</td>
                <td className="px-3 py-2.5 text-[12px] text-emerald-400 text-center mono">{money(a.revenue)}</td>
                <td className="px-3 py-2.5 text-[12px] text-amber-400 text-center mono">{a.followUpRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SourceBreakdownSection({ sourceBreakdown }) {
  if (!sourceBreakdown.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
        <Tags size={13} className="text-cyan-400" /> Source breakdown
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-white/8">
              <th className="px-4 py-2.5 font-semibold">Source</th>
              <th className="px-3 py-2.5 font-semibold text-center">Leads</th>
              <th className="px-3 py-2.5 font-semibold text-center">Won</th>
              <th className="px-3 py-2.5 font-semibold text-center">Won rate</th>
            </tr>
          </thead>
          <tbody>
            {sourceBreakdown.map(s => (
              <tr key={s.source} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                <td className="px-4 py-2.5 text-[12.5px] font-semibold text-white">{s.source}</td>
                <td className="px-3 py-2.5 text-[12px] text-slate-300 text-center mono">{s.count}</td>
                <td className="px-3 py-2.5 text-[12px] text-slate-300 text-center mono">{s.wonCount}</td>
                <td className="px-3 py-2.5 text-[12px] text-emerald-400 text-center mono">{s.wonRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
