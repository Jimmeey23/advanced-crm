// Respond.io integration (API v2).
// Lets users send WhatsApp / SMS / email messages to a lead directly from the
// app and read the full conversation history. API key can come from the
// RESPONDIO_API_KEY env var or Settings > Integrations.
//
// Endpoints (match @respond-io/typescript-sdk v1.4.0):
//   GET  /v2/contact/{identifier}                      -> get contact (404 = not found)
//   POST /v2/contact/create_or_update/{identifier}     -> create/update contact
//   POST /v2/contact/list                              -> list contacts (body: { search, filter })
//   POST /v2/contact/{identifier}/message              -> send a message
//   GET  /v2/contact/{identifier}/message/list         -> conversation history (?limit=)
//   POST /v2/contact/{identifier}/conversation/status  -> open/close conversation
//   GET  /v2/space/user                                -> workspace users
//   GET  /v2/space/channel                             -> workspace channels
// where identifier is one of id:<id>, email:<addr>, phone:+<digits>.
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

async function api(db, path, { method = 'GET', body } = {}) {
  if (!isConfigured(db)) throw new Error('Respond.io is not configured. Add your API key in Settings > Integrations.')
  const headers = { Authorization: `Bearer ${apiKey(db)}`, Accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'

  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Respond.io ${res.status} ${path}: ${text.slice(0, 300)}`)
  }
  return res.json()
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
    const c = await api(db, '/space/channel')
    channels = asList({ data: c })
  } catch (e) { /* optional */ }
  return { ok: true, data: user, channels }
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
  const identifier = leadIdentifier(db, lead)
  if (!identifier) throw new Error('Lead has no email or phone to use as a Respond.io identifier.')
  const { firstName, lastName } = splitName(lead.fullName || lead.name)
  const payload = { firstName, lastName }
  const mail = String(lead.email || '').trim().toLowerCase()
  const ph = normalizedPhone(db, lead.phone)
  if (mail && mail !== '-' && mail.includes('@')) payload.email = mail
  if (ph) payload.phone = `+${ph}`
  const data = await api(db, `/contact/create_or_update/${identifier}`, {
    method: 'POST',
    body: payload
  })
  const contact = pickContact(data)
  if (!contact) throw new Error(`Respond.io did not return a usable contact for identifier "${identifier}". Response: ${JSON.stringify(data).slice(0, 300)}`)
  return contact
}

// Open / close the lead's conversation (sending also opens it implicitly).
export async function setConversationStatus(db, lead, status) {
  const identifier = leadIdentifier(db, lead)
  if (!identifier) return null
  const data = await api(db, `/contact/${identifier}/conversation/status`, {
    method: 'POST',
    body: { status }
  })
  return pickContact(data)
}

// Send a text message to the lead's contact.
export async function sendMessage(db, lead, text, channel) {
  const identifier = leadIdentifier(db, lead)
  if (!identifier) throw new Error('Lead has no email or phone to use as a Respond.io identifier.')
  const data = await api(db, `/contact/${identifier}/message`, {
    method: 'POST',
    body: { message: { type: 'text', text } }
  })
  return pickContact(data) || data
}

export async function sendTemplateMessage(db, lead, template) {
  const identifier = leadIdentifier(db, lead)
  if (!identifier) throw new Error('Lead has no email or phone to use as a Respond.io identifier.')
  if (!template?.name) throw new Error('A WhatsApp template name is required.')

  const parameters = Array.isArray(template.parameters) ? template.parameters : []
  const body = {
    message: {
      type: 'template',
      template: {
        name: String(template.name).trim(),
        language: String(template.language || 'en').trim(),
        parameters: parameters.map((p, index) => ({
          type: 'text',
          text: String(p ?? '').trim(),
          index: index + 1
        }))
      }
    }
  }
  if (template.category) body.message.template.category = String(template.category).trim()
  if (template.channel) body.message.channel = template.channel
  if (template.namespace) body.message.template.namespace = String(template.namespace).trim()

  const data = await api(db, `/contact/${identifier}/message`, {
    method: 'POST',
    body
  })
  return pickContact(data) || data
}

export async function listContactMessages(db, lead, limit = 100) {
  const identifier = leadIdentifier(db, lead)
  if (!identifier) return []
  const data = await api(db, `/contact/${identifier}/message/list?limit=${limit}`)
  return asList(data)
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
      id: m.id,
      direction: m.direction || (m.sender?.type === 'contact' ? 'inbound' : 'outbound'),
      type: m.type || 'text',
      content: m.content || m.text || '',
      sentAt: m.sentAt || m.createdAt || m.timestamp || null,
      channel: m.channel || m.channelId || null
    }))
    .sort((a, b) => String(a.sentAt || '').localeCompare(String(b.sentAt || '')))

  return {
    contact,
    conversations: [{ id: contact?.id || 'live', channel: 'chat', status: 'open', messages }],
    syncedAt: new Date().toISOString()
  }
}
