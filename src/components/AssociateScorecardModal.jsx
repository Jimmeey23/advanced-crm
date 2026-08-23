import React from 'react'
import {
  Trophy, Target, Users, IndianRupee, CalendarCheck2,
  AlertTriangle, MapPin
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { Modal, ModalHeader, Avatar } from '../ui.jsx'
import { money } from '../lib.js'

const tooltipStyle = {
  background: '#ffffff', border: '1px solid rgba(15,23,42,0.12)', borderRadius: 14,
  fontSize: 12, color: '#0f172a', boxShadow: '0 16px 38px rgba(15,23,42,.12)'
}
const AXIS = { fill: '#5b6278', fontSize: 10.5 }

export default function AssociateScorecardModal({ associateId, onClose, openLead }) {
  const { data, loading, error } = useFetch(
    () => associateId ? api.get(`/api/analytics/associate/${associateId}/scorecard`) : Promise.resolve(null),
    [associateId]
  )

  return (
    <Modal open={!!associateId} onClose={onClose} width={860}>
      {loading && <div className="py-14 text-center text-slate-500">Loading scorecard…</div>}
      {error && <div className="py-14 text-center text-rose-400 text-[13px]">{error.message}</div>}
      {!loading && data && (
        <>
          <ModalHeader
            title={data.associate.name}
            subtitle={<span className="flex items-center gap-1.5"><MapPin size={11} />{data.associate.locationName || 'No studio'}{!data.associate.active && <span className="chip !ml-2 !px-1.5 !py-0.5 text-[9px] bg-rose-500/10 text-rose-400 border border-rose-400/20">inactive</span>}</span>}
            onClose={onClose}
          />

          <div className="flex items-center gap-3 mb-4">
            <Avatar name={data.associate.name} color={data.associate.color} size={44} />
            <div className="flex-1 grid grid-cols-3 gap-2">
              <MiniStat label="This month" value={`${data.thisMonth.won} / ${data.thisMonth.target}`} sub="won vs target" color={attainmentColor(data.thisMonth.attainmentPct)} />
              <MiniStat label="Attainment" value={`${data.thisMonth.attainmentPct}%`} sub={`${data.thisMonth.newLeads} new this month`} color={attainmentColor(data.thisMonth.attainmentPct)} />
              <MiniStat label="Avg AI score" value={data.totals.avgScore} sub={`${data.totals.hot} hot leads`} color="#a78bfa" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard icon={<Users size={14} />} label="Total leads" value={data.totals.total} color="#8b5cf6" />
            <StatCard icon={<Target size={14} />} label="Open" value={data.totals.open} color="#3b82f6" />
            <StatCard icon={<Trophy size={14} />} label="Won" value={data.totals.won} sub={`${data.totals.conversion}% conversion`} color="#10b981" />
            <StatCard icon={<IndianRupee size={14} />} label="Revenue" value={money(data.totals.revenue)} sub={`avg ${money(data.totals.avgDealValue)}`} color="#f43f5e" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="card p-4">
              <h3 className="font-display font-semibold text-white text-[13px] mb-2">6-month trend</h3>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.history} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="periodLabel" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="newLeads" name="New leads" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="won" name="Won" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/8 text-[12px] font-semibold text-slate-200 flex items-center gap-2">
                <CalendarCheck2 size={13} className="text-amber-400" /> Follow-up health
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <StatCard icon={<CalendarCheck2 size={13} />} label="Completion" value={`${data.followUpHealth.completionRate}%`} color="#fbbf24" />
                <StatCard icon={<AlertTriangle size={13} />} label="Overdue" value={data.followUpHealth.overdueCount} color="#f43f5e" />
                <StatCard icon={<Users size={13} />} label="Total logged" value={data.followUpHealth.total} color="#3b82f6" />
                <StatCard icon={<AlertTriangle size={13} />} label="Missed" value={data.followUpHealth.missed} color="#f59e0b" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <BreakdownTable title="Source breakdown" rows={data.sourceBreakdown} labelKey="source" />
            <BreakdownTable title="Open pipeline by stage" rows={data.stageBreakdown} labelKey="stage" countOnly />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ActivityList title="Recent new leads" items={data.recentNew} openLead={openLead} onClose={onClose}
              render={l => <><span className="truncate">{l.fullName}</span><span className="chip !px-1.5 !py-0.5 text-[9px] bg-white/5 border border-white/10 text-slate-400 shrink-0">{l.stage}</span></>} />
            <ActivityList title="Recent wins" items={data.recentWon} openLead={openLead} onClose={onClose}
              render={l => <><span className="truncate">{l.fullName}</span><span className="mono text-emerald-400 shrink-0">{money(l.revenue)}</span></>} />
          </div>
        </>
      )}
    </Modal>
  )
}

function attainmentColor(pct) {
  if (pct < 60) return '#f43f5e'
  if (pct < 90) return '#f59e0b'
  return '#10b981'
}

function MiniStat({ label, value, sub, color }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="font-display text-[16px] font-bold mono" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  )
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="card !rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider text-slate-500 mb-1.5" style={{ color }}>{icon}{label}</div>
      <div className="font-display text-[16px] font-bold text-white mono">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function BreakdownTable({ title, rows, labelKey, countOnly }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/8 text-[12px] font-semibold text-slate-200">{title}</div>
      <div className="max-h-[180px] overflow-y-auto scrollbar-thin">
        {rows?.length ? rows.map(r => (
          <div key={r[labelKey]} className="flex items-center gap-2 px-4 py-1.5 text-[12px] border-b border-white/5 last:border-0">
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
    <div className="card overflow-hidden">
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
