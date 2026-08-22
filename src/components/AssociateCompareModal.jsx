import React, { useMemo, useState } from 'react'
import { Trophy, Target, TrendingUp, Users, Swords, CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell
} from 'recharts'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { Modal, ModalHeader, Avatar } from '../ui.jsx'
import { money } from '../lib.js'

const BAR_COLORS = ['var(--accent)', '#2563eb', '#10b981']

const tooltipStyle = {
  background: '#ffffff', border: '1px solid rgba(15,23,42,0.12)', borderRadius: 14,
  fontSize: 12, color: '#0f172a', boxShadow: '0 16px 38px rgba(15,23,42,.12)'
}

export default function AssociateCompareModal({ open, onClose }) {
  const { boot } = useApp()
  const { data, loading } = useFetch(
    () => open ? api.get('/api/analytics/associate-compare') : Promise.resolve([]),
    [open]
  )

  const rows = data || []
  const [aId, setAId] = useState(null)
  const [bId, setBId] = useState(null)
  const aIdEff = aId || rows[0]?.associateId || ''
  const bIdEff = bId || rows[1]?.associateId || ''
  const A = rows.find(r => r.associateId === aIdEff)
  const B = rows.find(r => r.associateId === bIdEff)

  const chartData = rows.map(r => ({ name: r.name.split(' ')[0], revenue: r.revenue, won: r.won, full: r.name }))
  const best = rows[0]
  const topTarget = rows.reduce((acc, r) => (r.wonThisMonth > acc.wonThisMonth ? r : acc), rows[0])

  const faceoff = useMemo(() => {
    if (!A || !B) return null
    const fuRate = r => r.followUps ? Math.round(((r.followUps - r.missed) / r.followUps) * 100) : 0
    const stats = [
      { key: 'Won deals', a: A.won, b: B.won, higher: 'up', fmt: v => v },
      { key: 'Revenue', a: A.revenue, b: B.revenue, higher: 'up', fmt: v => money(v) },
      { key: 'Open leads', a: A.open, b: B.open, higher: 'down', fmt: v => v },
      { key: 'Conversion', a: A.conversion, b: B.conversion, higher: 'up', fmt: v => `${v}%` },
      { key: 'New this month', a: A.newThisMonth, b: B.newThisMonth, higher: 'up', fmt: v => v },
      { key: 'Won this month', a: A.wonThisMonth, b: B.wonThisMonth, higher: 'up', fmt: v => v },
      { key: 'Follow-ups logged', a: A.followUps, b: B.followUps, higher: 'up', fmt: v => v },
      { key: 'Missed follow-ups', a: A.missed, b: B.missed, higher: 'down', fmt: v => v },
      { key: 'Follow-up completion', a: fuRate(A), b: fuRate(B), higher: 'up', fmt: v => `${v}%` },
      { key: 'Attainment', a: A.attainment, b: B.attainment, higher: 'up', fmt: v => `${v}%` },
      { key: 'Avg AI score', a: A.avgScore, b: B.avgScore, higher: 'up', fmt: v => v }
    ]
    const totalA = stats.reduce((s, x) => s + (x.a > x.b ? 1 : 0), 0)
    const totalB = stats.reduce((s, x) => s + (x.b > x.a ? 1 : 0), 0)
    return { stats, totalA, totalB }
  }, [A, B])

  return (
    <Modal open={open} onClose={onClose} width={980}>
      <ModalHeader title="Associate Faceoff" subtitle="Head to head — revenue, wins, follow-up discipline and attainment" onClose={onClose} />

      {loading && <div className="py-14 text-center text-slate-500">Loading associate performance…</div>}

      {!loading && rows.length && (
        <div className="space-y-4">
          {/* Head-to-head pickers */}
          <div className="card !rounded-xl p-4">
            <div className="flex items-center gap-2 text-[12px] font-bold text-slate-700 mb-3">
              <Swords size={14} className="text-rose-400" /> Head to head
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: aIdEff, set: setAId, label: 'Associate A', accent: '#f43f5e' },
                { id: bIdEff, set: setBId, label: 'Associate B', accent: '#2563eb' }
              ].map(slot => (
                <div key={slot.label}>
                  <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: slot.accent }}>{slot.label}</div>
                  <select className="input !py-2 !bg-white !border-slate-200" value={slot.id} onChange={e => slot.set(e.target.value || null)}>
                    {rows.map(r => <option key={r.associateId} value={r.associateId}>{r.name}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {faceoff && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <FaceoffCard r={A} color="var(--accent)" accent="var(--accent)" score={faceoff.totalA} vs={faceoff.totalB} />
                <FaceoffCard r={B} color="#2563eb" accent="#2563eb" score={faceoff.totalB} vs={faceoff.totalA} />
              </div>
            )}
          </div>

          {/* Metric-by-metric table */}
          {faceoff && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 text-[12.5px] font-semibold text-slate-700">
                Metric by metric
              </div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <th className="px-4 py-2.5 font-semibold text-rose-400">{A?.name}</th>
                      <th className="px-3 py-2.5 font-semibold">Metric</th>
                      <th className="px-4 py-2.5 font-semibold text-right text-blue-500">{B?.name}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faceoff.stats.map(s => {
                      const winA = s.a > s.b
                      const winB = s.b > s.a
                      const tie = s.a === s.b
                      return (
                        <tr key={s.key} className="border-b border-slate-200 hover:bg-slate-50">
                          <td className={`px-4 py-2 text-[12.5px] mono ${winA ? 'text-white font-semibold' : 'text-slate-400'}`}>
                            <span className="flex items-center gap-1.5 justify-end">{s.fmt(s.a)}{winA && !tie && <CheckCircle2 size={12} className="text-emerald-400" />}</span>
                          </td>
                          <td className="px-3 py-2 text-center text-[11.5px] text-slate-500">{s.key}</td>
                          <td className={`px-4 py-2 text-right text-[12.5px] mono ${winB ? 'text-white font-semibold' : 'text-slate-400'}`}>
                            <span className="flex items-center gap-1.5 justify-end">{s.fmt(s.b)}{winB && !tie && <CheckCircle2 size={12} className="text-emerald-400" />}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Team-wide chart */}
          <div className="card p-4">
            <h3 className="font-display font-semibold text-white text-[13px] mb-3">Revenue by associate (won deals)</h3>
          <div className="chart-3d h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#9aa1b5', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={46} />
                  <YAxis tick={{ fill: '#5b6278', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]}>
                    {chartData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard icon={<Trophy size={15} className="text-blue-400" />} label="Top earner" value={best?.name || '—'} sub={best ? money(best.revenue) : ''} />
            <SummaryCard icon={<Target size={15} className="text-emerald-400" />} label="Best monthly attainment" value={topTarget?.name || '—'} sub={topTarget ? `${topTarget.wonThisMonth} of ${topTarget.target} target` : ''} />
            <SummaryCard icon={<TrendingUp size={15} className="text-blue-400" />} label="Best conversion" value={rows.find(r => r.conversion === Math.max(...rows.map(x => x.conversion)))?.name || '—'} sub={rows.length ? `${Math.max(...rows.map(x => x.conversion))}%` : ''} />
            <SummaryCard icon={<Users size={15} className="text-rose-400" />} label="Team size" value={rows.length} sub={`${rows.reduce((s, r) => s + r.open, 0)} open leads`} />
          </div>
        </div>
      )}
    </Modal>
  )
}

function FaceoffCard({ r, accent, score, vs }) {
  const fuRate = r.followUps ? Math.round(((r.followUps - r.missed) / r.followUps) * 100) : 0
  const won = score > vs
  const cells = [
    { label: 'Revenue', value: money(r.revenue) },
    { label: 'Won deals', value: r.won },
    { label: 'Follow-up completion', value: `${fuRate}%`, warn: r.missed > 0 },
    { label: 'Attainment', value: `${r.attainment}%` }
  ]
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-2.5 mb-3">
        <Avatar name={r.name} color={r.color} size={34} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-slate-900 truncate">{r.name}</div>
          <div className="text-[10.5px] text-slate-500">{r.conversion}% conversion · score {r.avgScore}</div>
        </div>
        {won && <span className="chip !px-2 !py-1 text-[10px] bg-blue-500/10 text-blue-500 border border-blue-500/20"><Trophy size={10} className="inline -mt-0.5 mr-1" />Leading</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cells.map(c => (
          <div key={c.label} className="rounded-xl bg-slate-50 border border-slate-200 px-2.5 py-2">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-500">
              {c.warn && <AlertTriangle size={9} className="text-rose-400" />}{c.label}
            </div>
            <div className="font-display text-[15px] font-bold mono" style={{ color: accent }}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryCard({ icon, label, value, sub }) {
  return (
    <div className="card !rounded-2xl p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-2">{icon}{label}</div>
      <div className="font-display text-[15px] font-bold text-slate-900 truncate" title={value}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</div>}
    </div>
  )
}
