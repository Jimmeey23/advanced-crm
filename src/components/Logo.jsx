import React from 'react'
import { useApp } from '../store.jsx'

export default function Logo({ size = 36, className = '' }) {
  const { theme } = useApp()
  const dark = theme !== 'light'

  return (
    <span
      className={`logo-badge ${className} ${dark ? 'is-dark' : 'is-light'}`}
      style={{ width: size, height: size }}
      aria-label="Physique 57"
    >
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="logo-mark">
        <defs>
          <linearGradient id="p57-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={dark ? '#ff6b81' : '#0f172a'} />
            <stop offset="55%" stopColor={dark ? '#f97316' : '#334155'} />
            <stop offset="100%" stopColor={dark ? '#fbbf24' : '#64748b'} />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="19" fill="none" stroke="url(#p57-logo-grad)" strokeWidth="2.6" opacity=".7" />
        <path d="M16 30.5V17.2h8.2c4.4 0 7.1 2.1 7.1 5.4 0 3.4-2.7 5.9-7.1 5.9h-3.8v2h-4.4Zm4.4-5.3h3.5c2 0 3.1-.8 3.1-2.3 0-1.3-1.1-2.1-3.1-2.1h-3.5v4.4Z" fill="url(#p57-logo-grad)" />
        <path d="M31.6 31c0-1.6 1.3-2.9 2.9-2.9s2.9 1.3 2.9 2.9-1.3 2.9-2.9 2.9-2.9-1.3-2.9-2.9Z" fill="url(#p57-logo-grad)" opacity=".95" />
      </svg>
    </span>
  )
}
