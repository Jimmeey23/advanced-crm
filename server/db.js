import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seed } from './seed.js'
import * as supabase from './supabaseStore.js'
import { normalizeEmail, normalizePhone } from './duplicateMatch.js'
import { DEFAULT_LEAD_SOURCES, DEFAULT_MARKETING_CHANNELS, DEFAULT_CLASS_TYPES, DEFAULT_FOLLOW_UP_CHANNELS, defaultChannelForSource, uniqueClean } from '../src/leadConfig.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')

let state = null
const dirty = new Set()
const deleted = new Set()
let lastLocalWriteAt = 0
let remoteChangeCb = null

// Ids this process just wrote to Supabase, so we can recognise our own writes
// when Realtime echoes them straight back and drop them without doing any work.
//
// This used to be a flat "ignore everything for 2s after any local write"
// window, which silently failed on exactly the case that matters: a bulk pass
// upserting thousands of leads takes far longer than 2s to drain, so the tail
// of its own echo sailed past the check and got applied -- thousands of
// pointless array scans and full-state disk writes, on both ends of a round
// trip that produced no new information. Matching on the id is exact and
// doesn't care how long the burst runs.
//
// Entries expire on a timer rather than on first sight: Realtime can deliver
// an echo more than once, and a never-pruned set would grow without bound.
const selfWrittenLeadIds = new Map()
// A bulk upsert of the whole table takes minutes to drain back through
// Realtime, so the window has to outlive the burst, not the request. Entries
// are deleted on first sight anyway, so a longer TTL costs nothing.
const SELF_WRITE_TTL_MS = 10 * 60 * 1000

function markSelfWritten(ids) {
  const expiry = Date.now() + SELF_WRITE_TTL_MS
  for (const id of ids) selfWrittenLeadIds.set(id, expiry)
}

// Marking happens before the upsert so an echo can be recognised mid-burst,
// which means a FAILED upsert leaves ids marked for a write that never reached
// the database. If another writer then changed one of those rows we would drop
// their echo and sit on stale data for the rest of the TTL. So on failure the
// marks come straight back off: re-applying the echo of our own write is
// harmless, ignoring somebody else's is not.
function unmarkSelfWritten(ids) {
  for (const id of ids) selfWrittenLeadIds.delete(id)
}

// Returns true if `id` is an echo of something we wrote. Prunes lazily -- this
// runs on every inbound Realtime event, so it must stay cheap; a periodic sweep
// of the whole map would be more work than it saves.
function isSelfWrite(id) {
  const expiry = selfWrittenLeadIds.get(id)
  if (expiry === undefined) return false
  if (Date.now() > expiry) { selfWrittenLeadIds.delete(id); return false }
  selfWrittenLeadIds.delete(id)
  return true
}

function ensureSettingsShape(target) {
  if (!target.settings) target.settings = {}
  if ((target.settings.taxonomyVersion || 0) < 2) {
    target.sources = uniqueClean([...DEFAULT_LEAD_SOURCES, ...(target.sources || [])])
    target.channels = uniqueClean([...DEFAULT_MARKETING_CHANNELS, ...(target.channels || [])])
    target.classTypes = uniqueClean([...DEFAULT_CLASS_TYPES, ...(target.classTypes || [])])
    target.settings.followUpChannels = uniqueClean([...DEFAULT_FOLLOW_UP_CHANNELS, ...(target.settings.followUpChannels || [])])
    target.settings.business = target.settings.business || {}
    target.settings.business.sourceChannelMap = Object.fromEntries(target.sources.map(source => [source, target.settings.business.sourceChannelMap?.[source] || defaultChannelForSource(source)]))
    target.settings.taxonomyVersion = 2
  }
  if (!target.settings.zohoPeople) {
    target.settings.zohoPeople = {
      clientId: '', clientSecret: '', refreshToken: '', accessToken: '', tokenExpiresAt: '',
      dataCenter: 'in', enabled: false, lastFetchAt: null, lastFetchError: null, onDuty: null
    }
  }
  if (!Array.isArray(target.payments)) target.payments = []
  if (!Array.isArray(target.discountCodeRequests)) target.discountCodeRequests = []
  return target
}

export function onRemoteChange(cb) {
  remoteChangeCb = cb
}

