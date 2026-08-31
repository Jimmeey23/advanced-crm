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
export const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ')
const STATUS_HEADER = 'Sync Status'
const IMPORTED_MARK = 'Imported'
export const VALUE_RENDER_QUERY = '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER'

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
    mirrorTab: c.mirrorTab || '',
    fieldMapping: c.fieldMapping || {},
    defaults: c.defaults || {},
    lastSyncAt: c.lastSyncAt || null,
    lastSyncCounts: c.lastSyncCounts || null,
    // When a pass was last attempted, and why it failed if it did. A stale
    // `lastSyncAt` on its own cannot distinguish "nothing has run" from "every
    // run for the last hour was refused".
    lastSyncAttemptAt: c.lastSyncAttemptAt || null,
    lastSyncError: c.lastSyncError || null,
    // Presence only — the secret itself is handed out solely by the
    // apps-script endpoint, which requires an authenticated session.
    hasHookSecret: Boolean(c.hookSecret),
    pushInstalled: Boolean(c.lastHookAt),
    lastHookAt: c.lastHookAt || null
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

export async function sheetsFetch(db, url, opts = {}) {
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
  // UNFORMATTED_VALUE + SERIAL_NUMBER, not the API's FORMATTED_VALUE default.
  // A date cell displayed as "31-Dec" used to arrive as exactly that text, with
  // the year gone for good; as a serial number the full date always survives
  // whatever display format the sheet happens to use. Numbers come through as
  // numbers too, so "₹1,200" no longer has to be un-formatted downstream.
  const data = await sheetsFetch(db, `${SHEETS_BASE}/${c.sheetId}/values/${range}${VALUE_RENDER_QUERY}`)
  const values = data.values || []
  if (!values.length) return { header: [], rows: [] }
  return { header: values[0], rows: values.slice(1) }
}

export function colLetter(index) {
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

// The one-way importer that used to live here (runSync/runSyncInner) is gone.
// The sheet is now the source of truth rather than an inbox, and reconciling
// two-way is a different algorithm — see sheetSync.js. Keeping both would have
// meant two code paths writing the same rows to different rules.
