// When the frontend and API are deployed separately (e.g. frontend on
// Vercel, API server on Railway), set VITE_API_BASE_URL to the API's origin
// (e.g. https://your-app.up.railway.app). Empty by default so relative paths
// keep working when both are served from the same origin (local dev via the
// Vite proxy, or a single combined deployment).
function getApiBases() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim()
  const bases = []
  if (configured) bases.push(configured.replace(/\/$/, ''))

  // Same-origin works for combined deployments and most hosted previews.
  if (typeof window !== 'undefined' && window.location?.origin) {
    bases.push(window.location.origin.replace(/\/$/, ''))

    // Local dev fallback: if the app is being opened on a frontend port,
    // the API server usually runs on 3001 next door.
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      bases.push('http://localhost:3001')
    }
  }

  // Relative path last so the Vite proxy keeps working in dev if the direct
  // origins above are unavailable.
  bases.push('')
  return [...new Set(bases)]
}

export const API_BASE = getApiBases()[0]

async function req(method, path, body, isForm) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    if (isForm) { opts.body = body }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
  }

  let lastError = null
  for (const base of getApiBases()) {
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
      if (res.status !== 404) break
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error('Request failed')
}

export const api = {
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
