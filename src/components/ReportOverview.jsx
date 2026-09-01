// Studio / associate report.
//
// The page answers four questions in order, and everything on it is either an
// answer or a way to interrogate one:
//   1. How did this period go, against the last one and against last year?
//   2. What changed, in words? (server-generated insights)
//   3. Who and what drove it? (rankings, source ROI, stage and cohort tables)
//   4. What is stuck? (pipeline ageing, follow-up health, top open deals)
//
// Every number that stands for a set of leads is clickable and opens the same
// drill panel, which lists the leads with enough detail to act on them and
// opens any of them in the lead drawer. Control state lives in the URL hash,
// so a report is shareable, and can be stored as a named saved view.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Target, CheckCircle2, Trophy, IndianRupee, TrendingUp, Building2,
  UserCircle2, CalendarRange, Download, FileDown, Gauge, Timer, Layers,
  Radio, Flame, ListOrdered, GitCompare, AlertTriangle, Sparkles, Wallet,
  CalendarDays, PieChart as PieIcon, ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { money, fmtDate, downloadText } from '../lib.js'
import { Spinner, Avatar } from '../ui.jsx'
import { seriesColor, status as statusColor } from '../chartPalette.js'
import {
  Section, StatTile, TileGrid, Delta, InsightList, Segmented, RankTable,
  DrillPanel, SavedViews, ChartFrame, pctChange, csvRows
} from './report/kit.jsx'

