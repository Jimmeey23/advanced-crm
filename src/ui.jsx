import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { AVATAR_COLORS, initials } from './lib.js'
import Logo from './components/Logo.jsx'

export function Avatar({ name, color, size = 30, className = '', photoUrl, photoZoom, photoPosX, photoPosY, fallback }) {
  const c = color || AVATAR_COLORS[(name || '').length % AVATAR_COLORS.length]
  const [broken, setBroken] = useState(false)
  const src = normalizePhotoUrl(photoUrl)
  if (src && !broken) {
    const zoom = Number(photoZoom) > 0 ? Number(photoZoom) : 100
    const posX = photoPosX !== undefined && photoPosX !== null ? Number(photoPosX) : 50
    const posY = photoPosY !== undefined && photoPosY !== null ? Number(photoPosY) : 50
    return (
      <span
        className={`inline-block rounded-full shrink-0 overflow-hidden ${className}`}
        style={{ width: size, height: size, border: `1px solid ${c}55` }}
      >
        <img
          src={src}
          alt={name}
          title={name}
          className="w-full h-full object-cover"
          style={{ objectPosition: `${posX}% ${posY}%`, transform: `scale(${zoom / 100})`, transformOrigin: `${posX}% ${posY}%` }}
          onError={() => setBroken(true)}
        />
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 ${fallback ? 'avatar-person-fallback' : ''} ${className}`}
      style={fallback
        ? { width: size, height: size, background: '#111827', color: '#fff', fontSize: size * 0.52, border: '1px solid rgba(255,255,255,.34)' }
        : { width: size, height: size, background: `${c}22`, color: c, fontSize: size * 0.4, border: `1px solid ${c}55` }}
      title={name}
    >
      {fallback || initials(name)}
    </span>
  )
}

// Associate photos live in src/public/avatars — a static asset bundled with
// the frontend build, not something the API server hosts. Prefixing with
// API_BASE (added for API calls, so it can point at a separate backend
// origin in a split deployment) broke these: the file exists at the
// frontend's own origin, not the API's, so the request 404'd there and the
// image silently fell back to initials.
export function normalizePhotoUrl(photoUrl) {
  const raw = String(photoUrl || '').trim()
  if (!raw) return ''
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:')) return raw
  return `/${raw.replace(/^public\//, '').replace(/^\/+/, '')}`
}

export function ScorePill({ score, size = 'md' }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(score) || 0)))
  const r = size === 'lg' ? 20 : 16
  const circ = 2 * Math.PI * r
  const d = r * 2 + 6
  return (
    <div className={`score-ring ${size === 'lg' ? 'is-large' : ''} relative inline-flex items-center justify-center`} style={{ width: d, height: d }} title={`Lead score: ${pct} out of 100`}>
      <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`}>
        <circle className="score-ring-track" cx={r + 3} cy={r + 3} r={r} fill="none" strokeWidth={3.5} />
        <circle className="score-ring-progress" cx={r + 3} cy={r + 3} r={r} fill="none" strokeWidth={3.5}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
          transform={`rotate(-90 ${r + 3} ${r + 3})`} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <span className="score-ring-value absolute mono">{pct}</span>
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
      <div className="absolute inset-0 modal-backdrop" onMouseDown={onClose} />
      <div
        className="relative card modal-panel p-6 w-full"
        style={{ maxWidth: width, animation: 'fadeIn .18s ease' }}
      >
        <div className="modal-scroll">{children}</div>
      </div>
    </div>
  )
}

export function useOverlayDismiss(open, onClose) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    const onMouseDown = (e) => {
      const root = e.target?.closest?.('[data-overlay-root="true"]')
      const panel = e.target?.closest?.('[data-overlay-panel="true"]')
      if (root && !panel) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [open, onClose])
}

export function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div className="modal-header flex items-start justify-between mb-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>
      <button className="btn btn-ghost modal-close !p-2" onClick={onClose}><X size={16} /></button>
    </div>
  )
}

export function Spinner({ size = 18 }) {
  return (
    <span className="elegant-spinner" style={{ width: size, height: size }} aria-label="Loading" />
  )
}

const LOADER_STAGES = [
  'Connecting to your workspace',
  'Loading studios and team',
  'Fetching your leads',
  'Almost there'
]

export function AppLoader() {
  // Bootstrap is a multi-second wait on a large lead table, so the loader
  // says what it is doing rather than spinning silently. The rail is
  // indeterminate on purpose — the server sends no progress, and a fake
  // percentage would be a lie the user can catch.
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStage(s => Math.min(s + 1, LOADER_STAGES.length - 1)), 2200)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="app-loader-shell" role="status" aria-live="polite">
      <div className="app-loader-brand">
        <Logo size={56} animate />
      </div>
      <div className="app-loader-copy">
        <strong>Physique 57 Lead Studio</strong>
        <span key={stage}>{LOADER_STAGES[stage]}…</span>
      </div>
      <div className="app-loader-rail"><span /></div>
    </div>
  )
}

export function Empty({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3 text-slate-500">{icon}</div>
      <p className="font-semibold text-slate-300">{title}</p>
      {subtitle && <p className="text-sm text-slate-500 mt-1 max-w-xs">{subtitle}</p>}
    </div>
  )
}

// Skeletons replace spinners wherever the shape of the incoming content is
// already known — the layout stops jumping when data lands.
export function Skeleton({ w = '100%', h = 12, radius = 6, className = '' }) {
  return <span className={`skeleton ${className}`} style={{ width: w, height: h, borderRadius: radius }} aria-hidden="true" />
}

export function TableSkeleton({ rows = 8, cols = 7 }) {
  const widths = ['38%', '72%', '54%', '64%', '46%', '58%', '50%']
  return (
    <div className="table-skeleton" role="status" aria-label="Loading leads">
      {Array.from({ length: rows }).map((_, r) => (
        <div className="table-skeleton-row" key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} w={widths[(r + c) % widths.length]} h={10} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ lines = 3 }) {
  return (
    <div className="card p-4 space-y-3" role="status" aria-label="Loading">
      <Skeleton w="42%" h={14} />
      {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} w={`${88 - i * 14}%`} h={10} />)}
    </div>
  )
}
