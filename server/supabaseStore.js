// Supabase storage layer.
// Keeps the in-memory db as the source of truth at runtime and mirrors it to
// Supabase: app_state stores the full app snapshot plus a compact settings
// overlay, while "leads" holds one row per lead. The overlay lets settings
// saves avoid rewriting large runtime caches such as the messaging inbox.
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { normalizeEmail, normalizePhone } from './duplicateMatch.js'

// Node 20 has no native global WebSocket; supabase-js's realtime client
// requires one to exist just to construct, even though we never use realtime.
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket

const LEADS_TABLE = 'leads'
const META_TABLE = 'app_state'
const META_KEY = 'app'
const SETTINGS_META_KEY = 'settings'
const DELETE_BATCH_SIZE = 50
const UPSERT_BATCH_SIZE = 500

let client = null
let supportsNormalizedLeadColumns = true

function isMissingNormalizedLeadColumn(error) {
  const message = String(error?.message || '')
  return error?.code === 'PGRST204' && (message.includes("'email_norm'") || message.includes("'phone_norm'"))
}

function withoutNormalizedLeadColumns(rows) {
  return rows.map(({ email_norm, phone_norm, ...row }) => row)
}

export function isEnabled() {
  const url = (process.env.USER_SUPABASE_URL || '').trim()
  const key = (process.env.USER_SUPABASE_ANON_KEY || '').trim()
  return Boolean(url && key)
}

function getClient() {
  if (!isEnabled()) return null
  if (!client) {
    // Trim here too — isEnabled() only checks the trimmed value, so a
    // trailing newline/space from a copy-pasted env var (common) would
    // otherwise reach createClient() raw and corrupt every request URL.
    const url = process.env.USER_SUPABASE_URL.trim()
    const key = process.env.USER_SUPABASE_ANON_KEY.trim()
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }
  return client
}

export async function loadState() {
  const c = getClient()
  if (!c) return null

  const metaRes = await c.from(META_TABLE).select('data').eq('key', META_KEY).maybeSingle()
  if (metaRes.error) throw new Error(`supabase load meta: ${metaRes.error.message}`)
  const meta = metaRes.data?.data || null
  if (!meta || !meta.settings) return null
  const settingsRes = await c.from(META_TABLE).select('data').eq('key', SETTINGS_META_KEY).maybeSingle()
  if (settingsRes.error) throw new Error(`supabase load settings: ${settingsRes.error.message}`)
  const settingsMeta = settingsRes.data?.data || {}
  const persisted = { ...meta, ...settingsMeta }

  const leads = []
  let from = 0
  for (;;) {
    const { data, error } = await c.from(LEADS_TABLE).select('data').range(from, from + 999)
    if (error) throw new Error(`supabase load leads: ${error.message}`)
    if (!data || data.length === 0) break
    leads.push(...data.map(r => r.data))
    from += 1000
    if (data.length < 1000) break
  }

  return {
    version: persisted.version || 2,
    seededAt: persisted.seededAt || new Date().toISOString(),
    settings: persisted.settings,
    locations: persisted.locations || [],
    associates: persisted.associates || [],
    stages: persisted.stages || [],
    sources: persisted.sources || [],
    channels: persisted.channels || [],
    classTypes: persisted.classTypes || [],
    leads,
    activity: persisted.activity || [],
    importHistory: persisted.importHistory || [],
    webhookIntegrations: persisted.webhookIntegrations || [],
    webhookLogs: persisted.webhookLogs || [],
    sheetSyncLogs: persisted.sheetSyncLogs || [],
    inbox: meta.inbox || { messages: [], conversations: {} }
  }
}

