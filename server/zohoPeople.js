// Zoho People shift lookup — powers "shift-aware round robin": a lead only
// gets auto-assigned to an associate who is actually clocked on a working
// shift today, not just "active" in the roster. Config lives in
// db.settings.zohoPeople exactly like every other integration here
// (Momence/Google Sheets), not a per-login OAuth grant.
//
// Network calls only happen on an explicit "Refresh shifts now" click or a
// background poll (see index.js) — never inline during lead creation.
// nextAssociate() in roundRobin.js only ever reads the cached
// `settings.zohoPeople.onDuty` snapshot synchronously, so a slow/unreachable
// Zoho API can never block a lead from being created or assigned.
import { nowIso } from './db.js'

const TOKEN_HOSTS = { in: 'accounts.zoho.in', com: 'accounts.zoho.com', eu: 'accounts.zoho.eu', 'com.au': 'accounts.zoho.com.au' }
const API_HOSTS = { in: 'people.zoho.in', com: 'people.zoho.com', eu: 'people.zoho.eu', 'com.au': 'people.zoho.com.au' }

export function config(db) {
  if (!db.settings) db.settings = {}
  if (!db.settings.zohoPeople) {
    db.settings.zohoPeople = {
      clientId: '', clientSecret: '', refreshToken: '', accessToken: '', tokenExpiresAt: '',
      dataCenter: 'in', enabled: false, lastFetchAt: null, lastFetchError: null, onDuty: null
    }
  }
  return db.settings.zohoPeople
}

// Env vars take priority over Settings, matching momence.js's
// effectiveConfig pattern — lets creds live only in .env (never touched by
// the app/UI) while Settings can still be used as a fallback.
export function effectiveConfig(db) {
  const c = config(db)
  const env = {
    clientId: (process.env.USER_ZOHO_PEOPLE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.USER_ZOHO_PEOPLE_CLIENT_SECRET || '').trim(),
    refreshToken: (process.env.USER_ZOHO_PEOPLE_REFRESH_TOKEN || '').trim(),
    dataCenter: (process.env.USER_ZOHO_PEOPLE_DATA_CENTER || '').trim()
  }
  return {
    clientId: env.clientId || c.clientId || '',
    clientSecret: env.clientSecret || c.clientSecret || '',
    refreshToken: env.refreshToken || c.refreshToken || '',
    dataCenter: env.dataCenter || c.dataCenter || 'in',
    fromEnv: Boolean(env.clientId && env.clientSecret && env.refreshToken)
  }
}

function dc(db) {
  const d = effectiveConfig(db).dataCenter || 'in'
  return TOKEN_HOSTS[d] ? d : 'in'
}

export function isConfigured(db) {
  const c = effectiveConfig(db)
  return Boolean(c.clientId && c.clientSecret && c.refreshToken)
}

export function sanitizedConfig(db) {
  const c = effectiveConfig(db)
  const stored = config(db)
  return {
    clientId: c.clientId || '',
    hasClientSecret: Boolean(c.clientSecret),
    hasRefreshToken: Boolean(c.refreshToken),
    dataCenter: c.dataCenter || 'in',
    fromEnv: c.fromEnv,
    enabled: Boolean(stored.enabled),
    lastFetchAt: stored.lastFetchAt || null,
    lastFetchError: stored.lastFetchError || null,
    onDuty: stored.onDuty || null
  }
}

function getCachedToken(db) {
  const c = config(db)
  if (c.accessToken && c.tokenExpiresAt && new Date(c.tokenExpiresAt).getTime() > Date.now() + 300000) {
    return c.accessToken
  }
  return null
}

