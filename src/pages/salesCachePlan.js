// What the dashboard still has to ask the server for.
//
// Sales history is immutable once a month closes: nobody edits a sale from
// two years ago. So the browser keeps whole months in IndexedDB and, on every
// later visit, asks only for what it does not already have plus the month
// currently in progress. A year of history costs one fetch, once, ever.

export function monthsInRange(from, to, coverage = null) {
  if (!from || !to) {
    if (!coverage?.earliest || !coverage?.latest) return []
    return monthsBetween(coverage.earliest, coverage.latest)
  }
  return monthsBetween(String(from).slice(0, 7), String(to).slice(0, 7))
}

function monthsBetween(first, last) {
  if (!first || !last || first > last) return []
  const months = []
  let [year, month] = first.split('-').map(Number)
  for (let guard = 0; guard < 600; guard += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}`
    months.push(key)
    if (key === last) break
    month += 1
    if (month === 13) { month = 1; year += 1 }
  }
  return months
}

const DEFAULT_MAX_LIVE_AGE_MS = 2 * 60 * 1000
// Discount detail arrives transaction by transaction in the background, so a
// month cached before that pass reached it holds rows with no discount on
// them. Re-fetching on every single new transaction would defeat the cache
// entirely, so a month is only considered stale once a meaningful batch has
// landed since it was stored.
const ENRICHMENT_STALE_THRESHOLD = 200

export function planFetch({
  months = [],
  cached = [],
  currentMonth,
  force = false,
  liveFetchedAt = null,
  maxLiveAgeMs = DEFAULT_MAX_LIVE_AGE_MS,
  // Server's transaction-detail count now, and the count each cached month was
  // stored with.
  enrichedNow = 0,
  enrichedByMonth = {},
  enrichmentThreshold = ENRICHMENT_STALE_THRESHOLD
} = {}) {
  const have = new Set(cached)
  const fetch = []
  const reuse = []
  for (const month of months) {
    if (force) { fetch.push(month); continue }
    if (!have.has(month)) { fetch.push(month); continue }
    // The live month is cached like any other, but it is only trusted for a
    // couple of minutes — a sale made while the tab was open must show up.
    const liveAndStale = month === currentMonth &&
      (!liveFetchedAt || Date.now() - liveFetchedAt >= maxLiveAgeMs)
    const enrichmentStale = enrichedNow - (enrichedByMonth[month] ?? enrichedNow) >= enrichmentThreshold
    if (liveAndStale || enrichmentStale) fetch.push(month)
    else reuse.push(month)
  }
  // Newest first: the table is sorted newest first, so the rows a person sees
  // immediately are the rows that arrive first.
  fetch.sort((a, b) => b.localeCompare(a))
  return { fetch, reuse, upToDate: fetch.length === 0 }
}

// Final guard, in the browser. Rows arrive from two places -- IndexedDB for
// closed months and the network for the live one -- and a sale made near a
// month boundary can legitimately be handed over by both. Identity is the row
// id (sale item + payment split); the later copy wins, since it came from the
// fresher fetch.
export function dedupeRows(rows) {
  const byId = new Map()
  for (const row of rows || []) byId.set(String(row.id), row)
  return [...byId.values()]
}