export async function persistState(state, dirtyLeadIds = [], deletedLeadIds = []) {
  const c = getClient()
  if (!c) return

  const idsToDelete = uniqueIds(deletedLeadIds)
  for (let i = 0; i < idsToDelete.length; i += DELETE_BATCH_SIZE) {
    const batch = idsToDelete.slice(i, i + DELETE_BATCH_SIZE)
    const { error } = await c.from(LEADS_TABLE).delete().in('id', batch)
    if (error) {
      // PostgREST encodes `in.(...)` into the URL. If an old local queue is
      // large or contains an awkward imported id, Supabase can reject the path
      // before the request reaches the table. Retrying one id at a time keeps
      // the sync moving and preserves the exact failing id in the error.
      // A single unresolvable id (bad characters, already gone) must not
      // throw here — this delete step runs before the settings/leads
      // upsert below, so throwing would silently block every future sync
      // (including unrelated settings saves) until the process restarts.
      // Log and move on instead.
      for (const id of batch) {
        const single = await c.from(LEADS_TABLE).delete().eq('id', id)
        if (single.error) console.error(`[supabase] could not delete lead ${id}: ${single.error.message} — skipping`)
      }
    }
  }

  const meta = {
    version: state.version,
    seededAt: state.seededAt,
    settings: state.settings,
    locations: state.locations,
    associates: state.associates,
    stages: state.stages,
    sources: state.sources,
    channels: state.channels,
    classTypes: state.classTypes,
    activity: state.activity,
    importHistory: state.importHistory,
    webhookIntegrations: state.webhookIntegrations,
    webhookLogs: state.webhookLogs,
    sheetSyncLogs: state.sheetSyncLogs,
    inbox: state.inbox
  }
  const { error: metaErr } = await c.from(META_TABLE).upsert({ key: META_KEY, data: meta, updated_at: new Date().toISOString() })
  if (metaErr) throw new Error(`supabase persist meta: ${metaErr.message}`)

  const ids = uniqueIds(dirtyLeadIds)
  if (ids.length) {
    const now = new Date().toISOString()
    const rows = []
    for (const id of ids) {
      const lead = state.leads.find(l => l.id === id)
      if (lead) rows.push({
        id: lead.id,
        data: lead,
        updated_at: now,
        email_norm: normalizeEmail(lead.email),
        phone_norm: normalizePhone(lead.phone)
      })
    }
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
      let { error } = await c.from(LEADS_TABLE).upsert(
        supportsNormalizedLeadColumns ? batch : withoutNormalizedLeadColumns(batch)
      )
      if (isMissingNormalizedLeadColumn(error)) {
        supportsNormalizedLeadColumns = false
        console.warn('[supabase] leads table uses the legacy schema; persisting lead JSON without normalized columns until server/sql/migrations/20260825_add_lead_normalized_columns.sql is applied')
        const retry = await c.from(LEADS_TABLE).upsert(withoutNormalizedLeadColumns(batch))
        error = retry.error
      }
      if (error) {
        // 23505 = unique_violation on email_norm/phone_norm — another
        // instance already persisted a lead with this email/phone under a
        // different id (the exact race this constraint exists to catch).
        // Retry one row at a time so a single genuine duplicate doesn't
        // block every other dirty lead in the batch from saving.
        if (error.code === '23505' && batch.length > 1) {
          for (const row of batch) {
            const single = await c.from(LEADS_TABLE).upsert(
              supportsNormalizedLeadColumns ? [row] : withoutNormalizedLeadColumns([row])
            )
            if (single.error) {
              if (single.error.code === '23505') {
                console.error(`[supabase] lead ${row.id} not saved — email/phone already belongs to another lead row (likely a second server instance racing this create): ${single.error.message}`)
              } else {
                throw new Error(`supabase persist leads: ${single.error.message}`)
              }
            }
          }
        } else if (error.code === '23505') {
          console.error(`[supabase] lead ${batch[0].id} not saved — email/phone already belongs to another lead row (likely a second server instance racing this create): ${error.message}`)
        } else {
          throw new Error(`supabase persist leads: ${error.message}`)
        }
      }
    }
  }
}

export async function persistMetaState(state) {
  const c = getClient()
  if (!c) return
  const settingsMeta = {
    version: state.version,
    seededAt: state.seededAt,
    settings: state.settings,
    locations: state.locations,
    associates: state.associates,
    stages: state.stages,
    sources: state.sources,
    channels: state.channels,
    classTypes: state.classTypes,
    activity: state.activity,
    importHistory: state.importHistory,
    webhookIntegrations: state.webhookIntegrations,
    webhookLogs: state.webhookLogs,
    sheetSyncLogs: state.sheetSyncLogs
  }
  const { error } = await c.from(META_TABLE).upsert({ key: SETTINGS_META_KEY, data: settingsMeta, updated_at: new Date().toISOString() })
  if (error) throw new Error(`supabase persist meta: ${error.message}`)
}

