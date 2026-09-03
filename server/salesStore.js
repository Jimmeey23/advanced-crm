// On-disk cache of Momence total-sales rows, keyed by market and calendar
// month.
//
// Deliberately NOT part of db.json: that file is already 60MB+, is loaded
// whole on every boot and is mirrored row-by-row to Supabase. Years of sales
// splits belong in their own snapshot with its own write cadence, the way the
// sheet snapshot does.
//
// The month is the unit of replacement. Momence can amend a month after the
// fact (a refund, a corrected payment method), so a re-fetch of a month
// overwrites it wholesale rather than merging row by row -- whatever the
// report says now IS that month.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'salesCache.json')
const VERSION = 1
const WRITE_DEBOUNCE_MS = 2000

export function createSalesStore({ file = DEFAULT_FILE } = {}) {
  let state = load(file)
  let writeTimer = null

  function schedule() {
    clearTimeout(writeTimer)
    writeTimer = setTimeout(flush, WRITE_DEBOUNCE_MS)
  }

  function flush() {
    clearTimeout(writeTimer)
    writeTimer = null
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      // Write-then-rename: a crash mid-write leaves the previous good snapshot
      // in place rather than a truncated file that reads as an empty cache.
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(state))
      fs.renameSync(tmp, file)
    } catch (e) {
      console.error('[sales] snapshot write failed:', e.message)
    }
  }

  const key = (market, month) => `${market}:${month}`

  return {
    putMonth(market, month, rows) {
      state.months[key(market, month)] = {
        market,
        month,
        rows: rows || [],
        fetchedAt: new Date().toISOString()
      }
      schedule()
    },

    hasMonth(market, month) {
      return Boolean(state.months[key(market, month)])
    },

    monthFetchedAt(market, month) {
      return state.months[key(market, month)]?.fetchedAt || null
    },

    // `from`/`to` are inclusive calendar dates (YYYY-MM-DD). Only the months
    // the range touches are scanned, which is what keeps a one-month view
    // cheap against an all-time cache.
    rowsInRange({ from, to, market } = {}) {
      const start = from ? new Date(`${String(from).slice(0, 10)}T00:00:00.000Z`).getTime() - IST_OFFSET_MS : -Infinity
      const end = to ? new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`).getTime() - IST_OFFSET_MS : Infinity
      const fromMonth = from ? String(from).slice(0, 7) : null
      const toMonth = to ? String(to).slice(0, 7) : null
      const out = []
      for (const entry of Object.values(state.months)) {
        if (market && entry.market !== market) continue
        // A month is skipped only when it lies wholly outside the range. The
        // month boundary is IST and the range is IST, so a one-month slack on
        // each side is not needed -- but rows are still date-filtered below,
        // because a range rarely starts on the 1st.
        if (fromMonth && entry.month < fromMonth) continue
        if (toMonth && entry.month > toMonth) continue
        for (const row of entry.rows) {
          const at = new Date(row.paymentDate).getTime()
          if (at >= start && at <= end) out.push(row)
        }
      }
      return out.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))
    },

    // Transaction detail (discounts, fees, refunds) fetched per transaction id
    // from /host/payment-transactions/{id}. Immutable once written.
    getTransaction(id) {
      return state.transactions[String(id)] || null
    },

    putTransactions(entries) {
      Object.assign(state.transactions, entries)
      schedule()
    },

    transactionCount() {
      return Object.keys(state.transactions).length
    },

    // The enrichment map for a set of rows, so applyEnrichment can fold it on.
    transactionsFor(rows) {
      const out = {}
      for (const row of rows || []) {
        const key = String(row.paymentTransactionId)
        if (out[key]) continue
        const entry = state.transactions[key]
        if (entry) out[key] = entry
      }
      return out
    },

    setBackfill(market, patch) {
      state.backfill[market] = { ...(state.backfill[market] || {}), ...patch, updatedAt: new Date().toISOString() }
      schedule()
    },

    backfill(market) {
      return state.backfill[market] || null
    },

    status() {
      const markets = {}
      let rows = 0
      for (const entry of Object.values(state.months)) {
        rows += entry.rows.length
        const bucket = markets[entry.market] = markets[entry.market] || {
          months: 0, rows: 0, earliestMonth: null, latestMonth: null, fetchedAt: null
        }
        bucket.months += 1
        bucket.rows += entry.rows.length
        if (!bucket.earliestMonth || entry.month < bucket.earliestMonth) bucket.earliestMonth = entry.month
        if (!bucket.latestMonth || entry.month > bucket.latestMonth) bucket.latestMonth = entry.month
        if (!bucket.fetchedAt || entry.fetchedAt > bucket.fetchedAt) bucket.fetchedAt = entry.fetchedAt
      }
      return {
        months: Object.keys(state.months).length,
        rows,
        enrichedTransactions: Object.keys(state.transactions).length,
        markets,
        backfill: state.backfill
      }
    },

    clear() {
      state = emptyState()
      schedule()
    },

    flush
  }
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

const emptyState = () => ({ version: VERSION, months: {}, backfill: {}, transactions: {} })

function load(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed?.version !== VERSION || !parsed.months) return emptyState()
    return { version: VERSION, months: parsed.months, backfill: parsed.backfill || {}, transactions: parsed.transactions || {} }
  } catch {
    // No file yet, or one written by an older/interrupted version. Rebuilding
    // from Momence is always possible, so an unreadable cache is not an error.
    return emptyState()
  }
}