// ---------------------------------------------------------------------------
// Lookup indexes for the Realtime path
//
// applyRemoteLeadChange used to do a linear `state.leads.findIndex` per event,
// and for an id it didn't recognise a second linear scan inside
// findDuplicateAmong. At 24k leads a bulk burst of 24k echoes is ~576M
// comparisons. These indexes make both lookups O(1).
//
// Correctness comes from invalidating aggressively rather than from tracking
// every mutation site: the id index self-heals (a stale hit is verified
// against the array and repaired on miss), and the duplicate index is thrown
// away whenever anything local is written (every local edit goes through
// markDirty/markDeleted) or whenever the array length changes underneath it.
// A pure remote burst touches neither, which is exactly when the index pays.
// ---------------------------------------------------------------------------
let idIndex = null
let dupIndex = null
let dupIndexLen = -1

function invalidateIndexes() {
  idIndex = null
  dupIndex = null
  dupIndexLen = -1
}

// Verified on every hit, so a stale entry costs one comparison and a repair
// rather than a wrong answer.
function leadIndexOf(id) {
  const leads = state?.leads || []
  if (!idIndex) {
    idIndex = new Map()
    for (let i = 0; i < leads.length; i += 1) if (!idIndex.has(leads[i].id)) idIndex.set(leads[i].id, i)
  }
  const hit = idIndex.get(id)
  if (hit !== undefined && leads[hit] && leads[hit].id === id) return hit
  const found = leads.findIndex(l => l.id === id)
  if (found === -1) idIndex.delete(id)
  else idIndex.set(id, found)
  return found
}

// isDuplicatePair matches on four keys — normalized email, normalized phone,
// and the raw lowercased forms of each as a fallback. Indexing all four and
// taking the LOWEST matching array position reproduces `leads.find(...)`
// exactly, so the merge picks the same existing row it always did.
function buildDupIndex(leads) {
  const maps = { email: new Map(), phone: new Map(), rawEmail: new Map(), rawPhone: new Map() }
  const put = (map, key, i) => { if (key && !map.has(key)) map.set(key, i) }
  for (let i = 0; i < leads.length; i += 1) {
    const l = leads[i]
    put(maps.email, normalizeEmail(l.email), i)
    put(maps.phone, normalizePhone(l.phone), i)
    put(maps.rawEmail, String(l.email || '').trim().toLowerCase(), i)
    put(maps.rawPhone, String(l.phone || '').trim().toLowerCase(), i)
  }
  return maps
}

function findDuplicateIndexed(candidate) {
  const leads = state?.leads || []
  if (!dupIndex || dupIndexLen !== leads.length) {
    dupIndex = buildDupIndex(leads)
    dupIndexLen = leads.length
  }
  const email = normalizeEmail(candidate.email)
  const phone = normalizePhone(candidate.phone)
  const rawEmail = String(candidate.email || '').trim().toLowerCase()
  const rawPhone = String(candidate.phone || '').trim().toLowerCase()
  // Same precondition findDuplicateAmong applies before scanning: a candidate
  // with no contact information of any kind matches nothing.
  if (!email && !phone && !rawEmail && !rawPhone) return null
  const hits = [
    email ? dupIndex.email.get(email) : undefined,
    phone ? dupIndex.phone.get(phone) : undefined,
    rawEmail ? dupIndex.rawEmail.get(rawEmail) : undefined,
    rawPhone ? dupIndex.rawPhone.get(rawPhone) : undefined
  ].filter(i => i !== undefined)
  if (!hits.length) return null
  return leads[Math.min(...hits)] || null
}

export function markDirty(id) {
  if (id) { dirty.add(id); invalidateIndexes() }
}

export function markDeleted(id) {
  if (id) { dirty.delete(id); deleted.add(id); invalidateIndexes() }
}

export function markAllDirty() {
  for (const l of (state?.leads || [])) dirty.add(l.id)
  invalidateIndexes()
}

export function getDirty() {
  return [...dirty]
}

export function getDeleted() {
  return [...deleted]
}

// The local mirror is ~64MB of JSON. Two things about how it gets written
// matter at that size:
//
//   - No indentation. `JSON.stringify(state, null, 2)` produced 89MB where
//     compact produces 63.8MB -- 25MB of whitespace per write, on a file no
//     human reads (it is a machine mirror of Supabase, not a config file).
//   - Not synchronously. writeFileSync of 89MB blocked the event loop for
//     ~286ms on top of ~245ms of stringify, and this runs on a 150ms
//     debounce, so a burst of writes could stall every request behind it.
//
// Writes go to a temp file and are renamed into place, so a crash mid-write
// leaves the previous good mirror rather than a truncated one. Concurrent
// calls are collapsed: a write already in flight sets a "do it again after"
// flag instead of racing a second stringify of the same state.
let writeInFlight = null
let writeQueued = false

