import React from 'react'
import { useApp } from '../store.jsx'

// The mark matches the browser-tab favicon: a filled tile carrying "57"
// under a barre — the one piece of studio equipment the whole brand is
// built around. A filled tile holds its weight at 28px in the collapsed
// sidebar, which the previous hairline circle did not.
export default function Logo({ size = 36, className = '', animate = false }) {
  const app = useApp?.()
  const dark = (app?.theme ?? 'light') !== 'light'
  const id = React.useId().replace(/:/g, '')

  return (
    <span
      className={`logo-badge ${className} ${dark ? 'is-dark' : 'is-light'} ${animate ? 'is-animating' : ''}`}
      style={{ width: size, height: size }}
      aria-label="Physique 57"
    >
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="logo-mark">
        <defs>
          <linearGradient id={`tile-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            {dark ? (
              <><stop offset="0%" stopColor="#fb7185" /><stop offset="52%" stopColor="#e11d48" /><stop offset="100%" stopColor="#9f1239" /></>
            ) : (
              <><stop offset="0%" stopColor="#2b2f39" /><stop offset="55%" stopColor="#16181d" /><stop offset="100%" stopColor="#0a0c0f" /></>
            )}
          </linearGradient>
        </defs>

        <rect x="1" y="1" width="46" height="46" rx="13" fill={`url(#tile-${id})`} />
        {/* The barre: one confident stroke the numerals hang from. */}
        <path
          className="logo-barre"
          d="M9 20.5c5-6.5 25-6.5 30 0"
          fill="none"
          stroke={dark ? 'rgba(255,255,255,.92)' : '#fb7185'}
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <text
          x="24" y="38" textAnchor="middle"
          fontFamily="'Bricolage Grotesque', system-ui, sans-serif"
          fontSize="19" fontWeight="800" letterSpacing="-0.5"
          fill="#fff"
        >57</text>
      </svg>
    </span>
  )
}
