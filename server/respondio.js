// Respond.io integration (API v2).
// Lets users send WhatsApp / SMS / email messages to a lead directly from the
// app and read the full conversation history. API key can come from the
// RESPONDIO_API_KEY env var or Settings > Integrations.
//
// Endpoints (match @respond-io/typescript-sdk v1.4.0):
//   GET  /v2/contact/{identifier}                      -> get contact (404 = not found)
//   POST /v2/contact/create_or_update/{identifier}     -> create/update contact
//   POST /v2/contact/list                              -> list contacts (body: { search, filter })
//   POST /v2/contact/{identifier}/message              -> send a message (body: { channelId, message })
//   GET  /v2/contact/{identifier}/message/list         -> conversation history (?limit=)
//   POST /v2/contact/{identifier}/conversation/status  -> open/close conversation
//   GET  /v2/space/user                                -> workspace users
//   GET  /v2/space/channel                             -> workspace channels
//   GET  /v2/space/channel/{channelId}/template        -> approved WABA templates for a channel
// where identifier is one of id:<id>, email:<addr>, phone:+<digits>.
// channelId is a numeric Respond.io channel ID, not a channel name — pass
// null to fall back to the contact's last-interacted channel (fails with a
// 404 for contacts that have never been messaged before).
const BASE = 'https://api.respond.io/v2'

export function apiKey(db) {
  return (process.env.USER_RESPONDIO_API_KEY || '').trim() || db?.settings?.respondio?.apiKey?.trim() || ''
}

export function workspaceId(db) {
  return (process.env.USER_RESPONDIO_WORKSPACE_ID || '').trim() || db?.settings?.respondio?.workspaceId?.trim() || ''
}

