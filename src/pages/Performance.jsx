import React, { useEffect, useState } from 'react'
import {
  Users, Trophy, IndianRupee, CalendarCheck2, CalendarClock, ChevronRight,
  BarChart3, RotateCcw, TrendingUp, TrendingDown, Wallet, SlidersHorizontal, X, Search
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { useApp } from '../store.jsx'
import { api, buildQuery } from '../api.js'
import { Spinner } from '../ui.jsx'
import { money } from '../lib.js'
import MetricCard from '../components/MetricCard.jsx'

const ACCENT_HEX = { violet: '#8b5cf6', emerald: '#10b981', rose: '#f43f5e', amber: '#f59e0b', sky: '#38bdf8' }
function momOf(series) {
  if (series.length < 2) return null
  const prev = series[series.length - 2].value
  const cur = series[series.length - 1].value
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

const COLORS = { newLeads: '#8b5cf6', won: '#10b981', missed: '#fbbf24', lost: '#f43f5e' }
const CURRENT_MONTH = new Date().toISOString().slice(0, 7)
const EMPTY_FILTERS = { studio: '', associate: '' }

export default function Performance() {
  const { openLead, dataVersion, boot } = useApp()
  const [range, setRange] = useState('month')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [panelOpen, setPanelOpen] = useState(false)
  const [data, setData] = useState(null)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [drawerBucket, setDrawerBucket] = useState(null)

  const setF = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }))
  const hasFilters = filters.studio || filters.associate
  const clearFilters = () => setFilters(EMPTY_FILTERS)
  const scopeQuery = buildQuery({ range, studio: filters.studio, associate: filters.associate })

  useEffect(() => {
    setLoading(true)
    setDrawerBucket(null)
    Promise.all([
      api.get(`/api/analytics/performance?${scopeQuery}`),
      api.get(`/api/analytics/performance/details?${scopeQuery}`)
    ])
      .then(([p, d]) => { setData(p); setDetails(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [scopeQuery, dataVersion])

  const chartData = (data?.buckets || []).map(b => ({ ...b, missed: b.missed || 0, lost: b.lost || 0 }))
  const t = data?.totals || {}

  const nonEmpty = chartData.filter(b => (b.newLeads || 0) + (b.won || 0) + (b.revenue || 0) + (b.followUps || 0) > 0)
  const bestBy = (fn) => nonEmpty.reduce((best, b) => (best && fn(best) >= fn(b) ? best : b), null)
  const bestNew = bestBy(b => b.newLeads || 0)
  const bestWon = bestBy(b => b.won || 0)
  const bestRevenue = bestBy(b => b.revenue || 0)
  const worstFollowUp = nonEmpty.reduce((worst, b) => {
    if (!(b.followUps > 0)) return worst
    const rate = ((b.followUps - (b.missed || 0)) / b.followUps)
    return (!worst || rate < worst.rate) ? { ...b, rate } : worst
  }, null)
  const winRate = t.newLeads ? Math.round((t.won / t.newLeads) * 100) : 0
  const avgDeal = t.won ? t.revenue / t.won : 0
  const avgPerLead = t.newLeads ? t.revenue / t.newLeads : 0

  const newLeadsTrend = chartData.map(b => ({ label: b.label, value: b.newLeads || 0 }))
  const wonTrend = chartData.map(b => ({ label: b.label, value: b.won || 0 }))
  const revenueTrend = chartData.map(b => ({ label: b.label, value: b.revenue || 0 }))
  const followUpTrend = chartData.map(b => ({ label: b.label, value: b.followUps ? Math.round(((b.followUps - (b.missed || 0)) / b.followUps) * 100) : 0 }))
  const lostTrend = chartData.map(b => ({ label: b.label, value: b.lost || 0 }))

  const drawerDetail = drawerBucket ? details?.buckets?.find(x => x.key === drawerBucket.key) : null

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[19px] font-bold text-white flex items-center gap-2">
            <BarChart3 size={18} className="text-rose-400" /> Performance
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">Leads, wins, losses, revenue and follow-up discipline across the funnel.</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button className={`btn ${panelOpen ? 'btn-soft' : 'btn-ghost'} !py-2`} onClick={() => setPanelOpen(o => !o)}>
            <SlidersHorizontal size={14} /> Filters {hasFilters && <span className="chip !px-1.5 !py-0.5 !text-[10px] bg-rose-500/20 text-rose-300">!</span>}
          </button>
          {hasFilters && <button className="btn btn-ghost !py-2" onClick={clearFilters}><X size={14} /> Clear</button>}
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

      {panelOpen && (
        <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ animation: 'fadeIn .15s ease' }}>
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Studio</label>
            <select className="input !py-1.5" value={filters.studio} onChange={setF('studio')}>
              <option value="">All studios</option>
              {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Associate</label>
            <select className="input !py-1.5" value={filters.associate} onChange={setF('associate')}>
              <option value="">All associates</option>
              {(boot?.associates || []).filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {loading && (
        <div className="py-20 text-center text-slate-500"><Spinner size={22} /></div>
      )}

      {!loading && data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <MetricCard
              icon={Users} title="New leads" value={t.newLeads} color={ACCENT_HEX.violet}
              description={`Best: ${bestNew ? `${bestNew.label} (${bestNew.newLeads})` : '—'} · ${t.won || 0} converted (${winRate}%) · avg ${money(avgPerLead)}/lead`}
              trend={newLeadsTrend} mom={momOf(newLeadsTrend)}
            />
            <MetricCard
              icon={Trophy} title="Won deals" value={t.won} color={ACCENT_HEX.emerald}
              description={`Win rate ${winRate}% · avg deal ${money(avgDeal)} · best ${bestWon ? `${bestWon.label} (${bestWon.won})` : '—'}`}
              trend={wonTrend} mom={momOf(wonTrend)}
            />
            <MetricCard
              icon={TrendingDown} title="Lost deals" value={t.lost || 0} color={ACCENT_HEX.rose}
              description={`Loss rate ${t.lossRate || 0}% of decided deals · ${money(t.lostRevenue || 0)} in lost pipeline value`}
              trend={lostTrend} mom={momOf(lostTrend)}
            />
            <MetricCard
              icon={IndianRupee} title="Revenue" value={money(t.revenue)} color={ACCENT_HEX.amber}
              description={`Avg deal ${money(avgDeal)} · ${money(avgPerLead)}/lead · best ${bestRevenue ? `${bestRevenue.label} (${money(bestRevenue.revenue)})` : '—'}`}
              trend={revenueTrend} mom={momOf(revenueTrend)}
            />
            <MetricCard
              icon={Wallet} title="Open pipeline" value={money(t.openPipelineValue || 0)} color={ACCENT_HEX.sky}
              description="Estimated value of leads still open right now, within the current filter scope."
              trend={[]} mom={null}
            />
            <MetricCard
              icon={CalendarCheck2} title="Follow-up completion" value={`${t.followUpRate || 0}%`} color={ACCENT_HEX.amber}
              description={`${t.missed || 0} missed of ${t.followUps || 0} · worst ${worstFollowUp ? `${worstFollowUp.label} (${Math.round(worstFollowUp.rate * 100)}%)` : '—'}`}
              trend={followUpTrend} mom={momOf(followUpTrend)}
            />
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-4 text-[11px] text-slate-400 mb-3">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.newLeads }} /> New</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.won }} /> Won</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.lost }} /> Lost</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.missed }} /> Missed FU</span>
            </div>
            <div className="chart-3d h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'var(--axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={tooltipStyle()} />
                  <Bar dataKey="newLeads" name="New leads" fill={COLORS.newLeads} radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
                  <Bar dataKey="won" name="Won" fill={COLORS.won} radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
                  <Bar dataKey="lost" name="Lost" fill={COLORS.lost} radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
                  <Bar dataKey="missed" name="Missed follow-ups" fill={COLORS.missed} radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
              <CalendarClock size={13} className="text-cyan-400" /> Bucket breakdown
              <span className="ml-auto flex items-center gap-1.5 text-[11px] font-normal text-slate-500"><TrendingUp size={12} /> Click a row to open its leads</span>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-white/8 sticky top-0 z-10 bg-[var(--tt-bg,#0d1220)]">
                    <th className="px-4 py-2.5 font-semibold">Period</th>
                    <th className="px-3 py-2.5 font-semibold text-center">New</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Won</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Lost</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Missed</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Win rate</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Revenue</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Avg deal</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((b, i) => {
                    const det = details?.buckets?.find(x => x.key === b.key)
                    const hasDetail = (det?.newLeads?.length || 0) + (det?.won?.length || 0) + (det?.missed?.length || 0) + (det?.lost?.length || 0) > 0
                    const isActive = drawerBucket?.key === b.key
                    const rowWinRate = b.newLeads ? Math.round((b.won / b.newLeads) * 100) : 0
                    const rowAvgDeal = b.won ? b.revenue / b.won : 0
                    return (
                      <tr
                        key={b.key}
                        className={`border-b border-white/5 transition-colors ${hasDetail ? 'cursor-pointer hover:bg-white/[0.05]' : 'cursor-default'} ${i % 2 === 1 ? 'bg-white/[0.015]' : ''} ${isActive ? 'bg-white/[0.06]' : ''}`}
                        onClick={() => hasDetail && setDrawerBucket(isActive ? null : b)}
                      >
                        <td className="px-4 py-2.5 text-[12.5px] text-slate-300 font-medium">{b.label}</td>
                        <td className="px-3 py-2.5 text-center text-[12.5px] text-violet-400 mono">{b.newLeads || 0}</td>
                        <td className="px-3 py-2.5 text-center text-[12.5px] text-emerald-400 mono">{b.won || 0}</td>
                        <td className="px-3 py-2.5 text-center text-[12.5px] mono">{b.lost ? <span className="text-rose-400">{b.lost}</span> : <span className="text-slate-500">0</span>}</td>
                        <td className="px-3 py-2.5 text-center text-[12.5px] mono">{b.missed ? <span className="text-amber-400">{b.missed}</span> : <span className="text-slate-500">0</span>}</td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center gap-1.5 justify-center">
                            <div className="w-10 h-1.5 rounded-full bg-white/8 overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, rowWinRate)}%` }} />
                            </div>
                            <span className="text-[11px] text-slate-400 mono w-7 text-right">{rowWinRate}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-[12.5px] text-slate-200 mono">{money(b.revenue || 0)}</td>
                        <td className="px-3 py-2.5 text-center text-[12px] text-slate-400 mono">{b.won ? money(rowAvgDeal) : '—'}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg border transition-all ${hasDetail ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-transparent border-transparent text-slate-700'}`}>
                            <ChevronRight size={12} />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/10 bg-white/[0.03] text-[12.5px] font-semibold">
                    <td className="px-4 py-2.5 text-slate-300">Total</td>
                    <td className="px-3 py-2.5 text-center text-violet-400 mono">{t.newLeads || 0}</td>
                    <td className="px-3 py-2.5 text-center text-emerald-400 mono">{t.won || 0}</td>
                    <td className="px-3 py-2.5 text-center text-rose-400 mono">{t.lost || 0}</td>
                    <td className="px-3 py-2.5 text-center text-amber-400 mono">{t.missed || 0}</td>
                    <td className="px-3 py-2.5 text-center text-slate-300 mono">{winRate}%</td>
                    <td className="px-3 py-2.5 text-center text-slate-200 mono">{money(t.revenue || 0)}</td>
                    <td className="px-3 py-2.5 text-center text-slate-400 mono">{t.won ? money(avgDeal) : '—'}</td>
                    <td className="px-3 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <RotateCcw size={12} /> Refreshes automatically when leads change.
          </div>
        </div>
      )}

      <BucketDrawer bucket={drawerBucket} detail={drawerDetail} onClose={() => setDrawerBucket(null)} openLead={openLead} />
    </div>
  )
}

// Slide-in detail panel (same animation/backdrop pattern as LeadDrawer) —
// replaces the old inline expand-row: the bucket table row never changes
// height, and each lead in the panel still opens the real LeadDrawer on top.
function BucketDrawer({ bucket, detail, onClose, openLead }) {
  const [q, setQ] = useState('')
  useEffect(() => { setQ('') }, [bucket?.key])
  if (!bucket) return null

  const filterList = (items) => !q.trim() ? items : items.filter(it => it.fullName.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative w-full max-w-[480px] h-full border-l border-white/10 flex flex-col shadow-2xl bg-[linear-gradient(180deg,rgba(15,18,32,0.98),rgba(9,12,22,0.98))]" style={{ animation: 'slideIn .2s ease' }}>
        <div className="px-5 pt-5 pb-4 border-b border-white/8 bg-white/[0.02]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-[15px] font-bold text-white">{bucket.label}</h3>
              <p className="text-[11.5px] text-slate-500 mt-0.5">{bucket.newLeads || 0} new · {bucket.won || 0} won · {bucket.lost || 0} lost · {bucket.missed || 0} missed follow-ups</p>
            </div>
            <button className="btn btn-ghost !p-2" onClick={onClose}><X size={14} /></button>
          </div>
          <div className="relative mt-3">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input !pl-8 !py-1.5 !text-[12px]" placeholder="Filter by name…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-5">
          <DetailSection title="New leads" color="#a78bfa" items={filterList(detail?.newLeads || [])} openLead={openLead} />
          <DetailSection title="Won" color="#34d399" items={filterList(detail?.won || [])} openLead={openLead} moneyValue />
          <DetailSection title="Lost" color="#f87171" items={filterList(detail?.lost || [])} openLead={openLead} moneyValue />
          <DetailSection title="Missed follow-ups" color="#fbbf24" items={filterList(detail?.missed || [])} openLead={openLead} />
        </div>
      </aside>
    </div>
  )
}

function DetailSection({ title, color, items, openLead, moneyValue }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider font-bold mb-1.5 flex items-center gap-1.5" style={{ color }}>{title} ({items.length})</div>
      {!items.length && <p className="text-[11.5px] text-slate-500">None in this period.</p>}
      <div className="space-y-1">
        {items.map(it => (
          <button key={it.id} className="w-full text-left flex items-center justify-between gap-2 text-[12.5px] text-slate-300 bg-white/[0.03] border border-white/8 rounded-lg px-3 py-2 hover:bg-white/[0.07] transition-colors" onClick={() => openLead(it.id)}>
            <span className="truncate">{it.fullName}</span>
            {moneyValue && it.value ? <span className="mono text-emerald-400 shrink-0">{money(it.value)}</span> : it.comments ? <span className="text-slate-500 truncate max-w-[140px]">{it.comments}</span> : <span className="chip !px-1.5 !py-0.5 text-[9px] bg-white/5 border border-white/10 text-slate-400 shrink-0">{it.stage}</span>}
          </button>
        ))}
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