const PRESETS = [
  { id: 'prev_week', label: 'Previous week' },
  { id: 'this_week', label: 'This week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'last_year', label: 'Last year' },
  { id: 'custom', label: 'Custom period' }
]

const TREND_SERIES = [
  { key: 'leadsReceived', label: 'Leads received' },
  { key: 'trialsCompleted', label: 'Trials completed' },
  { key: 'converted', label: 'Converted' },
  { key: 'revenue', label: 'Revenue' }
]

const num = (n) => Number(n || 0).toLocaleString('en-IN')

export default function ReportOverview({ title, desc, page = 'studio-weekly' }) {
  const { openLead, role, locationIds, associateId: myAssociateId, boot, theme, viewParams, toast } = useApp()
  const mode = theme === 'light' ? 'light' : 'dark'
  const locked = role === 'agent'

  const [scope, setScope] = useState(() => (viewParams.scope === 'associate' ? 'associate' : 'studio'))
  const [entityId, setEntityId] = useState(() => viewParams.entityId || ((locked && locationIds[0]) ? locationIds[0] : ''))
  const [preset, setPreset] = useState(() => viewParams.preset || 'prev_week')
  const [dateFrom, setDateFrom] = useState(() => viewParams.from || '')
  const [dateTo, setDateTo] = useState(() => viewParams.to || '')
  const [compareIds, setCompareIds] = useState(() => (viewParams.compare ? viewParams.compare.split(',').filter(Boolean) : []))
  const [compareOpen, setCompareOpen] = useState(() => !!viewParams.compare)
  const [drill, setDrill] = useState(null)
  const [topTab, setTopTab] = useState('wins')
  const [exporting, setExporting] = useState(false)
  const reportRef = useRef(null)

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

  // The address bar mirrors the controls, so any state a person is looking at
  // can be sent to someone else verbatim.
  useEffect(() => {
    const hashState = new URLSearchParams({ scope, ...(entityId ? { entityId } : {}), ...(customRange ? { from: dateFrom, to: dateTo, preset: 'custom' } : { preset }), ...(compareIds.length ? { compare: compareIds.join(',') } : {}) })
    window.history.replaceState(null, '', `#${page}?${hashState.toString()}`)
  }, [page, scope, entityId, preset, customRange, dateFrom, dateTo, compareIds])

  const { data: raw, loading, error } = useFetch(() => api.get(`/api/analytics/report?${params}`), [params])

  // The page reads roughly twenty aggregates off one payload. A server that
  // predates any of them (an older build still running, a proxy serving a
  // cached response) would otherwise take the whole tab down with a TypeError
  // on the first missing key, so the payload is normalised once here and every
  // section below can read it without optional chaining on every line.
  const data = useMemo(() => {
    if (!raw) return null
    const metrics = (m) => ({
      label: '', leadsReceived: 0, trialsScheduled: 0, trialsCompleted: 0, converted: 0,
      conversionRate: 0, revenue: 0, ltv: 0, followUps: 0, missed: 0, followUpRate: 0, ...(m || {})
    })
    return {
      ...raw,
      entities: raw.entities || [],
      period: raw.period || { label: '—', start: '', end: '' },
      comparisons: {
        current: metrics(raw.comparisons?.current),
        previousPeriod: metrics(raw.comparisons?.previousPeriod),
        yoy: metrics(raw.comparisons?.yoy)
      },
      trend: raw.trend || [],
      funnel: { new: 0, trial: 0, won: 0, lost: 0, ...(raw.funnel || {}) },
      stageBreakdown: { rows: [], totals: {}, ...(raw.stageBreakdown || {}) },
      sourceBreakdown: { rows: [], totals: {}, ...(raw.sourceBreakdown || {}) },
      revenueMix: raw.revenueMix || [],
      cohortConversion: raw.cohortConversion || [],
      leaderboard: raw.leaderboard || [],
      rankings: raw.rankings || [],
      sourceRoi: raw.sourceRoi || [],
      weekdayPattern: raw.weekdayPattern || [],
      lostBySource: raw.lostBySource || [],
      insights: raw.insights || [],
      goals: raw.goals || { perAssociate: [], perStudio: [] },
      velocity: {
        wonCount: 0, avgDaysToWin: 0, medianDaysToWin: 0, avgDaysToFirstTouch: 0,
        medianDaysToFirstTouch: 0, untouchedLeads: 0, touchedLeads: 0, avgTouchesToWin: 0,
        ...(raw.velocity || {})
      },
      ageing: { buckets: [], stages: [], openCount: 0, oldest: null, ...(raw.ageing || {}) },
      topLeads: { wins: [], openDeals: [], losses: [], ...(raw.topLeads || {}) },
      followUpHealth: {
        logged: 0, done: 0, missed: 0, overdue: 0, completionRate: 0,
        avgPerLead: 0, leadsWithNoFollowUp: 0, ...(raw.followUpHealth || {})
      }
    }
  }, [raw])

  const isFirstScope = useRef(true)
  useEffect(() => {
    if (locked) return
    if (isFirstScope.current) { isFirstScope.current = false; return }
    setEntityId('')
    setCompareIds([])
  }, [scope, locked])

  /* ── Drill-down ─────────────────────────────────────────── */
  const openDrill = useCallback((filters, label) => setDrill({ filters, label }), [])
  const drillParams = drill
    ? new URLSearchParams({
        scope,
        ...(entityId ? { entityId } : {}),
        ...(customRange ? { from: dateFrom, to: dateTo } : { preset }),
        ...drill.filters
      }).toString()
    : null
  const { data: drillData, loading: drillLoading } = useFetch(
    () => drill ? api.get(`/api/analytics/report/drill?${drillParams}`) : Promise.resolve(null),
    [drillParams]
  )

  /* ── Comparison mode ────────────────────────────────────── */
  const compareQuery = compareIds.length >= 2
    ? new URLSearchParams({ scope, entityIds: compareIds.join(','), ...(customRange ? { from: dateFrom, to: dateTo } : { preset }) }).toString()
    : null
  const { data: compareData } = useFetch(
    () => compareQuery ? api.get(`/api/analytics/report/compare?${compareQuery}`) : Promise.resolve(null),
    [compareQuery]
  )

  const applySavedView = (state) => {
    setScope(state.scope || 'studio')
    setEntityId(state.entityId || '')
    setPreset(state.preset || 'prev_week')
    setDateFrom(state.from || '')
    setDateTo(state.to || '')
    setCompareIds(state.compare ? state.compare.split(',') : [])
    setCompareOpen(!!state.compare)
  }
  const viewState = { scope, entityId, preset: customRange ? 'custom' : preset, from: dateFrom, to: dateTo, compare: compareIds.join(',') }
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('Report link copied')
    } catch (e) { toast('Could not copy the link', 'error') }
  }

  /* ── Exports ────────────────────────────────────────────── */
  const exportDrillCsv = (leads, d) => {
    downloadText(`drill-${Object.values(d.filters).join('-')}.csv`, csvRows([
      ['Lead', 'Owner', 'Stage', 'Status', 'Source', 'Value', 'Follow-ups done', 'Created', 'Converted', 'Phone', 'Email', 'Latest remark'],
      ...leads.map(l => [l.fullName, l.associateName, l.stage, l.status, l.source, l.revenue, l.followUpsDone, l.createdAt, l.convertedAt, l.phone, l.email, l.lastRemark])
    ]))
  }

  const exportCsv = () => {
    if (!data) return
    const blocks = []
    const c = data.comparisons
    blocks.push(`${data.entityName} — ${data.period.label} (${data.period.start} to ${data.period.end})\n${csvRows([
      ['Metric', 'This period', 'Previous period', 'Same period last year'],
      ['Leads received', c.current.leadsReceived, c.previousPeriod.leadsReceived, c.yoy.leadsReceived],
      ['Trials scheduled', c.current.trialsScheduled, c.previousPeriod.trialsScheduled, c.yoy.trialsScheduled],
      ['Trials completed', c.current.trialsCompleted, c.previousPeriod.trialsCompleted, c.yoy.trialsCompleted],
      ['Converted', c.current.converted, c.previousPeriod.converted, c.yoy.converted],
      ['Conversion rate %', c.current.conversionRate, c.previousPeriod.conversionRate, c.yoy.conversionRate],
      ['Revenue', c.current.revenue, c.previousPeriod.revenue, c.yoy.revenue],
      ['Avg deal (LTV)', c.current.ltv, c.previousPeriod.ltv, c.yoy.ltv]
    ])}`)
    if (data.insights?.length) {
      blocks.push(`Insights\n${csvRows([['Reading', 'Detail'], ...data.insights.map(i => [i.title, i.detail])])}`)
    }
    if (data.rankings?.length) {
      blocks.push(`Associate rankings\n${csvRows([
        ['Rank', 'Associate', 'Rank change', 'New leads', 'Trials', 'Won', 'Conversion %', 'Revenue', 'Revenue per lead', 'Follow-up %'],
        ...data.rankings.map(r => [r.rank, r.name, r.rankDelta ?? '', r.newLeads, r.trials, r.won, r.conversionRate, r.revenue, r.revenuePerLead, r.followUpRate])
      ])}`)
    }
    if (data.sourceRoi?.length) {
      blocks.push(`Source return\n${csvRows([
        ['Source', 'Leads', 'Won', 'Lost', 'Open', 'Win %', 'Revenue', 'Revenue per lead', 'Avg deal'],
        ...data.sourceRoi.map(s => [s.source, s.leads, s.won, s.lost, s.open, s.winRate, s.revenue, s.revenuePerLead, s.avgDealValue])
      ])}`)
    }
    if (data.stageBreakdown?.rows?.length) {
      blocks.push(`Leads by stage\n${csvRows([
        ['Stage', 'Received', 'Scheduled', 'Completed', 'Converted', 'Conv. rate %'],
        ...data.stageBreakdown.rows.map(r => [r.key, r.leadsReceived, r.trialsScheduled, r.trialsCompleted, r.converted, r.conversionRate])
      ])}`)
    }
    if (data.ageing?.stages?.length) {
      blocks.push(`Open pipeline by stage\n${csvRows([
        ['Stage', 'Open leads', 'Avg age (days)', 'Older than 30 days', 'Pipeline value'],
        ...data.ageing.stages.map(r => [r.stage, r.count, r.avgAgeDays, r.stale, r.value])
      ])}`)
    }
    downloadText(`${data.scope}-${data.entityName}-${data.period.start}-to-${data.period.end}.csv`, blocks.join('\n\n'))
  }

  const exportPdf = async () => {
    if (!reportRef.current || exporting) return
    setExporting(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
      const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff'
      const canvas = await html2canvas(reportRef.current, { backgroundColor: surface, scale: 2, useCORS: true, windowWidth: reportRef.current.scrollWidth })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const pxPerPage = (canvas.width * pageH) / pageW
      let rendered = 0, pageIndex = 0
      while (rendered < canvas.height) {
        const sliceH = Math.min(pxPerPage, canvas.height - rendered)
        const slice = document.createElement('canvas')
        slice.width = canvas.width
        slice.height = sliceH
        slice.getContext('2d').drawImage(canvas, 0, rendered, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
        if (pageIndex > 0) pdf.addPage()
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, (sliceH * pageW) / canvas.width)
        rendered += sliceH
        pageIndex++
      }
      pdf.save(`${data?.scope || 'report'}-${data?.entityName || 'all'}-${data?.period?.start || ''}.pdf`)
    } finally { setExporting(false) }
  }

  const associateDetail = scope === 'associate' && entityId ? (boot?.associates || []).find(a => a.id === entityId) : null

  const c = data?.comparisons
  const cur = c?.current, prev = c?.previousPeriod, yoy = c?.yoy

  return (
    <div className="rp-page">
      {/* ── Controls ─────────────────────────────────────── */}
      <header className="rp-header">
        <div className="rp-header-titles">
          <h2>{title}</h2>
          <p>{desc}</p>
        </div>
        <div className="rp-header-controls">
          <Segmented
            ariaLabel="Report scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'studio', label: 'Studio', icon: Building2 },
              { value: 'associate', label: 'Associate', icon: UserCircle2 }
            ]}
          />
          <select className="input !w-auto" value={entityId} onChange={e => setEntityId(e.target.value)} disabled={locked} title={locked ? 'Agents view their own studio or profile only' : undefined}>
            <option value="">{scope === 'associate' ? 'All associates' : 'All studios'}</option>
            {(data?.entities || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select className="input !w-auto" value={preset} onChange={e => setPreset(e.target.value)} aria-label="Period">
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {preset === 'custom' && (
            <>
              <input type="date" className="input !w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined} aria-label="From" />
              <input type="date" className="input !w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined} aria-label="To" />
            </>
          )}
          <button type="button" className={`rp-btn ${compareOpen ? 'rp-btn-primary' : ''}`} onClick={() => setCompareOpen(o => !o)}>
            <GitCompare size={13} /> Compare
          </button>
          <button type="button" className="rp-btn" onClick={exportCsv} disabled={!data}><Download size={13} /> CSV</button>
          <button type="button" className="rp-btn rp-btn-primary" onClick={exportPdf} disabled={!data || exporting}>
            {exporting ? <Spinner size={12} /> : <FileDown size={13} />} PDF
          </button>
        </div>
      </header>

      <div className="rp-context">
        <CalendarRange size={13} />
        <b>{data?.entityName || '—'}</b>
        <span>·</span>
        <span>{data?.period ? `${data.period.label} (${data.period.start} → ${data.period.end})` : 'Loading period…'}</span>
        <span style={{ marginLeft: 'auto' }} />
        <SavedViews page={page} state={viewState} onApply={applySavedView} onCopyLink={copyLink} />
      </div>

      {compareOpen && (
        <Section title="Compare entities" subtitle="Pick two to four to see them side by side over this period" icon={GitCompare}>
          <div className="rp-views" style={{ marginBottom: 12 }}>
            {(data?.entities || []).map(e => {
              const on = compareIds.includes(e.id)
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`rp-series-toggle ${on ? '' : 'is-off'}`}
                  onClick={() => setCompareIds(ids => on ? ids.filter(i => i !== e.id) : (ids.length >= 4 ? ids : [...ids, e.id]))}
                >
                  <span className="rp-swatch" style={{ background: on ? seriesColor(compareIds.indexOf(e.id), mode) : 'transparent' }} />
                  {e.name}
                </button>
              )
            })}
          </div>
          {compareIds.length < 2 && <p className="rp-empty">Select at least two {scope === 'associate' ? 'associates' : 'studios'}.</p>}
          {compareData?.columns?.length >= 2 && <CompareColumns columns={compareData.columns} mode={mode} />}
        </Section>
      )}

      {loading && <div className="rp-loading"><Spinner size={22} /></div>}

      {!loading && error && (
        <Section title="This report could not be loaded" icon={AlertTriangle}>
          <p className="rp-empty">{error.message || 'The report request failed.'}</p>
        </Section>
      )}

      {!loading && data && (
        <div className="rp-page" style={{ padding: 0 }} ref={reportRef}>
          {/* ── What changed, in words ───────────────────── */}
          {!!data.insights?.length && <InsightList insights={data.insights} />}

          {associateDetail && (
            <Section title={associateDetail.name} subtitle={associateDetail.role || 'Sales associate'} icon={UserCircle2}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <Avatar name={associateDetail.name} color={associateDetail.color} photoUrl={associateDetail.photoUrl} photoZoom={associateDetail.photoZoom} photoPosX={associateDetail.photoPosX} photoPosY={associateDetail.photoPosY} size={64} fallback="👤" />
                <div className="rp-context" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  {associateDetail.email && <span>{associateDetail.email}</span>}
                  <span><b>{num(cur.leadsReceived)}</b> leads received · <b>{num(cur.converted)}</b> won · <b>{money(cur.revenue)}</b> revenue</span>
                </div>
              </div>
            </Section>
          )}

          {/* ── Headline ─────────────────────────────────── */}
          <Section
            title="This period"
            subtitle="Against the previous period; click any tile for the leads behind it"
            icon={Gauge}
            className="is-flush"
            actions={<span className="rp-bar-sub">Last year: {num(yoy.leadsReceived)} leads · {yoy.conversionRate}% conv.</span>}
          >
            <TileGrid cols={6}>
              <StatTile
                icon={Users} label="Leads received" value={num(cur.leadsReceived)}
                delta={pctChange(cur.leadsReceived, prev.leadsReceived)}
                sub={`prev ${num(prev.leadsReceived)}`}
                onClick={() => openDrill({ dateField: 'createdAt' }, 'Leads received this period')}
              />
              <StatTile
                icon={Target} label="Trials scheduled" value={num(cur.trialsScheduled)}
                delta={pctChange(cur.trialsScheduled, prev.trialsScheduled)}
                sub={`prev ${num(prev.trialsScheduled)}`}
              />
              <StatTile
                icon={CheckCircle2} label="Trials completed" value={num(cur.trialsCompleted)}
                delta={pctChange(cur.trialsCompleted, prev.trialsCompleted)}
                sub={`prev ${num(prev.trialsCompleted)}`}
              />
              <StatTile
                icon={Trophy} label="Converted" value={num(cur.converted)}
                delta={pctChange(cur.converted, prev.converted)}
                sub={`prev ${num(prev.converted)}`}
                onClick={() => openDrill({ status: 'won', dateField: 'convertedAt', sortBy: 'value' }, 'Leads won this period')}
              />
              <StatTile
                icon={TrendingUp} label="Conversion" value={`${cur.conversionRate}%`}
                delta={cur.conversionRate - prev.conversionRate} deltaUnit="pt"
                sub={`prev ${prev.conversionRate}%`}
                tone={cur.conversionRate >= prev.conversionRate ? 'good' : undefined}
              />
              <StatTile
                icon={IndianRupee} label="Revenue" value={money(cur.revenue)}
                delta={pctChange(cur.revenue, prev.revenue)}
                sub={`avg deal ${money(cur.ltv)}`}
              />
            </TileGrid>
          </Section>

          {/* ── Trend ────────────────────────────────────── */}
          {data.trend.length > 0 && (
            <Section title="Trend" subtitle="Recent periods of the same length" icon={TrendingUp}>
              <ChartFrame
                data={data.trend}
                xKey="periodLabel"
                series={TREND_SERIES}
                defaultType="area"
                height={250}
                valueFormat={(v, key) => key === 'revenue' ? money(v) : num(v)}
              />
            </Section>
          )}

          <div className="rp-grid-2">
            {/* ── Funnel ─────────────────────────────────── */}
            <Section title="Funnel" subtitle="Leads created in this period, by where they stand now" icon={Layers} className="is-flush">
              <TileGrid cols={4}>
                {['new', 'trial', 'won', 'lost'].map((k, i) => (
                  <StatTile
                    key={k}
                    label={k}
                    value={num(data.funnel[k])}
                    sub={cur.leadsReceived ? `${Math.round((data.funnel[k] / cur.leadsReceived) * 100)}% of intake` : undefined}
                    tone={k === 'won' ? 'good' : k === 'lost' ? 'bad' : undefined}
                    onClick={k === 'won' || k === 'lost' ? () => openDrill({ status: k }, `${k === 'won' ? 'Won' : 'Lost'} leads from this period`) : undefined}
                  />
                ))}
              </TileGrid>
            </Section>

            {/* ── Speed ──────────────────────────────────── */}
            <Section title="Speed" subtitle="How long the funnel actually takes" icon={Timer} className="is-flush">
              <TileGrid cols={4}>
                <StatTile label="Median days to win" value={data.velocity.medianDaysToWin} sub={`avg ${data.velocity.avgDaysToWin}`} />
                <StatTile label="Median first touch" value={`${data.velocity.medianDaysToFirstTouch}d`} sub={`avg ${data.velocity.avgDaysToFirstTouch}d`} tone={data.velocity.medianDaysToFirstTouch > 2 ? 'warn' : 'good'} />
                <StatTile label="Never contacted" value={num(data.velocity.untouchedLeads)} sub={`of ${num(cur.leadsReceived)} received`} tone={data.velocity.untouchedLeads ? 'bad' : 'good'} />
                <StatTile label="Touches per win" value={data.velocity.avgTouchesToWin} sub={`${num(data.velocity.wonCount)} wins`} />
              </TileGrid>
            </Section>
          </div>

          {/* ── Rankings ─────────────────────────────────── */}
          {scope === 'studio' && data.rankings.length > 0 && (
            <Section
              title="Associate rankings"
              subtitle="Sort by any column; rank movement is against the previous period"
              icon={ListOrdered}
              className="is-flush"
            >
              <RankTable
                rankKey
                rows={data.rankings}
                initialSort={{ key: 'revenue', dir: 'desc' }}
                onRowClick={(row) => openDrill({ associateId: row.associateId }, `Leads owned by ${row.name}`)}
                columns={[
                  {
                    key: 'name', label: 'Associate', sortable: true,
                    format: (v, row) => (
                      <>
                        <span style={{ fontWeight: 620, color: 'var(--text)' }}>{v}</span>
                        {row.rankDelta ? (
                          <span className={`rp-rank-delta ${row.rankDelta > 0 ? 'is-up' : 'is-down'}`}>
                            {row.rankDelta > 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{Math.abs(row.rankDelta)}
                          </span>
                        ) : null}
                      </>
                    )
                  },
                  { key: 'newLeads', label: 'Leads', align: 'right', format: num },
                  { key: 'trials', label: 'Trials', align: 'right', format: num },
                  { key: 'won', label: 'Won', align: 'right', format: num },
                  { key: 'conversionRate', label: 'Conv.', align: 'right', format: v => `${v}%` },
                  { key: 'revenue', label: 'Revenue', align: 'right', tone: 'strong', format: v => money(v) },
                  { key: 'revenuePerLead', label: 'Per lead', align: 'right', format: v => money(v) },
                  { key: 'followUpRate', label: 'Follow-up', align: 'right', tone: row => row.followUpRate >= 80 ? 'good' : row.followUpRate >= 50 ? 'warn' : 'bad', format: v => `${v}%` }
                ]}
              />
            </Section>
          )}

          <div className="rp-grid-2">
            {/* ── Source return ──────────────────────────── */}
            <Section title="Source return" subtitle="Revenue per lead, not just volume" icon={Radio} className="is-flush">
              <RankTable
                rows={data.sourceRoi}
                initialSort={{ key: 'revenue', dir: 'desc' }}
                onRowClick={(row) => openDrill({ source: row.source }, `Leads from ${row.source}`)}
                columns={[
                  { key: 'source', label: 'Source' },
                  { key: 'leads', label: 'Leads', align: 'right', format: num },
                  { key: 'won', label: 'Won', align: 'right', format: num },
                  { key: 'winRate', label: 'Win %', align: 'right', tone: row => row.winRate >= (cur.conversionRate || 0) ? 'good' : 'warn', format: v => `${v}%` },
                  { key: 'revenuePerLead', label: 'Per lead', align: 'right', tone: 'strong', format: v => money(v) },
                  { key: 'revenue', label: 'Revenue', align: 'right', format: v => money(v) }
                ]}
                emptyText="No leads arrived in this period."
              />
            </Section>

            {/* ── Stage breakdown ────────────────────────── */}
            <Section title="Leads by stage" subtitle="Intake cohort, by the stage they sit in" icon={Layers} className="is-flush">
              <RankTable
                rows={data.stageBreakdown.rows}
                initialSort={{ key: 'leadsReceived', dir: 'desc' }}
                onRowClick={(row) => openDrill({ stage: row.key }, `Leads in ${row.key}`)}
                columns={[
                  { key: 'key', label: 'Stage' },
                  { key: 'leadsReceived', label: 'Received', align: 'right', format: num },
                  { key: 'trialsScheduled', label: 'Scheduled', align: 'right', format: num },
                  { key: 'trialsCompleted', label: 'Completed', align: 'right', format: num },
                  { key: 'converted', label: 'Won', align: 'right', tone: 'good', format: num },
                  { key: 'conversionRate', label: 'Conv.', align: 'right', format: v => `${v}%` }
                ]}
              />
            </Section>
          </div>

          <div className="rp-grid-2">
            {/* ── Ageing ─────────────────────────────────── */}
            <Section
              title="Open pipeline by age"
              subtitle={`${num(data.ageing.openCount)} open leads right now — point in time, not period-filtered`}
              icon={AlertTriangle}
            >
              <MagnitudeBars
                rows={data.ageing.buckets.map((b, i) => ({
                  key: b.key,
                  label: b.label,
                  value: b.count,
                  sub: money(b.value),
                  color: i >= 2 ? statusColor(i === 3 ? 'critical' : 'warning', mode) : seriesColor(0, mode)
                }))}
                onRowClick={(row) => openDrill({ ageBucket: row.key, status: 'open', dateField: 'none', sortBy: 'value' }, `Open leads ${row.label} old`)}
                format={num}
              />
              {data.ageing.oldest && (
                <p className="rp-bar-sub" style={{ marginTop: 10 }}>
                  Oldest open lead: <button type="button" className="rp-link-btn" onClick={() => openLead(data.ageing.oldest.id)}>{data.ageing.oldest.name}</button> — {data.ageing.oldest.ageDays} days in {data.ageing.oldest.stage || 'no stage'}.
                </p>
              )}
            </Section>

            {/* ── Follow-up health ───────────────────────── */}
            <Section title="Follow-up discipline" subtitle="Scheduled inside this period" icon={CheckCircle2} className="is-flush">
              <TileGrid cols={2}>
                <StatTile label="Logged" value={num(data.followUpHealth.logged)} sub={`${num(data.followUpHealth.done)} completed`} />
                <StatTile
                  label="Completion" value={`${data.followUpHealth.completionRate}%`}
                  tone={data.followUpHealth.completionRate >= 80 ? 'good' : data.followUpHealth.completionRate >= 50 ? 'warn' : 'bad'}
                  sub={`${num(data.followUpHealth.missed)} missed`}
                />
                <StatTile label="Past due" value={num(data.followUpHealth.overdue)} tone={data.followUpHealth.overdue ? 'bad' : 'good'} sub="on open leads" />
                <StatTile label="Never followed up" value={num(data.followUpHealth.leadsWithNoFollowUp)} sub={`avg ${data.followUpHealth.avgPerLead} per lead`} tone={data.followUpHealth.leadsWithNoFollowUp ? 'warn' : 'good'} />
              </TileGrid>
            </Section>
          </div>

          {/* ── Named leads ──────────────────────────────── */}
          <Section
            title="The leads behind the numbers"
            subtitle="Click any row to open the lead"
            icon={Flame}
            className="is-flush"
            actions={
              <Segmented
                size="sm"
                ariaLabel="Lead list"
                value={topTab}
                onChange={setTopTab}
                options={[
                  { value: 'wins', label: `Biggest wins (${data.topLeads.wins.length})` },
                  { value: 'openDeals', label: `Open pipeline (${data.topLeads.openDeals.length})` },
                  { value: 'losses', label: `Lost (${data.topLeads.losses.length})` }
                ]}
              />
            }
          >
            <RankTable
              rows={data.topLeads[topTab] || []}
              initialSort={{ key: 'value', dir: 'desc' }}
              onRowClick={(row) => openLead(row.id)}
              emptyText="Nothing in this bucket for the period."
              columns={[
                { key: 'fullName', label: 'Lead', tone: 'strong' },
                { key: 'stage', label: 'Stage', format: v => <span className="rp-pill">{v || '—'}</span>, sortable: false },
                { key: 'source', label: 'Source' },
                { key: 'value', label: 'Value', align: 'right', tone: 'strong', format: v => v ? money(v) : '—' },
                ...(topTab === 'wins'
                  ? [{ key: 'daysToWin', label: 'Days to win', align: 'right', format: v => `${v}d` }]
                  : topTab === 'openDeals'
                    ? [{ key: 'ageDays', label: 'Age', align: 'right', tone: row => row.ageDays > 60 ? 'bad' : row.ageDays > 30 ? 'warn' : undefined, format: v => `${v}d` }]
                    : [{ key: 'createdAt', label: 'Created', align: 'right', format: v => fmtDate(v) }])
              ]}
            />
          </Section>

          <div className="rp-grid-2">
            {/* ── Weekday pattern ────────────────────────── */}
            <Section title="Intake by weekday" subtitle="Arrivals and wins by the day the lead came in" icon={CalendarDays}>
              <ChartFrame
                data={data.weekdayPattern}
                xKey="label"
                defaultType="bar"
                height={200}
                series={[{ key: 'leads', label: 'Leads' }, { key: 'won', label: 'Won' }]}
                valueFormat={num}
                onPointClick={(label) => {
                  const index = data.weekdayPattern.findIndex(r => r.label === label)
                  if (index >= 0) openDrill({ weekday: String(index) }, `Leads that arrived on a ${label}`)
                }}
              />
            </Section>

            {/* ── Revenue mix ────────────────────────────── */}
            <Section title="Revenue by class type" subtitle="Won revenue in this period" icon={PieIcon}>
              <MagnitudeBars
                rows={data.revenueMix.slice(0, 8).map((r, i) => ({
                  key: r.type, label: r.type, value: r.revenue,
                  sub: `${num(r.count)} leads · ${r.wonRate}% won`,
                  color: seriesColor(i, mode)
                }))}
                onRowClick={(row) => openDrill({ classType: row.key }, `Leads on ${row.label}`)}
                format={money}
                emptyText="No won revenue in this period."
              />
            </Section>
          </div>

          <div className="rp-grid-2">
            {/* ── Cohorts ────────────────────────────────── */}
            <Section title="Cohort conversion" subtitle="Share of each cohort won by 1, 2 and 4 periods later" icon={Sparkles} className="is-flush">
              <RankTable
                rows={data.cohortConversion.map(r => ({ ...r, id: r.cohortLabel }))}
                initialSort={{ key: 'cohortLabel', dir: 'asc' }}
                columns={[
                  { key: 'cohortLabel', label: 'Cohort', tone: 'strong' },
                  { key: 'size', label: 'Size', align: 'right', format: num },
                  { key: 'convertedByP1', label: 'By P+1', align: 'right', format: v => `${v}%` },
                  { key: 'convertedByP2', label: 'By P+2', align: 'right', format: v => `${v}%` },
                  { key: 'convertedByP4', label: 'By P+4', align: 'right', tone: 'good', format: v => `${v}%` }
                ]}
              />
            </Section>

            {/* ── Targets ────────────────────────────────── */}
            <Section title="Revenue targets" subtitle="Pro-rated to this period" icon={Wallet} className="is-flush">
              <RankTable
                rows={(data.goals?.perAssociate || []).filter(a => a.target > 0 || a.actual > 0).map(a => ({ ...a, id: a.associateId }))}
                initialSort={{ key: 'attainmentPct', dir: 'desc' }}
                onRowClick={(row) => openDrill({ associateId: row.associateId, status: 'won', dateField: 'convertedAt', sortBy: 'value' }, `Wins by ${row.name}`)}
                emptyText="No revenue targets are set for these associates."
                columns={[
                  { key: 'name', label: 'Associate', tone: 'strong' },
                  { key: 'target', label: 'Target', align: 'right', format: v => money(v) },
                  { key: 'actual', label: 'Actual', align: 'right', format: v => money(v) },
                  {
                    key: 'attainmentPct', label: 'Attainment', align: 'right',
                    tone: row => row.attainmentPct >= 100 ? 'good' : row.attainmentPct >= 70 ? 'warn' : 'bad',
                    format: v => `${v}%`
                  }
                ]}
              />
            </Section>
          </div>

          {/* ── Lost analysis ────────────────────────────── */}
          {!!data.lostBySource?.length && (
            <Section title="Where leads are lost" subtitle="Lost leads in this period, by source" icon={AlertTriangle}>
              <MagnitudeBars
                rows={data.lostBySource.slice(0, 8).map(r => ({
                  key: r.source, label: r.source, value: r.count,
                  sub: `${money(r.lostValue)} of estimated value`,
                  color: statusColor('critical', mode)
                }))}
                onRowClick={(row) => openDrill({ source: row.key, status: 'lost' }, `Lost leads from ${row.label}`)}
                format={num}
              />
            </Section>
          )}

          {/* ── Three-column comparison, kept as the audit trail ── */}
          <Section title="Period comparison" subtitle="Every headline metric across the three windows" icon={GitCompare} className="is-flush">
            <div className="rp-table-wrap">
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className="is-right">{cur.label}</th>
                    <th className="is-right">Previous period</th>
                    <th className="is-right">Same period last year</th>
                    <th className="is-right">vs prev</th>
                    <th className="is-right">vs last year</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Leads received', 'leadsReceived', num],
                    ['Trials scheduled', 'trialsScheduled', num],
                    ['Trials completed', 'trialsCompleted', num],
                    ['Converted', 'converted', num],
                    ['Conversion rate', 'conversionRate', v => `${v}%`],
                    ['Revenue', 'revenue', money],
                    ['Avg deal value', 'ltv', money],
                    ['Follow-up completion', 'followUpRate', v => `${v}%`]
                  ].map(([label, key, format]) => (
                    <tr key={key}>
                      <td data-tone="strong">{label}</td>
                      <td className="is-right rp-num">{format(cur[key])}</td>
                      <td className="is-right rp-num rp-dim">{format(prev[key])}</td>
                      <td className="is-right rp-num rp-dim">{format(yoy[key])}</td>
                      <td className="is-right"><Delta value={key.includes('Rate') ? cur[key] - prev[key] : pctChange(cur[key], prev[key])} unit={key.includes('Rate') ? 'pt' : '%'} suffix="" /></td>
                      <td className="is-right"><Delta value={key.includes('Rate') ? cur[key] - yoy[key] : pctChange(cur[key], yoy[key])} unit={key.includes('Rate') ? 'pt' : '%'} suffix="" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      {drill && (
        <DrillPanel
          drill={drill}
          data={drillData}
          loading={drillLoading}
          onClose={() => setDrill(null)}
          onOpenLead={openLead}
          onExport={exportDrillCsv}
        />
      )}
    </div>
  )
}

/* ── Horizontal magnitude list ───────────────────────────────
   A bar chart drawn in HTML rather than SVG: the rows are also the click
   targets for the drill-down, and they stay readable at any panel width,
   which a recharts vertical bar chart at 300px does not. */
function MagnitudeBars({ rows, format = String, onRowClick, emptyText = 'Nothing to show.' }) {
  const max = Math.max(1, ...rows.map(r => r.value || 0))
  if (!rows.length) return <p className="rp-empty">{emptyText}</p>
  return (
    <div className="rp-bars">
      {rows.map(r => {
        const Row = onRowClick ? 'button' : 'div'
        return (
          <Row
            key={r.key}
            type={onRowClick ? 'button' : undefined}
            className={`rp-bar-row ${onRowClick ? 'is-clickable' : ''}`}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
          >
            <span className="rp-bar-label" title={r.label}>{r.label}</span>
            <span className="rp-bar-track">
              <span className="rp-bar-fill" style={{ width: `${Math.max(2, ((r.value || 0) / max) * 100)}%`, background: r.color }} />
            </span>
            <span className="rp-bar-value">
              {format(r.value)}
              {r.sub && <span className="rp-bar-sub" style={{ display: 'block' }}>{r.sub}</span>}
            </span>
          </Row>
        )
      })}
    </div>
  )
}

/* ── Side-by-side comparison ─────────────────────────────── */
function CompareColumns({ columns, mode }) {
  const rows = [
    ['Leads received', c => c.current.leadsReceived, v => Number(v).toLocaleString('en-IN'), 'high'],
    ['Converted', c => c.current.converted, v => Number(v).toLocaleString('en-IN'), 'high'],
    ['Conversion rate', c => c.current.conversionRate, v => `${v}%`, 'high'],
    ['Revenue', c => c.current.revenue, v => money(v), 'high'],
    ['Avg deal', c => c.current.ltv, v => money(v), 'high'],
    ['Follow-up completion', c => c.current.followUpRate, v => `${v}%`, 'high'],
    ['Median days to win', c => c.velocity.medianDaysToWin, v => `${v}d`, 'low'],
    ['Never contacted', c => c.velocity.untouchedLeads, v => Number(v).toLocaleString('en-IN'), 'low']
  ]
  return (
    <div className="rp-compare">
      {columns.map((col, i) => (
        <div key={col.id} className="rp-compare-col">
          <header>
            <span className="rp-swatch" style={{ background: seriesColor(i, mode) }} />
            <strong>{col.name}</strong>
          </header>
          {rows.map(([label, get, format, better]) => {
            const value = get(col)
            const all = columns.map(get)
            const best = better === 'high' ? Math.max(...all) : Math.min(...all)
            const isBest = columns.length > 1 && value === best && all.some(v => v !== best)
            return (
              <div key={label} className="rp-compare-metric">
                <span>{label}</span>
                <b className={isBest ? 'rp-compare-best' : ''}>{format(value)}</b>
              </div>
            )
          })}
          {!!col.topSources.length && (
            <p className="rp-bar-sub" style={{ marginTop: 10 }}>
              Top source: <b style={{ color: 'var(--text-dim)' }}>{col.topSources[0].source}</b> — {money(col.topSources[0].revenue)} from {col.topSources[0].leads} leads.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
