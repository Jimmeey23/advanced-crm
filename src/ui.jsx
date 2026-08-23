import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { AVATAR_COLORS, initials } from './lib.js'

export function Avatar({ name, color, size = 30, className = '', photoUrl }) {
  const c = color || AVATAR_COLORS[(name || '').length % AVATAR_COLORS.length]
  const [broken, setBroken] = useState(false)
  const src = normalizePhotoUrl(photoUrl)
  if (src && !broken) {
    return (
      <img
        src={src}
        alt={name}
        title={name}
        className={`inline-block rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size, border: `1px solid ${c}55` }}
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 ${className}`}
      style={{ width: size, height: size, background: `${c}22`, color: c, fontSize: size * 0.4, border: `1px solid ${c}55` }}
      title={name}
    >
      {initials(name)}
    </span>
  )
}

function normalizePhotoUrl(photoUrl) {
  const raw = String(photoUrl || '').trim()
  if (!raw) return ''
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:')) return raw
  return `/${raw.replace(/^public\//, '').replace(/^\/+/, '')}`
}

export function ScorePill({ score, size = 'md' }) {
  const pct = score
  const color = pct >= 70 ? '#34d399' : pct >= 45 ? '#fbbf24' : '#94a3b8'
  const r = size === 'lg' ? 20 : 14
  const circ = 2 * Math.PI * r
  const d = r * 2 + 6
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: d, height: d }}>
      <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`}>
        <circle cx={r + 3} cy={r + 3} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3.5} />
        <circle cx={r + 3} cy={r + 3} r={r} fill="none" stroke={color} strokeWidth={3.5}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
          transform={`rotate(-90 ${r + 3} ${r + 3})`} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <span className="absolute mono text-[12px] font-semibold" style={{ color }}>{pct}</span>
    </div>
  )
}

export function Modal({ open, onClose, children, width = 520 }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog">
      <div className="absolute inset-0 modal-backdrop" onClick={onClose} />
      <div
        className="relative card modal-panel p-6 w-full"
        style={{ maxWidth: width, animation: 'fadeIn .18s ease' }}
      >
        <div className="modal-scroll">{children}</div>
      </div>
    </div>
  )
}

export function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div className="modal-header flex items-start justify-between mb-5">
      <div>
        <h2 className="font-display text-[17px] font-semibold text-white">{title}</h2>
        {subtitle && <p className="text-[12.5px] text-slate-400 mt-1">{subtitle}</p>}
      </div>
      <button className="btn btn-ghost modal-close !p-2" onClick={onClose}><X size={16} /></button>
    </div>
  )
}

export function Spinner({ size = 18 }) {
  return (
    <span className="inline-block animate-spin rounded-full border-2 border-white/20 border-t-white/80" style={{ width: size, height: size }} />
  )
}

export function Empty({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3 text-slate-500">{icon}</div>
      <p className="font-semibold text-slate-300">{title}</p>
      {subtitle && <p className="text-[12.5px] text-slate-500 mt-1 max-w-xs">{subtitle}</p>}
    </div>
  )
}
