// Shared field-resolution logic for any external lead source that hands us
// a flat {key: value} record — inbound webhooks and Google Sheets rows both
// go through this. Keeping it in one module means both features get the
// same alias dictionary and manual-mapping/defaults precedence for free.
import { parseFlexibleDate } from './csv.js'
import { canonicalSheetDate } from './sheetDates.js'
import { normalizeFollowUpFields } from './followUps.js'

// Every Lead field an external source is allowed to populate, and the
// common third-party key spellings that map to it automatically. This
// alias dictionary is a standing fallback under any explicit mapping — it
// fires whenever the incoming record has a recognizable key that isn't
// already claimed by the integration's own fieldMapping, so a brand-new
// integration produces sane leads immediately, before anyone visits the
// mapping editor.
export const LEAD_FIELD_ALIASES = {
  fullName: ['name', 'fullname', 'full_name', 'customer_name', 'contact_name', 'lead_name'],
  firstName: ['first_name', 'firstname', 'fname', 'given_name'],
  lastName: ['last_name', 'lastname', 'lname', 'surname', 'family_name'],
  email: ['email', 'email_address', 'emailaddress'],
  phone: ['phone', 'phone_number', 'phonenumber', 'mobile', 'contact_number', 'whatsapp'],
  createdAt: ['created_at', 'createdat', 'created', 'date_created', 'signup_date', 'created_date'],
  convertedAt: ['converted_at', 'convertedat', 'converted_to_customer_at', 'conversion_date', 'closed_date', 'won_date'],
  sourceId: ['source_id', 'sourceid'],
  source: ['source', 'lead_source', 'utm_source', 'source_name', 'sourcename'],
  notes: ['notes', 'note', 'message', 'comments', 'remarks'],
  classType: ['class_type', 'classtype', 'service', 'interest', 'program'],
  channel: ['channel', 'medium', 'utm_medium'],
  stage: ['stage', 'stage_name', 'stagename', 'pipeline_stage'],
  status: ['status', 'lead_status'],
  valueEstimate: ['value', 'value_estimate', 'amount', 'price', 'deal_value', 'ltv', 'lifetime_value', 'clv'],
  associateId: ['associate_id', 'associateid', 'owner_id', 'assigned_to'],
  associateName: ['associate', 'associate_name', 'associatename', 'owner', 'owner_name', 'assigned_to_name', 'sales_rep'],
  locationId: ['location_id', 'locationid', 'studio_id', 'center_id'],
  center: ['center', 'centre', 'studio', 'location'],
  memberId: ['member_id', 'memberid'],
  hostId: ['host_id', 'hostid'],
  period: ['period', 'time_period'],
  purchasesMade: ['purchases_made', 'purchasesmade', 'purchases'],
  visits: ['visits', 'visit_count'],
  trialStatus: ['trial_status', 'trialstatus'],
  conversionStatus: ['conversion_status', 'conversionstatus'],
  retentionStatus: ['retention_status', 'retentionstatus']
}

// Real-world headers/keys vary in punctuation, not just case — "Full Name"
// vs "full_name" vs "fullName" — so both sides of every alias comparison are
// reduced to bare lowercase alphanumerics before comparing. Precomputed once
// since the alias dictionary never changes at runtime.
const normalizeKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(LEAD_FIELD_ALIASES).map(([field, aliases]) => [field, aliases.map(normalizeKey)])
)

// Given a sheet's (or any source's) raw header/key list, guesses which Lead
// field each one maps to by matching against the same alias dictionary the
// live resolver uses — so "auto-detect" and "what actually happens at
// receive time" can never drift apart. Only exact (post-normalization)
// alias matches count — no fuzzy scoring — to keep suggestions predictable.
export function suggestMappingFromKeys(keys) {
  const suggestions = {}
  for (const key of keys) {
    const norm = normalizeKey(key)
    if (!norm) continue
    for (const [field, aliases] of Object.entries(NORMALIZED_ALIASES)) {
      if (aliases.includes(norm)) { suggestions[key] = field; break }
    }
  }
  return suggestions
}

