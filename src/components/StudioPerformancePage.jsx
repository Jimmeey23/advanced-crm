import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Building2, ChevronLeft, ChevronRight, Trophy, IndianRupee,
  Users, CalendarCheck2, Crown, TrendingDown,
  ArrowUp, ArrowDown, Filter, ListFilter, Tags, Download, CalendarRange,
  GitCompareArrows, X, Radio, Clock3, AlertTriangle, PieChart as PieChartIcon,
  Target, Layers, MapPin, FileDown, Check, ChevronDown as ChevronDownIcon
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, PieChart, Pie
} from 'recharts'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Spinner } from '../ui.jsx'
import { money, downloadText } from '../lib.js'
import MetricCard from './MetricCard.jsx'

const DONUT_COLORS = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6']
const CHANNEL_COLORS = { call: '#06b6d4', whatsapp: '#10b981', email: '#8b5cf6', sms: '#f59e0b' }

const tooltipStyle = () => ({
  background: 'var(--tt-bg)', border: '1px solid var(--tt-border)', borderRadius: 12,
  fontSize: 12, color: 'var(--tt-color)', boxShadow: '0 10px 30px rgba(0,0,0,.5)'
})
const AXIS = { fill: 'var(--axis)', fontSize: 10.5 }
const FUNNEL_COLORS = { new: '#8b5cf6', trial: '#06b6d4', won: '#10b981', lost: '#f43f5e' }

