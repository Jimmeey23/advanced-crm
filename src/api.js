// When the frontend and API are deployed separately (e.g. frontend on
// Vercel, API server on Railway), set VITE_API_BASE_URL to the API's origin
// (e.g. https://your-app.up.railway.app). Empty by default so relative paths
// keep working when both are served from the same origin (local dev via the
// Vite proxy, or a single combined deployment).
export const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

async function req(method, path, body, isForm) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    if (isForm) { opts.body = body }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
  }
  const res = await fetch(API_BASE + path, opts)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || data.message || `${res.status} ${res.statusText}`)
  }
  return res.json()
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
