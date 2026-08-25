import React from 'react'
import {
  Trophy, Target, Users, IndianRupee, CalendarCheck2,
  AlertTriangle, MapPin, X, MessageCircle, Phone, MoreHorizontal
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { Modal, normalizePhotoUrl } from '../ui.jsx'
import { money } from '../lib.js'

const tooltipStyle = {
  background: 'var(--scorecard-tooltip-bg)', border: '1px solid var(--scorecard-line)', borderRadius: 6,
  fontSize: 12, color: 'var(--scorecard-text)', boxShadow: '0 10px 28px rgba(0,0,0,.16)'
}
const AXIS = { fill: 'var(--scorecard-muted)', fontSize: 10.5 }

export default function AssociateScorecardModal({ associateId, onClose, openLead }) {
  const { data, loading, error } = useFetch(
    () => associateId ? api.get(`/api/analytics/associate/${associateId}/scorecard`) : Promise.resolve(null),
    [associateId]
  )

  return (
    <Modal open={!!associateId} onClose={onClose} width={1040}>
      {loading && <div className="py-14 text-center text-slate-500">Loading scorecard…</div>}
      {error && <div className="py-14 text-center text-rose-400 text-[13px]">{error.message}</div>}
      {!loading && data && (
        <div className="associate-scorecard">
          <section className="associate-scorecard-hero">
            <AssociatePortrait associate={data.associate} />
            <div className="associate-scorecard-hero-content">
              <button type="button" className="associate-scorecard-close" onClick={onClose} aria-label="Close associate scorecard"><X size={17} /></button>
              <div className="associate-scorecard-identity">
                <span className="associate-scorecard-eyebrow">Associate performance</span>
                <h2>{data.associate.name}</h2>
                <div className="associate-scorecard-location"><MapPin size={12} />{data.associate.locationName || 'No studio'}<span className={`associate-scorecard-status ${data.associate.active ? 'is-active' : 'is-inactive'}`}>{data.associate.active ? 'Active' : 'Inactive'}</span><span>Associate report</span></div>
                <div className="associate-scorecard-actions" aria-label="Associate contact actions">
                  <button type="button"><MessageCircle size={13} /> Message</button>
                  <button type="button"><Phone size={13} /> Call</button>
                  <button type="button" aria-label="More associate actions"><MoreHorizontal size={14} /></button>
                </div>
              </div>
              <div className="associate-scorecard-monthly">
              <MiniStat label="Monthly revenue" value={money(data.thisMonth.revenue)} sub={`${money(data.thisMonth.revenueTarget)} target`} color={attainmentColor(data.thisMonth.attainmentPct)} />
              <MiniStat label="Revenue attainment" value={`${data.thisMonth.attainmentPct}%`} sub={`${data.thisMonth.won} wins this month`} color={attainmentColor(data.thisMonth.attainmentPct)} />
              <MiniStat label="Avg AI score" value={data.totals.avgScore} sub={`${data.totals.hot} hot leads`} color="#a78bfa" />
              </div>
            </div>
          </section>

          <div className="associate-scorecard-kpis">
            <StatCard icon={<Users size={14} />} label="Total leads" value={data.totals.total} color="#8b5cf6" />
            <StatCard icon={<Target size={14} />} label="Open" value={data.totals.open} color="#3b82f6" />
            <StatCard icon={<Trophy size={14} />} label="Won" value={data.totals.won} sub={`${data.totals.conversion}% conversion`} color="#10b981" />
            <StatCard icon={<IndianRupee size={14} />} label="Revenue" value={money(data.totals.revenue)} sub={`avg ${money(data.totals.avgDealValue)}`} color="#f43f5e" />
          </div>

          <div className="associate-scorecard-grid">
            <div className="associate-scorecard-section associate-scorecard-chart">
              <h3 className="font-display font-semibold text-white text-[13px] mb-2">6-month trend</h3>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.history} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="var(--scorecard-grid-line)" vertical={false} />
                    <XAxis dataKey="periodLabel" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="newLeads" name="New leads" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="won" name="Won" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <PerformanceComparison data={data} />
          </div>

          <div className="associate-scorecard-grid">
            <div className="associate-scorecard-section associate-scorecard-chart">
              <h3 className="font-display font-semibold text-white text-[13px] mb-2">Monthly revenue</h3>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.history} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="var(--scorecard-grid-line)" vertical={false} />
                    <XAxis dataKey="periodLabel" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} tickFormatter={compactMoney} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={value => money(value)} />
                    <Bar dataKey="revenue" name="Revenue" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="associate-scorecard-section overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/8 text-[12px] font-semibold text-slate-200 flex items-center gap-2"><CalendarCheck2 size={13} className="text-amber-400" /> Follow-up health</div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <StatCard icon={<CalendarCheck2 size={13} />} label="Completion" value={`${data.followUpHealth.completionRate}%`} color="#fbbf24" />
                <StatCard icon={<AlertTriangle size={13} />} label="Overdue" value={data.followUpHealth.overdueCount} color="#f43f5e" />
                <StatCard icon={<Users size={13} />} label="Total logged" value={data.followUpHealth.total} color="#3b82f6" />
                <StatCard icon={<AlertTriangle size={13} />} label="Missed" value={data.followUpHealth.missed} color="#f59e0b" />
              </div>
            </div>
          </div>

          <div className="associate-scorecard-grid">
            <BreakdownTable title="Source breakdown" rows={data.sourceBreakdown} labelKey="source" />
            <BreakdownTable title="Open pipeline by stage" rows={data.stageBreakdown} labelKey="stage" countOnly />
          </div>

          <div className="associate-scorecard-grid">
            <ActivityList title="Recent new leads" items={data.recentNew} openLead={openLead} onClose={onClose}
              render={l => <><span className="truncate">{l.fullName}</span><span className="chip !px-1.5 !py-0.5 text-[9px] bg-white/5 border border-white/10 text-slate-400 shrink-0">{l.stage}</span></>} />
            <ActivityList title="Recent wins" items={data.recentWon} openLead={openLead} onClose={onClose}
              render={l => <><span className="truncate">{l.fullName}</span><span className="mono text-emerald-400 shrink-0">{money(l.revenue)}</span></>} />
          </div>
        </div>
      )}
    </Modal>
  )
}

