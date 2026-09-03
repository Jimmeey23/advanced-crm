// Browser-side month cache for the sales dashboard, in IndexedDB.
//
// localStorage is the wrong tool here: a year of payment splits is tens of
// megabytes, well past its ~5MB ceiling, and writing it would block the main
// thread. IndexedDB holds it comfortably and survives reloads, so the second
// visit to the dashboard fetches only the month in progress.
//
// Every failure path degrades to "no cache": a private window, a browser with
// storage disabled, or a quota error must cost freshness, never the page.
const DB_NAME = 'p57-sales'
const DB_VERSION = 1
const STORE = 'months'

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'month' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch(() => null)
  return dbPromise
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const store = transaction.objectStore(STORE)
    const result = run(store)
    transaction.oncomplete = () => resolve(result?.result ?? result)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function cachedMonths() {
  const db = await openDb()
  if (!db) return []
  try {
    const keys = await tx(db, 'readonly', store => store.getAllKeys())
    return (keys || []).map(String)
  } catch { return [] }
}

export async function readMonths(months) {
  const db = await openDb()
  if (!db) return { rows: [], fetchedAt: {} }
  try {
    const entries = await Promise.all(months.map(month =>
      tx(db, 'readonly', store => store.get(month)).catch(() => null)))
    const rows = []
    const fetchedAt = {}
    for (const entry of entries) {
      if (!entry?.rows) continue
      rows.push(...entry.rows)
      fetchedAt[entry.month] = entry.fetchedAt
    }
    return { rows, fetchedAt }
  } catch { return { rows: [], fetchedAt: {} } }
}

export async function writeMonth(month, rows) {
  const db = await openDb()
  if (!db) return false
  try {
    await tx(db, 'readwrite', store => store.put({ month, rows, fetchedAt: Date.now() }))
    return true
  } catch {
    // Almost always a quota error. The dashboard still works — it just pays
    // for the fetch again next time.
    return false
  }
}

export async function clearCache() {
  const db = await openDb()
  if (!db) return
  try { await tx(db, 'readwrite', store => store.clear()) } catch { /* nothing to do */ }
}
