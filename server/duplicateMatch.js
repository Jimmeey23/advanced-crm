// Single source of truth for "are these two leads the same person" — used by
// live ingestion (webhook/Google Sheets sync, one incoming lead vs the db)
// and by the bulk dedupe review (clustering the whole db). Previously these
// two call sites had separately drifted implementations: one required exact
// first-name equality on a phone match, the other grouped by phone alone
// with no name check at all, and neither handled a country-code prefix
// (+91 98765 43210 vs 9876543210) or a typo'd name. That let the same pair
// of leads be judged "duplicate" by one code path and "not duplicate" by
// the other.

import { isValidEmail, isValidPhone } from './leadFieldMapping.js'

// Placeholder values ("N/A", "-", "none", "test@test.com" typed by whoever
// filled the sheet/form) are non-empty but not real emails — without this
// check two unrelated leads that both happen to have the same placeholder
// junk in their email field were being matched as an exact duplicate.
export function normalizeEmail(email) {
  const trimmed = String(email || '').trim()
  if (!trimmed || !isValidEmail(trimmed)) return ''
  return trimmed.toLowerCase()
}

// Compares the last 10 digits so a country-code prefix (91, +91, 0) typed
// inconsistently across imports doesn't hide a real duplicate. Rejects
// obviously-not-a-phone-number junk ("N/A", a single digit, a date) the
// same way normalizeEmail rejects placeholder emails.
export function normalizePhone(phone) {
  if (!isValidPhone(phone)) return ''
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : digits
}

// Duplicate = exact email match OR exact phone match. No name involved —
// a fuzzy name check used to gate the phone match, but that let genuine
// duplicates with a reformatted/shortened name slip through as "new" while
// occasionally flagging unrelated people with similar names as duplicates.
export function isDuplicatePair(a, b) {
  const emailA = normalizeEmail(a.email), emailB = normalizeEmail(b.email)
  if (emailA && emailB && emailA === emailB) return true
  const phoneA = normalizePhone(a.phone), phoneB = normalizePhone(b.phone)
  if (phoneA && phoneA === phoneB) return true
  return rawContactMatch(a, b)
}

// Fallback for a lead whose email/phone doesn't pass validation (typo'd
// domain, 9-digit number, "N/A") — normalizeEmail/normalizePhone reject
// these outright, which used to make findDuplicateAmong give up on the
// candidate entirely and let it re-create a fresh lead on every resync/
// webhook redelivery. An exact match on the raw trimmed/lowercased string
// still catches "same junk value repeated" without risking a false match
// between two different people who both merely lack clean contact info.
function rawContactMatch(a, b) {
  const rawEmailA = String(a.email || '').trim().toLowerCase()
  const rawEmailB = String(b.email || '').trim().toLowerCase()
  if (rawEmailA && rawEmailB && rawEmailA === rawEmailB) return true
  const rawPhoneA = String(a.phone || '').trim().toLowerCase()
  const rawPhoneB = String(b.phone || '').trim().toLowerCase()
  return Boolean(rawPhoneA && rawPhoneB && rawPhoneA === rawPhoneB)
}

// Finds a single existing lead matching `candidate` — used when a new lead
// (webhook, sheet row) arrives and needs to be checked against the db.
export function findDuplicateAmong(leads, candidate) {
  const emailNorm = normalizeEmail(candidate.email)
  const phoneNorm = normalizePhone(candidate.phone)
  const hasRawContact = String(candidate.email || '').trim() || String(candidate.phone || '').trim()
  if (!emailNorm && !phoneNorm && !hasRawContact) return null
  return leads.find(l => isDuplicatePair(candidate, l)) || null
}

// Clusters an entire lead list into duplicate groups using union-find, so
// A~B (by email) and B~C (by phone) land in one group even though A and C
// never matched directly — a naive "hash by one key" grouping (the bulk
// dedupe endpoint's old approach) can't see that transitive link.
export function clusterDuplicates(leads) {
  const parent = leads.map((_, i) => i)
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  function union(i, j) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj }

  const emailBuckets = new Map()
  const phoneBuckets = new Map()
  leads.forEach((l, i) => {
    const email = normalizeEmail(l.email)
    if (email) { if (!emailBuckets.has(email)) emailBuckets.set(email, []); emailBuckets.get(email).push(i) }
    const phone = normalizePhone(l.phone)
    if (phone) { if (!phoneBuckets.has(phone)) phoneBuckets.set(phone, []); phoneBuckets.get(phone).push(i) }
  })

  // Exact match (email or phone) is sufficient on its own — union the whole bucket.
  for (const idxs of emailBuckets.values()) {
    for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k])
  }
  for (const idxs of phoneBuckets.values()) {
    for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k])
  }

  const clusters = new Map()
  leads.forEach((l, i) => {
    const root = find(i)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(l)
  })
  return [...clusters.values()].filter(g => g.length > 1)
}