function AssociatePortrait({ associate }) {
  const [broken, setBroken] = React.useState(false)
  const src = normalizePhotoUrl(associate.photoUrl)
  React.useEffect(() => setBroken(false), [src])
  const zoom = Number(associate.photoZoom) > 0 ? Number(associate.photoZoom) : 100
  const posX = associate.photoPosX != null ? Number(associate.photoPosX) : 50
  const posY = associate.photoPosY != null ? Number(associate.photoPosY) : 50
  return (
    <div className="associate-scorecard-portrait">
      {src && !broken ? (
        <img src={src} alt={dataSafeName(associate.name)} style={{ objectPosition: `${posX}% ${posY}%`, transform: `scale(${zoom / 100})`, transformOrigin: `${posX}% ${posY}%` }} onError={() => setBroken(true)} />
      ) : <span role="img" aria-label="No associate photograph">👤</span>}
    </div>
  )
}

function dataSafeName(name) {
  return `${name || 'Associate'} portrait`
}

function attainmentColor(pct) {
  if (pct < 60) return '#f43f5e'
  if (pct < 90) return '#f59e0b'
  return '#10b981'
}

function compactMoney(value) {
  const amount = Number(value) || 0
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`
  if (amount >= 1000) return `₹${Math.round(amount / 1000)}K`
  return `₹${amount}`
}

function PerformanceComparison({ data }) {
  const rows = [
    { label: 'Revenue target', actual: data.thisMonth.revenue, target: data.thisMonth.revenueTarget, value: money(data.thisMonth.revenue), targetLabel: money(data.thisMonth.revenueTarget), color: '#0ea5e9' },
    { label: 'Conversion target', actual: data.thisMonth.conversion, target: data.thisMonth.conversionTarget, value: `${data.thisMonth.conversion}%`, targetLabel: `${data.thisMonth.conversionTarget}%`, color: '#10b981' },
    { label: 'Follow-up completion', actual: data.followUpHealth.completionRate, target: 100, value: `${data.followUpHealth.completionRate}%`, targetLabel: '100%', color: '#f59e0b' }
  ]
  return <div className="associate-scorecard-section associate-comparison"><div className="associate-report-heading"><Target size={13} /> Actual vs target</div><div className="associate-comparison-list">{rows.map(row => { const pct = row.target ? Math.min(100, Math.round((row.actual / row.target) * 100)) : 0; return <div key={row.label} className="associate-comparison-row"><div><span>{row.label}</span><strong>{row.value} <small>of {row.targetLabel}</small></strong></div><div className="associate-comparison-track"><i style={{ width: `${pct}%`, background: row.color }} /></div></div> })}</div></div>
}

function MiniStat({ label, value, sub, color }) {
  return (
    <div className="associate-scorecard-mini-stat">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="font-display text-[16px] font-bold mono" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  )
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="associate-scorecard-stat">
      <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider text-slate-500 mb-1.5" style={{ color }}>{icon}{label}</div>
      <div className="font-display text-[16px] font-bold text-white mono">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function BreakdownTable({ title, rows, labelKey, countOnly }) {
  const maxCount = Math.max(1, ...(rows || []).map(row => row.count || 0))
  return (
    <div className="associate-scorecard-section overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/8 text-[12px] font-semibold text-slate-200">{title}</div>
      <div className="max-h-[180px] overflow-y-auto scrollbar-thin">
        {rows?.length ? rows.map(r => (
          <div key={r[labelKey]} className="associate-breakdown-row flex items-center gap-2 px-4 py-1.5 text-[12px] border-b border-white/5 last:border-0">
            <i style={{ width: `${Math.max(3, (r.count / maxCount) * 100)}%` }} />
            <span className="text-slate-300 flex-1 truncate">{r[labelKey]}</span>
            <span className="mono text-slate-400">{r.count}</span>
            {!countOnly && <span className="mono text-emerald-400 text-[10.5px] shrink-0 w-10 text-right">{r.wonRate}%</span>}
          </div>
        )) : <p className="text-[11.5px] text-slate-500 px-4 py-3">No data.</p>}
      </div>
    </div>
  )
}

function ActivityList({ title, items, openLead, onClose, render }) {
  return (
    <div className="associate-scorecard-section overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/8 text-[12px] font-semibold text-slate-200">{title}</div>
      <div className="max-h-[200px] overflow-y-auto scrollbar-thin">
        {items?.length ? items.map(l => (
          <button key={l.id} className="w-full text-left flex items-center gap-2 px-4 py-2 text-[12px] hover:bg-white/[0.04] transition-colors border-b border-white/5 last:border-0"
            onClick={() => { onClose(); openLead(l.id) }}>
            {render(l)}
          </button>
        )) : <p className="text-[11.5px] text-slate-500 px-4 py-3">None yet.</p>}
      </div>
    </div>
  )
}
