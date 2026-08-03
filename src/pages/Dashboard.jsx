import React from 'react'
import {
  Users, Trophy, TrendingUp, IndianRupee, Target, Flame, UserPlus,
  ArrowUpRight, ArrowDownRight, Sparkles, ChevronRight, ShieldAlert,
  BarChart3, Award, CalendarRange
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { money, stageClass, riskClass, fmtDate, timeAgo } from '../lib.js'
import { Avatar, ScorePill, Empty } from '../ui.jsx'
import AssociateCompareModal from '../components/AssociateCompareModal.jsx'
import PerformanceModal from '../components/PerformanceModal.jsx'

const DONUT_COLORS = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6']

function StatCard({ icon: Icon, label, value, sub, delta, deltaUp = true, color }) {
  return (
    <div className="card card-hover p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}1c`, color }}>
          <Icon size={15} />
        </span>
      </div>
      <div className="font-display text-[24px] font-bold text-white mono leading-none">{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[11.5px]">
        {delta !== undefined && delta !== null && (
          <span className={`inline-flex items-center gap-0.5 font-semibold ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(delta)}%
          </span>
        )}
        <span className="text-slate-500 truncate">{sub}</span>
      </div>
    </div>
  )
}

const tooltipStyle = () => ({
  background: 'var(--tt-bg)', border: '1px solid var(--tt-border)', borderRadius: 12,
  fontSize: 12, color: 'var(--tt-color)', boxShadow: '0 10px 30px rgba(0,0,0,.5)'
})
const AXIS = { fill: 'var(--axis)', fontSize: 11 }

export default function Dashboard() {
  const { openLead, refreshData, boot, dataVersion } = useApp()
  const { data: ov, loading: l1, error: e1, reload: r1 } = useFetch(() => api.get('/api/analytics/overview'), [])
  const { data: tl, loading: l2 } = useFetch(() => api.get('/api/analytics/timeline'), [])
  const { data: funnel, loading: l3 } = useFetch(() => api.get('/api/analytics/funnel'), [])
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
        <StatCard icon={Users} label="Total leads" value={ov.totalLeads} sub="all time" color="#8b5cf6" />
        <StatCard icon={Users} label="Open leads" value={ov.openLeads} sub={`${ov.hotLeads} hot right now`} color="#06b6d4" />
        <StatCard icon={TrendingUp} label="Conversion" value={`${ov.conversionRate}%`} sub={`${ov.won} won`} color="#10b981" />
        <StatCard icon={Target} label="New this month" value={ov.newThisMonth} sub="vs last month" delta={ov.newDeltaPct} color="#f59e0b" />
        <StatCard icon={IndianRupee} label="Revenue (month)" value={money(ov.revenueThisMonth)} sub="est. from won deals" delta={ov.revenueDeltaPct} color="#f43f5e" />
        <StatCard icon={Flame} label="Avg deal value" value={money(ov.avgDealValue)} sub="per won lead" color="#ec4899" />
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
          <div className="h-[250px]">
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
                <Area type="monotone" dataKey="newLeads" name="New leads" stroke="#a78bfa" fill="url(#gNew)" strokeWidth={2} />
                <Area type="monotone" dataKey="won" name="Won" stroke="#34d399" fill="url(#gWon)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-display font-semibold text-white text-[14px] mb-1">Leads by source</h3>
          <p className="text-[11.5px] text-slate-500 mb-3">Where leads are coming from</p>
          <div className="h-[190px]">
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
          <h3 className="font-display font-semibold text-white text-[14px] mb-1">Pipeline funnel</h3>
          <p className="text-[11.5px] text-slate-500 mb-4">Leads by stage</p>          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel || []} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="stage" width={110} tick={{ fill: 'var(--axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="count" name="Leads" radius={[0, 6, 6, 0]}>
                  {(funnel || []).map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} opacity={0.9} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
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
          <div className="lg:col-span-3 h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perfBuckets} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="newLeads" name="New leads" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="won" name="Won" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="missed" name="Missed follow-ups" fill="#fbbf24" radius={[4, 4, 0, 0]} />
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
