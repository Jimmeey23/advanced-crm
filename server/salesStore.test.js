// The sales cache is a month-keyed snapshot on disk, kept out of db.json
// (which is already 60MB+ and mirrored to Supabase). These cover the parts
// that decide whether the dashboard shows the truth: merging a re-fetched
// month, the range query, and the backfill bookkeeping.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSalesStore } from './salesStore.js'

const tmpStore = () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sales-')), 'salesCache.json')
  return { store: createSalesStore({ file }), file }
}

const row = (over = {}) => ({
  id: 1, market: 'mumbai', month: '2026-08',
  paymentDate: '2026-08-10T06:00:00.000Z',
  paidInCurrency: 100, splitPaidInMoneyCredits: 0,
  paymentValue: 100, isPrimarySplit: true,
  paymentCategory: 'membership', location: 'Kwality House, Kemps Corner',
  ...over
})

test('a written month reads back', () => {
  const { store } = tmpStore()
  store.putMonth('mumbai', '2026-08', [row()])
  assert.equal(store.rowsInRange({ from: '2026-08-01', to: '2026-08-31' }).length, 1)
  assert.equal(store.status().months, 1)
})

test('re-fetching a month replaces it rather than appending', () => {
  const { store } = tmpStore()
  store.putMonth('mumbai', '2026-08', [row(), row({ id: 2 })])
  // Momence now reports the second sale as refunded and drops the third.
  store.putMonth('mumbai', '2026-08', [row(), row({ id: 2, refunded: 100 })])
  const rows = store.rowsInRange({ from: '2026-08-01', to: '2026-08-31' })
  assert.equal(rows.length, 2)
  assert.equal(rows.find(r => r.id === 2).refunded, 100)
})

test('markets are stored separately and can be queried apart', () => {
  const { store } = tmpStore()
  store.putMonth('mumbai', '2026-08', [row()])
  store.putMonth('blr', '2026-08', [row({ id: 9, market: 'blr' })])
  assert.equal(store.rowsInRange({ from: '2026-08-01', to: '2026-08-31' }).length, 2)
  assert.equal(store.rowsInRange({ from: '2026-08-01', to: '2026-08-31', market: 'blr' })[0].id, 9)
})

test('the range query is inclusive of both ends and spans months', () => {
  const { store } = tmpStore()
  store.putMonth('mumbai', '2026-07', [row({ id: 1, month: '2026-07', paymentDate: '2026-07-31T12:00:00.000Z' })])
  store.putMonth('mumbai', '2026-08', [
    row({ id: 2, paymentDate: '2026-08-01T04:00:00.000Z' }),
    row({ id: 3, paymentDate: '2026-08-31T12:00:00.000Z' })
  ])
  assert.deepEqual(store.rowsInRange({ from: '2026-07-31', to: '2026-08-01' }).map(r => r.id), [2, 1])
  assert.equal(store.rowsInRange({ from: '2026-08-01', to: '2026-08-31' }).length, 2)
})

test('rows come back newest first', () => {
  const { store } = tmpStore()
  store.putMonth('mumbai', '2026-08', [
    row({ id: 1, paymentDate: '2026-08-02T00:00:00.000Z' }),
    row({ id: 2, paymentDate: '2026-08-20T00:00:00.000Z' })
  ])
  assert.deepEqual(store.rowsInRange({ from: '2026-08-01', to: '2026-08-31' }).map(r => r.id), [2, 1])
})

test('an empty month is recorded, so the backfill does not re-fetch it forever', () => {
  const { store } = tmpStore()
  store.putMonth('mumbai', '2019-04', [])
  assert.equal(store.hasMonth('mumbai', '2019-04'), true)
  assert.equal(store.hasMonth('mumbai', '2019-03'), false)
})

test('backfill progress survives a reload', () => {
  const { store, file } = tmpStore()
  store.putMonth('mumbai', '2026-08', [row()])
  store.setBackfill('mumbai', { earliestMonth: '2019-04', done: true })
  store.flush()

  const reopened = createSalesStore({ file })
  assert.equal(reopened.status().backfill.mumbai.done, true)
  assert.equal(reopened.status().backfill.mumbai.earliestMonth, '2019-04')
  assert.equal(reopened.rowsInRange({ from: '2026-08-01', to: '2026-08-31' }).length, 1)
})

test('a missing or corrupt snapshot file starts empty instead of throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-'))
  const file = path.join(dir, 'salesCache.json')
  assert.equal(createSalesStore({ file }).status().months, 0)
  fs.writeFileSync(file, '{ not json')
  assert.equal(createSalesStore({ file }).status().months, 0)
})

test('status reports coverage and freshness per market', () => {
  const { store } = tmpStore()
  store.putMonth('mumbai', '2026-07', [row({ month: '2026-07' })])
  store.putMonth('mumbai', '2026-08', [row({ id: 2 })])
  const status = store.status()
  assert.equal(status.rows, 2)
  assert.equal(status.markets.mumbai.months, 2)
  assert.equal(status.markets.mumbai.earliestMonth, '2026-07')
  assert.equal(status.markets.mumbai.latestMonth, '2026-08')
  assert.ok(status.markets.mumbai.fetchedAt)
})

test('transaction enrichment is stored, deduped and survives a reload', () => {
  const { store, file } = tmpStore()
  store.putTransactions({ 900: { transaction: { paymentSource: 'pos' }, bySaleItem: {} } })
  assert.equal(store.getTransaction(900).transaction.paymentSource, 'pos')
  assert.equal(store.getTransaction('900').transaction.paymentSource, 'pos')
  assert.equal(store.transactionCount(), 1)
  assert.deepEqual(Object.keys(store.transactionsFor([{ paymentTransactionId: 900 }, { paymentTransactionId: 901 }])), ['900'])
  store.flush()
  assert.equal(createSalesStore({ file }).getTransaction(900).transaction.paymentSource, 'pos')
})
