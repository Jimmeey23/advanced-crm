// Performance — the funnel over time.
//
// Where the studio/associate report answers "how did this period go", this
// page answers "what is the shape of the last 7 days / 12 months". It shares
// the report kit with those pages, so a stat tile, a table and a chart behave
// the same here as they do there: sortable columns, switchable chart type, a
// table view of every plot, and a row that opens the leads behind it.
import React, { useEffect, useMemo, useState } from 'react'
import {
  Users, Trophy, IndianRupee, CalendarCheck2, CalendarClock, TrendingDown,
  BarChart3, Wallet, SlidersHorizontal, X, ListOrdered, Percent
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { api, buildQuery } from '../api.js'
import { Spinner } from '../ui.jsx'
import { fmtDate, money } from '../lib.js'
import { lifecycle } from '../chartPalette.js'
import {
  Section, StatTile, TileGrid, Segmented, RankTable, ChartFrame,
  SavedViews, pctChange
} from '../components/report/kit.jsx'

const EMPTY_FILTERS = { studio: '', associate: '' }
const num = (n) => Number(n || 0).toLocaleString('en-IN')

export default function Performance() {
  const { openLead, dataVersion, boot, role, locationIds, theme, viewParams, toast } = useApp()
  const mode = theme === 'light' ? 'light' : 'dark'
  const COLORS = lifecycle(mode)

  const [range, setRange] = useState(() => (viewParams.range === 'week' ? 'week' : 'month'))
  const [filters, setFilters] = useState(() => ({
    studio: viewParams.studio || ((role === 'agent' && locationIds[0]) ? locationIds[0] : ''),
    associate: viewParams.associate || ''
  }))
  const [panelOpen, setPanelOpen] = useState(false)
  const [data, setData] = useState(null)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [openBucket, setOpenBucket] = useState(null)
  const [detailTab, setDetailTab] = useState('all')

  useEffect(() => {
    if (role !== 'agent' || !locationIds[0]) return
    setFilters(f => (f.studio === locationIds[0] ? f : { ...f, studio: locationIds[0] }))
  }, [role, locationIds[0]])

  const setF = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }))
  const lockedStudio = role === 'agent' ? locationIds[0] : undefined
  const hasFilters = (filters.studio && filters.studio !== lockedStudio) || filters.associate
  const clearFilters = () => setFilters(lockedStudio ? { ...EMPTY_FILTERS, studio: lockedStudio } : EMPTY_FILTERS)
  const scopeQuery = buildQuery({ range, studio: filters.studio, associate: filters.associate })

  useEffect(() => {
    window.history.replaceState(null, '', `#performance?${new URLSearchParams({ range, ...(filters.studio ? { studio: filters.studio } : {}), ...(filters.associate ? { associate: filters.associate } : {}) })}`)
  }, [range, filters.studio, filters.associate])

  useEffect(() => {
    setLoading(true)
    setOpenBucket(null)
    Promise.all([
      api.get(`/api/analytics/performance?${scopeQuery}`),
      api.get(`/api/analytics/performance/details?${scopeQuery}`)
    ])
      .then(([p, d]) => { setData(p); setDetails(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [scopeQuery, dataVersion])

  const buckets = useMemo(
    () => (data?.buckets || []).map(b => ({
      ...b,
      missed: b.missed || 0,
      lost: b.lost || 0,
      winRate: b.newLeads ? Math.round((b.won / b.newLeads) * 100) : 0,
      avgDeal: b.won ? Math.round(b.revenue / b.won) : 0,
      followUpRate: b.followUps ? Math.round(((b.followUps - (b.missed || 0)) / b.followUps) * 100) : 0
    })),
    [data]
  )

  const t = data?.totals || {}
  const winRate = t.newLeads ? Math.round((t.won / t.newLeads) * 100) : 0
  const avgDeal = t.won ? t.revenue / t.won : 0
  const avgPerLead = t.newLeads ? t.revenue / t.newLeads : 0

  // The best and worst buckets are the two facts a person actually reads off a
  // twelve-bar chart, so they are stated rather than left to be squinted at.
  const nonEmpty = buckets.filter(b => b.newLeads || b.won || b.revenue || b.followUps)
  const bestBy = (fn) => nonEmpty.reduce((best, b) => (best && fn(best) >= fn(b) ? best : b), null)
  const bestNew = bestBy(b => b.newLeads)
  const bestRevenue = bestBy(b => b.revenue)
  const worstFollowUp = nonEmpty.filter(b => b.followUps > 0).reduce((worst, b) => (!worst || b.followUpRate < worst.followUpRate ? b : worst), null)

  const detailFor = (bucket) => details?.buckets?.find(x => x.key === bucket?.key)
  const detailRows = useMemo(() => {
    const det = detailFor(openBucket)
    if (!det) return []
    const list = (value) => Array.isArray(value) ? value : []
    const groups = [
      ['New', 'newLeads'], ['Won', 'won'], ['Lost', 'lost'], ['Missed FU', 'missed']
    ]
    return groups.flatMap(([category, key]) => list(det[key]).filter(Boolean).map((l, i) => ({
      ...l,
      id: `${category}-${l.id || i}`,
      leadId: l.id,
      category,
      associateName: (boot?.associates || []).find(a => a.id === l.associateId)?.name || 'Unassigned',
      centerName: l.center || (boot?.locations || []).find(loc => loc.id === l.locationId)?.name || '—',
      note: l.comments || l.remarks || ''
    })))
  }, [openBucket, details, boot])
  const shownDetailRows = detailTab === 'all' ? detailRows : detailRows.filter(r => r.category === detailTab)

  const viewState = { range, studio: filters.studio, associate: filters.associate }
  const applyView = (state) => {
    setRange(state.range === 'week' ? 'week' : 'month')
    setFilters({ studio: state.studio || '', associate: state.associate || '' })
  }
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast('Link copied') }
    catch (e) { toast('Could not copy the link', 'error') }
  }

  return (
    <div className="rp-page">
      <header className="rp-header">
        <div className="rp-header-titles">
          <h2>Performance</h2>
          <p>Leads, wins, losses, revenue and follow-up discipline across the funnel — click any period to see the leads inside it.</p>
        </div>
        <div className="rp-header-controls">
          <Segmented
            ariaLabel="Range"
            value={range}
            onChange={setRange}
            options={[{ value: 'week', label: 'Last 7 days' }, { value: 'month', label: 'Last 12 months' }]}
          />
          <button type="button" className={`rp-btn ${panelOpen || hasFilters ? 'rp-btn-primary' : ''}`} onClick={() => setPanelOpen(o => !o)}>
            <SlidersHorizontal size={13} /> Filters{hasFilters ? ' · on' : ''}
          </button>
          {hasFilters && <button type="button" className="rp-btn" onClick={clearFilters}><X size={13} /> Clear</button>}
        </div>
      </header>

      <div className="rp-context">
        <BarChart3 size={13} />
        <b>{filters.studio ? (boot?.locations || []).find(l => l.id === filters.studio)?.name : 'All studios'}</b>
        {filters.associate && <><span>·</span><b>{(boot?.associates || []).find(a => a.id === filters.associate)?.name}</b></>}
        <span>·</span>
        <span>{range === 'week' ? 'Last 7 days' : 'Last 12 months'}</span>
        <span style={{ marginLeft: 'auto' }} />
        <SavedViews page="performance" state={viewState} onApply={applyView} onCopyLink={copyLink} />
      </div>

      {panelOpen && (
        <Section title="Filters" icon={SlidersHorizontal}>
          <div className="rp-grid-3">
            <label>
              <span className="rp-tile-label" style={{ display: 'block', marginBottom: 5 }}>Studio</span>
              <select className="input" value={filters.studio} onChange={setF('studio')} disabled={role === 'agent'}>
                <option value="">All studios</option>
                {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label>
              <span className="rp-tile-label" style={{ display: 'block', marginBottom: 5 }}>Associate</span>
              <select className="input" value={filters.associate} onChange={setF('associate')}>
                <option value="">All associates</option>
                {(boot?.associates || []).filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
        </Section>
      )}

      {loading && <div className="rp-loading"><Spinner size={22} /></div>}

      {!loading && data && (
        <>
          <Section title="Totals" subtitle={`Across the ${range === 'week' ? 'last 7 days' : 'last 12 months'}; change is against the same period last year`} icon={BarChart3} className="is-flush">
            <TileGrid cols={6}>
              <StatTile icon={Users} label="New leads" value={num(t.newLeads)} delta={data.yoy?.newLeads} sub={bestNew ? `best ${bestNew.label} (${num(bestNew.newLeads)})` : undefined} />
              <StatTile icon={Trophy} label="Won" value={num(t.won)} delta={data.yoy?.won} sub={`${winRate}% of intake`} tone="good" />
              <StatTile icon={TrendingDown} label="Lost" value={num(t.lost)} delta={data.yoy?.lost} invertDelta sub={`${t.lossRate || 0}% of decided`} tone={t.lost ? 'bad' : undefined} />
              <StatTile icon={IndianRupee} label="Revenue" value={money(t.revenue)} delta={data.yoy?.revenue} sub={bestRevenue ? `best ${bestRevenue.label}` : undefined} />
              <StatTile icon={Wallet} label="Open pipeline" value={money(t.openPipelineValue || 0)} sub="value of leads still open" />
              <StatTile
                icon={CalendarCheck2} label="Follow-up done" value={`${t.followUpRate || 0}%`}
                delta={data.yoy?.followUpRate} deltaUnit="pt"
                tone={(t.followUpRate || 0) >= 80 ? 'good' : (t.followUpRate || 0) >= 50 ? 'warn' : 'bad'}
                sub={worstFollowUp ? `worst ${worstFollowUp.label} (${worstFollowUp.followUpRate}%)` : undefined}
              />
            </TileGrid>
          </Section>

          <div className="rp-grid-2">
            <Section title="Funnel over time" subtitle="Counts per period" icon={BarChart3}>
              <ChartFrame
                data={buckets}
                xKey="label"
                defaultType="bar"
                height={260}
                valueFormat={num}
                series={[
                  { key: 'newLeads', label: 'New leads', color: COLORS.newLeads },
                  { key: 'won', label: 'Won', color: COLORS.won },
                  { key: 'lost', label: 'Lost', color: COLORS.lost },
                  { key: 'missed', label: 'Missed follow-ups', color: COLORS.missed }
                ]}
                onPointClick={(label) => {
                  const bucket = buckets.find(b => b.label === label)
                  if (bucket) { setOpenBucket(bucket); setDetailTab('all') }
                }}
              />
            </Section>

            {/* Revenue plots on its own axis-free chart rather than sharing one
                with counts — a rupee value and a lead count never belong to the
                same y-scale. */}
            <Section title="Revenue over time" subtitle="Won revenue per period" icon={IndianRupee}>
              <ChartFrame
                data={buckets}
                xKey="label"
                defaultType="area"
                height={260}
                valueFormat={money}
                series={[{ key: 'revenue', label: 'Revenue' }]}
              />
            </Section>
          </div>

          <Section title="Conversion and discipline" subtitle="Rates per period, on one scale" icon={Percent}>
            <ChartFrame
              data={buckets}
              xKey="label"
              defaultType="line"
              height={210}
              valueFormat={v => `${v}%`}
              series={[
                { key: 'winRate', label: 'Win rate', color: COLORS.won },
                { key: 'followUpRate', label: 'Follow-up completion', color: COLORS.missed }
              ]}
            />
          </Section>

          <Section
            title="Period breakdown"
            subtitle="Sort by any column; click a period for the leads inside it"
            icon={CalendarClock}
            className="is-flush"
          >
            <RankTable
              rows={buckets}
              initialSort={{ key: 'key', dir: 'asc' }}
              onRowClick={(row) => { setOpenBucket(openBucket?.key === row.key ? null : row); setDetailTab('all') }}
              columns={[
                { key: 'label', label: 'Period', tone: 'strong' },
                { key: 'newLeads', label: 'New', align: 'right', format: num },
                { key: 'won', label: 'Won', align: 'right', tone: 'good', format: num },
                { key: 'lost', label: 'Lost', align: 'right', tone: row => row.lost ? 'bad' : undefined, format: num },
                { key: 'missed', label: 'Missed FU', align: 'right', tone: row => row.missed ? 'warn' : undefined, format: num },
                { key: 'winRate', label: 'Win rate', align: 'right', format: v => `${v}%` },
                { key: 'followUpRate', label: 'FU done', align: 'right', tone: row => row.followUpRate >= 80 ? 'good' : row.followUpRate >= 50 ? 'warn' : 'bad', format: v => `${v}%` },
                { key: 'revenue', label: 'Revenue', align: 'right', tone: 'strong', format: v => money(v) },
                { key: 'avgDeal', label: 'Avg deal', align: 'right', format: v => v ? money(v) : '—' }
              ]}
            />
          </Section>

          {openBucket && (
            <Section
              title={`${openBucket.label} — the leads`}
              subtitle={`${num(openBucket.newLeads)} new · ${num(openBucket.won)} won · ${num(openBucket.lost)} lost · ${num(openBucket.missed)} missed follow-ups`}
              icon={ListOrdered}
              className="is-flush"
              actions={
                <>
                  <Segmented
                    size="sm"
                    ariaLabel="Lead category"
                    value={detailTab}
                    onChange={setDetailTab}
                    options={[
                      { value: 'all', label: `All (${detailRows.length})` },
                      { value: 'New', label: 'New' },
                      { value: 'Won', label: 'Won' },
                      { value: 'Lost', label: 'Lost' },
                      { value: 'Missed FU', label: 'Missed' }
                    ]}
                  />
                  <button type="button" className="rp-icon-btn" onClick={() => setOpenBucket(null)} aria-label="Close period detail"><X size={14} /></button>
                </>
              }
            >
              <RankTable
                rows={shownDetailRows}
                initialSort={{ key: 'createdAt', dir: 'desc' }}
                onRowClick={(row) => row.leadId && openLead(row.leadId)}
                emptyText="No lead records in this period."
                maxHeight={420}
                columns={[
                  { key: 'category', label: 'Bucket', format: v => <span className="rp-pill">{v}</span> },
                  { key: 'fullName', label: 'Lead', tone: 'strong', format: (v, row) => (<><span className="rp-lead-name">{v || '—'}</span><span className="rp-lead-remark">{row.stage || 'No stage'}</span></>) },
                  { key: 'associateName', label: 'Owner' },
                  { key: 'sourceName', label: 'Source', format: v => v || '—' },
                  { key: 'centerName', label: 'Studio' },
                  { key: 'classType', label: 'Class type', format: v => v || '—' },
                  { key: 'note', label: 'Remark', format: v => <span className="rp-lead-remark" title={v}>{v || '—'}</span>, sortable: false },
                  { key: 'value', label: 'Value', align: 'right', format: v => v ? money(v) : '—' },
                  { key: 'createdAt', label: 'Created', align: 'right', format: v => fmtDate(v) }
                ]}
              />
            </Section>
          )}

          <p className="rp-bar-sub">Averages this period: {money(avgDeal)} per won deal, {money(avgPerLead)} per lead received. Refreshes automatically when leads change.</p>
        </>
      )}
    </div>
  )
}
