// Row identity for the Google Sheet, which is the source of truth for every
// column it carries.
//
// The sheet has no ID column of its own and we were asked not to add one, so
// identity is smuggled into the `Sync Status` column this app already writes:
//
//   Imported 2026-08-31T09:12:04.881Z · L-lead_k29fa1
//
// That cell is app-managed and already present, so nothing new appears in the
// sheet, and a row keeps its identity through sorting, row insertion and
// edits to the contact columns. Rows written before this change carry only
// the `Imported <ts>` half; they fall back to email/phone matching once and
// are stamped with a key on the way past.
import { normalizeEmail, normalizePhone } from './duplicateMatch.js'

export const STATUS_HEADER = 'Sync Status'
export const IMPORTED_MARK = 'Imported'
const KEY_MARK = 'L-'

export function buildStatusCell(leadId, at = new Date().toISOString()) {
  if (!leadId) return `${IMPORTED_MARK} ${at}`
  return `${IMPORTED_MARK} ${at} · ${KEY_MARK}${leadId}`
}

// Tolerant of hand-editing: any `L-<id>` token anywhere in the cell counts,
// whatever separator or stray text a human left around it.
export function parseLeadKey(cell) {
  const match = /L-([A-Za-z0-9_-]+)/.exec(String(cell || ''))
  return match ? match[1] : null
}

export function wasImported(cell) {
  return String(cell || '').trim().startsWith(IMPORTED_MARK)
}

// Contact identity, used only when the row carries no key yet. Both halves are
// kept so a row can be found by whichever one survived an edit.
export function contactKeys(record) {
  return {
    email: normalizeEmail(record.email) || null,
    phone: normalizePhone(record.phone) || null
  }
}

// Resolves a sheet row to an existing lead, most reliable signal first:
//
//   1. the `L-<id>` key in the row's Sync Status cell
//   2. the row number recorded in the snapshot from the last sync
//   3. normalized email or phone as they are NOW
//   4. normalized email or phone as they were BEFORE this edit — Apps Script
//      hands us `oldValue`, which is the only thing that keeps an edit to the
//      email cell from looking like a brand new lead plus an orphan
//
// `index` is built by buildLeadIndex below; returning the lead itself (not an
// id) keeps callers from having to re-look-it-up.
export function resolveLead(index, { leadKey, rowNumber, current = {}, previous = {} } = {}) {
  if (leadKey && index.byId.has(leadKey)) return { lead: index.byId.get(leadKey), via: 'key' }
  if (rowNumber && index.byRow.has(rowNumber)) return { lead: index.byRow.get(rowNumber), via: 'row' }

  const now = contactKeys(current)
  if (now.email && index.byEmail.has(now.email)) return { lead: index.byEmail.get(now.email), via: 'email' }
  if (now.phone && index.byPhone.has(now.phone)) return { lead: index.byPhone.get(now.phone), via: 'phone' }

  const before = contactKeys(previous)
  if (before.email && index.byEmail.has(before.email)) return { lead: index.byEmail.get(before.email), via: 'old-email' }
  if (before.phone && index.byPhone.has(before.phone)) return { lead: index.byPhone.get(before.phone), via: 'old-phone' }

  return { lead: null, via: null }
}

// `snapshotRows` maps leadId -> { rowNumber, values } as of the last sync.
export function buildLeadIndex(leads, snapshotRows = {}) {
  const index = { byId: new Map(), byRow: new Map(), byEmail: new Map(), byPhone: new Map() }
  for (const lead of leads) {
    index.byId.set(lead.id, lead)
    const keys = contactKeys(lead)
    // First writer wins on the contact indexes: with two leads sharing a
    // phone, silently rebinding the sheet row to whichever came last would
    // make the merge non-deterministic between runs.
    if (keys.email && !index.byEmail.has(keys.email)) index.byEmail.set(keys.email, lead)
    if (keys.phone && !index.byPhone.has(keys.phone)) index.byPhone.set(keys.phone, lead)
    const row = snapshotRows[lead.id]?.rowNumber
    if (row && !index.byRow.has(row)) index.byRow.set(row, lead)
  }
  return index
}
