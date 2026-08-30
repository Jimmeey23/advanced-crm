// Google Sheets lead import — OAuth2 + Sheets v4 REST client, plain fetch,
// no SDK, mirroring the style of momence.js. Connection is a single
// org-wide config stored in db.settings.googleSheets (this app has no
// login system, so there is no per-user identity to attach an OAuth grant
// to — same model as every other integration here).
import { nowIso } from './db.js'
import { resolveLeadFields, buildLeadPayloadFromResolved, isValidEmail, isValidPhone } from './leadFieldMapping.js'
import * as supabase from './supabaseStore.js'
import { randomUUID } from 'node:crypto'

const SYNC_OWNER_ID = randomUUID()

const OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ')
const STATUS_HEADER = 'Sync Status'
const IMPORTED_MARK = 'Imported'

export function config(db) {
  return db.settings.googleSheets || {}
}

export function isConnected(db) {
  const c = config(db)
  return Boolean(c.clientId && c.clientSecret && c.refreshToken)
}

export function isConfigured(db) {
  const c = config(db)
  return isConnected(db) && Boolean(c.sheetId && c.sheetTab)
}

export function sanitizedConfig(db) {
  const c = config(db)
  return {
    clientId: c.clientId || '',
    hasClientSecret: Boolean(c.clientSecret),
    connected: isConnected(db),
    connectedEmail: c.connectedEmail || '',
    sheetId: c.sheetId || '',
    sheetTab: c.sheetTab || '',
    fieldMapping: c.fieldMapping || {},
    defaults: c.defaults || {},
    lastSyncAt: c.lastSyncAt || null,
    lastSyncCounts: c.lastSyncCounts || null
  }
}

export function buildAuthUrl(db, redirectUri, state) {
  const c = config(db)
  if (!c.clientId) throw new Error('Add a Google Cloud OAuth Client ID and Secret first.')
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    // Forces Google to reissue a refresh_token on every connect — Google
    // only grants one on a user's very first consent otherwise, which would
    // silently break "reconnect" for anyone who already went through this.
    prompt: 'consent',
    state: state || ''
  })
  return `${OAUTH_BASE}?${params.toString()}`
}

export async function exchangeCode(db, code, redirectUri) {
  const c = config(db)
  if (!c.clientId || !c.clientSecret) throw new Error('Google OAuth client ID/secret is not configured.')
  const body = new URLSearchParams({
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Google OAuth exchange failed: ${data.error_description || data.error || JSON.stringify(data)}`)
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token — disconnect any prior grant for this app at myaccount.google.com/permissions and try connecting again.')
  }

  const userRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${data.access_token}` } })
  const user = await userRes.json().catch(() => ({}))

  db.settings.googleSheets = {
    ...c,
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    tokenExpiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    connectedEmail: user.email || ''
  }
  return db.settings.googleSheets
}

export function disconnect(db) {
  const c = config(db)
  db.settings.googleSheets = {
    ...c,
    refreshToken: '',
    accessToken: '',
    tokenExpiresAt: '',
    connectedEmail: ''
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

  const c = config(db)
  if (!c.clientId || !c.clientSecret || !c.refreshToken) {
    throw new Error('Google Sheets is not connected. Connect your Google account in Settings.')
  }

  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: c.refreshToken,
    grant_type: 'refresh_token'
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (data.error === 'invalid_grant') {
      throw new Error('Google access was revoked or expired. Reconnect your Google account in Settings.')
    }
    throw new Error(`Google token refresh failed: ${data.error_description || data.error || JSON.stringify(data)}`)
  }

  db.settings.googleSheets.accessToken = data.access_token
  db.settings.googleSheets.tokenExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  return data.access_token
}

