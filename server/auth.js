// server/auth.js
// Verifies the Supabase session on every API request and resolves the
// caller's role + location scope. Agents' locationIds are always
// recomputed from their matched associate row — never trusted from the
// client — so a forged query param can't widen access.
import { createClient } from '@supabase/supabase-js'

const ADMIN_CODE = '9818'

let serviceClient = null
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

export function requireAuth(db) {
  return async (req, res, next) => {
    const client = getServiceClient()
    if (!client) return res.status(500).json({ error: 'Auth not configured: USER_SUPABASE_SERVICE_ROLE_KEY missing' })

    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
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
    next()
  }
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

export function adminCodeHandler(req, res) {
  const client = getServiceClient()
  if (!client) return res.status(500).json({ error: 'Auth not configured' })
  const code = String(req.body?.code || '').trim()
  if (code !== ADMIN_CODE) return res.status(400).json({ error: 'Invalid admin code' })

  client.from('app_users').update({ role: 'admin' }).eq('user_id', req.authUser.userId)
    .then(({ error }) => {
      if (error) return res.status(502).json({ error: error.message })
      res.json({ role: 'admin' })
    })
}
