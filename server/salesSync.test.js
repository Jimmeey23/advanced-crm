// The sync layer decides WHICH months to ask Momence for. Getting that wrong
// is expensive in both directions: too eager and every page open rebuilds a
// report server-side, too lazy and the dashboard shows yesterday's numbers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSalesSync } from './salesSync.js'

const stubStore = () => {
  const months = new Map()
  const backfill = new Map()
  return {
    months,
    putMonth: (market, month, rows) => months.set(`${market}:${month}`, { rows, fetchedAt: new Date().toISOString() }),
    hasMonth: (market, month) => months.has(`${market}:${month}`),
    monthFetchedAt: (market, month) => months.get(`${market}:${month}`)?.fetchedAt || null,
    setBackfill: (market, patch) => backfill.set(market, { ...(backfill.get(market) || {}), ...patch }),
    backfill: market => backfill.get(market) || null,
    status: () => ({ months: months.size })
  }
}

// One row per month asked for, so a call log doubles as a row count.
const stubFetch = (perMonth = () => [{ id: 1 }]) => {
  const calls = []
  return {
    calls,
    fn: async (market, month) => { calls.push(`${market}:${month}`); return perMonth(market, month) }
  }
}

const sync = (over = {}) => {
  const store = over.store || stubStore()
  const fetcher = over.fetcher || stubFetch()
  return {
    store,
    fetcher,
    api: createSalesSync({
      store,
      fetchMonth: fetcher.fn,
      markets: over.markets || ['mumbai'],
      now: () => new Date('2026-08-15T09:00:00.000Z'),
      emptyMonthsToStop: over.emptyMonthsToStop ?? 3,
      wait: async () => {}
    })
  }
}

test('refreshCurrent fetches only the current month, per market', async () => {
  const { api, fetcher } = sync({ markets: ['mumbai', 'blr'] })
  await api.refreshCurrent()
  assert.deepEqual(fetcher.calls, ['mumbai:2026-08', 'blr:2026-08'])
})

test('refreshCurrent skips a market whose current month is still fresh', async () => {
  const { api, fetcher } = sync()
  await api.refreshCurrent()
  await api.refreshCurrent({ maxAgeMs: 60000 })
  assert.equal(fetcher.calls.length, 1)
})

test('a forced refresh ignores freshness', async () => {
  const { api, fetcher } = sync()
  await api.refreshCurrent()
  await api.refreshCurrent({ force: true })
  assert.equal(fetcher.calls.length, 2)
})

test('backfill walks months backwards until enough consecutive months are empty', async () => {
  // Sales exist in 2026-06 and 2026-07; everything older is empty.
  const fetcher = stubFetch((_, month) => (month >= '2026-06' ? [{ id: month }] : []))
  const { api, store } = sync({ fetcher })
  await api.backfill()
  // Current month, then back to 2026-03 -- three empty months in a row stops it.
  assert.deepEqual(fetcher.calls, [
    'mumbai:2026-08', 'mumbai:2026-07', 'mumbai:2026-06',
    'mumbai:2026-05', 'mumbai:2026-04', 'mumbai:2026-03'
  ])
  assert.equal(store.backfill('mumbai').done, true)
  assert.equal(store.backfill('mumbai').earliestMonth, '2026-06')
})

test('a completed backfill is not run again', async () => {
  const fetcher = stubFetch(() => [])
  const { api } = sync({ fetcher })
  await api.backfill()
  const first = fetcher.calls.length
  await api.backfill()
  assert.equal(fetcher.calls.length, first)
})

test('backfill resumes from where it stopped instead of restarting', async () => {
  const store = stubStore()
  const fetcher = stubFetch(() => [{ id: 1 }])
  // A previous run got as far back as 2026-06 and was interrupted.
  store.putMonth('mumbai', '2026-08', [])
  store.putMonth('mumbai', '2026-07', [])
  store.putMonth('mumbai', '2026-06', [])
  store.setBackfill('mumbai', { cursor: '2026-06', done: false })
  const { api } = sync({ store, fetcher })
  await api.backfill({ maxMonths: 2 })
  assert.deepEqual(fetcher.calls, ['mumbai:2026-05', 'mumbai:2026-04'])
})

test('backfill honours a per-run cap so a boot is never blocked on years of reports', async () => {
  const fetcher = stubFetch(() => [{ id: 1 }])
  const { api, store } = sync({ fetcher })
  await api.backfill({ maxMonths: 3 })
  assert.equal(fetcher.calls.length, 3)
  assert.equal(store.backfill('mumbai').done, false)
})

test('a month that fails does not mark the backfill done or advance past it', async () => {
  let failed = false
  const fetcher = {
    calls: [],
    fn: async (market, month) => {
      fetcher.calls.push(`${market}:${month}`)
      if (month === '2026-07' && !failed) { failed = true; throw new Error('Momence 500') }
      return [{ id: month }]
    }
  }
  const { api, store } = sync({ fetcher })
  await api.backfill({ maxMonths: 2 })
  assert.equal(store.backfill('mumbai').done, false)
  assert.equal(store.backfill('mumbai').cursor, '2026-08')
  assert.equal(store.backfill('mumbai').lastError, 'Momence 500')
})

test('only one sync runs at a time', async () => {
  const fetcher = stubFetch()
  const { api } = sync({ fetcher })
  await Promise.all([api.refreshCurrent(), api.refreshCurrent(), api.refreshCurrent()])
  assert.equal(fetcher.calls.length, 1)
})

test('progress reports what is left to do', async () => {
  const fetcher = stubFetch(() => [{ id: 1 }])
  const { api } = sync({ fetcher })
  assert.equal(api.progress().running, false)
  await api.backfill({ maxMonths: 1 })
  assert.equal(api.progress().backfill.mumbai.cursor, '2026-08')
})

test('markets can be resolved per run, so a newly configured one joins in', async () => {
  let configured = ['mumbai']
  const fetcher = stubFetch()
  const store = stubStore()
  const api = createSalesSync({
    store, fetchMonth: fetcher.fn, markets: () => configured,
    now: () => new Date('2026-08-15T09:00:00.000Z'), wait: async () => {}
  })
  await api.refreshCurrent()
  configured = ['mumbai', 'blr']
  await api.refreshCurrent({ force: true })
  assert.deepEqual(fetcher.calls, ['mumbai:2026-08', 'mumbai:2026-08', 'blr:2026-08'])
})