// A permission/not-found error from Sheets comes back as JSON with a
// `.error.message` — surface that verbatim rather than a generic 500, same
// spirit as LeadDrawer's humanMomenceError translator for Momence.
//
// The Sheets API enforces a per-minute write quota per user/project. A large
// sheet's sync flushes a batchUpdate every FLUSH_EVERY rows — on a big sheet
// (or two syncs racing) that can burst past the limit and 429. Google's own
// guidance for this is client-side exponential backoff, not failing the
// whole sync outright, so retry a handful of times before giving up.
const MAX_RETRIES = 5
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function sheetsFetch(db, url, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(db)
    const res = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` }
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const isQuota = res.status === 429 || data.error?.status === 'RESOURCE_EXHAUSTED'
      if (isQuota && attempt < MAX_RETRIES) {
        // Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s (+/- jitter).
        const delay = Math.round((2 ** attempt) * 1000 * (0.5 + Math.random()))
        await sleep(delay)
        continue
      }
      const msg = data.error?.message || res.statusText
      throw new Error(`Google Sheets API error: ${msg}`)
    }
    return data
  }
}

export async function readSheetRows(db) {
  const c = config(db)
  if (!c.sheetId || !c.sheetTab) throw new Error('No sheet configured yet.')
  const range = encodeURIComponent(c.sheetTab)
  const data = await sheetsFetch(db, `${SHEETS_BASE}/${c.sheetId}/values/${range}`)
  const values = data.values || []
  if (!values.length) return { header: [], rows: [] }
  return { header: values[0], rows: values.slice(1) }
}

function colLetter(index) {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

async function writeStatusColumn(db, statusColIndex, rowUpdates) {
  const c = config(db)
  const col = colLetter(statusColIndex)
  const data = rowUpdates.map(({ sheetRowNumber }) => ({
    range: `${c.sheetTab}!${col}${sheetRowNumber}`,
    values: [[`${IMPORTED_MARK} ${nowIso()}`]]
  }))
  if (!data.length) return
  await sheetsFetch(db, `${SHEETS_BASE}/${c.sheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data })
  })
}

// Runs one sync pass: reads the sheet, skips rows already marked in the
// status column, resolves the rest through the shared mapping/alias
// resolver, dedups against existing leads, creates the new ones, and
// writes the status column back for every row it just processed.
// `force: true` ignores the status-column check entirely (still dedups
// against whatever leads currently exist) — for when the sheet's marker
// column says "already imported" but the app-side leads it created were
// since deleted, and the intent is a genuine full re-pull.
// Without this, two runs overlapping (the 30-minute background poll firing
// mid-way through a manual "Sync now" on a large sheet, or a double click)
// both read the sheet before either has written its "Imported" markers back
// — every row still looks unprocessed to both, so both create a lead for
// it: a full duplicate set of the sheet. A large sheet (tens of thousands of
// rows) easily takes long enough for this to happen in practice.
//
// This in-process flag only stops two overlapping runs *within the same
// server instance*. When Supabase is configured, multiple server instances
// can share one project (see db.js's applyRemoteLeadChange), each with its
// own syncInFlight — so the same overlap can happen across instances, and
// this flag alone can't see it. acquireSyncLock()/releaseSyncLock() close
// that gap with a lock row Postgres enforces atomically via a unique
// constraint (see supabaseStore.js); this flag stays as the fast local
// short-circuit and the fallback when Supabase isn't configured at all.
let syncInFlight = false

export async function runSync(db, { createLeadFrom, updateLeadFromPayload, findDuplicateLead, assignLead, markDirty, logSync, force = false }) {
  if (!isConfigured(db)) throw new Error('Google Sheets is not fully configured yet.')
  if (syncInFlight) throw new Error('A sync is already in progress — wait for it to finish before starting another.')
  syncInFlight = true
  const gotRemoteLock = await supabase.acquireSyncLock(SYNC_OWNER_ID)
  if (!gotRemoteLock) {
    syncInFlight = false
    throw new Error('A sync is already in progress on another server instance — wait for it to finish before starting another.')
  }
  try {
    return await runSyncInner(db, { createLeadFrom, updateLeadFromPayload, findDuplicateLead, assignLead, markDirty, logSync, force })
  } finally {
    syncInFlight = false
    await supabase.releaseSyncLock()
  }
}

