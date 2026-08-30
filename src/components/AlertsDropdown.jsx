import React, { useEffect, useRef, useState } from 'react'
import { Bell, AlertTriangle, CalendarClock, UserPlus, Flame, Snowflake, RadioTower, Flag, ChevronRight, UserCog } from 'lucide-react'
import { useApp } from '../store.jsx'

const KIND_META = {
  missed_followup: { icon: AlertTriangle, color: '#f87171', label: 'Missed follow-up' },
  missed_outreach: { icon: RadioTower, color: '#fb923c', label: 'Missed outreach' },
  today: { icon: CalendarClock, color: '#fbbf24', label: 'Due today' },
  unassigned: { icon: UserPlus, color: '#fb7185', label: 'Unassigned' },
  high_value: { icon: Flame, color: '#f97316', label: 'High value' },
  stale: { icon: Snowflake, color: '#94a3b8', label: 'Cold lead' },
  overdue: { icon: AlertTriangle, color: '#f87171', label: 'Overdue' },
  custom_rule: { icon: Flag, color: '#f59e0b', label: 'Custom rule' },
  owner_change_request: { icon: UserCog, color: '#a78bfa', label: 'Owner request' }
}

export default function AlertsDropdown() {
  const { alerts, openLead } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const high = alerts.filter(a => a.level === 'high').length

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', key) }
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button className="relative w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setOpen(o => !o)}>
        <Bell size={16} />
        {high > 0 && (
          <span className="notification-count absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-rose-500 text-pure-white text-xs font-bold flex items-center justify-center">{high}</span>
        )}
      </button>

      {open && (
        <div className="alerts-menu fixed right-5 top-[76px] w-[min(420px,calc(100vw-24px))] card z-[999] overflow-hidden shadow-2xl" style={{ background: 'var(--tt-bg)', animation: 'fadeIn .15s ease' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
            <div className="font-display font-semibold text-white text-md">Alerts & reminders</div>
            <span className="chip bg-white/5 border border-white/10 text-slate-300">{alerts.length} active</span>
          </div>
          <div className="max-h-[min(620px,calc(100vh-150px))] overflow-y-auto scrollbar-thin">
            {alerts.length === 0 && (
              <div className="px-4 py-10 text-center text-base text-slate-500">All clear — no alerts right now.</div>
            )}
            {alerts.slice(0, 30).map(a => {
              const meta = KIND_META[a.kind] || KIND_META.overdue
              const color = a.color || meta.color
              const Icon = meta.icon
              return (
                <button key={a.id} className="w-full flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/4 text-left" onClick={() => { openLead(a.leadId); setOpen(false) }}>
                  <span className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}1e`, color }}>
                    <Icon size={14} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-base font-semibold text-white truncate">{a.leadName}</span>
                      <span className="chip !px-2 !py-0.5 text-2xs uppercase tracking-wide" style={{ background: `${color}1e`, color }}>{meta.label}</span>
                    </span>
                    <span className="block text-sm text-slate-400 mt-0.5">{a.title}</span>
                    <span className="block text-xs text-slate-500 mt-0.5 truncate">{a.detail}</span>
                  </span>
                  <ChevronRight size={14} className="mt-2 text-slate-600" />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