// A non-empty value isn't the same as a usable one — "N/A", a stray note, or
// a malformed address/number should never create a lead nobody can actually
// contact. Used at import time (webhooks, Google Sheets) to reject rows with
// neither, rather than silently creating unreachable leads.
export function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim())
}
export function isValidPhone(v) {
  const digits = String(v || '').replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

// "-", "N/A", "null" and friends are how a spreadsheet spells "nothing here".
// Treating them as real values is what put 2,669 leads on the source "-": the
// sheet maps two columns onto `source`, the first held "-", and a non-empty
// string stopped the resolver from ever looking at the second.
const PLACEHOLDER = /^(-+|n\/?a|na|null|none|nil|undefined|unknown|tbd|not\s*set|#n\/a|#value!|#ref!)$/i

export function isBlankish(value) {
  if (value === undefined || value === null) return true
  const s = String(value).trim()
  return s === '' || PLACEHOLDER.test(s)
}

// Every key in the record that maps onto `field` by alias, in record order —
// not just the first. A sheet with both "UTM Source" and "Source Name" gets to
// fall through from the empty one to the filled one.
function findByAlias(record, field) {
  const aliases = NORMALIZED_ALIASES[field]
  const hits = []
  for (const key of Object.keys(record)) {
    if (aliases.includes(normalizeKey(key))) hits.push(record[key])
  }
  return hits
}

// Resolves every eligible Lead field from an incoming flat record, in
// priority order: (1) the integration's own explicit fieldMapping, (2) the
// built-in alias dictionary above, (3) the integration's configured static
// defaults. Returns only the fields that resolved to a non-empty value.
// `integ` just needs `.fieldMapping` and `.defaults` objects — a webhook
// integration and a Google Sheets config both satisfy that shape.
export function resolveLeadFields(record, integ) {
  const mapping = integ.fieldMapping || {}
  const defaults = integ.defaults || {}
  // All the keys mapped onto a field, in mapping order — a field mapped from
  // two columns takes the first of them that actually carries a value.
  const reverseMapping = {}
  for (const [incomingKey, targetField] of Object.entries(mapping)) {
    (reverseMapping[targetField] ||= []).push(incomingKey)
  }
  const out = {}
  for (const field of Object.keys(LEAD_FIELD_ALIASES)) {
    const candidates = [
      ...(reverseMapping[field] || []).map(key => record[key]),
      ...findByAlias(record, field),
      defaults[field]
    ]
    const val = candidates.find(v => !isBlankish(v))
    if (val !== undefined) out[field] = val
  }
  // firstName/lastName aren't real Lead fields — they only exist to build
  // fullName when a source sends split name fields instead of one combined one.
  if (!out.fullName && (out.firstName || out.lastName)) {
    out.fullName = [out.firstName, out.lastName].filter(Boolean).join(' ').trim()
  }
  return out
}

// The inverse of resolveLeadFields: for a sheet's header row, which Lead field
// does each column carry? Needed because the sync now writes back — an app-side
// stage change has to land in whichever column the stage came out of.
//
// Precedence mirrors resolveLeadFields exactly (explicit mapping, then the
// alias dictionary) so a column never reads as one field and writes as
// another. Defaults are deliberately absent: a static default has no column,
// so there is nowhere to write it.
//
// Returns { fields, columnByField } where `fields` is every Lead field the
// sheet has a column for, and columnByField maps field -> column index. A
// field appearing in two columns keeps the leftmost, matching the read side's
// first-match-wins behaviour.
export function resolveHeaderFields(header, integ = {}) {
  const mapping = integ.fieldMapping || {}
  // field -> every column that carries it, leftmost first. A sheet really does
  // map two columns onto one field ("UTM Source" and "Source Name"), and
  // keeping only the leftmost meant reading whichever of them happened to come
  // first even when it held nothing but "-".
  const columnsByField = {}
  const claimed = new Set()
  const add = (field, index) => { (columnsByField[field] ||= []).push(index) }

  header.forEach((raw, index) => {
    const name = String(raw || '').trim()
    if (!name) return
    const mapped = mapping[name]
    if (mapped && LEAD_FIELD_ALIASES[mapped]) {
      add(mapped, index)
      claimed.add(index)
    }
  })

  header.forEach((raw, index) => {
    if (claimed.has(index)) return
    const name = normalizeKey(raw)
    if (!name) return
    for (const [field, aliases] of Object.entries(NORMALIZED_ALIASES)) {
      if (aliases.includes(name)) { add(field, index); break }
    }
  })

  // firstName/lastName are inputs to fullName, not fields of their own, so
  // they are never written back to.
  delete columnsByField.firstName
  delete columnsByField.lastName

  // The primary column — where a write-back goes, and what a single-column
  // field resolves to. Reads consider every candidate (see sheetValues).
  const columnByField = {}
  for (const [field, indexes] of Object.entries(columnsByField)) columnByField[field] = indexes[0]

  return { fields: Object.keys(columnByField), columnByField, columnsByField }
}

// "Follow Up 1 Date" / "Follow Up Comments (1)" / "Follow Up 2 Date" / ... —
// a repeating pair of columns per historical follow-up, not a single flat
// field, so it can't go through the alias dictionary above (that's one
// column -> one field). Pulled straight off the raw record by column-name
// pattern instead, grouped by their shared index, in index order.
const FOLLOWUP_DATE_PATTERNS = [
  /^followup(\d+)date$/,        // "Follow Up 1 Date"
  /^(\d+)followupdate$/,        // "1 Follow Up Date"
  /^fu(\d+)date$/,               // "FU1 Date"
  /^followupdate(\d+)$/          // "Follow Up Date 1"
]
const FOLLOWUP_COMMENT_PATTERNS = [
  /^followupcomments?(\d+)$/,    // "Follow Up Comments (1)"
  /^(\d+)followupcomments?$/,    // "1 Follow Up Comments"
  /^fu(\d+)comments?$/,          // "FU1 Comments"
  /^followupcomments?note(s?)(\d+)$/, // fallback, rarely hit
  /^followupnotes?(\d+)$/        // "Follow Up Notes (1)"
]

function matchFirst(patterns, norm) {
  for (const re of patterns) {
    const m = norm.match(re)
    if (m) return m[m.length - 1]
  }
  return null
}

export function extractFollowUps(record) {
  const byIndex = {}
  for (const [key, value] of Object.entries(record || {})) {
    const norm = normalizeKey(key)
    const dateIdx = matchFirst(FOLLOWUP_DATE_PATTERNS, norm)
    if (dateIdx) { (byIndex[dateIdx] ||= {}).date = value; continue }
    const commentIdx = matchFirst(FOLLOWUP_COMMENT_PATTERNS, norm)
    if (commentIdx) { (byIndex[commentIdx] ||= {}).comments = value; continue }
  }
  return Object.keys(byIndex)
    .sort((a, b) => Number(a) - Number(b))
    .map(i => byIndex[i])
    .map(f => normalizeFollowUpFields(f.date, f.comments))
    .filter(f => f.date || f.comments)
    .map((f, i) => {
      // A date in the past means this follow-up already happened; a future
      // date means it's still pending — hardcoding "done" regardless of the
      // date was the bug (every imported follow-up showed as done even when
      // scheduled ahead). No date at all means it's a plain historical note,
      // which is done by definition (nothing left to do on it).
      // canonicalSheetDate, not parseFlexibleDate: a follow-up date column in
      // a Google Sheet now arrives as a serial number, and a year-less cell
      // must be rejected rather than guessed at.
      const normalizedDate = f.date ? (canonicalSheetDate(f.date) || null) : null
      const todayKey = new Date().toISOString().slice(0, 10)
      return {
        id: `fu_import_${Date.now().toString(36)}_${i}`,
        date: normalizedDate || f.date,
        comments: f.comments,
        channel: null,
        done: Boolean(f.comments) && (normalizedDate ? normalizedDate <= todayKey : true)
      }
    })
}

// Resolves whatever the sheet's Associate/Owner column holds to a real
// associate. Sheets carry a person's name, an email, or a name typed with
// different spacing or punctuation from the roster's — and when this fails the
// lead ends up with no owner at all, which is exactly the case the sheet was
// meant to decide. Matched, in order: exact name (case/space-insensitive),
// email, then the name reduced to bare alphanumerics.
export function matchAssociate(db, value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const associates = db.associates || []
  const byName = associates.find(a => String(a.name || '').trim().toLowerCase() === lower)
  if (byName) return byName
  const byEmail = associates.find(a => String(a.email || '').trim().toLowerCase() === lower)
  if (byEmail) return byEmail
  const bare = normalizeKey(raw)
  if (!bare) return null
  return associates.find(a => normalizeKey(a.name) === bare) || null
}

// The studio the sheet names, as a real location. The sheet carries a Center
// column holding a studio NAME ("Kenkere House, Bengaluru"); the app files
// leads by locationId. Nothing joined the two, so `center` was stored as loose
// text and locationId fell back to the first studio in the list or to whichever
// studio the assigned associate happens to work at — which is how ~11,000 leads
// ended up filed under Kwality House while their own Center column said
// Bengaluru or Bandra.
export function matchLocation(db, value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const locations = db.locations || []
  const lower = raw.toLowerCase()
  const exact = locations.find(l => String(l.name || '').trim().toLowerCase() === lower)
  if (exact) return exact
  const bare = normalizeKey(raw)
  if (!bare) return null
  const loose = locations.find(l => normalizeKey(l.name) === bare)
  if (loose) return loose
  // "Kenkere House" against "Kenkere House, Bengaluru": the sheet sometimes
  // carries the studio without its city. Only accepted when exactly one studio
  // starts with what the cell says, so an ambiguous prefix matches nothing.
  const prefixed = locations.filter(l => normalizeKey(l.name).startsWith(bare) && bare.length >= 5)
  return prefixed.length === 1 ? prefixed[0] : null
}

// Turns a resolveLeadFields() result into the payload shape
// createLeadFrom() expects, dropping associateId/locationId if they don't
// match a real record rather than silently creating a lead pointed at a
// non-existent associate or studio. `db` needs `.associates`/`.locations`;
// `fallbackSourceName` is used when the record didn't resolve a `source`;
// `record` (optional, the raw pre-alias record) is scanned for the
// "Follow Up N ..." column pairs described above.
export function buildLeadPayloadFromResolved(resolved, db, fallbackSourceName, record) {
  // Sheets almost never carry the associate's internal id — they carry the
  // associate's name (owner/sales_rep column). Without resolving that name
  // to a real associateId, the sheet's chosen owner was silently dropped
  // and the lead fell through to round-robin instead of staying with
  // whoever the sheet says owns it.
  const associateId = resolved.associateId && db.associates.some(a => a.id === resolved.associateId)
    ? resolved.associateId
    : matchAssociate(db, resolved.associateName)?.id
  const locationId = resolved.locationId && db.locations.some(l => l.id === resolved.locationId)
    ? resolved.locationId
    : (matchLocation(db, resolved.center)?.id || undefined)
  return {
    fullName: resolved.fullName ? String(resolved.fullName).trim() : '',
    email: resolved.email ? String(resolved.email).trim() : '-',
    phone: resolved.phone ? String(resolved.phone).trim() : '',
    createdAt: resolved.createdAt ? String(resolved.createdAt).trim() : undefined,
    convertedAt: resolved.convertedAt ? String(resolved.convertedAt).trim() : undefined,
    sourceId: resolved.sourceId ? String(resolved.sourceId).trim() : undefined,
    sourceName: resolved.source ? String(resolved.source).trim() : fallbackSourceName,
    remarks: resolved.notes ? String(resolved.notes) : '',
    classType: resolved.classType ? String(resolved.classType).trim() : undefined,
    channel: resolved.channel ? String(resolved.channel).trim() : undefined,
    stage: resolved.stage ? String(resolved.stage).trim() : undefined,
    status: resolved.status ? String(resolved.status).trim() : undefined,
    valueEstimate: resolved.valueEstimate !== undefined ? Number(resolved.valueEstimate) : undefined,
    center: resolved.center ? String(resolved.center).trim() : undefined,
    memberId: resolved.memberId ? String(resolved.memberId).trim() : undefined,
    hostId: resolved.hostId ? String(resolved.hostId).trim() : undefined,
    period: resolved.period ? String(resolved.period).trim() : undefined,
    purchasesMade: resolved.purchasesMade !== undefined ? Number(resolved.purchasesMade) : undefined,
    visits: resolved.visits !== undefined ? Number(resolved.visits) : undefined,
    trialStatus: resolved.trialStatus ? String(resolved.trialStatus).trim() : undefined,
    conversionStatus: resolved.conversionStatus ? String(resolved.conversionStatus).trim() : undefined,
    retentionStatus: resolved.retentionStatus ? String(resolved.retentionStatus).trim() : undefined,
    associateName: resolved.associateName ? String(resolved.associateName).trim() : undefined,
    associateId,
    locationId,
    followUps: record ? extractFollowUps(record) : undefined
  }
}