function writeFile() {
  if (writeInFlight) { writeQueued = true; return writeInFlight }
  writeInFlight = (async () => {
    try {
      await fs.promises.mkdir(DATA_DIR, { recursive: true })
      const tmp = `${DB_FILE}.${process.pid}.tmp`
      await fs.promises.writeFile(tmp, JSON.stringify(state))
      await fs.promises.rename(tmp, DB_FILE)
    } catch (e) {
      console.error('[db] local mirror write failed', e.message)
    } finally {
      writeInFlight = null
      if (writeQueued) { writeQueued = false; writeFile() }
    }
  })()
  return writeInFlight
}

// Boot-time paths (seed, taxonomy migration) need the file on disk before the
// process can be considered started, and they run once, so they keep the
// blocking write rather than leaving an async one dangling.
function writeFileSync() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DB_FILE, JSON.stringify(state))
}

// The local mirror is written on a debounce, and now asynchronously, so a
// process that exits between the last edit and the next flush would leave the
// most recent writes only in memory. Ctrl-C during a busy minute is the normal
// case for that, not an exotic one.
//
// The flush is deliberately synchronous: an async write cannot be relied on to
// finish inside a signal handler. It costs ~250ms once, at shutdown.
//
// Supabase is a separate matter -- an in-flight upsert cannot be awaited here,
// so anything still queued for it stays queued in `dirty` and goes up on the
// next start. The mirror on disk is what makes that recoverable.
export function flushToDiskSync() {
  if (!state) return
  clearTimeout(saveTimer)
  clearTimeout(remoteWriteTimer)
  try { writeFileSync() } catch (e) { console.error('[db] shutdown flush failed', e.message) }
}

let shutdownHooked = false
export function installShutdownFlush() {
  if (shutdownHooked) return
  shutdownHooked = true
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      flushToDiskSync()
      // Re-raise rather than process.exit(): anything else listening for this
      // signal (the HTTP server's own close, a test harness) still gets it,
      // and the exit code stays the one the signal implies.
      process.removeAllListeners(signal)
      process.kill(process.pid, signal)
    })
  }
  process.on('exit', flushToDiskSync)
}

export function load() {
  if (state) return state
  try {
    if (fs.existsSync(DB_FILE)) {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
      invalidateIndexes()
    } else {
      state = seed()
      invalidateIndexes()
      writeFileSync()
    }
  } catch (err) {
    console.error('[db] failed to load, reseeding', err)
    state = seed()
    invalidateIndexes()
    writeFileSync()
  }
  // An existing db.json predates a settings key added later — fill it in
  // rather than requiring a manual migration or crashing on the missing key.
  const taxonomyVersion = state.settings?.taxonomyVersion || 0
  ensureSettingsShape(state)
  if (taxonomyVersion !== state.settings.taxonomyVersion) writeFileSync()
  if (!state.ownerChangeRequests) state.ownerChangeRequests = []
  return state
}

let saveTimer = null
export function save() {
  if (!state) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    writeFile()
    syncSupabase()
  }, 150)
}

let syncTimer = null
function syncSupabase() {
  if (!supabase.isEnabled()) { dirty.clear(); deleted.clear(); return }
  clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    try {
      const written = [...getDirty(), ...getDeleted()]
      // See saveNow(): mark before the upsert so the echo of an early batch
      // is recognised while later batches are still in flight.
      markSelfWritten(written)
      lastLocalWriteAt = Date.now()
      try {
        await supabase.persistState(state, getDirty(), getDeleted())
      } catch (e) {
        unmarkSelfWritten(written)
        throw e
      }
      markSelfWritten(written)
      dirty.clear()
      deleted.clear()
      lastLocalWriteAt = Date.now()
    } catch (e) {
      console.error('[db] supabase persist failed', e.message)
    }
  }, 300)
}

