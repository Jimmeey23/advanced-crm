import React from 'react'
import { useApp } from '../store.jsx'

// Place brand image files at public/logo-dark.png (for dark theme) and
// public/logo-light.png (for light theme).
export default function Logo({ size = 36, className = '' }) {
  const { theme } = useApp()
  const src = theme === 'light' ? '/logo-light.png' : '/logo-dark.png'

  return (
    <span className={`logo-badge ${className}`} style={{ width: size, height: size }} aria-label="Physique 57">
      <img src={src} alt="Physique 57" className="logo-img" />
    </span>
  )
}
