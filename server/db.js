import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seed } from './seed.js'
import * as supabase from './supabaseStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')

let state = null
const dirty = new Set()

export function markDirty(id) {
  if (id) dirty.add(id)
}

export function markAllDirty() {
  for (const l of (state?.leads || [])) dirty.add(l.id)
}

export function getDirty() {
  return [...dirty]
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
  if (!supabase.isEnabled()) { dirty.clear(); return }
  clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    try {
      await supabase.persistState(state, getDirty())
      dirty.clear()
    } catch (e) {
      console.error('[db] supabase persist failed', e.message)
    }
  }, 300)
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
      state = remote
      writeFile()
      console.log(`[db] loaded state from Supabase (${remote.leads.length} leads)`)
      return
    }
    console.log('[db] Supabase reachable but empty — will seed and persist on next save')
  } catch (e) {
    console.error('[db] Supabase load failed, using local JSON', e.message)
  }
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