const SYNC_LOCK_KEY = 'sheet_sync_lock'
// A sync running long enough to be considered abandoned (crashed process,
// killed deploy) rather than just slow — past this, a new attempt is
// allowed to steal the lock instead of being blocked forever.
const SYNC_LOCK_STALE_MS = 60 * 60 * 1000

// Atomic cross-instance lock for the Google Sheets sync, backed by the
// unique constraint on app_state.key: Postgres itself rejects the insert if
// a lock row already exists, so two instances racing this at the same
// instant can't both "win" the way two `syncInFlight` booleans (one per
// process) could — see the runSync comment in googleSheets.js for the
// duplicate-import scenario this closes. ownerId identifies the instance
// that holds it, purely for the log line if a stale lock gets stolen.
export async function acquireSyncLock(ownerId) {
  const c = getClient()
  if (!c) return true // no Supabase configured — single-instance assumption holds, in-process lock is enough
  const now = new Date().toISOString()
  const { error } = await c.from(META_TABLE).insert({ key: SYNC_LOCK_KEY, data: { ownerId, acquiredAt: now }, updated_at: now })
  if (!error) return true
  if (error.code !== '23505') throw new Error(`supabase acquire sync lock: ${error.message}`)

  // Row already exists — see whether it's stale enough to steal.
  const { data: existing, error: readErr } = await c.from(META_TABLE).select('data').eq('key', SYNC_LOCK_KEY).maybeSingle()
  if (readErr) throw new Error(`supabase read sync lock: ${readErr.message}`)
  const acquiredAt = existing?.data?.acquiredAt ? new Date(existing.data.acquiredAt).getTime() : 0
  if (Date.now() - acquiredAt < SYNC_LOCK_STALE_MS) return false

  console.log(`[supabase] stealing stale sheet sync lock held by ${existing?.data?.ownerId || 'unknown'} since ${existing?.data?.acquiredAt}`)
  const { error: updateErr } = await c.from(META_TABLE).update({ data: { ownerId, acquiredAt: now }, updated_at: now }).eq('key', SYNC_LOCK_KEY)
  if (updateErr) throw new Error(`supabase steal sync lock: ${updateErr.message}`)
  return true
}

export async function releaseSyncLock() {
  const c = getClient()
  if (!c) return
  const { error } = await c.from(META_TABLE).delete().eq('key', SYNC_LOCK_KEY)
  if (error) console.error('[supabase] release sync lock failed', error.message)
}

function uniqueIds(ids) {
  return [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))]
}

// Subscribes to Postgres changes on both tables and calls `onChange` (debounced)
// whenever a row is inserted/updated/deleted directly in Supabase — e.g. by
// someone editing the table in the Supabase dashboard, or another server
// instance. Requires the tables to be added to the `supabase_realtime`
// publication (see server/sql/schema.sql).
let realtimeChannel = null
// onLeadChange({ eventType, id, data }) and onMetaChange({ eventType, data }) let the
// caller patch just the affected row instead of reloading the entire dataset —
// important once the leads table has thousands of rows.
export function subscribeChanges({ onLeadChange, onMetaChange }) {
  const c = getClient()
  if (!c || realtimeChannel) return
  realtimeChannel = c.channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: LEADS_TABLE }, (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new
      onLeadChange({ eventType: payload.eventType, id: row?.id, data: row?.data })
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: META_TABLE }, (payload) => {
      onMetaChange({ eventType: payload.eventType, data: payload.new?.data })
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('[supabase] realtime subscription active')
    })
}

export function describe() {
  return {
    enabled: isEnabled(),
    url: process.env.USER_SUPABASE_URL ? new URL(process.env.USER_SUPABASE_URL).host : null,
    tables: { leads: LEADS_TABLE, meta: META_TABLE }
  }
}
