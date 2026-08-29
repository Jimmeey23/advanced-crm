import { supabase } from './lib/supabaseClient.js'

// When the frontend and API are deployed separately (e.g. frontend on
// Vercel, API server on Railway), set VITE_API_BASE_URL to the API's origin
// (e.g. https://your-app.up.railway.app). Empty by default so relative paths
// keep working when both are served from the same origin (local dev via the
// Vite proxy, or a single combined deployment).
const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()?.replace(/\/$/, '') || ''
const localApiStartPort = Number(import.meta.env.VITE_API_PORT) || 3001
let localDiscoveryPromise = null

async function discoverLocalApiBase() {
  if (typeof window === 'undefined' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return ''
  if (localDiscoveryPromise) return localDiscoveryPromise
  localDiscoveryPromise = Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const base = `http://localhost:${localApiStartPort + index}`
    try {
      const res = await fetch(`${base}/api/runtime`, { signal: AbortSignal.timeout(500) })
      if (!res.ok) return null
      const runtime = await res.json()
      return runtime.app === 'physique57-leads' ? { base, startedAt: Date.parse(runtime.startedAt) || 0 } : null
    } catch (e) { return null }
  })).then(results => results.filter(Boolean).sort((a, b) => b.startedAt - a.startedAt)[0]?.base || '')
  return localDiscoveryPromise
}

function getApiBases(preferred = '') {
  const bases = []
  if (preferred) bases.push(preferred)
  if (configuredApiBase) bases.push(configuredApiBase)

  // Same-origin works for combined deployments and most hosted previews.
  if (typeof window !== 'undefined' && window.location?.origin) {
    bases.push(window.location.origin.replace(/\/$/, ''))

    // Local dev fallback: if the app is being opened on a frontend port,
    // the API server usually runs on 3001 next door.
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      bases.push(`http://localhost:${localApiStartPort}`)
    }
  }

  // Relative path last so the Vite proxy keeps working in dev if the direct
  // origins above are unavailable.
  bases.push('')
  return [...new Set(bases)]
}

export const API_BASE = configuredApiBase || (typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '')

export async function resolveApiBase() {
  return configuredApiBase || await discoverLocalApiBase() || API_BASE
}

async function req(method, path, body, isForm) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    if (isForm) { opts.body = body }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
  }

  let session = null
  try {
    ({ data: { session } } = await supabase.auth.getSession())
  } catch (err) {
    if (!req._sessionWarned) {
      req._sessionWarned = true
      console.warn('supabase.auth.getSession() failed; proceeding without auth header', err)
    }
  }
  if (session) opts.headers['Authorization'] = `Bearer ${session.access_token}`

  let lastError = null
  const preferredBase = await resolveApiBase()
  for (const base of getApiBases(preferredBase)) {
    try {
      const res = await fetch(base + path, opts)
      if (res.ok) return res.json()

      const data = await res.json().catch(() => ({}))
      const error = new Error(data.error || data.message || `${res.status} ${res.statusText}`)
      error.status = res.status
      error.base = base || '(relative)'
      error.data = data
      lastError = error

      // Retry a likely backend origin when we hit a 404 from the current one.
      // But only if the 404 doesn't come with an explicit JSON application error.
      if (res.status !== 404 || data.error || data.message) break
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error('Request failed')
}

export const api = {
  resolveBase: resolveApiBase,
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  patch: (p, b) => req('PATCH', p, b),
  put: (p, b) => req('PUT', p, b),
  delete: (p, b) => req('DELETE', p, b),
  upload: (p, formData) => req('POST', p, formData, true)
}

export function buildQuery(params) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, v)
  }
  return q.toString()
}
