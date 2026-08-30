import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Stamp the theme before the first paint. AppProvider does this too, but it
// only mounts after sign-in — without this the login screen renders against
// dark tokens for users whose saved theme is light.
try {
  const saved = localStorage.getItem('p57_theme')
  document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light')
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'light')
}
if (!document.documentElement.getAttribute('data-accent')) {
  document.documentElement.setAttribute('data-accent', 'blue')
}

createRoot(document.getElementById('root')).render(<App />)
