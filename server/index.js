import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import { init, load, save, saveNow, saveMetaNow, uid, nowIso, reset, markDirty, markDeleted, onRemoteChange } from './db.js'
import { enrichAll, enrichLead } from './ai.js'
import { assignLead } from './roundRobin.js'
import * as momence from './momence.js'
import { createMomenceDashboardClient } from './momenceDashboardAuth.js'
import { createDiscountCodeHandlers, createDiscountCodeService } from './momenceDiscountCodes.js'
import * as gpt from './gpt.js'
import * as respondio from './respondio.js'
import * as respondioInternal from './respondioInternal.js'
import * as inbox from './inbox.js'
import * as mailer from './mailer.js'
import * as supabase from './supabaseStore.js'
import { requireAuth, requireAuthWithQueryToken, scopeLocation, blockAgentWrite, adminCodeHandler, isAllowedLocation, allowedLocationIds, isPublicLeadWebhookPath } from './auth.js'
import { runReminderDigest, startReminderScheduler } from './reminders.js'
import { parseCsv, autoMap, normalizeStage, normalizeStatus, parseFlexibleDate } from './csv.js'
import { STATUS_GROUPS, statusGroupOf } from './leadStatus.js'
import { resolveLeadFields, buildLeadPayloadFromResolved, suggestMappingFromKeys, isValidEmail, isValidPhone, LEAD_FIELD_ALIASES } from './leadFieldMapping.js'
import * as googleSheets from './googleSheets.js'
import * as zohoPeople from './zohoPeople.js'
import { findDuplicateAmong, clusterDuplicates } from './duplicateMatch.js'
import { normalizeFollowUpFields } from './followUps.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load USER_* secrets from a local .env file if present (never overrides real env).
try {
  const envFile = path.join(__dirname, '..', '.env')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  }
} catch (e) { /* ignore */ }

const app = express()
const serverStartedAt = new Date().toISOString()
let activePort = null
// Railway (and most PaaS hosts) terminate TLS at a proxy in front of this
// process, so the request Express actually sees is plain HTTP — without this,
// req.protocol always reports "http" even on the public https:// URL, which
// breaks anything that builds an absolute URL from it (Google OAuth redirect
// URI, webhook URLs): Google rejects the OAuth callback because the http://
// URI it's given was never registered (only the real https:// one was).
app.set('trust proxy', true)

// Stripe signature verification requires the exact, unparsed request body.
// Keep this route ahead of express.json(); every other API route remains JSON.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = verifyStripeWebhook(req.body, req.headers['stripe-signature'])
    applyStripeEvent(event)
    res.json({ received: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// Frontend and API can be deployed to separate origins (e.g. frontend on
// Vercel, this server on Railway) — allow cross-origin requests. Restrict
// via CORS_ORIGIN (comma-separated list) once the frontend's real domain is
// known; defaults to "*" since the API takes no cookies/credentials.
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
app.use((req, res, next) => {
  const origin = req.headers.origin
  res.header('Access-Control-Allow-Origin', corsOrigins.length ? (corsOrigins.includes(origin) ? origin : corsOrigins[0]) : '*')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json({ limit: '200mb' }))
app.use(express.urlencoded({ extended: true, limit: '200mb' }))

// Public health check stays unauthenticated; everything else under /api
// requires a verified Supabase session. `db` is declared further below and
// only populated once startup loads it, so these wrap the lookup in a
// closure that reads the module-level `db` binding at request time rather
// than capturing it (which would still be `null`) at route-registration time.
app.get('/api/auth/whoami', (req, res, next) => requireAuth(db)(req, res, next), (req, res) => res.json(req.authUser))
app.post('/api/auth/admin-code', (req, res, next) => requireAuth(db)(req, res, next), adminCodeHandler)
app.use('/api', (req, res, next) => {
  // /runtime is the public health check. /events is the SSE stream, which the
  // browser opens with EventSource — it cannot set an Authorization header, so
  // that one route authenticates itself off `?token=` in its own handler
  // below. Nothing else is exempt from the mandatory bearer token.
  if (req.path === '/runtime' || req.path === '/events' || isPublicLeadWebhookPath(req.originalUrl)) return next()
  requireAuth(db)(req, res, (err) => {
    if (err) return next(err)
    scopeLocation(req, res, next)
  })
})
app.delete('/api/leads/bulk', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/leads/import/parse', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/leads/import/apply', (req, res, next) => blockAgentWrite(req, res, next))
// Org-wide configuration writes. Agents' locationIds are re-derived on every
// request from db.associates[].email, so letting an agent write the associate
// or location tables would let them grant themselves every location (or mint
// a second associate row on their own email) and escape their scope entirely.
app.put('/api/associates', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/associates', (req, res, next) => blockAgentWrite(req, res, next))
app.patch('/api/associates/:id', (req, res, next) => blockAgentWrite(req, res, next))
app.put('/api/locations', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/locations', (req, res, next) => blockAgentWrite(req, res, next))
app.patch('/api/locations/:id', (req, res, next) => blockAgentWrite(req, res, next))
app.put('/api/settings', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/reset', (req, res, next) => blockAgentWrite(req, res, next))
// Integration credentials + webhook config: same self-escalation surface
// (a webhook mapping or a rewritten Momence/Sheets credential can inject or
// re-home leads across every location), and none of it is agent-facing.
app.post('/api/webhooks', (req, res, next) => blockAgentWrite(req, res, next))
app.patch('/api/webhooks/:id', (req, res, next) => blockAgentWrite(req, res, next))
app.delete('/api/webhooks/:id', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/webhooks/:id/regenerate', (req, res, next) => blockAgentWrite(req, res, next))
app.put('/api/google-sheets/config', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/google-sheets/disconnect', (req, res, next) => blockAgentWrite(req, res, next))
app.put('/api/zoho-people/config', (req, res, next) => blockAgentWrite(req, res, next))
app.put('/api/momence/config', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/leads/dedupe', (req, res, next) => blockAgentWrite(req, res, next))
app.put('/api/lists', (req, res, next) => blockAgentWrite(req, res, next))

// Lets the local frontend discover this instance if the preferred API port
// was occupied and startup moved to the next available port.
app.get('/api/runtime', (req, res) => res.json({ app: 'physique57-leads', port: activePort, startedAt: serverStartedAt }))

// express.json() throws a raw SyntaxError (which the default Express handler
// would render as an HTML error page) when the body isn't valid JSON — most
// relevant for external callers of the inbound webhook endpoint below, who
// need a JSON error body back to know what went wrong.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Malformed JSON body' })
  }
  next(err)
})

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || '').trim()
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()
const STRIPE_BASE = 'https://api.stripe.com/v1'

let db = null
const momenceDashboardClient = createMomenceDashboardClient()
const momenceDiscountService = createDiscountCodeService({ client: momenceDashboardClient })
const momenceDiscountHandlers = createDiscountCodeHandlers({
  service: momenceDiscountService,
  getDb: () => db,
  saveMeta: saveMetaNow,
  sendMail: mailer.sendMail,
  makeId: () => uid('dcr')
})

function log(type, text, leadId = null) {
  db.activity.unshift({ id: uid('act'), ts: nowIso(), type, text, leadId })
  if (db.activity.length > 300) db.activity.length = 300
  save()
}

const openStatuses = ['open', 'won', 'lost']

// ---------- helpers ----------

function leadById(id) {
  return db.leads.find(l => l.id === id)
}

function ensurePaymentsShape() {
  if (!Array.isArray(db.payments)) db.payments = []
}

function verifyStripeWebhook(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET) throw new Error('Stripe webhook secret is not configured.')
  const parts = Object.fromEntries(String(signatureHeader || '').split(',').map(part => part.split('=')))
  if (!parts.t || !parts.v1) throw new Error('Missing Stripe webhook signature.')
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) throw new Error('Expired Stripe webhook signature.')
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '')
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${parts.t}.${payload}`).digest('hex')
  const actualBuffer = Buffer.from(parts.v1, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) throw new Error('Invalid Stripe webhook signature.')
  return JSON.parse(payload)
}

function applyStripeEvent(event) {
  if (!db) throw new Error('CRM is still starting.')
  const session = event?.data?.object
  if (!session?.id || !String(event.type || '').startsWith('checkout.session.')) return
  ensurePaymentsShape()
  const paymentLinkId = typeof session.payment_link === 'string' ? session.payment_link : session.payment_link?.id
  const payment = db.payments.find(item => item.checkoutSessionId === session.id || (paymentLinkId && item.paymentLinkId === paymentLinkId))
  if (!payment) return
  payment.status = event.type === 'checkout.session.expired' ? 'expired' : (session.payment_status || session.status || payment.status)
  payment.paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || payment.paymentIntentId || null
  payment.customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || payment.customerId || null
  payment.paidAt = payment.status === 'paid' ? (payment.paidAt || nowIso()) : payment.paidAt || null
  payment.updatedAt = nowIso()
  payment.checkoutSessionId = session.id
  const lead = leadById(payment.leadId)
  if (lead) markDirty(lead.id)
  save()
  log('payment', `${payment.leadName} payment ${payment.status}`, payment.leadId)
  broadcastChange('stripe-payment', { leadId: payment.leadId, status: payment.status })
}

async function stripeRequest(path, { method = 'GET', body } = {}) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe is not configured. Add STRIPE_SECRET_KEY to the environment.')
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body ? new URLSearchParams(Object.entries(body).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString() : undefined
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(data.error?.message || data.message || `Stripe API ${res.status}`)
  return data
}

function paymentRecordFromLead(lead, payload, status = 'open') {
  ensurePaymentsShape()
  const now = nowIso()
  return {
    id: uid('pay'),
    leadId: lead.id,
    leadName: lead.fullName,
    locationId: lead.locationId,
    classType: lead.classType || '',
    amount: payload.amount || null,
    currency: payload.currency || 'inr',
    provider: 'stripe',
    status,
    checkoutSessionId: payload.checkoutSessionId || null,
    paymentLinkId: payload.paymentLinkId || null,
    checkoutUrl: payload.checkoutUrl || null,
    items: payload.items || [],
    description: payload.description || '',
    paidAt: null,
    createdAt: now,
    updatedAt: now,
    metadata: payload.metadata || {}
  }
}

function stripePaymentSummary(lead) {
  ensurePaymentsShape()
  const payments = db.payments.filter(payment => String(payment.leadId) === String(lead.id))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
  if (!payments.length) return null
  const paid = payments.find(payment => payment.status === 'paid')
  const latest = paid || payments[0]
  return {
    status: paid ? 'paid' : latest.status,
    count: payments.length,
    latestId: latest.id,
    amount: latest.amount,
    currency: latest.currency,
    checkoutUrl: latest.checkoutUrl,
    paidAt: paid?.paidAt || null
  }
}

function withStripePayment(lead) {
  return { ...lead, stripePayment: stripePaymentSummary(lead) }
}

function safePatch(lead, body) {
  const allowed = ['fullName', 'phone', 'email', 'stage', 'status', 'associateId', 'locationId',
    'sourceName', 'sourceId', 'remarks', 'classType', 'center', 'channel', 'memberId', 'valueEstimate', 'convertedAt', 'manualFlags', 'statusGroup', 'ai']
  for (const key of allowed) {
    if (key in body) lead[key] = body[key]
  }
  if ('sourceName' in body && !('channel' in body)) {
    lead.channel = db.settings.business?.sourceChannelMap?.[lead.sourceName] || lead.channel || 'Other'
  }
  if ('stage' in body && body.stage) {
    lead.status = normalizeStatus(body.stage, body.status)
    if (lead.status === 'won' && !lead.convertedAt) lead.convertedAt = new Date().toISOString().slice(0, 10)
  }
  if ('fullName' in body) lead.fullName = String(body.fullName || '').trim()
  lead.updatedAt = nowIso()
  save()
}

function computeFollowUpState(lead) {
  const today = new Date().toISOString().slice(0, 10)
  const open = lead.status === 'open'
  const pending = (lead.followUps || []).filter(f => f.date && f.date !== '-' && !f.done)
  const next = pending.sort((a, b) => a.date.localeCompare(b.date))[0]
  if (!next || !open) return { due: null, overdue: null, nextDate: null }
  const overdue = next.date < today ? (new Date(today).getTime() - new Date(next.date).getTime()) / 86400000 : 0
  return {
    due: next.date === today ? 'today' : null,
    overdue: next.date < today ? Math.round(overdue) : null,
    nextDate: next.date
  }
}

function buildAlerts(scope = {}, req = null) {
  const today = new Date().toISOString().slice(0, 10)
  const alerts = []
  const cad = db.settings.cadence || { outreachDays: 7 }
  const notif = db.settings.notifications || {}
  // `req` is passed so alerts obey the caller's location scope too — without
  // it an agent's alert feed would surface leads from every studio.
  const leads = req ? scopeLeadsForReq(req) : ((scope.studio || scope.associate) ? scopeLeads(db.leads, scope) : db.leads)
  if (req?.authUser?.role === 'admin') {
    for (const request of (db.ownerChangeRequests || [])) {
      if (request.status !== 'pending') continue
      alerts.push({
        id: uid('alt'), leadId: request.leadId, leadName: request.leadName, level: 'high',
        kind: 'owner_change_request', title: 'Owner change requested',
        detail: `${request.requestedByName} wants to reassign to ${request.requestedAssociateName}.`
      })
    }
    for (const request of (db.discountCodeRequests || [])) {
      if (request.status !== 'pending') continue
      alerts.push({
        id: `discount-request-${request.id}`, level: 'high', kind: 'discount_code_request', view: 'discount-codes',
        leadName: request.payload?.code || 'Discount code', title: 'Discount code approval requested',
        detail: `${request.requestedByName || request.requestedByEmail || 'An agent'} requested a ${request.market === 'blr' ? 'Bengaluru' : 'Mumbai'} code.`
      })
    }
  } else {
    const cutoff = Date.now() - 30 * 86400000
    for (const request of (db.discountCodeRequests || [])) {
      if (!['approved', 'declined'].includes(request.status)) continue
      if (request.requestedByUserId !== req?.authUser?.userId && request.requestedByEmail !== req?.authUser?.email) continue
      if (new Date(request.decidedAt || 0).getTime() < cutoff) continue
      alerts.push({
        id: `discount-decision-${request.id}`, level: request.status === 'approved' ? 'low' : 'medium',
        kind: request.status === 'approved' ? 'discount_code_approved' : 'discount_code_declined', view: 'discount-codes',
        leadName: request.payload?.code || 'Discount code',
        title: `Discount code request ${request.status}`,
        detail: request.status === 'approved' ? 'The code was created directly in Momence.' : (request.decisionNote || 'The admin declined this request.')
      })
    }
  }
  for (const lead of leads) {
    if (lead.status !== 'open') continue
    const e = enrichLead(lead, db)
    const fu = computeFollowUpState(lead)

    if (notif.followUpAlerts !== false) {
      if (fu.overdue && fu.overdue <= 90) {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'high',
          kind: 'missed_followup', title: `Follow-up missed by ${fu.overdue}d`, detail: `Next follow-up was due ${fu.nextDate}. ${e.fu.missedCount} task${e.fu.missedCount === 1 ? '' : 's'} pending.`,
          score: e.ai.score
        })
      } else if (fu.due === 'today') {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'medium',
          kind: 'today', title: 'Follow-up due today', detail: `Scheduled contact for ${fu.nextDate}.`,
          score: e.ai.score
        })
      }
    }

    if (notif.missedOutreachAlerts !== false) {
      const idleDays = e.fu.lastOutreachDays
      const hasSteps = Array.isArray(cad.steps) && cad.steps.length
      const threshold = hasSteps ? null : (cad.outreachDays || 7)
      const overdueDays = hasSteps ? e.fu.cadence.overdueDays : (idleDays > threshold ? idleDays : 0)
      if (overdueDays > 0 && idleDays <= 60 && lead.createdAt) {
        const age = Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 86400000)
        if (!hasSteps && age <= threshold) { /* skip: age gate for the flat-threshold path only */ }
        else {
          alerts.push({
            id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'medium',
            kind: 'missed_outreach',
            title: hasSteps ? `Follow-up #${e.fu.cadence.stepIndex} cadence overdue` : `Missed outreach — ${idleDays}d silent`,
            detail: `No contact logged in ${idleDays} days. AI has a ready WhatsApp draft.`,
            score: e.ai.score
          })
        }
      }
    }

    if (notif.customRuleAlerts !== false) {
      for (const flag of e.flags || []) {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'medium',
          kind: 'custom_rule', title: flag.label, detail: `Custom rule "${flag.name}" matched.`,
          color: flag.color, score: e.ai.score
        })
      }
    }

    if (!lead.associateId) {
      alerts.push({
        id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'high',
        kind: 'unassigned', title: 'Lead awaiting assignment', detail: 'Round-robin can assign instantly.',
        score: e.ai.score
      })
    }

    if (notif.highValueAlerts !== false && e.ai.score >= 70 && lead.lastActivityAt) {
      const idle = (Date.now() - new Date(lead.lastActivityAt).getTime()) / 86400000
      if (idle > 3) {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'high',
          kind: 'high_value', title: 'High-value lead idle', detail: `No activity for ${Math.round(idle)} days (score ${e.ai.score}).`,
          score: e.ai.score
        })
      }
    }

    if (notif.leadAgeAlerts !== false && (lead.followUps || []).length === 0 && lead.createdAt) {
      const age = (Date.now() - new Date(lead.createdAt).getTime()) / 86400000
      if (age > 7) {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'medium',
          kind: 'stale', title: 'Lead cold — no follow-ups', detail: `Created ${Math.round(age)}d ago with zero logged follow-ups.`,
          score: e.ai.score
        })
      }
    }
  }
  const order = { high: 0, medium: 1, low: 2 }
  return alerts.sort((a, b) => order[a.level] - order[b.level] || (b.score || 0) - (a.score || 0)).slice(0, 150)
}

// ---------- bootstrap ----------

app.get('/api/bootstrap', (req, res) => {
  res.json({
    authUser: req.authUser,
    settings: db.settings,
    locations: db.locations,
    associates: db.associates,
    stages: db.stages,
    statusGroups: STATUS_GROUPS,
    stageStatusGroups: Object.fromEntries(db.stages.map(s => [s, statusGroupOf(s)])),
    sources: db.sources,
    channels: db.channels,
    classTypes: db.classTypes,
    integrations: {
      supabase: supabase.isEnabled(),
      gpt: gpt.isEnabled(db),
      gptModel: gpt.modelName(db),
      respondio: respondio.isConfigured(db),
      mailtrap: mailer.isConfigured(db),
      momence: momence.isConfigured(db),
      stripe: Boolean(STRIPE_SECRET_KEY)
    },
    webhookIntegrations: db.webhookIntegrations
  })
})

// ---------- alerts ----------

app.get('/api/alerts', (req, res) => res.json(buildAlerts(req.query, req)))

// ---------- locations ----------

app.get('/api/locations', (req, res) => res.json(db.locations))
app.put('/api/locations', (req, res) => {
  if (Array.isArray(req.body)) db.locations = req.body.map(l => ({ ...l }))
  save()
  res.json(db.locations)
})
app.post('/api/locations', (req, res) => {
  const loc = { id: uid('loc'), active: true, ...req.body }
  db.locations.push(loc)
  save()
  log('location', `Added location ${loc.name}`)
  res.status(201).json(loc)
})
app.patch('/api/locations/:id', (req, res) => {
  const loc = db.locations.find(l => l.id === req.params.id)
  if (!loc) return res.status(404).json({ error: 'Location not found' })
  Object.assign(loc, req.body)
  save()
  res.json(loc)
})

// ---------- associates ----------

function normalizeAssociate(input = {}) {
  const locationIds = [...new Set(
    (Array.isArray(input.locationIds) ? input.locationIds : [input.locationId])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  )]
  return {
    ...input,
    locationIds,
    locationId: locationIds[0] || null,
    revenueTargetMonthly: Math.max(0, Number(input.revenueTargetMonthly) || 0),
    conversionTargetPct: Math.min(100, Math.max(0, Number(input.conversionTargetPct) || 0))
  }
}

function associateInLocation(associate, locationId) {
  return (associate.locationIds || [associate.locationId]).filter(Boolean).includes(locationId)
}

app.get('/api/associates', (req, res) => {
  if (!req.query.locationId) return res.json(db.associates)
  const ids = String(req.query.locationId).split(',').filter(Boolean)
  res.json(db.associates.filter(a => ids.some(id => associateInLocation(a, id))))
})
// Bulk-replacing the roster used to take the client's ids verbatim. A save
// that round-tripped rows without ids (or with regenerated ones) minted
// fresh `asn_*` ids for people who already existed, and every lead still
// pointing at the old id silently rendered as "Unassigned". Identity is now
// re-established from email, then name, before a new id is ever issued, so
// a roster save can no longer orphan lead ownership.
function reconcileAssociateIdentity(incoming) {
  const byEmail = new Map()
  const byName = new Map()
  for (const a of db.associates) {
    const email = String(a.email || '').trim().toLowerCase()
    const name = String(a.name || '').trim().toLowerCase()
    if (email) byEmail.set(email, a.id)
    if (name && !byName.has(name)) byName.set(name, a.id)
  }
  const used = new Set()
  return incoming.map(raw => {
    const email = String(raw.email || '').trim().toLowerCase()
    const name = String(raw.name || '').trim().toLowerCase()
    let id = raw.id && db.associates.some(a => a.id === raw.id) ? raw.id : null
    if (!id && email && byEmail.has(email)) id = byEmail.get(email)
    if (!id && name && byName.has(name)) id = byName.get(name)
    if (!id || used.has(id)) id = uid('asn')
    used.add(id)
    return normalizeAssociate({ ...raw, id })
  })
}

app.put('/api/associates', async (req, res) => {
  if (Array.isArray(req.body)) db.associates = reconcileAssociateIdentity(req.body)
  try { await saveMetaNow() }
  catch (e) { return res.status(502).json({ error: `Could not save associates: ${e.message}` }) }
  res.json(db.associates)
})

// Repairs leads whose `associateId` no longer matches any associate — the
// damage a pre-reconciliation roster save left behind. Resolves through the
// lead's own `associateName` first, then its email domain match, and reports
// what it could not resolve rather than guessing.
app.post('/api/maintenance/repair-owner-links', (req, res, next) => requireAuth(db)(req, res, next), async (req, res) => {
  if (req.authUser.role !== 'admin') return res.status(403).json({ error: 'Only admins can repair owner links' })
  const valid = new Set(db.associates.map(a => a.id))
  const byName = new Map()
  const byEmail = new Map()
  for (const a of db.associates) {
    const name = String(a.name || '').trim().toLowerCase()
    const email = String(a.email || '').trim().toLowerCase()
    if (name) byName.set(name, a.id)
    if (email) byEmail.set(email, a.id)
  }

  let repaired = 0
  let cleared = 0
  let untouched = 0
  const unresolvedNames = new Map()
  const dryRun = req.body?.dryRun !== false

  for (const lead of db.leads) {
    if (!lead.associateId || valid.has(lead.associateId)) { untouched++; continue }
    const name = String(lead.associateName || '').trim().toLowerCase()
    const email = String(lead.associateEmail || '').trim().toLowerCase()
    const resolved = (email && byEmail.get(email)) || (name && byName.get(name)) || null
    if (resolved) {
      repaired++
      if (!dryRun) lead.associateId = resolved
    } else {
      cleared++
      // An unresolvable orphan is worse than an unowned lead: it renders as
      // "Unassigned" but blocks round-robin, which only fills a null owner.
      if (!dryRun) lead.associateId = null
      if (name) unresolvedNames.set(name, (unresolvedNames.get(name) || 0) + 1)
    }
  }

  if (!dryRun && (repaired || cleared)) {
    db.leads.forEach(l => markDirty(l.id))
    try { await saveNow() }
    catch (e) { return res.status(502).json({ error: `Could not save repaired leads: ${e.message}` }) }
    log('maintenance', `Repaired ${repaired} owner links, cleared ${cleared} unresolvable`)
  }

  res.json({
    dryRun,
    repaired,
    cleared,
    untouched,
    unresolvedNames: [...unresolvedNames.entries()].map(([name, count]) => ({ name, count })).slice(0, 40)
  })
})
app.post('/api/associates', async (req, res) => {
  const asn = normalizeAssociate({ id: uid('asn'), active: true, order: db.associates.length, ...req.body })
  db.associates.push(asn)
  log('associate', `Added associate ${asn.name}`)
  try { await saveMetaNow() }
  catch (e) { return res.status(502).json({ error: `Could not save associate: ${e.message}` }) }
  res.status(201).json(asn)
})
app.patch('/api/associates/:id', async (req, res) => {
  const asn = db.associates.find(a => a.id === req.params.id)
  if (!asn) return res.status(404).json({ error: 'Associate not found' })
  Object.assign(asn, normalizeAssociate({ ...asn, ...req.body }))
  try { await saveMetaNow() }
  catch (e) { return res.status(502).json({ error: `Could not save associate: ${e.message}` }) }
  res.json(asn)
})

// ---------- leads ----------

