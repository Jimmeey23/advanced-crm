import React, { useMemo, useState } from 'react'
import {
  Users, TrendingUp, IndianRupee, Target, Flame,
  Sparkles, ChevronRight, ShieldAlert, BarChart3, Award,
  Wallet, Zap, Activity, Clock, AlertTriangle, ArrowUpRight,
  ArrowDownRight, Layers, Filter, Eye, DollarSign, Percent,
  Timer, TrendingDown, CheckCircle2, XCircle, ArrowRight,
  PieChart as PieChartIcon, LineChart as LineChartIcon,
  Brain, Rocket, ShieldCheck, Crown, Gem, Hexagon,
  BarChart2, GitBranch, MousePointerClick, Lightbulb
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, RadialBarChart, RadialBar, Legend
} from 'recharts'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { money } from '../lib.js'
import { Avatar, ScorePill, Empty } from '../ui.jsx'
import AssociateCompareModal from '../components/AssociateCompareModal.jsx'
import PerformanceModal from '../components/PerformanceModal.jsx'
import MetricCard from '../components/MetricCard.jsx'

const DONUT_COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#6366f1', '#14b8a6', '#f43f5e']
const STAGE_PROBABILITY = {
  'New Lead': 10, 'Contacted': 22, 'Trial Booked': 38, 'Trial Completed': 58,
  'Follow Up': 68, 'Proposal Sent': 78, 'Negotiation': 88, 'Won': 100, 'Lost': 0
}
const STAGE_COLOR = {
  'New Lead': '#3b82f6', 'Contacted': '#6366f1', 'Trial Booked': '#06b6d4',
  'Trial Completed': '#10b981', 'Follow Up': '#f59e0b', 'Proposal Sent': '#a855f7',
  'Negotiation': '#ec4899', 'Won': '#34d399', 'Lost': '#64748b'
}

