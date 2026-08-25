// Respond.io's INTERNAL web-app API (service.respond.io) — not the public,
// documented v2 API in respondio.js. Respond.io has no public endpoint for
// canned responses/snippets ("Saved Replies" only exist in their own UI), so
// this talks to the same private endpoint their frontend calls, using a
// session captured from a logged-in browser tab (Cognito bearer token +
// cookie + botId + orgId, all short-lived — expect to re-paste them in
// Settings every so often once the token expires).
//
// This is unsupported and can break without notice on any respond.io
// frontend change — keep it isolated from the real API client in
// respondio.js so a breakage here can never affect messaging/contacts.
const BASE = 'https://service.respond.io/workspace'

function sessionConfig(db) {
  const s = db?.settings?.respondio?.session || {}
  return {
    token: (process.env.USER_RESPONDIO_SESSION_TOKEN || s.token || '').trim(),
    cookie: (process.env.USER_RESPONDIO_SESSION_COOKIE || s.cookie || '').trim(),
    botId: (process.env.USER_RESPONDIO_BOT_ID || s.botId || '').trim(),
    orgId: (process.env.USER_RESPONDIO_ORG_ID || s.orgId || '').trim()
  }
}

export function isSessionConfigured(db) {
  const s = sessionConfig(db)
  return Boolean(s.token && s.botId && s.orgId)
}

// Thrown when the captured session has expired — the caller should surface
// a clear "session expired, re-paste from your browser" message rather than
// a generic network error.
class SessionExpiredError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SessionExpiredError'
  }
}

async function call(db, path, body) {
  const s = sessionConfig(db)
  if (!s.token || !s.botId || !s.orgId) {
    throw new Error('Respond.io session is not configured — paste a fresh authToken/botId/orgId (and cookie, if required) in Settings > Integrations.')
  }
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${s.token}`,
    'Content-Type': 'application/json',
    botid: s.botId,
    orgid: s.orgId,
    origin: 'https://app.respond.io',
    referer: 'https://app.respond.io/',
    timezone: db?.settings?.org?.timezone || 'Asia/Kolkata',
    'x-requested-with': 'XMLHttpRequest'
  }
  if (s.cookie) headers.cookie = s.cookie
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) })
  if (res.status === 401 || res.status === 403) {
    throw new SessionExpiredError('Respond.io session has expired — re-paste a fresh authToken/cookie from your browser in Settings > Integrations.')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Respond.io internal API ${res.status} ${path}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

// Lists every snippet in the workspace (paginated) — confirmed live against
// POST /workspace/snippet/list, which returns { data: { total, items } }
// where each item is { id, uid, name, message, active, topics, createdAt, attachments }.
export async function listSnippets(db, { itemsPerPage = 100 } = {}) {
  const out = []
  let page = 1
  let total = Infinity
  const guard = 50 // backstop against a runaway loop, not a real ceiling
  while (out.length < total && page <= guard) {
    const data = await call(db, '/snippet/list', {
      pagination: { itemsPerPage, sortBy: ['name'], sortDesc: [false], page },
      topic: '', search: '', searchKey: ['name', 'message', 'uid']
    })
    const items = data?.data?.items || []
    total = data?.data?.total ?? items.length
    out.push(...items)
    if (!items.length) break
    page++
  }
  return out
}