function applyFilters(list, q) {
  const now = Date.now()
  let out = list
  if (q.locationId) {
    const ids = String(q.locationId).split(',').filter(Boolean)
    out = out.filter(l => ids.includes(l.locationId))
  }
  if (q.associateId) out = out.filter(l => l.associateId === q.associateId)
  if (q.stage) out = out.filter(l => l.stage === q.stage)
  if (q.status) out = out.filter(l => enrichLead(l, db).status === q.status)
  if (q.statusGroup) out = out.filter(l => enrichLead(l, db).statusGroup === q.statusGroup)
  if (q.sourceName) out = out.filter(l => l.sourceName === q.sourceName)
  if (q.channel) out = out.filter(l => l.channel === q.channel)
  if (q.classType) out = out.filter(l => l.classType === q.classType)
  if (q.flagged === '1' || q.flagged === 'true') out = out.filter(l => (l.manualFlags || []).some(f => f.id === 'focus'))
  if (q.risk) out = out.filter(l => {
    const e = enrichLead(l, db)
    return e.ai.risk === q.risk
  })
  if (q.minScore !== undefined || q.maxScore !== undefined) {
    out = out.filter(l => {
      const s = enrichLead(l, db).ai.score
      if (q.minScore !== undefined && s < Number(q.minScore)) return false
      if (q.maxScore !== undefined && s > Number(q.maxScore)) return false
      return true
    })
  }
  if (q.search) {
    const s = String(q.search).toLowerCase()
    out = out.filter(l =>
      l.fullName.toLowerCase().includes(s) ||
      String(l.phone || '').includes(s) ||
      String(l.email || '').toLowerCase().includes(s) ||
      String(l.remarks || '').toLowerCase().includes(s)
    )
  }
  if (q.dateFrom || q.dateTo) {
    out = out.filter(l => {
      const t = new Date(l.createdAt).getTime()
      if (q.dateFrom && t < new Date(q.dateFrom).getTime()) return false
      if (q.dateTo && t > new Date(q.dateTo).getTime() + 86400000) return false
      return true
    })
  }
  if (q.createdWithinDays) {
    out = out.filter(l => now - new Date(l.createdAt).getTime() < Number(q.createdWithinDays) * 86400000)
  }
  return out
}

app.get('/api/leads', (req, res) => {
  let list = [...db.leads]
  list = applyFilters(list, req.query)

  const sortBy = req.query.sortBy || 'createdAt'
  const dir = req.query.sortDir === 'asc' ? 1 : -1
  if (sortBy === 'ai.score' || sortBy === 'score') {
    list.sort((a, b) => {
      const va = enrichLead(a, db).ai.score
      const vb = enrichLead(b, db).ai.score
      return va < vb ? -dir : va > vb ? dir : 0
    })
  } else {
    list.sort((a, b) => {
      const va = a[sortBy] || ''
      const vb = b[sortBy] || ''
      return va < vb ? -dir : va > vb ? dir : 0
    })
  }

  const page = Math.max(0, Number(req.query.page) || 0)
  const pageSize = Math.min(5000, Number(req.query.pageSize) || 50)
  const total = list.length
  const sliced = list.slice(page * pageSize, page * pageSize + pageSize)

  res.json({
    items: enrichAll(sliced, db).map(withStripePayment),
    total,
    page,
    pageSize
  })
})

// All ids matching the current filters (no pagination) — backs "select all
// N leads matching this filter" across pages without shipping full lead
// objects for potentially thousands of rows.
app.get('/api/leads/ids', (req, res) => {
  let list = [...db.leads]
  list = applyFilters(list, req.query)
  res.json({ ids: list.map(l => l.id), total: list.length })
})

// Single-lead reads bypass applyFilters entirely, so the location check has
// to happen here — otherwise an agent could enumerate ids and read any lead
// in the org. 404 (not 403) so the response doesn't confirm the id exists.
function canSeeLead(req, lead) {
  return !!lead && isAllowedLocation(req, lead.locationId)
}

// Owner (associateId) reassignment for agents goes through the
// request/approve flow below instead of a direct edit. createdAt is
// original intake metadata, never editable after the fact. Agents may
// otherwise edit name/phone/email/status/source (the app confirms with
// them client-side first since these are core lead fields).
const AGENT_LOCKED_LEAD_FIELDS = ['associateId', 'createdAt']

function pendingOwnerRequestFor(leadId) {
  return (db.ownerChangeRequests || []).find(r => r.leadId === leadId && r.status === 'pending') || null
}

function withOwnerRequest(payload, leadId) {
  return { ...payload, pendingOwnerChangeRequest: pendingOwnerRequestFor(leadId) }
}

app.get('/api/leads/:id', (req, res) => {
  const lead = leadById(req.params.id)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  res.json(withOwnerRequest(withStripePayment(enrichLead(lead, db)), lead.id))
})

app.post('/api/leads/:id/owner-change-request', (req, res) => {
  const lead = leadById(req.params.id)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  const associateId = req.body?.associateId || null
  if (!associateId) return res.status(400).json({ error: 'associateId is required' })
  if (pendingOwnerRequestFor(lead.id)) return res.status(409).json({ error: 'A request is already pending for this lead' })
  const request = {
    id: uid('ocr'), leadId: lead.id, leadName: lead.fullName,
    requestedByAssociateId: req.authUser.associateId || null,
    requestedByName: db.associates.find(a => a.id === req.authUser.associateId)?.name || req.authUser.email || 'An agent',
    requestedAssociateId: associateId,
    requestedAssociateName: db.associates.find(a => a.id === associateId)?.name || 'Unknown',
    status: 'pending', createdAt: nowIso()
  }
  db.ownerChangeRequests.push(request)
  save()
  log('lead', `${request.requestedByName} requested owner change for ${lead.fullName} → ${request.requestedAssociateName}`, lead.id)
  res.status(201).json(request)
})

app.post('/api/owner-change-requests/:id/decide', (req, res) => {
  if (req.authUser.role !== 'admin') return res.status(403).json({ error: 'Only admins can decide owner change requests' })
  const request = (db.ownerChangeRequests || []).find(r => r.id === req.params.id)
  if (!request) return res.status(404).json({ error: 'Request not found' })
  if (request.status !== 'pending') return res.status(409).json({ error: 'Request already decided' })
  const action = req.body?.action
  if (!['approve', 'deny'].includes(action)) return res.status(400).json({ error: 'action must be approve or deny' })
  const lead = leadById(request.leadId)
  if (action === 'approve' && lead) {
    lead.associateId = request.requestedAssociateId
    lead.updatedAt = nowIso()
    markDirty(lead.id)
    log('assign', `Owner change approved for ${lead.fullName} → ${request.requestedAssociateName}`, lead.id)
  }
  request.status = action === 'approve' ? 'approved' : 'denied'
  request.decidedAt = nowIso()
  save()
  res.json(request)
})

// Preserve full timestamp precision for already-valid ISO datetimes (e.g.
// from the Add Lead form or Momence sync); fall back to the flexible parser
// — which only resolves to a date, not a time — for anything else (CSV
// imports, mixed/relative/malformed formats), and to "now" if unparseable.
function resolveCreatedAt(raw) {
  if (raw && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(raw))) {
    const d = new Date(raw)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  const parsed = raw ? parseFlexibleDate(raw) : null
  return parsed ? new Date(parsed).toISOString() : nowIso()
}

function createLeadFrom(payload) {
  const sourceName = payload.sourceName || 'Website Form'
  const lead = {
    id: uid('lead'),
    fullName: (payload.fullName || payload.name || 'Unnamed Lead').trim(),
    phone: payload.phone || '',
    email: payload.email || '-',
    sourceId: payload.sourceId || null,
    sourceName,
    memberId: payload.memberId || null,
    convertedAt: payload.convertedAt || null,
    stage: normalizeStage(payload.stage, db.stages) || db.stages[0],
    status: normalizeStatus(payload.stage, payload.status),
    associateId: payload.associateId || null,
    locationId: payload.locationId || db.locations[0]?.id || null,
    center: payload.center || null,
    classType: payload.classType || null,
    hostId: payload.hostId || null,
    remarks: payload.remarks || '',
    channel: payload.channel || db.settings.business?.sourceChannelMap?.[sourceName] || 'Other',
    period: payload.period || 'All Time',
    valueEstimate: payload.valueEstimate ? Number(payload.valueEstimate) : null,
    purchasesMade: payload.purchasesMade ? Number(payload.purchasesMade) : null,
    visits: payload.visits ? Number(payload.visits) : null,
    trialStatus: payload.trialStatus || null,
    conversionStatus: payload.conversionStatus || null,
    retentionStatus: payload.retentionStatus || null,
    createdAt: resolveCreatedAt(payload.createdAt),
    followUps: payload.followUps || [],
    lastActivityAt: nowIso(),
    createdAtByImport: payload._imported || false
  }
  if (lead.status === 'won') { lead.convertedAt = lead.convertedAt || new Date().toISOString().slice(0, 10) }
  if (!lead.associateId && payload.associateName) {
    const asn = db.associates.find(a => a.name.toLowerCase() === String(payload.associateName).toLowerCase())
    // Only fall back to the associate's home location when the sheet/payload
    // didn't already supply one of its own — a sheet's location column is
    // the actual studio the lead belongs to, which can differ from wherever
    // the assigned associate happens to be based.
    if (asn) { lead.associateId = asn.id; if (!payload.locationId) lead.locationId = asn.locationId }
  }
  return lead
}

// Applies a re-resolved payload (built the same way as a freshly-created
// lead's) onto an existing lead found as a duplicate during a Google Sheets
// sync — so a row edited in the sheet after its first import (stage moved,
// notes updated, a follow-up logged elsewhere in the sheet) is reflected on
// the existing lead instead of being silently ignored on every later sync.
// Only overwrites a field when the sheet actually supplied a non-empty
// value, so blank cells never wipe out data the CRM has since gathered.
function updateLeadFromPayload(lead, payload) {
  let changed = false
  const set = (key, value) => {
    if (value === undefined || value === null || value === '') return
    if (lead[key] !== value) { lead[key] = value; changed = true }
  }
  set('fullName', payload.fullName?.trim())
  set('phone', payload.phone)
  if (payload.email && payload.email !== '-') set('email', payload.email)
  set('remarks', payload.remarks)
  set('classType', payload.classType)
  set('channel', payload.channel)
  set('center', payload.center)
  set('memberId', payload.memberId)
  set('hostId', payload.hostId)
  set('period', payload.period)
  set('trialStatus', payload.trialStatus)
  set('conversionStatus', payload.conversionStatus)
  set('retentionStatus', payload.retentionStatus)
  set('convertedAt', payload.convertedAt)
  if (payload.valueEstimate !== undefined) set('valueEstimate', Number(payload.valueEstimate))
  if (payload.purchasesMade !== undefined) set('purchasesMade', Number(payload.purchasesMade))
  if (payload.visits !== undefined) set('visits', Number(payload.visits))
  const stage = normalizeStage(payload.stage, db.stages)
  if (stage) set('stage', stage)
  if (payload.stage || payload.status) set('status', normalizeStatus(payload.stage, payload.status))
  set('locationId', payload.locationId)
  if (payload.associateId && db.associates.some(a => a.id === payload.associateId) && lead.associateId !== payload.associateId) {
    const asn = db.associates.find(a => a.id === payload.associateId)
    lead.associateId = asn.id; changed = true
    if (!payload.locationId) { lead.locationId = asn.locationId }
  } else if (payload.associateName) {
    const asn = db.associates.find(a => a.name.toLowerCase() === String(payload.associateName).toLowerCase())
    if (asn && lead.associateId !== asn.id) {
      lead.associateId = asn.id; changed = true
      if (!payload.locationId) { lead.locationId = asn.locationId }
    }
  }
  if (changed) lead.lastActivityAt = nowIso()
  return changed
}

app.post('/api/leads', (req, res) => {
  const dup = findDuplicateLead(req.body.email, req.body.phone, req.body.fullName || req.body.name)
  if (dup) {
    return res.status(409).json({ error: `Already exists as "${dup.fullName}" — matching email/phone.`, leadId: dup.id })
  }
  const lead = createLeadFrom(req.body)
  const settings = db.settings.roundRobin
  if (!lead.associateId && settings.enabled) assignLead(db, lead)
  db.leads.push(lead)
  markDirty(lead.id)
  save()
  log('lead', `Created lead ${lead.fullName}`, lead.id)
  res.status(201).json(enrichLead(lead, db))
})

// Registered before /api/leads/:id — otherwise "bulk" would be matched as
// an :id param and these would always 404 (Express matches route patterns
// in registration order, not by specificity).
app.patch('/api/leads/bulk', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
  const patch = req.body?.patch || {}
  let updated = 0
  for (const id of ids) {
    const lead = leadById(id)
    if (!lead) continue
    const before = lead.stage
    safePatch(lead, patch)
    markDirty(lead.id)
    if (patch.stage && patch.stage !== before) log('stage', `${lead.fullName} moved ${before} → ${patch.stage}`)
    updated++
  }
  save()
  log('lead', `Bulk updated ${updated} lead${updated === 1 ? '' : 's'}`)
  res.json({ ok: true, updated })
})

app.delete('/api/leads/bulk', (req, res) => {
  const ids = new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])
  const before = db.leads.length
  db.leads = db.leads.filter(l => !ids.has(l.id))
  const deleted = before - db.leads.length
  for (const id of ids) markDeleted(id)
  save()
  log('lead', `Bulk deleted ${deleted} lead${deleted === 1 ? '' : 's'}`)
  res.json({ ok: true, deleted })
})

app.patch('/api/leads/:id', (req, res) => {
  const lead = leadById(req.params.id)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  if (req.authUser.role !== 'admin') {
    const blocked = AGENT_LOCKED_LEAD_FIELDS.filter(f => f in req.body)
    if (blocked.length) return res.status(403).json({ error: `Not allowed to change: ${blocked.join(', ')}` })
  }
  const before = lead.stage
  safePatch(lead, req.body)
  markDirty(lead.id)
  save()
  if (req.body.associateId) log('assign', `Assigned ${lead.fullName}`, lead.id)
  if (req.body.stage && req.body.stage !== before) log('stage', `${lead.fullName} moved ${before} → ${req.body.stage}`, lead.id)
  res.json(withOwnerRequest(enrichLead(lead, db), lead.id))
})

app.post('/api/leads/:id/followups', (req, res) => {
  const lead = leadById(req.params.id)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  lead.followUps = lead.followUps || []
  const normalized = normalizeFollowUpFields(req.body.date, req.body.comments)
  if (!req.body.replaceId && !normalized.date && !normalized.comments) {
    return res.status(400).json({ error: 'Follow-up date or comments are required' })
  }

  if (req.body.replaceId) {
    const existingIndex = lead.followUps.findIndex(f => f.id === req.body.replaceId)
    if (existingIndex !== -1) {
      lead.followUps[existingIndex] = {
        ...lead.followUps[existingIndex],
        date: normalized.date || lead.followUps[existingIndex].date,
        comments: normalized.comments,
        channel: req.body.channel || lead.followUps[existingIndex].channel,
        done: Boolean(normalized.comments) && (req.body.done !== undefined ? Boolean(req.body.done) : true)
      }
    } else {
      req.body.replaceId = undefined
    }
  }

  if (!req.body.replaceId) {
    const fu = {
      id: uid('fu'),
      date: normalized.date || new Date().toISOString().slice(0, 10),
      comments: normalized.comments,
      channel: (db.settings.followUpChannels || ['call', 'whatsapp', 'email', 'sms', 'in_person']).includes(req.body.channel) ? req.body.channel : 'other',
      done: Boolean(normalized.comments) && (req.body.done !== undefined ? Boolean(req.body.done) : true)
    }
    lead.followUps.push(fu)
  }

  lead.lastActivityAt = nowIso()
  markDirty(lead.id)
  save()
  log('followup', `Follow-up logged for ${lead.fullName}`, lead.id)
  res.status(201).json(enrichLead(lead, db))
})

app.post('/api/leads/:id/assign', (req, res) => {
  const lead = leadById(req.params.id)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  if (req.body.associateId) {
    lead.associateId = req.body.associateId
    if (req.body.locationId) lead.locationId = req.body.locationId
  } else {
    assignLead(db, lead)
  }
  lead.lastActivityAt = nowIso()
  markDirty(lead.id)
  save()
  log('assign', `Assigned ${lead.fullName}`, lead.id)
  res.json(enrichLead(lead, db))
})

app.post('/api/leads/bulk', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : req.body?.rows || []
  const created = []
  let skipped = 0
  let duplicates = 0
  for (const row of rows) {
    if (!row.fullName && !row.name) { skipped++; continue }
    if (findDuplicateLead(row.email, row.phone, row.fullName || row.name)) { duplicates++; continue }
    const lead = createLeadFrom(row)
    if (!lead.associateId && db.settings.roundRobin.enabled) assignLead(db, lead)
    db.leads.push(lead)
    markDirty(lead.id)
    created.push(lead)
  }
  save()
  log('import', `Bulk import created ${created.length} leads (${skipped} skipped, ${duplicates} duplicate)`)
  res.status(201).json({ created: created.length, skipped, duplicates, items: enrichAll(created, db) })
})

// ---------- webhook integrations ----------

function genWebhookKey() {
  return crypto.randomBytes(24).toString('hex') // 48 chars, unguessable
}

// Maps a resolveLeadFields() output key to the Lead field it lands on when
// updating a matched (duplicate) lead — mirrors buildLeadPayloadFromResolved's
// own mapping in leadFieldMapping.js. followUps is deliberately excluded:
// that array is appended to, never bulk-replaced by an update.
const WEBHOOK_UPDATE_FIELD_MAP = {
  fullName: 'fullName', email: 'email', phone: 'phone', createdAt: 'createdAt', convertedAt: 'convertedAt',
  sourceId: 'sourceId', sourceName: 'source', remarks: 'notes', classType: 'classType', channel: 'channel',
  stage: 'stage', status: 'status', valueEstimate: 'valueEstimate', center: 'center', memberId: 'memberId',
  hostId: 'hostId', period: 'period', purchasesMade: 'purchasesMade', visits: 'visits', trialStatus: 'trialStatus',
  conversionStatus: 'conversionStatus', retentionStatus: 'retentionStatus', associateName: 'associateName',
  associateId: 'associateId', locationId: 'locationId'
}

function webhookUrlForReq(req, key) {
  return `${req.protocol}://${req.get('host')}/api/webhooks/leads/${key}`
}

function serializeWebhook(w, req) {
  return { ...w, url: webhookUrlForReq(req, w.key) }
}

// Alias/mapping resolution used by both webhooks and Google Sheets sync
// lives in leadFieldMapping.js — see that file for the alias dictionary.
function resolveWebhookLeadFields(body, integ) {
  return resolveLeadFields(body, integ)
}
function buildWebhookLeadPayload(resolved, integ, record) {
  return buildLeadPayloadFromResolved(resolved, db, integ.name, record)
}

// Matching logic (fuzzy name comparison, country-code-robust phone
// comparison) lives in duplicateMatch.js — shared with the bulk dedupe
// endpoint below so live ingestion and bulk review never disagree.
function findDuplicateLead(email, phone, name) {
  return findDuplicateAmong(db.leads, { email, phone, fullName: name })
}

function logWebhookCall(integrationId, outcome, detail) {
  db.webhookLogs.unshift({ id: uid('whlog'), integrationId, ts: nowIso(), outcome, detail: detail || null })
  if (db.webhookLogs.length > 300) db.webhookLogs.length = 300
  save()
}

// Basic in-memory per-key rate limit (sliding window) to stop a misbehaving
// or abused form integration from flooding lead creation.
const rateBuckets = new Map()
function checkRateLimit(key, limit = 30, windowMs = 60000) {
  const now = Date.now()
  const arr = (rateBuckets.get(key) || []).filter(t => now - t < windowMs)
  if (arr.length >= limit) { rateBuckets.set(key, arr); return false }
  arr.push(now)
  rateBuckets.set(key, arr)
  return true
}

// Static reference for the API docs panel: every Lead field a webhook can
// populate, plus the built-in key spellings it auto-recognizes without any
// manual mapping. Read-only, no auth beyond the app's own session.
app.get('/api/webhooks/field-reference', (req, res) => {
  res.json({ fields: Object.entries(LEAD_FIELD_ALIASES).map(([field, aliases]) => ({ field, aliases })) })
})

app.get('/api/webhooks', (req, res) => {
  res.json(db.webhookIntegrations.map(w => serializeWebhook(w, req)))
})

app.post('/api/webhooks', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Name is required' })
  const w = {
    id: uid('wh'),
    name,
    key: genWebhookKey(),
    method: ['GET', 'POST', 'PUT'].includes(req.body?.method) ? req.body.method : 'POST',
    fieldMapping: req.body?.fieldMapping && typeof req.body.fieldMapping === 'object' ? req.body.fieldMapping : {},
    defaults: req.body?.defaults && typeof req.body.defaults === 'object' ? req.body.defaults : {},
    createdAt: nowIso(),
    lastUsedAt: null
  }
  db.webhookIntegrations.push(w)
  log('webhook', `Created webhook integration "${w.name}"`)
  try {
    await saveMetaNow()
  } catch (e) {
    return res.status(502).json({ error: `Could not save webhook settings: ${e.message}` })
  }
  res.status(201).json(serializeWebhook(w, req))
})

app.patch('/api/webhooks/:id', async (req, res) => {
  const w = db.webhookIntegrations.find(x => x.id === req.params.id)
  if (!w) return res.status(404).json({ error: 'Webhook integration not found' })
  if ('name' in req.body) w.name = String(req.body.name || w.name).trim()
  if ('fieldMapping' in req.body && req.body.fieldMapping && typeof req.body.fieldMapping === 'object') {
    w.fieldMapping = req.body.fieldMapping
  }
  if ('defaults' in req.body && req.body.defaults && typeof req.body.defaults === 'object') {
    w.defaults = req.body.defaults
  }
  if ('method' in req.body && ['GET', 'POST', 'PUT'].includes(req.body.method)) {
    w.method = req.body.method
  }
  try {
    await saveMetaNow()
  } catch (e) {
    return res.status(502).json({ error: `Could not save webhook settings: ${e.message}` })
  }
  res.json(serializeWebhook(w, req))
})

// Dry-run: resolves a sample payload through the integration's mapping,
// aliases and defaults and returns the Lead record that would be created,
// without touching db.leads — lets an admin sanity-check a mapping before
// pointing a real form/tool at the live URL.
app.post('/api/webhooks/:id/test', (req, res) => {
  const w = db.webhookIntegrations.find(x => x.id === req.params.id)
  if (!w) return res.status(404).json({ error: 'Webhook integration not found' })
  const payload = req.body?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'Provide a sample JSON object as "payload"' })
  }
  const resolved = resolveWebhookLeadFields(payload, w)
  const missing = []
  if (!resolved.fullName) missing.push('name')
  if (!isValidEmail(resolved.email) && !isValidPhone(resolved.phone)) missing.push('a valid email or phone number')
  const preview = missing.length ? null : buildWebhookLeadPayload(resolved, w, payload)
  res.json({ resolved, preview, missing })
})

// Auto-detects field mapping from a sample payload's keys — same idea as the
// Google Sheets "detect from header row" flow, applied to a webhook since a
// webhook has no fixed schema to read in advance, only whatever sample the
// admin pastes into the test tool.
app.post('/api/webhooks/:id/detect-mapping', (req, res) => {
  const w = db.webhookIntegrations.find(x => x.id === req.params.id)
  if (!w) return res.status(404).json({ error: 'Webhook integration not found' })
  const payload = req.body?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'Provide a sample JSON object as "payload"' })
  }
  const keys = Object.keys(payload)
  const suggested = suggestMappingFromKeys(keys)
  const existing = w.fieldMapping || {}
  for (const key of Object.keys(existing)) delete suggested[key]
  res.json({ keys, suggested })
})

app.post('/api/webhooks/:id/regenerate', async (req, res) => {
  const w = db.webhookIntegrations.find(x => x.id === req.params.id)
  if (!w) return res.status(404).json({ error: 'Webhook integration not found' })
  w.key = genWebhookKey() // old URL 404s immediately since lookups match on key
  log('webhook', `Regenerated key for webhook "${w.name}"`)
  try {
    await saveMetaNow()
  } catch (e) {
    return res.status(502).json({ error: `Could not save webhook settings: ${e.message}` })
  }
  res.json(serializeWebhook(w, req))
})

app.delete('/api/webhooks/:id', async (req, res) => {
  const before = db.webhookIntegrations.length
  const w = db.webhookIntegrations.find(x => x.id === req.params.id)
  db.webhookIntegrations = db.webhookIntegrations.filter(x => x.id !== req.params.id)
  db.webhookLogs = db.webhookLogs.filter(l => l.integrationId !== req.params.id)
  if (w) log('webhook', `Deleted webhook integration "${w.name}"`)
  try {
    await saveMetaNow()
  } catch (e) {
    return res.status(502).json({ error: `Could not save webhook settings: ${e.message}` })
  }
  res.json({ ok: true, deleted: before - db.webhookIntegrations.length })
})

app.get('/api/webhooks/:id/logs', (req, res) => {
  const logs = db.webhookLogs.filter(l => l.integrationId === req.params.id).slice(0, 50)
  res.json(logs)
})