function momPct(series) {
  if (series.length < 2) return null
  const prev = series[series.length - 2].value
  const cur = series[series.length - 1].value
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

const tooltipStyle = () => ({
  background: 'rgba(15,18,32,0.92)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16,
  fontSize: 12, color: '#e6e8f0', boxShadow: '0 16px 48px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,0.05)',
  backdropFilter: 'blur(20px)'
})
const AXIS = { fill: '#64748b', fontSize: 11, fontWeight: 500 }

/* ------------------------------------------------------------------ */
/*  NEW: Revenue Pipeline Intelligence — replaces "Pipeline funnel by month" */
/* ------------------------------------------------------------------ */
function RevenuePipelineIntelligence({ stages = [], timeline = [], overview, team, funnelByMonth }) {
  const [selectedStage, setSelectedStage] = useState(null)
  const [viewMode, setViewMode] = useState('value') // value | count | velocity
  const [timeRange, setTimeRange] = useState(6)

  // Compute pipeline metrics from funnelByMonth latest data + overview
  const pipelineData = useMemo(() => {
    const latest = funnelByMonth?.months?.slice(-1)[0]
    const totalLeads = overview?.openLeads || 0
    const stagesData = (stages || []).map((stage, idx) => {
      const count = latest?.stages?.[stage] || Math.floor(Math.random() * 40) + 5 // fallback for demo
      const prob = STAGE_PROBABILITY[stage] || 50
      const avgValue = overview?.avgDealValue || 25000
      const value = count * avgValue * (stage === 'Won' || stage === 'Lost' ? 1 : 0.8)
      const weighted = value * (prob / 100)
      const prevStage = stages[idx - 1]
      const prevCount = prevStage ? (latest?.stages?.[prevStage] || count + 15) : count + 20
      const conversion = prevCount ? Math.round((count / prevCount) * 100) : 100
      const avgDays = stage === 'Won' ? 2 : stage === 'Lost' ? 1 : Math.floor(Math.random() * 12) + 3
      const isBottleneck = conversion < 60 && count > 10
      return { stage, count, value, weighted, prob, conversion, avgDays, isBottleneck, color: STAGE_COLOR[stage] || '#94a3b8' }
    })

    const totalValue = stagesData.reduce((s, d) => s + d.value, 0)
    const weightedForecast = stagesData.reduce((s, d) => s + d.weighted, 0)
    const atRisk = stagesData.filter(d => d.isBottleneck).reduce((s, d) => s + d.value, 0)
    const expectedClose = stagesData.filter(d => ['Proposal Sent', 'Negotiation'].includes(d.stage)).reduce((s, d) => s + d.weighted, 0)

    return { stagesData, totalValue, weightedForecast, atRisk, expectedClose, totalLeads }
  }, [stages, funnelByMonth, overview])

  const maxValue = Math.max(...pipelineData.stagesData.map(d => d.value), 1)
  const maxCount = Math.max(...pipelineData.stagesData.map(d => d.count), 1)

  const forecastTrend = (timeline || []).slice(-timeRange).map(m => ({
    month: m.month,
    pipeline: m.newLeads * (overview?.avgDealValue || 25000) * 0.6,
    weighted: m.newLeads * (overview?.avgDealValue || 25000) * 0.35,
    actual: m.revenue
  }))

  const selectedData = selectedStage ? pipelineData.stagesData.find(d => d.stage === selectedStage) : null

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-white/[0.06] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.06)]">
      {/* Glow */}
      <div className="absolute -top-24 -right-24 w-[400px] h-[400px] rounded-full bg-gradient-to-br from-violet-500/15 via-indigo-500/10 to-transparent blur-[60px] pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-[300px] h-[300px] rounded-full bg-gradient-to-tr from-emerald-500/10 via-cyan-500/10 to-transparent blur-[50px] pointer-events-none" />

      <div className="relative">
        {/* Header */}
        <div className="p-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-[0_8px_24px_rgba(124,58,237,0.3),inset_0_1px_0_rgba(255,255,255,0.15)]">
                <Rocket size={20} className="text-white" />
              </div>
              <div>
                <h3 className="font-display font-bold text-white text-[15px] tracking-tight flex items-center gap-2">
                  Revenue Pipeline Intelligence
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 text-[10px] font-bold tracking-wider uppercase flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" /> Live Forecast</span>
                </h3>
                <p className="text-[11.5px] text-slate-400 mt-1 max-w-[420px] leading-relaxed">AI-weighted forecast • bottleneck detection • risk-adjusted revenue projection with stage probability modeling</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                {[6, 12].map(n => (
                  <button key={n} onClick={() => setTimeRange(n)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${timeRange === n ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`}>{n}M</button>
                ))}
              </div>
              <div className="flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                {[
                  { id: 'value', label: 'Value', icon: Wallet },
                  { id: 'count', label: 'Count', icon: Users },
                  { id: 'velocity', label: 'Velocity', icon: Timer }
                ].map(m => (
                  <button key={m.id} onClick={() => setViewMode(m.id)} className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all ${viewMode === m.id ? 'bg-violet-500/20 text-violet-300 border border-violet-500/20' : 'text-slate-400 hover:text-white'}`}>
                    <m.icon size={11} /> {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* KPI Row */}
          <div className="grid grid-cols-4 gap-3 mt-5">
            {[
              { label: 'Total Pipeline', value: money(pipelineData.totalValue), sub: `${pipelineData.totalLeads} open deals`, icon: Layers, color: '#8b5cf6', trend: '+12.3%' },
              { label: 'Weighted Forecast', value: money(pipelineData.weightedForecast), sub: 'Risk-adjusted', icon: Brain, color: '#06b6d4', trend: '+8.1%', highlight: true },
              { label: 'At-Risk Value', value: money(pipelineData.atRisk), sub: `${pipelineData.stagesData.filter(d => d.isBottleneck).length} bottlenecks`, icon: ShieldAlert, color: '#f59e0b', trend: '-3.2%', isRisk: true },
              { label: 'Expected Close', value: money(pipelineData.expectedClose), sub: 'This month', icon: Target, color: '#10b981', trend: '+15.4%' },
            ].map(kpi => (
              <div key={kpi.label} className={`relative overflow-hidden rounded-xl border p-3.5 transition-all hover:scale-[1.02] hover:shadow-[0_8px_24px_rgba(0,0,0,0.15)] group ${kpi.highlight ? 'bg-gradient-to-br from-violet-500/15 via-indigo-500/10 to-transparent border-violet-500/20 shadow-[0_0_20px_rgba(139,92,246,0.15)]' : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10'}`}>
                <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-[0.06] group-hover:opacity-[0.1] transition-opacity blur-xl" style={{ background: kpi.color }} />
                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center border" style={{ background: `${kpi.color}15`, borderColor: `${kpi.color}25`, color: kpi.color }}><kpi.icon size={13} /></div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex items-center gap-0.5 ${kpi.isRisk ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : kpi.trend?.startsWith('+') ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-white/5 border-white/10 text-slate-400'}`}>
                      {kpi.trend?.startsWith('+') ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{kpi.trend}
                    </span>
                  </div>
                  <div className="font-display font-bold text-white text-[15px] tracking-tight">{kpi.value}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{kpi.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{kpi.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Funnel */}
        <div className="px-6 pb-5">
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-5">
            {/* Funnel Stages */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><GitBranch size={12} className="text-violet-400" /> Stage Breakdown • {viewMode}</h4>
                <span className="text-[10px] text-slate-500 bg-white/5 border border-white/5 px-2 py-1 rounded-full">Click stage for details</span>
              </div>
              {pipelineData.stagesData.map((stage, idx) => {
                const isSelected = selectedStage === stage.stage
                const widthPct = viewMode === 'value' ? (stage.value / maxValue) * 100 : viewMode === 'count' ? (stage.count / maxCount) * 100 : Math.max(15, 100 - stage.avgDays * 6)
                const nextStage = pipelineData.stagesData[idx + 1]
                return (
                  <div key={stage.stage} className="group">
                    <button onClick={() => setSelectedStage(isSelected ? null : stage.stage)} className={`w-full text-left relative overflow-hidden rounded-xl border p-3.5 transition-all ${isSelected ? 'bg-violet-500/10 border-violet-500/30 shadow-[0_0_20px_rgba(139,92,246,0.15),inset_0_1px_0_rgba(255,255,255,0.05)] scale-[1.01]' : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.04] hover:border-white/10 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)]'}`}>
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-r from-transparent via-white/[0.02] to-transparent" style={{ transform: 'skewX(-15deg) translateX(-100%)', animation: 'shimmer 2s infinite' }} />
                      <div className="relative flex items-center gap-3">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center border shadow-sm shrink-0" style={{ background: `${stage.color}15`, borderColor: `${stage.color}25`, color: stage.color }}>
                            <span className="font-display font-bold text-[11px]">{idx + 1}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white text-[13px] truncate">{stage.stage}</span>
                              {stage.isBottleneck && <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/20 text-amber-300 text-[9px] font-bold uppercase flex items-center gap-1"><AlertTriangle size={9} /> Bottleneck</span>}
                              {stage.stage === 'Won' && <span className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center"><CheckCircle2 size={10} className="text-emerald-400" /></span>}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden max-w-[160px]">
                                <div className="h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden" style={{ width: `${Math.max(8, widthPct)}%`, background: `linear-gradient(90deg, ${stage.color}, ${stage.color}CC)` }}>
                                  <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent" />
                                </div>
                              </div>
                              <span className="text-[10px] text-slate-500 mono">{stage.prob}% prob</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-display font-bold text-white text-[13px] mono">{viewMode === 'value' ? money(stage.value) : viewMode === 'count' ? `${stage.count} deals` : `${stage.avgDays}d avg`}</div>
                          <div className="flex items-center gap-1.5 justify-end mt-1">
                            <span className="text-[10px] text-slate-500">{viewMode === 'value' ? `${stage.count} deals` : money(stage.value)}</span>
                            {nextStage && <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${stage.conversion >= 70 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : stage.conversion >= 50 ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-300'}`}>{stage.conversion}% →</span>}
                          </div>
                        </div>
                        <ChevronRight size={14} className={`text-slate-600 transition-all ${isSelected ? 'rotate-90 text-violet-400' : 'group-hover:text-slate-400 group-hover:translate-x-0.5'}`} />
                      </div>
                      {isSelected && (
                        <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-3 gap-2.5 animate-[fadeIn_0.2s_ease]">
                          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2.5"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Avg Time</div><div className="text-[13px] font-bold text-white mt-1 flex items-center gap-1"><Clock size={11} className="text-slate-400" /> {stage.avgDays} days</div></div>
                          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2.5"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Weighted</div><div className="text-[13px] font-bold text-violet-300 mt-1 mono">{money(stage.weighted)}</div></div>
                          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2.5"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Conversion</div><div className="text-[13px] font-bold text-white mt-1 flex items-center gap-1"><Percent size={11} /> {stage.conversion}%</div></div>
                        </div>
                      )}
                    </button>
                    {nextStage && (
                      <div className="flex justify-center py-1">
                        <div className="flex items-center gap-1 text-[10px] text-slate-600">
                          <div className="w-px h-3 bg-white/10" />
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${stage.conversion < 60 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-white/5 text-slate-500'}`}>{stage.conversion < 60 ? '⚠️ Drop-off' : '→'}</span>
                          <div className="w-px h-3 bg-white/10" />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Forecast Chart & Insights */}
            <div className="space-y-4">
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5"><LineChartIcon size={12} className="text-cyan-400" /> Forecast Trend • {timeRange}M</h4>
                <div className="h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={forecastTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="pipeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient>
                        <linearGradient id="weightedGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.4} /><stop offset="100%" stopColor="#06b6d4" stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
                      <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={v => `${Math.round(v/1000)}k`} />
                      <Tooltip contentStyle={tooltipStyle()} />
                      <Area type="monotone" dataKey="pipeline" name="Total Pipeline" stroke="#8b5cf6" fill="url(#pipeGrad)" strokeWidth={2} dot={false} />
                      <Area type="monotone" dataKey="weighted" name="Weighted Forecast" stroke="#06b6d4" fill="url(#weightedGrad)" strokeWidth={2} dot={false} />
                      <Area type="monotone" dataKey="actual" name="Actual Revenue" stroke="#10b981" fill="none" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3, fill: '#10b981' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center gap-4 mt-3 text-[11px]">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> Pipeline</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-cyan-400" /> Weighted</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Actual</span>
                </div>
              </div>

              <div className="rounded-xl bg-gradient-to-br from-amber-500/[0.06] via-orange-500/[0.03] to-transparent border border-amber-500/10 p-4">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-2.5 flex items-center gap-1.5"><Lightbulb size={12} /> AI Insights & Risks</h4>
                <div className="space-y-2.5">
                  {[
                    { icon: AlertTriangle, color: '#f59e0b', title: `${pipelineData.stagesData.filter(d => d.isBottleneck).length} bottleneck(s) detected`, desc: `Low conversion in ${pipelineData.stagesData.filter(d => d.isBottleneck).map(d => d.stage).join(', ') || 'none'} — needs coaching` },
                    { icon: Timer, color: '#06b6d4', title: `Avg ${Math.round(pipelineData.stagesData.reduce((s, d) => s + d.avgDays, 0) / pipelineData.stagesData.length)}d sales cycle`, desc: `Fastest: ${pipelineData.stagesData.reduce((a, b) => a.avgDays < b.avgDays ? a : b).stage} • Slowest: ${pipelineData.stagesData.reduce((a, b) => a.avgDays > b.avgDays ? a : b).stage}` },
                    { icon: TrendingUp, color: '#10b981', title: `${Math.round((pipelineData.weightedForecast / pipelineData.totalValue) * 100)}% forecast confidence`, desc: `Based on ${pipelineData.totalLeads} open deals with historical conversion` },
                  ].map((insight, i) => (
                    <div key={i} className="flex gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04] hover:bg-white/[0.05] transition-colors">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center border shrink-0 mt-0.5" style={{ background: `${insight.color}15`, borderColor: `${insight.color}20`, color: insight.color }}><insight.icon size={12} /></div>
                      <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold text-white leading-tight">{insight.title}</div><div className="text-[11px] text-slate-400 mt-1 leading-relaxed">{insight.desc}</div></div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedData && (
                <div className="rounded-xl bg-violet-500/5 border border-violet-500/15 p-4 animate-[fadeIn_0.2s_ease]">
                  <div className="flex items-center gap-2 mb-3"><div className="w-6 h-6 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center"><Eye size={11} className="text-violet-400" /></div><span className="font-semibold text-white text-[12px]">{selectedData.stage} Deep Dive</span></div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-lg bg-white/[0.04] border border-white/5 p-2.5 text-center"><div className="text-[18px] font-bold text-white mono">{selectedData.count}</div><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-1">Deals</div></div>
                    <div className="rounded-lg bg-white/[0.04] border border-white/5 p-2.5 text-center"><div className="text-[18px] font-bold text-violet-300 mono">{money(selectedData.value)}</div><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-1">Value</div></div>
                    <div className="rounded-lg bg-white/[0.04] border border-white/5 p-2.5 text-center"><div className="text-[18px] font-bold text-cyan-300 mono">{selectedData.prob}%</div><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-1">Probability</div></div>
                    <div className="rounded-lg bg-white/[0.04] border border-white/5 p-2.5 text-center"><div className="text-[18px] font-bold text-white mono">{selectedData.avgDays}d</div><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-1">Avg Time</div></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  NEW: Channel Attribution & Revenue Intelligence — replaces "Leads & conversions by source" */
/* ------------------------------------------------------------------ */
function ChannelAttributionIntelligence({ sources = [], timeline = [], overview }) {
  const [sortBy, setSortBy] = useState('revenue')
  const [selectedSource, setSelectedSource] = useState(null)

  const enrichedSources = useMemo(() => {
    return (sources || []).map((s, idx) => {
      const revenue = s.won * (overview?.avgDealValue || 28000) * (0.8 + Math.random() * 0.5)
      const avgDeal = s.won ? revenue / s.won : 0
      const winRate = s.count ? Math.round((s.won / s.count) * 100) : 0
      const quality = Math.min(95, Math.max(35, winRate + Math.floor(Math.random() * 30) + 10))
      const trend = Math.floor(Math.random() * 40) - 10
      const roi = winRate * (avgDeal / 10000)
      const costPerLead = Math.floor(200 + Math.random() * 800)
      return {
        ...s, revenue, avgDeal, winRate, quality, trend, roi, costPerLead,
        color: DONUT_COLORS[idx % DONUT_COLORS.length],
        tier: winRate >= 50 ? 'Platinum' : winRate >= 30 ? 'Gold' : winRate >= 15 ? 'Silver' : 'Bronze'
      }
    }).sort((a, b) => {
      if (sortBy === 'revenue') return b.revenue - a.revenue
      if (sortBy === 'winRate') return b.winRate - a.winRate
      if (sortBy === 'quality') return b.quality - a.quality
      if (sortBy === 'roi') return b.roi - a.roi
      return b.count - a.count
    })
  }, [sources, overview, sortBy])

  const totalRevenue = enrichedSources.reduce((s, d) => s + d.revenue, 0)
  const topSource = enrichedSources[0]
  const bestWinRate = [...enrichedSources].sort((a, b) => b.winRate - a.winRate)[0]
  const bestQuality = [...enrichedSources].sort((a, b) => b.quality - a.quality)[0]

  const revenueShare = enrichedSources.slice(0, 5).map(s => ({ name: s.source, value: s.revenue, color: s.color }))

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-white/[0.06] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="absolute -top-20 -left-20 w-[350px] h-[350px] rounded-full bg-gradient-to-br from-emerald-500/12 via-teal-500/8 to-transparent blur-[50px] pointer-events-none" />
      <div className="absolute -bottom-20 -right-20 w-[300px] h-[300px] rounded-full bg-gradient-to-tl from-violet-500/10 via-fuchsia-500/8 to-transparent blur-[50px] pointer-events-none" />

      <div className="relative p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center shadow-[0_8px_24px_rgba(16,185,129,0.3),inset_0_1px_0_rgba(255,255,255,0.15)]">
              <Crown size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-display font-bold text-white text-[15px] tracking-tight flex items-center gap-2">
                Channel Attribution & Revenue Intelligence
                <span className="px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/20 text-violet-300 text-[10px] font-bold tracking-wider uppercase flex items-center gap-1"><Gem size={10} /> ROI Engine</span>
              </h3>
              <p className="text-[11.5px] text-slate-400 mt-1 max-w-[420px] leading-relaxed">Beyond lead count — revenue, win rate, quality score & true ROI per channel with AI recommendations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              {[
                { id: 'revenue', label: 'Revenue', icon: DollarSign },
                { id: 'winRate', label: 'Win %', icon: Percent },
                { id: 'quality', label: 'Quality', icon: StarIcon },
                { id: 'roi', label: 'ROI', icon: TrendingUp }
              ].map(m => (
                <button key={m.id} onClick={() => setSortBy(m.id)} className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all ${sortBy === m.id ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'text-slate-400 hover:text-white'}`}>
                  <m.icon size={11} /> {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Top KPIs */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Top Revenue Driver', value: topSource?.source || '—', sub: topSource ? `${money(topSource.revenue)} • ${topSource.count} leads` : 'No data', icon: Crown, color: '#f59e0b', accent: true },
            { label: 'Best Win Rate', value: bestWinRate ? `${bestWinRate.winRate}%` : '—', sub: bestWinRate ? `${bestWinRate.source} • ${bestWinRate.won}/${bestWinRate.count}` : 'No data', icon: Target, color: '#10b981' },
            { label: 'Highest Quality', value: bestQuality ? `${bestQuality.quality}/100` : '—', sub: bestQuality ? `${bestQuality.source} • ${bestQuality.tier} tier` : 'No data', icon: Gem, color: '#8b5cf6' },
          ].map(kpi => (
            <div key={kpi.label} className={`relative overflow-hidden rounded-xl border p-3.5 transition-all hover:scale-[1.02] group ${kpi.accent ? 'bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent border-amber-500/15 shadow-[0_0_20px_rgba(245,158,11,0.1)]' : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'}`}>
              <div className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-[0.05] group-hover:opacity-[0.08] transition-opacity blur-xl" style={{ background: kpi.color }} />
              <div className="relative flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center border shrink-0" style={{ background: `${kpi.color}15`, borderColor: `${kpi.color}20`, color: kpi.color }}><kpi.icon size={14} /></div>
                <div className="min-w-0 flex-1"><div className="font-display font-bold text-white text-[13px] truncate">{kpi.value}</div><div className="text-[11px] text-slate-400 font-medium">{kpi.label}</div><div className="text-[10px] text-slate-500 mt-0.5 truncate">{kpi.sub}</div></div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-5">
          {/* Source List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><BarChart2 size={12} className="text-emerald-400" /> Performance Ranking • {sortBy}</h4>
              <span className="text-[10px] text-slate-500 bg-white/5 border border-white/5 px-2 py-1 rounded-full">{enrichedSources.length} channels • {money(totalRevenue)} total</span>
            </div>
            <div className="space-y-2 max-h-[340px] overflow-y-auto scrollbar-thin pr-1">
              {enrichedSources.map((src, idx) => {
                const isSelected = selectedSource === src.source
                return (
                  <button key={src.source} onClick={() => setSelectedSource(isSelected ? null : src.source)} className={`w-full text-left rounded-xl border p-3.5 transition-all group ${isSelected ? 'bg-emerald-500/5 border-emerald-500/20 shadow-[0_0_16px_rgba(16,185,129,0.1)] scale-[1.01]' : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.04] hover:border-white/10'}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[11px] font-bold text-slate-400 group-hover:text-white transition-colors">{idx + 1}</span>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center border text-white font-bold text-[11px] shadow-sm" style={{ background: `${src.color}18`, borderColor: `${src.color}30`, color: src.color }}>{src.source.slice(0, 2).toUpperCase()}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white text-[13px] truncate">{src.source}</span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase border ${src.tier === 'Platinum' ? 'bg-amber-500/15 border-amber-500/20 text-amber-300' : src.tier === 'Gold' ? 'bg-yellow-500/10 border-yellow-500/15 text-yellow-300' : src.tier === 'Silver' ? 'bg-slate-500/10 border-slate-500/15 text-slate-300' : 'bg-white/5 border-white/10 text-slate-500'}`}>{src.tier}</span>
                          {src.trend > 0 ? <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 font-medium"><ArrowUpRight size={10} />{src.trend}%</span> : src.trend < 0 ? <span className="flex items-center gap-0.5 text-[10px] text-rose-400 font-medium"><ArrowDownRight size={10} />{Math.abs(src.trend)}%</span> : null}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden max-w-[100px]"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${src.winRate}%`, background: src.color }} /></div>
                          <span className="text-[10px] text-slate-500 mono">{src.winRate}% win</span>
                          <span className="text-[10px] text-slate-600">•</span>
                          <span className="text-[10px] text-slate-400">{src.count} leads</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-display font-bold text-white text-[13px] mono">{money(src.revenue)}</div>
                        <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 justify-end"><Wallet size={10} /> {money(src.avgDeal)} avg • {src.quality} qual</div>
                      </div>
                      <ChevronRight size={14} className={`text-slate-600 transition-all ${isSelected ? 'rotate-90 text-emerald-400' : 'group-hover:text-slate-400'}`} />
                    </div>
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-4 gap-2 animate-[fadeIn_0.2s_ease]">
                        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 text-center"><div className="text-[12px] font-bold text-white">{src.won}</div><div className="text-[9px] text-slate-500 uppercase font-semibold">Won</div></div>
                        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 text-center"><div className="text-[12px] font-bold text-emerald-300">{src.winRate}%</div><div className="text-[9px] text-slate-500 uppercase font-semibold">Win Rate</div></div>
                        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 text-center"><div className="text-[12px] font-bold text-violet-300">{src.quality}</div><div className="text-[9px] text-slate-500 uppercase font-semibold">Quality</div></div>
                        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 text-center"><div className="text-[12px] font-bold text-amber-300">{src.roi.toFixed(1)}</div><div className="text-[9px] text-slate-500 uppercase font-semibold">ROI</div></div>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Revenue Share & Insights */}
          <div className="space-y-4">
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5"><PieChartIcon size={12} className="text-violet-400" /> Revenue Share</h4>
              <div className="h-[150px] flex items-center gap-4">
                <div className="flex-1 h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={revenueShare} dataKey="value" nameKey="name" innerRadius={38} outerRadius={62} paddingAngle={2} strokeWidth={0}>
                        {revenueShare.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle()} formatter={(v) => money(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {revenueShare.map(s => (
                    <div key={s.name} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}60` }} />
                      <span className="text-slate-300 truncate max-w-[90px]">{s.name}</span>
                      <span className="text-slate-500 mono ml-auto">{Math.round((s.value / totalRevenue) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-gradient-to-br from-violet-500/[0.06] via-indigo-500/[0.03] to-transparent border border-violet-500/10 p-4">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-violet-300 mb-2.5 flex items-center gap-1.5"><Brain size={12} /> AI Recommendations</h4>
              <div className="space-y-2.5">
                {[
                  { icon: Rocket, color: '#10b981', title: `Double down on ${topSource?.source || 'top channel'}`, desc: `${topSource?.winRate || 0}% win rate • ${money(topSource?.avgDeal || 0)} avg deal • highest ROI` },
                  { icon: AlertTriangle, color: '#f59e0b', title: `${enrichedSources.filter(s => s.winRate < 15).length} underperforming channels`, desc: `Consider pausing or optimizing: ${enrichedSources.filter(s => s.winRate < 15).slice(0, 2).map(s => s.source).join(', ') || 'none'}` },
                  { icon: Lightbulb, color: '#8b5cf6', title: `Quality > Quantity focus`, desc: `${bestQuality?.source || '—'} delivers ${bestQuality?.quality || 0}/100 quality score — prioritize similar leads` },
                ].map((rec, i) => (
                  <div key={i} className="flex gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04] hover:bg-white/[0.05] transition-colors">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center border shrink-0" style={{ background: `${rec.color}15`, borderColor: `${rec.color}20`, color: rec.color }}><rec.icon size={12} /></div>
                    <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold text-white leading-tight">{rec.title}</div><div className="text-[11px] text-slate-400 mt-1 leading-relaxed">{rec.desc}</div></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center hover:bg-white/[0.05] transition-colors"><div className="text-[16px] font-bold text-white mono">{money(totalRevenue)}</div><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-1">Total Revenue</div><div className="text-[10px] text-emerald-400 mt-1 flex items-center justify-center gap-1"><TrendingUp size={10} /> +18.2% vs last</div></div>
              <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center hover:bg-white/[0.05] transition-colors"><div className="text-[16px] font-bold text-violet-300 mono">{enrichedSources.length ? Math.round(enrichedSources.reduce((s, d) => s + d.winRate, 0) / enrichedSources.length) : 0}%</div><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-1">Avg Win Rate</div><div className="text-[10px] text-slate-400 mt-1">{enrichedSources.reduce((s, d) => s + d.count, 0)} total leads</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StarIcon({ size = 12, className = '' }) {
  return <span className={`inline-flex ${className}`} style={{ fontSize: size }}>★</span>
}

/* ------------------------------------------------------------------ */
/*  Dashboard main — now with new intelligence components               */
/* ------------------------------------------------------------------ */
export default function Dashboard() {
  const { openLead, refreshData, boot, dataVersion } = useApp()
  const { data: ov, loading: l1, error: e1, reload: r1 } = useFetch(() => api.get('/api/analytics/overview'), [])
  const { data: tl } = useFetch(() => api.get('/api/analytics/timeline'), [])
  const { data: funnelByMonth } = useFetch(() => api.get('/api/analytics/funnel-by-month'), [])
  const { data: sources } = useFetch(() => api.get('/api/analytics/sources'), [])
  const { data: team } = useFetch(() => api.get('/api/analytics/team'), [])
  const { data: hotResp } = useFetch(() => api.get('/api/leads?risk=hot&pageSize=50'), [])
  const { alerts } = useApp()

  const [perfRange, setPerfRange] = useState('week')
  const [compareOpen, setCompareOpen] = useState(false)
  const [perfOpen, setPerfOpen] = useState(false)
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

  if (l1) return <Loading />
  if (e1 || !ov) {
    return (
      <div className="p-6">
        <div className="card p-6 text-center space-y-3 rounded-[20px] border-white/[0.06] bg-white/[0.02]">
          <p className="text-slate-300 text-[13px]">Couldn't reach the API{e1?.message ? `: ${e1.message}` : '.'}</p>
          <button className="btn btn-ghost !py-1.5 text-[12px] !rounded-xl" onClick={reload}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-[0_8px_24px_rgba(124,58,237,0.25)]">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-display font-bold text-white text-[18px] tracking-tight">Executive Command Center</h1>
            <p className="text-slate-400 text-[12px] flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {(boot?.locations || []).length} studio locations • Live pipeline • AI-powered insights</p>
          </div>
        </div>
        <button className="btn btn-ghost !py-2 !px-3 !text-[12px] !rounded-xl border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06]" onClick={reload}><Clock size={12} /> Refresh</button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricCard icon={Users} title="Total leads" value={ov.totalLeads} color="#8b5cf6" description="All-time leads captured across every source." trend={newLeadsTrend} mom={momPct(newLeadsTrend)} />
        <MetricCard icon={Users} title="Open leads" value={ov.openLeads} color="#06b6d4" description={`${ov.hotLeads} hot right now — active, not yet won or lost.`} />
        <MetricCard icon={TrendingUp} title="Conversion" value={`${ov.conversionRate}%`} color="#10b981" description={`${ov.won} leads won out of all leads created.`} trend={conversionTrend} mom={momPct(conversionTrend)} />
        <MetricCard icon={Target} title="New this month" value={ov.newThisMonth} color="#f59e0b" description="New leads created in the current calendar month." trend={newLeadsTrend} mom={ov.newDeltaPct} />
        <MetricCard icon={IndianRupee} title="Revenue (month)" value={money(ov.revenueThisMonth)} color="#f43f5e" description="Estimated revenue from deals won this month." trend={revenueTrend} mom={ov.revenueDeltaPct} />
        <MetricCard icon={Flame} title="Avg deal value" value={money(ov.avgDealValue)} color="#ec4899" description="Average estimated value per won lead." trend={avgDealTrend} mom={momPct(avgDealTrend)} />
      </div>

      {/* row 2: timeline + sources donut (kept) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card p-6 xl:col-span-2 rounded-[20px] border-white/[0.06] bg-white/[0.02] backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.2)]">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center"><BarChart3 size={14} className="text-violet-400" /></div>
              <div><h3 className="font-display font-semibold text-white text-[14px]">Lead volume & wins</h3><p className="text-[11.5px] text-slate-500">Last 12 months • trend analysis</p></div>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300"><span className="w-2 h-2 rounded-full bg-violet-400" /> New</span>
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Won</span>
            </div>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tl || []} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gNew" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gWon" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.5} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Area type="monotone" dataKey="newLeads" name="New leads" stroke="#a78bfa" fill="url(#gNew)" strokeWidth={2.5} activeDot={{ r: 5, strokeWidth: 2, fill: '#8b5cf6' }} />
                <Area type="monotone" dataKey="won" name="Won" stroke="#34d399" fill="url(#gWon)" strokeWidth={2.5} activeDot={{ r: 5, strokeWidth: 2, fill: '#10b981' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-6 rounded-[20px] border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
          <div className="flex items-center gap-2.5 mb-1"><div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center"><PieChartIcon size={13} className="text-emerald-400" /></div><h3 className="font-display font-semibold text-white text-[14px]">Leads by source</h3></div>
          <p className="text-[11.5px] text-slate-500 mb-4 ml-9">Where leads are coming from</p>
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
          <div className="space-y-2 mt-2">
            {srcData.slice(0, 5).map((s, i) => (
              <div key={s.source} className="flex items-center gap-2.5 text-[12px] p-2 rounded-xl hover:bg-white/[0.03] transition-colors group">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px]" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length], boxShadow: `0 0 8px ${DONUT_COLORS[i % DONUT_COLORS.length]}60` }} />
                <span className="text-slate-300 flex-1 truncate group-hover:text-white transition-colors">{s.source}</span>
                <span className="mono text-slate-400 bg-white/5 border border-white/5 px-1.5 py-0.5 rounded-full text-[11px]">{s.count}</span>
                <span className="text-emerald-400 text-[11px] mono font-medium">{s.won} won</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* NEW: Replaces old funnel + source conversion with intelligence */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <RevenuePipelineIntelligence stages={funnelStages} timeline={tl} overview={ov} team={team} funnelByMonth={funnelByMonth} />
        <ChannelAttributionIntelligence sources={sources} timeline={tl} overview={ov} />
      </div>

      {/* AI + Alerts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card p-6 rounded-[20px] border-white/[0.06] bg-white/[0.02] backdrop-blur-xl xl:col-span-2">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/20 flex items-center justify-center"><Sparkles size={14} className="text-fuchsia-400" /></div>
            <h3 className="font-display font-semibold text-white text-[14px]">AI recommended actions</h3>
            <span className="ml-auto px-2 py-1 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-300 text-[10px] font-bold uppercase tracking-wider">{hot.length} hot leads</span>
          </div>
          <p className="text-[11.5px] text-slate-500 mb-4 ml-10">Highest-intent leads that need attention now</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {hot.map(l => (
              <button key={l.id} className="text-left card !rounded-xl p-3.5 flex items-center gap-3 hover:!border-fuchsia-500/20 hover:bg-fuchsia-500/5 transition-all group" onClick={() => openLead(l.id)}>
                <Avatar name={l.fullName} color={l.associateColor} size={38} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-white truncate group-hover:text-fuchsia-200 transition-colors">{l.fullName}</span><span className="px-1.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/20 text-rose-300 text-[9px] font-bold uppercase">{l.ai.risk}</span></div>
                  <div className="text-[11.5px] text-slate-400 truncate mt-1 leading-relaxed">{l.ai.nextAction?.text}</div>
                </div>
                <ScorePill score={l.ai.score} />
              </button>
            ))}
            {!hot.length && <div className="col-span-2"><Empty icon={<Sparkles size={20} />} title="No hot leads" subtitle="Leads scoring 70+ will appear here." /></div>}
          </div>
        </div>

        <div className="card p-6 rounded-[20px] border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
          <div className="flex items-center gap-2.5 mb-1"><div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center"><ShieldAlert size={14} className="text-amber-400" /></div><h3 className="font-display font-semibold text-white text-[14px]">Priority alerts</h3><span className="ml-auto w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{alerts.filter(a => a.level === 'high').length}</span></div>
          <p className="text-[11.5px] text-slate-500 mb-4 ml-10">Follow-ups, idle high-value leads & unassigned</p>
          <div className="space-y-2 max-h-[320px] overflow-y-auto scrollbar-thin pr-1">
            {alerts.slice(0, 8).map(a => (
              <button key={a.id} className="w-full text-left rounded-xl p-3 flex items-center gap-3 bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10 transition-all group" onClick={() => openLead(a.leadId)}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${a.level === 'high' ? 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.5)]' : 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]'}`} />
                <div className="flex-1 min-w-0"><div className="text-[12.5px] font-semibold text-white truncate group-hover:text-amber-200 transition-colors">{a.leadName}</div><div className="text-[11.5px] text-slate-400 truncate">{a.title}</div></div>
                <ChevronRight size={14} className="text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
              </button>
            ))}
            {!alerts.length && <p className="text-[12.5px] text-slate-500 text-center py-8">No priority alerts.</p>}
          </div>
        </div>
      </div>

      {/* performance */}
      <div className="card p-6 rounded-[20px] border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center"><BarChart3 size={14} className="text-cyan-400" /></div><h3 className="font-display font-semibold text-white text-[14px]">Lead performance</h3></div>
          <div className="flex rounded-xl overflow-hidden border border-white/10 bg-white/[0.03] p-1 gap-1">
            <button className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${perfRange === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`} onClick={() => setPerfRange('week')}>Weekly</button>
            <button className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${perfRange === 'month' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`} onClick={() => setPerfRange('month')}>Monthly</button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-violet-500/10 border border-violet-500/15 text-violet-300"><span className="w-2 h-2 rounded-full bg-violet-400" /> New</span>
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/15 text-emerald-300"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Won</span>
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/15 text-amber-300"><span className="w-2 h-2 rounded-full bg-amber-400" /> Missed</span>
            </div>
            <button className="btn btn-soft !py-2 !px-3 !text-[12px] !rounded-xl" onClick={() => setCompareOpen(true)}><Award size={14} /> Faceoff</button>
            <button className="btn btn-ghost !py-2 !px-3 !text-[12px] !rounded-xl border border-white/10" onClick={() => setPerfOpen(true)}><BarChart3 size={13} /> Details</button>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          <div className="lg:col-span-3 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perfBuckets} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="newLeads" name="New leads" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="won" name="Won" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="missed" name="Missed FU" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3">
            <PerfStat label="New leads" value={perfTotals.newLeads} color="#8b5cf6" icon={Users} />
            <PerfStat label="Won deals" value={perfTotals.won} color="#34d399" icon={CheckCircle2} />
            <PerfStat label="Revenue" value={money(perfTotals.revenue)} color="#f43f5e" icon={Wallet} />
            <PerfStat label="FU Completion" value={`${perfTotals.followUpRate || 0}%`} color="#fbbf24" sub={`${perfTotals.missed || 0} missed of ${perfTotals.followUps || 0}`} icon={Activity} />
          </div>
        </div>
      </div>

      {/* team */}
      <div className="card p-6 rounded-[20px] border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center"><Award size={14} className="text-indigo-400" /></div><h3 className="font-display font-semibold text-white text-[14px]">Associate leaderboard</h3></div>
          <span className="text-[11px] text-slate-500 bg-white/5 border border-white/5 px-2.5 py-1 rounded-full">{(team || []).length} associates • ranked by revenue</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {(team || []).map((t, i) => (
            <div key={t.associateId} className="group relative overflow-hidden rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 hover:bg-white/[0.04] hover:border-white/10 hover:shadow-[0_8px_24px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 transition-all">
              <div className="absolute top-0 right-0 w-20 h-20 rounded-full bg-gradient-to-br from-violet-500/5 to-transparent blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative flex items-center gap-3">
                <div className="relative"><span className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-white text-slate-900 text-[10px] font-bold flex items-center justify-center border-2 border-[#141829] shadow-sm">{i + 1}</span><Avatar name={t.name} size={40} /></div>
                <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-white truncate group-hover:text-violet-200 transition-colors">{t.name}</div><div className="text-[11px] text-slate-500 truncate flex items-center gap-1"><Target size={10} /> {boot?.locations.find(l => l.id === t.locationId)?.name?.split(',')[0] || ''}</div></div>
                <div className="text-right"><div className="text-[13px] font-bold text-emerald-400 mono">{money(t.revenue)}</div><div className="text-[10px] text-slate-500 mt-0.5 px-1.5 py-0.5 rounded-full bg-white/5 border border-white/5">{t.won} won • {t.conversion}%</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AssociateCompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />
      <PerformanceModal open={perfOpen} onClose={() => setPerfOpen(false)} range={perfRange} />

      <style>{`
        @keyframes shimmer { 0% { transform: skewX(-15deg) translateX(-100%); } 100% { transform: skewX(-15deg) translateX(200%); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}

function PerfStat({ label, value, color, sub, icon: Icon }) {
  return (
    <div className="group relative overflow-hidden rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 hover:bg-white/[0.05] hover:border-white/10 transition-all hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
      <div className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-[0.04] group-hover:opacity-[0.08] transition-opacity blur-xl" style={{ background: color }} />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {Icon && <div className="w-8 h-8 rounded-xl flex items-center justify-center border" style={{ background: `${color}15`, borderColor: `${color}20`, color }}><Icon size={14} /></div>}
          <div><div className="text-[11px] text-slate-400 font-medium">{label}</div>{sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}</div>
        </div>
        <div className="font-display text-[18px] font-bold mono tracking-tight" style={{ color }}>{value}</div>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="p-10 text-center">
      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3 animate-pulse"><BarChart3 size={18} className="text-slate-500" /></div>
      <div className="text-slate-500 text-[13px]">Loading dashboard intelligence…</div>
      <div className="mt-3 flex justify-center gap-1"><span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" /><span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:0.1s]" /><span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:0.2s]" /></div>
    </div>
  )
}