export function isConfigured(db) {
  return Boolean(apiKey(db))
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Respond.io enforces a small per-second point budget (observed: 5 points).
// Pagination and multi-channel lookups can burst past that in normal use, so
// retry a 429 after the `retryAfter` (seconds) it reports instead of failing
// the whole request — a transient rate limit shouldn't drop every template
// already fetched in this call.
// Thrown when Respond.io rejects a contact identifier (email/phone) because
// that phone/email is already attached to a *different* contact than the one
// we resolved — happens when a lead's contact got merged/recreated on
// Respond.io's side after we cached `respondId`. The response body names the
// real contact to use, so callers can retry against it instead of failing.
class RespondioContactConflictError extends Error {
  constructor(contactId, message) {
    super(message)
    this.name = 'RespondioContactConflictError'
    this.contactId = contactId
  }
}

async function api(db, path, { method = 'GET', body } = {}, attempt = 0) {
  if (!isConfigured(db)) throw new Error('Respond.io is not configured. Add your API key in Settings > Integrations.')
  const headers = { Authorization: `Bearer ${apiKey(db)}`, Accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'

  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 429 && attempt < 4) {
      let retryAfter = 1
      try { retryAfter = Number(JSON.parse(text)?.retryAfter) || 1 } catch { /* non-JSON body, use default */ }
      await sleep(Math.min(retryAfter, 5) * 1000 + 100)
      return api(db, path, { method, body }, attempt + 1)
    }
    if (res.status === 400) {
      let parsed
      try { parsed = JSON.parse(text) } catch { /* non-JSON body */ }
      const conflictContactId = parsed?.message?.contactId
      const conflictMessage = parsed?.message?.message || parsed?.message
      if (conflictContactId && /already connected to a contact/i.test(String(conflictMessage || ''))) {
        throw new RespondioContactConflictError(conflictContactId, String(conflictMessage))
      }
    }
    throw new Error(`Respond.io ${res.status} ${path}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

// Runs a contact-scoped call (message send, conversation status, etc.)
// against the lead's resolved identifier, and if Respond.io reports that
// identifier now belongs to a different contact, retries once against the
// contact id it names — persisting the correction onto `lead.respondId` so
// every call after this one uses the right contact straight away.
async function withContactRetry(db, lead, run) {
  const identifier = leadIdentifier(db, lead)
  if (!identifier) throw new Error('Lead has no email or phone to use as a Respond.io identifier.')
  try {
    return await run(identifier)
  } catch (e) {
    if (e instanceof RespondioContactConflictError) {
      lead.respondId = e.contactId
      return await run(`id:${e.contactId}`)
    }
    throw e
  }
}

function digits(v) {
  return String(v || '').replace(/\D/g, '')
}

// Normalize a raw phone number to include a country code. Numbers already
// long enough to plausibly carry a country code are left untouched; short
// (likely local-format) numbers get the org's default country code prefixed
// so Respond.io's E.164-ish "phone:+<digits>" identifier resolves correctly.
function normalizedPhone(db, raw) {
  const d = digits(raw)
  if (!d) return ''
  if (d.length > 10) return d
  const cc = digits(db?.settings?.respondio?.defaultCountryCode) || '91'
  return cc + d
}

// Build the v2 contact identifier for a lead. The official SDK passes the raw
// identifier (no URL encoding), so we do the same.
export function leadIdentifier(db, lead) {
  if (!lead) return null
  if (lead.respondId) return `id:${lead.respondId}`
  const email = String(lead.email || '').trim().toLowerCase()
  const phone = normalizedPhone(db, lead.phone)
  if (email && email !== '-' && email.includes('@')) return `email:${email}`
  if (phone) return `phone:+${phone}`
  return null
}

function pickContact(data) {
  const c = data?.contact || data?.data?.contact || data?.data || data
  if (!c || typeof c !== 'object') return null
  // Some failure responses are still 200s shaped like { success: false, message }
  // with no actual contact fields — don't mistake that for a resolved contact.
  if (c.success === false || (!c.id && !c.contactId)) return null
  return { ...c, id: c.id || c.contactId }
}

function asList(data) {
  const arr = data?.items || data?.data || data?.contacts || data?.conversations || []
  return Array.isArray(arr) ? arr : []
}

function splitName(fullName) {
  const parts = String(fullName || 'Lead').trim().split(/\s+/)
  return {
    firstName: parts[0] || 'Lead',
    lastName: parts.slice(1).join(' ') || ''
  }
}

// Test the connection and pull workspace identity so Settings can show a live link.
export async function testConnection(db) {
  let user = null
  let channels = []
  try {
    const u = await api(db, '/space/user')
    const list = asList({ data: u })
    user = (list && list[0]) || u?.user || null
  } catch (e) { /* token already validated by the caller; identity is a bonus */ }
  try {
    channels = await listChannels(db)
  } catch (e) { /* optional */ }
  return { ok: true, data: user, channels }
}

// List workspace channels (GET /space/channel).
export async function listChannels(db) {
  const c = await api(db, '/space/channel')
  return asList(c)
}

// List every user (agent) in the workspace (GET /space/user), so a
// contact's `assignee.id` can be resolved to a real name/email instead of
// just a numeric id. Paginated via cursorId, same next-URL-following
// pattern as the other v2 list endpoints.
export async function listUsers(db) {
  const out = []
  let path = '/space/user?limit=100'
  let guard = 0
  while (path && guard < 10) {
    guard++
    const data = await api(db, path)
    out.push(...asList(data))
    const next = data?.pagination?.next || null
    if (!next) break
    path = next.replace(BASE, '')
  }
  return out
}

// Respond.io's documented `source` enum (whatsapp, whatsapp_cloud,
// 360dialog_whatsapp, ...) doesn't cover every value workspaces actually get
// back — e.g. a Meta-managed WABA channel reports source "whatsapp_business".
// Match by substring instead of an exact enum to avoid missing real channels.
function isWhatsAppSource(source) {
  return /whatsapp/i.test(String(source || ''))
}

// Resolve the numeric channelId to send through for a given logical channel
// ('whatsapp' | 'sms' | 'email' | 'call'). Respond.io's message API takes a
// top-level channelId (not a channel name) — passing none falls back to the
// contact's last-interacted channel, which fails with a 404 ("no last
// interacted channel") for brand-new contacts.
export async function resolveChannelId(db, channel) {
  const configured = db?.settings?.respondio?.channelIds?.[channel]
  if (configured) return Number(configured)
  if (channel !== 'whatsapp') return null
  try {
    const channels = await listChannels(db)
    const match = channels.find(c => isWhatsAppSource(c.source))
    return match?.id ?? null
  } catch (e) {
    return null
  }
}

// Same as resolveChannelId, but returns *every* WhatsApp channel in the
// workspace instead of just the first match. A workspace can have more than
// one connected WABA channel (e.g. multiple studio numbers); templates only
// show up under the channel they were submitted/approved on, so listing
// templates against a single hard-coded channel silently hides the others.
export async function resolveWhatsAppChannelIds(db) {
  const configured = db?.settings?.respondio?.channelIds?.whatsapp
  if (configured) return [Number(configured)]
  try {
    const channels = await listChannels(db)
    return channels.filter(c => isWhatsAppSource(c.source)).map(c => c.id).filter(Boolean)
  } catch (e) {
    return []
  }
}

// List approved WhatsApp templates for a channel (GET /space/channel/{id}/template).
// The endpoint paginates like respond.io's other v2 list endpoints (a
// `pagination.next` cursor/URL alongside the page's `items`) — fetching only
// the first page silently drops every template past the first page size.
export async function listTemplates(db, channelId) {
  if (!channelId) return []
  const out = []
  let path = `/space/channel/${channelId}/template`
  let guard = 0
  while (path && guard < 25) {
    guard++
    const data = await api(db, path)
    out.push(...asList(data))
    const next = data?.pagination?.next || data?.pagination?.nextCursor || data?.nextPage || data?.next || null
    if (!next) break
    if (/^https?:\/\//i.test(next)) {
      path = next.replace(BASE, '')
    } else if (String(next).startsWith('/')) {
      path = next
    } else {
      const base = `/space/channel/${channelId}/template`
      path = `${base}?cursor=${encodeURIComponent(next)}`
    }
  }
  return out
}

// Look up the lead's contact in Respond.io by identifier. Returns the contact
// object (with id) or null when it does not exist yet.
export async function findContact(db, { email, phone, lead } = {}) {
  const source = lead || { email, phone }
  const identifier = leadIdentifier(db, source)
  if (!identifier) return null
  try {
    const data = await api(db, `/contact/${identifier}`)
    return pickContact(data)
  } catch (e) {
    return null
  }
}

// Create or update the lead's contact and return the contact object (with id).
export async function getOrCreateContact(db, lead) {
  const { firstName, lastName } = splitName(lead.fullName || lead.name)
  const payload = { firstName, lastName }
  const mail = String(lead.email || '').trim().toLowerCase()
  const ph = normalizedPhone(db, lead.phone)
  if (mail && mail !== '-' && mail.includes('@')) payload.email = mail
  if (ph) payload.phone = `+${ph}`
  const data = await withContactRetry(db, lead, (identifier) =>
    api(db, `/contact/create_or_update/${identifier}`, { method: 'POST', body: payload })
  )
  const contact = pickContact(data)
  if (!contact) throw new Error(`Respond.io did not return a usable contact for this lead. Response: ${JSON.stringify(data).slice(0, 300)}`)
  return contact
}

// Open / close the lead's conversation (sending also opens it implicitly).
export async function setConversationStatus(db, lead, status) {
  if (!leadIdentifier(db, lead)) return null
  const data = await withContactRetry(db, lead, (identifier) =>
    api(db, `/contact/${identifier}/conversation/status`, { method: 'POST', body: { status } })
  )
  return pickContact(data)
}

// Send a text message to the lead's contact.
export async function sendMessage(db, lead, text, channel) {
  const channelId = await resolveChannelId(db, channel)
  const data = await withContactRetry(db, lead, (identifier) =>
    api(db, `/contact/${identifier}/message`, { method: 'POST', body: { channelId, message: { type: 'text', text } } })
  )
  return pickContact(data) || data
}

function countPlaceholders(text) {
  return (String(text || '').match(/\{\{\d+\}\}/g) || []).length
}

// Build the `components` array Respond.io/WhatsApp expects for a template
// send. WhatsApp renders the message as an empty bubble (delivered, but
// blank) whenever the outgoing components don't exactly mirror the approved
// template's own header/body/button placeholders — e.g. sending only a
// `body` component when the template also has a variable in its header. This
// walks the template's own component schema (as returned by the templates
// list endpoint) and slots the flat, ordered list of user-entered values
// (header vars first, then body, then button vars) into the matching
// component types.
function buildTemplateComponents(rawComponents, values) {
  const comps = Array.isArray(rawComponents) ? rawComponents : []
  const vals = Array.isArray(values) ? values.slice() : []
  const out = []
  let cursor = 0
  const take = n => {
    const slice = vals.slice(cursor, cursor + n).map(v => String(v ?? '').trim())
    cursor += n
    return slice
  }

  const header = comps.find(c => String(c.type).toUpperCase() === 'HEADER')
  const headerCount = countPlaceholders(header?.text)
  if (headerCount > 0) out.push({ type: 'header', parameters: take(headerCount).map(text => ({ type: 'text', text })) })

  const body = comps.find(c => String(c.type).toUpperCase() === 'BODY')
  // Fall back to treating every remaining value as a body param when the raw
  // component schema wasn't supplied (e.g. manually configured templates).
  const bodyCount = body ? countPlaceholders(body.text) : Math.max(vals.length - cursor, 0)
  if (bodyCount > 0) out.push({ type: 'body', parameters: take(bodyCount).map(text => ({ type: 'text', text })) })

  const buttons = comps.filter(c => String(c.type).toUpperCase() === 'BUTTONS').flatMap(c => c.buttons || [])
  buttons.forEach((btn, index) => {
    const n = countPlaceholders(btn.url || btn.text)
    if (n > 0) out.push({ type: 'button', sub_type: 'url', index: String(index), parameters: take(n).map(text => ({ type: 'text', text })) })
  })

  return out
}

export async function sendTemplateMessage(db, lead, template) {
  // Never silently substitute a blank template — a missing name/selection
  // used to fall back to `{ name: '', ... }` upstream, which sent a message
  // with no template name and no components and showed up as an empty chat
  // bubble. Fail loudly instead so the caller surfaces a real error.
  if (!template || typeof template !== 'object' || !String(template.name || '').trim()) {
    throw new Error('No WhatsApp template was selected — pick an approved template before sending.')
  }

  // Callers may pass a fully pre-built `components` array (already shaped for
  // the Respond.io API); otherwise build it from the template's raw
  // component schema plus the flat list of entered parameter values.
  const components = Array.isArray(template.components) && template.components.length
    ? template.components
    : buildTemplateComponents(template.rawComponents, template.parameters)

  // A template that the picker showed parameter fields for has variables by
  // definition — if none of them ended up in a component here, the raw
  // schema didn't match what countPlaceholders() expected (an API shape
  // change, a template missing its component text) and WhatsApp would
  // silently deliver an empty bubble instead of erroring. Fail loudly here
  // instead, since that's a far more useful signal than "sent successfully."
  const hasEnteredValues = Array.isArray(template.parameters) && template.parameters.some(v => String(v ?? '').trim())
  const componentsCarryValues = components.some(c => Array.isArray(c.parameters) && c.parameters.length)
  if (hasEnteredValues && !componentsCarryValues) {
    throw new Error(`Could not match "${template.name}"'s entered variables to its template structure — the message would send with a blank body. Try re-opening the template picker (refreshes the template schema) before sending again.`)
  }

  const channelId = template.channelId || await resolveChannelId(db, template.channel || 'whatsapp')
  const body = {
    channelId,
    message: {
      type: 'whatsapp_template',
      template: {
        name: String(template.name).trim(),
        languageCode: String(template.language || template.languageCode || 'en').trim(),
        components
      }
    }
  }

  const data = await withContactRetry(db, lead, (identifier) =>
    api(db, `/contact/${identifier}/message`, { method: 'POST', body })
  )
  return pickContact(data) || data
}

// Paginates through a contact's ENTIRE message history — the old version
// fetched only the first page (capped at `limit`), so any lead with more
// than ~100 messages silently lost its older history every time the drawer
// opened. Same cursor-following pattern as listTemplates(). Capped at 40
// pages (~4000 messages at the API's max page size) as a runaway backstop,
// not an expected ceiling.
export async function listMessagesByIdentifier(db, identifier, pageSize = 100) {
  if (!identifier) return []
  const out = []
  let path = `/contact/${identifier}/message/list?limit=${pageSize}`
  let guard = 0
  while (path && guard < 40) {
    guard++
    const data = await api(db, path)
    out.push(...asList(data))
    const next = data?.pagination?.next || data?.pagination?.nextCursor || data?.nextPage || data?.next || null
    if (!next) break
    if (/^https?:\/\//i.test(next)) {
      path = next.replace(BASE, '')
    } else if (String(next).startsWith('/')) {
      path = next
    } else {
      path = `/contact/${identifier}/message/list?limit=${pageSize}&cursor=${encodeURIComponent(next)}`
    }
  }
  return out
}

export async function listContactMessages(db, lead, pageSize = 100) {
  return listMessagesByIdentifier(db, leadIdentifier(db, lead), pageSize)
}

// Lists every contact in the workspace (POST /contact/list). The endpoint
// requires `search`/`filter`/`timezone` in the body even for an
// unfiltered listing — `filter: { $and: [] }` is the documented "match
// everything" shape. Paginates by following the response's own
// `pagination.next` URL (which carries respond.io's cursorId), same as the
// other v2 list endpoints, capped at 50 pages as a runaway backstop.
export async function listContacts(db, { pageSize = 100 } = {}) {
  const timezone = db?.settings?.org?.timezone || 'Asia/Kolkata'
  const out = []
  let path = `/contact/list?limit=${pageSize}`
  let guard = 0
  while (path && guard < 50) {
    guard++
    const data = await api(db, path, { method: 'POST', body: { search: '', filter: { $and: [] }, timezone } })
    const list = asList(data)
    out.push(...list)
    const next = data?.pagination?.next || null
    if (!next) break
    path = next.replace(BASE, '')
  }
  return out
}

export async function syncLeadConversations(db, lead) {
  if (!isConfigured(db)) return null
  let contact = null
  try {
    const found = await findContact(db, { lead })
    if (found?.id) contact = found
  } catch (e) { contact = null }
  if (!contact?.id && !lead.respondId) {
    return { contact: null, conversations: [], syncedAt: new Date().toISOString() }
  }
  if (contact?.id && contact.id !== lead.respondId) lead.respondId = contact.id

  let raw = []
  try {
    raw = await listContactMessages(db, lead, 100)
  } catch (e) { raw = [] }

  const messages = raw
    .map(m => ({
      id: m.messageId || m.id,
      direction: m.traffic === 'incoming' ? 'inbound' : 'outbound',
      type: m.message?.type || 'text',
      content: m.message?.text || m.message?.template?.name || '',
      sentAt: m.timestamp || m.sentAt || m.createdAt || m.status?.[0]?.timestamp || null,
      channel: m.channelId || null
    }))
    .sort((a, b) => String(a.sentAt || '').localeCompare(String(b.sentAt || '')))

  return {
    contact,
    conversations: [{ id: contact?.id || 'live', channel: 'chat', status: 'open', messages }],
    syncedAt: new Date().toISOString()
  }
}