// Save + await the Supabase write immediately (no debounce), so callers that
// need to confirm persistence before responding to the client — e.g. the
// settings save route — can surface a real error instead of reporting
// success while the write is still silently pending or has failed.
export async function saveNow() {
  if (!state) return
  clearTimeout(saveTimer)
  clearTimeout(syncTimer)
  await writeFile()
  if (!supabase.isEnabled()) { dirty.clear(); deleted.clear(); return }
  // Marked BEFORE the upsert, not after. persistState sends the rows in
  // batches, so Realtime starts echoing batch 1 back while later batches are
  // still uploading -- with the marking after the await, those early echoes
  // arrived unrecognised and were applied as if a stranger had written them.
  const written = [...getDirty(), ...getDeleted()]
  markSelfWritten(written)
  lastLocalWriteAt = Date.now()
  try {
    await supabase.persistState(state, getDirty(), getDeleted())
  } catch (e) {
    // The caller surfaces this failure to the user; leaving the ids marked
    // would also make us deaf to anyone else's edit of those rows.
    unmarkSelfWritten(written)
    throw e
  }
  // Re-stamp: the TTL has to outlive the write, not start before it.
  markSelfWritten(written)
  dirty.clear()
  deleted.clear()
  lastLocalWriteAt = Date.now()
}

export async function saveMetaNow() {
  if (!state) return
  clearTimeout(saveTimer)
  clearTimeout(syncTimer)
  await writeFile()
  if (!supabase.isEnabled()) return
  lastLocalWriteAt = Date.now()
  await supabase.persistMetaState(state)
  lastLocalWriteAt = Date.now()
}

// Debounced disk write for remote-originated changes. A bulk edit (CSV
// import, backfill, bulk action) touching thousands of rows makes Supabase
// Realtime echo back thousands of individual change events in quick
// succession — writing the full state to disk on every single one of them
// serializes ~24k lead objects per event and pegs the event loop for
// minutes. Coalesce into one write after the burst quiets down instead.
let remoteWriteTimer = null
function scheduleRemoteWrite() {
  clearTimeout(remoteWriteTimer)
  remoteWriteTimer = setTimeout(() => {
    writeFile()
  }, 500)
}

// Fired when Supabase Realtime reports a change we didn't just make ourselves
// (e.g. a row edited directly in the Supabase dashboard, or by another server
// instance). Patches just the affected row/meta fields — a full reload would
// mean re-fetching every page of a large leads table on every single edit.
let remoteLeadChangeCount = 0
function applyRemoteLeadChange({ eventType, id, data }) {
  if (!state || !id) return
  const idx = leadIndexOf(id)
  if (idx !== -1) {
    // Known local row: this event can be an echo of our own recent write
    // reflected back through Realtime — skip it to avoid clobbering newer
    // local state with a stale echo. This suppression only makes sense for
    // a row we already have; it must NOT gate the unknown-id branch below,
    // or a genuine concurrent duplicate from another instance sails past
    // the dedup merge check just because we happened to write something
    // else in the last 2s.
    if (isSelfWrite(id) || Date.now() - lastLocalWriteAt < 2000) return
    if (eventType === 'DELETE') { state.leads.splice(idx, 1); invalidateIndexes() }
    else if (data) {
      // Replacing in place keeps every array position valid, so the id index
      // survives; only the contact-keyed index can go stale here.
      state.leads[idx] = data
      dupIndex = null
      dupIndexLen = -1
    }
  } else if (eventType !== 'DELETE' && data) {
    // An id we don't recognize locally usually means this row was created
    // by another server instance sharing this Supabase project. If it's
    // actually the same person as a lead we already have (another instance
    // raced the same email/phone past its own — necessarily local-only —
    // dedup check before either write reached us), merge into the
    // existing row instead of blindly appending a second one.
    const existing = findDuplicateIndexed(data)
    if (existing) {
      const existingIdx = leadIndexOf(existing.id)
      state.leads[existingIdx] = { ...existing, ...data, id: existing.id }
      dupIndex = null
      dupIndexLen = -1
      console.log(`[db] merged remote duplicate lead ${data.id} into existing ${existing.id}`)
    } else {
      state.leads.push(data)
      // Cheaper than a rebuild: the new row is the last position, and it is
      // the only thing either index did not already know about.
      if (idIndex) idIndex.set(data.id, state.leads.length - 1)
      dupIndex = null
      dupIndexLen = -1
    }
  }
  scheduleRemoteWrite()
  remoteLeadChangeCount++
  if (remoteLeadChangeCount % 200 === 1) console.log(`[db] applying remote lead changes… (${remoteLeadChangeCount} so far, latest ${eventType} ${id})`)
  if (remoteChangeCb) remoteChangeCb()
}

