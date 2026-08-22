import React from 'react'
import {
  Users, Trophy, TrendingUp, IndianRupee, Target, Flame, UserPlus,
  Sparkles, ChevronRight, ShieldAlert,
  BarChart3, Award, CalendarRange
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { money, stageClass, riskClass, fmtDate, timeAgo } from '../lib.js'
import { Avatar, ScorePill, Empty } from '../ui.jsx'
import AssociateCompareModal from '../components/AssociateCompareModal.jsx'
import PerformanceModal from '../components/PerformanceModal.jsx'
import MetricCard from '../components/MetricCard.jsx'

const DONUT_COLORS = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6']

function momPct(series) {
  if (series.length < 2) return null
  const prev = series[series.length - 2].value
  const cur = series[series.length - 1].value
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

const tooltipStyle = () => ({
  background: 'var(--tt-bg)', border: '1px solid var(--tt-border)', borderRadius: 12,
  fontSize: 12, color: 'var(--tt-color)', boxShadow: '0 10px 30px rgba(0,0,0,.5)'
})
const AXIS = { fill: 'var(--axis)', fontSize: 11 }

function SourceConversionJourney({ data = [] }) {
  const [active, setActive] = React.useState(0)
  const max = Math.max(...data.map(d => d.count), 1)
  const selected = data[active] || data[0]
  const conversionRate = selected?.count ? Math.round((selected.won / selected.count) * 100) : 0

  return (
    <div className="pipeline-journey">
      <div className="pipeline-journey-summary">
        <div><span>Selected source</span><strong>{selected?.source || 'No sources'}</strong></div>
        <div className="text-right"><span>Leads / conversions</span><strong className="mono">{selected?.count || 0} / {selected?.won || 0}</strong></div>
        <div className="text-right"><span>Conversion rate</span><strong className="mono text-emerald-400">{conversionRate}%</strong></div>
      </div>
      <div className="pipeline-steps source-conversion-steps" role="list" aria-label="Lead and conversion performance by source">
        {data.map((item, i) => {
          const rate = item.count ? Math.round((item.won / item.count) * 100) : 0
          return (
            <button key={item.source} type="button" role="listitem"
              className={`pipeline-step ${active === i ? 'is-active' : ''}`}
              style={{ '--step-color': DONUT_COLORS[i % DONUT_COLORS.length], '--step-width': `${Math.max(8, (item.count / max) * 100)}%`, '--won-width': `${item.count ? (item.won / item.count) * 100 : 0}%` }}
              onClick={() => setActive(i)} aria-pressed={active === i}>
              <span className="pipeline-step-index">{String(i + 1).padStart(2, '0')}</span>
              <span className="pipeline-step-label">{item.source}</span>
              <span className="pipeline-step-track source-track"><span className="lead-volume"><i /></span></span>
              <strong className="mono">{item.count} / <em>{item.won}</em></strong>
              <small>{rate}%</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MonthlyPipeline({ stages, data }) {
  const [range, setRange] = React.useState(6)
  const [stage, setStage] = React.useState('all')
  const [selectedMonth, setSelectedMonth] = React.useState(null)
  const visible = data.slice(-range)
  const shownStages = stage === 'all' ? stages : stages.filter(s => s === stage)
  const ranked = visible.map(row => ({
    ...row,
    total: shownStages.reduce((sum, s) => sum + (row[s] || 0), 0)
  })).sort((a, b) => b.total - a.total)
  const splitAt = Math.ceil(ranked.length / 2)
  const selected = selectedMonth ? visible.find(row => row.month === selectedMonth) : ranked[0]

  return (
    <>
      <div className="pipeline-controls" aria-label="Monthly pipeline chart controls">
        <div className="pipeline-control-group">
          {[6, 12].map(n => <button key={n} type="button" className={range === n ? 'is-active' : ''} onClick={() => setRange(n)}>{n}M</button>)}
        </div>
        <div className="pipeline-stage-tabs">
          <button type="button" className={stage === 'all' ? 'is-active' : ''} onClick={() => setStage('all')}>All stages</button>
          {stages.map((s, i) => <button key={s} type="button" className={stage === s ? 'is-active' : ''} style={{ '--tab-color': DONUT_COLORS[i % DONUT_COLORS.length] }} onClick={() => setStage(s)}>{s}</button>)}
        </div>
      </div>
      <div className="pipeline-ranking-panel">
        <div className="pipeline-ranking-spotlight">
          <div><span>Selected period</span><strong>{selected?.month || 'No data'}</strong></div>
          <div><span>Pipeline volume</span><strong>{selected ? shownStages.reduce((sum, s) => sum + (selected[s] || 0), 0) : 0}</strong></div>
          <div><span>Stage filter</span><strong>{stage === 'all' ? 'All stages' : stage}</strong></div>
        </div>
        <div className="pipeline-ranking-columns">
          <RankingColumn title="Top periods" tone="top" rows={ranked.slice(0, splitAt)} selected={selected?.month} onSelect={setSelectedMonth} />
          <RankingColumn title="Bottom periods" tone="bottom" rows={ranked.slice(splitAt)} selected={selected?.month} onSelect={setSelectedMonth} rankOffset={splitAt} />
        </div>
      </div>
    </>
  )
}

function RankingColumn({ title, tone, rows, selected, onSelect, rankOffset = 0 }) {
  return (
    <div className={`pipeline-ranking-column is-${tone}`}>
      <div className="pipeline-ranking-heading"><span>{title}</span><small>{rows.length} periods</small></div>
      <div className="pipeline-ranking-list" role="list">
        {rows.map((row, i) => (
          <button key={row.month} type="button" role="listitem" className={selected === row.month ? 'is-active' : ''} onClick={() => onSelect(row.month)}>
            <span className="pipeline-ranking-position">#{rankOffset + i + 1}</span>
            <strong>{row.month}</strong>
            <span className="pipeline-ranking-score">{row.total}</span>
          </button>
        ))}
        {!rows.length && <p>No periods available</p>}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { openLead, refreshData, boot, dataVersion } = useApp()
  const { data: ov, loading: l1, error: e1, reload: r1 } = useFetch(() => api.get('/api/analytics/overview'), [])
  const { data: tl, loading: l2 } = useFetch(() => api.get('/api/analytics/timeline'), [])
  const { data: funnelByMonth } = useFetch(() => api.get('/api/analytics/funnel-by-month'), [])
  const { data: sources, loading: l4 } = useFetch(() => api.get('/api/analytics/sources'), [])
  const { data: team, loading: l5 } = useFetch(() => api.get('/api/analytics/team'), [])
  const { data: hotResp } = useFetch(() => api.get('/api/leads?risk=hot&pageSize=50'), [])
  const { alerts } = useApp()

  const [perfRange, setPerfRange] = React.useState('week')
  const [compareOpen, setCompareOpen] = React.useState(false)
  const [perfOpen, setPerfOpen] = React.useState(false)
  const { data: perf } = useFetch(() => api.get(`/api/analytics/performance?range=${perfRange}`), [perfRange, dataVersion])

  const hot = (hotResp?.items || []).slice().sort((a, b) => b.ai.score - a.ai.score).slice(0, 5)
  const srcData = (sources || []).slice(0, 7)
  const perfBuckets = perf?.buckets || []
  const perfTotals = perf?.totals || {}

  const reload = () => { r1(); refreshData() }

  const newLeadsTrend = (tl || []).map(m => ({ label: m.month, value: m.newLeads }))
  const revenueTrend = (tl || []).map(m => ({ label: m.month, value: m.revenue }))
  const conversionTrend = (tl || []).map(m => ({ label: m.month, value: m.newLeads ? Math.round((m.won / m.newLeads) * 100) : 0 }))
  const avgDealTrend = (tl || []).map(m => ({ label: m.month, value: m.won ? m.revenue / m.won : 0 }))

  const funnelStages = funnelByMonth?.stages || []
  const funnelMonthData = (funnelByMonth?.months || []).map(m => ({ month: m.month, ...m.stages }))

  if (l1) return <Loading />
  if (e1 || !ov) {
    return (
      <div className="p-6">
        <div className="card p-6 text-center space-y-3">
          <p className="text-slate-300 text-[13px]">Couldn't reach the API{e1?.message ? `: ${e1.message}` : '.'}</p>
          <button className="btn btn-ghost !py-1.5 text-[12px]" onClick={reload}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-[12.5px]">Overview · {(boot?.locations || []).length} studio locations</p>
        </div>
        <button className="btn btn-ghost !py-1.5 text-[12px]" onClick={reload}>Refresh</button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricCard icon={Users} title="Total leads" value={ov.totalLeads} color="#8b5cf6"
          description="All-time leads captured across every source." trend={newLeadsTrend} mom={momPct(newLeadsTrend)} />
        <MetricCard icon={Users} title="Open leads" value={ov.openLeads} color="#06b6d4"
          description={`${ov.hotLeads} hot right now — active, not yet won or lost.`} />
        <MetricCard icon={TrendingUp} title="Conversion" value={`${ov.conversionRate}%`} color="#10b981"
          description={`${ov.won} leads won out of all leads created.`} trend={conversionTrend} mom={momPct(conversionTrend)} />
        <MetricCard icon={Target} title="New this month" value={ov.newThisMonth} color="#f59e0b"
          description="New leads created in the current calendar month." trend={newLeadsTrend} mom={ov.newDeltaPct} />
        <MetricCard icon={IndianRupee} title="Revenue (month)" value={money(ov.revenueThisMonth)} color="#f43f5e"
          description="Estimated revenue from deals won this month." trend={revenueTrend} mom={ov.revenueDeltaPct} />
        <MetricCard icon={Flame} title="Avg deal value" value={money(ov.avgDealValue)} color="#ec4899"
          description="Average estimated value per won lead." trend={avgDealTrend} mom={momPct(avgDealTrend)} />
      </div>

      {/* row 2: timeline + sources */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-semibold text-white text-[14px]">Lead volume & wins</h3>
              <p className="text-[11.5px] text-slate-500 mt-0.5">Last 12 months</p>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#8b5cf6' }} /> New leads</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#10b981' }} /> Won</span>
            </div>
          </div>
          <div className="chart-3d h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tl || []} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gNew" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gWon" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Area type="monotone" dataKey="newLeads" name="New leads" stroke="#a78bfa" fill="url(#gNew)" strokeWidth={2} activeDot={{ r: 5, strokeWidth: 2 }} />
                <Area type="monotone" dataKey="won" name="Won" stroke="#34d399" fill="url(#gWon)" strokeWidth={2} activeDot={{ r: 5, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-display font-semibold text-white text-[14px] mb-1">Leads by source</h3>
          <p className="text-[11.5px] text-slate-500 mb-3">Where leads are coming from</p>
          <div className="chart-3d h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={srcData} dataKey="count" nameKey="source" innerRadius={52} outerRadius={78} paddingAngle={2} strokeWidth={0}>
                  {srcData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle()} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-1">
            {srcData.slice(0, 5).map((s, i) => (
              <div key={s.source} className="flex items-center gap-2 text-[12px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                <span className="text-slate-300 flex-1 truncate">{s.source}</span>
                <span className="mono text-slate-400">{s.count}</span>
                <span className="text-emerald-400 text-[10.5px] mono">{s.won} won</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* row 3: funnel + AI + alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card p-5">
          <h3 className="font-display font-semibold text-white text-[14px] mb-1">Leads & conversions by source</h3>
          <p className="text-[11.5px] text-slate-500 mb-4">Select a source to compare lead volume with converted leads</p>
          <SourceConversionJourney data={sources || []} />
        </div>

        <div className="card p-5 xl:col-span-2">
          <h3 className="font-display font-semibold text-white text-[14px] mb-1">Pipeline funnel by month</h3>
          <p className="text-[11.5px] text-slate-500 mb-3">Compare the last 6 or 12 months, then isolate any pipeline stage</p>
          <MonthlyPipeline stages={funnelStages} data={funnelMonthData} />
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={15} className="text-fuchsia-400" />
            <h3 className="font-display font-semibold text-white text-[14px]">AI recommended actions</h3>
          </div>
          <p className="text-[11.5px] text-slate-500 mb-3">Highest-intent leads that need attention</p>
          <div className="space-y-2">
            {hot.map(l => (
              <button key={l.id} className="w-full text-left card card-hover !rounded-xl p-3 flex items-center gap-3" onClick={() => openLead(l.id)}>
                <Avatar name={l.fullName} color={l.associateColor} size={34} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-white truncate">{l.fullName}</span>
                    <span className={`chip !px-1.5 !py-0.5 text-[9.5px] uppercase ${riskClass(l.ai.risk)}`}>{l.ai.risk}</span>
                  </div>
                  <div className="text-[11.5px] text-slate-400 truncate mt-0.5">{l.ai.nextAction?.text}</div>
                </div>
                <ScorePill score={l.ai.score} />
              </button>
            ))}
            {!hot.length && <Empty icon={<Sparkles size={20} />} title="No hot leads" subtitle="Leads scoring 70+ will appear here." />}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert size={15} className="text-amber-400" />
            <h3 className="font-display font-semibold text-white text-[14px]">Priority alerts</h3>
          </div>
          <p className="text-[11.5px] text-slate-500 mb-3">Follow-ups, idle high-value leads & unassigned</p>
          <div className="space-y-2 max-h-[280px] overflow-y-auto scrollbar-thin pr-1">
            {alerts.slice(0, 8).map(a => (
              <button key={a.id} className="w-full text-left card !rounded-xl p-3 flex items-center gap-3 hover:bg-white/5 transition-colors" onClick={() => openLead(a.leadId)}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${a.level === 'high' ? 'bg-rose-400' : 'bg-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold text-white truncate">{a.leadName}</div>
                  <div className="text-[11.5px] text-slate-400 truncate">{a.title} — {a.detail}</div>
                </div>
                <ChevronRight size={14} className="text-slate-600" />
              </button>
            ))}
            {!alerts.length && <p className="text-[12.5px] text-slate-500">No priority alerts.</p>}
          </div>
        </div>
      </div>

      {/* row: weekly / monthly performance */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={15} className="text-cyan-400" />
            <h3 className="font-display font-semibold text-white text-[14px]">Lead performance</h3>
          </div>
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            <button className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${perfRange === 'week' ? 'bg-rose-500/25 text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`} onClick={() => setPerfRange('week')}>Weekly</button>
            <button className={`px-3 py-1.5 text-[12px] font-semibold transition-colors border-l border-white/10 ${perfRange === 'month' ? 'bg-rose-500/25 text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`} onClick={() => setPerfRange('month')}>Monthly</button>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11.5px] text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#8b5cf6' }} /> New</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#10b981' }} /> Won</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#fbbf24' }} /> Missed FU</span>
          </div>
          <button className="btn btn-soft !py-1.5 !text-[12px]" onClick={() => setCompareOpen(true)}><Award size={14} /> Associate faceoff</button>
          <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={() => setPerfOpen(true)}><BarChart3 size={13} /> Full details</button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="chart-3d lg:col-span-3 h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perfBuckets} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="newLeads" name="New leads" fill="#8b5cf6" radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
                <Bar dataKey="won" name="Won" fill="#10b981" radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
                <Bar dataKey="missed" name="Missed follow-ups" fill="#fbbf24" radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2.5">
            <PerfStat label="New leads" value={perfTotals.newLeads} color="#8b5cf6" />
            <PerfStat label="Won deals" value={perfTotals.won} color="#34d399" />
            <PerfStat label="Revenue" value={money(perfTotals.revenue)} color="#f43f5e" />
            <PerfStat label="Follow-up completion" value={`${perfTotals.followUpRate || 0}%`} color="#fbbf24" sub={`${perfTotals.missed || 0} missed of ${perfTotals.followUps || 0} scheduled`} />
          </div>
        </div>
      </div>

      {/* row 4: team leaderboard */}
      <div className="card p-5">
        <h3 className="font-display font-semibold text-white text-[14px] mb-4">Associate leaderboard</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {(team || []).map((t, i) => (
            <div key={t.associateId} className="card !rounded-xl p-3.5 flex items-center gap-3">
              <span className="font-display text-[13px] font-bold text-slate-600 w-5">{i + 1}</span>
              <Avatar name={t.name} size={34} />
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-white truncate">{t.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{boot?.locations.find(l => l.id === t.locationId)?.name?.split(',')[0] || ''}</div>
              </div>
              <div className="text-right">
                <div className="text-[12.5px] font-semibold text-emerald-400 mono">{money(t.revenue)}</div>
                <div className="text-[10.5px] text-slate-500">{t.won} won · {t.conversion}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AssociateCompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />
      <PerformanceModal open={perfOpen} onClose={() => setPerfOpen(false)} range={perfRange} />
    </div>
  )
}

function PerfStat({ label, value, color, sub }) {
  return (
    <div className="card !rounded-xl px-3.5 py-3 flex items-center justify-between">
      <div>
        <div className="text-[11px] text-slate-400">{label}</div>
        {sub && <div className="text-[10.5px] text-slate-600 mt-0.5">{sub}</div>}
      </div>
      <div className="font-display text-[17px] font-bold mono" style={{ color }}>{value}</div>
    </div>
  )
}

function Loading() {
  return <div className="p-10 text-center text-slate-500">Loading dashboard…</div>
}
