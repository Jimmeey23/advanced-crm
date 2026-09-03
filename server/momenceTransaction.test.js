// A payment-transaction-succeeded webhook carries the whole cart. These cover
// flattening it into sale rows, summing LTV from only the qualifying lines,
// and caching those rows on the lead so the drawer stops re-fetching them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mapTransactionSales, recordLeadPurchase, cacheLeadSales, usableCachedSales } from './momence.js'

const db = () => ({
  locations: [{ id: 'loc1', name: 'Kwality House' }],
  settings: { momence: { marketsByLocation: {} } },
  leads: [{
    id: 'l1', fullName: 'Amy', locationId: 'loc1',
    createdAt: '2026-01-01T00:00:00.000Z',
    email: 'amy@example.com', memberId: '555'
  }]
})

const txn = (over = {}) => ({
  id: 900,
  createdAt: '2026-02-01T00:00:00.000Z',
  paymentStatus: 'succeeded',
  purchaseType: 'membership',
  paidInCurrency: '11800',
  payingMember: { id: 555, email: 'amy@example.com', firstName: 'Amy', lastName: 'B' },
  transactionItems: [{ id: 1, paymentMethod: 'stripe', paymentStatus: 'succeeded' }],
  sales: [{
    id: 700,
    saleDate: '2026-02-01T00:00:00.000Z',
    items: [{
      id: 10, saleItemId: 10, itemType: 'membership',
      itemName: 'Unlimited Monthly', descriptiveItemName: 'Unlimited Monthly',
      quantity: 1,
      unitPriceExcludingTaxInCurrency: '10000',
      unitTaxAmountInCurrency: '1800',
      discountCode: null
    }]
  }],
  ...over
})

// --- mapTransactionSales ----------------------------------------------------

test('maps one line item to a sale row', () => {
  const [row] = mapTransactionSales(txn())
  assert.equal(row.id, '700:10')
  assert.equal(row.saleDate, '2026-02-01T00:00:00.000Z')
  assert.equal(row.itemType, 'membership')
  assert.equal(row.itemName, 'Unlimited Monthly')
  assert.equal(row.totalInCurrency, '11800')
  assert.equal(row.paymentMethod, 'stripe')
})

test('quantity multiplies price and tax', () => {
  const t = txn()
  t.sales[0].items[0].quantity = 3
  assert.equal(mapTransactionSales(t)[0].totalInCurrency, '35400')
})

test('a discount code reduces the line total', () => {
  const t = txn()
  t.sales[0].items[0].discountCode = {
    id: 1, type: 'value', code: 'SAVE',
    unitDiscountExcludingTaxInCurrency: '1000',
    unitDiscountTaxAmountInCurrency: '180'
  }
  assert.equal(mapTransactionSales(t)[0].totalInCurrency, '10620')
})

test('every line of a multi-item cart becomes its own row', () => {
  const t = txn()
  t.sales[0].items.push({
    id: 11, saleItemId: 11, itemType: 'product', itemName: 'Grip Socks',
    quantity: 2, unitPriceExcludingTaxInCurrency: '500', unitTaxAmountInCurrency: '90'
  })
  const rows = mapTransactionSales(t)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.id), ['700:10', '700:11'])
  assert.equal(rows[1].totalInCurrency, '1180')
})

test('a transaction with no sales yields no rows', () => {
  assert.deepEqual(mapTransactionSales(txn({ sales: [] })), [])
  assert.deepEqual(mapTransactionSales(null), [])
})

// --- recordLeadPurchase, item-aware -----------------------------------------

test('LTV counts only the qualifying lines of a mixed cart', () => {
  const state = db()
  const t = txn()
  // 11800 membership + 1180 of product. Only the membership counts.
  t.sales[0].items.push({
    id: 11, saleItemId: 11, itemType: 'product', itemName: 'Grip Socks',
    quantity: 2, unitPriceExcludingTaxInCurrency: '500', unitTaxAmountInCurrency: '90'
  })
  const lead = recordLeadPurchase(state, {
    market: 'mumbai',
    memberId: t.payingMember.id,
    email: t.payingMember.email,
    purchaseDate: t.createdAt,
    purchaseType: t.purchaseType,
    items: mapTransactionSales(t)
  })
  assert.equal(lead.momenceEvidence.ltv, 11800)
  assert.equal(lead.momenceEvidence.firstPurchaseItemName, 'Unlimited Monthly')
  assert.equal(lead.momenceEvidence.membershipSold, true)
})

