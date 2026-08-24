// Unified Inbox: persisted, webhook-fed store of every Respond.io message
// across every member, so the Inbox page shows a live multi-conversation
// view without re-pulling respond.io's API (rate-limited) on every load.
//
// Conversations are keyed by a `key` — a lead's id when the respond.io
// contact matches a CRM lead, or `contact:<respondio-contact-id>` when it
// doesn't (a respond.io contact with no matching lead still needs to show up
// — "all messages from all members from respond.io" isn't limited to
// contacts we happen to have linked). Unmatched rows carry their own
// `contactInfo` (name/phone/email) instead of a lead lookup, and are
// read-only in the UI since there's no lead to send/assign against.
//
// db.inbox shape:
//   messages: [{ id, key, direction, channel, type, content, templateName, sentAt }]
//   conversations: { [key]: { status, unreadCount, lastMessageAt, assigneeId, contactId, contactInfo? } }
// db.settings.inbox.snippets: [{ id, label, text }]

import { uid } from './db.js'

export function contactKey(contactId) {
  return `contact:${contactId}`
}

export function ensure(db) {
  if (!db.inbox) db.inbox = { messages: [], conversations: {} }
  if (!db.inbox.messages) db.inbox.messages = []
  if (!db.inbox.conversations) db.inbox.conversations = {}
  if (!db.settings.inbox) db.settings.inbox = { snippets: defaultSnippets() }
  if (!Array.isArray(db.settings.inbox.snippets)) db.settings.inbox.snippets = defaultSnippets()
  if (!db.inbox.sentAtMigrated) migrateSentAt(db)
  return db.inbox
}

// One-time fixup for conversations synced before sentAt was normalized to
// epoch ms — those have a mix of unix-second numbers and ISO strings on
// disk, which is exactly what caused inbound/outbound to cluster instead of
// interleaving. Mutates in place; the flag rides along in db.inbox so it
// persists on the next save() rather than re-running every request.
function migrateSentAt(db) {
  for (const m of db.inbox.messages) m.sentAt = normalizeSentAt(m.sentAt)
  const byKey = new Map()
  for (const m of db.inbox.messages) {
    const cur = byKey.get(m.key)
    if (cur === undefined || m.sentAt > cur) byKey.set(m.key, m.sentAt)
  }
  for (const [key, lastMessageAt] of byKey) {
    if (db.inbox.conversations[key]) db.inbox.conversations[key].lastMessageAt = lastMessageAt
  }
  db.inbox.sentAtMigrated = true
}

function defaultSnippets() {
  return [
    { id: uid('snip'), label: 'Trial follow-up', text: "Hi! Just checking in after your trial class — how did it feel? Happy to help you pick the right pack." },
    { id: uid('snip'), label: 'Pricing info', text: "Here are our current pricing options — let me know which studio and pack works best for you and I'll share the details." },
    { id: uid('snip'), label: 'Reschedule', text: "No problem — let's find a time that works better for you. What days/times suit you this week?" }
  ]
}

function conv(db, key) {
  ensure(db)
  if (!db.inbox.conversations[key]) {
    db.inbox.conversations[key] = { status: 'open', unreadCount: 0, lastMessageAt: null, assigneeId: null }
  }
  return db.inbox.conversations[key]
}

// Records that `key` (a lead id or contact:<id>) corresponds to a
// respond.io contact with no matching lead, so the list can render it
// without a lead lookup.
export function setContactInfo(db, key, { contactId, fullName, phone, email, respondioStatus, assigneeId } = {}) {
  const c = conv(db, key)
  c.contactId = contactId ?? c.contactId ?? null
  c.contactInfo = { fullName: fullName || 'Unknown contact', phone: phone || '', email: email || '' }
  // A respond.io-side assignment always wins over whatever's already
  // stored — it's the source of truth for who actually owns this contact.
  if (assigneeId) c.assigneeId = assigneeId
  if (respondioStatus === 'closed' || respondioStatus === 'open') c.status = respondioStatus
  return c
}

