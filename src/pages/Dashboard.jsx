import React from 'react'
import {
  Users, Trophy, TrendingUp, IndianRupee, Target, Flame, UserPlus,
  Sparkles, ChevronRight, ShieldAlert,
  BarChart3, Award, CalendarRange,
  Phone, MessageCircle, MessageSquareText, Mail
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell
} from 'recharts'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { money, stageClass, riskClass, fmtDate, timeAgo } from '../lib.js'
import { Avatar, ScorePill, Empty } from '../ui.jsx'
import AssociateCompareModal from '../components/AssociateCompareModal.jsx'
import AssociateScorecardModal from '../components/AssociateScorecardModal.jsx'
import PerformanceModal from '../components/PerformanceModal.jsx'
import MetricCard from '../components/MetricCard.jsx'
import ComposeModal from '../components/ComposeModal.jsx'
import RespondioTemplateModal from '../components/RespondioTemplateModal.jsx'

const QUICK_ACTIONS = [
  { channel: 'call', icon: Phone, color: 'var(--dashboard-secondary)', label: 'Call' },
  { channel: 'whatsapp', icon: MessageCircle, color: 'var(--dashboard-secondary)', label: 'WhatsApp' },
  { channel: 'sms', icon: MessageSquareText, color: 'var(--dashboard-warning)', label: 'SMS' },
  { channel: 'email', icon: Mail, color: 'var(--accent)', label: 'Email' }
]

const DASH_COLORS = ['var(--accent)', 'var(--dashboard-secondary)', 'var(--dashboard-warning)']
const DONUT_COLORS = DASH_COLORS