const META_FIELDS = ['settings', 'locations', 'associates', 'stages', 'sources', 'channels', 'classTypes', 'activity', 'importHistory', 'webhookIntegrations', 'webhookLogs', 'sheetSyncLogs', 'payments', 'discountCodeRequests']
function applyRemoteMetaChange({ data }) {
  if (Date.now() - lastLocalWriteAt < 2000 || !state || !data) return
  for (const field of META_FIELDS) if (field in data) state[field] = data[field]
  ensureSettingsShape(state)
  scheduleRemoteWrite()
  console.log('[db] applied remote settings/meta change')
  if (remoteChangeCb) remoteChangeCb()
}

// The inbox is the single largest thing we store outside `leads`, and pulling
// it in the same breath as every lead is what pushed startup past Supabase's
// statement timeout. Fetch it after the server is already up instead. Inbox
// writes stay disabled until this lands, so the empty placeholder that
// inbox.ensure() creates in the meantime can never overwrite what's stored.
function loadInboxInBackground() {
  supabase.loadInbox().then(inbox => {
    if (inbox && state) {
      // Merge rather than assign: a webhook that arrived while this was in
      // flight has already appended to the placeholder, and dropping those
      // messages would lose them for good.
      const local = state.inbox || { messages: [], conversations: {} }
      const seen = new Set((inbox.messages || []).map(m => m.id))
      state.inbox = {
        ...inbox,
        messages: [...(inbox.messages || []), ...(local.messages || []).filter(m => !seen.has(m.id))],
        conversations: { ...(inbox.conversations || {}), ...(local.conversations || {}) }
      }
      scheduleRemoteWrite()
      if (remoteChangeCb) remoteChangeCb()
    }
    console.log(`[db] inbox loaded (${(state?.inbox?.messages || []).length} messages)`)
  }).catch(e => {
    console.error('[db] inbox load failed, keeping local copy', e.message)
  }).finally(() => {
    supabase.setInboxPersistEnabled(true)
  })
}

// Async bootstrap: pull the dataset from Supabase if configured.
// Must be awaited before the first load() so the remote state is used.
export async function init() {
  if (!supabase.isEnabled()) {
    console.log('[db] Supabase not configured — using local JSON storage')
    return
  }
  // Every path below that doesn't hand off to loadInboxInBackground() keeps
  // the local (or seeded) inbox, which is authoritative in those cases.
  supabase.setInboxPersistEnabled(true)
  try {
    const remote = await supabase.loadState()
    if (remote && remote.leads) {
      const { legacyInbox, ...rest } = remote
      state = ensureSettingsShape(rest)
      // Wholesale state swap: any index built against the previous array is
      // meaningless now, and the duplicate index cannot detect that on its own
      // (a coincidentally equal lead count would look valid).
      invalidateIndexes()
      if (legacyInbox) {
        // Pre-migration layout: the inbox came back inside the meta blob, so
        // it is already here and safe to write.
        state.inbox = legacyInbox
        supabase.setInboxPersistEnabled(true)
      } else {
        supabase.setInboxPersistEnabled(false)
        loadInboxInBackground()
      }
      writeFile()
      console.log(`[db] loaded state from Supabase (${remote.leads.length} leads)`)
      supabase.subscribeChanges({ onLeadChange: applyRemoteLeadChange, onMetaChange: applyRemoteMetaChange })
      return
    }
    console.log('[db] Supabase reachable but empty — will seed and persist on next save')
  } catch (e) {
    console.error('[db] Supabase load failed, using local JSON', e.message)
  }
  supabase.subscribeChanges({ onLeadChange: applyRemoteLeadChange, onMetaChange: applyRemoteMetaChange })
}

export function reset() {
  state = seed()
  invalidateIndexes()
  save()
  markAllDirty()
  return state
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function nowIso() {
  return new Date().toISOString()
}

// Test-only seam. The Realtime lookup indexes are the one piece of this module
// with a correctness claim that is worth asserting directly ("the index finds
// exactly the row the linear scan found"), and they are internal by design.
export const __testing = {
  setState: next => { state = next; invalidateIndexes() },
  leadIndexOf,
  findDuplicateIndexed,
  invalidateIndexes
}
