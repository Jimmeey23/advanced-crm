// The total-sales report says nothing about discounts. The payment-transaction
// endpoint does, per sale item, so each transaction is fetched once and folded
// onto the rows it belongs to.
import test from 'node:test'
import assert from 'node:assert/strict'
import { transactionEnrichment, applyEnrichment, createEnricher } from './salesEnrich.js'

const txn = (over = {}) => ({
  id: 325676800,
  hostId: 13752,
  paymentStatus: 'succeeded',
  currency: 'inr',
  priceExcludingVatInCurrency: '1750',
  paidInCurrency: '1837.5',
  vatAmountInCurrency: '87.5',
  paymentProcessorFeeCoveredByCustomerInCurrency: '0',
  paymentProcessorFeeCoveredByHostInCurrency: '38.5',
  platformFeeCoveredByCustomerInCurrency: '0',
  platformFeeCoveredByHostInCurrency: '12',
  paidInMoneyCredits: '237.5',
  paidInEventCredits: '0',
  paymentSource: 'pos',
  purchaseType: 'membership',
  createdAt: '2026-08-01T12:40:04.093Z',
  metadata: { isApplePay: false, isGooglePay: true },
  failure: null,
  refunds: [],
  sales: [{
    id: 700,
    saleDate: '2026-08-01T12:40:04.093Z',
    items: [{
      id: 10,
      saleItemId: 311977750,
      itemType: 'membership',
      itemName: 'Studio Single Class',
      quantity: 2,
      unitPriceExcludingTaxInCurrency: '1000',
      unitTaxAmountInCurrency: '50',
      discountCode: {
        id: 5, discountCodeId: 91, priceRuleId: null, tuitionDiscountId: null,
        type: 'percentage', code: 'DIWALI20',
        unitDiscountExcludingTaxInCurrency: '200',
        unitDiscountTaxAmountInCurrency: '10'
      }
    }]
  }],
  transactionItems: [{
    id: 1, paymentMethod: 'stripe', paymentStatus: 'succeeded',
    usedMembership: { id: 7, hostId: 13752, name: 'Studio Credit Pack', type: 'package-money' },
    usedGiftCard: null,
    customPaymentMethod: null
  }],
  ...over
})

test('discount is summed over the quantity charged', () => {
  const enrichment = transactionEnrichment(txn())
  const item = enrichment.bySaleItem['311977750']
  assert.equal(item.discountCode, 'DIWALI20')
  assert.equal(item.discountType, 'percentage')
  // 2 × (200 + 10)
  assert.equal(item.discountAmount, 420)
  assert.equal(item.discountAmountExcludingTax, 400)
  assert.equal(item.discountCodeId, 91)
  assert.equal(item.grossBeforeDiscount, 2520)
})

test('an item with no discount records a zero, not a gap', () => {
  const bare = txn()
  bare.sales[0].items[0].discountCode = null
  const item = transactionEnrichment(bare).bySaleItem['311977750']
  assert.equal(item.discountCode, null)
  assert.equal(item.discountAmount, 0)
})

test('transaction-level facts are captured once', () => {
  const { transaction } = transactionEnrichment(txn())
  assert.equal(transaction.paymentSource, 'pos')
  assert.equal(transaction.purchaseType, 'membership')
  assert.equal(transaction.processorFeeHost, 38.5)
  assert.equal(transaction.platformFeeHost, 12)
  assert.equal(transaction.paidInEventCredits, 0)
  assert.equal(transaction.isGooglePay, true)
  assert.equal(transaction.isApplePay, false)
  assert.equal(transaction.usedMembershipName, 'Studio Credit Pack')
  assert.equal(transaction.usedMembershipType, 'package-money')
  assert.equal(transaction.failureReason, null)
})

test('refunds are totalled and dated', () => {
  const { transaction } = transactionEnrichment(txn({
    refunds: [
      { id: 1, currency: 'inr', paymentMethod: 'stripe', refundedInCurrency: '500', refundedInMoneyCredits: '0', refundedInEventCredits: '0', createdAt: '2026-08-05T00:00:00.000Z' },
      { id: 2, currency: 'inr', paymentMethod: 'stripe', refundedInCurrency: '250.5', refundedInMoneyCredits: '10', refundedInEventCredits: '0', createdAt: '2026-08-09T00:00:00.000Z' }
    ]
  }))
  assert.equal(transaction.refundedInCurrency, 750.5)
  assert.equal(transaction.refundedInMoneyCredits, 10)
  assert.equal(transaction.refundCount, 2)
  assert.equal(transaction.lastRefundAt, '2026-08-09T00:00:00.000Z')
})

