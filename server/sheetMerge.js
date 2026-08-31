// Three-way merge between the sheet, the app, and the snapshot of what the
// sheet said at the end of the last sync.
//
// The snapshot is what makes per-field last-write-wins possible without
// adding an "Updated At" column to the sheet: comparing each side against
// the snapshot tells us WHICH side actually changed a field, and only fields
// changed on both sides need a timestamp to break the tie.
//
//   sheet only changed  -> the app takes it
//   app only changed    -> the sheet takes it
//   both changed        -> later timestamp wins; the sheet wins a tie,
//                          because the sheet is the source of truth
//   neither changed     -> nothing moves
//
// Every value is compared as a trimmed string. Sheets hands back strings for
// everything anyway, and `500` from a cell must not read as a change against
// the number 500 in the app on every single pass.

export const SHEET_WINS = 'sheet'
export const APP_WINS = 'app'

function norm(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function later(a, b) {
  const ta = Date.parse(a || '')
  const tb = Date.parse(b || '')
  if (Number.isNaN(ta) && Number.isNaN(tb)) return null
  if (Number.isNaN(ta)) return APP_WINS
  if (Number.isNaN(tb)) return SHEET_WINS
  if (ta === tb) return null
  return ta > tb ? SHEET_WINS : APP_WINS
}

// `fields` is the set of lead fields the sheet has a column for — nothing
// outside it is ever touched, which is how app-only data (notes, follow-ups,
// payments) stays out of the merge entirely.
//
// Returns the two changesets to apply plus the conflicts, so callers can log
// what was overruled rather than have it happen invisibly.
// `blankMeansMissing` suits a tab rebuilt wholesale by an upstream export: an
// empty cell there means "upstream did not supply this", not "a person cleared
// it", so it must never wipe what the CRM has gathered. On a hand-maintained
// tab the opposite is true — clearing a cell IS an edit — so the flag is off by
// default.
export function mergeRow({
  fields,
  sheet = {},
  snapshot = null,
  lead = {},
  fieldUpdatedAt = {},
  sheetEditedAt = null,
  blankMeansMissing = false
} = {}) {
  const toLead = {}
  const toSheet = {}
  const conflicts = []

  for (const field of fields) {
    const sheetValue = norm(sheet[field])
    const leadValue = norm(lead[field])
    if (sheetValue === leadValue) continue

    // No snapshot means this row has never been merged before, so there is no
    // way to tell which side moved. The sheet is authoritative, but a blank
    // cell carries no information — it is far more likely a column the sheet
    // never filled than a deliberate clear — so the app's value goes out
    // instead of being destroyed.
    if (!snapshot) {
      if (sheetValue) toLead[field] = sheet[field]
      else if (leadValue) toSheet[field] = lead[field]
      continue
    }

    // A blank cell on an export-rebuilt tab carries no information at all, so
    // it can neither win a field nor count as a change.
    if (blankMeansMissing && !sheetValue) {
      if (leadValue) toSheet[field] = lead[field]
      continue
    }

    const base = norm(snapshot[field])
    const sheetChanged = sheetValue !== base
    const appChanged = leadValue !== base

    if (sheetChanged && !appChanged) { toLead[field] = sheet[field]; continue }
    if (appChanged && !sheetChanged) { toSheet[field] = lead[field]; continue }
    if (!sheetChanged && !appChanged) continue

    // Both sides moved the same field. The sheet is the source of truth, so it
    // takes the field unless the app can show a LATER edit than a timestamped
    // sheet edit. A reconcile carries no sheetEditedAt at all (nobody reports
    // when a cell changed, only that it did) — and there "unknown" must not
    // read as "older than the app", or every app edit would quietly outrank
    // the sheet it is supposed to be a mirror of.
    const winner = sheetEditedAt ? (later(sheetEditedAt, fieldUpdatedAt[field]) || SHEET_WINS) : SHEET_WINS
    conflicts.push({ field, base, sheetValue, leadValue, winner })
    if (winner === SHEET_WINS) toLead[field] = sheet[field]
    else toSheet[field] = lead[field]
  }

  return { toLead, toSheet, conflicts }
}

// The snapshot to store after a merge: what the sheet will hold once both
// changesets have been applied. Writing this rather than the pre-merge sheet
// values is what stops the next pass from re-detecting the same change.
export function nextSnapshot({ fields, sheet = {}, toLead = {}, toSheet = {} }) {
  const out = {}
  for (const field of fields) {
    if (field in toSheet) out[field] = norm(toSheet[field])
    else if (field in toLead) out[field] = norm(toLead[field])
    else out[field] = norm(sheet[field])
  }
  return out
}
