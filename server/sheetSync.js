// Two-way sync engine. The Google Sheet is the source of truth for every
// column it carries; Supabase and the in-memory db are a mirror of it plus
// the data the sheet has no column for (notes, follow-ups, payments, inbox).
//
// Three stores, one convergence rule:
//
//   sheet edit  --Apps Script webhook-->  merge  -->  app + Supabase
//   app edit    --debounced batchUpdate->  sheet
//   drift       --periodic reconcile---->  whichever side changed last
//
// The merge is a three-way diff (see sheetMerge.js) against a snapshot of what
// the sheet said at the end of the last sync, which is how per-field
// last-write-wins works without an "Updated At" column in the sheet. Row
// identity rides inside the existing `Sync Status` column (see
// sheetIdentity.js), so no new columns appear either.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as supabase from './supabaseStore.js'
import { config, isConfigured, readSheetRows, sheetsFetch, colLetter, SHEETS_BASE } from './googleSheets.js'
import { resolveLeadFields, resolveHeaderFields, buildLeadPayloadFromResolved, isValidEmail, isValidPhone } from './leadFieldMapping.js'
import { parseLeadKey, buildLeadIndex, contactKeys, resolveLead, STATUS_HEADER } from './sheetIdentity.js'
import { mergeRow, nextSnapshot } from './sheetMerge.js'
import { leadView, sheetValueFor, writableFields, isRoundTrippable } from './sheetFields.js'
import { MIRROR_HEADER, mirrorRowFor, indexMirrorRows, planMirrorWrites } from './sheetMirror.js'
import { createOutboundQueue } from './sheetOutbound.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_FILE = path.join(__dirname, '..', 'data', 'sheetSnapshot.json')

