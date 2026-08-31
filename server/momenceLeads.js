// Write-back to the Momence leads portal.
//
// The app is not the only place these leads live: every one of them also exists
// in Momence, which is where the studio staff work day to day. An edit made
// here that never reaches there leaves two systems disagreeing about the same
// person, so every app-side change to a lead is pushed straight back.
//
// Three things make this awkward, and each shapes the code below:
//
//   1. The PUT replaces the lead's whole custom-field set. Sending only the
//      fields that changed would blank every field left out. So each push reads
//      the lead's current state first and merges onto it.
//   2. The field vocabulary differs per host. Mumbai has `fu1D`/`childName`/
//      `dob`; Bengaluru has `pregnant`/`campaign`/`landingPage`. Neither list is
//      hardcoded — the codes are read off the lead itself (`activeFields`), so a
//      field added in Momence needs no change here.
//   3. Stage, owner and source are ids, not text, and the ids differ per host.
//      They are resolved by name against the host's own lists, cached.
import { effectiveConfig } from './momence.js'

const HOSTS = { mumbai: '13752', blr: '33905' }
const REFERENCE_TTL_MS = 30 * 60 * 1000

const normalize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')

// ---------------------------------------------------------------------------
// which host a lead belongs to
// ---------------------------------------------------------------------------

// The sheet carries a Host ID column, so most leads say outright which Momence
// account they live in. Studio is the fallback for the ones that don't.
const BLR_LOCATION_HINTS = ['kenkere', 'indiranagar', 'bengaluru', 'bangalore', 'copper', 'plash']

export function marketFor(db, lead) {
  const hostId = String(lead?.hostId || '').trim()
  if (hostId === HOSTS.blr) return 'blr'
  if (hostId === HOSTS.mumbai) return 'mumbai'
  const studio = normalize(
    (db.locations || []).find(l => l.id === lead?.locationId)?.name || lead?.center || ''
  )
  return BLR_LOCATION_HINTS.some(hint => studio.includes(hint)) ? 'blr' : 'mumbai'
}

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

function cookieFor(market) {
  return String(market === 'blr'
    ? (process.env.MOMENCE_ALL_COOKIES_BLR || process.env.MOMENCE_BLR_COOKIES || '')
    : (process.env.MOMENCE_ALL_COOKIES || process.env.MOMENCE_MUMBAI_COOKIES || '')).trim()
}

export function isConfigured(db, market) {
  // A fake transport means a test is driving this, and a test has no business
  // needing a real dashboard session.
  if (!liveTransport) return true
  return Boolean(cookieFor(market) && hostFor(db, market))
}

function hostFor(db, market) {
  return String(effectiveConfig(db, market).hostId || HOSTS[market] || '').trim()
}

