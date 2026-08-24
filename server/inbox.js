// Unified Inbox: persisted, webhook-fed store of every Respond.io message
// across every lead, so the Inbox page shows a live multi-conversation view
// without re-pulling respond.io's API (rate-limited) on every load.
//
// db.inbox shape:
//   messages: [{ id, leadId, direction, channel, type, content, templateName, sentAt }]
//   conversations: { [leadId]: { status, unreadCount, lastMessageAt, assigneeId } }
// db.settings.inbox.snippets: [{ id, label, text }]

import { uid } from './db.js'

export function ensure(db) {
  if (!db.inbox) db.inbox = { messages: [], conversations: {} }
  if (!db.inbox.messages) db.inbox.messages = []
  if (!db.inbox.conversations) db.inbox.conversations = {}
  if (!db.settings.inbox) db.settings.inbox = { snippets: defaultSnippets() }
  if (!Array.isArray(db.settings.inbox.snippets)) db.settings.inbox.snippets = defaultSnippets()
  return db.inbox
}

function defaultSnippets() {
  return [
    { id: uid('snip'), label: 'Trial follow-up', text: "Hi! Just checking in after your trial class — how did it feel? Happy to help you pick the right pack." },
    { id: uid('snip'), label: 'Pricing info', text: "Here are our current pricing options — let me know which studio and pack works best for you and I'll share the details." },
    { id: uid('snip'), label: 'Reschedule', text: "No problem — let's find a time that works better for you. What days/times suit you this week?" }
  ]
}

function conv(db, leadId) {
  ensure(db)
  if (!db.inbox.conversations[leadId]) {
    db.inbox.conversations[leadId] = { status: 'open', unreadCount: 0, lastMessageAt: null, assigneeId: null }
  }
  return db.inbox.conversations[leadId]
}

// Appends a message to the store and updates the conversation's rollup
// fields. Inbound messages bump unreadCount; outbound ones don't.
export function recordMessage(db, leadId, { direction, channel, type = 'text', content = '', templateName = '', sentAt } = {}) {
  ensure(db)
  const when = sentAt || new Date().toISOString()
  const message = { id: uid('imsg'), leadId, direction, channel: channel || 'whatsapp', type, content, templateName, sentAt: when }
  db.inbox.messages.push(message)
  const c = conv(db, leadId)
  c.lastMessageAt = when
  c.status = 'open'
  if (direction === 'inbound') c.unreadCount = (c.unreadCount || 0) + 1
  return message
}

export function listMessages(db, leadId) {
  ensure(db)
  return db.inbox.messages.filter(m => m.leadId === leadId).sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)))
}

export function markRead(db, leadId) {
  const c = conv(db, leadId)
  c.unreadCount = 0
  return c
}

export function setStatus(db, leadId, status) {
  if (!['open', 'closed'].includes(status)) throw new Error('status must be open or closed')
  const c = conv(db, leadId)
  c.status = status
  return c
}

export function assign(db, leadId, associateId) {
  const c = conv(db, leadId)
  c.assigneeId = associateId || null
  return c
}

// Builds the inbox list: one row per lead that has at least one message or
// conversation record, newest activity first, with optional filters.
export function listConversations(db, leads, { studio, associate, channel, status, unreadOnly, q } = {}) {
  ensure(db)
  const leadsById = new Map(leads.map(l => [l.id, l]))
  const rows = Object.entries(db.inbox.conversations)
    .map(([leadId, c]) => {
      const lead = leadsById.get(leadId)
      if (!lead) return null
      const msgs = db.inbox.messages.filter(m => m.leadId === leadId)
      const last = msgs[msgs.length - 1] || null
      return {
        leadId,
        lead: { id: lead.id, fullName: lead.fullName, phone: lead.phone, email: lead.email, locationId: lead.locationId, associateId: lead.associateId },
        status: c.status || 'open',
        unreadCount: c.unreadCount || 0,
        assigneeId: c.assigneeId || lead.associateId || null,
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
    .sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')))
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