// Public inbound endpoint external forms/tools call to create leads. The key
// in the URL is the sole auth factor (long + random) — see design spec for
// why no HMAC signing is required. Registered on app.all so a single
// integration can be switched between GET/POST/PUT (per-integration
// `method`, default POST) without separate route handlers; GET reads the
// lead fields from the query string since a GET request has no body.
app.all('/api/webhooks/leads/:key', (req, res) => {
  const integ = db.webhookIntegrations.find(w => w.key === req.params.key)
  if (!integ) return res.status(404).json({ error: 'Unknown webhook' })

  const expectedMethod = integ.method || 'POST'
  if (req.method !== expectedMethod) {
    return res.status(405).json({ error: `This webhook is configured for ${expectedMethod} requests` })
  }

  if (!checkRateLimit(integ.key)) {
    logWebhookCall(integ.id, 'rate_limited')
    return res.status(429).json({ error: 'Rate limit exceeded, try again shortly' })
  }

  const body = expectedMethod === 'GET' ? req.query : req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    logWebhookCall(integ.id, 'invalid_body', expectedMethod === 'GET' ? 'No query params received' : 'Body was not a JSON object')
    return res.status(400).json({ error: expectedMethod === 'GET' ? 'Provide lead fields as query params' : 'Request body must be a JSON object' })
  }

  const resolved = resolveWebhookLeadFields(body, integ)
  const name = resolved.fullName ? String(resolved.fullName).trim() : ''
  const email = resolved.email ? String(resolved.email).trim() : ''
  const phone = resolved.phone ? String(resolved.phone).trim() : ''

  const missing = []
  if (!name) missing.push('name')
  // A non-empty email/phone isn't necessarily a usable one — reject "N/A",
  // stray notes, or malformed values rather than creating an unreachable
  // lead nobody can actually contact.
  if (!isValidEmail(email) && !isValidPhone(phone)) missing.push('a valid email or phone number')
  if (missing.length) {
    logWebhookCall(integ.id, 'validation_failed', `Missing: ${missing.join(', ')}`)
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` })
  }

  integ.lastUsedAt = nowIso()

  const dup = findDuplicateLead(email, phone, name)
  if (dup) {
    // Matched an existing lead by email/phone — merge in whatever fields this
    // payload actually resolved (edit-via-webhook), rather than only leaving
    // a note. Only fields the incoming payload resolved a value for are
    // touched, so a partial payload never blanks out fields the lead already
    // had; followUps is handled separately below and never bulk-overwritten.
    const payload = buildWebhookLeadPayload(resolved, integ, body)
    for (const [payloadKey, resolvedKey] of Object.entries(WEBHOOK_UPDATE_FIELD_MAP)) {
      if (resolved[resolvedKey] !== undefined && payload[payloadKey] !== undefined) dup[payloadKey] = payload[payloadKey]
    }
    dup.followUps = dup.followUps || []
    dup.followUps.push({
      id: uid('fu'),
      date: new Date().toISOString().slice(0, 10),
      comments: `Lead updated via webhook (${integ.name})`,
      channel: null,
      done: true
    })
    dup.lastActivityAt = nowIso()
    markDirty(dup.id)
    save()
    log('lead', `Updated lead ${dup.fullName} via webhook (${integ.name})`, dup.id)
    logWebhookCall(integ.id, 'updated', `Matched lead ${dup.id}`)
    return res.json({ status: 'updated', leadId: dup.id })
  }

  const lead = createLeadFrom(buildWebhookLeadPayload(resolved, integ, body))
  if (!lead.associateId && db.settings.roundRobin.enabled) assignLead(db, lead)
  db.leads.push(lead)
  markDirty(lead.id)
  save()
  log('lead', `Created lead ${lead.fullName} via webhook (${integ.name})`, lead.id)
  logWebhookCall(integ.id, 'created', `Lead ${lead.id}`)
  res.status(201).json({ status: 'created', leadId: lead.id })
})

// ---------- Momence purchase webhooks ----------
// Configure the endpoint URL `/api/webhooks/momence/:market` (market =
// mumbai|blr) in the Momence dashboard, one secret per market, stored at
// db.settings.momence.webhookSecret (mumbai) / db.settings.momence.blr.webhookSecret (blr).
// Per the webhooks-basics doc the outer JSON body is `{ payload: "<json string>" }`
// and x-webhook-signature is an HMAC-SHA256 of that raw string — no need for
// raw-body middleware since `payload` is already a string field after normal
// express.json() parsing.
const MOMENCE_WEBHOOK_SEEN_IDS = new Set()
function momenceWebhookSecret(market) {
  if (!db.settings.momence) db.settings.momence = {}
  return market === 'blr' ? (db.settings.momence.blr?.webhookSecret || '') : (db.settings.momence.webhookSecret || '')
}

app.post('/api/webhooks/momence/:market', async (req, res) => {
  const market = req.params.market === 'blr' ? 'blr' : 'mumbai'
  const secret = momenceWebhookSecret(market)
  if (!secret) return res.status(404).json({ error: 'Momence webhook not configured for this market' })

  const rawPayload = req.body?.payload
  if (typeof rawPayload !== 'string') return res.status(400).json({ error: 'Malformed webhook body' })

  const signature = req.header('x-webhook-signature') || ''
  const expected = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex')
  const sigOk = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  if (!sigOk) return res.status(401).json({ error: 'Invalid signature' })

  // Dedupe retries by request id (same id redelivered on retry per the docs).
  const requestId = req.header('x-webhook-reqeuest-id') || req.header('x-webhook-request-id')
  if (requestId) {
    if (MOMENCE_WEBHOOK_SEEN_IDS.has(requestId)) return res.json({ status: 'duplicate' })
    MOMENCE_WEBHOOK_SEEN_IDS.add(requestId)
    if (MOMENCE_WEBHOOK_SEEN_IDS.size > 5000) MOMENCE_WEBHOOK_SEEN_IDS.clear()
  }

  let event
  try { event = JSON.parse(rawPayload) } catch { return res.status(400).json({ error: 'Malformed payload JSON' }) }

  try {
    if (event.event === 'payment-transaction-succeeded') {
      const txn = await momence.getPaymentTransaction(db, event.payload.id, market)
      if (txn.paymentStatus !== 'succeeded') return res.json({ status: 'ignored', reason: 'not succeeded' })
      const item = txn.sales?.[0]?.items?.[0] || txn.transactionItems?.[0]
      const lead = momence.recordLeadPurchase(db, {
        market,
        memberId: txn.payingMember?.id,
        email: txn.payingMember?.email,
        purchaseDate: txn.createdAt,
        itemName: item?.itemName || null,
        amount: Number(txn.paidInCurrency) || 0,
        purchaseType: txn.purchaseType,
        membershipType: item?.usedBoughtMembership?.type || item?.membershipType
      })
      if (lead) { markDirty(lead.id); log('lead', `Momence purchase matched: ${lead.fullName}`, lead.id) }
      return res.json({ status: lead ? 'applied' : 'no-match' })
    }

    if (event.event === 'bought-membership-activated') {
      const p = event.payload
      const membership = await momence.getMembershipById(db, p.membershipId, market)
      const member = await momence.getMember(db, p.memberId, market).catch(() => null)
      const lead = momence.recordLeadPurchase(db, {
        market,
        memberId: p.memberId,
        email: member?.email,
        purchaseDate: p.startDate || event.timestamp,
        itemName: membership?.name || null,
        purchaseType: 'membership',
        membershipType: p.type
      })
      if (lead) { markDirty(lead.id); log('lead', `Momence membership activation matched: ${lead.fullName}`, lead.id) }
      return res.json({ status: lead ? 'applied' : 'no-match' })
    }

    res.json({ status: 'ignored', reason: 'unhandled event type' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ---------- Google Sheets lead import ----------

function logSheetSync(outcome, detail) {
  db.sheetSyncLogs = db.sheetSyncLogs || []
  db.sheetSyncLogs.unshift({ id: uid('shlog'), ts: nowIso(), outcome, detail: detail || null })
  if (db.sheetSyncLogs.length > 300) db.sheetSyncLogs.length = 300
  save()
}

function sheetsRedirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/google-sheets/oauth/callback`
}

app.get('/api/google-sheets/config', (req, res) => {
  res.json(googleSheets.sanitizedConfig(db))
})

app.put('/api/google-sheets/config', async (req, res) => {
  const body = req.body || {}
  const current = db.settings.googleSheets || {}
  db.settings.googleSheets = {
    ...current,
    ...(typeof body.clientId === 'string' ? { clientId: body.clientId.trim() } : {}),
    ...(typeof body.clientSecret === 'string' && body.clientSecret ? { clientSecret: body.clientSecret.trim() } : {}),
    ...(typeof body.sheetId === 'string' ? { sheetId: body.sheetId.trim() } : {}),
    ...(typeof body.sheetTab === 'string' ? { sheetTab: body.sheetTab.trim() } : {}),
    ...(body.fieldMapping && typeof body.fieldMapping === 'object' ? { fieldMapping: body.fieldMapping } : {}),
    ...(body.defaults && typeof body.defaults === 'object' ? { defaults: body.defaults } : {})
  }
  log('settings', 'Google Sheets config updated')
  try {
    await saveMetaNow()
  } catch (e) {
    return res.status(502).json({ error: `Could not save Google Sheets settings: ${e.message}` })
  }
  res.json(googleSheets.sanitizedConfig(db))
})

// Reads just the sheet's header row and auto-detects which Lead field each
// column maps to (same alias dictionary the live sync uses), without
// touching the stored fieldMapping — the settings UI calls this right after
// a sheet is picked so the mapping table opens pre-filled instead of blank,
// and merges the suggestion under any mapping the admin already set by hand.
app.get('/api/google-sheets/detect-mapping', async (req, res) => {
  try {
    const { header } = await googleSheets.readSheetRows(db)
    if (!header.length) return res.json({ header: [], suggested: {} })
    const existing = db.settings.googleSheets?.fieldMapping || {}
    const suggested = suggestMappingFromKeys(header)
    for (const key of Object.keys(existing)) delete suggested[key]
    res.json({ header, suggested })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/api/google-sheets/oauth/start', (req, res) => {
  try {
    const url = googleSheets.buildAuthUrl(db, sheetsRedirectUri(req))
    res.redirect(url)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/google-sheets/oauth/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(req.query.error_description || req.query.error)
    if (!req.query.code) throw new Error('No authorization code returned by Google')
    await googleSheets.exchangeCode(db, req.query.code, sheetsRedirectUri(req))
    log('settings', `Connected Google Sheets (${db.settings.googleSheets.connectedEmail})`)
    await saveMetaNow()
    res.redirect('/settings?tab=integrations&googleSheets=connected')
  } catch (e) {
    res.redirect(`/settings?tab=integrations&googleSheets=error&message=${encodeURIComponent(e.message)}`)
  }
})

app.post('/api/google-sheets/disconnect', async (req, res) => {
  googleSheets.disconnect(db)
  log('settings', 'Disconnected Google Sheets')
  try {
    await saveMetaNow()
  } catch (e) {
    return res.status(502).json({ error: `Could not save Google Sheets settings: ${e.message}` })
  }
  res.json(googleSheets.sanitizedConfig(db))
})

app.post('/api/google-sheets/sync-now', async (req, res) => {
  try {
    const counts = await googleSheets.runSync(db, { createLeadFrom, updateLeadFromPayload, findDuplicateLead, assignLead, markDirty, logSync: logSheetSync, force: req.body?.force === true })
    save()
    res.json(counts)
  } catch (e) {
    logSheetSync('error', e.message)
    res.status(502).json({ error: e.message })
  }
})

app.get('/api/google-sheets/logs', (req, res) => {
  res.json((db.sheetSyncLogs || []).slice(0, 50))
})

// Background poll: once a sheet is fully configured, sync every 30 minutes
// without blocking anything — failures are logged, never thrown.
setInterval(() => {
  if (!db || !googleSheets.isConfigured(db)) return
  googleSheets.runSync(db, { createLeadFrom, updateLeadFromPayload, findDuplicateLead, assignLead, markDirty, logSync: logSheetSync })
    .then(() => save())
    .catch(e => logSheetSync('error', e.message))
}, 30 * 60 * 1000)

// ---------- Zoho People (shift-aware round robin) ----------

app.get('/api/zoho-people/config', (req, res) => {
  res.json(zohoPeople.sanitizedConfig(db))
})

// Credentials are env-only (USER_ZOHO_PEOPLE_*, see .env) — this endpoint
// only toggles the shift-aware feature on/off, it never accepts secrets.
app.put('/api/zoho-people/config', async (req, res) => {
  const c = zohoPeople.config(db)
  const { enabled } = req.body || {}
  if (enabled !== undefined) c.enabled = Boolean(enabled)
  try {
    await saveMetaNow()
    log('settings', `${c.enabled ? 'Enabled' : 'Disabled'} Zoho People shift-aware round robin`)
    res.json(zohoPeople.sanitizedConfig(db))
  } catch (e) {
    res.status(502).json({ error: `Could not save Zoho People settings: ${e.message}` })
  }
})

app.post('/api/zoho-people/refresh-now', async (req, res) => {
  await zohoPeople.refreshOnDutyCache(db)
  try {
    await saveMetaNow()
  } catch (e) {
    return res.status(502).json({ error: `Could not save refreshed Zoho shifts: ${e.message}` })
  }
  const c = zohoPeople.sanitizedConfig(db)
  if (c.lastFetchError) return res.status(502).json({ error: c.lastFetchError, ...c })
  res.json(c)
})

// Background poll: keep today's on-duty snapshot fresh so nextAssociate()
// never makes a Zoho API call inline — every 15 minutes is frequent enough
// to catch someone clocking in/out without hammering Zoho's rate limits.
setInterval(() => {
  if (!db || !db.settings.zohoPeople?.enabled || !zohoPeople.isConfigured(db)) return
  zohoPeople.refreshOnDutyCache(db).then(() => save())
}, 15 * 60 * 1000)

// ---------- CSV import ----------

app.post('/api/leads/import/parse', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })
  const text = req.file.buffer.toString('utf8')
  const { columns, rows, errors } = parseCsv(text)
  if (!columns.length) return res.status(400).json({ error: 'No columns detected in CSV' })
  res.json({
    fileName: req.file.originalname,
    columns,
    total: rows.length,
    rows,
    preview: rows.slice(0, 5),
    autoMap: autoMap(columns),
    parseErrors: errors.slice(0, 5)
  })
})

app.post('/api/leads/import/apply', (req, res) => {
  const { rows, mapping, options } = req.body
  const locId = options?.locationId || db.locations[0]?.id
  const created = []
  let skipped = 0
  let duplicates = 0
  const errors = []

  rows.forEach((row, i) => {
    try {
      const get = (field) => mapping[field] ? row[mapping[field]] : null
      const fullName = get('fullName') || get('name')
      if (!fullName || String(fullName).trim() === '-' || String(fullName).trim() === '') { skipped++; return }
      const emailVal = String(get('email') || '').trim()
      const phoneVal = String(get('phone') || '').trim()
      if (findDuplicateLead(emailVal, phoneVal, fullName)) { duplicates++; return }
      const fuChannels = db.settings.followUpChannels?.length ? db.settings.followUpChannels : ['call', 'whatsapp', 'email', 'sms']
      const todayKey = new Date().toISOString().slice(0, 10)
      const followUps = (mapping.followUps || [])
        .filter(p => p.date || p.comments)
        .map((p, idx) => {
          const raw = normalizeFollowUpFields(p.date ? row[p.date] : '', p.comments ? row[p.comments] : '')
          const date = raw.date ? parseFlexibleDate(raw.date) : null
          return {
            id: uid('fu'),
            date,
            comments: raw.comments,
            channel: fuChannels[idx % fuChannels.length],
            done: Boolean(raw.comments) && (date ? date <= todayKey : true)
          }
        })
        .filter(p => p.date || p.comments)

      const stageVal = get('stage') || ''
      const rawCreatedAt = get('createdAt')
      const importedCreatedAt = parseFlexibleDate(rawCreatedAt)
      if (mapping.createdAt && String(rawCreatedAt || '').trim() && !importedCreatedAt) {
        throw new Error(`Invalid Created At value: ${String(rawCreatedAt).trim()}`)
      }
      const lead = createLeadFrom({
        fullName: String(fullName).trim(),
        phone: String(get('phone') || '').trim(),
        email: String(get('email') || '-').trim() || '-',
        // The source row's Created At is the lead creation date. Import time
        // is used only when the CSV has no mapped/value-bearing date at all.
        createdAt: importedCreatedAt || nowIso(),
        sourceName: get('sourceName') || 'Website Form',
        sourceId: get('sourceId'),
        memberId: get('memberId'),
        convertedAt: parseFlexibleDate(get('convertedAt')),
        stage: stageVal,
        status: get('status'),
        associateName: get('associate'),
        remarks: get('remarks'),
        center: get('center'),
        classType: get('classType'),
        hostId: get('hostId'),
        channel: get('channel') || 'In-Studio',
        period: get('period'),
        valueEstimate: get('valueEstimate'),
        locationId: locId,
        followUps,
        _imported: true
      })
      if (!lead.associateId && db.settings.roundRobin.enabled && db.settings.roundRobin.autoAssignOnImport !== false) assignLead(db, lead)
      db.leads.push(lead)
      markDirty(lead.id)
      created.push(lead)
    } catch (e) {
      errors.push({ row: i + 2, message: e.message })
    }
  })

  if (created.length) {
    db.importHistory.unshift({
      id: uid('imp'), at: nowIso(), fileName: options?.fileName || 'CSV upload',
      created: created.length, skipped, duplicates, locationId: locId
    })
    if (db.importHistory.length > 50) db.importHistory.length = 50
    save()
    log('import', `Imported ${created.length} leads from CSV (${skipped} skipped, ${duplicates} duplicate)`)
  }
  res.status(201).json({ created: created.length, skipped, duplicates, errors })
})

// ---------- analytics ----------

// Dashboard filter scope: studio (location) + associate always narrow the
// lead set structurally; `month` (YYYY-MM, defaults to the current month)
// additionally bounds the "this month" style metrics to that period instead
// of always meaning the literal calendar month.
function scopeLeads(leads, { studio, associate } = {}) {
  let out = leads
  if (studio) out = out.filter(l => l.locationId === studio)
  if (associate) out = out.filter(l => l.associateId === associate)
  return out
}

// scopeLocation only rewrites `locationId`; these analytics endpoints read
// `studio` instead, so a client-supplied `?studio=` would otherwise reach
// straight through. Clamp it to the caller's own locations here — for an
// admin `allowedLocationIds` returns null (unrestricted), for an agent it
// returns the intersection, which is empty when they asked for a studio
// they don't own (so they get an empty dataset, not someone else's).
function allowedStudioIds(req) {
  return allowedLocationIds(req, req.query?.studio || null)
}

function scopeLeadsForReq(req, leads = db.leads) {
  let out = scopeLeads(leads, req.query || {})
  const allowed = allowedStudioIds(req)
  if (allowed) out = out.filter(l => allowed.includes(l.locationId))
  return out
}

function resolveMonth(req) {
  return /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7)
}

app.get('/api/analytics/overview', (req, res) => {
  const leads = scopeLeadsForReq(req)
  const now = Date.now()
  const thisMonth = resolveMonth(req)
  const [ty, tm] = thisMonth.split('-').map(Number)
  const lastMonth = new Date(ty, tm - 2, 1).toISOString().slice(0, 7)

  const open = leads.filter(l => l.status === 'open')
  const won = leads.filter(l => l.status === 'won')
  const lost = leads.filter(l => l.status === 'lost')

  const monthKey = (iso) => (iso || '').slice(0, 7)
  const wonThisMonth = won.filter(l => monthKey(l.convertedAt || l.createdAt) === thisMonth).length
  const wonLastMonth = won.filter(l => monthKey(l.convertedAt || l.createdAt) === lastMonth).length

  const newThisMonth = leads.filter(l => monthKey(l.createdAt) === thisMonth).length
  const newLastMonth = leads.filter(l => monthKey(l.createdAt) === lastMonth).length

  const revenueThisMonth = won.filter(l => monthKey(l.convertedAt) === thisMonth)
    .reduce((s, l) => s + (l.valueEstimate || 0), 0)
  const revenueLastMonth = won.filter(l => monthKey(l.convertedAt) === lastMonth)
    .reduce((s, l) => s + (l.valueEstimate || 0), 0)

  const trialBooked = open.filter(l => ['Trial Scheduled', 'Trial Completed'].includes(statusGroupOf(l.stage))).length
  const trialCompleted = leads.filter(l => statusGroupOf(l.stage) === 'Trial Completed' || l.momenceEvidence?.trialCompleted).length

  const topBy = (values) => {
    const counts = new Map()
    for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1)
    const [label = '', count = 0] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || []
    return { label, count }
  }
  const topSource = topBy(leads.map(l => l.sourceName))
  const topStage = topBy(leads.map(l => l.stage))
  const ownerNames = new Map(db.associates.map(associate => [associate.id, associate.name]))
  const topOwner = topBy(won.map(l => ownerNames.get(l.associateId)))

  const unassigned = open.filter(l => !l.associateId).length

  const hot = open.filter(l => enrichLead(l, db).ai.risk === 'hot').length

  res.json({
    totalLeads: leads.length,
    openLeads: open.length,
    won: won.length,
    lost: lost.length,
    conversionRate: leads.length ? Math.round((won.length / leads.length) * 1000) / 10 : 0,
    newThisMonth,
    newLastMonth,
    newDeltaPct: newLastMonth ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100) : 0,
    wonThisMonth,
    wonLastMonth,
    wonDeltaPct: wonLastMonth ? Math.round(((wonThisMonth - wonLastMonth) / wonLastMonth) * 100) : 0,
    revenueThisMonth,
    revenueLastMonth,
    revenueDeltaPct: revenueLastMonth ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100) : 0,
    avgDealValue: won.length ? Math.round(won.reduce((s, l) => s + (l.valueEstimate || 0), 0) / won.length) : 0,
    trialBooked,
    trialCompleted,
    trialRate: leads.length ? Math.round((trialCompleted / leads.length) * 1000) / 10 : 0,
    topSource,
    topStage,
    topOwner,
    hotLeads: hot,
    unassigned,
    monthlyTarget: db.associates.filter(a => a.active !== false).reduce((s, a) => s + (a.targetMonthly || 0), 0),
    closedThisMonth: wonThisMonth
  })
})

app.get('/api/analytics/timeline', (req, res) => {
  const scoped = scopeLeadsForReq(req)
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = d.toISOString().slice(0, 7)
    const leads = scoped.filter(l => (l.createdAt || '').slice(0, 7) === key)
    const won = scoped.filter(l => (l.convertedAt || '').slice(0, 7) === key)
    const open = leads.filter(l => l.status === 'open')
    months.push({
      month: d.toLocaleString('en-US', { month: 'short' }),
      key,
      newLeads: leads.length,
      won: won.length,
      openLeads: open.length,
      revenue: won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    })
  }
  res.json(months)
})

app.get('/api/analytics/funnel-by-month', (req, res) => {
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = d.toISOString().slice(0, 7)
    const cohort = db.leads.filter(l => (l.createdAt || '').slice(0, 7) === key)
    const stages = {}
    db.stages.forEach((stage, idx) => {
      stages[stage] = cohort.filter(l => db.stages.indexOf(l.stage) >= idx).length
    })
    months.push({ month: d.toLocaleString('en-US', { month: 'short' }), key, total: cohort.length, stages })
  }
  res.json({ stages: db.stages, months })
})

app.get('/api/analytics/funnel', (req, res) => {
  const funnel = db.stages.map(stage => ({
    stage,
    count: db.leads.filter(l => l.stage === stage).length
  }))
  res.json(funnel)
})

app.get('/api/analytics/sources', (req, res) => {
  const month = resolveMonth(req)
  const leads = scopeLeadsForReq(req).filter(l => (l.createdAt || '').slice(0, 7) === month)
  const map = {}
  for (const l of leads) {
    const key = l.sourceName || 'Unknown'
    map[key] = map[key] || { source: key, count: 0, won: 0 }
    map[key].count++
    if (l.status === 'won') map[key].won++
  }
  res.json(Object.values(map).sort((a, b) => b.count - a.count))
})

app.get('/api/analytics/team', (req, res) => {
  const month = resolveMonth(req)
  // Clamp `?studio=` to the caller's own locations; an agent asking for
  // another studio gets an empty allowed set and therefore no rows.
  const allowed = allowedStudioIds(req)
  const rows = db.associates.filter(a => a.active !== false)
    .filter(a => !allowed || allowed.some(id => associateInLocation(a, id)))
    .filter(a => !req.query.studio || associateInLocation(a, req.query.studio))
    .filter(a => !req.query.associate || a.id === req.query.associate)
    .map(a => {
    const owned = db.leads.filter(l => l.associateId === a.id && (l.createdAt || '').slice(0, 7) === month)
    const won = owned.filter(l => l.status === 'won')
    const revenue = won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    return {
      associateId: a.id, name: a.name, locationId: a.locationId, locationIds: a.locationIds || [a.locationId], color: a.color, photoUrl: a.photoUrl, photoZoom: a.photoZoom, photoPosX: a.photoPosX, photoPosY: a.photoPosY,
      open: owned.filter(l => l.status === 'open').length,
      won: won.length,
      revenue,
      total: owned.length,
      conversion: owned.length ? Math.round((won.length / owned.length) * 100) : 0,
      target: a.revenueTargetMonthly || 0,
      revenueTargetMonthly: a.revenueTargetMonthly || 0,
      conversionTargetPct: a.conversionTargetPct || 0
    }
  }).sort((a, b) => b.revenue - a.revenue)
  res.json(rows)
})

// ---------- momence ----------

app.get('/api/momence-discount-codes', momenceDiscountHandlers.list)
app.get('/api/momence-discount-codes/memberships', momenceDiscountHandlers.memberships)
app.get('/api/momence-memberships', momenceDiscountHandlers.memberships)
app.get('/api/momence-discount-codes/requests', momenceDiscountHandlers.requests)
app.post('/api/momence-discount-codes/requests', momenceDiscountHandlers.createRequest)
app.put('/api/momence-discount-codes/requests/:id/decision', momenceDiscountHandlers.decideRequest)
app.post('/api/momence-discount-codes', momenceDiscountHandlers.create)
app.put('/api/momence-discount-codes/:id', momenceDiscountHandlers.update)
app.post('/api/momence-discount-codes/:id/status', momenceDiscountHandlers.setEnabled)
app.delete('/api/momence-discount-codes/:id', momenceDiscountHandlers.remove)

