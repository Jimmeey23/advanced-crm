// server/auth.js
// Verifies the Supabase session on every API request and resolves the
// caller's role + location scope. Agents' locationIds are always
// recomputed from their matched associate row — never trusted from the
// client — so a forged query param can't widen access.
import { createClient } from '@supabase/supabase-js'

const ADMIN_CODE = '9818'

let serviceClient = null

// The random 48-character key in this exact inbound URL is its credential.
// Keep the matcher deliberately narrow so webhook management, logs, tests,
// and every other API route still require a Supabase session.
export function isPublicLeadWebhookPath(originalUrl) {
  const pathname = String(originalUrl || '').split('?')[0]
  return /^\/api\/webhooks\/leads\/[^/]+\/?$/.test(pathname)
}

function getServiceClient() {
  if (serviceClient) return serviceClient
  const url = (process.env.USER_SUPABASE_URL || '').trim()
  const key = (process.env.USER_SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !key) return null
  serviceClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return serviceClient
}

async function resolveAppUser(client, userId, email) {
  const { data: existing, error: readErr } = await client
    .from('app_users').select('role').eq('user_id', userId).maybeSingle()
  if (readErr) throw new Error(`app_users read failed: ${readErr.message}`)
  if (existing) return existing.role
  const { error: insertErr } = await client
    .from('app_users').insert({ user_id: userId, email, role: 'agent' })
  if (insertErr) throw new Error(`app_users insert failed: ${insertErr.message}`)
  return 'agent'
}

function findAssociateByEmail(db, email) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return null
  return db.associates.find(a => String(a.email || '').trim().toLowerCase() === target) || null
}

export function locationIdsOf(associate) {
  if (!associate) return []
  return [...new Set((associate.locationIds || [associate.locationId]).filter(Boolean))]
}

function buildAuthMiddleware(db, readToken) {
  return async (req, res, next) => {
    const client = getServiceClient()
    if (!client) return res.status(500).json({ error: 'Auth not configured: USER_SUPABASE_SERVICE_ROLE_KEY missing' })

    const token = readToken(req)
    if (!token) return res.status(401).json({ error: 'Missing bearer token' })

    const { data: userRes, error: userErr } = await client.auth.getUser(token)
    if (userErr || !userRes?.user) return res.status(401).json({ error: 'Invalid or expired session' })
    const { id: userId, email } = userRes.user

    let role
    try {
      role = await resolveAppUser(client, userId, email)
    } catch (e) {
      return res.status(502).json({ error: e.message })
    }

    const associate = findAssociateByEmail(db, email)
    const locationIds = role === 'admin' ? null : locationIdsOf(associate)

    req.authUser = { userId, email, role, associateId: associate?.id || null, locationIds }
    // Canonical scope handle for handlers that read a location under some
    // other param name (`studio`, `location`, `locations`, `entityId`, ...).
    // null = admin/unrestricted, array (possibly empty) = agent.
    req.locationScope = locationIds
    next()
  }
}

function bearerToken(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

export function requireAuth(db) {
  return buildAuthMiddleware(db, bearerToken)
}

// EventSource cannot set an Authorization header, so the SSE route (and only
// that route) also accepts the same Supabase access token as `?token=`.
// Everything else keeps the mandatory bearer-header requirement.
export function requireAuthWithQueryToken(db) {
  return buildAuthMiddleware(db, (req) => bearerToken(req) || (req.query?.token ? String(req.query.token) : null))
}

// Shared clamps for handlers that read a location under some name other than
// `locationId` (which scopeLocation already overwrites).
export function isAllowedLocation(req, locationId) {
  const scope = req.authUser?.locationIds
  if (scope === null || scope === undefined) return true // admin
  return !!locationId && scope.includes(locationId)
}

// Returns the ids an agent may actually see. `requestedIds` may be an array,
// a comma string, or empty/null meaning "all". Admins get `requestedIds` back
// as-is (null = unrestricted). Agents always get the intersection with their
// own locations — an empty request becomes their full (possibly empty) scope.
export function allowedLocationIds(req, requestedIds) {
  const asArray = requestedIds == null
    ? null
    : (Array.isArray(requestedIds) ? requestedIds : String(requestedIds).split(','))
      .map(s => String(s || '').trim()).filter(Boolean)
  const scope = req.authUser?.locationIds
  if (scope === null || scope === undefined) return asArray && asArray.length ? asArray : null
  if (!asArray || !asArray.length) return [...scope]
  return asArray.filter(id => scope.includes(id))
}

// Overwrites (never merely defaults) the location/associate filters on the
// request for agents, so a client can't ask for a different location than
// the one their associate record grants.
export function scopeLocation(req, res, next) {
  const { role, associateId, locationIds } = req.authUser
  if (role === 'admin') return next()

  const isInbox = req.originalUrl.startsWith('/api/inbox')
  if (isInbox) {
    req.query.associate = associateId || '__none__'
  } else {
    const value = (locationIds && locationIds.length) ? locationIds.join(',') : '__none__'
    req.query.locationId = value
    if (req.body && typeof req.body === 'object') req.body.locationId = value
  }
  next()
}

export function blockAgentWrite(req, res, next) {
  if (req.authUser.role === 'agent') return res.status(403).json({ error: 'Agents cannot perform this action' })
  next()
}

// Simple in-memory brute-force guard on the mastercode: 5 wrong guesses per
// user id inside a 15-minute window, then locked out until the window lapses.
// Process-local (resets on restart, not shared across instances) — good
// enough to stop online guessing of a 4-digit code from one client.
const ADMIN_CODE_MAX_ATTEMPTS = 5
const ADMIN_CODE_WINDOW_MS = 15 * 60 * 1000
const adminCodeAttempts = new Map()

function registerFailedAdminCode(userId) {
  const now = Date.now()
  const entry = adminCodeAttempts.get(userId)
  if (!entry || now - entry.first > ADMIN_CODE_WINDOW_MS) {
    adminCodeAttempts.set(userId, { count: 1, first: now })
  } else {
    entry.count++
  }
}

function isAdminCodeLocked(userId) {
  const entry = adminCodeAttempts.get(userId)
  if (!entry) return false
  if (Date.now() - entry.first > ADMIN_CODE_WINDOW_MS) {
    adminCodeAttempts.delete(userId)
    return false
  }
  return entry.count >= ADMIN_CODE_MAX_ATTEMPTS
}

export async function adminCodeHandler(req, res) {
  const client = getServiceClient()
  if (!client) return res.status(500).json({ error: 'Auth not configured' })
  const userId = req.authUser.userId
  if (isAdminCodeLocked(userId)) {
    return res.status(429).json({ error: 'Too many invalid admin code attempts. Try again later.' })
  }
  const code = String(req.body?.code || '').trim()
  if (code !== ADMIN_CODE) {
    registerFailedAdminCode(userId)
    return res.status(400).json({ error: 'Invalid admin code' })
  }
  adminCodeAttempts.delete(userId)

  try {
    const { error } = await client.from('app_users').update({ role: 'admin' }).eq('user_id', userId)
    if (error) return res.status(502).json({ error: error.message })
    res.json({ role: 'admin' })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
}
