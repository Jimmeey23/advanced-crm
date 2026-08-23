// Supabase storage layer.
// Keeps the in-memory db as the source of truth at runtime and mirrors it to
// Supabase: a single "app_state" row holds the config/metadata tables, and a
// "leads" table holds one row per lead. Only dirty leads are re-upserted on
// each persist, so large imports stay efficient.
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

// Node 20 has no native global WebSocket; supabase-js's realtime client
// requires one to exist just to construct, even though we never use realtime.
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket

const LEADS_TABLE = 'leads'
const META_TABLE = 'app_state'
const META_KEY = 'app'
const DELETE_BATCH_SIZE = 50
const UPSERT_BATCH_SIZE = 500

let client = null

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
    version: meta.version || 2,
    seededAt: meta.seededAt || new Date().toISOString(),
    settings: meta.settings,
    locations: meta.locations || [],
    associates: meta.associates || [],
    stages: meta.stages || [],
    sources: meta.sources || [],
    channels: meta.channels || [],
    classTypes: meta.classTypes || [],
    leads,
    activity: meta.activity || [],
    importHistory: meta.importHistory || [],
    webhookIntegrations: meta.webhookIntegrations || [],
    webhookLogs: meta.webhookLogs || [],
    sheetSyncLogs: meta.sheetSyncLogs || []
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
      for (const id of batch) {
        const single = await c.from(LEADS_TABLE).delete().eq('id', id)
        if (single.error) throw new Error(`supabase delete lead ${id}: ${single.error.message}`)
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
    sheetSyncLogs: state.sheetSyncLogs
  }
  const { error: metaErr } = await c.from(META_TABLE).upsert({ key: META_KEY, data: meta, updated_at: new Date().toISOString() })
  if (metaErr) throw new Error(`supabase persist meta: ${metaErr.message}`)

  const ids = uniqueIds(dirtyLeadIds)
  if (ids.length) {
    const now = new Date().toISOString()
    const rows = []
    for (const id of ids) {
      const lead = state.leads.find(l => l.id === id)
      if (lead) rows.push({ id: lead.id, data: lead, updated_at: now })
    }
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
      const { error } = await c.from(LEADS_TABLE).upsert(batch)
      if (error) throw new Error(`supabase persist leads: ${error.message}`)
    }
  }
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