test('a cart with no qualifying line is not recorded at all', () => {
  const state = db()
  const t = txn({ purchaseType: 'product' })
  t.sales[0].items = [{
    id: 11, saleItemId: 11, itemType: 'product', itemName: 'Grip Socks',
    quantity: 1, unitPriceExcludingTaxInCurrency: '500', unitTaxAmountInCurrency: '90'
  }]
  const lead = recordLeadPurchase(state, {
    market: 'mumbai',
    memberId: 555,
    email: 'amy@example.com',
    purchaseDate: t.createdAt,
    purchaseType: 'product',
    items: mapTransactionSales(t)
  })
  assert.equal(lead, null)
  assert.equal(state.leads[0].momenceEvidence, undefined)
})

test('the newcomer 2-for-1 line is excluded but the rest of the cart still counts', () => {
  const state = db()
  const t = txn()
  t.sales[0].items.push({
    id: 12, saleItemId: 12, itemType: 'membership', itemName: 'Newcomer 2 for 1',
    quantity: 1, unitPriceExcludingTaxInCurrency: '2000', unitTaxAmountInCurrency: '0'
  })
  const lead = recordLeadPurchase(state, {
    market: 'mumbai', memberId: 555, email: 'amy@example.com',
    purchaseDate: t.createdAt, purchaseType: 'membership',
    items: mapTransactionSales(t)
  })
  assert.equal(lead.momenceEvidence.ltv, 11800)
})

test('the scalar amount path still works for events without line items', () => {
  const state = db()
  const lead = recordLeadPurchase(state, {
    market: 'mumbai', memberId: 555, email: 'amy@example.com',
    purchaseDate: '2026-02-01T00:00:00.000Z',
    itemName: 'Unlimited Monthly', amount: 5000, purchaseType: 'membership'
  })
  assert.equal(lead.momenceEvidence.ltv, 5000)
})

test('LTV accumulates across transactions', () => {
  const state = db()
  const args = {
    market: 'mumbai', memberId: 555, email: 'amy@example.com',
    purchaseType: 'membership'
  }
  recordLeadPurchase(state, { ...args, purchaseDate: '2026-02-01T00:00:00.000Z', items: mapTransactionSales(txn()) })
  recordLeadPurchase(state, { ...args, purchaseDate: '2026-03-01T00:00:00.000Z', items: mapTransactionSales(txn()) })
  assert.equal(state.leads[0].momenceEvidence.ltv, 23600)
  assert.equal(state.leads[0].momenceEvidence.firstPurchaseDate, '2026-02-01T00:00:00.000Z')
})

// --- cacheLeadSales ---------------------------------------------------------

test('caches rows on the lead, newest first', () => {
  const state = db()
  const lead = state.leads[0]
  cacheLeadSales(lead, mapTransactionSales(txn()))
  cacheLeadSales(lead, mapTransactionSales(txn({
    id: 901, createdAt: '2026-03-01T00:00:00.000Z',
    sales: [{ id: 701, saleDate: '2026-03-01T00:00:00.000Z', items: [{ id: 20, saleItemId: 20, itemType: 'membership', itemName: 'Renewal', quantity: 1, unitPriceExcludingTaxInCurrency: '10000', unitTaxAmountInCurrency: '1800' }] }]
  })))
  assert.deepEqual(lead.momenceSales.rows.map(r => r.id), ['701:20', '700:10'])
  assert.ok(lead.momenceSales.updatedAt)
})

test('a redelivered transaction does not duplicate cached rows', () => {
  const state = db()
  const lead = state.leads[0]
  cacheLeadSales(lead, mapTransactionSales(txn()))
  cacheLeadSales(lead, mapTransactionSales(txn()))
  assert.equal(lead.momenceSales.rows.length, 1)
})

test('the cache is capped', () => {
  const lead = db().leads[0]
  const rows = Array.from({ length: 250 }, (_, i) => ({
    id: `700:${i}`, saleDate: new Date(2026, 0, 1, 0, i).toISOString(),
    itemType: 'membership', itemName: 'M', totalInCurrency: '1', paymentMethod: 'stripe'
  }))
  cacheLeadSales(lead, rows)
  assert.equal(lead.momenceSales.rows.length, 200)
  // The newest survive.
  assert.equal(lead.momenceSales.rows[0].id, '700:249')
})

// --- usableCachedSales ------------------------------------------------------

test('cached rows are used when present', () => {
  const lead = db().leads[0]
  cacheLeadSales(lead, mapTransactionSales(txn()))
  assert.equal(usableCachedSales(lead)?.length, 1)
})

test('no cache, an empty cache, or a forced refresh falls through to a live fetch', () => {
  assert.equal(usableCachedSales(db().leads[0]), null)
  assert.equal(usableCachedSales(null), null)
  assert.equal(usableCachedSales({ momenceSales: { rows: [] } }), null)
  const lead = db().leads[0]
  cacheLeadSales(lead, mapTransactionSales(txn()))
  assert.equal(usableCachedSales(lead, { fresh: true }), null)
})
