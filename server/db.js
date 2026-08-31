import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seed } from './seed.js'
import * as supabase from './supabaseStore.js'
import { findDuplicateAmong } from './duplicateMatch.js'
import { DEFAULT_LEAD_SOURCES, DEFAULT_MARKETING_CHANNELS, DEFAULT_CLASS_TYPES, DEFAULT_FOLLOW_UP_CHANNELS, defaultChannelForSource, uniqueClean } from '../src/leadConfig.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')

let state = null
const dirty = new Set()
const deleted = new Set()
let lastLocalWriteAt = 0
let remoteChangeCb = null

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

export function markDirty(id) {
  if (id) dirty.add(id)
}

export function markDeleted(id) {
  if (id) { dirty.delete(id); deleted.add(id) }
}

export function markAllDirty() {
  for (const l of (state?.leads || [])) dirty.add(l.id)
}

export function getDirty() {
  return [...dirty]
}

export function getDeleted() {
  return [...deleted]
}

function writeFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2))
}

export function load() {
  if (state) return state
  try {
    if (fs.existsSync(DB_FILE)) {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    } else {
      state = seed()
      writeFile()
    }
  } catch (err) {
    console.error('[db] failed to load, reseeding', err)
    state = seed()
    writeFile()
  }
  // An existing db.json predates a settings key added later — fill it in
  // rather than requiring a manual migration or crashing on the missing key.
  const taxonomyVersion = state.settings?.taxonomyVersion || 0
  ensureSettingsShape(state)
  if (taxonomyVersion !== state.settings.taxonomyVersion) writeFile()
  if (!state.ownerChangeRequests) state.ownerChangeRequests = []
  return state
}

let saveTimer = null
export function save() {
  if (!state) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { writeFile() } catch (e) { console.error('[db] local save failed', e.message) }
    syncSupabase()
  }, 150)
}

let syncTimer = null
function syncSupabase() {
  if (!supabase.isEnabled()) { dirty.clear(); deleted.clear(); return }
  clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    try {
      await supabase.persistState(state, getDirty(), getDeleted())
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
  writeFile()
  if (!supabase.isEnabled()) { dirty.clear(); deleted.clear(); return }
  await supabase.persistState(state, getDirty(), getDeleted())
  dirty.clear()
  deleted.clear()
  lastLocalWriteAt = Date.now()
}

export async function saveMetaNow() {
  if (!state) return
  clearTimeout(saveTimer)
  clearTimeout(syncTimer)
  writeFile()
  if (!supabase.isEnabled()) return
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
    try { writeFile() } catch (e) { console.error('[db] remote write failed', e.message) }
  }, 500)
}

// Fired when Supabase Realtime reports a change we didn't just make ourselves
// (e.g. a row edited directly in the Supabase dashboard, or by another server
// instance). Patches just the affected row/meta fields — a full reload would
// mean re-fetching every page of a large leads table on every single edit.
let remoteLeadChangeCount = 0
function applyRemoteLeadChange({ eventType, id, data }) {
  if (!state || !id) return
  const idx = state.leads.findIndex(l => l.id === id)
  if (idx !== -1) {
    // Known local row: this event can be an echo of our own recent write
    // reflected back through Realtime — skip it to avoid clobbering newer
    // local state with a stale echo. This suppression only makes sense for
    // a row we already have; it must NOT gate the unknown-id branch below,
    // or a genuine concurrent duplicate from another instance sails past
    // the dedup merge check just because we happened to write something
    // else in the last 2s.
    if (Date.now() - lastLocalWriteAt < 2000) return
    if (eventType === 'DELETE') state.leads.splice(idx, 1)
    else if (data) state.leads[idx] = data
  } else if (eventType !== 'DELETE' && data) {
    // An id we don't recognize locally usually means this row was created
    // by another server instance sharing this Supabase project. If it's
    // actually the same person as a lead we already have (another instance
    // raced the same email/phone past its own — necessarily local-only —
    // dedup check before either write reached us), merge into the
    // existing row instead of blindly appending a second one.
    const existing = findDuplicateAmong(state.leads, data)
    if (existing) {
      const existingIdx = state.leads.indexOf(existing)
      state.leads[existingIdx] = { ...existing, ...data, id: existing.id }
      console.log(`[db] merged remote duplicate lead ${data.id} into existing ${existing.id}`)
    } else {
      state.leads.push(data)
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

// Async bootstrap: pull the dataset from Supabase if configured.
// Must be awaited before the first load() so the remote state is used.
export async function init() {
  if (!supabase.isEnabled()) {
    console.log('[db] Supabase not configured — using local JSON storage')
    return
  }
  try {
    const remote = await supabase.loadState()
    if (remote && remote.leads) {
      state = ensureSettingsShape(remote)
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