function momPct(series) {
  if (series.length < 2) return null
  const prev = series[series.length - 2].value
  const cur = series[series.length - 1].value
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

function yoyPct(series) {
  if (series.length < 12) return null
  const prev = series[series.length - 12].value
  const cur = series[series.length - 1].value
  if (!prev) return null
  return ((cur - prev) / prev) * 100
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
  const { data: sources, loading: l4 } = useFetch(() => api.get('/api/analytics/sources'), [])
  const { data: team, loading: l5 } = useFetch(() => api.get('/api/analytics/team'), [])
  const { data: hotResp } = useFetch(() => api.get('/api/leads?risk=hot&pageSize=50'), [])
  const { alerts } = useApp()

  const [perfRange, setPerfRange] = React.useState('month')
  const [compareOpen, setCompareOpen] = React.useState(false)
  const [perfOpen, setPerfOpen] = React.useState(false)
  const [sourceView, setSourceView] = React.useState('top')
  const [leadChartMode, setLeadChartMode] = React.useState('combined')
  const [perfSeries, setPerfSeries] = React.useState({ newLeads: true, won: true, missed: true })
  const [composeLead, setComposeLead] = React.useState(null)
  const [composeChannel, setComposeChannel] = React.useState('whatsapp')
  const [templateLead, setTemplateLead] = React.useState(null)
  const [scorecardId, setScorecardId] = React.useState(null)

  const quickContact = (e, lead, channel) => {
    e.stopPropagation()
    if (channel === 'whatsapp') { setTemplateLead(lead); return }
    setComposeChannel(channel)
    setComposeLead(lead)
    openLead(lead.id)
  }
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
  const openLeadsTrend = (tl || []).map(m => ({ label: m.month, value: m.openLeads }))

  const sourceRanked = (sources || []).slice().sort((a, b) => b.count - a.count)
  const topSources = sourceRanked.slice(0, 5)
  const bottomSources = sourceRanked.slice(-5).reverse()
  const shownSources = sourceView === 'top' ? topSources : bottomSources
  const shownMax = Math.max(...shownSources.map(s => s.count), 1)

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
    <div className="dashboard-page p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-[12.5px]">Overview · {(boot?.locations || []).length} studio locations</p>
        </div>
        <button className="btn btn-ghost !py-1.5 text-[12px]" onClick={reload}>Refresh</button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricCard icon={Users} title="Total leads" value={ov.totalLeads} color="var(--accent)"
          description="All-time leads captured across every source." trend={newLeadsTrend} mom={momPct(newLeadsTrend)} yoy={yoyPct(newLeadsTrend)} />
        <MetricCard icon={UserPlus} title="Open leads" value={ov.openLeads} color="var(--dashboard-secondary)"
          description={`${ov.hotLeads} hot right now. Active leads that are not won or lost.`}
          calculation="Count of leads where status is open."
          trend={openLeadsTrend} mom={momPct(openLeadsTrend)} yoy={yoyPct(openLeadsTrend)} />
        <MetricCard icon={TrendingUp} title="Conversion" value={`${ov.conversionRate}%`} color="var(--dashboard-secondary)"
          description={`${ov.won} leads won out of all leads created.`} trend={conversionTrend} mom={momPct(conversionTrend)} yoy={yoyPct(conversionTrend)} />
        <MetricCard icon={Target} title="New this month" value={ov.newThisMonth} color="var(--accent)"
          description="New leads created in the current calendar month." trend={newLeadsTrend} mom={ov.newDeltaPct} yoy={yoyPct(newLeadsTrend)} />
        <MetricCard icon={IndianRupee} title="Revenue (month)" value={money(ov.revenueThisMonth)} color="var(--dashboard-secondary)"
          description="Estimated revenue from deals won this month." trend={revenueTrend} mom={ov.revenueDeltaPct} yoy={yoyPct(revenueTrend)} />
        <MetricCard icon={Flame} title="Avg deal value" value={money(ov.avgDealValue)} color="var(--accent)"
          description="Average estimated value per won lead." trend={avgDealTrend} mom={momPct(avgDealTrend)} yoy={yoyPct(avgDealTrend)} />
      </div>

      {/* row 2: timeline + sources */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card p-5 xl:col-span-2 lead-performance-panel">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-semibold text-white text-[15px]">Lead volume & wins</h3>
              <p className="text-[11.5px] text-slate-500 mt-0.5">Last 12 months</p>
            </div>
            <div className="lead-chart-controls">
              {[
                { id: 'combined', label: 'Combined' },
                { id: 'leads', label: 'Leads' },
                { id: 'wins', label: 'Wins' }
              ].map(btn => (
                <button key={btn.id} className={leadChartMode === btn.id ? 'is-active' : ''} onClick={() => setLeadChartMode(btn.id)}>{btn.label}</button>
              ))}
            </div>
          </div>
          <div className="lead-chart-stats">
            <div><span>Current leads</span><strong>{newLeadsTrend.at(-1)?.value ?? 0}</strong></div>
            <div><span>Current wins</span><strong>{(tl || []).at(-1)?.won ?? 0}</strong></div>
            <div><span>MoM lead movement</span><strong>{momPct(newLeadsTrend) == null ? '—' : `${momPct(newLeadsTrend).toFixed(1)}%`}</strong></div>
          </div>
          <div className="lead-chart-3d h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tl || []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gNew" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.58} />
                    <stop offset="72%" stopColor="var(--accent)" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gWon" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--dashboard-secondary)" stopOpacity={0.52} />
                    <stop offset="72%" stopColor="var(--dashboard-secondary)" stopOpacity={0.07} />
                    <stop offset="100%" stopColor="var(--dashboard-secondary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} strokeDasharray="4 6" />
                <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle()} cursor={{ stroke: 'var(--accent)', strokeOpacity: 0.35, strokeWidth: 1 }} />
                {leadChartMode !== 'wins' && <Area type="monotone" dataKey="newLeads" name="New leads" stroke="var(--accent)" fill="url(#gNew)" strokeWidth={2.6} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} />}
                {leadChartMode !== 'leads' && <Area type="monotone" dataKey="won" name="Won" stroke="var(--dashboard-secondary)" fill="url(#gWon)" strokeWidth={2.6} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-display font-semibold text-white text-[15px] mb-1">Leads by source</h3>
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

      {/* row 3: AI + source ranking + alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={15} style={{ color: 'var(--accent)' }} />
            <h3 className="font-display font-semibold text-white text-[15px]">AI recommended actions</h3>
          </div>
          <p className="text-[11.5px] text-slate-500 mb-3">Highest-intent leads that need attention</p>
          <div className="space-y-2">
            {hot.map(l => (
              <div key={l.id} className="group card card-hover !rounded-xl p-3 space-y-2">
                <button className="w-full text-left flex items-center gap-3" onClick={() => openLead(l.id)}>
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
                <div className="hidden group-hover:flex items-center gap-1.5 pt-2 border-t border-white/8">
                  {QUICK_ACTIONS.map(qa => (
                    <button key={qa.channel} title={qa.label}
                      className="flex-1 h-7 rounded-lg flex items-center justify-center gap-1.5 border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-[10.5px] text-slate-300"
                      onClick={(e) => quickContact(e, l, qa.channel)}>
                      <qa.icon size={13} style={{ color: qa.color }} /> {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!hot.length && <Empty icon={<Sparkles size={20} />} title="No hot leads" subtitle="Leads scoring 70+ will appear here." />}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display font-semibold text-white text-[15px]">Leads by source</h3>
            <div className="flex rounded-lg overflow-hidden border border-white/10 shrink-0">
              <button type="button"
                className={`dashboard-segment px-2.5 py-1 text-[11px] font-semibold transition-colors ${sourceView === 'top' ? 'is-active' : ''}`}
                onClick={() => setSourceView('top')}>Top</button>
              <button type="button"
                className={`dashboard-segment px-2.5 py-1 text-[11px] font-semibold transition-colors border-l border-white/10 ${sourceView === 'bottom' ? 'is-active' : ''}`}
                onClick={() => setSourceView('bottom')}>Bottom</button>
            </div>
          </div>
          <p className="text-[11.5px] text-slate-500 mb-4">{sourceView === 'top' ? 'Highest-volume sources & their conversions' : 'Lowest-volume sources & their conversions'}</p>
          <div className="space-y-2">
            {shownSources.map((s, i) => {
              const rate = s.count ? Math.round((s.won / s.count) * 100) : 0
              return (
                <div key={s.source} className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="dashboard-rank w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                    <span className="text-[12.5px] font-medium text-white flex-1 truncate">{s.source}</span>
                    <span className="mono text-slate-400 text-[12px]">{s.count}</span>
                    <span className="dashboard-secondary-text text-[10.5px] mono shrink-0">{s.won} won</span>
                    <span className="text-[10.5px] mono text-slate-500 shrink-0 w-8 text-right">{rate}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(4, (s.count / shownMax) * 100)}%`, background: sourceView === 'top' ? 'var(--dashboard-secondary)' : 'var(--accent)' }} />
                  </div>
                </div>
              )
            })}
            {!shownSources.length && <p className="text-[11.5px] text-slate-500">No data</p>}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert size={15} style={{ color: 'var(--dashboard-warning)' }} />
            <h3 className="font-display font-semibold text-white text-[15px]">Priority alerts</h3>
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
            <BarChart3 size={15} style={{ color: 'var(--dashboard-secondary)' }} />
            <h3 className="font-display font-semibold text-white text-[15px]">Lead performance</h3>
          </div>
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            <button className={`dashboard-segment px-3 py-1.5 text-[12px] font-semibold transition-colors ${perfRange === 'week' ? 'is-active' : ''}`} onClick={() => setPerfRange('week')}>Weekly</button>
            <button className={`dashboard-segment px-3 py-1.5 text-[12px] font-semibold transition-colors border-l border-white/10 ${perfRange === 'month' ? 'is-active' : ''}`} onClick={() => setPerfRange('month')}>Monthly</button>
          </div>
          <div className="lead-series-controls ml-auto">
            {[['newLeads', 'New'], ['won', 'Won'], ['missed', 'Missed FU']].map(([key, label], i) => (
              <button key={key} type="button" className={perfSeries[key] ? 'is-active' : ''} onClick={() => setPerfSeries(s => (s[key] && Object.values(s).filter(Boolean).length === 1) ? s : ({ ...s, [key]: !s[key] }))} aria-pressed={perfSeries[key]}>
                <span style={{ background: DASH_COLORS[i] }} />{label}
              </button>
            ))}
          </div>
          <button className="btn btn-soft !py-1.5 !text-[12px]" onClick={() => setCompareOpen(true)}><Award size={14} /> Associate faceoff</button>
          <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={() => setPerfOpen(true)}><BarChart3 size={13} /> Full details</button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <LeadPerformanceDeck data={perfBuckets} visible={perfSeries} />
          </div>
          <div className="space-y-2.5">
            <PerfStat label="New leads" value={perfTotals.newLeads} color="var(--accent)" />
            <PerfStat label="Won deals" value={perfTotals.won} color="var(--dashboard-secondary)" />
            <PerfStat label="Revenue" value={money(perfTotals.revenue)} color="var(--accent)" />
            <PerfStat label="Follow-up completion" value={`${perfTotals.followUpRate || 0}%`} color="var(--dashboard-warning)" sub={`${perfTotals.missed || 0} missed of ${perfTotals.followUps || 0} scheduled`} />
          </div>
        </div>
      </div>

      {/* row 4: team leaderboard */}
      <div className="card p-5">
        <h3 className="font-display font-semibold text-white text-[15px] mb-4">Associate leaderboard</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {(team || []).map((t, i) => (
            <button key={t.associateId} className="card card-hover !rounded-xl p-3.5 flex items-center gap-3 text-left" onClick={() => setScorecardId(t.associateId)}>
              <span className="font-display text-[13px] font-bold text-slate-600 w-5">{i + 1}</span>
              <Avatar name={t.name} color={t.color} photoUrl={t.photoUrl} size={34} />
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-white truncate">{t.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{boot?.locations.find(l => l.id === t.locationId)?.name?.split(',')[0] || ''}</div>
              </div>
              <div className="text-right">
                <div className="text-[12.5px] font-semibold text-emerald-400 mono">{money(t.revenue)}</div>
                <div className="text-[10.5px] text-slate-500">{t.won} won · {t.conversion}%</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <AssociateCompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />
      <PerformanceModal open={perfOpen} onClose={() => setPerfOpen(false)} range={perfRange} />
      <AssociateScorecardModal associateId={scorecardId} onClose={() => setScorecardId(null)} openLead={openLead} />
      <ComposeModal open={!!composeLead} onClose={() => setComposeLead(null)} lead={composeLead} defaultChannel={composeChannel} />
      <RespondioTemplateModal open={!!templateLead} onClose={() => setTemplateLead(null)} lead={templateLead} />
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

function LeadPerformanceDeck({ data, visible }) {
  const rows = (data || []).slice(-12)
  const max = Math.max(1, ...rows.map(r => Math.max(r.newLeads || 0, r.won || 0, r.missed || 0)))
  const latest = rows.at(-1) || {}
  return (
    <div className="lead-performance-deck">
      <div className="lead-deck-orbit" />
      <div className="lead-deck-stage">
        {rows.map((r, i) => {
          const leadH = Math.max(10, Math.round(((r.newLeads || 0) / max) * 100))
          const wonH = Math.max(8, Math.round(((r.won || 0) / max) * 100))
          const missedH = Math.max(6, Math.round(((r.missed || 0) / max) * 100))
          const active = i === rows.length - 1
          const label = r.label || r.month
          return (
            <div key={`${label}-${i}`} className={`lead-deck-column ${active ? 'is-current' : ''}`} title={`${label}: ${r.newLeads || 0} new, ${r.won || 0} won, ${r.missed || 0} missed follow-ups`}>
              <div className="lead-deck-bars">
                {visible?.newLeads !== false && <span className="lead-deck-bar lead-deck-bar-new" style={{ height: `${leadH}%` }} />}
                {visible?.won !== false && <span className="lead-deck-bar lead-deck-bar-won" style={{ height: `${wonH}%` }} />}
                {visible?.missed !== false && <span className="lead-deck-bar lead-deck-bar-missed" style={{ height: `${missedH}%` }} />}
              </div>
              <span className="lead-deck-label">{label}</span>
            </div>
          )
        })}
      </div>
      <div className="lead-deck-insight">
        <span>{latest.label || latest.month || 'Current'}</span>
        <strong>{latest.newLeads || 0} new · {latest.won || 0} won · {latest.missed || 0} missed</strong>
      </div>
    </div>
  )
}

function Loading() {
  return <div className="p-10 text-center text-slate-500">Loading dashboard…</div>
}