app.get('/api/momence/config', (req, res) => {
  const c = momence.momenceConfig(db)
  res.json({
    clientId: c.clientId, username: c.username, hostId: c.hostId,
    connected: momence.isConfigured(db),
    configured: momence.isConfigured(db),
    lastSyncAt: c.lastSyncAt || null
  })
})

app.put('/api/momence/config', async (req, res) => {
  const c = momence.momenceConfig(db)
  const patch = req.body
  if ('clientId' in patch) c.clientId = String(patch.clientId || '').trim()
  if ('clientSecret' in patch) c.clientSecret = String(patch.clientSecret || '').trim()
  if ('username' in patch) c.username = String(patch.username || '').trim()
  if ('password' in patch) c.password = String(patch.password || '').trim()
  if ('hostId' in patch) c.hostId = String(patch.hostId || '').trim()
  c.token = null
  c.configured = momence.isConfigured(db)
  c.connected = c.configured
  log('momence', 'Momence configuration updated')
  try {
    await saveMetaNow()
  } catch (e) {
    return res.status(502).json({ error: `Could not save Momence settings: ${e.message}` })
  }
  res.json({ ok: true, configured: momence.isConfigured(db), connected: c.configured })
})

app.post('/api/momence/test', async (req, res) => {
  try {
    if (!momence.isConfigured(db)) return res.status(400).json({ ok: false, error: 'Momence is not configured' })
    const profile = await momence.getProfile(db)
    momence.momenceConfig(db).lastSyncAt = nowIso()
    momence.momenceConfig(db).connected = true
    momence.momenceConfig(db).configured = true
    await saveMetaNow()
    res.json({ ok: true, profile })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

app.get('/api/momence/sessions', async (req, res) => {
  if (!momence.isAnyConfigured(db)) return res.status(400).json({ error: 'Momence is not configured. Complete the connection in Settings.' })
  try {
    // scopeLocation writes a comma-joined id list for a multi-location agent,
    // but Momence's API takes exactly one location (marketForLocation() and
    // the upstream call both expect a single id) — forwarding "loc1,loc2"
    // verbatim would break the upstream request. Query the first id instead.
    // Known limitation: a multi-location agent only sees their first studio's
    // sessions; real multi-location aggregation is out of scope here.
    const params = { ...req.query }
    if (typeof params.locationId === 'string' && params.locationId.includes(',')) {
      params.locationId = params.locationId.split(',')[0]
    }
    const sessions = await momence.getSessions(db, params)
    res.json({ sessions })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

app.get('/api/momence/sessions/:sessionId', async (req, res) => {
  if (!momence.isAnyConfigured(db)) return res.status(400).json({ error: 'Momence is not configured.' })
  // Same single-location constraint as /api/momence/sessions above.
  const locId = String(req.query.locationId || '').split(',')[0] || undefined
  try { res.json(await momence.getSessionWorkspace(db, req.params.sessionId, locId)) }
  catch (e) { res.status(502).json({ error: e.message }) }
})

app.get('/api/momence/members', async (req, res) => {
  const market = momence.marketForLocation(req.query.locationId, db)
  if (!momence.isConfigured(db, market)) return res.status(400).json({ error: `Momence is not configured for ${market === 'blr' ? 'Bengaluru' : 'Mumbai'}.` })
  const query = String(req.query.query || '').trim()
  if (query.length < 2) return res.json({ members: [] })
  try { res.json({ members: (await momence.searchMembers(db, query, market)).slice(0, 20) }) }
  catch (e) { res.status(502).json({ error: e.message }) }
})

// Full member profile by Momence member ID directly — used by the schedule's
// roster (members there may not correspond to any CRM lead at all).
app.get('/api/momence/members/:memberId/profile', async (req, res) => {
  try { res.json({ ok: true, profile: await momence.buildProfile(db, req.params.memberId, req.query.locationId) }) }
  catch (e) { res.status(502).json({ ok: false, error: e.message }) }
})

app.get('/api/momence/members/:memberId/session-memberships', async (req, res) => {
  try {
    const memberships = await momence.getAvailableBookingMemberships(db, req.params.memberId, req.query.sessionId, req.query.locationId, req.query.recurringBooking === 'true')
    res.json({ memberships })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

app.get('/api/momence/host-memberships', async (req, res) => {
  try { res.json({ memberships: await momence.getHostMemberships(db, req.query.locationId) }) }
  catch (e) { res.status(502).json({ error: e.message }) }
})

app.get('/api/momence/payment-methods', (req, res) => {
  const market = momence.marketForLocation(req.query.locationId, db)
  res.json({ market, hostId: momence.effectiveConfig(db, market).hostId, paymentMethods: momence.paymentMethodsForLocation(req.query.locationId, db) })
})

app.post('/api/momence/members/:memberId/memberships', async (req, res) => {
  try {
    const result = await momence.purchaseMembership(db, req.params.memberId, req.body)
    res.json({ ok: true, ...result })
  } catch (e) { res.status(502).json({ ok: false, error: e.message }) }
})

function resolveLeadBillingMembership(lead, hostMemberships = [], classType = '') {
  const locationName = String(db.locations.find(l => String(l.id) === String(lead.locationId))?.name || '').toLowerCase()
  const cls = String(classType || lead.classType || '').toLowerCase()
  const match = (needle) => hostMemberships.find(item => String(item.name || '').toLowerCase().includes(needle))
  if (locationName.includes('kwality')) {
    if (cls.includes('barre')) return match('open barre')
    if (cls.includes('strength') || cls.includes('powercycle') || cls.includes('power cycle')) return match('newcomers 2 for 1')
  }
  if (locationName.includes('kenkere')) return match('new client intro pack')
  if (locationName.includes('copper')) return match('copper & cloves') || match('copper and cloves')
  if (locationName.includes('plash')) return match('studio single class')
  return null
}

app.post('/api/momence/lead-booking-preview', async (req, res) => {
  const lead = leadById(req.body?.leadId || req.query?.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  try {
    const hostMemberships = await momence.getHostMemberships(db, lead.locationId)
    const membership = resolveLeadBillingMembership(lead, hostMemberships, req.body?.classType)
    if (!membership) return res.status(409).json({ error: 'Could not resolve a billing package for this lead/location/class.' })
    res.json({ ok: true, membershipId: membership.id, membershipName: membership.name, price: membership.price || null })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

app.post('/api/momence/lead-book-with-payment', async (req, res) => {
  const lead = leadById(req.body?.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  try {
    const hostMemberships = await momence.getHostMemberships(db, lead.locationId)
    const membership = resolveLeadBillingMembership(lead, hostMemberships, req.body?.classType)
    if (!membership) return res.status(409).json({ error: 'Could not resolve a billing package for this lead/location/class.' })
    const memberId = req.body?.memberId || lead.memberId
    if (!memberId) return res.status(400).json({ error: 'Lead must be linked to a Momence member first.' })
    await momence.purchaseMembership(db, memberId, {
      locationId: lead.locationId,
      membershipId: membership.id,
      paymentMethodId: momence.paymentMethodsForLocation(lead.locationId, db)[0]?.id,
      priceInCurrency: membership.price
    })
    const booking = await momence.autoBookMember(db, req.body?.sessionId || 0, memberId, { locationId: lead.locationId, membershipId: membership.id })
    res.json({ ok: true, membershipId: membership.id, membershipName: membership.name, booking })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

app.post('/api/stripe/payment-links', async (req, res) => {
  const lead = leadById(req.body?.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  if (!isAllowedLocation(req, lead.locationId)) return res.status(403).json({ error: 'Lead is outside your studio access.' })
  try {
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items.filter(item => item?.priceId) : []
    const amount = Number(req.body?.amount || 0)
    if (!requestedItems.length && (!Number.isFinite(amount) || amount <= 0)) return res.status(400).json({ error: 'Select a Stripe product or enter a valid custom amount.' })
    const metadata = {
      leadId: String(lead.id),
      locationId: String(lead.locationId || ''),
      classType: String(lead.classType || ''),
      leadName: String(lead.fullName || '')
    }
    let verifiedItems = []
    if (requestedItems.length) {
      verifiedItems = await Promise.all(requestedItems.map(async item => {
        const price = await stripeRequest(`/prices/${encodeURIComponent(item.priceId)}?expand%5B%5D=product`)
        if (!price.active || price.product?.active === false) throw new Error('One of the selected Stripe prices is no longer active.')
        return {
          priceId: price.id,
          quantity: Math.max(1, Math.min(99, Number(item.quantity) || 1)),
          name: typeof price.product === 'string' ? (price.nickname || price.id) : (price.product?.name || price.nickname || price.id),
          amount: Number(price.unit_amount || 0) / 100,
          currency: price.currency,
          recurring: price.recurring || null
        }
      }))
      if (new Set(verifiedItems.map(item => item.currency)).size > 1) throw new Error('Selected products must use the same currency.')
    } else {
      const currency = String(req.body?.currency || 'inr').toLowerCase()
      const product = await stripeRequest('/products', { method: 'POST', body: {
        name: req.body?.name || `Payment for ${lead.fullName}`,
        description: req.body?.description || 'Custom payment created in Physique 57 CRM',
        'metadata[leadId]': metadata.leadId
      } })
      const price = await stripeRequest('/prices', { method: 'POST', body: {
        currency,
        unit_amount: String(Math.round(amount * 100)),
        product: product.id
      } })
      verifiedItems = [{ priceId: price.id, quantity: 1, name: product.name, amount, currency, recurring: null }]
    }
    const hasRecurring = verifiedItems.some(item => item.recurring)
    let selectedPromotionCode = null
    if (req.body?.promotionMode === 'auto' && req.body?.promotionCodeId) {
      selectedPromotionCode = await stripeRequest(`/promotion_codes/${encodeURIComponent(req.body.promotionCodeId)}`)
      if (!selectedPromotionCode?.active || !selectedPromotionCode?.code) throw new Error('The selected Stripe promotion code is no longer active.')
    }
    const body = {
      'metadata[leadId]': metadata.leadId,
      'metadata[locationId]': metadata.locationId,
      'metadata[classType]': metadata.classType,
      'metadata[leadName]': metadata.leadName,
      allow_promotion_codes: ['customer', 'auto'].includes(req.body?.promotionMode) ? 'true' : undefined,
      billing_address_collection: ['billing', 'shipping'].includes(req.body?.addressCollection) ? 'required' : undefined,
      'phone_number_collection[enabled]': req.body?.collectPhone ? 'true' : 'false',
      'tax_id_collection[enabled]': req.body?.collectTaxId ? 'true' : 'false',
      'automatic_tax[enabled]': req.body?.automaticTax ? 'true' : 'false',
      customer_creation: !hasRecurring && req.body?.createCustomer ? 'always' : undefined,
      'invoice_creation[enabled]': !hasRecurring && req.body?.invoiceCreation ? 'true' : undefined,
      'consent_collection[terms_of_service]': req.body?.requireTerms ? 'required' : undefined,
      submit_type: req.body?.submitType || 'auto'
    }
    verifiedItems.forEach((item, index) => {
      body[`line_items[${index}][price]`] = item.priceId
      body[`line_items[${index}][quantity]`] = String(item.quantity)
      if (req.body?.adjustableQuantity) {
        body[`line_items[${index}][adjustable_quantity][enabled]`] = 'true'
        body[`line_items[${index}][adjustable_quantity][minimum]`] = '1'
        body[`line_items[${index}][adjustable_quantity][maximum]`] = '99'
      }
    })
    if (req.body?.addressCollection === 'shipping') {
      const countries = Array.isArray(req.body?.shippingCountries) && req.body.shippingCountries.length ? req.body.shippingCountries : ['IN']
      countries.slice(0, 20).forEach((country, index) => { body[`shipping_address_collection[allowed_countries][${index}]`] = String(country).toUpperCase() })
    }
    const customFields = Array.isArray(req.body?.customFields) ? req.body.customFields.filter(field => field?.label).slice(0, 3) : []
    customFields.forEach((field, index) => {
      const type = ['text', 'numeric', 'dropdown'].includes(field.type) ? field.type : 'text'
      body[`custom_fields[${index}][key]`] = String(field.key || `custom_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200)
      body[`custom_fields[${index}][label][type]`] = 'custom'
      body[`custom_fields[${index}][label][custom]`] = String(field.label).slice(0, 50)
      body[`custom_fields[${index}][type]`] = type
      body[`custom_fields[${index}][optional]`] = field.required ? 'false' : 'true'
      if (type === 'dropdown') String(field.options || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 200).forEach((value, optionIndex) => {
        body[`custom_fields[${index}][dropdown][options][${optionIndex}][label]`] = value
        body[`custom_fields[${index}][dropdown][options][${optionIndex}][value]`] = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 100)
      })
    })
    if (req.body?.limitPayments) {
      body['restrictions[completed_sessions][limit]'] = String(Math.max(1, Math.min(1000000, Number(req.body?.completedSessionsLimit) || 1)))
      if (req.body?.inactiveMessage) body['inactive_message'] = String(req.body.inactiveMessage).slice(0, 1200)
    }
    if (req.body?.afterCompletion === 'redirect' && req.body?.redirectUrl) {
      body['after_completion[type]'] = 'redirect'
      body['after_completion[redirect][url]'] = String(req.body.redirectUrl)
    } else {
      body['after_completion[type]'] = 'hosted_confirmation'
      if (req.body?.thankYouMessage) body['after_completion[hosted_confirmation][custom_message]'] = String(req.body.thankYouMessage).slice(0, 1200)
    }
    if (req.body?.customTextSubmit) body['custom_text[submit][message]'] = String(req.body.customTextSubmit).slice(0, 1200)
    if (req.body?.customTextAfterSubmit) body['custom_text[after_submit][message]'] = String(req.body.customTextAfterSubmit).slice(0, 1200)
    const paymentLink = await stripeRequest('/payment_links', { method: 'POST', body })
    const shareUrl = new URL(paymentLink.url)
    if (lead.email) shareUrl.searchParams.set('prefilled_email', lead.email)
    if (selectedPromotionCode?.code) shareUrl.searchParams.set('prefilled_promo_code', selectedPromotionCode.code)
    const subtotal = verifiedItems.reduce((sum, item) => sum + item.amount * item.quantity, 0)
    const record = paymentRecordFromLead(lead, {
      amount: subtotal,
      currency: paymentLink.currency || verifiedItems[0]?.currency || req.body?.currency || 'inr',
      paymentLinkId: paymentLink.id,
      checkoutUrl: shareUrl.toString(),
      metadata,
      items: verifiedItems,
      description: req.body?.description || '',
    }, 'open')
    record.options = { promotionMode: req.body?.promotionMode || 'none', promotionCodeId: req.body?.promotionCodeId || null, promotionCode: selectedPromotionCode?.code || null, addressCollection: req.body?.addressCollection || 'none', collectPhone: Boolean(req.body?.collectPhone), collectTaxId: Boolean(req.body?.collectTaxId), automaticTax: Boolean(req.body?.automaticTax), customFields }
    db.payments.unshift(record)
    lead.payments = [...(lead.payments || []), record.id]
    markDirty(lead.id)
    save()
    res.json({ ok: true, payment: record })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

app.get('/api/stripe/promotion-codes', async (req, res) => {
  try {
    const result = await stripeRequest('/promotion_codes?active=true&limit=100')
    const promotionCodes = await Promise.all((result.data || []).filter(item => item.active).map(async item => {
      let coupon = item.coupon || item.promotion?.coupon || {}
      if (typeof coupon === 'string') coupon = await stripeRequest(`/coupons/${encodeURIComponent(coupon)}`)
      return {
        id: item.id,
        code: item.code,
        couponName: coupon.name || '',
        percentOff: coupon.percent_off ?? null,
        amountOff: coupon.amount_off != null ? Number(coupon.amount_off) / 100 : null,
        currency: coupon.currency || null,
        duration: coupon.duration || null,
        minimumAmount: item.restrictions?.minimum_amount != null ? Number(item.restrictions.minimum_amount) / 100 : null,
        minimumCurrency: item.restrictions?.minimum_amount_currency || null,
        firstTimeOnly: Boolean(item.restrictions?.first_time_transaction)
      }
    }))
    res.json({ configured: true, promotionCodes })
  } catch (e) { res.status(502).json({ configured: Boolean(STRIPE_SECRET_KEY), error: e.message, promotionCodes: [] }) }
})

app.get('/api/stripe/catalog', async (req, res) => {
  try {
    const prices = await stripeRequest('/prices?active=true&limit=100&expand%5B%5D=data.product')
    res.json({ configured: true, products: (prices.data || []).filter(price => price.active && price.product?.active !== false).map(price => ({
      priceId: price.id,
      productId: typeof price.product === 'string' ? price.product : price.product?.id,
      name: typeof price.product === 'string' ? (price.nickname || price.id) : (price.product?.name || price.nickname || price.id),
      description: typeof price.product === 'string' ? '' : (price.product?.description || ''),
      image: typeof price.product === 'string' ? '' : (price.product?.images?.[0] || ''),
      amount: Number(price.unit_amount || 0) / 100,
      currency: price.currency,
      recurring: price.recurring || null
    })) })
  } catch (e) { res.status(502).json({ configured: Boolean(STRIPE_SECRET_KEY), error: e.message, products: [] }) }
})

app.get('/api/stripe/payments', (req, res) => {
  ensurePaymentsShape()
  const leadId = String(req.query.leadId || '')
  const payments = db.payments.filter(payment => (!leadId || String(payment.leadId) === leadId) && isAllowedLocation(req, payment.locationId)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  res.json({ payments })
})

app.get('/api/stripe/payment-links/:paymentId', async (req, res) => {
  ensurePaymentsShape()
  const payment = db.payments.find(p => p.id === req.params.paymentId)
  if (!payment) return res.status(404).json({ error: 'Payment link not found' })
  if (!isAllowedLocation(req, payment.locationId)) return res.status(403).json({ error: 'Payment is outside your studio access.' })
  try {
    if (payment.checkoutSessionId) {
      const session = await stripeRequest(`/checkout/sessions/${payment.checkoutSessionId}`)
      payment.status = session.payment_status || session.status || payment.status
      payment.paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || payment.paymentIntentId || null
      payment.customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || payment.customerId || null
      payment.paidAt = payment.status === 'paid' ? (payment.paidAt || nowIso()) : payment.paidAt || null
      payment.updatedAt = nowIso()
      save()
      return res.json({ ok: true, payment: { ...payment, stripe: session } })
    }
    if (payment.paymentLinkId) {
      const sessions = await stripeRequest(`/checkout/sessions?payment_link=${encodeURIComponent(payment.paymentLinkId)}&limit=20`)
      const session = (sessions.data || []).find(item => item.payment_status === 'paid') || sessions.data?.[0]
      if (session) {
        payment.status = session.payment_status || session.status || payment.status
        payment.checkoutSessionId = session.id
        payment.paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || payment.paymentIntentId || null
        payment.customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || payment.customerId || null
        payment.paidAt = payment.status === 'paid' ? (payment.paidAt || nowIso()) : payment.paidAt || null
        payment.updatedAt = nowIso()
        const lead = leadById(payment.leadId)
        if (lead) markDirty(lead.id)
        save()
      }
      return res.json({ ok: true, payment, stripe: session || null })
    }
    res.json({ ok: true, payment })
  } catch (e) { res.status(502).json({ error: e.message }) }
})

let momenceEvidenceSyncPromise = null
async function syncMomenceLifecycleEvidence() {
  if (momenceEvidenceSyncPromise) return momenceEvidenceSyncPromise
  momenceEvidenceSyncPromise = momence.syncLifecycleEvidence(db, db.leads)
    .then(result => {
      for (const leadId of result.updatedLeadIds) markDirty(leadId)
      save()
      if (result.updatedLeadIds.length) log('sync', `Refreshed Momence evidence for ${result.updatedLeadIds.length} lead(s)`)
      return result.summary
    })
    .finally(() => { momenceEvidenceSyncPromise = null })
  return momenceEvidenceSyncPromise
}

app.post('/api/momence/sync-lifecycle-evidence', async (req, res) => {
  try { res.json({ ok: true, summary: await syncMomenceLifecycleEvidence() }) }
  catch (e) { res.status(502).json({ ok: false, error: e.message }) }
})

app.post('/api/momence/sessions/:sessionId/bookings', async (req, res) => {
  try {
    const result = req.body.waitlist
      ? await momence.addMemberToWaitlist(db, req.params.sessionId, req.body.memberId, req.body.locationId)
      : await momence.autoBookMember(db, req.params.sessionId, req.body.memberId, req.body)
    res.json({ ok: true, result })
  } catch (e) { res.status(e.code === 'NO_ELIGIBLE_MEMBERSHIP' ? 409 : 502).json({ error: e.message, code: e.code, memberships: e.memberships }) }
})

app.put('/api/momence/bookings/:bookingId/check-in', async (req, res) => {
  try { await momence.setBookingCheckIn(db, req.params.bookingId, req.body.checkedIn !== false, req.body.locationId); res.json({ ok: true }) }
  catch (e) { res.status(502).json({ error: e.message }) }
})

app.delete('/api/momence/bookings/:bookingId', async (req, res) => {
  try { await momence.cancelSessionBooking(db, req.params.bookingId, req.body); res.json({ ok: true }) }
  catch (e) { res.status(502).json({ error: e.message }) }
})

// Resolves the Momence member for a lead by matching email/phone against the
// Momence member directory — no manual member ID entry required. Returns the
// candidate list unsynced when the match is ambiguous, so the UI can offer a
// short pick-list instead of asking for a raw ID.
app.get('/api/momence/lookup/:leadId', async (req, res) => {
  const lead = leadById(req.params.leadId)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  if (!momence.isConfigured(db)) return res.status(400).json({ ok: false, error: 'Momence is not configured' })
  try {
    if (lead.memberId) return res.json({ ok: true, memberId: lead.memberId, candidates: null })
    const candidates = await momence.findMemberCandidates(db, { email: lead.email, phone: lead.phone, locationId: lead.locationId })
    res.json({ ok: true, memberId: null, candidates })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

// Links a lead to a specific Momence member (used only to disambiguate when
// lookup finds more than one candidate) and syncs its profile immediately.
app.post('/api/momence/link/:leadId', async (req, res) => {
  const lead = leadById(req.params.leadId)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  if (!momence.isConfigured(db)) return res.status(400).json({ ok: false, error: 'Momence is not configured' })
  const memberId = String(req.body?.memberId || '').trim()
  if (!memberId) return res.status(400).json({ ok: false, error: 'memberId is required' })
  lead.memberId = memberId
  try {
    const profile = await momence.syncLeadMomence(db, lead)
    lead.lastActivityAt = nowIso()
    markDirty(lead.id)
    save()
    log('sync', `Linked and synced Momence profile for ${lead.fullName}`, lead.id)
    res.json({ ok: true, profile: enrichLead(lead, db).momence, syncedAt: lead.momenceSyncedAt })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

// Creates a new member through Momence's Host API, then persists the returned
// member ID on this lead. Profile hydration is best-effort because a newly
// created member can take a moment to become readable from the member endpoint.
app.post('/api/momence/create/:leadId', async (req, res) => {
  const lead = leadById(req.params.leadId)
  if (!canSeeLead(req, lead)) return res.status(404).json({ ok: false, error: 'Lead not found' })
  if (!momence.isConfigured(db)) return res.status(400).json({ ok: false, error: 'Momence is not configured' })
  if (momence.isValidMemberId(lead.memberId)) {
    return res.status(409).json({ ok: false, error: `This lead is already linked to Momence member #${lead.memberId}.` })
  }

  const email = String(req.body?.email || '').trim()
  const firstName = String(req.body?.firstName || '').trim()
  const lastName = String(req.body?.lastName || '').trim()
  const phoneNumber = String(req.body?.phoneNumber || '').trim()
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Enter a valid email address.' })
  if (!firstName || !lastName) return res.status(400).json({ ok: false, error: 'First name and last name are required.' })

  try {
    const created = await momence.createMember(db, {
      email, firstName, lastName, phoneNumber,
      homeLocationId: req.body?.homeLocationId || lead.locationId
    })
    lead.memberId = created.memberId
    lead.lastActivityAt = nowIso()
    let syncWarning = ''
    try {
      await momence.syncLeadMomence(db, lead)
    } catch (e) {
      syncWarning = 'Member created and linked. Profile details will appear after the next sync.'
    }
    markDirty(lead.id)
    save()
    log('sync', `Created Momence member #${created.memberId} for ${lead.fullName}`, lead.id)
    res.json({ ok: true, memberId: created.memberId, profile: enrichLead(lead, db).momence || null, warning: syncWarning })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

app.post('/api/momence/sync/:leadId', async (req, res) => {
  const lead = leadById(req.params.leadId)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  if (!momence.isConfigured(db)) return res.status(400).json({ ok: false, error: 'Momence is not configured' })
  try {
    if (!lead.memberId) {
      const { memberId, candidates } = await momence.resolveLeadMember(db, lead)
      if (!memberId) {
        if (candidates && candidates.length > 1) {
          return res.status(300).json({ ok: false, ambiguous: true, error: 'Multiple Momence members match this lead — pick the right one.', candidates })
        }
        return res.status(404).json({ ok: false, error: `No Momence member found matching ${lead.email || lead.phone || 'this lead'}.` })
      }
    }
    let profile
    try {
      profile = await momence.syncLeadMomence(db, lead)
    } catch (syncError) {
      // Imported member IDs can become stale or belong to another Momence host.
      // On a direct-profile 404, re-resolve by the lead's current contact details.
      if (!String(syncError?.message || '').includes('Momence API 404 for /api/v2/host/members/')) throw syncError
      const staleMemberId = lead.memberId
      lead.memberId = ''
      const { memberId, candidates } = await momence.resolveLeadMember(db, lead)
      if (!memberId) {
        lead.memberId = staleMemberId
        if (candidates && candidates.length > 1) {
          return res.status(300).json({ ok: false, ambiguous: true, error: 'The saved Momence link is no longer valid. Choose the current matching member.', candidates })
        }
        return res.status(404).json({ ok: false, error: 'The saved Momence member no longer exists for this host, and no current member matched this lead. Relink the member.' })
      }
      profile = await momence.syncLeadMomence(db, lead)
    }
    lead.lastActivityAt = nowIso()
    markDirty(lead.id)
    save()
    log('sync', `Synced Momence profile for ${lead.fullName}`, lead.id)
    res.json({ ok: true, profile: enrichLead(lead, db).momence, syncedAt: lead.momenceSyncedAt })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

// ---------- settings ----------

const SETTINGS_SECTIONS = ['org', 'ui', 'business', 'cadence', 'notifications', 'ai', 'roundRobin', 'reminders', 'momence', 'gpt', 'respondio', 'mailtrap']

app.get('/api/settings', (req, res) => res.json(db.settings))
/* ------------------------------------------------------------------ *
 * Pivot builder
 * ------------------------------------------------------------------ */

// The pivot works over a lean projection rather than the full lead records:
// 23k enriched leads with follow-up arrays is tens of megabytes, while the
// fields a pivot can actually group or measure by is a couple of hundred
// bytes a row. Sending the projection once lets every control change
// recompute instantly on the client instead of round-tripping.
const PIVOT_FIELDS = [
  { field: 'stage', label: 'Stage', type: 'text' },
  { field: 'status', label: 'Outcome', type: 'text' },
  { field: 'statusGroup', label: 'Status group', type: 'text' },
  { field: 'sourceName', label: 'Source', type: 'text' },
  { field: 'channel', label: 'Channel', type: 'text' },
  { field: 'classType', label: 'Class type', type: 'text' },
  { field: 'locationName', label: 'Studio', type: 'text' },
  { field: 'associateName', label: 'Owner', type: 'text' },
  { field: 'trialStatus', label: 'Trial status', type: 'text' },
  { field: 'conversionStatus', label: 'Conversion status', type: 'text' },
  { field: 'retentionStatus', label: 'Retention status', type: 'text' },
  { field: 'period', label: 'Period', type: 'text' },
  { field: 'createdAt', label: 'Created', type: 'date' },
  { field: 'convertedAt', label: 'Converted', type: 'date' },
  { field: 'trialDate', label: 'Trial date', type: 'date' },
  { field: 'firstPurchaseDate', label: 'First purchase', type: 'date' },
  { field: 'lastActivityAt', label: 'Last activity', type: 'date' },
  { field: 'valueEstimate', label: 'Revenue', type: 'number', measure: true, currency: true },
  { field: 'visits', label: 'Visits', type: 'number', measure: true },
  { field: 'purchasesMade', label: 'Purchases', type: 'number', measure: true },
  { field: 'score', label: 'Lead score', type: 'number', measure: true },
  { field: 'missedFollowUps', label: 'Missed follow-ups', type: 'number', measure: true },
  { field: 'leadId', label: 'Lead id', type: 'text', hidden: true }
]

app.get('/api/pivot/fields', (req, res) => res.json(PIVOT_FIELDS.filter(f => !f.hidden)))

app.get('/api/pivot/dataset', (req, res) => {
  const locById = new Map(db.locations.map(l => [l.id, l.name]))
  const asnById = new Map(db.associates.map(a => [a.id, a.name]))
  const scope = req.authUser?.locationIds

  const rows = []
  for (const lead of db.leads) {
    if (scope && !scope.includes(lead.locationId)) continue
    const followUps = Array.isArray(lead.followUps) ? lead.followUps : []
    rows.push({
      stage: lead.stage || '',
      status: lead.status || '',
      statusGroup: lead.statusGroup || '',
      sourceName: lead.sourceName || '',
      channel: lead.channel || '',
      classType: lead.classType || '',
      locationName: locById.get(lead.locationId) || '',
      // An orphaned associateId must not silently read as a real owner, so
      // an unresolved id is left blank and buckets under "—".
      associateName: asnById.get(lead.associateId) || lead.associateName || '',
      trialStatus: lead.trialStatus || '',
      conversionStatus: lead.conversionStatus || '',
      retentionStatus: lead.retentionStatus || '',
      period: lead.period || '',
      createdAt: lead.createdAt || '',
      convertedAt: lead.convertedAt || '',
      trialDate: lead.trialDate || lead.momenceEvidence?.trialDate || '',
      firstPurchaseDate: lead.firstPurchaseDate || lead.momenceEvidence?.firstPurchaseDate || '',
      lastActivityAt: lead.lastActivityAt || '',
      valueEstimate: Number(lead.valueEstimate) || 0,
      visits: Number(lead.visits) || 0,
      purchasesMade: Number(lead.purchasesMade) || 0,
      score: Number(lead.ai?.score ?? lead.score) || 0,
      missedFollowUps: followUps.filter(f => f && f.done === false && f.date && f.date !== '-').length
    })
  }
  // The payload is columnar, not a list of row objects. With 23k rows and
  // 21 fields, repeating every key name per row was the single largest cost
  // in the response — larger than the values themselves. Categorical and
  // date columns are additionally dictionary-encoded, since a studio
  // imports hundreds of leads sharing the same stage, source and day.
  // Together these take the response from ~14MB to ~2MB.
  const dictFields = PIVOT_FIELDS.filter(f => (f.type === 'text' || f.type === 'date') && !f.hidden).map(f => f.field)
  const numericFields = PIVOT_FIELDS.filter(f => f.type === 'number' && !f.hidden).map(f => f.field)

  const dictionaries = {}
  const columns = {}

  for (const field of dictFields) {
    const values = []
    const index = new Map()
    const codes = new Array(rows.length)
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][field] || ''
      let code = index.get(v)
      if (code === undefined) { code = values.length; values.push(v); index.set(v, code) }
      codes[i] = code
    }
    dictionaries[field] = values
    columns[field] = codes
  }
  for (const field of numericFields) {
    columns[field] = rows.map(r => r[field])
  }

  res.json({
    fields: PIVOT_FIELDS.filter(f => !f.hidden),
    dictionaries,
    columns,
    rowCount: rows.length,
    generatedAt: nowIso()
  })
})

// Saved views are per user, like lead segments. `shared: true` publishes one
// to the whole workspace so a studio manager can hand a report to the team
// without every agent rebuilding it.
function pivotStore() {
  db.settings.pivotViews = db.settings.pivotViews || {}
  return db.settings.pivotViews
}
const pivotKey = (req) => String(req.authUser?.email || req.authUser?.id || 'unknown').toLowerCase()

app.get('/api/pivot-views', (req, res) => {
  const store = pivotStore()
  const mine = store[pivotKey(req)] || []
  const shared = Object.entries(store)
    .filter(([owner]) => owner !== pivotKey(req))
    .flatMap(([owner, views]) => (views || []).filter(v => v.shared).map(v => ({ ...v, owner, readOnly: true })))
  res.json({ mine, shared })
})

app.put('/api/pivot-views', async (req, res) => {
  if (!Array.isArray(req.body?.views)) return res.status(400).json({ error: 'views array required' })
  const store = pivotStore()
  store[pivotKey(req)] = req.body.views.slice(0, 60).map(v => ({
    id: String(v.id || uid('pv')),
    name: String(v.name || 'Untitled view').slice(0, 80),
    shared: Boolean(v.shared),
    spec: v.spec && typeof v.spec === 'object' ? v.spec : {},
    updatedAt: nowIso()
  }))
  try { await saveMetaNow() }
  catch (e) { return res.status(502).json({ error: `Could not save pivot views: ${e.message}` }) }
  res.json({ mine: store[pivotKey(req)] })
})

app.get('/api/user-preferences', (req, res) => {
  const key = String(req.authUser?.email || req.authUser?.id || 'unknown').toLowerCase()
  res.json(db.settings.userPreferences?.[key] || {})
})
app.put('/api/user-preferences', async (req, res) => {
  const key = String(req.authUser?.email || req.authUser?.id || 'unknown').toLowerCase()
  db.settings.userPreferences = db.settings.userPreferences || {}
  const current = db.settings.userPreferences[key] || {}
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  db.settings.userPreferences[key] = {
    ...current,
    ...body,
    leadTablePrefs: { ...(current.leadTablePrefs || {}), ...(body.leadTablePrefs || {}) },
    leadSegments: Array.isArray(body.leadSegments) ? body.leadSegments.slice(0, 100) : (current.leadSegments || [])
  }
  try { await saveMetaNow() } catch (e) { return res.status(502).json({ error: `Preferences saved locally but failed to sync to Supabase: ${e.message}` }) }
  res.json(db.settings.userPreferences[key])
})
// Mirrors respond.io's internal-API session (authToken/cookie/botId/orgId —
// see respondioInternal.js) into the .env file too, per how it's configured,
// so a fresh session pasted into Settings survives a server restart without
// also having to hand-edit .env. Best-effort: a read-only filesystem just
// means it falls back to the in-memory/db copy already saved.
function persistEnvVars(pairs) {
  const envFile = path.join(__dirname, '..', '.env')
  try {
    let lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n') : []
    for (const [key, value] of Object.entries(pairs)) {
      process.env[key] = value
      const idx = lines.findIndex(l => l.match(new RegExp(`^\\s*${key}\\s*=`)))
      const line = `${key}=${value}`
      if (idx >= 0) lines[idx] = line
      else lines.push(line)
    }
    fs.writeFileSync(envFile, lines.join('\n'))
  } catch (e) { /* best-effort — settings/db already have the values */ }
}

app.put('/api/settings', async (req, res) => {
  const body = req.body || {}
  // respond.io's internal-API session is a nested object the caller only
  // ever sends partial updates to (e.g. re-pasting just a fresh token) — the
  // generic per-section merge below is shallow, so without this it would
  // blow away whatever cookie/botId/orgId the un-sent fields already held.
  const prevRespondioSession = db.settings.respondio?.session || null
  const previousMailtrapPassword = db.settings.mailtrap?.pass || ''
  for (const section of SETTINGS_SECTIONS) {
    if (body[section] && typeof body[section] === 'object' && !Array.isArray(body[section])) {
      db.settings[section] = { ...(db.settings[section] || {}), ...body[section] }
    }
  }
  if (body.respondio?.session) {
    db.settings.respondio.session = { ...(prevRespondioSession || {}), ...body.respondio.session }
    const s = db.settings.respondio.session
    persistEnvVars({
      USER_RESPONDIO_SESSION_TOKEN: s.token || '',
      USER_RESPONDIO_SESSION_COOKIE: s.cookie || '',
      USER_RESPONDIO_BOT_ID: s.botId || '',
      USER_RESPONDIO_ORG_ID: s.orgId || ''
    })
  }
  // The Settings API never returns SMTP secrets. A blank password sent back
  // by the form means "keep the existing secret", not "erase it".
  if (body.mailtrap && !String(body.mailtrap.pass || '').trim()) {
    db.settings.mailtrap.pass = previousMailtrapPassword
  }
  if (Array.isArray(body.followUpChannels)) db.settings.followUpChannels = body.followUpChannels.filter(Boolean)
  if (Array.isArray(body.leadColumns)) db.settings.leadColumns = body.leadColumns.filter(column => column && column.id && column.label)
  try {
    await saveMetaNow()
  } catch (e) {
    return res.status(502).json({ error: `Settings saved locally but failed to sync to Supabase: ${e.message}` })
  }
  log('settings', 'Settings updated')
  res.json(db.settings)
})

app.put('/api/lists', (req, res) => {
  const { stages, sources, channels, classTypes } = req.body || {}
  if (Array.isArray(stages)) db.stages = stages.filter(Boolean)
  if (Array.isArray(sources)) db.sources = sources.filter(Boolean)
  if (Array.isArray(channels)) db.channels = channels.filter(Boolean)
  if (Array.isArray(classTypes)) db.classTypes = classTypes.filter(Boolean)
  save()
  log('settings', 'Lead list options updated')
  res.json({ stages: db.stages, sources: db.sources, channels: db.channels, classTypes: db.classTypes })
})

// Finds leads sharing the same email or phone and removes all but the
// oldest of each group — cleanup for duplicates created by any past bug
// (e.g. two overlapping Google Sheets syncs racing before the fixed lock
// existed). `dryRun` (default) reports what WOULD be removed without
// touching anything, so an admin can sanity-check the count first.
app.post('/api/leads/dedupe', (req, res) => {
  const dryRun = req.body?.dryRun !== false
  // clusterDuplicates unions leads transitively (A~B by email, B~C by
  // phone+fuzzy-name) so the whole chain lands in one group, not split
  // across separate email/phone buckets like the old hash-by-one-key pass.
  const rawGroups = clusterDuplicates(db.leads)

  const toRemove = []
  const dupGroups = []
  for (const group of rawGroups) {
    group.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    toRemove.push(...group.slice(1))
    dupGroups.push(group.map((l, i) => ({
      id: l.id, fullName: l.fullName, email: l.email, phone: l.phone, stage: l.stage,
      source: l.source, createdAt: l.createdAt, status: i === 0 ? 'keep' : 'remove'
    })))
  }

  const preview = toRemove.slice(0, 20).map(l => ({ id: l.id, fullName: l.fullName, email: l.email, phone: l.phone, createdAt: l.createdAt }))
  if (dryRun) return res.json({
    dryRun: true, duplicateGroups: dupGroups.length, wouldRemove: toRemove.length, preview,
    groups: dupGroups
  })

  // A client that already showed the user the full duplicate groups can pass
  // back exactly which ids to remove (e.g. after the admin unchecked one);
  // otherwise fall back to removing every non-oldest lead in each group.
  const removableIds = new Set(toRemove.map(l => l.id))
  const removeIds = Array.isArray(req.body?.removeIds)
    ? new Set(req.body.removeIds.filter(id => removableIds.has(id)))
    : removableIds
  db.leads = db.leads.filter(l => !removeIds.has(l.id))
  for (const id of removeIds) markDeleted(id)
  save()
  log('lead', `Deduped leads: removed ${removeIds.size} duplicate(s) by email/phone`)
  res.json({ dryRun: false, removed: removeIds.size })
})

app.post('/api/reset', (req, res) => {
  const fresh = reset()
  log('system', 'Database reset to demo dataset')
  res.json({ ok: true, leads: fresh.leads.length })
})

// ---------- performance analytics ----------

function weekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}

app.get('/api/analytics/performance', (req, res) => {
  const range = req.query.range === 'week' ? 'week' : 'month'
  const now = new Date()
  const buckets = []
  let fmt, key

  if (range === 'week') {
    const start = weekStart(now)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(start.getTime() + i * 86400000)
      buckets.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleString('en-US', { weekday: 'short' }) })
    }
    fmt = (d) => d.toISOString().slice(0, 10)
  } else {
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
      buckets.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-US', { month: 'short' }) })
    }
    fmt = (d) => d.toISOString().slice(0, 7)
  }

  const row = buckets.map(b => ({ ...b, newLeads: 0, won: 0, revenue: 0, followUps: 0, missed: 0, lost: 0, lostRevenue: 0 }))
  const idx = Object.fromEntries(row.map((r, i) => [r.key, i]))

  const validDate = (v) => v && v !== '-' && !isNaN(new Date(v).getTime())

  const scoped = scopeLeadsForReq(req)
  for (const l of scoped) {
    if (validDate(l.createdAt)) {
      const ck = fmt(new Date(l.createdAt))
      if (idx[ck] !== undefined) row[idx[ck]].newLeads++
    }
    if (l.status === 'won' && validDate(l.convertedAt)) {
      const wk = fmt(new Date(l.convertedAt))
      if (idx[wk] !== undefined) { row[idx[wk]].won++; row[idx[wk]].revenue += l.valueEstimate || 0 }
    }
    // No dedicated "lost at" field on a lead — bucketed by createdAt, same
    // convention already used for the lost-cohort report elsewhere.
    if (l.status === 'lost' && validDate(l.createdAt)) {
      const lk = fmt(new Date(l.createdAt))
      if (idx[lk] !== undefined) { row[idx[lk]].lost++; row[idx[lk]].lostRevenue += l.valueEstimate || 0 }
    }
    for (const f of l.followUps || []) {
      if (!validDate(f.date)) continue
      const fk = fmt(new Date(f.date))
      if (idx[fk] !== undefined) {
        row[idx[fk]].followUps++
        if (f.done === false) row[idx[fk]].missed++
      }
    }
  }

  const totals = row.reduce((acc, r) => {
    acc.newLeads += r.newLeads; acc.won += r.won; acc.revenue += r.revenue
    acc.followUps += r.followUps; acc.missed += r.missed
    acc.lost += r.lost; acc.lostRevenue += r.lostRevenue
    return acc
  }, { newLeads: 0, won: 0, revenue: 0, followUps: 0, missed: 0, lost: 0, lostRevenue: 0 })
  totals.followUpRate = totals.followUps ? Math.round(((totals.followUps - totals.missed) / totals.followUps) * 100) : 0
  totals.lossRate = (totals.won + totals.lost) ? Math.round((totals.lost / (totals.won + totals.lost)) * 100) : 0
  // Snapshot, not a per-period sum — pipeline value of leads currently open
  // within scope, regardless of when they were created.
  totals.openPipelineValue = scoped.filter(l => l.status === 'open').reduce((s, l) => s + (l.valueEstimate || 0), 0)

  // Growth cards need a genuine same-period-last-year comparison. The chart
  // window (7 days / 12 months) is presentation-only and must not be used as
  // the comparison dataset, otherwise the first visible bucket is mistaken
  // for last year and filtered views collapse to zero.
  const currentStart = range === 'week' ? weekStart(now) : new Date(now.getFullYear(), now.getMonth(), 1)
  const currentEnd = new Date(now.getTime() + 1)
  const priorStart = new Date(currentStart); priorStart.setFullYear(priorStart.getFullYear() - 1)
  const priorEnd = new Date(currentEnd); priorEnd.setFullYear(priorEnd.getFullYear() - 1)
  const inPeriod = (value, start, end) => validDate(value) && new Date(value) >= start && new Date(value) < end
  const periodMetrics = (start, end) => {
    let newLeads = 0; let won = 0; let lost = 0; let revenue = 0; let followUps = 0; let missed = 0
    for (const lead of scoped) {
      if (inPeriod(lead.createdAt, start, end)) {
        newLeads++
        if (lead.status === 'lost') lost++
      }
      if (lead.status === 'won' && inPeriod(lead.convertedAt, start, end)) {
        won++
        revenue += lead.valueEstimate || 0
      }
      for (const followUp of lead.followUps || []) {
        if (!inPeriod(followUp.date, start, end)) continue
        followUps++
        if (followUp.done === false) missed++
      }
    }
    return { newLeads, won, lost, revenue, followUps, missed, followUpRate: followUps ? ((followUps - missed) / followUps) * 100 : null }
  }
  const currentPeriod = periodMetrics(currentStart, currentEnd)
  const priorYearPeriod = periodMetrics(priorStart, priorEnd)
  const growthPct = (current, previous) => {
    if (previous === null || previous === undefined) return null
    if (previous === 0) return current > 0 ? 100 : null
    return ((current - previous) / Math.abs(previous)) * 100
  }
  const yoy = {
    newLeads: growthPct(currentPeriod.newLeads, priorYearPeriod.newLeads),
    won: growthPct(currentPeriod.won, priorYearPeriod.won),
    lost: growthPct(currentPeriod.lost, priorYearPeriod.lost),
    revenue: growthPct(currentPeriod.revenue, priorYearPeriod.revenue),
    followUpRate: growthPct(currentPeriod.followUpRate, priorYearPeriod.followUpRate)
  }

  res.json({ range, buckets: row, totals, yoy, comparison: { currentPeriod, priorYearPeriod } })
})

// Per-studio breakdown for a single week/month period. `offset` counts periods
// back from the current one (week: 0 = this week, 1 = last week; month: 0 =
// this month). Used by the dedicated weekly/monthly studio performance pages.

function periodBounds(range, offset, now) {
  let start, end, label
  if (range === 'week') {
    const thisWeekStart = weekStart(now)
    start = new Date(thisWeekStart.getTime() - offset * 7 * 86400000)
    end = new Date(start.getTime() + 7 * 86400000)
    label = `Week of ${start.toISOString().slice(0, 10)}`
  } else if (range === 'year') {
    const y = now.getFullYear() - offset
    start = new Date(y, 0, 1)
    end = new Date(y + 1, 0, 1)
    label = String(y)
  } else {
    const y = now.getFullYear(), m = now.getMonth() - offset
    start = new Date(y, m, 1)
    end = new Date(y, m + 1, 1)
    label = start.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  }
  return { start, end, label }
}

// Named period presets for the Associate/Studio overview reports — each
// maps to a {range, offset} periodBounds() already knows how to bound,
// except custom which the caller resolves from &from=&to= directly. Default
// is 'prev_week' per the report spec (previous Monday-to-Sunday week).
const REPORT_PRESETS = {
  prev_week: { range: 'week', offset: 1 },
  this_week: { range: 'week', offset: 0 },
  this_month: { range: 'month', offset: 0 },
  last_month: { range: 'month', offset: 1 },
  this_year: { range: 'year', offset: 0 },
  last_year: { range: 'year', offset: 1 }
}

function resolveReportPeriod(req, now) {
  const fromQ = req.query.from ? new Date(`${req.query.from}T00:00:00`) : null
  const toQ = req.query.to ? new Date(`${req.query.to}T00:00:00`) : null
  const customRange = !!(fromQ && toQ && !isNaN(fromQ.getTime()) && !isNaN(toQ.getTime()) && fromQ <= toQ)
  if (customRange) {
    const start = fromQ
    const end = new Date(toQ.getTime() + 86400000)
    return {
      range: 'custom', customRange: true, start, end,
      label: `${start.toISOString().slice(0, 10)} to ${toQ.toISOString().slice(0, 10)}`
    }
  }
  const preset = REPORT_PRESETS[req.query.preset] ? req.query.preset : 'prev_week'
  const { range, offset } = REPORT_PRESETS[preset]
  const { start, end, label } = periodBounds(range, offset, now)
  return { range, customRange: false, start, end, label, preset }
}

// A period immediately preceding `start`, of the same length — used as one
// of the two standing comparisons (the other being the same window a year
// earlier, computed separately since it isn't just "shift back by length").
function precedingPeriod(start, end) {
  const days = Math.max(1, Math.round((end - start) / 86400000))
  return { start: new Date(start.getTime() - days * 86400000), end: start }
}
function yearAgoPeriod(start, end) {
  return {
    start: new Date(start.getFullYear() - 1, start.getMonth(), start.getDate()),
    end: new Date(end.getFullYear() - 1, end.getMonth(), end.getDate())
  }
}

// Distinct from the generic isTrialStage() below — these split "in a trial
// stage" into scheduled-but-not-done vs completed, matching real stage names
// like "Trial Completed - Unresponsive" (still counts as completed) without
// needing every variant enumerated.
const isTrialScheduledStage = (s) => /trial.*schedul/i.test(s || '') || /schedul.*trial/i.test(s || '')
const isTrialCompletedStage = (s) => /trial.*complet/i.test(s || '')

function scopedLeads(scope, entityId) {
  if (!entityId) return db.leads
  return scope === 'associate'
    ? db.leads.filter(l => l.associateId === entityId)
    : db.leads.filter(l => l.locationId === entityId)
}

// The core metric set for the Associate/Studio overview reports — leads
// received, trial funnel split, conversion, and LTV (avg value of a won
// lead — the same number the sheet-import "LTV" column feeds into
// valueEstimate), for one [start,end) window scoped to a studio or associate.
function reportMetrics(scope, entityId, start, end) {
  const inRange = periodInRangeFn(start, end)
  const leads = scopedLeads(scope, entityId)
  const received = leads.filter(l => inRange(l.createdAt))
  const trialsScheduled = leads.filter(l => isTrialScheduledStage(l.stage) && inRange(l.createdAt))
  const trialsCompleted = leads.filter(l => isTrialCompletedStage(l.stage) && inRange(l.createdAt))
  const converted = leads.filter(l => l.status === 'won' && inRange(l.convertedAt))
  const revenue = converted.reduce((s, l) => s + (l.valueEstimate || 0), 0)
  let followUps = 0, missed = 0
  for (const l of leads) {
    for (const f of l.followUps || []) {
      if (!inRange(f.date)) continue
      followUps++
      if (f.done === false) missed++
    }
  }
  return {
    leadsReceived: received.length,
    trialsScheduled: trialsScheduled.length,
    trialsCompleted: trialsCompleted.length,
    converted: converted.length,
    conversionRate: received.length ? Math.round((converted.length / received.length) * 100) : 0,
    revenue,
    ltv: converted.length ? Math.round(revenue / converted.length) : 0,
    followUps, missed,
    followUpRate: followUps ? Math.round(((followUps - missed) / followUps) * 100) : 0
  }
}

// Stage / source breakdowns for the period, each with a totals row baked in
// (`__isTotal: true`) so the frontend doesn't need to recompute the sums —
// the same numbers that produced the row totals.
function reportBreakdown(scope, entityId, start, end, groupField) {
  const inRange = periodInRangeFn(start, end)
  const leads = scopedLeads(scope, entityId).filter(l => inRange(l.createdAt))
  const map = {}
  for (const l of leads) {
    const key = (groupField === 'stage' ? l.stage : l.sourceName) || 'Unspecified'
    const row = map[key] = map[key] || { key, leadsReceived: 0, trialsScheduled: 0, trialsCompleted: 0, converted: 0 }
    row.leadsReceived++
    if (isTrialScheduledStage(l.stage)) row.trialsScheduled++
    if (isTrialCompletedStage(l.stage)) row.trialsCompleted++
    if (l.status === 'won') row.converted++
  }
  const rows = Object.values(map)
    .map(r => ({ ...r, conversionRate: r.leadsReceived ? Math.round((r.converted / r.leadsReceived) * 100) : 0 }))
    .sort((a, b) => b.leadsReceived - a.leadsReceived)
  const totals = rows.reduce((t, r) => ({
    key: 'Total', leadsReceived: t.leadsReceived + r.leadsReceived, trialsScheduled: t.trialsScheduled + r.trialsScheduled,
    trialsCompleted: t.trialsCompleted + r.trialsCompleted, converted: t.converted + r.converted
  }), { key: 'Total', leadsReceived: 0, trialsScheduled: 0, trialsCompleted: 0, converted: 0 })
  totals.conversionRate = totals.leadsReceived ? Math.round((totals.converted / totals.leadsReceived) * 100) : 0
  return { rows, totals }
}

function periodInRangeFn(start, end) {
  return (v) => {
    if (!v || v === '-') return false
    const d = new Date(v)
    return !isNaN(d.getTime()) && d >= start && d < end
  }
}

const isTrialStage = (s) => /trial/i.test(s || '')

// Per-location rows (unchanged shape) for a given [start, end) period.
function periodLocationRows(start, end, locations) {
  const inRange = periodInRangeFn(start, end)
  return locations.map(loc => {
    const leads = db.leads.filter(l => l.locationId === loc.id)
    const newLeads = leads.filter(l => inRange(l.createdAt))
    const won = leads.filter(l => l.status === 'won' && inRange(l.convertedAt))
    const trials = leads.filter(l => isTrialStage(l.stage) && inRange(l.createdAt || l.updatedAt))
    const revenue = won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    let followUps = 0, missed = 0
    for (const l of leads) {
      for (const f of l.followUps || []) {
        if (!inRange(f.date)) continue
        followUps++
        if (f.done === false) missed++
      }
    }
    const byAssociate = {}
    for (const l of won) {
      if (!l.associateId) continue
      byAssociate[l.associateId] = (byAssociate[l.associateId] || 0) + (l.valueEstimate || 0)
    }
    const ranked = Object.entries(byAssociate)
      .map(([associateId, rev]) => ({ associateId, active: db.associates.find(a => a.id === associateId)?.active !== false, name: db.associates.find(a => a.id === associateId)?.name || 'Unknown', revenue: rev }))
      .filter(a => a.active)
      .sort((a, b) => b.revenue - a.revenue)

    return {
      locationId: loc.id, locationName: loc.name,
      newLeads: newLeads.length, trials: trials.length, won: won.length, revenue,
      followUps, missed,
      followUpRate: followUps ? Math.round(((followUps - missed) / followUps) * 100) : 0,
      topAssociate: ranked[0] || null,
      bottomAssociate: ranked.length > 1 ? ranked[ranked.length - 1] : null,
      newLeadDetails: newLeads.map(l => ({ id: l.id, fullName: l.fullName, stage: l.stage, associateId: l.associateId })),
      wonDetails: won.map(l => ({ id: l.id, fullName: l.fullName, revenue: l.valueEstimate || 0, associateId: l.associateId }))
    }
  }).sort((a, b) => b.revenue - a.revenue)
}

// Aggregate summary (overall, or scoped to one location) for a [start, end) period.
function periodSummary(start, end, locationId) {
  const inRange = periodInRangeFn(start, end)
  const leads = locationId ? db.leads.filter(l => l.locationId === locationId) : db.leads
  const newLeads = leads.filter(l => inRange(l.createdAt))
  const won = leads.filter(l => l.status === 'won' && inRange(l.convertedAt))
  const trials = leads.filter(l => isTrialStage(l.stage) && inRange(l.createdAt || l.updatedAt))
  const revenue = won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
  let followUps = 0, missed = 0
  for (const l of leads) {
    for (const f of l.followUps || []) {
      if (!inRange(f.date)) continue
      followUps++
      if (f.done === false) missed++
    }
  }
  return {
    newLeads: newLeads.length, trials: trials.length, won: won.length, revenue,
    followUps, missed,
    followUpRate: followUps ? Math.round(((followUps - missed) / followUps) * 100) : 0
  }
}

// Mutually-exclusive funnel stage counts (new/trial/won/lost) for leads created in the period.
function periodFunnel(start, end, locationId, associateId) {
  const inRange = periodInRangeFn(start, end)
  const leads = (associateId ? db.leads.filter(l => l.associateId === associateId) : locationId ? db.leads.filter(l => l.locationId === locationId) : db.leads)
    .filter(l => inRange(l.createdAt))
  const counts = { new: 0, trial: 0, won: 0, lost: 0 }
  for (const l of leads) {
    if (l.status === 'won') counts.won++
    else if (l.status === 'lost') counts.lost++
    else if (isTrialStage(l.stage)) counts.trial++
    else counts.new++
  }
  return counts
}

// Full (not just top/bottom) associate leaderboard for a period, optionally scoped to one location.
function periodLeaderboard(start, end, locationId) {
  const inRange = periodInRangeFn(start, end)
  const associates = (locationId ? db.associates.filter(a => associateInLocation(a, locationId)) : db.associates).filter(a => a.active !== false)
  return associates.map(a => {
    const owned = db.leads.filter(l => l.associateId === a.id)
    const newLeads = owned.filter(l => inRange(l.createdAt))
    const won = owned.filter(l => l.status === 'won' && inRange(l.convertedAt))
    const trials = owned.filter(l => isTrialStage(l.stage) && inRange(l.createdAt || l.updatedAt))
    const revenue = won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    let followUps = 0, missed = 0
    for (const l of owned) {
      for (const f of l.followUps || []) {
        if (!inRange(f.date)) continue
        followUps++
        if (f.done === false) missed++
      }
    }
    return {
      associateId: a.id, name: a.name, locationId: a.locationId, active: a.active !== false,
      newLeads: newLeads.length, trials: trials.length, won: won.length, revenue,
      followUpRate: followUps ? Math.round(((followUps - missed) / followUps) * 100) : 0
    }
  }).sort((a, b) => b.revenue - a.revenue)
}

// Leads grouped by source with won-rate, for a period optionally scoped to one location.
function periodSourceBreakdown(start, end, locationId) {
  const inRange = periodInRangeFn(start, end)
  const leads = (locationId ? db.leads.filter(l => l.locationId === locationId) : db.leads)
    .filter(l => inRange(l.createdAt))
  const map = {}
  for (const l of leads) {
    const key = l.sourceName || 'Unknown'
    map[key] = map[key] || { source: key, count: 0, wonCount: 0 }
    map[key].count++
    if (l.status === 'won') map[key].wonCount++
  }
  return Object.values(map)
    .map(s => ({ ...s, wonRate: s.count ? Math.round((s.wonCount / s.count) * 100) : 0 }))
    .sort((a, b) => b.count - a.count)
}

function periodLabelFor(range, start) {
  if (range === 'week') return start.toLocaleString('en-US', { month: 'short', day: 'numeric' })
  if (range === 'year') return String(start.getFullYear())
  return start.toLocaleString('en-US', { month: 'short', year: '2-digit' })
}

const validPeriodDate = (v) => v && v !== '-' && !isNaN(new Date(v).getTime())

// Per-channel outreach effectiveness for follow-ups logged within [start, end).
// The lead schema has no explicit "response" signal, only `done` (the
// follow-up was carried out) vs `done: false` (missed/pending) — so
// `responded` is a proxy: follow-ups actually completed on that channel.
function periodChannelPerformance(start, end, locationId, associateId) {
  const inRange = periodInRangeFn(start, end)
  const leads = associateId ? db.leads.filter(l => l.associateId === associateId) : locationId ? db.leads.filter(l => l.locationId === locationId) : db.leads
  const map = {}
  for (const l of leads) {
    for (const f of l.followUps || []) {
      if (!f.channel || !inRange(f.date)) continue
      const row = map[f.channel] = map[f.channel] || { channel: f.channel, attempted: 0, responded: 0, contacted: new Set(), won: new Set() }
      row.attempted++
      if (f.done !== false) row.responded++
      row.contacted.add(l.id)
      if (l.status === 'won') row.won.add(l.id)
    }
  }
  return Object.values(map)
    .map(r => ({
      channel: r.channel,
      attempted: r.attempted,
      responded: r.responded,
      responseRate: r.attempted ? Math.round((r.responded / r.attempted) * 100) : 0,
      won: r.won.size,
      conversionRate: r.contacted.size ? Math.round((r.won.size / r.contacted.size) * 100) : 0
    }))
    .sort((a, b) => b.attempted - a.attempted)
}

// Follow-up health: `overdueCount` is a live snapshot (as of now, not the
// selected period — matches the overdue logic in computeFollowUpState),
// everything else is scoped to follow-ups logged within [start, end).
// `avgResponseHours` is a proxy: the average gap between a lead's
// consecutive logged follow-ups, since the schema only stores dates (no
// separate "message sent" vs "reply received" timestamps).
function periodFollowUpAnalytics(start, end, locationId) {
  const inRange = periodInRangeFn(start, end)
  const leads = locationId ? db.leads.filter(l => l.locationId === locationId) : db.leads
  const today = new Date().toISOString().slice(0, 10)
  let overdueCount = 0
  const gapsHours = []
  const byAssociate = {}
  const byChannel = {}
  for (const l of leads) {
    const fus = (l.followUps || []).filter(f => f.date && f.date !== '-').sort((a, b) => a.date.localeCompare(b.date))
    for (let i = 0; i < fus.length; i++) {
      const f = fus[i]
      if (f.done === false && f.date < today) overdueCount++
      if (!inRange(f.date)) continue
      if (l.associateId) {
        const a = byAssociate[l.associateId] = byAssociate[l.associateId] || { total: 0, done: 0 }
        a.total++
        if (f.done !== false) a.done++
      }
      if (f.done === false) {
        const ch = f.channel || 'unknown'
        byChannel[ch] = (byChannel[ch] || 0) + 1
      }
      if (i > 0) {
        const hours = (new Date(f.date).getTime() - new Date(fus[i - 1].date).getTime()) / 3600000
        if (hours >= 0) gapsHours.push(hours)
      }
    }
  }
  const avgResponseHours = gapsHours.length ? Math.round(gapsHours.reduce((s, h) => s + h, 0) / gapsHours.length) : 0
  const completionRateByAssociate = Object.entries(byAssociate)
    .map(([associateId, v]) => ({
      associateId, name: db.associates.find(a => a.id === associateId)?.name || 'Unknown',
      rate: v.total ? Math.round((v.done / v.total) * 100) : 0
    }))
    .sort((a, b) => b.rate - a.rate)
  const missedByChannel = Object.entries(byChannel)
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count)
  return { overdueCount, avgResponseHours, completionRateByAssociate, missedByChannel }
}

// Leads grouped by class/membership type (`classType` — confirmed the actual
// field name via grep of seed data and Leads/Import/Settings pages; there is
// no separate "membershipType" field) for leads created within [start, end).
function periodRevenueMix(start, end, locationId, associateId) {
  const inRange = periodInRangeFn(start, end)
  const leads = (associateId ? db.leads.filter(l => l.associateId === associateId) : locationId ? db.leads.filter(l => l.locationId === locationId) : db.leads)
    .filter(l => inRange(l.createdAt))
  const map = {}
  for (const l of leads) {
    const key = l.classType || 'Unspecified'
    map[key] = map[key] || { type: key, count: 0, wonCount: 0, revenue: 0 }
    map[key].count++
    if (l.status === 'won') {
      map[key].wonCount++
      map[key].revenue += l.valueEstimate || 0
    }
  }
  return Object.values(map)
    .map(m => ({ type: m.type, count: m.count, revenue: m.revenue, wonRate: m.count ? Math.round((m.wonCount / m.count) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
}

// Conversion-by-age for the last 6 period-cohorts (weeks or months, matching
// `range`), bounded to 6 to keep cost predictable per the design doc — looking
// back further would mean re-running the full leads scan per extra cohort.
// `offset` is the currently-viewed period; cohorts run from 5-periods-back
// through the current period, oldest first.
function periodCohortConversion(range, offset, now, locationId, associateId) {
  const leads = associateId ? db.leads.filter(l => l.associateId === associateId) : locationId ? db.leads.filter(l => l.locationId === locationId) : db.leads
  const cohorts = []
  for (let k = 5; k >= 0; k--) {
    const co = offset + k
    const { start, end } = periodBounds(range, co, now)
    const inCohort = periodInRangeFn(start, end)
    const cohortLeads = leads.filter(l => inCohort(l.createdAt))
    const size = cohortLeads.length
    const convertedBy = (periodsLater) => {
      const boundaryOffset = co - periodsLater
      const boundaryEnd = boundaryOffset >= 0 ? periodBounds(range, boundaryOffset, now).end : now
      if (!size) return 0
      const won = cohortLeads.filter(l => l.status === 'won' && validPeriodDate(l.convertedAt) && new Date(l.convertedAt) < boundaryEnd)
      return Math.round((won.length / size) * 100)
    }
    cohorts.push({
      cohortLabel: periodLabelFor(range, start),
      size,
      convertedByP1: convertedBy(1),
      convertedByP2: convertedBy(2),
      convertedByP4: convertedBy(4)
    })
  }
  return cohorts
}

// Revenue target vs actual for the current period, using each associate's
// monthly revenue target pro-rated to the period length: a
// custom `&from&to` window is pro-rated by day-count against a 30-day month;
// a `range=week` bucket is pro-rated by the average weeks-per-month; a plain
// `range=month` bucket uses the monthly target as-is.
function periodGoalTracking(range, start, end, customRange, locationId) {
  const periodDays = Math.max(1, Math.round((end - start) / 86400000))
  const WEEKS_PER_MONTH = 365 / 12 / 7
  const inRange = periodInRangeFn(start, end)
  const proRate = (monthly) => {
    if (customRange) return Math.round((monthly * periodDays) / 30)
    return range === 'week' ? Math.round(monthly / WEEKS_PER_MONTH) : monthly
  }

  const scopedAssociates = locationId ? db.associates.filter(a => associateInLocation(a, locationId)) : db.associates
  const perAssociate = scopedAssociates.filter(a => a.active !== false).map(a => {
    const periodWins = db.leads.filter(l => l.associateId === a.id && l.status === 'won' && inRange(l.convertedAt))
    const actual = periodWins.reduce((sum, lead) => sum + (Number(lead.valueEstimate) || 0), 0)
    const target = proRate(a.revenueTargetMonthly || 0)
    return {
      associateId: a.id, name: a.name, locationId: a.locationId, locationIds: a.locationIds || [a.locationId],
      target, actual,
      attainmentPct: target ? Math.round((actual / target) * 100) : 0,
      conversionTargetPct: a.conversionTargetPct || 0
    }
  })

  const scopedLocations = locationId ? db.locations.filter(loc => loc.id === locationId) : db.locations
  const perStudio = scopedLocations.map(loc => {
    const owned = perAssociate.filter(a => a.locationId === loc.id)
    const target = owned.reduce((s, a) => s + a.target, 0)
    const actual = owned.reduce((s, a) => s + a.actual, 0)
    return {
      locationId: loc.id, name: loc.name,
      target, actual,
      attainmentPct: target ? Math.round((actual / target) * 100) : 0
    }
  })

  return { perAssociate, perStudio }
}

// Currently-open leads grouped by pipeline stage, scoped to a location —
// shows where the live pipeline is bunching up, independent of the
// period filter (stage is a point-in-time property, not a period event).
function currentStageBreakdown(locationId) {
  const leads = (locationId ? db.leads.filter(l => l.locationId === locationId) : db.leads)
    .filter(l => l.status === 'open')
  const map = {}
  const now = Date.now()
  for (const l of leads) {
    const key = l.stage || 'Unspecified'
    map[key] = map[key] || { stage: key, count: 0, ageSum: 0 }
    map[key].count++
    map[key].ageSum += Math.max(0, Math.round((now - new Date(l.createdAt).getTime()) / 86400000))
  }
  return Object.values(map)
    .map(m => ({ stage: m.stage, count: m.count, avgAgeDays: m.count ? Math.round(m.ageSum / m.count) : 0 }))
    .sort((a, b) => b.count - a.count)
}

// Lost leads within [start, end) grouped by source — highlights which
// channels convert badly rather than just which channels bring volume
// (that's `periodSourceBreakdown`, which counts all leads, not just lost).
function periodLostBySource(start, end, locationId) {
  const inRange = periodInRangeFn(start, end)
  const leads = (locationId ? db.leads.filter(l => l.locationId === locationId) : db.leads)
    .filter(l => l.status === 'lost' && inRange(l.createdAt))
  const map = {}
  for (const l of leads) {
    const key = l.sourceName || 'Unspecified'
    map[key] = map[key] || { source: key, count: 0, lostValue: 0 }
    map[key].count++
    map[key].lostValue += l.valueEstimate || 0
  }
  return Object.values(map).sort((a, b) => b.count - a.count)
}

// Associate Overview / Studio Overview reports — a single endpoint for both,
// switched by `scope`. Always returns three comparison columns (selected
// period, immediately preceding period, same period last year) rather than
// the single either/or `compare` mode the older by-location endpoint uses.
// `scope`/`entityId` are fully client-supplied and default to "every entity",
// so for an agent they must be pinned to something inside their own scope:
// a studio entityId must be one of their locations, an associate entityId
// must belong to one of their locations, and the "all entities" default is
// downgraded to their first location (never left global). Returns null when
// the request names an entity outside their scope, which callers turn into a
// 403 rather than silently showing different data than was asked for.
function resolveReportScope(req) {
  const scope = req.query.scope === 'associate' ? 'associate' : 'studio'
  const entityId = req.query.entityId || null
  const allowed = allowedLocationIds(req, null)
  if (!allowed) return { scope, entityId } // admin: unrestricted

  if (scope === 'studio') {
    if (!entityId) return { scope, entityId: allowed[0] || '__none__' }
    return allowed.includes(entityId) ? { scope, entityId } : null
  }
  const inScope = db.associates.filter(a => allowed.some(id => associateInLocation(a, id)))
  if (!entityId) {
    const own = req.authUser.associateId
    return { scope, entityId: (own && inScope.some(a => a.id === own)) ? own : (inScope[0]?.id || '__none__') }
  }
  return inScope.some(a => a.id === entityId) ? { scope, entityId } : null
}

// Entity picker options, clamped the same way so the UI can't offer a studio
// or associate the caller isn't allowed to select.
function reportEntitiesFor(req, scope) {
  const allowed = allowedLocationIds(req, null)
  if (scope === 'associate') {
    return db.associates
      .filter(a => a.active !== false)
      .filter(a => !allowed || allowed.some(id => associateInLocation(a, id)))
      .map(a => ({ id: a.id, name: a.name, locationId: a.locationId }))
  }
  return db.locations
    .filter(l => !allowed || allowed.includes(l.id))
    .map(l => ({ id: l.id, name: l.name }))
}

app.get('/api/analytics/report', (req, res) => {
  const resolved = resolveReportScope(req)
  if (!resolved) return res.status(403).json({ error: 'Not permitted for this location' })
  const { scope, entityId } = resolved
  const now = new Date()
  const period = resolveReportPeriod(req, now)
  const { start, end } = period
  const prev = precedingPeriod(start, end)
  const yoy = yearAgoPeriod(start, end)

  const entities = reportEntitiesFor(req, scope)
  const entityName = entityId
    ? (entities.find(e => e.id === entityId)?.name || 'Unknown')
    : (scope === 'associate' ? 'All associates' : 'All studios')

  // A handful of recent same-length buckets for the trend chart — 6 for
  // week/month, 5 years back for year, skipped entirely for a custom range
  // (arbitrary custom windows don't tile into a meaningful trend series).
  const trend = []
  if (!period.customRange) {
    const bucketRange = period.range
    const baseOffset = REPORT_PRESETS[period.preset]?.offset ?? 0
    const count = bucketRange === 'year' ? 5 : 6
    for (let i = count - 1; i >= 0; i--) {
      const { start: s, end: e, label } = periodBounds(bucketRange, baseOffset + i, now)
      trend.push({ periodLabel: periodLabelFor(bucketRange, s), ...reportMetrics(scope, entityId, s, e) })
    }
  }

  const locationArg = scope === 'studio' ? entityId : null
  const associateArg = scope === 'associate' ? entityId : null
  const cohortBucketRange = period.customRange ? 'week' : period.range === 'year' ? 'month' : period.range
  const cohortOffset = period.customRange ? 0 : (REPORT_PRESETS[period.preset]?.offset ?? 0)

  res.json({
    scope, entityId, entityName,
    entities,
    period: { label: period.label, start: start.toISOString().slice(0, 10), end: new Date(end.getTime() - 86400000).toISOString().slice(0, 10), preset: period.preset || 'custom' },
    comparisons: {
      current: { label: period.label, ...reportMetrics(scope, entityId, start, end) },
      previousPeriod: { label: `${prev.start.toISOString().slice(0, 10)} to ${new Date(prev.end.getTime() - 86400000).toISOString().slice(0, 10)}`, ...reportMetrics(scope, entityId, prev.start, prev.end) },
      yoy: { label: `${yoy.start.toISOString().slice(0, 10)} to ${new Date(yoy.end.getTime() - 86400000).toISOString().slice(0, 10)}`, ...reportMetrics(scope, entityId, yoy.start, yoy.end) }
    },
    trend,
    stageBreakdown: reportBreakdown(scope, entityId, start, end, 'stage'),
    sourceBreakdown: reportBreakdown(scope, entityId, start, end, 'source'),
    funnel: periodFunnel(start, end, locationArg, associateArg),
    channelPerformance: periodChannelPerformance(start, end, locationArg, associateArg),
    revenueMix: periodRevenueMix(start, end, locationArg, associateArg),
    cohortConversion: periodCohortConversion(cohortBucketRange, cohortOffset, now, locationArg, associateArg),
    // Only meaningful when looking at one studio (who's driving its numbers) —
    // a single associate has no peers to rank against here.
    leaderboard: scope === 'studio' ? periodLeaderboard(start, end, entityId || null) : []
  })
})

// Drill-down for a single stage/source row on the report above — the exact
// same period/scope filters, narrowed to one group value, returning enough
// per-lead detail to list and open each one.
app.get('/api/analytics/report/drill', (req, res) => {
  const resolved = resolveReportScope(req)
  if (!resolved) return res.status(403).json({ error: 'Not permitted for this location' })
  const { scope, entityId } = resolved
  const period = resolveReportPeriod(req, new Date())
  const inRange = periodInRangeFn(period.start, period.end)
  const groupField = req.query.stage !== undefined ? 'stage' : 'source'
  const groupValue = req.query.stage !== undefined ? req.query.stage : req.query.source
  const leads = scopedLeads(scope, entityId)
    .filter(l => inRange(l.createdAt))
    .filter(l => ((groupField === 'stage' ? l.stage : l.sourceName) || 'Unspecified') === groupValue)
    .slice(0, 100)
    .map(l => ({ id: l.id, fullName: l.fullName, stage: l.stage, status: l.status, source: l.sourceName, revenue: l.valueEstimate || 0, createdAt: l.createdAt }))
  res.json({ leads })
})

app.get('/api/analytics/performance/by-location', (req, res) => {
  const range = req.query.range === 'month' ? 'month' : 'week'
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const now = new Date()
  // `?location=` is client-supplied and this handler otherwise falls back to
  // whole-org aggregates when it's absent. For an agent, clamp it to their
  // own locations and never allow the unscoped fallback: `agentScopeIds` is
  // null for an admin, and the agent's allowed ids otherwise.
  const agentScopeIds = allowedLocationIds(req, null)
  const requestedLocation = req.query.location || null
  if (agentScopeIds && requestedLocation && !agentScopeIds.includes(requestedLocation)) {
    return res.status(403).json({ error: 'Not permitted for this location' })
  }
  // Every aggregate below that would otherwise be org-wide is computed for
  // this single location when the caller is an agent.
  const scopeLoc = agentScopeIds ? (requestedLocation || agentScopeIds[0] || '__none__') : null
  const visibleLocations = agentScopeIds ? db.locations.filter(l => agentScopeIds.includes(l.id)) : db.locations
  const locationId = requestedLocation

  // Lightweight per-location history mode: used by expandable studio rows to
  // lazily fetch just that location's sparkline data, avoiding the heavier
  // full-payload computation (rows/leaderboard/funnel/sourceBreakdown) on
  // every keystroke of the offset paginator.
  if (locationId) {
    const n = Math.min(24, Math.max(1, Number(req.query.history) || 12))
    const history = []
    for (let i = n - 1; i >= 0; i--) {
      const { start, end } = periodBounds(range, offset + i, now)
      history.push({ periodLabel: periodLabelFor(range, start), ...periodSummary(start, end, locationId) })
    }
    return res.json({ locationId, range, offset, history })
  }

  const compare = req.query.compare === 'yoy' ? 'yoy' : 'prev'

  // Custom date range (`&from=&to=`) overrides range/offset bucketing for all
  // aggregates below — the period nav becomes informational only while a
  // custom window is active.
  const fromQ = req.query.from ? new Date(`${req.query.from}T00:00:00`) : null
  const toQ = req.query.to ? new Date(`${req.query.to}T00:00:00`) : null
  const customRange = !!(fromQ && toQ && !isNaN(fromQ.getTime()) && !isNaN(toQ.getTime()) && fromQ <= toQ)

  let start, end, label
  if (customRange) {
    start = fromQ
    end = new Date(toQ.getTime() + 86400000) // end date is inclusive
    label = `${start.toISOString().slice(0, 10)} to ${toQ.toISOString().slice(0, 10)}`
  } else {
    ;({ start, end, label } = periodBounds(range, offset, now))
  }
  const periodDays = Math.max(1, Math.round((end - start) / 86400000))

  // Previous-period bounds for Δ%/compare-mode: either the immediately
  // preceding window of equal length ("prev", default) or the same window
  // one year earlier ("yoy").
  let pStart, pEnd
  if (customRange) {
    if (compare === 'yoy') {
      pStart = new Date(start.getFullYear() - 1, start.getMonth(), start.getDate())
      pEnd = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate())
    } else {
      pEnd = start
      pStart = new Date(start.getTime() - periodDays * 86400000)
    }
  } else if (compare === 'yoy') {
    ;({ start: pStart, end: pEnd } = periodBounds(range, offset + (range === 'week' ? 52 : 12), now))
  } else {
    ;({ start: pStart, end: pEnd } = periodBounds(range, offset + 1, now))
  }
  const previous = periodSummary(pStart, pEnd, scopeLoc)

  const rows = periodLocationRows(start, end, visibleLocations)

  let history = []
  const historyLen = Math.min(24, Math.max(0, Number(req.query.history) || 0))
  if (historyLen > 0 && !customRange) {
    for (let i = historyLen - 1; i >= 0; i--) {
      const { start: s, end: e } = periodBounds(range, offset + i, now)
      history.push({ periodLabel: periodLabelFor(range, s), ...periodSummary(s, e, scopeLoc) })
    }
  }

  const funnel = {
    ...periodFunnel(start, end, scopeLoc),
    byLocation: visibleLocations.map(loc => ({ locationId: loc.id, locationName: loc.name, ...periodFunnel(start, end, loc.id) }))
  }
  const leaderboard = periodLeaderboard(start, end, scopeLoc)
  const sourceBreakdown = periodSourceBreakdown(start, end, scopeLoc)
  const channelPerformance = periodChannelPerformance(start, end, scopeLoc)
  const followUpAnalytics = periodFollowUpAnalytics(start, end, scopeLoc)
  const revenueMix = periodRevenueMix(start, end, scopeLoc)
  // Cohort conversion looks back across period-cohorts distinct from the
  // selected window; a custom date range doesn't map onto week/month cohorts
  // cleanly, so it falls back to cohorts anchored on the current bucketed
  // period (offset 0) for that range.
  const cohortConversion = periodCohortConversion(range, customRange ? 0 : offset, now, scopeLoc)
  const goalTracking = periodGoalTracking(range, start, end, customRange, scopeLoc)

  // Per-location breakdown, scoped to whichever studios the client selected
  // (`&locations=id1,id2`) — the report renders one full section per entry
  // here, primary studio first, defaulting to just the first studio in `rows`
  // when nothing was requested so the report opens focused rather than dumping
  // every studio at once.
  // Clamped to the caller's own studios: an agent's `&locations=` can never
  // name a studio outside their scope, and an empty request falls back to
  // their own first studio rather than an arbitrary one.
  const requestedIds = (req.query.locations || '').split(',').map(s => s.trim()).filter(Boolean)
  const permittedIds = agentScopeIds ? requestedIds.filter(id => agentScopeIds.includes(id)) : requestedIds
  const selectedIds = permittedIds.length ? permittedIds : (rows[0] ? [rows[0].locationId] : [])
  const perLocation = selectedIds.map(id => {
    const loc = db.locations.find(l => l.id === id)
    const locStart = periodSummary(start, end, id)
    const locPrev = periodSummary(pStart, pEnd, id)
    let locHistory = []
    if (historyLen > 0 && !customRange) {
      for (let i = historyLen - 1; i >= 0; i--) {
        const { start: s, end: e } = periodBounds(range, offset + i, now)
        locHistory.push({ periodLabel: periodLabelFor(range, s), ...periodSummary(s, e, id) })
      }
    }
    return {
      locationId: id,
      locationName: loc?.name || rows.find(r => r.locationId === id)?.locationName || 'Unknown studio',
      summary: locStart,
      previous: locPrev,
      history: locHistory,
      funnel: periodFunnel(start, end, id),
      leaderboard: periodLeaderboard(start, end, id),
      sourceBreakdown: periodSourceBreakdown(start, end, id),
      channelPerformance: periodChannelPerformance(start, end, id),
      followUpAnalytics: periodFollowUpAnalytics(start, end, id),
      revenueMix: periodRevenueMix(start, end, id),
      cohortConversion: periodCohortConversion(range, customRange ? 0 : offset, now, id),
      goalTracking: periodGoalTracking(range, start, end, customRange, id),
      stageBreakdown: currentStageBreakdown(id),
      lostBySource: periodLostBySource(start, end, id)
    }
  })

  res.json({
    range, offset, label, compare, customRange,
    start: start.toISOString().slice(0, 10), end: new Date(end.getTime() - 86400000).toISOString().slice(0, 10),
    rows,
    previous,
    history,
    funnel,
    leaderboard,
    sourceBreakdown,
    channelPerformance,
    followUpAnalytics,
    revenueMix,
    cohortConversion,
    goalTracking,
    stageBreakdown: currentStageBreakdown(scopeLoc),
    lostBySource: periodLostBySource(start, end, scopeLoc),
    selectedLocationIds: selectedIds,
    perLocation
  })
})

app.get('/api/analytics/associate-compare', (req, res) => {
  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7)
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7)
  // Agents only ever compare against peers in their own studio(s).
  const allowed = allowedLocationIds(req, null)
  const rows = db.associates
    .filter(a => a.active !== false)
    .filter(a => !allowed || allowed.some(id => associateInLocation(a, id)))
    .map(a => {
    const owned = db.leads.filter(l => l.associateId === a.id)
    const open = owned.filter(l => l.status === 'open')
    const won = owned.filter(l => l.status === 'won')
    const revenue = won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    const followUps = owned.reduce((s, l) => s + (l.followUps || []).length, 0)
    const missed = owned.reduce((s, l) => s + (l.fu && l.fu.missedCount ? l.fu.missedCount : 0), 0)
    const newThisMonth = owned.filter(l => (l.createdAt || '').slice(0, 7) === thisMonth).length
    const wonThisMonth = owned.filter(l => l.status === 'won' && (l.convertedAt || l.createdAt || '').slice(0, 7) === thisMonth).length
    const wonLastMonth = owned.filter(l => l.status === 'won' && (l.convertedAt || l.createdAt || '').slice(0, 7) === lastMonth).length
    const enriched = owned.map(l => enrichLead(l, db))
    const avgScore = enriched.length ? Math.round(enriched.reduce((s, l) => s + l.ai.score, 0) / enriched.length) : 0
    return {
      associateId: a.id, name: a.name, locationId: a.locationId,
      open: open.length, won: won.length, lost: owned.filter(l => l.status === 'lost').length,
      revenue, total: owned.length,
      conversion: owned.length ? Math.round((won.length / owned.length) * 100) : 0,
      target: a.targetMonthly || 10,
      followUps, missed,
      avgScore,
      newThisMonth, wonThisMonth, wonLastMonth,
      attainment: Math.min(100, Math.round((wonThisMonth / (a.targetMonthly || 10)) * 100)),
      hot: enriched.filter(l => l.ai.risk === 'hot').length
    }
  })
  res.json(rows.sort((a, b) => b.revenue - a.revenue))
})

// Full single-associate deep dive for the leaderboard's "click a row" detail
// view — everything associate-compare shows plus a 6-month trend, source/
// stage breakdown, follow-up health and recent activity lists, all scoped to
// this one person's owned leads.
app.get('/api/analytics/associate/:id/scorecard', (req, res) => {
  const associate = db.associates.find(a => a.id === req.params.id)
  if (!associate) return res.status(404).json({ error: 'Associate not found' })
  // An agent may only open the scorecard of someone in their own studio(s).
  const allowed = allowedLocationIds(req, null)
  if (allowed && !allowed.some(id => associateInLocation(associate, id))) {
    return res.status(403).json({ error: 'Not permitted for this associate' })
  }

  const owned = db.leads.filter(l => l.associateId === associate.id)
  const open = owned.filter(l => l.status === 'open')
  const won = owned.filter(l => l.status === 'won')
  const lost = owned.filter(l => l.status === 'lost')
  const revenue = won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
  const enriched = owned.map(l => enrichLead(l, db))
  const avgScore = enriched.length ? Math.round(enriched.reduce((s, l) => s + l.ai.score, 0) / enriched.length) : 0
  const hot = enriched.filter(l => l.ai.risk === 'hot').length

  let followUps = 0, missed = 0, overdueCount = 0
  const todayStr = new Date().toISOString().slice(0, 10)
  for (const l of owned) {
    for (const f of l.followUps || []) {
      followUps++
      if (f.done === false) {
        missed++
        if (f.date && f.date < todayStr) overdueCount++
      }
    }
  }
  const followUpRate = followUps ? Math.round(((followUps - missed) / followUps) * 100) : 0

  const now = new Date()
  const history = []
  for (let i = 5; i >= 0; i--) {
    const y = now.getFullYear(), m = now.getMonth() - i
    const start = new Date(y, m, 1), end = new Date(y, m + 1, 1)
    const inRange = periodInRangeFn(start, end)
    const periodLeads = owned.filter(l => inRange(l.createdAt))
    const periodWon = owned.filter(l => l.status === 'won' && inRange(l.convertedAt))
    history.push({
      periodLabel: start.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
      newLeads: periodLeads.length,
      won: periodWon.length,
      revenue: periodWon.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    })
  }

  const thisMonthKey = now.toISOString().slice(0, 7)
  const lastMonthKey = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7)
  const newThisMonth = owned.filter(l => (l.createdAt || '').slice(0, 7) === thisMonthKey).length
  const wonThisMonth = owned.filter(l => l.status === 'won' && (l.convertedAt || l.createdAt || '').slice(0, 7) === thisMonthKey).length
  const revenueThisMonth = owned.filter(l => l.status === 'won' && (l.convertedAt || l.createdAt || '').slice(0, 7) === thisMonthKey)
    .reduce((sum, lead) => sum + (Number(lead.valueEstimate) || 0), 0)
  const wonLastMonth = owned.filter(l => l.status === 'won' && (l.convertedAt || l.createdAt || '').slice(0, 7) === lastMonthKey).length
  const revenueTarget = associate.revenueTargetMonthly || 0
  const conversionTarget = associate.conversionTargetPct || 0

  const sourceMap = {}
  for (const l of owned) {
    const key = l.sourceName || 'Unspecified'
    sourceMap[key] = sourceMap[key] || { source: key, count: 0, wonCount: 0 }
    sourceMap[key].count++
    if (l.status === 'won') sourceMap[key].wonCount++
  }
  const sourceBreakdown = Object.values(sourceMap)
    .map(s => ({ ...s, wonRate: s.count ? Math.round((s.wonCount / s.count) * 100) : 0 }))
    .sort((a, b) => b.count - a.count)

  const stageMap = {}
  for (const l of open) {
    const key = l.stage || 'Unspecified'
    stageMap[key] = (stageMap[key] || 0) + 1
  }
  const stageBreakdown = Object.entries(stageMap).map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count)

  const loc = db.locations.find(l => l.id === associate.locationId)

  res.json({
    associate: {
      id: associate.id, name: associate.name, color: associate.color, photoUrl: associate.photoUrl, photoZoom: associate.photoZoom, photoPosX: associate.photoPosX, photoPosY: associate.photoPosY,
      locationId: associate.locationId, locationName: loc?.name || '',
      active: associate.active !== false, revenueTargetMonthly: revenueTarget, conversionTargetPct: conversionTarget
    },
    totals: {
      total: owned.length, open: open.length, won: won.length, lost: lost.length,
      revenue, avgDealValue: won.length ? Math.round(revenue / won.length) : 0,
      conversion: owned.length ? Math.round((won.length / owned.length) * 100) : 0,
      avgScore, hot
    },
    thisMonth: {
      newLeads: newThisMonth, won: wonThisMonth, wonLastMonth,
      revenue: revenueThisMonth, revenueTarget,
      conversion: owned.length ? Math.round((won.length / owned.length) * 100) : 0,
      conversionTarget,
      attainmentPct: revenueTarget ? Math.min(999, Math.round((revenueThisMonth / revenueTarget) * 100)) : 0
    },
    followUpHealth: { total: followUps, missed, overdueCount, completionRate: followUpRate },
    history,
    sourceBreakdown,
    stageBreakdown,
    recentNew: owned.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8)
      .map(l => ({ id: l.id, fullName: l.fullName, stage: l.stage, createdAt: l.createdAt })),
    recentWon: won.slice().sort((a, b) => String(b.convertedAt || b.createdAt).localeCompare(String(a.convertedAt || a.createdAt))).slice(0, 8)
      .map(l => ({ id: l.id, fullName: l.fullName, revenue: l.valueEstimate || 0, convertedAt: l.convertedAt || l.createdAt }))
  })
})

app.get('/api/activity', (req, res) => res.json(db.activity.slice(0, 40)))

app.get('/api/imports', (req, res) => res.json(db.importHistory))

// ---------- OpenAI GPT enrichment ----------

app.get('/api/gpt/status', (req, res) => {
  res.json({ configured: gpt.isEnabled(db), model: gpt.modelName(db), enabled: db.settings.gpt?.enabled !== false })
})

app.post('/api/gpt/test', async (req, res) => {
  try {
    const probe = { fullName: 'Sample Lead', stage: 'Contacted', status: 'open', sourceName: 'Website Form', phone: '919999999999', email: 'sample@example.com', remarks: 'Keen on a trial class this week. Wants evening slots.', followUps: [] }
    const result = await gpt.enrichLeadWithGpt(probe, db)
    if (!result) return res.status(400).json({ ok: false, error: 'OpenAI is not configured. Add your API key.' })
    res.json({ ok: true, gpt: result })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

app.post('/api/leads/:id/enrich', async (req, res) => {
  const lead = leadById(req.params.id)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  try {
    const result = await gpt.enrichLeadWithGpt(lead, db)
    if (!result) return res.status(400).json({ ok: false, error: 'OpenAI is not configured. Add your API key in Settings > Integrations (or OPENAI_API_KEY env).' })
    lead.aiGpt = result
    lead.lastActivityAt = nowIso()
    markDirty(lead.id)
    save()
    res.json({ ok: true, gpt: result })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

// ---------- Respond.io messaging ----------

app.get('/api/respondio/status', async (req, res) => {
  if (!db.settings.respondio) db.settings.respondio = {}
  if (!db.settings.respondio.inboundWebhookKey) {
    db.settings.respondio.inboundWebhookKey = genWebhookKey()
    try {
      await saveMetaNow()
    } catch (e) {
      return res.status(502).json({ error: `Could not save Respond.io settings: ${e.message}` })
    }
  }
  res.json({
    configured: respondio.isConfigured(db),
    workspaceId: respondio.workspaceId(db),
    inboundWebhookUrl: `${req.protocol}://${req.get('host')}/api/respondio/webhook/${db.settings.respondio.inboundWebhookKey}`,
    snippetsSessionConfigured: respondioInternal.isSessionConfigured(db),
    snippetsBotId: db.settings.respondio?.session?.botId || '',
    snippetsOrgId: db.settings.respondio?.session?.orgId || ''
  })
})

// Respond.io only tells us about inbound replies (a lead messaging back) if we
// ask it to — the app otherwise only ever pulls conversation history when a
// lead's drawer happens to be open, so a reply can sit unseen indefinitely.
// Add a Workflow in Respond.io (trigger: Message Received) with a Webhook
// action pointed at the URL from /api/respondio/status; the payload contents
// don't matter here — arrival alone is enough to tell every open tab "go
// refetch conversations now" over the existing SSE channel.
app.post('/api/respondio/webhook/:key', (req, res) => {
  if (!db.settings.respondio?.inboundWebhookKey || req.params.key !== db.settings.respondio.inboundWebhookKey) {
    return res.status(404).json({ error: 'Unknown webhook' })
  }
  const contact = req.body?.contact || req.body?.data?.contact || {}
  const lead = inbox.matchLeadFromWebhook(db, req.body)
  const extracted = inbox.extractInboundMessage(req.body)
  const assigneeId = inbox.resolveAssigneeId(db.associates, contact.assignee?.email)
  if (lead) {
    if (!lead.respondId && contact.id) lead.respondId = contact.id
    inbox.recordMessage(db, lead.id, { direction: 'inbound', ...extracted })
    if (assigneeId) inbox.assign(db, lead.id, assigneeId)
    lead.lastActivityAt = nowIso()
    markDirty(lead.id)
    save()
    broadcastChange('respondio-message', { leadId: lead.id })
  } else {
    // No CRM lead matches this contact — still record it under a
    // contact-scoped key so "all messages from all members" holds even for
    // respond.io conversations that never became a lead in this CRM.
    const info = inbox.contactDisplayInfo(contact)
    if (info.contactId) {
      const key = inbox.contactKey(info.contactId)
      inbox.setContactInfo(db, key, { ...info, assigneeId })
      inbox.recordMessage(db, key, { direction: 'inbound', ...extracted })
      save()
      broadcastChange('respondio-message', { leadId: key })
    } else {
      broadcastChange('respondio-message')
    }
  }
  res.json({ ok: true })
})

// Pulls a lead's respond.io message history into the local inbox store,
// merging with anything already recorded locally. Dedupes by content (and,
// when respond.io provides one, its messageId too — see
// inbox.knownMessageKeys for why a message needs to match on either form).
function latestStatus(statusList) {
  if (!Array.isArray(statusList) || !statusList.length) return null
  return statusList[statusList.length - 1]?.type || statusList[statusList.length - 1]?.status || null
}

async function backfillLeadMessages(lead) {
  try {
    const remote = await respondio.syncLeadConversations(db, lead)
    const known = inbox.knownMessageKeys(db, lead.id)
    for (const m of remote?.conversations?.[0]?.messages || []) {
      const keys = inbox.messageDedupeKeys(m.id, m.direction, m.content)
      if (!keys.some(k => known.has(k))) {
        inbox.recordMessage(db, lead.id, { direction: m.direction, channel: 'whatsapp', type: m.type, content: m.content, sentAt: inbox.normalizeSentAt(m.sentAt), sourceId: m.id || null, status: m.status || null })
        keys.forEach(k => known.add(k))
      }
    }
  } catch (e) { /* backfill is best-effort */ }
}

// Same idea as backfillLeadMessages, but for a contact-scoped key with no
// matching lead — pulls straight from message/list by respond.io contact
// id instead of going through leadIdentifier().
async function backfillContactMessages(key, contactId) {
  try {
    const known = inbox.knownMessageKeys(db, key)
    const raw = await respondio.listMessagesByIdentifier(db, `id:${contactId}`, 100)
    for (const m of raw) {
      const content = m.message?.text || m.message?.template?.name || ''
      const direction = m.traffic === 'incoming' ? 'inbound' : 'outbound'
      const keys = inbox.messageDedupeKeys(m.messageId, direction, content)
      if (!keys.some(k => known.has(k))) {
        const sentAt = inbox.normalizeSentAt(m.timestamp || m.sentAt || m.createdAt || m.status?.[0]?.timestamp || respondio.messageIdToMs(m.messageId) || null)
        inbox.recordMessage(db, key, { direction, channel: 'whatsapp', type: m.message?.type || 'text', content, sentAt, sourceId: m.messageId || null, status: latestStatus(m.status) })
        keys.forEach(k => known.add(k))
      }
    }
  } catch (e) { /* backfill is best-effort */ }
}

// Full workspace sync for the Inbox page: pulls every respond.io contact
// (POST /contact/list) and, for each, backfills its message history —
// matched to a CRM lead when possible, kept as a contact-only row
// otherwise — so "all messages from all members" holds even for
// respond.io conversations that never became a lead. Also reconciles
// status (open/closed) and the assigned agent from respond.io's own
// records, since that's the source of truth for who owns a conversation.
app.post('/api/inbox/sync', async (req, res) => {
  if (!respondio.isConfigured(db)) return res.status(400).json({ error: 'Respond.io is not configured.' })
  let matched = 0, unmatched = 0, processed = 0
  try {
    await respondio.listContacts(db, {
      pageSize: 100,
      // Process and checkpoint page-by-page instead of collecting the
      // whole contact list first — a large workspace (5000+ contacts, one
      // rate-limited message-history call each) can take a long time, and
      // save()'s debounced write can lose most of an in-memory batch if
      // the process restarts before it's had a chance to flush. Awaiting
      // saveNow() after every page means at most one page's worth of work
      // is ever at risk, not the whole run.
      onPage: async (page) => {
        for (const contact of page) {
          const assigneeId = inbox.resolveAssigneeId(db.associates, contact.assignee?.email)
          const lead = inbox.matchLeadFromWebhook(db, { contact })
          if (lead) {
            matched++
            if (contact.id && !lead.respondId) lead.respondId = contact.id
            if (assigneeId) inbox.assign(db, lead.id, assigneeId)
            if (contact.status === 'open' || contact.status === 'closed') inbox.setStatus(db, lead.id, contact.status)
            await backfillLeadMessages(lead)
            markDirty(lead.id)
          } else if (contact.id) {
            unmatched++
            const key = inbox.contactKey(contact.id)
            inbox.setContactInfo(db, key, { ...inbox.contactDisplayInfo(contact), assigneeId })
            await backfillContactMessages(key, contact.id)
          }
          processed++
        }
        await saveNow()
        broadcastChange('respondio-message')
      }
    })
    res.json({ ok: true, contactsFound: processed, matched, unmatched })
  } catch (e) {
    res.status(502).json({ error: e.message, contactsFound: processed, matched, unmatched })
  }
})

app.post('/api/respondio/test', async (req, res) => {
  try {
    const r = await respondio.testConnection(db)
    res.json({ ok: true, ...r })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

// Proactively resolves + caches respondId for every lead with an email or
// phone, so conversation history is linked up front instead of only on the
// first time each lead's drawer happens to be opened — a real backfill for
// "sync everything Respond.io already has," not just per-lead lazy pull.
// Sequential (not Promise.all) to respect Respond.io's small per-second rate
// limit across what can be thousands of leads; a manual admin action, not
// something run automatically.
app.post('/api/respondio/sync-all-contacts', async (req, res) => {
  if (!respondio.isConfigured(db)) return res.status(400).json({ error: 'Respond.io is not configured.' })
  const candidates = db.leads.filter(l => !l.respondId && respondio.leadIdentifier(db, l))
  let linked = 0, checked = 0
  for (const lead of candidates) {
    checked++
    try {
      const contact = await respondio.findContact(db, { lead })
      if (contact?.id) {
        lead.respondId = contact.id
        markDirty(lead.id)
        linked++
      }
    } catch (e) { /* skip this lead, keep going */ }
  }
  if (linked) save()
  log('respondio', `Synced Respond.io contacts: ${linked} linked of ${checked} checked`)
  res.json({ checked, linked, totalLeads: db.leads.length, alreadyLinked: db.leads.length - candidates.length })
})

app.get('/api/respondio/conversations/:leadId', async (req, res) => {
  const lead = leadById(req.params.leadId)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  if (!respondio.isConfigured(db)) return res.json({ configured: false, conversations: [] })
  try {
    const data = await respondio.syncLeadConversations(db, lead)
    if (data?.contact?.id && data.contact.id !== lead.respondId) {
      lead.respondId = data.contact.id
      markDirty(lead.id)
      save()
    }
    res.json({ configured: true, ...data })
  } catch (e) {
    res.status(502).json({ configured: true, error: e.message, conversations: [] })
  }
})

app.get('/api/respondio/templates', async (req, res) => {
  if (!respondio.isConfigured(db)) return res.json({ configured: false, templates: [] })
  try {
    // Fetch templates across every WhatsApp channel in the workspace, not
    // just the first one resolveChannelId happens to find — workspaces with
    // more than one connected WABA channel otherwise only ever see the first
    // channel's approved templates.
    const channelIds = await respondio.resolveWhatsAppChannelIds(db)
    if (!channelIds.length) return res.json({ configured: true, templates: [], error: 'No WhatsApp channel found in your Respond.io workspace.' })

    // Fetched sequentially, not Promise.all — Respond.io's per-second rate
    // limit is small enough that fetching every channel's paginated template
    // list in parallel reliably triggers a 429 (see server/respondio.js api()).
    const seen = new Set()
    const all = []
    for (const id of channelIds) {
      const list = (await respondio.listTemplates(db, id)).map(t => ({ ...t, channelId: t.channelId || id }))
      for (const t of list) {
        const key = `${t.channelId}:${t.id || t.name}`
        if (seen.has(key)) continue
        seen.add(key)
        all.push(t)
      }
    }

    // Respond.io/WhatsApp report status under varying field shapes/casing
    // ("approved", "APPROVED", or a nested { name: 'APPROVED' } object) —
    // normalize before comparing so approved templates aren't dropped.
    const templates = all.filter(t => {
      const raw = t.status?.name ?? t.status?.value ?? t.status
      return !raw || String(raw).toLowerCase() === 'approved'
    })
    res.json({ configured: true, channelId: channelIds[0], templates })
  } catch (e) {
    res.status(502).json({ configured: true, templates: [], error: e.message })
  }
})

// Resolves who a message/template goes to for POST /api/respondio/send.
// Three shapes, in priority order: an existing CRM lead (`leadId`, the
// original behavior); an existing inbox row with no matching lead
// (`key`, formatted `contact:<respondio-id>` — see inbox.js); or someone
// respond.io has never seen before (`newContact: { fullName, email, phone }`),
// which creates the respond.io contact first. Returns a lead-shaped object
// (real lead, or a synthetic one carrying just respondId/email/phone) plus
// the inbox key its messages should be recorded under.
async function resolveSendTarget(req) {
  if (req.body.leadId) {
    const lead = leadById(req.body.leadId)
    if (!lead) throw Object.assign(new Error('Lead not found'), { status: 404 })
    return { lead, key: lead.id }
  }
  if (req.body.key && req.body.key.startsWith('contact:')) {
    return { lead: { respondId: req.body.key.slice('contact:'.length) }, key: req.body.key }
  }
  if (req.body.newContact) {
    const { fullName, email, phone } = req.body.newContact
    if (!String(email || '').trim() && !String(phone || '').trim()) {
      throw Object.assign(new Error('Provide an email or phone to start a new conversation.'), { status: 400 })
    }
    const contact = await respondio.getOrCreateContact(db, { fullName, email, phone })
    const matchedLead = inbox.matchLeadFromWebhook(db, { contact })
    if (matchedLead) {
      if (!matchedLead.respondId) matchedLead.respondId = contact.id
      return { lead: matchedLead, key: matchedLead.id }
    }
    const key = inbox.contactKey(contact.id)
    inbox.setContactInfo(db, key, inbox.contactDisplayInfo(contact))
    return { lead: { respondId: contact.id }, key }
  }
  throw Object.assign(new Error('No recipient specified — pass leadId, key, or newContact.'), { status: 400 })
}

// Workspace agents (respond.io users) for the "change agent" picker.
app.get('/api/respondio/agents', async (req, res) => {
  if (!respondio.isConfigured(db)) return res.json({ configured: false, agents: [] })
  try {
    const users = await respondio.listUsers(db)
    res.json({ configured: true, agents: users.map(u => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || `User ${u.id}`, email: u.email })) })
  } catch (e) {
    res.status(502).json({ configured: true, agents: [], error: e.message })
  }
})

// Free-text search across every respond.io contact — powers the Inbox's
// "message any contact" picker for contacts never synced locally.
app.get('/api/respondio/contacts/search', async (req, res) => {
  if (!respondio.isConfigured(db)) return res.json({ configured: false, contacts: [] })
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ configured: true, contacts: [] })
  try {
    const results = await respondio.searchContacts(db, q)
    res.json({
      configured: true,
      contacts: results.map(c => ({
        id: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'Unknown contact',
        email: c.email || '',
        phone: c.phone || ''
      }))
    })
  } catch (e) {
    res.status(502).json({ configured: true, contacts: [], error: e.message })
  }
})

// Creates (or updates) a respond.io contact standalone — not tied to sending
// a message. If it matches an existing CRM lead by email/phone, links to
// that lead; otherwise it becomes a contact-only inbox row.
app.post('/api/respondio/contacts', async (req, res) => {
  if (!respondio.isConfigured(db)) return res.status(400).json({ error: 'Respond.io is not configured.' })
  const { fullName, email, phone } = req.body
  if (!String(email || '').trim() && !String(phone || '').trim()) return res.status(400).json({ error: 'Provide an email or phone.' })
  try {
    const contact = await respondio.getOrCreateContact(db, { fullName, email, phone })
    const matchedLead = inbox.matchLeadFromWebhook(db, { contact })
    let key
    if (matchedLead) {
      key = matchedLead.id
      if (!matchedLead.respondId) { matchedLead.respondId = contact.id; markDirty(matchedLead.id) }
      // A matched lead with no prior messages has no db.inbox.conversations
      // entry yet — listConversations only lists keys that already have one,
      // so the new row would be invisible until the first message synced.
      inbox.assign(db, key, matchedLead.associateId || null)
    } else {
      key = inbox.contactKey(contact.id)
      inbox.setContactInfo(db, key, inbox.contactDisplayInfo(contact))
    }
    save()
    broadcastChange('respondio-message')
    res.status(201).json({ key, contact })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.post('/api/respondio/send', async (req, res) => {
  if (!respondio.isConfigured(db)) return res.status(400).json({ error: 'Respond.io is not configured. Add your API key in Settings > Integrations.' })
  let lead, key
  try {
    ({ lead, key } = await resolveSendTarget(req))
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message })
  }
  const channel = ['call', 'whatsapp', 'email', 'sms'].includes(req.body.channel) ? req.body.channel : 'whatsapp'
  const text = String(req.body.message || '').trim()
  const template = req.body.template || null
  const useTemplate = req.body.useTemplate === true || !!template || (channel === 'whatsapp' && !(lead.respondio?.lastOutboundAt || (lead.followUps || []).some(f => f.via === 'respondio')))
  if (!useTemplate && !text) return res.status(400).json({ error: 'Message is required' })
  // useTemplate can be forced true for a lead's first WhatsApp message even
  // when the caller only meant to send free text (see the `useTemplate`
  // computation above). Previously a missing `template` silently fell back
  // to `{ name: '', ... }`, which produced a message with no template name
  // and no components — delivered, but rendered as a blank chat bubble.
  // Fail fast with a clear error instead.
  if (useTemplate && (!template || !String(template.name || '').trim())) {
    return res.status(400).json({ error: 'Select a WhatsApp template before sending the first message on this channel.' })
  }
  try {
    const contact = await respondio.getOrCreateContact(db, lead)
    if (!contact?.id) return res.status(502).json({ error: 'Could not resolve a Respond.io contact for this lead.' })
    lead.respondId = contact.id
    try {
      await respondio.setConversationStatus(db, lead, 'open')
    } catch (e) {
      return res.status(502).json({ error: `Could not open a ${channel} conversation: ${e.message}` })
    }
    const shouldUseTemplate = useTemplate
    const msg = shouldUseTemplate
      ? await respondio.sendTemplateMessage(db, lead, template)
      : await respondio.sendMessage(db, lead, text, channel)
    // `lead` is a real CRM lead only when it came through leadId or a
    // matched newContact — synthetic contact-only targets (unmatched inbox
    // rows, or a brand-new contact with no matching lead) have no
    // `followUps` array and aren't in db.leads, so skip the CRM-side bookkeeping.
    const isRealLead = Array.isArray(lead.followUps)
    if (isRealLead && req.body.logFollowUp !== false) {
      lead.followUps.push({
        id: uid('fu'),
        date: new Date().toISOString().slice(0, 10),
        comments: shouldUseTemplate
          ? `[whatsapp template] ${template?.name || 'template'}${Array.isArray(template?.parameters) && template.parameters.length ? ` — ${template.parameters.join(' | ')}` : ''}`
          : `[${channel}] ${text}`,
        channel,
        done: true,
        via: 'respondio',
        conversationId: lead.respondId
      })
      lead.respondio = { ...(lead.respondio || {}), lastOutboundAt: nowIso(), lastOutboundType: shouldUseTemplate ? 'template' : 'text' }
      lead.lastActivityAt = nowIso()
    }
    inbox.recordMessage(db, key, {
      direction: 'outbound',
      channel,
      type: shouldUseTemplate ? 'whatsapp_template' : 'text',
      content: shouldUseTemplate ? '' : text,
      templateName: shouldUseTemplate ? (template?.name || '') : ''
    })
    if (isRealLead) markDirty(lead.id)
    save()
    broadcastChange('respondio-message', { leadId: key })
    res.json({ ok: true, contactId: contact.id, message: msg })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// ---------- Unified Inbox ----------

app.get('/api/inbox', (req, res) => {
  inbox.ensure(db)
  const { studio, associate, channel, status, unread, q } = req.query
  const rows = inbox.listConversations(db, db.leads, {
    studio, associate, channel, status, q,
    unreadOnly: unread === '1' || unread === 'true'
  })
  res.json({ configured: respondio.isConfigured(db), conversations: rows })
})

// :key is either a lead id or contact:<respondio-contact-id> — the latter
// for a respond.io contact with no matching CRM lead (see inbox.js). Those
// rows are read-only (no lead to send/assign against), so only /messages
// and /read need to handle both; /status and /assign require a real lead.
// The /api/inbox list scopes rows by `assigneeId` (the conversation's
// assignee, falling back to the lead's owner) — see inbox.listConversations.
// The per-conversation routes below did no check at all, so an agent could
// read any conversation by id. Mirror the list's rule here, plus the lead's
// location, and answer 404 so a miss doesn't confirm the key exists.
function canSeeInboxKey(req, key) {
  if (req.authUser.role === 'admin') return true
  inbox.ensure(db)
  const conv = db.inbox?.conversations?.[key]
  const lead = key.startsWith('contact:') ? null : leadById(key)
  if (!key.startsWith('contact:') && !lead) return false
  if (lead && !isAllowedLocation(req, lead.locationId)) return false
  const assigneeId = conv?.assigneeId || lead?.associateId || null
  return !!req.authUser.associateId && assigneeId === req.authUser.associateId
}

function denyInbox(res) {
  return res.status(404).json({ error: 'Lead not found' })
}

app.get('/api/inbox/:key/messages', async (req, res) => {
  const key = req.params.key
  if (!canSeeInboxKey(req, key)) return denyInbox(res)
  if (key.startsWith('contact:')) {
    if (respondio.isConfigured(db)) {
      const contactId = key.slice('contact:'.length)
      await backfillContactMessages(key, contactId)
      save()
    }
    return res.json({ messages: inbox.listMessages(db, key) })
  }
  const lead = leadById(key)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  inbox.ensure(db)
  // Backfill from Respond.io once so a conversation that predates this
  // store's rollout still shows its history, then merge with anything
  // already recorded locally.
  if (respondio.isConfigured(db)) {
    await backfillLeadMessages(lead)
    markDirty(lead.id)
    save()
  }
  res.json({ messages: inbox.listMessages(db, lead.id) })
})

// Serves the cached respond.io contact profile (tags, custom fields,
// assignee, language/country) instantly, kicking off a background refresh
// when the cache is stale rather than blocking the request on respond.io —
// the panel polls this every 5 min while a conversation is open.
app.get('/api/inbox/:key/profile', async (req, res) => {
  const key = req.params.key
  if (!canSeeInboxKey(req, key)) return denyInbox(res)
  inbox.ensure(db)
  const lead = key.startsWith('contact:') ? null : leadById(key)
  if (!lead && !key.startsWith('contact:')) return res.status(404).json({ error: 'Lead not found' })
  const contactId = key.startsWith('contact:') ? key.slice('contact:'.length) : lead?.respondId
  const cached = inbox.getCachedProfile(db, key)
  res.json({ profile: cached, stale: inbox.isProfileStale(db, key) })
  if (!contactId || !respondio.isConfigured(db)) return
  if (!inbox.isProfileStale(db, key)) return
  try {
    const fresh = await respondio.getContactById(db, contactId)
    if (fresh) {
      inbox.setCachedProfile(db, key, fresh)
      save()
      broadcastChange('respondio-message', { leadId: key })
    }
  } catch (e) { /* best-effort background refresh */ }
})

app.post('/api/inbox/:key/read', (req, res) => {
  const key = req.params.key
  if (!canSeeInboxKey(req, key)) return denyInbox(res)
  if (!key.startsWith('contact:') && !leadById(key)) return res.status(404).json({ error: 'Lead not found' })
  res.json(inbox.markRead(db, key))
  save()
})

app.post('/api/inbox/:leadId/status', (req, res) => {
  const lead = leadById(req.params.leadId)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  if (!canSeeInboxKey(req, req.params.leadId)) return denyInbox(res)
  try {
    const c = inbox.setStatus(db, lead.id, req.body.status)
    save()
    res.json(c)
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/api/inbox/:leadId/assign', (req, res) => {
  const lead = leadById(req.params.leadId)
  if (!canSeeLead(req, lead)) return res.status(404).json({ error: 'Lead not found' })
  if (!canSeeInboxKey(req, req.params.leadId)) return denyInbox(res)
  const c = inbox.assign(db, lead.id, req.body.associateId || null)
  save()
  res.json(c)
})

// Assigns/unassigns the conversation to a respond.io workspace agent — the
// real source of truth, visible in respond.io's own dashboard too (see
// respondio.assignConversation). `agentId` is a workspace user id, or null
// to unassign. Works for a matched CRM lead (:key is a lead id) or an
// unmatched inbox row (:key is `contact:<respondio-id>`) alike. Also
// updates the local CRM associate mapping when the agent's email matches an
// associate record, so the "Assigned to" dropdown stays in sync.
app.post('/api/inbox/:key/agent', async (req, res) => {
  if (!respondio.isConfigured(db)) return res.status(400).json({ error: 'Respond.io is not configured.' })
  const key = req.params.key
  if (!canSeeInboxKey(req, key)) return denyInbox(res)
  const agentId = req.body.agentId === undefined || req.body.agentId === '' ? null : req.body.agentId
  let lead = null
  let identifier
  if (key.startsWith('contact:')) {
    identifier = `id:${key.slice('contact:'.length)}`
  } else {
    lead = leadById(key)
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    identifier = respondio.leadIdentifier(db, lead) || (lead.respondId ? `id:${lead.respondId}` : null)
    if (!identifier) return res.status(400).json({ error: 'Lead has no email, phone, or linked Respond.io contact.' })
  }
  try {
    const contact = key.startsWith('contact:')
      ? await respondio.assignConversationById(db, key.slice('contact:'.length), agentId)
      : await respondio.assignConversation(db, lead, agentId)
    const agents = await respondio.listUsers(db).catch(() => [])
    const agent = agents.find(u => String(u.id) === String(agentId))
    inbox.setRespondioAssignee(db, key, agentId)
    inbox.assign(db, key, inbox.resolveAssigneeId(db.associates, agent?.email))
    if (lead) markDirty(lead.id)
    save()
    broadcastChange('respondio-message', { leadId: key })
    res.json({ ok: true, contact })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// Pulls snippets from respond.io's own "Saved Replies" (internal API, no
// public equivalent — see respondioInternal.js) and merges them into the
// local snippet list the composer's Snippets picker already reads from.
app.post('/api/inbox/snippets/sync', async (req, res) => {
  if (!respondioInternal.isSessionConfigured(db)) {
    return res.status(400).json({ error: 'Respond.io session is not configured — paste a fresh authToken/botId/orgId in Settings > Integrations.' })
  }
  try {
    const remote = await respondioInternal.listSnippets(db)
    const result = inbox.mergeRespondioSnippets(db, remote)
    await saveMetaNow()
    res.json({ ok: true, fetched: remote.length, ...result })
  } catch (e) {
    res.status(e.name === 'SessionExpiredError' ? 401 : 502).json({ error: e.message })
  }
})

app.get('/api/inbox/snippets', (req, res) => res.json(inbox.listSnippets(db)))
app.post('/api/inbox/snippets', (req, res) => {
  const s = inbox.addSnippet(db, req.body)
  save()
  res.status(201).json(s)
})
app.patch('/api/inbox/snippets/:id', (req, res) => {
  try {
    const s = inbox.updateSnippet(db, req.params.id, req.body)
    save()
    res.json(s)
  } catch (e) { res.status(404).json({ error: e.message }) }
})
app.delete('/api/inbox/snippets/:id', (req, res) => {
  inbox.deleteSnippet(db, req.params.id)
  save()
  res.json({ ok: true })
})

// ---------- Mailtrap email ----------

app.get('/api/mailtrap/status', (req, res) => {
  const c = mailer.config(db)
  res.json({ configured: mailer.isConfigured(db), enabled: c.enabled === true, host: c.host, port: c.port, user: c.user, fromEmail: c.fromEmail, fromName: c.fromName, digestEnabled: db.settings.reminders?.emailReminders === true })
})

app.post('/api/mailtrap/verify', blockAgentWrite, async (req, res) => {
  try {
    res.json(await mailer.verifyTransport(db))
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
})

app.post('/api/mailtrap/test', blockAgentWrite, async (req, res) => {
  const to = String(req.body.to || '').trim()
  if (!to) return res.status(400).json({ error: 'Recipient email is required' })
  try {
    const r = await mailer.testMail(db, to)
    res.json(r)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.post('/api/mailtrap/reminders', blockAgentWrite, async (req, res) => {
  try {
    const r = await runReminderDigest(db)
    res.json(r)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// ---------- performance details ----------

app.get('/api/analytics/performance/details', (req, res) => {
  const range = req.query.range === 'week' ? 'week' : 'month'
  const now = new Date()
  const buckets = []
  let fmt, key

  if (range === 'week') {
    const start = weekStart(now)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(start.getTime() + i * 86400000)
      buckets.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleString('en-US', { weekday: 'short', day: 'numeric' }) })
    }
    fmt = (d) => d.toISOString().slice(0, 10)
  } else {
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
      buckets.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-US', { month: 'long' }) })
    }
    fmt = (d) => d.toISOString().slice(0, 7)
  }

  const row = buckets.map(b => ({ ...b, newLeads: [], won: [], missed: [], lost: [] }))
  const idx = Object.fromEntries(row.map((r, i) => [r.key, i]))

  const validDate2 = (v) => v && v !== '-' && !isNaN(new Date(v).getTime())
  const detailLead = (lead) => ({
    id: lead.id,
    fullName: lead.fullName,
    createdAt: lead.createdAt,
    sourceName: lead.sourceName,
    stage: lead.stage,
    status: lead.status,
    associateId: lead.associateId,
    locationId: lead.locationId,
    center: lead.center,
    classType: lead.classType,
    remarks: lead.remarks,
    value: lead.valueEstimate || 0
  })

  for (const l of scopeLeadsForReq(req)) {
    if (validDate2(l.createdAt)) {
      const ck = fmt(new Date(l.createdAt))
      if (idx[ck] !== undefined && row[idx[ck]].newLeads.length < 200) row[idx[ck]].newLeads.push(detailLead(l))
    }
    if (l.status === 'won' && validDate2(l.convertedAt)) {
      const wk = fmt(new Date(l.convertedAt))
      if (idx[wk] !== undefined && row[idx[wk]].won.length < 200) row[idx[wk]].won.push({ ...detailLead(l), eventAt: l.convertedAt })
    }
    if (l.status === 'lost' && validDate2(l.createdAt)) {
      const lk = fmt(new Date(l.createdAt))
      if (idx[lk] !== undefined && row[idx[lk]].lost.length < 200) row[idx[lk]].lost.push(detailLead(l))
    }
    for (const f of l.followUps || []) {
      if (!validDate2(f.date) || f.done !== false) continue
      const fk = fmt(new Date(f.date))
      if (idx[fk] !== undefined && row[idx[fk]].missed.length < 200) row[idx[fk]].missed.push({ ...detailLead(l), eventAt: f.date, comments: f.comments })
    }
  }

  res.json({ range, buckets: row })
})

// ---------- realtime (SSE) ----------
// Notifies open browser tabs when Supabase reports a change we didn't just
// make ourselves (two-way sync), so the UI can refetch instead of going stale.

const sseClients = new Set()

function broadcastChange(type, data) {
  const payload = data ? { type, ...data } : { type }
  for (const res of sseClients) res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

// Authenticated like every other /api route, except the token may arrive as
// `?token=` because EventSource can't send headers (see the /api gate above).
app.get('/api/events', (req, res, next) => requireAuthWithQueryToken(db)(req, res, next), (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  res.write('retry: 3000\n\n')
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

// A bulk write (a big Google Sheets sync, a Force full resync, a Momence
// contact backfill) can produce thousands of individual Supabase Realtime
// change events in a burst. Un-debounced, each one broadcast an SSE message
// immediately, and every connected tab's client refetched the ENTIRE
// bootstrap (every lead) per message — thousands of full refetches for one
// bulk operation, which is what actually exhausted the browser's connection
// pool (ERR_INSUFFICIENT_RESOURCES). Coalesce a burst into one broadcast.
let remoteChangeBroadcastTimer = null
onRemoteChange(() => {
  clearTimeout(remoteChangeBroadcastTimer)
  remoteChangeBroadcastTimer = setTimeout(() => broadcastChange('remote-change'), 800)
})

// ---------- static hosting ----------

const dist = path.join(__dirname, '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const PREFERRED_PORT = Number(process.env.PORT) || 3001
const MAX_PORT_ATTEMPTS = 20

// One-time backfill: older CSV imports created follow-ups without an id,
// channel or done flag, which silently breaks the per-channel outreach
// One-time: point specific named associates at their real headshot instead
// of initials, once the corresponding file exists in public/avatars/ (copied
// into the build's static root by Vite) — see that folder for the exact
// filenames expected. Only sets photoUrl if not already set, so it never
// overwrites a photo someone picked via Settings.
const ASSOCIATE_PHOTOS = {
  'nadiya shaikh': '/avatars/nadiya-shaikh.png',
  'shipra bhika': '/avatars/shipra-bhika.jpg',
  'imran shaikh': '/avatars/imran-shaikh.jpg',
  'deesha changwani': '/avatars/deesha-changwani.png'
}
function backfillAssociatePhotos(db) {
  let changed = false
  for (const a of db.associates) {
    const photo = ASSOCIATE_PHOTOS[String(a.name || '').trim().toLowerCase()]
    if (!photo) continue
    // Earlier deploy wrote these paths with a stale/wrong extension before the
    // real files existed — only skip if photoUrl is a genuine custom override.
    if (a.photoUrl && a.photoUrl !== photo && !a.photoUrl.startsWith('/avatars/')) continue
    if (a.photoUrl !== photo) { a.photoUrl = photo; changed = true }
  }
  if (changed) save()
}

// columns (they only match followUps with a recognized `channel`) and the
// timeline's done/overdue badges (`!f.done` treats undefined as pending).
function backfillFollowUps(db) {
  const fuChannels = db.settings.followUpChannels?.length ? db.settings.followUpChannels : ['call', 'whatsapp', 'email', 'sms']
  const todayKey = new Date().toISOString().slice(0, 10)
  let touched = 0
  for (const lead of db.leads) {
    let changed = false
    lead.followUps = (lead.followUps || []).map((f, idx) => {
      const patch = {}
      const normalized = normalizeFollowUpFields(f.date, f.comments)
      if (normalized.date !== f.date) patch.date = normalized.date
      if (normalized.comments !== f.comments) patch.comments = normalized.comments
      if (!f.id) patch.id = uid('fu')
      if (!f.channel) patch.channel = fuChannels[idx % fuChannels.length]
      const shouldBeDone = Boolean(normalized.comments) && (normalized.date ? normalized.date <= todayKey : true)
      if (f.done === undefined || f.done !== shouldBeDone) patch.done = shouldBeDone
      if (Object.keys(patch).length) { changed = true; return { ...f, ...patch } }
      return f
    })
    if (changed) { markDirty(lead.id); touched++ }
  }
  if (touched) {
    console.log(`[physique57-leads] backfilled follow-up channel/done on ${touched} lead(s)`)
    save()
  }
}

async function start() {
  await init()
  db = load()
  if (!Array.isArray(db.webhookIntegrations)) db.webhookIntegrations = []
  if (!Array.isArray(db.webhookLogs)) db.webhookLogs = []
  backfillFollowUps(db)
  backfillAssociatePhotos(db)
  startReminderScheduler(db)
  if (db.settings.zohoPeople?.enabled && zohoPeople.isConfigured(db)) {
    zohoPeople.refreshOnDutyCache(db).then(() => save())
  }
  const server = await listenOnAvailablePort(PREFERRED_PORT)
  activePort = server.address().port
  console.log(`[physique57-leads] server listening on http://localhost:${activePort}`)
  console.log(`[physique57-leads] storage: ${supabase.isEnabled() ? 'Supabase' : 'local JSON'}`)
  console.log(`[physique57-leads] gpt: ${gpt.isEnabled(db) ? gpt.modelName(db) : 'heuristics only'}`)
  console.log(`[physique57-leads] respondio: ${respondio.isConfigured(db) ? 'configured' : 'not configured'}`)
  console.log(`[physique57-leads] mailtrap: ${mailer.isConfigured(db) ? 'configured' : 'not configured'}`)
  console.log(`[physique57-leads] momence configured: ${momence.isConfigured(db)}`)
  setTimeout(() => syncMomenceLifecycleEvidence().catch(error => console.warn(`[physique57-leads] Momence evidence sync skipped: ${error.message}`)), 15000)
  setInterval(() => syncMomenceLifecycleEvidence().catch(error => console.warn(`[physique57-leads] Momence evidence sync failed: ${error.message}`)), 6 * 60 * 60 * 1000)
}

function listenOnAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort
    const tryListen = () => {
      const server = app.listen(port)
      server.once('listening', () => resolve(server))
      server.once('error', error => {
        if (error.code !== 'EADDRINUSE' || port >= startPort + MAX_PORT_ATTEMPTS - 1) return reject(error)
        console.warn(`[physique57-leads] port ${port} is busy; trying ${port + 1}`)
        port += 1
        tryListen()
      })
    }
    tryListen()
  })
}

start().catch(error => {
  console.error('[physique57-leads] failed to start:', error)
  process.exitCode = 1
})
