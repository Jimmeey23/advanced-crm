import React, { useEffect, useState } from 'react'
import { Users, Trophy, IndianRupee, CalendarCheck2, CalendarClock, ChevronDown } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { useApp } from '../store.jsx'
import { api, buildQuery } from '../api.js'
import { Modal, ModalHeader, Spinner } from '../ui.jsx'
import { money } from '../lib.js'
import MetricCard from './MetricCard.jsx'

function momOf(series) {
  if (series.length < 2) return null
  const prev = series[series.length - 2].value
  const cur = series[series.length - 1].value
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

const COLORS = { newLeads: '#2563eb', won: '#10b981', missed: '#f43f5e' }

export default function PerformanceModal({ open, onClose, range = 'week', studio = '', associate = '' }) {
  const { openLead } = useApp()
  const [data, setData] = useState(null)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [openIdx, setOpenIdx] = useState(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setOpenIdx(null)
    const q = buildQuery({ range, studio, associate })
    Promise.all([
      api.get(`/api/analytics/performance?${q}`),
      api.get(`/api/analytics/performance/details?${q}`)
    ])
      .then(([p, d]) => { setData(p); setDetails(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, range, studio, associate])

  const chartData = (data?.buckets || []).map(b => ({ ...b, missed: b.missed || 0 }))
  const t = data?.totals || {}
  const newLeadsTrend = chartData.map(b => ({ label: b.label, value: b.newLeads || 0 }))
  const wonTrend = chartData.map(b => ({ label: b.label, value: b.won || 0 }))
  const revenueTrend = chartData.map(b => ({ label: b.label, value: b.revenue || 0 }))
  const followUpTrend = chartData.map(b => ({ label: b.label, value: b.followUps ? Math.round(((b.followUps - (b.missed || 0)) / b.followUps) * 100) : 0 }))

  return (
    <Modal open={open} onClose={onClose} width={980}>
      <ModalHeader
        title={range === 'week' ? 'Weekly performance details' : 'Monthly performance details'}
        subtitle={range === 'week' ? 'Last 7 days — leads, wins, revenue and follow-up discipline' : 'Last 12 months — leads, wins, revenue and follow-up discipline'}
        onClose={onClose}
      />

      {loading && <div className="py-14 text-center text-slate-500"><Spinner size={22} /></div>}

      {!loading && data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard icon={Users} title="New leads" value={t.newLeads} color="#8b5cf6" trend={newLeadsTrend} mom={momOf(newLeadsTrend)} />
            <MetricCard icon={Trophy} title="Won deals" value={t.won} color="#10b981" trend={wonTrend} mom={momOf(wonTrend)} />
            <MetricCard icon={IndianRupee} title="Revenue" value={money(t.revenue)} color="#f43f5e" trend={revenueTrend} mom={momOf(revenueTrend)} />
            <MetricCard icon={CalendarCheck2} title="Follow-up completion" value={`${t.followUpRate || 0}%`} color="#fbbf24"
              description={`${t.missed || 0} missed of ${t.followUps || 0}`} trend={followUpTrend} mom={momOf(followUpTrend)} />
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.newLeads }} /> New</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.won }} /> Won</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.missed }} /> Missed FU</span>
            </div>
            <div className="chart-3d h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(15,23,42,0.08)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'var(--axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(37,99,235,0.06)' }} contentStyle={tooltipStyle()} />
                  <Bar dataKey="newLeads" name="New leads" fill={COLORS.newLeads} radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
                  <Bar dataKey="won" name="Won" fill={COLORS.won} radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
                  <Bar dataKey="missed" name="Missed follow-ups" fill={COLORS.missed} radius={[4, 4, 0, 0]} activeBar={{ opacity: 1 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <CalendarClock size={13} className="text-blue-400" /> Bucket breakdown
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                    <th className="px-4 py-2.5 font-semibold">Period</th>
                    <th className="px-3 py-2.5 font-semibold text-center">New</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Won</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Missed</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Revenue</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((b, i) => {
                    const det = details?.buckets?.find(x => x.key === b.key)
                    const isOpen = openIdx === i
                    const hasDetail = (det?.newLeads?.length || 0) + (det?.won?.length || 0) + (det?.missed?.length || 0) > 0
                    return (
                      <React.Fragment key={b.key}>
                        <tr className="border-b border-slate-200 hover:bg-slate-50 cursor-pointer" onClick={() => hasDetail && setOpenIdx(isOpen ? null : i)}>
                          <td className="px-4 py-2.5 text-sm text-slate-700">{b.label}</td>
                          <td className="px-3 py-2.5 text-center text-sm text-blue-400 mono">{b.newLeads || 0}</td>
                          <td className="px-3 py-2.5 text-center text-sm text-emerald-400 mono">{b.won || 0}</td>
                          <td className="px-3 py-2.5 text-center text-sm mono">{b.missed ? <span className="text-rose-400">{b.missed}</span> : <span className="text-slate-500">0</span>}</td>
                          <td className="px-3 py-2.5 text-center text-sm text-slate-900 mono">{money(b.revenue || 0)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-slate-50 border border-slate-200 text-slate-500">
                              <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </span>
                          </td>
                        </tr>
                        {isOpen && det && (
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <DetailList title="New leads" color="#2563eb" items={det.newLeads || []} openLead={openLead} />
                                <DetailList title="Won" color="#34d399" items={det.won || []} openLead={openLead} moneyValue />
                                <DetailList title="Missed follow-ups" color="#f43f5e" items={det.missed || []} openLead={openLead} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function DetailList({ title, color, items, openLead, moneyValue }) {
  if (!items.length) return <div className="text-sm text-slate-500">{title}: none</div>
  return (
    <div>
      <div className="text-xs uppercase tracking-wider font-bold mb-1.5" style={{ color }}>{title} ({items.length})</div>
      <div className="space-y-1 max-h-[180px] overflow-y-auto scrollbar-thin">
        {items.map(it => (
          <button key={it.id} className="w-full text-left flex items-center justify-between gap-2 text-sm text-slate-700 bg-pure-white border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors" onClick={() => openLead(it.id)}>
            <span className="truncate">{it.fullName}</span>
            {moneyValue && it.value ? <span className="mono text-emerald-500 shrink-0">{money(it.value)}</span> : it.comments ? <span className="text-slate-500 truncate max-w-[120px]">{it.comments}</span> : <span className="chip !px-1.5 !py-0.5 text-2xs bg-slate-50 border border-slate-200 text-slate-500">{it.stage}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function tooltipStyle() {
  return {
    background: '#ffffff',
    border: '1px solid rgba(15,23,42,0.12)',
    borderRadius: 12,
    fontSize: 12,
    color: '#0f172a',
    boxShadow: '0 16px 38px rgba(15,23,42,.12)'
  }
}