function historyTrend(history, dataKey) {
  return (history || []).filter(h => h[dataKey] !== undefined).map(h => ({ label: h.periodLabel, value: h[dataKey] }))
}

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
  const [funnelLocationId, setFunnelLocationId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [compareMode, setCompareMode] = useState('prev')
  const [selectedLocationIds, setSelectedLocationIds] = useState([])
  const [studioPickerOpen, setStudioPickerOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const reportRef = useRef(null)

  const customRange = Boolean(dateFrom && dateTo)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ range, compare: compareMode })
    if (customRange) {
      params.set('from', dateFrom)
      params.set('to', dateTo)
    } else {
      params.set('offset', offset)
      params.set('history', 12)
    }
    if (selectedLocationIds.length) params.set('locations', selectedLocationIds.join(','))
    api.get(`/api/analytics/performance/by-location?${params.toString()}`)
      .then(d => {
        setData(d)
        // First load (or a stale selection referring to studios no longer
        // returned): adopt the server's default so the picker and the report
        // agree on what's actually shown, without fighting the user's choice
        // on every subsequent fetch.
        if (!selectedLocationIds.length && d?.selectedLocationIds?.length) {
          setSelectedLocationIds(d.selectedLocationIds)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, offset, dataVersion, dateFrom, dateTo, compareMode, selectedLocationIds.join(',')])

  const rows = data?.rows || []
  const perLocation = data?.perLocation || []
  const primary = perLocation[0] || null
  const comparedLocations = perLocation.slice(1)
  const selectedRows = selectedLocationIds.length ? rows.filter(r => selectedLocationIds.includes(r.locationId)) : rows

  const toggleCompareLocation = (locationId) => {
    setSelectedLocationIds(ids => {
      if (!ids.length) return ids
      const [primaryId, ...rest] = ids
      if (locationId === primaryId) return ids
      return rest.includes(locationId) ? [primaryId, ...rest.filter(id => id !== locationId)] : [primaryId, ...rest, locationId]
    })
  }
  const setPrimaryLocation = (locationId) => {
    setSelectedLocationIds(ids => [locationId, ...ids.filter(id => id !== locationId)])
  }

  const exportPdf = async () => {
    if (!reportRef.current || exporting) return
    setExporting(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#0b0f1a', scale: 2, useCORS: true,
        windowWidth: reportRef.current.scrollWidth
      })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgW = pageW
      const imgH = (canvas.height * imgW) / canvas.width
      const pxPerPage = (canvas.width * pageH) / imgW
      let renderedPx = 0
      let page = 0
      while (renderedPx < canvas.height) {
        const sliceH = Math.min(pxPerPage, canvas.height - renderedPx)
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = canvas.width
        sliceCanvas.height = sliceH
        sliceCanvas.getContext('2d').drawImage(canvas, 0, renderedPx, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
        const sliceImg = sliceCanvas.toDataURL('image/jpeg', 0.92)
        if (page > 0) pdf.addPage()
        pdf.addImage(sliceImg, 'JPEG', 0, 0, imgW, (sliceH * imgW) / canvas.width)
        renderedPx += sliceH
        page++
      }
      void imgH
      pdf.save(`studio-performance-${range}-${data?.start || ''}-to-${data?.end || ''}.pdf`)
    } finally {
      setExporting(false)
    }
  }
  const totals = primary?.summary || { newLeads: 0, trials: 0, won: 0, revenue: 0, followUps: 0, missed: 0 }
  const followUpRate = totals.followUps ? Math.round(((totals.followUps - totals.missed) / totals.followUps) * 100) : 0
  const prev = primary?.previous || null
  const history = primary?.history || []

  const funnelSource = funnelLocationId
    ? data?.funnel?.byLocation?.find(f => f.locationId === funnelLocationId)
    : primary?.funnel || data?.funnel
  const funnelData = funnelSource ? [
    { stage: 'New', key: 'new', count: funnelSource.new },
    { stage: 'Trial', key: 'trial', count: funnelSource.trial },
    { stage: 'Won', key: 'won', count: funnelSource.won },
    { stage: 'Lost', key: 'lost', count: funnelSource.lost }
  ] : []
  const [funnelStage, setFunnelStage] = useState('all')
  const visibleFunnel = funnelStage === 'all' ? funnelData : funnelData.filter(d => d.key === funnelStage)
  const rankedFunnel = [...visibleFunnel].sort((a, b) => b.count - a.count)

  const exportCsv = () => {
    if (!data) return
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rowsOf = (arr) => arr.map(r => r.map(esc).join(',')).join('\n')
    const blocks = []

    blocks.push(`KPI summary — ${data.label}\n${rowsOf([
      ['Metric', 'Value', 'Previous'],
      ['New leads', totals.newLeads, prev?.newLeads ?? ''],
      ['Trials', totals.trials, prev?.trials ?? ''],
      ['Won deals', totals.won, prev?.won ?? ''],
      ['Revenue', totals.revenue, prev?.revenue ?? ''],
      ['Follow-up completion %', followUpRate, prev?.followUpRate ?? '']
    ])}`)

    if (data.leaderboard?.length) {
      blocks.push(`Associate leaderboard\n${rowsOf([
        ['Associate', 'New leads', 'Trials', 'Won', 'Revenue', 'Follow-up %'],
        ...data.leaderboard.map(a => [a.name, a.newLeads, a.trials, a.won, a.revenue, a.followUpRate])
      ])}`)
    }

    if (data.sourceBreakdown?.length) {
      blocks.push(`Source breakdown\n${rowsOf([
        ['Source', 'Leads', 'Won', 'Won rate %'],
        ...data.sourceBreakdown.map(s => [s.source, s.count, s.wonCount, s.wonRate])
      ])}`)
    }

    if (data.channelPerformance?.length) {
      blocks.push(`Channel performance\n${rowsOf([
        ['Channel', 'Attempted', 'Responded', 'Response rate %', 'Won', 'Conversion rate %'],
        ...data.channelPerformance.map(c => [c.channel, c.attempted, c.responded, c.responseRate, c.won, c.conversionRate])
      ])}`)
    }

    if (data.revenueMix?.length) {
      blocks.push(`Revenue mix\n${rowsOf([
        ['Class/membership type', 'Leads', 'Revenue', 'Won rate %'],
        ...data.revenueMix.map(m => [m.type, m.count, m.revenue, m.wonRate])
      ])}`)
    }

    downloadText(`studio-performance-${range}-${data.start}-to-${data.end}.csv`, blocks.join('\n\n'))
  }

  const compareLabel = data?.compare === 'yoy' ? 'vs same period last year' : 'vs previous period'

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[18px] font-bold text-white flex items-center gap-2">
            <Building2 size={18} className="text-rose-400" /> {title}
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">{desc}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className={`flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 p-1 ${customRange ? 'opacity-40' : ''}`}>
            <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed" disabled={customRange} onClick={() => setOffset(o => o + 1)}>
              <ChevronLeft size={15} />
            </button>
            <span className="px-2 text-[12.5px] font-semibold text-white min-w-[160px] text-center">{data?.label || '—'}</span>
            <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed" disabled={customRange || offset === 0} onClick={() => setOffset(o => Math.max(0, o - 1))}>
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-2 py-1">
            <CalendarRange size={13} className="text-slate-500 shrink-0" />
            <input type="date" className="input !w-auto !py-1 !text-[11.5px] !px-1.5" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined} />
            <span className="text-slate-600 text-[11px]">–</span>
            <input type="date" className="input !w-auto !py-1 !text-[11.5px] !px-1.5" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined} />
            {customRange && (
              <button className="w-5 h-5 rounded-md flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10" title="Clear custom range" onClick={() => { setDateFrom(''); setDateTo('') }}>
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-2 py-1.5">
            <GitCompareArrows size={13} className="text-slate-500 shrink-0" />
            <select className="input !w-auto !py-0 !text-[11.5px] !border-0 !bg-transparent" value={compareMode} onChange={e => setCompareMode(e.target.value)}>
              <option value="prev">vs previous period</option>
              <option value="yoy">vs same period last year</option>
            </select>
          </div>

          <div className="relative">
            <button
              type="button"
              className="btn btn-ghost !py-2 !px-3 !text-[12px] flex items-center gap-1.5"
              onClick={() => setStudioPickerOpen(o => !o)}
            >
              <MapPin size={13} /> {primary?.locationName || 'Studio'}
              {comparedLocations.length > 0 && <span className="chip !px-1.5 !py-0.5 text-[9px] bg-white/10 border border-white/10 text-slate-300">+{comparedLocations.length}</span>}
              <ChevronDownIcon size={13} className={`transition-transform ${studioPickerOpen ? 'rotate-180' : ''}`} />
            </button>
            {studioPickerOpen && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-64 rounded-xl bg-[var(--card-bg,#111730)] border border-white/10 shadow-2xl p-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1">Primary studio</div>
                <select
                  className="input !text-[12px] mb-2"
                  value={primary?.locationId || ''}
                  onChange={e => setPrimaryLocation(e.target.value)}
                >
                  {rows.map(r => <option key={r.locationId} value={r.locationId}>{r.locationName}</option>)}
                </select>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1">Add studios to compare</div>
                <div className="max-h-none flex flex-col gap-0.5">
                  {rows.filter(r => r.locationId !== primary?.locationId).map(r => {
                    const checked = selectedLocationIds.includes(r.locationId)
                    return (
                      <button
                        key={r.locationId}
                        type="button"
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] text-slate-300 hover:bg-white/5 text-left"
                        onClick={() => toggleCompareLocation(r.locationId)}
                      >
                        <span className={`w-4 h-4 rounded flex items-center justify-center border ${checked ? 'bg-rose-500/80 border-rose-500' : 'border-white/20'}`}>
                          {checked && <Check size={11} className="text-white" />}
                        </span>
                        {r.locationName}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <button className="btn btn-ghost !py-2 !px-3 !text-[12px] flex items-center gap-1.5" onClick={exportCsv} disabled={!data}>
            <Download size={13} /> Export CSV
          </button>
          <button className="btn btn-primary !py-2 !px-3 !text-[12px] flex items-center gap-1.5" onClick={exportPdf} disabled={!data || exporting}>
            {exporting ? <Spinner size={13} /> : <FileDown size={13} />} {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>

      {loading && <div className="py-20 text-center text-slate-500"><Spinner size={22} /></div>}

      {!loading && data && (
        <div className="space-y-5" ref={reportRef}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <MetricCard icon={Users} title="New leads" value={totals.newLeads} color="#8b5cf6"
              description={`${compareLabel} · ${prev?.newLeads ?? '—'} previous`}
              trend={historyTrend(history, 'newLeads')} mom={deltaPct(totals.newLeads, prev?.newLeads)} />
            <MetricCard icon={Crown} title="Trials" value={totals.trials} color="#06b6d4"
              description={`${compareLabel} · ${prev?.trials ?? '—'} previous`}
              trend={historyTrend(history, 'trials')} mom={deltaPct(totals.trials, prev?.trials)} />
            <MetricCard icon={Trophy} title="Won deals" value={totals.won} color="#10b981"
              description={`${compareLabel} · ${prev?.won ?? '—'} previous`}
              trend={historyTrend(history, 'won')} mom={deltaPct(totals.won, prev?.won)} />
            <MetricCard icon={IndianRupee} title="Revenue" value={money(totals.revenue)} color="#f43f5e"
              description={`${compareLabel} · ${money(prev?.revenue || 0)} previous`}
              trend={historyTrend(history, 'revenue')} mom={deltaPct(totals.revenue, prev?.revenue)} />
            <MetricCard icon={CalendarCheck2} title="Follow-up completion" value={`${followUpRate}%`} color="#fbbf24"
              description={`${totals.missed} missed of ${totals.followUps} · ${compareLabel}`}
              trend={historyTrend(history, 'followUpRate')} mom={deltaPct(followUpRate, prev?.followUpRate)} />
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
                <div className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 p-1">
                  <button type="button" className={`px-3 py-1.5 rounded-lg text-[11.5px] font-semibold ${funnelStage === 'all' ? 'bg-rose-500/25 text-white' : 'text-slate-400 hover:text-white'}`} onClick={() => setFunnelStage('all')}>All</button>
                  {funnelData.map((d) => (
                    <button key={d.key} type="button" className={`px-3 py-1.5 rounded-lg text-[11.5px] font-semibold ${funnelStage === d.key ? 'text-white' : 'text-slate-400 hover:text-white'}`} style={{ background: funnelStage === d.key ? `${FUNNEL_COLORS[d.key]}22` : 'transparent' }} onClick={() => setFunnelStage(d.key)}>
                      {d.stage}
                    </button>
                  ))}
                </div>
                <select className="input !w-auto !py-1.5 !text-[12px] ml-auto" value={funnelLocationId} onChange={e => setFunnelLocationId(e.target.value)}>
                  <option value="">All studios</option>
                  {rows.map(r => <option key={r.locationId} value={r.locationId}>{r.locationName}</option>)}
                </select>
              </div>
              <div className="pipeline-ranking-panel">
                <div className="pipeline-ranking-spotlight">
                  <div><span>Highest volume</span><strong>{rankedFunnel[0]?.stage || '—'}</strong></div>
                  <div><span>Highest count</span><strong>{rankedFunnel[0]?.count || 0}</strong></div>
                  <div><span>Scope</span><strong>{funnelLocationId ? 'Selected studio' : 'All studios'}</strong></div>
                </div>
                <div className="pipeline-ranking-columns">
                  <div className="pipeline-ranking-column is-top">
                    <div className="pipeline-ranking-heading"><span>Top stages</span><small>highest volume</small></div>
                    <div className="pipeline-ranking-list" role="list">
                      {rankedFunnel.slice(0, 2).map((d, i) => (
                        <button key={d.key} type="button" role="listitem" className={funnelStage === d.key ? 'is-active' : ''} style={{ '--rank-color': FUNNEL_COLORS[d.key] }} onClick={() => setFunnelStage(funnelStage === d.key ? 'all' : d.key)}>
                          <span className="pipeline-ranking-position">#{i + 1}</span><strong>{d.stage}</strong><span className="pipeline-ranking-score">{d.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="pipeline-ranking-column is-bottom">
                    <div className="pipeline-ranking-heading"><span>Bottom stages</span><small>lowest volume</small></div>
                    <div className="pipeline-ranking-list" role="list">
                      {rankedFunnel.slice(2).map((d, i) => (
                        <button key={d.key} type="button" role="listitem" className={funnelStage === d.key ? 'is-active' : ''} style={{ '--rank-color': FUNNEL_COLORS[d.key] }} onClick={() => setFunnelStage(funnelStage === d.key ? 'all' : d.key)}>
                          <span className="pipeline-ranking-position">#{i + 3}</span><strong>{d.stage}</strong><span className="pipeline-ranking-score">{d.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="pipeline-ranking-footer"><span>Click a stage to isolate it</span><strong>{visibleFunnel.length} shown</strong></div>
              </div>
            </div>
          )}

          {selectedRows.length > 1 && <StudioReportMatrix rows={selectedRows} />}

          <section className="studio-report-section">
            <ReportHeading number="02" title="Studio performance briefs" subtitle={comparedLocations.length ? 'Complete studio detail, shown together for direct comparison' : 'Complete detail for the selected studio'} />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
              {selectedRows.map(r => <StudioBrief key={r.locationId} row={r} openLead={openLead} />)}
              {!selectedRows.length && <div className="col-span-full text-center text-slate-500 py-10 text-[12.5px]">No studios found.</div>}
            </div>
          </section>

          {perLocation.map((loc, i) => (
            <div key={loc.locationId} className="space-y-5">
              {perLocation.length > 1 && (
                <div className="flex items-center gap-2 pt-1">
                  <Building2 size={14} className="text-rose-400 shrink-0" />
                  <h3 className="font-display font-semibold text-white text-[14px]">{loc.locationName}</h3>
                  {i === 0 ? (
                    <span className="chip !px-2 !py-0.5 text-[9.5px] bg-rose-500/15 border border-rose-500/20 text-rose-300">Primary</span>
                  ) : (
                    <span className="chip !px-2 !py-0.5 text-[9.5px] bg-white/5 border border-white/10 text-slate-400">Compare</span>
                  )}
                </div>
              )}
              <LeaderboardSection leaderboard={loc.leaderboard || []} />
              <SourceBreakdownSection sourceBreakdown={loc.sourceBreakdown || []} />
              <ChannelPerformanceSection channelPerformance={loc.channelPerformance || []} />
              <FollowUpAnalyticsSection data={loc.followUpAnalytics} />
              <RevenueMixSection revenueMix={loc.revenueMix || []} />
              <CohortConversionSection cohortConversion={loc.cohortConversion || []} />
              <GoalTrackingSection goalTracking={loc.goalTracking} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StudioReportMatrix({ rows }) {
  return (
    <section className="studio-report-section">
      <ReportHeading number="01" title="Studio performance matrix" subtitle="Side-by-side operating results for the selected reporting period" />
      <div className="overflow-x-auto scrollbar-thin">
        <table className="studio-report-table">
          <thead><tr><th>Studio</th><th>New leads</th><th>Trials</th><th>Won</th><th>Conversion</th><th>Revenue</th><th>Follow-up</th></tr></thead>
          <tbody>
            {rows.map(row => {
              const conversion = row.newLeads ? Math.round((row.won / row.newLeads) * 100) : 0
              const followUp = row.followUps ? Math.round(((row.followUps - row.missed) / row.followUps) * 100) : 0
              return (
                <tr key={row.locationId}>
                  <td><strong>{row.locationName}</strong><small>{row.missed} missed follow-ups</small></td>
                  <td>{row.newLeads}</td><td>{row.trials}</td><td className="text-emerald-400">{row.won}</td>
                  <td>{conversion}%</td><td className="text-emerald-400">{money(row.revenue)}</td><td className="text-amber-400">{followUp}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ReportHeading({ number, title, subtitle }) {
  return (
    <div className="studio-report-heading">
      <span>{number}</span>
      <div><h3>{title}</h3><p>{subtitle}</p></div>
    </div>
  )
}

function StudioBrief({ row, openLead }) {
  const conversion = row.newLeads ? Math.round((row.won / row.newLeads) * 100) : 0
  const followUp = row.followUps ? Math.round(((row.followUps - row.missed) / row.followUps) * 100) : 0
  return (
    <article className="studio-report-brief">
      <div className="studio-report-brief-title">
        <div><span>Studio brief</span><h4>{row.locationName}</h4></div>
        <strong>{money(row.revenue)}</strong>
      </div>
      <div className="studio-report-brief-kpis">
        <div><span>New leads</span><strong>{row.newLeads}</strong></div>
        <div><span>Trials</span><strong>{row.trials}</strong></div>
        <div><span>Won</span><strong>{row.won}</strong></div>
        <div><span>Conversion</span><strong>{conversion}%</strong></div>
        <div><span>Follow-up</span><strong>{followUp}%</strong></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <AssociateCard label="Top associate" icon={<Crown size={13} className="text-amber-400" />} associate={row.topAssociate} />
        <AssociateCard label="Needs support" icon={<TrendingDown size={13} className="text-slate-500" />} associate={row.bottomAssociate} />
        <DetailList title="New lead register" color="#a78bfa" items={row.newLeadDetails} openLead={openLead} />
        <DetailList title="Won business" color="#34d399" items={row.wonDetails} openLead={openLead} moneyValue />
      </div>
    </article>
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
      <div className="space-y-1">
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

const CHANNEL_LABELS = { call: 'Call', whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS' }

function ChannelPerformanceSection({ channelPerformance }) {
  if (!channelPerformance.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
        <Radio size={13} className="text-cyan-400" /> Channel performance
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-white/8">
                <th className="px-3 py-2 font-semibold">Channel</th>
                <th className="px-2 py-2 font-semibold text-center">Attempted</th>
                <th className="px-2 py-2 font-semibold text-center">Responded</th>
                <th className="px-2 py-2 font-semibold text-center">Response rate</th>
                <th className="px-2 py-2 font-semibold text-center">Won</th>
                <th className="px-2 py-2 font-semibold text-center">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {channelPerformance.map(c => (
                <tr key={c.channel} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                  <td className="px-3 py-2 text-[12.5px] font-semibold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHANNEL_COLORS[c.channel] || '#94a3b8' }} />
                    {CHANNEL_LABELS[c.channel] || c.channel}
                  </td>
                  <td className="px-2 py-2 text-[12px] text-slate-300 text-center mono">{c.attempted}</td>
                  <td className="px-2 py-2 text-[12px] text-slate-300 text-center mono">{c.responded}</td>
                  <td className="px-2 py-2 text-[12px] text-cyan-400 text-center mono">{c.responseRate}%</td>
                  <td className="px-2 py-2 text-[12px] text-slate-300 text-center mono">{c.won}</td>
                  <td className="px-2 py-2 text-[12px] text-emerald-400 text-center mono">{c.conversionRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={channelPerformance} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} unit="%" />
              <YAxis type="category" dataKey="channel" width={70} tick={AXIS} axisLine={false} tickLine={false} tickFormatter={c => CHANNEL_LABELS[c] || c} />
              <Tooltip contentStyle={tooltipStyle()} formatter={(v, n) => [`${v}%`, n]} />
              <Bar dataKey="responseRate" name="Response rate" radius={[0, 6, 6, 0]} barSize={12}>
                {channelPerformance.map(d => <Cell key={d.channel} fill={CHANNEL_COLORS[d.channel] || '#94a3b8'} opacity={0.9} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function FollowUpAnalyticsSection({ data }) {
  if (!data) return null
  const { overdueCount, avgResponseHours, completionRateByAssociate, missedByChannel } = data
  const avgResponseLabel = avgResponseHours >= 24 ? `${(avgResponseHours / 24).toFixed(1)}d` : `${avgResponseHours}h`
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
        <Clock3 size={13} className="text-amber-400" /> Follow-up analytics
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard icon={AlertTriangle} title="Overdue follow-ups" value={overdueCount} color="#f43f5e"
            description="Follow-ups past their due date, as of now." />
          <MetricCard icon={Clock3} title="Avg response time" value={avgResponseLabel} color="#f59e0b"
            description="Average gap between a lead's consecutive logged follow-ups." />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 mb-2">Completion rate by associate</div>
            {completionRateByAssociate.length ? (
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={completionRateByAssociate.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={AXIS} axisLine={false} tickLine={false} unit="%" />
                    <YAxis type="category" dataKey="name" width={90} tick={AXIS} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle()} formatter={(v) => `${v}%`} />
                    <Bar dataKey="rate" name="Completion" radius={[0, 6, 6, 0]} barSize={11} fill="#10b981" opacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <div className="text-[12px] text-slate-500">No data.</div>}
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 mb-2">Missed by channel</div>
            {missedByChannel.length ? (
              <div className="space-y-1.5">
                {missedByChannel.map(m => (
                  <div key={m.channel} className="flex items-center gap-2 text-[12px]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHANNEL_COLORS[m.channel] || '#94a3b8' }} />
                    <span className="text-slate-300 flex-1">{CHANNEL_LABELS[m.channel] || m.channel}</span>
                    <span className="mono text-rose-400">{m.count}</span>
                  </div>
                ))}
              </div>
            ) : <div className="text-[12px] text-slate-500">No missed follow-ups.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function RevenueMixSection({ revenueMix }) {
  if (!revenueMix.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
        <PieChartIcon size={13} className="text-fuchsia-400" /> Revenue mix by class type
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={revenueMix} dataKey="revenue" nameKey="type" innerRadius={52} outerRadius={80} paddingAngle={2} strokeWidth={0}>
                {revenueMix.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle()} formatter={(v) => money(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-white/8">
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-2 py-2 font-semibold text-center">Leads</th>
                <th className="px-2 py-2 font-semibold text-center">Revenue</th>
                <th className="px-2 py-2 font-semibold text-center">Won rate</th>
              </tr>
            </thead>
            <tbody>
              {revenueMix.map((m, i) => (
                <tr key={m.type} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                  <td className="px-3 py-2 text-[12.5px] font-semibold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    {m.type}
                  </td>
                  <td className="px-2 py-2 text-[12px] text-slate-300 text-center mono">{m.count}</td>
                  <td className="px-2 py-2 text-[12px] text-emerald-400 text-center mono">{money(m.revenue)}</td>
                  <td className="px-2 py-2 text-[12px] text-slate-300 text-center mono">{m.wonRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Heatmap-style cell shading: interpolates between the card background and
// emerald as the conversion percentage rises, so higher-converting
// cohort/period cells read as visibly "hotter" without needing a legend.
function heatBg(pct) {
  const p = Math.max(0, Math.min(100, pct)) / 100
  return `rgba(16, 185, 129, ${0.06 + p * 0.55})`
}

function CohortConversionSection({ cohortConversion }) {
  if (!cohortConversion.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
        <Layers size={13} className="text-violet-400" /> Cohort conversion
        <span className="ml-auto text-[11px] font-normal text-slate-500">% of each cohort's new leads won by 1/2/4 periods later</span>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-white/8">
              <th className="px-4 py-2.5 font-semibold">Cohort</th>
              <th className="px-3 py-2.5 font-semibold text-center">Size</th>
              <th className="px-3 py-2.5 font-semibold text-center">By P+1</th>
              <th className="px-3 py-2.5 font-semibold text-center">By P+2</th>
              <th className="px-3 py-2.5 font-semibold text-center">By P+4</th>
            </tr>
          </thead>
          <tbody>
            {cohortConversion.map(c => (
              <tr key={c.cohortLabel} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-2.5 text-[12.5px] font-semibold text-white">{c.cohortLabel}</td>
                <td className="px-3 py-2.5 text-[12px] text-slate-400 text-center mono">{c.size}</td>
                <td className="px-3 py-2.5 text-[12px] text-slate-100 text-center mono" style={{ background: heatBg(c.convertedByP1) }}>{c.convertedByP1}%</td>
                <td className="px-3 py-2.5 text-[12px] text-slate-100 text-center mono" style={{ background: heatBg(c.convertedByP2) }}>{c.convertedByP2}%</td>
                <td className="px-3 py-2.5 text-[12px] text-slate-100 text-center mono" style={{ background: heatBg(c.convertedByP4) }}>{c.convertedByP4}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function attainmentColor(pct) {
  if (pct < 60) return '#f43f5e'
  if (pct < 90) return '#f59e0b'
  return '#10b981'
}

function ProgressBar({ label, target, actual, attainmentPct }) {
  const color = attainmentColor(attainmentPct)
  const width = Math.max(2, Math.min(100, attainmentPct))
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-slate-300 truncate">{label}</span>
        <span className="mono text-slate-400 shrink-0 ml-2">{actual}/{target} · <span style={{ color }}>{attainmentPct}%</span></span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: color }} />
      </div>
    </div>
  )
}

function GoalTrackingSection({ goalTracking }) {
  if (!goalTracking) return null
  const { perStudio = [], perAssociate = [] } = goalTracking
  if (!perStudio.length && !perAssociate.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
        <Target size={13} className="text-rose-400" /> Goal tracking
        <span className="ml-auto text-[11px] font-normal text-slate-500">target vs actual won this period</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 p-4">
        <div>
          <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 mb-2.5">By studio</div>
          <div className="space-y-3">
            {perStudio.map(s => <ProgressBar key={s.locationId} label={s.name} target={s.target} actual={s.actual} attainmentPct={s.attainmentPct} />)}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 mb-2.5">By associate</div>
          <div className="space-y-3">
            {perAssociate.map(a => <ProgressBar key={a.associateId} label={a.name} target={a.target} actual={a.actual} attainmentPct={a.attainmentPct} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