// All portal traffic goes through here so tests can swap it out wholesale.
let transport = async function dashboardRequest(db, market, path, { method = 'GET', body } = {}) {
  const cookie = cookieFor(market)
  if (!cookie) throw new Error(`No Momence dashboard session for ${market === 'blr' ? 'Bengaluru' : 'Mumbai'}`)
  const host = hostFor(db, market)
  const origin = `https://momence.com/dashboard/${host}/leads`
  const response = await fetch(`https://momence.com/_api/primary/host/${host}${path}`, {
    method,
    headers: {
      Accept: 'application/json, text/plain, */*',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Cookie: cookie,
      Origin: 'https://momence.com',
      Referer: origin,
      'x-origin': origin
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { message: text.slice(0, 200) } }
  if (!response.ok) throw new Error(`Momence ${response.status}: ${data.error || data.message || 'request failed'}`)
  return data
}

let liveTransport = true
export function __setTransport(fake) { transport = fake; liveTransport = false }

// ---------------------------------------------------------------------------
// per-host reference data
// ---------------------------------------------------------------------------

// Stage names, staff and lead sources, by host. Cached because a push happens on
// every lead edit and these lists change perhaps monthly.
const reference = new Map() // market -> { at, stages, users, sources }

const listOf = (data) => Array.isArray(data) ? data : (data?.payload || data?.leads || data?.users || data?.items || [])

export async function getReference(db, market, { force = false } = {}) {
  const cached = reference.get(market)
  if (!force && cached && Date.now() - cached.at < REFERENCE_TTL_MS) return cached

  const [stages, users, sources] = await Promise.all([
    transport(db, market, '/customer-leads/stages?page=0&pageSize=999&query='),
    transport(db, market, '/users/list'),
    transport(db, market, '/customer-leads/sources?page=0&pageSize=200&sourceType[]=public-marked&sourceType[]=dashboard&sourceType[]=facebook&query=')
  ])
  const entry = {
    at: Date.now(),
    stages: listOf(stages).map(s => ({ id: s.id, name: s.name })),
    users: listOf(users).map(u => ({ id: u.id ?? u.userId, name: [u.firstName, u.lastName].filter(Boolean).join(' '), email: u.email })),
    sources: listOf(sources).map(s => ({ id: s.id, name: s.name }))
  }
  reference.set(market, entry)
  return entry
}

export function __clearReference() { reference.clear() }

// A stage the host does not have is left alone rather than guessed at: moving a
// lead to the wrong stage is worse than leaving it where Momence had it.
function stageIdFor(ref, stage) {
  const want = normalize(stage)
  if (!want) return null
  return ref.stages.find(s => normalize(s.name) === want)?.id ?? null
}

// Staff are matched on email first — two people can share a name, nobody shares
// a work address. Each host has only its own city's staff, so a Bengaluru
// associate simply will not resolve against the Mumbai host, which is correct.
function userIdFor(ref, associate) {
  if (!associate) return null
  const email = normalize(associate.email)
  if (email) {
    const byEmail = ref.users.find(u => normalize(u.email) === email)
    if (byEmail) return byEmail.id
  }
  const name = normalize(associate.name)
  return name ? (ref.users.find(u => normalize(u.name) === name)?.id ?? null) : null
}

function sourceIdFor(ref, sourceName, current) {
  const want = normalize(sourceName)
  if (!want) return current
  return ref.sources.find(s => normalize(s.name) === want)?.id ?? current
}

// ---------------------------------------------------------------------------
// what the app owns in a Momence lead
// ---------------------------------------------------------------------------

// Momence field code -> how to read the app's value for it. Only these are
// overwritten; every other field on the lead is carried through the PUT
// untouched, exactly as Momence last had it.
//
// The follow-up pairs are positional: our followUps array in order fills
// fu1D/fu1C, fu2D/fu2C, and so on, which is the same convention the sheet uses.
// Both hosts spell the third pair in capitals (FU3D/FU3C) — that is Momence's
// own inconsistency, and the codes are read off the lead, so it costs nothing.
const WRITERS = {
  firstName: (lead) => splitName(lead.fullName).first,
  lastName: (lead) => splitName(lead.fullName).last,
  email: (lead) => (lead.email && lead.email !== '-' ? lead.email : ''),
  phoneNumber: (lead) => formatPhone(lead.phone),
  remarks: (lead) => lead.remarks || '',
  center: (lead, db) => (db.locations || []).find(l => l.id === lead.locationId)?.name || lead.center || '',
  associate: (lead, db) => (db.associates || []).find(a => a.id === lead.associateId)?.name || '',
  type: (lead) => lead.classType || '',
  channel: (lead) => lead.channel || '',
  date: (lead) => (lead.createdAt ? String(lead.createdAt).slice(0, 10) : '')
}

for (let i = 1; i <= 4; i++) {
  // FU3 is the odd one out in both hosts' field lists.
  const dateCode = i === 3 ? 'FU3D' : `fu${i}D`
  const commentCode = i === 3 ? 'FU3C' : `fu${i}C`
  WRITERS[dateCode] = (lead) => followUpAt(lead, i - 1)?.date || ''
  WRITERS[commentCode] = (lead) => followUpAt(lead, i - 1)?.comments || ''
}

function followUpAt(lead, index) {
  const list = Array.isArray(lead.followUps) ? lead.followUps : []
  return list[index] || null
}

// Momence keeps first and last name separately; we keep one full name. The
// last whitespace-separated token is the surname, everything before it the
// given name — the same split the portal itself shows for imported leads.
export function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

// Momence stores phone numbers in E.164. Ours arrive as "919773600001",
// "+91 97736 00001" or "9773600001" depending on where they came from.
export function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return `+91${digits}`
  return `+${digits}`
}

// The PUT body: every field Momence currently holds, with ours written over the
// top. Reading the codes off `activeFields` rather than a hardcoded list is what
// keeps one function correct for both hosts.
export function buildPayload(current, lead, db) {
  const body = {}
  for (const field of current.activeFields || []) {
    const code = field?.customerLeadsField?.code
    if (!code) continue
    body[code] = field.data?.string ?? field.serialized ?? ''
  }
  // These four are columns on the lead itself, not custom fields, and the PUT
  // wants them whether or not they appear in activeFields.
  body.firstName = current.firstName || ''
  body.lastName = current.lastName || ''
  body.email = current.email || ''
  body.phoneNumber = current.phoneNumber || ''

  for (const [code, read] of Object.entries(WRITERS)) {
    const value = read(lead, db)
    // An empty value never clears what Momence holds. The app is authoritative
    // about what it knows, not about what it happens to be missing — and a lead
    // with no remarks here must not wipe a remark a staff member typed there.
    if (value === '' || value === null || value === undefined) continue
    body[code] = String(value)
  }
  return body
}

// ---------------------------------------------------------------------------
// the push
// ---------------------------------------------------------------------------

// Pushes one lead to the portal. Returns what it did, for the log.
//
// Deliberately does everything it can rather than stopping at the first
// problem: an unmappable stage should not cost the lead its remarks update.
export async function pushLead(db, lead, { log = () => {} } = {}) {
  const momenceId = String(lead?.momenceLeadId || '').trim()
  if (!momenceId) return { outcome: 'skipped', reason: 'no Momence lead id' }

  const market = marketFor(db, lead)
  if (!isConfigured(db, market)) return { outcome: 'skipped', reason: `no ${market} session` }

  const current = await transport(db, market, `/customer-leads/${momenceId}`)
  const ref = await getReference(db, market)

  const body = buildPayload(current, lead, db)
  body.sourceId = sourceIdFor(ref, lead.sourceName, current.sourceId)

  const changed = Object.keys(body).filter(code => {
    const before = (current.activeFields || []).find(f => f?.customerLeadsField?.code === code)
    const previous = before ? (before.data?.string ?? '') : (current[code] ?? '')
    return String(previous ?? '') !== String(body[code] ?? '')
  })

  // Nothing to say. Worth checking rather than always writing: a push happens on
  // every edit, and most edits touch a field Momence does not carry.
  if (!changed.length) return { outcome: 'unchanged', market, momenceId }

  await transport(db, market, `/customer-leads/${momenceId}`, { method: 'PUT', body })

  const extras = await pushStageAndOwner(db, market, ref, lead, current, log)
  return { outcome: 'pushed', market, momenceId, fields: changed, ...extras }
}

// Stage and owner are not custom fields — Momence keeps them as `stageId` and
// `customerLeadHandler`, each behind its own PATCH:
//
//   PATCH /customer-leads/{id}/stages   {"stageId": 1810}
//   PATCH /customer-leads/{id}/handler  {"userId": 12006523}
//
// Note the plural on `stages` and the singular on `handler`; that asymmetry is
// Momence's, not a typo here.
//
// Both are attempted after the field write and neither is allowed to fail the
// push: a portal with the right remarks and a stale stage still beats one with
// neither.
async function pushStageAndOwner(db, market, ref, lead, current, log) {
  const result = {}

  const stageId = stageIdFor(ref, lead.stage)
  if (!stageId && lead.stage) log('warn', `Momence has no stage called "${lead.stage}" — left as it was`)
  if (stageId && stageId !== current.stageId) {
    try {
      await transport(db, market, `/customer-leads/${current.id}/stages`, { method: 'PATCH', body: { stageId } })
      result.stage = lead.stage
    } catch (err) {
      log('warn', `stage not updated for Momence lead ${current.id}: ${err.message}`)
    }
  }

  const associate = (db.associates || []).find(a => a.id === lead.associateId)
  const userId = userIdFor(ref, associate)
  if (associate && !userId) log('warn', `${associate.name} is not a user on the ${market} Momence host — owner left as it was`)
  if (userId && userId !== current.customerLeadHandler?.userId) {
    try {
      await transport(db, market, `/customer-leads/${current.id}/handler`, { method: 'PATCH', body: { userId } })
      result.owner = associate.name
    } catch (err) {
      log('warn', `owner not updated for Momence lead ${current.id}: ${err.message}`)
    }
  }

  return result
}