// respond.io message timestamps arrive as unix seconds (message/list has no
// top-level timestamp field per its docs — status[].timestamp is unix
// seconds), while our own outbound sends stamp `new Date().toISOString()`.
// Mixing epoch numbers and ISO strings and sorting by String comparison
// (the old behavior) put every inbound message in one cluster and every
// outbound in another instead of interleaving by time — this normalizes
// everything to epoch milliseconds so sorting is always a plain numeric
// comparison regardless of which shape a given source handed in.
export function normalizeSentAt(input) {
  if (input === null || input === undefined || input === '') return Date.now()
  if (typeof input === 'number') return input < 10_000_000_000 ? input * 1000 : input
  const asNumber = Number(input)
  if (!Number.isNaN(asNumber) && String(input).trim() === String(asNumber)) {
    return asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber
  }
  const parsed = Date.parse(input)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

// Appends a message to the store and updates the conversation's rollup
// fields. Inbound messages bump unreadCount; outbound ones don't.
export function recordMessage(db, key, { direction, channel, type = 'text', content = '', templateName = '', sentAt } = {}) {
  ensure(db)
  const when = normalizeSentAt(sentAt)
  const message = { id: uid('imsg'), key, direction, channel: channel || 'whatsapp', type, content, templateName, sentAt: when }
  db.inbox.messages.push(message)
  const c = conv(db, key)
  c.lastMessageAt = when
  c.status = 'open'
  if (direction === 'inbound') c.unreadCount = (c.unreadCount || 0) + 1
  return message
}

export function listMessages(db, key) {
  ensure(db)
  return db.inbox.messages.filter(m => m.key === key).sort((a, b) => a.sentAt - b.sentAt)
}

export function markRead(db, key) {
  const c = conv(db, key)
  c.unreadCount = 0
  return c
}

export function setStatus(db, key, status) {
  if (!['open', 'closed'].includes(status)) throw new Error('status must be open or closed')
  const c = conv(db, key)
  c.status = status
  return c
}

export function assign(db, key, associateId) {
  const c = conv(db, key)
  c.assigneeId = associateId || null
  return c
}

// Builds the inbox list: one row per key that has a conversation record,
// newest activity first, with optional filters. Rows with no matching lead
// (an unmatched respond.io contact) get a synthetic `lead`-shaped object
// built from the stored contactInfo, and are flagged `unmatched: true`.
export function listConversations(db, leads, { studio, associate, channel, status, unreadOnly, q } = {}) {
  ensure(db)
  const leadsById = new Map(leads.map(l => [l.id, l]))
  const rows = Object.entries(db.inbox.conversations)
    .map(([key, c]) => {
      const lead = leadsById.get(key)
      const unmatched = !lead
      if (unmatched && !c.contactInfo) return null
      const leadLike = lead
        ? { id: lead.id, fullName: lead.fullName, phone: lead.phone, email: lead.email, locationId: lead.locationId, associateId: lead.associateId }
        : { id: key, fullName: c.contactInfo.fullName, phone: c.contactInfo.phone, email: c.contactInfo.email, locationId: null, associateId: null }
      const msgs = db.inbox.messages.filter(m => m.key === key)
      const last = msgs[msgs.length - 1] || null
      return {
        leadId: key,
        unmatched,
        lead: leadLike,
        status: c.status || 'open',
        unreadCount: c.unreadCount || 0,
        assigneeId: c.assigneeId || lead?.associateId || null,
        lastMessage: last ? { content: last.content, direction: last.direction, channel: last.channel, sentAt: last.sentAt, templateName: last.templateName } : null,
        lastMessageAt: c.lastMessageAt || last?.sentAt || null
      }
    })
    .filter(Boolean)
    .filter(r => !studio || r.lead.locationId === studio)
    .filter(r => !associate || r.assigneeId === associate)
    .filter(r => !channel || r.lastMessage?.channel === channel)
    .filter(r => !status || r.status === status)
    .filter(r => !unreadOnly || r.unreadCount > 0)
    .filter(r => !q || `${r.lead.fullName} ${r.lead.phone} ${r.lead.email}`.toLowerCase().includes(String(q).toLowerCase()))
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
  return rows
}

// ---------- snippets ----------

export function listSnippets(db) {
  ensure(db)
  return db.settings.inbox.snippets
}

export function addSnippet(db, { label, text }) {
  ensure(db)
  const snippet = { id: uid('snip'), label: String(label || '').trim() || 'Snippet', text: String(text || '').trim() }
  db.settings.inbox.snippets.push(snippet)
  return snippet
}

export function updateSnippet(db, id, { label, text }) {
  ensure(db)
  const s = db.settings.inbox.snippets.find(x => x.id === id)
  if (!s) throw new Error('Snippet not found')
  if (label !== undefined) s.label = String(label).trim()
  if (text !== undefined) s.text = String(text).trim()
  return s
}

export function deleteSnippet(db, id) {
  ensure(db)
  db.settings.inbox.snippets = db.settings.inbox.snippets.filter(x => x.id !== id)
}

// Matches an inbound Respond.io webhook payload's contact to a known lead by
// respondId first, then phone/email. Returns the lead or null.
export function matchLeadFromWebhook(db, payload) {
  const contact = payload?.contact || payload?.data?.contact || {}
  const contactId = contact.id || contact.contactId || payload?.contactId
  if (contactId) {
    const byId = db.leads.find(l => String(l.respondId) === String(contactId))
    if (byId) return byId
  }
  const email = String(contact.email || '').trim().toLowerCase()
  if (email) {
    const byEmail = db.leads.find(l => String(l.email || '').trim().toLowerCase() === email)
    if (byEmail) return byEmail
  }
  const phoneDigits = String(contact.phone || '').replace(/\D/g, '')
  if (phoneDigits) {
    const byPhone = db.leads.find(l => String(l.phone || '').replace(/\D/g, '').endsWith(phoneDigits.slice(-10)))
    if (byPhone) return byPhone
  }
  return null
}

// Pulls display fields off a respond.io contact object for an unmatched row.
export function contactDisplayInfo(contact) {
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim()
  return {
    contactId: contact?.id || contact?.contactId || null,
    fullName: name || contact?.email || contact?.phone || 'Unknown contact',
    phone: contact?.phone || '',
    email: contact?.email || '',
    respondioStatus: contact?.status || null,
    assigneeEmail: contact?.assignee?.email || null
  }
}

// Maps a respond.io contact's assigned agent (by email) to a local
// associate id, so the inbox row shows the same person who actually owns
// the conversation on respond.io's side rather than whatever the CRM lead
// happens to be assigned to.
export function resolveAssigneeId(associates, assigneeEmail) {
  if (!assigneeEmail) return null
  const email = String(assigneeEmail).trim().toLowerCase()
  const match = (associates || []).find(a => String(a.email || '').trim().toLowerCase() === email)
  return match?.id || null
}

// Extracts the message fields we care about from a Respond.io "Message
// Received" webhook payload. Shape follows the same message envelope as the
// message/list endpoint (message.type / message.text, channelId, timestamp).
export function extractInboundMessage(payload) {
  const m = payload?.message || payload?.data?.message || {}
  return {
    channel: payload?.channel?.source || payload?.channelId || 'whatsapp',
    type: m.type || 'text',
    content: m.text || m.template?.name || '',
    templateName: m.template?.name || '',
    sentAt: payload?.timestamp || payload?.createdAt || new Date().toISOString()
  }
}
