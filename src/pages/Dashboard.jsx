import React from 'react'
import {
  Users, Trophy, TrendingUp, IndianRupee, Target, Flame, UserPlus,
  Sparkles, ChevronRight, ShieldAlert,
  BarChart3, Award, CalendarRange,
  Phone, MessageCircle, MessageSquareText, Mail
} from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { money, stageClass, riskClass, fmtDate, timeAgo, initials } from '../lib.js'
import { Avatar, Empty } from '../ui.jsx'
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
  if (!prev) return cur ? 100 : null
  return ((cur - prev) / prev) * 100
}

function yoyPct(series) {
  if (series.length < 12) return null
  const prev = series[0].value
  const cur = series[series.length - 1].value
  if (!prev) return cur ? 100 : null
  return ((cur - prev) / prev) * 100
}

const tooltipStyle = () => ({
  background: 'var(--tt-bg)', border: '1px solid var(--tt-border)', borderRadius: 12,
  fontSize: 12, color: 'var(--tt-color)', boxShadow: '0 10px 30px rgba(0,0,0,.5)'
})
const AXIS = { fill: 'var(--axis)', fontSize: 11 }

export default function Dashboard() {
  const { openLead, refreshData, boot, dataVersion } = useApp()
  const { data: ov, loading: l1, error: e1, reload: r1 } = useFetch(() => api.get('/api/analytics/overview'), [dataVersion])
  const { data: tl, loading: l2 } = useFetch(() => api.get('/api/analytics/timeline'), [dataVersion])
  const { data: sources, loading: l4 } = useFetch(() => api.get('/api/analytics/sources'), [dataVersion])
  const { data: team, loading: l5 } = useFetch(() => api.get('/api/analytics/team'), [dataVersion])
  const { data: hotResp } = useFetch(() => api.get('/api/leads?risk=hot&pageSize=50'), [dataVersion])
  const { alerts } = useApp()

  const [perfRange, setPerfRange] = React.useState('month')
  const [compareOpen, setCompareOpen] = React.useState(false)
  const [perfOpen, setPerfOpen] = React.useState(false)
  const [sourceMetric, setSourceMetric] = React.useState('count')
  const [sourceView, setSourceView] = React.useState('top')
  const [leadChartMode, setLeadChartMode] = React.useState('combined')
  const [leadChartRange, setLeadChartRange] = React.useState(12)
  const [leadChartCumulative, setLeadChartCumulative] = React.useState(false)
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
  const srcData = (sources || []).slice(0, 7).map(s => ({
    ...s,
    rate: s.count ? Math.round((s.won / s.count) * 100) : 0,
    chartValue: sourceMetric === 'won' ? s.won : sourceMetric === 'rate' ? (s.count ? Math.round((s.won / s.count) * 100) : 0) : s.count
  }))
  const perfBuckets = perf?.buckets || []
  const perfTotals = perf?.totals || {}

  const reload = () => { r1(); refreshData() }

  const newLeadsTrend = (tl || []).map(m => ({ label: m.month, value: m.newLeads }))
  const revenueTrend = (tl || []).map(m => ({ label: m.month, value: m.revenue }))
  const conversionTrend = (tl || []).map(m => ({ label: m.month, value: m.newLeads ? Math.round((m.won / m.newLeads) * 100) : 0 }))
  const avgDealTrend = (tl || []).map(m => ({ label: m.month, value: m.won ? m.revenue / m.won : 0 }))
  const openLeadsTrend = (tl || []).map(m => ({ label: m.month, value: m.openLeads }))
  const leadChartData = React.useMemo(() => {
    let runningLeads = 0
    let runningWins = 0
    return (tl || []).slice(-leadChartRange).map(m => {
      runningLeads += m.newLeads || 0
      runningWins += m.won || 0
      const newLeads = leadChartCumulative ? runningLeads : (m.newLeads || 0)
      const won = leadChartCumulative ? runningWins : (m.won || 0)
      return {
        ...m,
        newLeads,
        won,
        conversion: m.newLeads ? Math.round(((m.won || 0) / m.newLeads) * 100) : 0
      }
    })
  }, [tl, leadChartRange, leadChartCumulative])

  const sourceRanked = (sources || []).slice().sort((a, b) => b.count - a.count)
  const topSources = sourceRanked.slice(0, 5)
  const bottomSources = sourceRanked.slice(-5).reverse()
  const shownSources = sourceView === 'top' ? topSources : bottomSources
  const shownMax = Math.max(...shownSources.map(s => s.count), 1)
  const teamRows = team || []
  const bestAssociate = teamRows[0]
  const avgTeamConversion = teamRows.length ? Math.round(teamRows.reduce((sum, row) => sum + (row.conversion || 0), 0) / teamRows.length) : 0
  const topHalf = teamRows.slice(0, Math.ceil(teamRows.length / 2))
  const bottomHalf = teamRows.slice(Math.ceil(teamRows.length / 2)).reverse()
  const worstAssociate = bottomHalf[0]

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
    <div className="dashboard-page p-6 pt-4 space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricCard icon={Users} title="Total leads" value={ov.totalLeads} color="var(--accent)"
          description="All-time leads captured across every source." calculation="Total count of lead records in the CRM, regardless of current pipeline stage."
          trend={newLeadsTrend} mom={momPct(newLeadsTrend)} yoy={yoyPct(newLeadsTrend)} />
        <MetricCard icon={UserPlus} title="Open leads" value={ov.openLeads} color="var(--dashboard-secondary)"
          description={`${ov.hotLeads} hot right now. Active leads that are not won or lost.`}
          calculation="Count of leads whose status is still open, excluding won and lost records."
          trend={openLeadsTrend} mom={momPct(openLeadsTrend)} yoy={yoyPct(openLeadsTrend)} />
        <MetricCard icon={TrendingUp} title="Conversion" value={`${ov.conversionRate}%`} color="var(--dashboard-secondary)"
          description={`${ov.won} leads won out of all leads created.`} calculation="Closed-won leads divided by total leads, shown as a percentage."
          trend={conversionTrend} mom={momPct(conversionTrend)} yoy={yoyPct(conversionTrend)} />
        <MetricCard icon={Target} title="New this month" value={ov.newThisMonth} color="var(--accent)"
          description="New leads created in the current calendar month." calculation="Lead records with a creation date inside the current calendar month."
          trend={newLeadsTrend} mom={ov.newDeltaPct} yoy={yoyPct(newLeadsTrend)} />
        <MetricCard icon={IndianRupee} title="Revenue (month)" value={money(ov.revenueThisMonth)} color="var(--dashboard-secondary)"
          description="Estimated revenue from deals won this month." calculation="Sum of estimated deal values for leads closed-won during the current month."
          trend={revenueTrend} mom={ov.revenueDeltaPct} yoy={yoyPct(revenueTrend)} />
        <MetricCard icon={Flame} title="Avg deal value" value={money(ov.avgDealValue)} color="var(--accent)"
          description="Average estimated value per won lead." calculation="Revenue from won leads divided by the number of won leads."
          trend={avgDealTrend} mom={momPct(avgDealTrend)} yoy={yoyPct(avgDealTrend)} />
      </div>

      {/* row 2: timeline + sources */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card p-5 xl:col-span-2 lead-performance-panel">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="font-display font-semibold text-white text-[15px]">Lead volume & wins</h3>
              <p className="text-[11.5px] text-slate-500 mt-0.5">{leadChartCumulative ? 'Cumulative pipeline movement' : `Last ${leadChartRange} months`}</p>
            </div>
            <div className="lead-control-stack">
              <div className="lead-chart-controls">
                {[
                  { id: 'combined', label: 'Combined' },
                  { id: 'leads', label: 'Leads' },
                  { id: 'wins', label: 'Wins' },
                  { id: 'conversion', label: 'Rate' }
                ].map(btn => (
                  <button key={btn.id} className={leadChartMode === btn.id ? 'is-active' : ''} onClick={() => setLeadChartMode(btn.id)}>{btn.label}</button>
                ))}
              </div>
              <div className="lead-chart-controls is-compact">
                {[6, 12].map(range => (
                  <button key={range} className={leadChartRange === range ? 'is-active' : ''} onClick={() => setLeadChartRange(range)}>{range}M</button>
                ))}
                <button className={leadChartCumulative ? 'is-active' : ''} onClick={() => setLeadChartCumulative(v => !v)}>Cum.</button>
              </div>
            </div>
          </div>
          <div className="lead-chart-stats">
            <div><span>Current leads</span><strong>{newLeadsTrend.at(-1)?.value ?? 0}</strong></div>
            <div><span>Current wins</span><strong>{(tl || []).at(-1)?.won ?? 0}</strong></div>
            <div><span>MoM lead movement</span><strong>{momPct(newLeadsTrend) == null ? '—' : `${momPct(newLeadsTrend).toFixed(1)}%`}</strong></div>
          </div>
          <div className="lead-chart-3d h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={leadChartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
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
                <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} hide={leadChartMode !== 'conversion'} />
                <Tooltip contentStyle={tooltipStyle()} cursor={{ stroke: 'var(--accent)', strokeOpacity: 0.35, strokeWidth: 1 }} />
                <Legend verticalAlign="top" height={24} iconType="circle" wrapperStyle={{ fontSize: 11, color: 'var(--axis)' }} />
                {(leadChartMode === 'combined' || leadChartMode === 'leads') && <Bar yAxisId="left" dataKey="newLeads" name={leadChartCumulative ? 'Cumulative leads' : 'New leads'} fill="var(--accent)" radius={[7, 7, 2, 2]} barSize={20} />}
                {(leadChartMode === 'combined' || leadChartMode === 'wins') && <Line yAxisId="left" type="monotone" dataKey="won" name={leadChartCumulative ? 'Cumulative wins' : 'Won'} stroke="var(--dashboard-secondary)" strokeWidth={3} dot={{ r: 3, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} />}
                {(leadChartMode === 'conversion') && <Area yAxisId="right" type="monotone" dataKey="conversion" name="Conversion rate" stroke="var(--dashboard-warning)" fill="url(#gWon)" strokeWidth={2.8} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5 dashboard-chart-card">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="font-display font-semibold text-white text-[15px] mb-1">Leads by source</h3>
              <p className="text-[11.5px] text-slate-500">Where leads are coming from</p>
            </div>
            <div className="chart-mini-controls">
              {[
                { id: 'count', label: 'Volume' },
                { id: 'won', label: 'Won' },
                { id: 'rate', label: 'Rate' }
              ].map(btn => (
                <button key={btn.id} className={sourceMetric === btn.id ? 'is-active' : ''} onClick={() => setSourceMetric(btn.id)}>{btn.label}</button>
              ))}
            </div>
          </div>
          <div className="chart-3d source-donut h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={srcData} dataKey="chartValue" nameKey="source" innerRadius={52} outerRadius={78} paddingAngle={2} strokeWidth={0}>
                  {srcData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle()} />
              </PieChart>
            </ResponsiveContainer>
            <div className="source-donut-center">
              <span>{sourceMetric === 'rate' ? 'Avg rate' : sourceMetric === 'won' ? 'Won' : 'Leads'}</span>
              <strong>{sourceMetric === 'rate'
                ? `${Math.round(srcData.reduce((sum, s) => sum + s.rate, 0) / Math.max(srcData.length, 1))}%`
                : srcData.reduce((sum, s) => sum + (sourceMetric === 'won' ? s.won : s.count), 0)}</strong>
            </div>
          </div>
          <div className="space-y-1.5 mt-1">
            {srcData.slice(0, 5).map((s, i) => (
              <div key={s.source} className="flex items-center gap-2 text-[12px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                <span className="text-slate-300 flex-1 truncate">{s.source}</span>
                <span className="mono text-slate-400">{s.count}</span>
                <span className="text-emerald-400 text-[10.5px] mono">{s.won} won</span>
                <span className="source-rate-badge">{s.rate}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* row 3: AI + source ranking + alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card p-5 ai-actions-card">
          <div className="ai-actions-heading">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={15} style={{ color: 'var(--accent)' }} />
                <h3 className="font-display font-semibold text-white text-[15px]">AI recommended actions</h3>
              </div>
              <p className="text-[11.5px] text-slate-500">Highest-intent leads that need attention</p>
            </div>
            <span className="ai-actions-count">{hot.length}</span>
          </div>
          <div className="ai-actions-list">
            {hot.map(l => (
              <div key={l.id} className="group ai-action-row">
                <button className="w-full text-left flex items-center gap-3" onClick={() => openLead(l.id)}>
                  <span className="ai-action-mark">{initials(l.fullName)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-white truncate">{l.fullName}</span>
                      <span className={`ai-risk-chip ${riskClass(l.ai.risk)}`}>{l.ai.risk}</span>
                    </div>
                    <div className="text-[11.5px] text-slate-400 truncate mt-0.5">{l.ai.nextAction?.text}</div>
                  </div>
                  <span className="ai-action-score"><strong>{l.ai.score}</strong><small>score</small></span>
                </button>
                <div className="ai-action-tools">
                  {QUICK_ACTIONS.map(qa => (
                    <button key={qa.channel} title={qa.label}
                      className="ai-action-tool"
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
                <div key={s.source} className="source-rank-row">
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

      {/* row 4: associate leaderboard, top vs bottom */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 associate-leaderboard-panel">
          <div className="associate-leaderboard-head">
            <div>
              <h3 className="font-display font-semibold text-white text-[15px]">Top associates</h3>
              <p>{bestAssociate ? `${bestAssociate.name} leads by revenue · ${avgTeamConversion}% avg conversion` : 'No associate performance yet'}</p>
            </div>
            <div className="associate-leaderboard-summary">
              <span><strong>{teamRows.length}</strong><small>active</small></span>
              <span><strong>{teamRows.reduce((sum, row) => sum + (row.won || 0), 0)}</strong><small>won</small></span>
              <span><strong>{avgTeamConversion}%</strong><small>avg conv.</small></span>
            </div>
          </div>
          <div className="associate-rank-list">
            {topHalf.map((t, i) => (
              <button key={t.associateId} className="associate-rank-row" onClick={() => setScorecardId(t.associateId)}>
                <span className={`associate-rank-number ${i === 0 ? 'is-gold' : i === 1 ? 'is-silver' : i === 2 ? 'is-bronze' : 'is-good'}`}>{i + 1}</span>
                <Avatar name={t.name} color={t.color} photoUrl={t.photoUrl} photoZoom={t.photoZoom} photoPosX={t.photoPosX} photoPosY={t.photoPosY} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="associate-rank-name">{t.name}</div>
                  <div className="associate-rank-sub">{boot?.locations.find(l => l.id === t.locationId)?.name?.split(',')[0] || ''}</div>
                </div>
                <div className="associate-rank-revenue">{money(t.revenue)}</div>
                <div className="associate-rank-metrics">
                  <span>{t.conversion}%</span>
                  <span>{t.open || 0} open</span>
                  <strong>{t.won} won</strong>
                </div>
              </button>
            ))}
            {!topHalf.length && <Empty icon={<Trophy size={20} />} title="No associate data" subtitle="Performance will appear once leads are worked." />}
          </div>
        </div>

        <div className="card p-5 associate-leaderboard-panel">
          <div className="associate-leaderboard-head">
            <div>
              <h3 className="font-display font-semibold text-white text-[15px]">Needs attention</h3>
              <p>{worstAssociate ? `${worstAssociate.name} trails the team · lowest conversion & revenue` : 'No associate performance yet'}</p>
            </div>
            <div className="associate-leaderboard-summary">
              <span><strong>{bottomHalf.length}</strong><small>active</small></span>
              <span><strong>{bottomHalf.reduce((sum, row) => sum + (row.won || 0), 0)}</strong><small>won</small></span>
            </div>
          </div>
          <div className="associate-rank-list">
            {bottomHalf.map((t, i) => (
              <button key={t.associateId} className="associate-rank-row" onClick={() => setScorecardId(t.associateId)}>
                <span className={`associate-rank-number ${i === 0 ? 'is-bad' : ''}`}>{i + 1}</span>
                <Avatar name={t.name} color={t.color} photoUrl={t.photoUrl} photoZoom={t.photoZoom} photoPosX={t.photoPosX} photoPosY={t.photoPosY} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="associate-rank-name">{t.name}</div>
                  <div className="associate-rank-sub">{boot?.locations.find(l => l.id === t.locationId)?.name?.split(',')[0] || ''}</div>
                </div>
                <div className="associate-rank-revenue">{money(t.revenue)}</div>
                <div className="associate-rank-metrics">
                  <span>{t.conversion}%</span>
                  <span>{t.open || 0} open</span>
                  <strong>{t.won} won</strong>
                </div>
              </button>
            ))}
            {!bottomHalf.length && <Empty icon={<Trophy size={20} />} title="No associate data" subtitle="Performance will appear once leads are worked." />}
          </div>
        </div>
      </div>

      <div className="dashboard-footer-note">
        <span>Overview · {(boot?.locations || []).length} studio locations</span>
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
    <div className="perf-stat-card px-3.5 py-3 flex items-center justify-between">
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
  const latest = rows.at(-1) || {}
  return (
    <div className="lead-performance-deck">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 24, right: 18, left: -18, bottom: 6 }}>
          <CartesianGrid stroke="rgba(148,163,184,.14)" vertical={false} strokeDasharray="4 7" />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(148,163,184,.08)' }} />
          <Legend verticalAlign="top" height={22} iconType="circle" wrapperStyle={{ fontSize: 11, color: 'var(--axis)' }} />
          {visible?.newLeads !== false && <Bar dataKey="newLeads" name="New leads" fill="var(--accent)" radius={[7, 7, 2, 2]} barSize={18} />}
          {visible?.won !== false && <Line type="monotone" dataKey="won" name="Won deals" stroke="var(--dashboard-secondary)" strokeWidth={3} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />}
          {visible?.missed !== false && <Bar dataKey="missed" name="Missed FU" fill="var(--dashboard-warning)" radius={[6, 6, 2, 2]} barSize={10} />}
        </ComposedChart>
      </ResponsiveContainer>
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