async function getAccessToken(db) {
  const cached = getCachedToken(db)
  if (cached) return cached

  const c = effectiveConfig(db)
  if (!c.clientId || !c.clientSecret || !c.refreshToken) {
    throw new Error('Zoho People is not configured. Add USER_ZOHO_PEOPLE_CLIENT_ID/SECRET/REFRESH_TOKEN in .env.')
  }

  const body = new URLSearchParams({
    refresh_token: c.refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'refresh_token'
  })
  const res = await fetch(`https://${TOKEN_HOSTS[dc(db)]}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(`Zoho token refresh failed: ${data.error_description || data.error || JSON.stringify(data)}`)
  }

  db.settings.zohoPeople.accessToken = data.access_token
  db.settings.zohoPeople.tokenExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  return data.access_token
}

function isUnableToProcess(json, text) {
  const t = String(text || '').toLowerCase()
  if (t.includes('unabletoprocess') || t.includes('unable to process')) return true
  if (!json) return false
  if (String(json.msg || json.message || json.response?.message || '').toLowerCase().includes('unable')) return true
  return false
}

const NON_WORKING = ['week off', 'weekoff', 'personal leave', 'leave', 'studio closed', 'off', 'holiday', 'weekly off', 'absent', 'weekend']

function isWorkingShift(shiftName, status) {
  const shift = String(shiftName || '').toLowerCase().trim()
  const stat = String(status || '').toLowerCase().trim()
  if (!shift) return false
  if (NON_WORKING.some(off => shift.includes(off))) return false
  if (NON_WORKING.some(off => stat.includes(off))) return false
  return true
}

// Today's date in the org's local timezone (Zoho People reports shifts by
// calendar day, not UTC) — mirrors the sample n8n workflow's Asia/Kolkata
// convention since that's this app's only deployment region today.
export function todayKey() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Extracts { email -> {shiftName, status} } for `dateStr` out of whichever
// shape Zoho People's attendance API happens to return — the schema varies
// by API version/plan, so this defensively checks both the nested
// "attendanceDetails[date]" shape and the flat "key === date" shape.
function extractShiftsForDate(payload, dateStr) {
  const out = new Map()
  let records = []
  if (Array.isArray(payload.result)) records = payload.result
  else if (Array.isArray(payload.response?.result)) records = payload.response.result
  else if (Array.isArray(payload)) records = payload

  for (const item of records) {
    if (!item || typeof item !== 'object') continue
    if (item.attendanceDetails && item.employeeDetails) {
      const emp = item.employeeDetails
      const email = String(emp['mail id'] || emp.email || emp.EmailID || '').toLowerCase().trim()
      const today = item.attendanceDetails[dateStr]
      if (email && today && typeof today === 'object') {
        out.set(email, { shiftName: today.ShiftName || today.shiftName || today.shift || '', status: today.Status || today.status || '' })
      }
      continue
    }
    for (const [key, val] of Object.entries(item)) {
      if ((key === dateStr || key.includes(dateStr)) && val && typeof val === 'object') {
        const email = String(val.EmailID || val.emailId || item.EmailID || item.email || '').toLowerCase().trim()
        if (email) out.set(email, { shiftName: val.ShiftName || val.shiftName || val.shift || '', status: val.Status || val.status || '' })
      }
    }
  }
  return out
}

// Hits Zoho People's attendance report for `dateStr` and returns the set of
// employee emails who are on a genuine working shift (excludes week-offs,
// leave, holidays, absences). Throws on auth/API failure — callers decide
// how to fall back (see refreshOnDutyCache).
export async function fetchOnDutyEmails(db, dateStr) {
  const token = await getAccessToken(db)
  const host = API_HOSTS[dc(db)]
  const headers = { Authorization: `Zoho-oauthtoken ${token}` }

  const attempts = [
    { method: 'POST', url: `https://${host}/people/api/attendance/getUserReport`, body: `dateFormat=yyyy-MM-dd&sdate=${dateStr}&edate=${dateStr}` },
    { method: 'POST', url: `https://${host}/people/api/attendance/getShiftMapDetails`, body: `dateFormat=yyyy-MM-dd&sdate=${dateStr}&edate=${dateStr}` }
  ]

  const errors = []
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: attempt.method,
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: attempt.body
      })
      const text = await res.text()
      const json = JSON.parse(text || '{}')
      if (res.ok && !isUnableToProcess(json, text)) {
        const shifts = extractShiftsForDate(json, dateStr)
        const onDuty = new Set()
        for (const [email, s] of shifts) if (isWorkingShift(s.shiftName, s.status)) onDuty.add(email)
        return onDuty
      }
      errors.push(`${attempt.url}: ${text.slice(0, 150)}`)
    } catch (e) {
      errors.push(`${attempt.url}: ${e.message}`)
    }
  }
  throw new Error(`All Zoho People shift endpoints failed:\n${errors.join('\n')}`)
}

// Refreshes db.settings.zohoPeople.onDuty — the only thing nextAssociate()
// in roundRobin.js reads. Never throws: a failed fetch just leaves the
// previous cache in place (or empty) and records lastFetchError for the
// Settings UI, so a Zoho outage degrades to "assign from full roster"
// rather than breaking lead assignment.
export async function refreshOnDutyCache(db) {
  const c = config(db)
  if (!isConfigured(db)) return
  const date = todayKey()
  try {
    const emails = await fetchOnDutyEmails(db, date)
    c.onDuty = { date, emails: [...emails] }
    c.lastFetchAt = nowIso()
    c.lastFetchError = null
  } catch (e) {
    c.lastFetchAt = nowIso()
    c.lastFetchError = e.message
  }
}