async function runSyncInner(db, { createLeadFrom, updateLeadFromPayload, findDuplicateLead, assignLead, markDirty, logSync, force = false }) {
  const c = config(db)
  const { header, rows } = await readSheetRows(db)
  if (!header.length) return { created: 0, duplicates: 0, skipped: 0 }

  let statusColIndex = header.findIndex(h => String(h).trim().toLowerCase() === STATUS_HEADER.toLowerCase())
  const needsStatusHeader = statusColIndex === -1
  if (needsStatusHeader) statusColIndex = header.length

  if (needsStatusHeader) {
    const col = colLetter(statusColIndex)
    await sheetsFetch(db, `${SHEETS_BASE}/${c.sheetId}/values/${c.sheetTab}!${col}1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[STATUS_HEADER]] })
    })
  }

  let created = 0, updated = 0, duplicates = 0, skipped = 0
  let alreadyImported = 0, blankRows = 0, missingFields = 0
  let toMarkImported = []
  // Flushed periodically rather than once at the very end — on a very large
  // sheet (tens of thousands of rows) a single run can take long enough that
  // a crash or redeploy mid-run would otherwise leave every already-created
  // lead's row unmarked, and the next sync would recreate all of them.
  const FLUSH_EVERY = 250
  const flush = async () => {
    if (!toMarkImported.length) return
    await writeStatusColumn(db, statusColIndex, toMarkImported)
    toMarkImported = []
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const sheetRowNumber = i + 2 // +1 for 0-index, +1 for header row
    const existingStatus = statusColIndex < row.length ? String(row[statusColIndex] || '').trim() : ''
    // Only treat OUR OWN marker as "already imported" — a "Sync Status"
    // column that pre-existed in the sheet (common: this app didn't create
    // it) can already be full of unrelated values, and skipping every row
    // that merely has *something* in that column was skipping the entire
    // sheet on the very first sync.
    const wasImported = !force && existingStatus.startsWith(IMPORTED_MARK)

    const record = {}
    header.forEach((h, idx) => { if (h) record[String(h).trim()] = row[idx] })
    if (!Object.values(record).some(v => String(v || '').trim())) { blankRows++; skipped++; continue }

    const resolved = resolveLeadFields(record, c)
    const name = resolved.fullName ? String(resolved.fullName).trim() : ''
    const email = resolved.email ? String(resolved.email).trim() : ''
    const phone = resolved.phone ? String(resolved.phone).trim() : ''
    // A non-empty email/phone cell isn't necessarily usable — "N/A", a typo,
    // a stray note — so this checks actual format validity, not just
    // presence, and rejects the row rather than creating an unreachable lead.
    if (!name || (!isValidEmail(email) && !isValidPhone(phone))) { missingFields++; skipped++; continue }

    const dup = findDuplicateLead(email, phone, name)
    if (dup) {
      // A row synced before can still change in the sheet afterwards (stage
      // moved, notes added, a purchase logged) — re-applying it here keeps
      // the existing lead current instead of the sheet only ever being able
      // to create leads once and never touch them again.
      if (updateLeadFromPayload) {
        const payload = buildLeadPayloadFromResolved(resolved, db, 'Google Sheets', record)
        if (updateLeadFromPayload(dup, payload)) { updated++; markDirty(dup.id) }
      }
      duplicates++
      if (wasImported) { alreadyImported++ } else { toMarkImported.push({ sheetRowNumber }) }
    } else if (wasImported) {
      // Marked imported previously but no matching lead exists anymore
      // (deleted since) — leave it alone unless this is an explicit force
      // re-pull, which already ignores the marker entirely.
      alreadyImported++
      skipped++
    } else {
      // Google Sheets leads keep whatever owner the sheet's own associate
      // column resolved to — including unassigned. Round-robin must never
      // override that; it's for leads created without an explicit owner
      // from a source that doesn't carry one (e.g. the Add Lead form).
      const lead = createLeadFrom(buildLeadPayloadFromResolved(resolved, db, 'Google Sheets', record))
      db.leads.push(lead)
      markDirty(lead.id)
      created++
      toMarkImported.push({ sheetRowNumber })
    }

    if (toMarkImported.length >= FLUSH_EVERY) await flush()
  }

  await flush()

  const counts = { created, updated, duplicates, skipped, alreadyImported, blankRows, missingFields }
  db.settings.googleSheets.lastSyncAt = nowIso()
  db.settings.googleSheets.lastSyncCounts = counts
  logSync('synced', `${created} created, ${updated} updated, ${duplicates} duplicate, ${skipped} skipped (${alreadyImported} already imported, ${blankRows} blank, ${missingFields} missing name/contact)`)
  return counts
}
