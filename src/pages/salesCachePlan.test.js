// Which months the browser still has to ask the server for. A closed month
// never changes, so once it is in IndexedDB it is never fetched again; the
// month in progress is the only one that is always re-fetched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { monthsInRange, planFetch, dedupeRows } from './salesCachePlan.js'

test('monthsInRange lists every month a range touches, oldest first', () => {
  assert.deepEqual(monthsInRange('2026-07-15', '2026-09-02'), ['2026-07', '2026-08', '2026-09'])
  assert.deepEqual(monthsInRange('2026-08-01', '2026-08-31'), ['2026-08'])
  assert.deepEqual(monthsInRange('2025-12-20', '2026-01-05'), ['2025-12', '2026-01'])
})

test('an open-ended range falls back to the coverage the server reports', () => {
  assert.deepEqual(
    monthsInRange('', '', { earliest: '2026-06', latest: '2026-08' }),
    ['2026-06', '2026-07', '2026-08']
  )
  assert.deepEqual(monthsInRange('', ''), [])
})

test('nothing cached means fetch everything', () => {
  const plan = planFetch({ months: ['2026-07', '2026-08'], cached: [], currentMonth: '2026-08' })
  assert.deepEqual(plan.fetch, ['2026-08', '2026-07'])
  assert.deepEqual(plan.reuse, [])
})

test('a cached closed month is reused, the live month is always re-fetched', () => {
  const plan = planFetch({ months: ['2026-07', '2026-08'], cached: ['2026-07', '2026-08'], currentMonth: '2026-08' })
  assert.deepEqual(plan.reuse, ['2026-07'])
  assert.deepEqual(plan.fetch, ['2026-08'])
})

test('a fully cached historical range needs no request at all', () => {
  const plan = planFetch({ months: ['2026-06', '2026-07'], cached: ['2026-06', '2026-07'], currentMonth: '2026-08' })
  assert.deepEqual(plan.fetch, [])
  assert.equal(plan.upToDate, true)
})

test('the live month can be reused too when it was fetched moments ago', () => {
  const plan = planFetch({
    months: ['2026-08'], cached: ['2026-08'], currentMonth: '2026-08',
    liveFetchedAt: Date.now() - 30000, maxLiveAgeMs: 120000
  })
  assert.deepEqual(plan.fetch, [])
  const stale = planFetch({
    months: ['2026-08'], cached: ['2026-08'], currentMonth: '2026-08',
    liveFetchedAt: Date.now() - 300000, maxLiveAgeMs: 120000
  })
  assert.deepEqual(stale.fetch, ['2026-08'])
})

test('a forced refresh re-fetches every month in the range', () => {
  const plan = planFetch({ months: ['2026-07', '2026-08'], cached: ['2026-07', '2026-08'], currentMonth: '2026-08', force: true })
  assert.deepEqual(plan.fetch, ['2026-08', '2026-07'])
})

test('fetches are ordered newest first, so the visible end of the table fills in first', () => {
  const plan = planFetch({ months: ['2026-01', '2026-02', '2026-03'], cached: [], currentMonth: '2026-08' })
  assert.deepEqual(plan.fetch, ['2026-03', '2026-02', '2026-01'])
})

test('a cached month is re-fetched once a batch of discount detail has landed', () => {
  const base = { months: ['2026-06'], cached: ['2026-06'], currentMonth: '2026-08', enrichmentThreshold: 200 }
  // 40 new transactions enriched since it was cached: not worth a refetch.
  assert.deepEqual(planFetch({ ...base, enrichedNow: 1040, enrichedByMonth: { '2026-06': 1000 } }).fetch, [])
  // 400 new: the month's rows are materially out of date.
  assert.deepEqual(planFetch({ ...base, enrichedNow: 1400, enrichedByMonth: { '2026-06': 1000 } }).fetch, ['2026-06'])
})

test('a month cached before enrichment counts were tracked is not treated as stale', () => {
  const plan = planFetch({ months: ['2026-06'], cached: ['2026-06'], currentMonth: '2026-08', enrichedNow: 5000, enrichedByMonth: {} })
  assert.deepEqual(plan.fetch, [])
})

test('dedupeRows keeps one row per id, preferring the later copy', () => {
  const rows = dedupeRows([
    { id: 'a', paidInCurrency: 100 },
    { id: 'b', paidInCurrency: 50 },
    { id: 'a', paidInCurrency: 120 }
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows.find(r => r.id === 'a').paidInCurrency, 120)
})

test('dedupeRows treats numeric and string ids as the same row', () => {
  assert.equal(dedupeRows([{ id: 1 }, { id: '1' }]).length, 1)
})

test('dedupeRows copes with nothing', () => {
  assert.deepEqual(dedupeRows(), [])
})
