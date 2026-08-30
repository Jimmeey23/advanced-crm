import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Target, CheckCircle2, Trophy, IndianRupee, TrendingUp,
  Building2, UserCircle2, CalendarRange, ChevronDown, Filter, Radio,
  PieChart as PieChartIcon, Layers, ListFilter, Download, FileDown
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell
} from 'recharts'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api, buildQuery } from '../api.js'
import { money, fmtDate, downloadText } from '../lib.js'
import { Spinner, Avatar } from '../ui.jsx'

const DONUT_COLORS = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6']
const CHANNEL_COLORS = { call: '#06b6d4', whatsapp: '#10b981', email: '#8b5cf6', sms: '#f59e0b' }
const CHANNEL_LABELS = { call: 'Call', whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS' }
const FUNNEL_COLORS = { new: '#8b5cf6', trial: '#06b6d4', won: '#10b981', lost: '#f43f5e' }

const PRESETS = [
  { id: 'prev_week', label: 'Previous week' },
  { id: 'this_week', label: 'This week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'last_year', label: 'Last year' },
  { id: 'custom', label: 'Custom period' }
]

const SERIES = [
  { key: 'leadsReceived', label: 'Leads received', color: '#8b5cf6' },
  { key: 'trialsCompleted', label: 'Trials completed', color: '#06b6d4' },
  { key: 'converted', label: 'Converted', color: '#10b981' }
]

const tooltipStyle = () => ({
  background: 'var(--tt-bg)', border: '1px solid var(--tt-border)', borderRadius: 12,
  fontSize: 12, color: 'var(--tt-color)', boxShadow: '0 10px 30px rgba(0,0,0,.5)'
})
const AXIS = { fill: 'var(--axis)', fontSize: 10.5 }

export default function ReportOverview({ title, desc }) {
  const { openLead, role, locationIds, associateId: myAssociateId, boot } = useApp()
  const locked = role === 'agent'
  const [scope, setScope] = useState('studio')
  const [entityId, setEntityId] = useState(() => (locked && locationIds[0]) ? locationIds[0] : '')
  const [preset, setPreset] = useState('prev_week')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [visibleSeries, setVisibleSeries] = useState(() => new Set(SERIES.map(s => s.key)))
  const [drill, setDrill] = useState(null) // { field, value, label }
  const [exporting, setExporting] = useState(false)
  const reportRef = useRef(null)

  // Agents may switch between their own studio and their own associate
  // profile — the scope toggle itself isn't locked — but the id is always
  // forced to "them", never a picker over other studios/associates.
  useEffect(() => {
    if (!locked) return
    const forced = scope === 'studio' ? locationIds[0] : myAssociateId
    if (forced) setEntityId(id => (id === forced ? id : forced))
  }, [locked, locationIds[0], myAssociateId, scope])

  const customRange = preset === 'custom' && dateFrom && dateTo

  const params = useMemo(() => {
    const p = new URLSearchParams({ scope })
    if (entityId) p.set('entityId', entityId)
    if (customRange) { p.set('from', dateFrom); p.set('to', dateTo) }
    else p.set('preset', preset)
    return p.toString()
  }, [scope, entityId, preset, customRange, dateFrom, dateTo])

  const { data, loading, reload } = useFetch(() => api.get(`/api/analytics/report?${params}`), [params])

  // Reset the entity selection when switching scope — an associate id is
  // meaningless as a locationId and vice versa. Agents are locked to their
  // own studio, so this reset never applies to them (scope switching itself
  // is disabled below).
  useEffect(() => {
    if (locked) return
    setEntityId('')
  }, [scope, locked])

  const toggleSeries = (key) => setVisibleSeries(s => {
    const next = new Set(s)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const openDrill = (field, value) => setDrill({ field, value })
  const drillParams = drill ? new URLSearchParams({ scope, ...(entityId ? { entityId } : {}), ...(customRange ? { from: dateFrom, to: dateTo } : { preset }), [drill.field]: drill.value }).toString() : null
  const { data: drillData, loading: drillLoading } = useFetch(
    () => drill ? api.get(`/api/analytics/report/drill?${drillParams}`) : Promise.resolve(null),
    [drillParams]
  )

  const exportPdf = async () => {
    if (!reportRef.current || exporting) return
    setExporting(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
      const canvas = await html2canvas(reportRef.current, { backgroundColor: '#0b0f1a', scale: 2, useCORS: true, windowWidth: reportRef.current.scrollWidth })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgW = pageW
      const pxPerPage = (canvas.width * pageH) / imgW
      let renderedPx = 0, page = 0
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
      pdf.save(`${data?.scope || 'report'}-${data?.entityName || 'all'}-${data?.period?.start || ''}-to-${data?.period?.end || ''}.pdf`)
    } finally { setExporting(false) }
  }

  const exportCsv = () => {
    if (!data) return
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rowsOf = (arr) => arr.map(r => r.map(esc).join(',')).join('\n')
    const blocks = []
    blocks.push(`${data.entityName} — ${data.period.label}\n${rowsOf([
      ['Metric', data.comparisons.current.label, 'Previous period', 'Same period last year'],
      ['Leads received', data.comparisons.current.leadsReceived, data.comparisons.previousPeriod.leadsReceived, data.comparisons.yoy.leadsReceived],
      ['Trials scheduled', data.comparisons.current.trialsScheduled, data.comparisons.previousPeriod.trialsScheduled, data.comparisons.yoy.trialsScheduled],
      ['Trials completed', data.comparisons.current.trialsCompleted, data.comparisons.previousPeriod.trialsCompleted, data.comparisons.yoy.trialsCompleted],
      ['Converted', data.comparisons.current.converted, data.comparisons.previousPeriod.converted, data.comparisons.yoy.converted],
      ['Conversion rate %', data.comparisons.current.conversionRate, data.comparisons.previousPeriod.conversionRate, data.comparisons.yoy.conversionRate],
      ['LTV', data.comparisons.current.ltv, data.comparisons.previousPeriod.ltv, data.comparisons.yoy.ltv]
    ])}`)
    if (data.stageBreakdown.rows.length) {
      blocks.push(`Leads by stage\n${rowsOf([
        ['Stage', 'Received', 'Scheduled', 'Completed', 'Converted', 'Conv. rate %'],
        ...data.stageBreakdown.rows.map(r => [r.key, r.leadsReceived, r.trialsScheduled, r.trialsCompleted, r.converted, r.conversionRate]),
        ['Total', data.stageBreakdown.totals.leadsReceived, data.stageBreakdown.totals.trialsScheduled, data.stageBreakdown.totals.trialsCompleted, data.stageBreakdown.totals.converted, data.stageBreakdown.totals.conversionRate]
      ])}`)
    }
    if (data.sourceBreakdown.rows.length) {
      blocks.push(`Leads by source\n${rowsOf([
        ['Source', 'Received', 'Scheduled', 'Completed', 'Converted', 'Conv. rate %'],
        ...data.sourceBreakdown.rows.map(r => [r.key, r.leadsReceived, r.trialsScheduled, r.trialsCompleted, r.converted, r.conversionRate]),
        ['Total', data.sourceBreakdown.totals.leadsReceived, data.sourceBreakdown.totals.trialsScheduled, data.sourceBreakdown.totals.trialsCompleted, data.sourceBreakdown.totals.converted, data.sourceBreakdown.totals.conversionRate]
      ])}`)
    }
    downloadText(`${data.scope}-${data.entityName}-${data.period.start}-to-${data.period.end}.csv`, blocks.join('\n\n'))
  }

  // Associate overview detail: the aggregate report already gives the
  // comparison metrics for the period; this adds the associate's photo and
  // the actual lead-level activity (stage, latest remark, follow-ups done)
  // so the tab is a working profile, not just numbers.
  const associateDetail = scope === 'associate' && entityId ? (boot?.associates || []).find(a => a.id === entityId) : null
  const detailQuery = associateDetail && data?.period ? buildQuery({ associateId: entityId, dateFrom: data.period.start, dateTo: data.period.end, pageSize: 500 }) : null
  const { data: detailLeadsResp } = useFetch(() => detailQuery ? api.get(`/api/leads?${detailQuery}`) : Promise.resolve(null), [detailQuery])
  const detailLeads = detailLeadsResp?.items || []

  const comp = data?.comparisons
  const cols = comp ? [
    { key: 'current', label: comp.current.label, accent: '#f43f5e', data: comp.current },
    { key: 'previousPeriod', label: `Previous period (${comp.previousPeriod.label})`, accent: '#3b82f6', data: comp.previousPeriod },
    { key: 'yoy', label: `Same period last year (${comp.yoy.label})`, accent: '#8b5cf6', data: comp.yoy }
  ] : []

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[18px] font-bold text-white flex items-center gap-2">
            {scope === 'associate' ? <UserCircle2 size={18} className="text-rose-400" /> : <Building2 size={18} className="text-rose-400" />} {title}
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">{desc}</p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-white/5 border border-white/10 p-1">
            <button className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 ${scope === 'studio' ? 'bg-rose-500/25 text-white' : 'text-slate-400 hover:text-white'}`} onClick={() => setScope('studio')}><Building2 size={13} /> Studio overview</button>
            <button className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 ${scope === 'associate' ? 'bg-rose-500/25 text-white' : 'text-slate-400 hover:text-white'}`} onClick={() => setScope('associate')}><UserCircle2 size={13} /> Associate overview</button>
          </div>

          <select className="input !w-auto !py-2 !text-[12px]" value={entityId} onChange={e => setEntityId(e.target.value)} disabled={locked} title={locked ? 'Agents view their own studio/profile only' : undefined}>
            <option value="">{scope === 'associate' ? 'All associates' : 'All studios'}</option>
            {(data?.entities || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>

          <div className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-2 py-1.5">
            <CalendarRange size={13} className="text-slate-500 shrink-0" />
            <select className="input !w-auto !py-0 !text-[11.5px] !border-0 !bg-transparent" value={preset} onChange={e => setPreset(e.target.value)}>
              {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-2 py-1">
              <input type="date" className="input !w-auto !py-1 !text-[11.5px] !px-1.5" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined} />
              <span className="text-slate-600 text-[11px]">–</span>
              <input type="date" className="input !w-auto !py-1 !text-[11.5px] !px-1.5" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined} />
            </div>
          )}

          <button className="btn btn-ghost !py-2 !px-3 !text-[12px] flex items-center gap-1.5" onClick={exportCsv} disabled={!data}>
            <Download size={13} /> CSV
          </button>
          <button className="btn btn-primary !py-2 !px-3 !text-[12px] flex items-center gap-1.5" onClick={exportPdf} disabled={!data || exporting}>
            {exporting ? <Spinner size={13} /> : <FileDown size={13} />} {exporting ? 'Exporting…' : 'PDF'}
          </button>
        </div>
      </div>

      {loading && <div className="py-20 text-center text-slate-500"><Spinner size={22} /></div>}

      {!loading && data && (
        <div className="space-y-5" ref={reportRef}>
          <div className="text-[12px] text-slate-500">{data.entityName} · {data.period.label} ({data.period.start} to {data.period.end})</div>

          {associateDetail && (
            <div className="card p-5 flex flex-wrap items-center gap-5">
              <Avatar name={associateDetail.name} color={associateDetail.color} photoUrl={associateDetail.photoUrl} photoZoom={associateDetail.photoZoom} photoPosX={associateDetail.photoPosX} photoPosY={associateDetail.photoPosY} size={96} fallback="👤" />
              <div className="flex-1 min-w-[180px]">
                <div className="font-display font-bold text-white text-[17px]">{associateDetail.name}</div>
                <div className="text-[12px] text-slate-500">{associateDetail.role || 'Sales Associate'}{associateDetail.email ? ` · ${associateDetail.email}` : ''}</div>
                <div className="text-[11.5px] text-slate-500 mt-1">{detailLeads.length} lead{detailLeads.length === 1 ? '' : 's'} in this period</div>
              </div>
            </div>
          )}

          {associateDetail && detailLeads.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/8 font-display font-semibold text-white text-[13.5px]">Lead activity this period</div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="data-table w-full">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-white/8">
                      <th className="px-4 py-2.5 text-left font-semibold">Lead</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Stage</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Latest comment</th>
                      <th className="px-4 py-2.5 text-center font-semibold">FUs completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailLeads.map(l => {
                      const completed = (l.followUps || []).filter(f => f.done).length
                      return (
                        <tr key={l.id} className="border-b border-white/5 hover:bg-white/[0.03] cursor-pointer" onClick={() => openLead(l.id)}>
                          <td className="px-4 py-2.5 text-[12.5px] text-white font-medium">{l.fullName}</td>
                          <td className="px-4 py-2.5 text-[12px] text-slate-400">{l.stage}</td>
                          <td className="px-4 py-2.5 text-[12px] text-slate-500 max-w-[280px] truncate" title={l.remarks || ''}>{l.remarks || '—'}</td>
                          <td className="px-4 py-2.5 text-[12px] text-slate-400 text-center mono">{completed}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3-column comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {cols.map(c => (
              <div key={c.key} className="card p-4 border-t-2" style={{ borderTopColor: c.accent }}>
                <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: c.accent }}>{c.label}</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <Metric icon={<Users size={12} />} label="Leads received" value={c.data.leadsReceived} />
                  <Metric icon={<Target size={12} />} label="Trials scheduled" value={c.data.trialsScheduled} />
                  <Metric icon={<CheckCircle2 size={12} />} label="Trials completed" value={c.data.trialsCompleted} />
                  <Metric icon={<Trophy size={12} />} label="Converted" value={c.data.converted} />
                  <Metric icon={<TrendingUp size={12} />} label="Conversion rate" value={`${c.data.conversionRate}%`} />
                  <Metric icon={<IndianRupee size={12} />} label="LTV" value={money(c.data.ltv)} />
                </div>
              </div>
            ))}
          </div>

          {/* trend chart with toggleable series */}
          {data.trend.length > 0 && (
            <div className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <h3 className="font-display font-semibold text-white text-[14px]">Trend</h3>
                <div className="flex items-center gap-1.5">
                  {SERIES.map(s => (
                    <button key={s.key} type="button"
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${visibleSeries.has(s.key) ? 'text-white' : 'text-slate-500 border-white/10 bg-white/[0.02]'}`}
                      style={visibleSeries.has(s.key) ? { background: `${s.color}22`, borderColor: `${s.color}55` } : undefined}
                      onClick={() => toggleSeries(s.key)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="periodLabel" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle()} />
                    {SERIES.filter(s => visibleSeries.has(s.key)).map(s => (
                      <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownTable title="Leads by stage" rows={data.stageBreakdown.rows} totals={data.stageBreakdown.totals} field="stage" onDrill={openDrill} />
            <BreakdownTable title="Leads by source" rows={data.sourceBreakdown.rows} totals={data.sourceBreakdown.totals} field="source" onDrill={openDrill} />
          </div>

          {/* pipeline funnel */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={14} className="text-cyan-400" />
              <h3 className="font-display font-semibold text-white text-[14px]">Pipeline funnel</h3>
              <span className="ml-auto text-[11px] text-slate-500">leads created in this period, by current outcome</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {['new', 'trial', 'won', 'lost'].map(k => (
                <div key={k} className="rounded-xl bg-white/[0.03] border border-white/8 px-3 py-2.5">
                  <div className="text-[9.5px] uppercase tracking-wider text-slate-500">{k}</div>
                  <div className="font-display text-[18px] font-bold mono" style={{ color: FUNNEL_COLORS[k] }}>{data.funnel[k]}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* channel performance */}
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
                <Radio size={13} className="text-cyan-400" /> Channel performance
              </div>
              {data.channelPerformance.length ? (
                <div className="p-4 h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.channelPerformance} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                      <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} unit="%" />
                      <YAxis type="category" dataKey="channel" width={70} tick={AXIS} axisLine={false} tickLine={false} tickFormatter={c => CHANNEL_LABELS[c] || c} />
                      <Tooltip contentStyle={tooltipStyle()} formatter={(v, n) => [`${v}%`, n]} />
                      <Bar dataKey="responseRate" name="Response rate" radius={[0, 6, 6, 0]} barSize={14}>
                        {data.channelPerformance.map(d => <Cell key={d.channel} fill={CHANNEL_COLORS[d.channel] || '#94a3b8'} opacity={0.9} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-[11.5px] text-slate-500 p-4">No channel activity in this period.</p>}
            </div>

            {/* revenue mix */}
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
                <PieChartIcon size={13} className="text-fuchsia-400" /> Revenue mix by class type
              </div>
              {data.revenueMix.length ? (
                <div className="p-4 h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.revenueMix} dataKey="revenue" nameKey="type" innerRadius={45} outerRadius={72} paddingAngle={2} strokeWidth={0}>
                        {data.revenueMix.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle()} formatter={(v) => money(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-[11.5px] text-slate-500 p-4">No revenue in this period.</p>}
            </div>
          </div>

          {/* cohort conversion */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
              <Layers size={13} className="text-violet-400" /> Cohort conversion
              <span className="ml-auto text-[11px] font-normal text-slate-500">% of each cohort's new leads won by 1/2/4 periods later</span>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/8">
                    <th className="px-4 py-2 font-semibold">Cohort</th>
                    <th className="px-3 py-2 font-semibold text-center">Size</th>
                    <th className="px-3 py-2 font-semibold text-center">By P+1</th>
                    <th className="px-3 py-2 font-semibold text-center">By P+2</th>
                    <th className="px-3 py-2 font-semibold text-center">By P+4</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cohortConversion.map(c => (
                    <tr key={c.cohortLabel} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2 text-[12px] font-semibold text-white">{c.cohortLabel}</td>
                      <td className="px-3 py-2 text-[11.5px] text-slate-400 text-center mono">{c.size}</td>
                      <td className="px-3 py-2 text-[11.5px] text-slate-100 text-center mono">{c.convertedByP1}%</td>
                      <td className="px-3 py-2 text-[11.5px] text-slate-100 text-center mono">{c.convertedByP2}%</td>
                      <td className="px-3 py-2 text-[11.5px] text-slate-100 text-center mono">{c.convertedByP4}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* leaderboard — only meaningful for a studio scope */}
          {scope === 'studio' && data.leaderboard.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-2 text-[12.5px] font-semibold text-slate-200">
                <ListFilter size={13} className="text-fuchsia-400" /> Associate leaderboard
                <span className="ml-auto text-[11px] font-normal text-slate-500">{data.leaderboard.length} associates</span>
              </div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/8">
                      <th className="px-4 py-2 font-semibold">Associate</th>
                      <th className="px-3 py-2 font-semibold text-center">New leads</th>
                      <th className="px-3 py-2 font-semibold text-center">Trials</th>
                      <th className="px-3 py-2 font-semibold text-center">Won</th>
                      <th className="px-3 py-2 font-semibold text-center">Revenue</th>
                      <th className="px-3 py-2 font-semibold text-center">Follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaderboard.slice().sort((a, b) => b.revenue - a.revenue).map(a => (
                      <tr key={a.associateId} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                        <td className="px-4 py-2 text-[12px] font-semibold text-white">{a.name}</td>
                        <td className="px-3 py-2 text-[11.5px] text-slate-300 text-center mono">{a.newLeads}</td>
                        <td className="px-3 py-2 text-[11.5px] text-slate-300 text-center mono">{a.trials}</td>
                        <td className="px-3 py-2 text-[11.5px] text-slate-300 text-center mono">{a.won}</td>
                        <td className="px-3 py-2 text-[11.5px] text-emerald-400 text-center mono">{money(a.revenue)}</td>
                        <td className="px-3 py-2 text-[11.5px] text-amber-400 text-center mono">{a.followUpRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {drill && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/8 flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-slate-200">Leads — {drill.field}: {drill.value}</span>
                <button className="btn btn-ghost !py-1 !text-[11px]" onClick={() => setDrill(null)}><ChevronDown size={12} /> Close</button>
              </div>
              <div className="max-h-[280px] overflow-y-auto scrollbar-thin">
                {drillLoading && <div className="py-6 text-center text-slate-500"><Spinner size={16} /></div>}
                {!drillLoading && drillData?.leads?.map(l => (
                  <button key={l.id} className="w-full text-left flex items-center gap-3 px-4 py-2 text-[12px] border-b border-white/5 last:border-0 hover:bg-white/[0.04] transition-colors" onClick={() => openLead(l.id)}>
                    <span className="flex-1 truncate text-slate-200">{l.fullName}</span>
                    <span className="chip !px-1.5 !py-0.5 text-[9px] bg-white/5 border border-white/10 text-slate-400 shrink-0">{l.stage}</span>
                    <span className="text-slate-500 shrink-0 w-16 text-right">{fmtDate(l.createdAt)}</span>
                  </button>
                ))}
                {!drillLoading && !drillData?.leads?.length && <p className="text-[11.5px] text-slate-500 px-4 py-3">No leads found.</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Metric({ icon, label, value }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/8 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-slate-500">{icon}{label}</div>
      <div className="font-display text-[15px] font-bold text-white mono mt-0.5">{value}</div>
    </div>
  )
}

function BreakdownTable({ title, rows, totals, field, onDrill }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/8 text-[12.5px] font-semibold text-slate-200">{title}</div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/8">
              <th className="px-4 py-2 font-semibold">{field === 'stage' ? 'Stage' : 'Source'}</th>
              <th className="px-2 py-2 font-semibold text-center">Received</th>
              <th className="px-2 py-2 font-semibold text-center">Scheduled</th>
              <th className="px-2 py-2 font-semibold text-center">Completed</th>
              <th className="px-2 py-2 font-semibold text-center">Converted</th>
              <th className="px-2 py-2 font-semibold text-center">Conv. rate</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map(r => (
              <tr key={r.key} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors cursor-pointer" onClick={() => onDrill(field, r.key)}>
                <td className="px-4 py-2 text-[12px] font-semibold text-white truncate max-w-[180px]" title={r.key}>{r.key}</td>
                <td className="px-2 py-2 text-[11.5px] text-slate-300 text-center mono">{r.leadsReceived}</td>
                <td className="px-2 py-2 text-[11.5px] text-cyan-400 text-center mono">{r.trialsScheduled}</td>
                <td className="px-2 py-2 text-[11.5px] text-cyan-300 text-center mono">{r.trialsCompleted}</td>
                <td className="px-2 py-2 text-[11.5px] text-emerald-400 text-center mono">{r.converted}</td>
                <td className="px-2 py-2 text-[11.5px] text-slate-300 text-center mono">{r.conversionRate}%</td>
              </tr>
            ))}
            {!rows?.length && <tr><td colSpan={6} className="px-4 py-4 text-[11.5px] text-slate-500 text-center">No data.</td></tr>}
          </tbody>
          {!!rows?.length && (
            <tfoot>
              <tr className="border-t border-white/10 bg-white/[0.02] font-semibold">
                <td className="px-4 py-2 text-[12px] text-white">Total</td>
                <td className="px-2 py-2 text-[11.5px] text-white text-center mono">{totals.leadsReceived}</td>
                <td className="px-2 py-2 text-[11.5px] text-cyan-400 text-center mono">{totals.trialsScheduled}</td>
                <td className="px-2 py-2 text-[11.5px] text-cyan-300 text-center mono">{totals.trialsCompleted}</td>
                <td className="px-2 py-2 text-[11.5px] text-emerald-400 text-center mono">{totals.converted}</td>
                <td className="px-2 py-2 text-[11.5px] text-white text-center mono">{totals.conversionRate}%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