// All Sheets HTTP access goes through this one object, so the engine can be
// driven against a fake sheet in tests without stubbing the network.
const realTransport = {
  readSheetRows: () => readSheetRows(db()),
  readMirrorRows: async () => {
    const c = config(db())
    const range = encodeURIComponent(c.mirrorTab)
    const data = await sheetsFetch(db(), `${SHEETS_BASE}/${c.sheetId}/values/${range}`)
    const values = data.values || []
    return { header: values[0] || [], rows: values.slice(1) }
  },
  writeMirror: (data) => sheetsFetch(db(), `${SHEETS_BASE}/${config(db()).sheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data })
  }),
  appendMirror: (values) => sheetsFetch(
    db(),
    `${SHEETS_BASE}/${config(db()).sheetId}/values/${encodeURIComponent(`${config(db()).mirrorTab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }
  ),
}
let transport = realTransport
let externalStores = true

let ctx = null
let queue = null
// leadId -> { rowNumber, values }
const snapshot = new Map()
const snapshotDirty = new Set()
const snapshotGone = new Set()
let snapshotLoaded = false
// Remembered from the last read so a lead created in the app knows which
// fields the sheet actually has columns for, without a read of its own.
let lastPlan = null
// A pass is treated as a mid-refresh read — rather than as a witnessed mass
// deletion — when it sees under this share of the rows it knew about AND at
// least this many rows have gone. The absolute floor matters: without it a
// two-row sheet losing one row trips the ratio, and ordinary single-row
// deletions would never be honoured. Deliberately generous in both directions,
// because a missed delete is a stale lead someone notices while a wrong one
// destroys history that exists nowhere else.
const BULK_CLEAR_RATIO = 0.7
const BULK_CLEAR_FLOOR = 5
const DEFAULT_APPEND_FIELDS = ['fullName', 'email', 'phone', 'source', 'stage', 'status', 'remarks', 'classType', 'channel', 'valueEstimate', 'createdAt']

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

// `deps` are index.js's own lead helpers, injected rather than imported to
// keep this module free of the express app and testable on its own.
export function configure(deps) {
  ctx = deps
  queue = createOutboundQueue({
    writeCells: (cells) => writeCells(cells),
    delay: deps.flushDelay ?? 3000,
    onError: (err) => deps.logSync('error', `sheet write-back failed: ${err.message}`)
  })
  return queue
}

function db() { return ctx.db() }

// Test seams. `__setTransport` swaps the Sheets HTTP layer for a fake and, with
// it, turns off the Supabase/local-file snapshot stores — a unit test has no
// business writing either.
export function __setTransport(fake) {
  transport = { ...realTransport, ...fake }
  externalStores = false
}

export function __reset() {
  snapshot.clear()
  snapshotDirty.clear()
  snapshotGone.clear()
  snapshotLoaded = false
  lastPlan = null
}

// ---------------------------------------------------------------------------
// snapshot store
// ---------------------------------------------------------------------------

export async function loadSnapshot() {
  if (snapshotLoaded) return
  snapshotLoaded = true
  if (!externalStores) return
  try {
    const remote = await supabase.loadSheetSnapshot()
    if (remote) {
      for (const [leadId, entry] of Object.entries(remote)) snapshot.set(leadId, entry)
      return
    }
  } catch (err) {
    console.warn(`[sheet-sync] Supabase snapshot unavailable, falling back to local file: ${err.message}`)
  }
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const local = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
      for (const [leadId, entry] of Object.entries(local.rows || {})) snapshot.set(leadId, entry)
    }
  } catch (err) {
    console.warn(`[sheet-sync] local snapshot unreadable, starting empty: ${err.message}`)
  }
}

function rememberRow(leadId, rowNumber, values) {
  snapshot.set(leadId, { rowNumber, values })
  snapshotDirty.add(leadId)
  snapshotGone.delete(leadId)
}

function forgetRow(leadId) {
  snapshot.delete(leadId)
  snapshotDirty.delete(leadId)
  snapshotGone.add(leadId)
}

export async function persistSnapshot() {
  const dirty = [...snapshotDirty]
  const gone = [...snapshotGone]
  snapshotDirty.clear()
  snapshotGone.clear()
  if (!dirty.length && !gone.length) return
  if (!externalStores) return
  try {
    await supabase.saveSheetSnapshot(dirty.map(leadId => ({ leadId, ...snapshot.get(leadId) })).filter(e => e.values))
    await supabase.deleteSheetSnapshot(gone)
  } catch (err) {
    // Re-mark so the next pass retries; a lost snapshot means the following
    // sync re-detects changes it has already applied, which is noisy but
    // never destructive (the merge is idempotent on equal values).
    dirty.forEach(id => snapshotDirty.add(id))
    gone.forEach(id => snapshotGone.add(id))
    console.warn(`[sheet-sync] snapshot persist failed: ${err.message}`)
  }
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true })
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ rows: Object.fromEntries(snapshot) }))
  } catch (err) {
    console.warn(`[sheet-sync] local snapshot write failed: ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// column plan
// ---------------------------------------------------------------------------

// Everything the sync needs to know about the sheet's shape: which column
// carries which lead field, and where the identity/status column lives.
export function columnPlan(header, integ) {
  const { fields, columnByField } = resolveHeaderFields(header, integ)
  let statusColIndex = header.findIndex(h => String(h).trim().toLowerCase() === STATUS_HEADER.toLowerCase())
  if (statusColIndex === -1) statusColIndex = header.length
  // The status column carries our identity marker, never lead data, even if
  // its name happens to alias onto a field.
  const writable = fields.filter(field => columnByField[field] !== statusColIndex)
  lastPlan = { header, fields: writable, columnByField, statusColIndex }
  return lastPlan
}

function recordFrom(header, row) {
  const record = {}
  header.forEach((h, i) => { if (h) record[String(h).trim()] = row[i] })
  return record
}

// The sheet's values for the mapped fields only, as a flat {field: value}.
function sheetValues(plan, row) {
  const out = {}
  for (const field of plan.fields) out[field] = row[plan.columnByField[field]] ?? ''
  return out
}

// ---------------------------------------------------------------------------
// inbound: apply one row
// ---------------------------------------------------------------------------

// Applies a single sheet row to the app. Shared by the webhook (one row) and
// the reconcile pass (every row), so both paths converge identically.
//
// Returns what happened, for the sync log: 'created' | 'merged' | 'unchanged'
// | 'skipped'.
function applyRow(plan, { rowNumber, row, previous = {}, editedAt = null, index, ignoreSnapshot = false }) {
  const record = recordFrom(plan.header, row)
  if (!Object.values(record).some(v => String(v || '').trim())) return { outcome: 'skipped', reason: 'blank row' }

  const statusCell = plan.statusColIndex < row.length ? row[plan.statusColIndex] : ''
  const leadKey = parseLeadKey(statusCell)
  const resolved = resolveLeadFields(record, config(db()))
  const { lead } = resolveLead(index, {
    leadKey,
    rowNumber,
    current: { email: resolved.email, phone: resolved.phone },
    previous
  })

  const values = sheetValues(plan, row)

  if (!lead) {
    const name = String(resolved.fullName || '').trim()
    const email = String(resolved.email || '').trim()
    const phone = String(resolved.phone || '').trim()
    if (!name || (!isValidEmail(email) && !isValidPhone(phone))) {
      return { outcome: 'skipped', reason: 'no name or usable contact' }
    }
    const created = ctx.createLeadFrom(buildLeadPayloadFromResolved(resolved, db(), 'Google Sheets', record))
    db().leads.push(created)
    ctx.markDirty(created.id)
    // Added to the live index so a second row for the same person later in the
    // same pass merges onto this lead instead of creating a twin.
    addToIndex(index, created, rowNumber)
    rememberRow(created.id, rowNumber, nextSnapshot({ fields: plan.fields, sheet: values }))
    return { outcome: 'created', lead: created }
  }

  const base = ignoreSnapshot ? null : snapshot.get(lead.id)
  // The lead is compared in the SHEET's vocabulary, not its own — `source` vs
  // `sourceName`, `notes` vs `remarks`, and the owner as a NAME rather than the
  // associate id the lead actually stores. Without this the owner column read
  // as "cleared by the app" on every pass.
  const merged = mergeRow({
    fields: plan.fields,
    sheet: values,
    snapshot: base?.values || null,
    lead: leadView(lead, plan.fields, db()),
    fieldUpdatedAt: lead.fieldUpdatedAt || {},
    sheetEditedAt: editedAt,
    // The source tab is rebuilt wholesale by an upstream export, so a blank
    // cell there means "not supplied", never "cleared by a person".
    blankMeansMissing: true
  })
  // A field with no reader is inbound-only: the sheet may set it, but we never
  // write a guess back into that column.
  for (const field of Object.keys(merged.toSheet)) {
    if (!isRoundTrippable(field)) delete merged.toSheet[field]
  }

  if (Object.keys(merged.toLead).length) {
    // Muted: this is the sheet talking, so nothing here may echo back out.
    queue.applyingFromSheet(() => {
      const payload = buildLeadPayloadFromResolved(
        resolveLeadFields(recordForFields(plan, merged.toLead), config(db())),
        db(), 'Google Sheets', record
      )
      ctx.updateLeadFromPayload(lead, payload)
      stampFieldTimes(lead, Object.keys(merged.toLead), editedAt)
    })
    ctx.markDirty(lead.id)
  }
  if (Object.keys(merged.toSheet).length) queue.enqueueLead(lead.id, merged.toSheet)

  rememberRow(lead.id, rowNumber, nextSnapshot({ fields: plan.fields, sheet: values, ...merged }))

  const changed = Object.keys(merged.toLead).length || Object.keys(merged.toSheet).length
  return { outcome: changed ? 'merged' : 'unchanged', lead, conflicts: merged.conflicts }
}

// updateLeadFromPayload takes a resolved payload, not a field map, so the
// merge result is projected back through the sheet's own column names — that
// keeps one code path for stage normalisation, associate resolution and date
// parsing instead of a second, divergent one here.
function addToIndex(index, lead, rowNumber) {
  index.byId.set(lead.id, lead)
  const keys = contactKeys(lead)
  if (keys.email && !index.byEmail.has(keys.email)) index.byEmail.set(keys.email, lead)
  if (keys.phone && !index.byPhone.has(keys.phone)) index.byPhone.set(keys.phone, lead)
  if (rowNumber && !index.byRow.has(rowNumber)) index.byRow.set(rowNumber, lead)
}

function recordForFields(plan, fieldValues) {
  const record = {}
  for (const [field, value] of Object.entries(fieldValues)) {
    const header = plan.header[plan.columnByField[field]]
    if (header) record[String(header).trim()] = value
  }
  return record
}

function stampFieldTimes(lead, fields, at) {
  const stamp = at || new Date().toISOString()
  lead.fieldUpdatedAt = lead.fieldUpdatedAt || {}
  for (const field of fields) lead.fieldUpdatedAt[field] = stamp
}

// Called for app-side edits, from index.js's mutation paths.
export function noteAppEdit(lead, fields) {
  if (!lead || !fields?.length) return
  // An app edit names lead properties; the sheet wants its own field names and
  // its own representation (the owner as a name, remarks as `notes`).
  const outgoing = {}
  for (const field of fields) {
    if (field === 'associateId') { outgoing.associateName = sheetValueFor(lead, 'associateName', db()) }
    else if (field === 'sourceName') { outgoing.source = lead.sourceName }
    else if (field === 'remarks') { outgoing.notes = lead.remarks }
    else if (isRoundTrippable(field)) outgoing[field] = lead[field]
  }
  stampFieldTimes(lead, Object.keys(outgoing), new Date().toISOString())
  if (!queue || !Object.keys(outgoing).length) return
  queue.enqueueLead(lead.id, outgoing)
}

// A lead created in the app. Queues every sheet-backed field so the flush has
// something to append a row for; the queue drops all of it if this lead came
// from the sheet in the first place.
export function noteNewLead(lead) {
  if (!lead || !queue) return
  const fields = writableFields(lastPlan ? lastPlan.fields : DEFAULT_APPEND_FIELDS)
  const values = {}
  for (const field of fields) {
    const value = sheetValueFor(lead, field, db())
    if (value !== '' && value !== null && value !== undefined) values[field] = value
  }
  stampFieldTimes(lead, Object.keys(values), new Date().toISOString())
  queue.enqueueLead(lead.id, values)
}

export function applyingFromSheet(fn) {
  return queue ? queue.applyingFromSheet(fn) : fn()
}

// ---------------------------------------------------------------------------
// outbound
// ---------------------------------------------------------------------------

// Nothing is written to the source tab any more — not even the identity marker.
// The upstream export rebuilds that tab several times a day, so a marker there
// survives only until the next refresh; identity rests on the contact columns,
// which come from the upstream data itself. Existing `L-<id>` markers are still
// READ, so sheets stamped before this change keep their strong key until the
// next rebuild wipes it.
// Write-back goes to the CRM-owned mirror tab, never to the source tab. The
// source tab is an upstream export: anything written there is destroyed by the
// next refresh, and a half-overwritten export row is worse than none.
//
// The queue hands us individual cells, but the mirror is a fixed layout the app
// owns outright, so the whole row is rewritten per affected lead — one range per
// lead instead of one per field, and no chance of a row left half-updated.
async function writeCells(cells) {
  if (externalStores && !isConfigured(db())) return
  const c = config(db())
  if (!c.mirrorTab) return // no mirror tab configured: app edits simply stay in the app

  const leadIds = new Set(cells.map(cell => cell.leadId).filter(Boolean))
  if (!leadIds.size) return

  const leads = [...leadIds].map(id => db().leads.find(l => l.id === id)).filter(Boolean)
  if (!leads.length) return

  const { header, rows } = await transport.readMirrorRows()
  if (!header.length) await transport.writeMirror([{ range: mirrorRange(c, 1, MIRROR_HEADER.length), values: [MIRROR_HEADER] }])

  const { updates, appends } = planMirrorWrites(leads, indexMirrorRows(rows), db())

  if (updates.length) {
    await transport.writeMirror(updates.map(({ rowNumber, values }) => ({
      range: mirrorRange(c, rowNumber, values.length),
      values: [values]
    })))
  }
  if (appends.length) await transport.appendMirror(appends.map(a => a.values))
}

function mirrorRange(c, rowNumber, width) {
  return `${c.mirrorTab}!A${rowNumber}:${colLetter(width - 1)}${rowNumber}`
}

export function flush() {
  return queue ? queue.flush() : Promise.resolve({ written: 0 })
}

// ---------------------------------------------------------------------------
// webhook events
// ---------------------------------------------------------------------------

// One edited row, pushed by the sheet's Apps Script. No Sheets read at all in
// the common case — the payload carries the row's values.
export async function applySheetEdit({ rowNumber, header, values, previous = {}, editedAt }) {
  if (externalStores && !isConfigured(db())) throw new Error('Google Sheets is not configured.')
  await loadSnapshot()
  const plan = columnPlan(header, config(db()))
  const index = buildLeadIndex(db().leads, Object.fromEntries(snapshot))
  const result = applyRow(plan, {
    rowNumber, row: values, previous, index, editedAt: editedAt || new Date().toISOString()
  })
  await persistSnapshot()
  await flush()
  if (result.conflicts?.length) {
    const detail = result.conflicts.map(c => `${c.field} -> ${c.winner}`).join(', ')
    ctx.logSync('conflict', `row ${rowNumber}: ${detail}`)
  }
  ctx.save()
  return result
}

// Structural events (a row inserted or deleted) don't tell us which row, so
// they fall through to a full reconcile — the only pass that can diff the
// sheet's row set against the snapshot.
export function needsReconcile(type) {
  return ['REMOVE_ROW', 'INSERT_ROW', 'REMOVE_GRID', 'OTHER'].includes(String(type || '').toUpperCase())
}

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

// Full pass. Reads the whole tab, merges every row, then deletes the leads
// whose rows have disappeared. This is the safety net behind the webhook (a
// missed push, a server restart, an edit made while the app was down) and the
// only path that detects deletions.
export async function reconcile({ force = false } = {}) {
  if (externalStores && !isConfigured(db())) throw new Error('Google Sheets is not fully configured yet.')
  await loadSnapshot()
  const { header, rows } = await transport.readSheetRows()
  if (!header.length) return { created: 0, merged: 0, unchanged: 0, skipped: 0, deleted: 0 }

  const plan = columnPlan(header, config(db()))

  // This sheet is cleared and repopulated several times a day by an upstream
  // export. A read that lands in the gap between "cleared" and "repopulated"
  // sees an empty or half-filled tab — and taken literally, that means every
  // lead's row was deleted. Deleting is unrecoverable (remarks, follow-ups and
  // payment history exist nowhere in the sheet), so a pass that would remove a
  // large share of the workspace is treated as a bad read and gives up on
  // deletions entirely rather than acting on it.
  const priorRowCount = snapshot.size
  const missingRows = priorRowCount - rows.length
  const looksTruncated = priorRowCount > 0
    && rows.length < priorRowCount * BULK_CLEAR_RATIO
    && missingRows >= BULK_CLEAR_FLOOR

  const counts = { created: 0, merged: 0, unchanged: 0, skipped: 0, deleted: 0, conflicts: 0 }
  const seen = new Set()
  const blankRows = new Set()
  // Built once. Rebuilding it per row turned a 40k-row sheet into 40k passes
  // over every lead in the workspace.
  const index = buildLeadIndex(db().leads, Object.fromEntries(snapshot))
  // Row numbers as they were BEFORE this pass rewrote them — the shift check
  // below needs the old positions.
  const priorRows = new Map([...snapshot].map(([leadId, entry]) => [leadId, entry.rowNumber]))

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2 // +1 for zero-index, +1 for the header row
    const result = applyRow(plan, { rowNumber, row: rows[i], index, ignoreSnapshot: force })
    counts[result.outcome] = (counts[result.outcome] || 0) + 1
    counts.conflicts += result.conflicts?.length || 0
    if (result.lead) seen.add(result.lead.id)
    if (result.reason === 'blank row') blankRows.add(rowNumber)
  }

  const lastRow = rows.length + 1

  // Deleting a row shifts every row below it up by one, and that shift is the
  // only hard evidence a row was removed at all — the sheet's row COUNT can't
  // be trusted (rows get added in the same pass) and bounds can't be either
  // (after a delete, the last row number is still occupied, just by someone
  // else). So a lead whose row nothing resolved to is deleted only when:
  //
  //   its row is now past the end of the sheet, or
  //   the lead now sitting at its row used to sit FURTHER DOWN — i.e. rows
  //   above it were removed and everything slid up.
  //
  // Anything else (a row emptied out, a row overwritten with someone else's
  // details, a mangled status cell) leaves the lead in place with a warning.
  // The asymmetry is deliberate: a missed delete is a stale lead someone
  // notices, while a wrong delete destroys remarks, follow-ups and payment
  // history that exist nowhere in the sheet, with no undo.
  if (looksTruncated) {
    ctx.logSync('warn', `sheet returned ${rows.length} rows against ${priorRowCount} known — treating as a mid-refresh read, no leads deleted`)
  }

  const occupantOf = new Map()
  for (const [leadId, entry] of snapshot) if (entry.rowNumber) occupantOf.set(entry.rowNumber, leadId)

  for (const [leadId, entry] of [...snapshot]) {
    if (seen.has(leadId)) continue
    if (looksTruncated) continue
    const row = entry.rowNumber
    if (row && blankRows.has(row)) continue

    const shiftedUp = row && priorRows.get(occupantOf.get(row)) > row
    if (row && row <= lastRow && !shiftedUp) {
      ctx.logSync('warn', `lead ${leadId} no longer matches sheet row ${row} — left in place, not deleted`)
      continue
    }
    forgetRow(leadId)
    if (ctx.deleteLead(leadId)) counts.deleted++
  }

  await persistSnapshot()
  await flush()
  db().settings.googleSheets.lastSyncAt = new Date().toISOString()
  db().settings.googleSheets.lastSyncCounts = counts
  ctx.logSync('synced', `${counts.created} created, ${counts.merged} merged, ${counts.unchanged} unchanged, ${counts.deleted} deleted, ${counts.skipped} skipped, ${counts.conflicts} conflicts`)
  ctx.save()
  return counts
}

