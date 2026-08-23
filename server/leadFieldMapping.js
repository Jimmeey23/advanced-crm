// Shared field-resolution logic for any external lead source that hands us
// a flat {key: value} record — inbound webhooks and Google Sheets rows both
// go through this. Keeping it in one module means both features get the
// same alias dictionary and manual-mapping/defaults precedence for free.

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

function findByAlias(record, field) {
  const aliases = NORMALIZED_ALIASES[field]
  for (const key of Object.keys(record)) {
    if (aliases.includes(normalizeKey(key))) return record[key]
  }
  return undefined
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
  const reverseMapping = {}
  for (const [incomingKey, targetField] of Object.entries(mapping)) {
    if (!reverseMapping[targetField]) reverseMapping[targetField] = incomingKey
  }
  const out = {}
  for (const field of Object.keys(LEAD_FIELD_ALIASES)) {
    let val
    const mappedKey = reverseMapping[field]
    if (mappedKey !== undefined) val = record[mappedKey]
    if (val === undefined || val === null || String(val).trim() === '') {
      val = findByAlias(record, field)
    }
    if (val === undefined || val === null || String(val).trim() === '') {
      val = defaults[field]
    }
    if (val !== undefined && val !== null && String(val).trim() !== '') out[field] = val
  }
  // firstName/lastName aren't real Lead fields — they only exist to build
  // fullName when a source sends split name fields instead of one combined one.
  if (!out.fullName && (out.firstName || out.lastName)) {
    out.fullName = [out.firstName, out.lastName].filter(Boolean).join(' ').trim()
  }
  return out
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
    .filter(f => String(f.date || '').trim() || String(f.comments || '').trim())
    .map((f, i) => ({
      id: `fu_import_${Date.now().toString(36)}_${i}`,
      date: f.date ? String(f.date).trim() : '',
      comments: f.comments ? String(f.comments).trim() : '',
      channel: null,
      done: true
    }))
}

// Turns a resolveLeadFields() result into the payload shape
// createLeadFrom() expects, dropping associateId/locationId if they don't
// match a real record rather than silently creating a lead pointed at a
// non-existent associate or studio. `db` needs `.associates`/`.locations`;
// `fallbackSourceName` is used when the record didn't resolve a `source`;
// `record` (optional, the raw pre-alias record) is scanned for the
// "Follow Up N ..." column pairs described above.
export function buildLeadPayloadFromResolved(resolved, db, fallbackSourceName, record) {
  const associateId = resolved.associateId && db.associates.some(a => a.id === resolved.associateId) ? resolved.associateId : undefined
  const locationId = resolved.locationId && db.locations.some(l => l.id === resolved.locationId) ? resolved.locationId : undefined
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
