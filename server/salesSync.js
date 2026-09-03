// Decides which months of the sales cache to (re)build from Momence.
//
// Two jobs, deliberately separate:
//
//  * refreshCurrent -- the only month that can still change materially is the
//    one in progress, so the recurring job re-pulls just that. A month that
//    was fetched minutes ago is left alone; a human pressing Refresh forces it.
//
//  * backfill -- walks months backwards from today until it hits a run of
//    empty months, which is how "all time" is discovered without anyone
//    configuring the studio's opening date. It is capped per run and stores a
//    cursor, so a restart resumes instead of starting the walk again.
//
// Every fetch is a report Momence builds server-side and we poll for, so both
// paths are strictly sequential with a pause between months.
import { currentMonthKey, previousMonthKey } from './salesRows.js'

const DEFAULT_EMPTY_MONTHS_TO_STOP = 12
const DEFAULT_MONTH_DELAY_MS = 500
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000

export function createSalesSync({
  store,
  fetchMonth,
  // Either a list or a function returning one, so a market configured after
  // boot joins the sync without a restart.
  markets: marketsInput = ['mumbai', 'blr'],
  now = () => new Date(),
  emptyMonthsToStop = DEFAULT_EMPTY_MONTHS_TO_STOP,
  monthDelayMs = DEFAULT_MONTH_DELAY_MS,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  // A report build is expensive and the two entry points (timer, page open,
  // button) can all fire at once. Whoever gets there first wins; the rest
  // await the same run rather than queueing a second one behind it.
  let running = null
  let lastRun = null
  const markets = () => (typeof marketsInput === 'function' ? marketsInput() : marketsInput)

  const exclusive = fn => {
    if (running) return running
    running = (async () => {
      try { return await fn() } finally { running = null }
    })()
    return running
  }

  async function pullMonth(market, month) {
    const rows = await fetchMonth(market, month)
    store.putMonth(market, month, rows)
    return rows.length
  }

  async function refreshCurrent({ force = false, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
    return exclusive(async () => {
      const month = currentMonthKey(now())
      const result = { month, markets: {} }
      for (const market of markets()) {
        const fetchedAt = store.monthFetchedAt(market, month)
        if (!force && fetchedAt && now().getTime() - new Date(fetchedAt).getTime() < maxAgeMs) {
          result.markets[market] = { skipped: 'fresh', fetchedAt }
          continue
        }
        try {
          result.markets[market] = { rows: await pullMonth(market, month) }
        } catch (e) {
          result.markets[market] = { error: e.message }
        }
        await wait(monthDelayMs)
      }
      lastRun = { at: now().toISOString(), kind: 'refresh', result }
      return result
    })
  }

  async function backfill({ maxMonths = 24, restart = false } = {}) {
    return exclusive(async () => {
      const result = { markets: {} }
      for (const market of markets()) {
        const state = restart ? null : store.backfill(market)
        if (state?.done) { result.markets[market] = { skipped: 'done' }; continue }

        // The cursor names the oldest month already pulled, so the walk starts
        // one step older than it. With no cursor, start at the current month.
        let month = state?.cursor ? previousMonthKey(state.cursor) : currentMonthKey(now())
        let emptyStreak = state?.emptyStreak || 0
        let earliestMonth = state?.earliestMonth || null
        let fetched = 0
        let done = false
        let lastError = null

        while (fetched < maxMonths) {
          let count
          try {
            count = await pullMonth(market, month)
          } catch (e) {
            // Leave the cursor where it was: the failed month has to be
            // re-attempted, and marking it done would put a hole in the cache
            // that nothing ever fills.
            lastError = e.message
            break
          }
          fetched += 1
          if (count > 0) {
            emptyStreak = 0
            earliestMonth = month
          } else {
            emptyStreak += 1
          }
          store.setBackfill(market, { cursor: month, emptyStreak, earliestMonth, done: false, lastError: null })
          if (emptyStreak >= emptyMonthsToStop) { done = true; break }
          month = previousMonthKey(month)
          await wait(monthDelayMs)
        }

        store.setBackfill(market, { done, lastError, earliestMonth, emptyStreak })
        result.markets[market] = { fetched, done, earliestMonth, lastError }
      }
      lastRun = { at: now().toISOString(), kind: 'backfill', result }
      return result
    })
  }

  return {
    refreshCurrent,
    backfill,
    progress() {
      const backfillState = {}
      for (const market of markets()) backfillState[market] = store.backfill(market) || { done: false, cursor: null }
      return { running: Boolean(running), lastRun, backfill: backfillState }
    }
  }
}