test('a gift card or custom method is named', () => {
  const { transaction } = transactionEnrichment(txn({
    transactionItems: [{ id: 1, paymentMethod: 'gift-card', usedGiftCard: { id: 3, code: 'GC-123' }, customPaymentMethod: 'Corporate account' }]
  }))
  assert.equal(transaction.usedGiftCardCode, 'GC-123')
  assert.equal(transaction.customPaymentMethod, 'Corporate account')
})

// --- applying to rows -------------------------------------------------------

const row = (over = {}) => ({
  id: 1, paymentTransactionId: 325676800, saleItemId: 311977750,
  paidInCurrency: 1000, isPrimarySplit: true, ...over
})

test('enrichment lands on the matching sale item', () => {
  const enrichment = { 325676800: transactionEnrichment(txn()) }
  const [enriched] = applyEnrichment([row()], enrichment)
  assert.equal(enriched.discountCode, 'DIWALI20')
  assert.equal(enriched.discountAmount, 420)
  assert.equal(enriched.paymentSource, 'pos')
  assert.equal(enriched.enriched, true)
})

test('a discount is not multiplied across the splits of one sale', () => {
  const enrichment = { 325676800: transactionEnrichment(txn()) }
  const rows = applyEnrichment([row({ id: 1 }), row({ id: 2, isPrimarySplit: false })], enrichment)
  assert.equal(rows[0].discountAmount, 420)
  // The secondary split still shows the code (it is the same sale) but banks
  // no money, exactly as it does for the sale's own value.
  assert.equal(rows[1].discountCode, 'DIWALI20')
  assert.equal(rows[1].discountAmount, 0)
})

test('rows without enrichment pass through untouched and flagged', () => {
  const [untouched] = applyEnrichment([row()], {})
  assert.equal(untouched.enriched, false)
  assert.equal(untouched.discountAmount, 0)
  assert.equal(untouched.discountCode, null)
})

// --- the fetch loop ---------------------------------------------------------

const stubStore = () => {
  const map = new Map()
  return {
    map,
    getTransaction: id => map.get(String(id)) || null,
    putTransactions: entries => { for (const [id, value] of Object.entries(entries)) map.set(String(id), value) }
  }
}

test('each transaction is fetched once, and never re-fetched', async () => {
  const store = stubStore()
  const calls = []
  const enricher = createEnricher({
    store,
    fetchTransaction: async (market, id) => { calls.push(id); return txn({ id }) },
    concurrency: 2,
    wait: async () => {}
  })
  await enricher.enrich([{ paymentTransactionId: 1, market: 'mumbai' }, { paymentTransactionId: 1, market: 'mumbai' }, { paymentTransactionId: 2, market: 'mumbai' }])
  assert.deepEqual(calls.sort(), [1, 2])
  await enricher.enrich([{ paymentTransactionId: 1, market: 'mumbai' }])
  assert.equal(calls.length, 2)
})

test('one failed transaction does not abort the batch', async () => {
  const store = stubStore()
  const enricher = createEnricher({
    store,
    fetchTransaction: async (market, id) => { if (id === 2) throw new Error('Momence 404'); return txn({ id }) },
    concurrency: 1,
    wait: async () => {}
  })
  const result = await enricher.enrich([1, 2, 3].map(id => ({ paymentTransactionId: id, market: 'mumbai' })))
  assert.equal(result.fetched, 2)
  assert.equal(result.failed, 1)
  assert.equal(store.map.size, 2)
})

test('a batch is capped so one click cannot fetch ten thousand transactions', async () => {
  const store = stubStore()
  const enricher = createEnricher({
    store,
    fetchTransaction: async (market, id) => txn({ id }),
    concurrency: 2,
    wait: async () => {}
  })
  const rows = Array.from({ length: 50 }, (_, index) => ({ paymentTransactionId: index + 1, market: 'mumbai' }))
  const result = await enricher.enrich(rows, { limit: 10 })
  assert.equal(result.fetched, 10)
  assert.equal(result.remaining, 40)
})

test('a fetched transaction that does not carry this sale item still yields defined discount fields', () => {
  const enrichment = { 325676800: transactionEnrichment(txn()) }
  const [enriched] = applyEnrichment([row({ saleItemId: 999999 })], enrichment)
  assert.equal(enriched.enriched, true)
  assert.equal(enriched.discountCode, null)
  assert.equal(enriched.discountAmount, 0)
  // Transaction-level detail is still useful on such a row.
  assert.equal(enriched.paymentSource, 'pos')
})
