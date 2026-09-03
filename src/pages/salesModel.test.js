// Aggregation over payment-split rows. The one rule everything here obeys:
// money comes from the split (splits partition a sale, so they sum to it),
// while anything that describes the SALE -- its count, its value, its refund,
// its customer -- is only read off the primary split, or a three-way payment
// would treble it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { salesKpis, groupSales, trendByDay, distinctValues, filterSales, GROUPINGS } from './salesModel.js'

const row = (over = {}) => ({
  id: 1,
  market: 'mumbai',
  month: '2026-08',
  paymentDate: '2026-08-10T06:00:00.000Z',
  memberId: 1,
  customerName: 'Amy',
  customerEmail: 'amy@example.com',
  paymentItem: 'Studio Single Class',
  paymentCategory: 'membership',
  membershipType: 'package-events',
  paymentMethod: 'UPI',
  splitPaymentMethod: 'UPI',
  paymentStatus: 'succeeded',
  soldBy: 'sheetal@physique57mumbai.com',
  location: 'Kwality House, Kemps Corner',
  paymentValue: 1000,
  paymentVat: 50,
  refunded: 0,
  paidInCurrency: 1000,
  splitPaidInMoneyCredits: 0,
  splitVatAmount: 50,
  isPrimarySplit: true,
  splitCount: 1,
  ...over
})

// One sale of 1000 paid 600 cash + 400 credits.
const splitSale = [
  row({ id: 10, paidInCurrency: 600, splitPaidInMoneyCredits: 0, splitPaymentMethod: 'cash', isPrimarySplit: true, splitCount: 2 }),
  row({ id: 11, paidInCurrency: 0, splitPaidInMoneyCredits: 400, splitPaymentMethod: 'membership', isPrimarySplit: false, splitCount: 2 })
]

test('kpis count a multi-split sale once', () => {
  const kpis = salesKpis(splitSale)
  assert.equal(kpis.transactions, 1)
  assert.equal(kpis.grossRevenue, 1000)
  assert.equal(kpis.paidInCurrency, 600)
  assert.equal(kpis.paidInMoneyCredits, 400)
  assert.equal(kpis.splits, 2)
})

test('kpis report averages, members and tax', () => {
  const kpis = salesKpis([
    row({ id: 1, memberId: 1, paymentValue: 1000, paidInCurrency: 1000 }),
    row({ id: 2, memberId: 2, paymentValue: 3000, paidInCurrency: 3000, paymentVat: 150, splitVatAmount: 150 }),
    row({ id: 3, memberId: 2, paymentValue: 2000, paidInCurrency: 2000, paymentVat: 100, splitVatAmount: 100 })
  ])
  assert.equal(kpis.transactions, 3)
  assert.equal(kpis.grossRevenue, 6000)
  assert.equal(kpis.uniqueMembers, 2)
  assert.equal(kpis.averageTransactionValue, 2000)
  assert.equal(kpis.averageRevenuePerMember, 3000)
  assert.equal(kpis.vat, 300)
})

test('refunds subtract from net revenue and are counted separately', () => {
  const kpis = salesKpis([
    row({ id: 1, paymentValue: 1000, paidInCurrency: 1000 }),
    row({ id: 2, paymentValue: 2000, paidInCurrency: 2000, refunded: 500 })
  ])
  assert.equal(kpis.grossRevenue, 3000)
  assert.equal(kpis.refunded, 500)
  assert.equal(kpis.netRevenue, 2500)
  assert.equal(kpis.refundedTransactions, 1)
})

test('a refund on a multi-split sale is counted once', () => {
  const refundedSplit = splitSale.map(r => ({ ...r, refunded: 1000 }))
  assert.equal(salesKpis(refundedSplit).refunded, 1000)
})

test('empty input gives zeroes, not NaN', () => {
  const kpis = salesKpis([])
  assert.equal(kpis.transactions, 0)
  assert.equal(kpis.averageTransactionValue, 0)
  assert.equal(kpis.averageRevenuePerMember, 0)
  assert.equal(kpis.netRevenue, 0)
})

// --- grouping ---------------------------------------------------------------

test('grouping by a sale field does not multiply a split sale', () => {
  const groups = groupSales(splitSale, 'paymentItem')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].transactions, 1)
  assert.equal(groups[0].grossRevenue, 1000)
})

test('grouping by payment method splits the money across the methods used', () => {
  const groups = groupSales(splitSale, 'splitPaymentMethod')
  assert.deepEqual(groups.map(g => g.key), ['cash', 'membership'])
  assert.equal(groups[0].paidInCurrency, 600)
  assert.equal(groups[1].paidInMoneyCredits, 400)
  // A sale counted under two methods still contributes one transaction to each,
  // because "how many sales used cash" is the question being asked.
  assert.equal(groups[0].transactions, 1)
  assert.equal(groups[1].transactions, 1)
})

test('groups come back biggest first and carry a share of the total', () => {
  const groups = groupSales([
    row({ id: 1, paymentItem: 'Small', paymentValue: 1000, paidInCurrency: 1000 }),
    row({ id: 2, paymentItem: 'Big', paymentValue: 3000, paidInCurrency: 3000 })
  ], 'paymentItem')
  assert.deepEqual(groups.map(g => g.key), ['Big', 'Small'])
  assert.equal(groups[0].share, 0.75)
})

test('a missing group value buckets as Unspecified', () => {
  assert.equal(groupSales([row({ soldBy: null })], 'soldBy')[0].key, 'Unspecified')
})

test('every advertised grouping produces groups', () => {
  for (const grouping of GROUPINGS) {
    const groups = groupSales([row()], grouping.field)
    assert.equal(groups.length, 1, `grouping ${grouping.field} produced nothing`)
  }
})

// --- trend ------------------------------------------------------------------

test('the trend buckets by IST day and fills gaps', () => {
  const points = trendByDay([
    row({ id: 1, paymentDate: '2026-08-01T06:00:00.000Z', paymentValue: 1000, paidInCurrency: 1000 }),
    row({ id: 2, paymentDate: '2026-08-03T06:00:00.000Z', paymentValue: 2000, paidInCurrency: 2000 })
  ])
  assert.deepEqual(points.map(p => p.date), ['2026-08-01', '2026-08-02', '2026-08-03'])
  assert.deepEqual(points.map(p => p.grossRevenue), [1000, 0, 2000])
})

test('a late-evening sale belongs to the IST day, not the UTC one', () => {
  const points = trendByDay([row({ paymentDate: '2026-08-01T19:00:00.000Z' })])
  assert.equal(points[0].date, '2026-08-02')
})

// --- filtering --------------------------------------------------------------

test('filters combine, and an empty filter matches everything', () => {
  const rows = [
    row({ id: 1, location: 'Kwality House, Kemps Corner', paymentCategory: 'membership' }),
    row({ id: 2, location: 'Kenkere House', paymentCategory: 'product', market: 'blr' })
  ]
  assert.equal(filterSales(rows, {}).length, 2)
  assert.equal(filterSales(rows, { location: ['Kenkere House'] })[0].id, 2)
  assert.equal(filterSales(rows, { market: ['mumbai'], paymentCategory: ['product'] }).length, 0)
})

test('search matches customer, item, email and reference', () => {
  const rows = [row({ id: 1, customerName: 'Amy Brown' }), row({ id: 2, customerName: 'Zed', paymentItem: 'Barre Unlimited' })]
  assert.equal(filterSales(rows, { search: 'amy' })[0].id, 1)
  assert.equal(filterSales(rows, { search: 'barre' })[0].id, 2)
  assert.equal(filterSales(rows, { search: 'nothing' }).length, 0)
})

test('distinctValues lists the options a filter can offer, sorted', () => {
  const rows = [row({ soldBy: 'b@x.com' }), row({ soldBy: 'a@x.com' }), row({ soldBy: 'a@x.com' })]
  assert.deepEqual(distinctValues(rows, 'soldBy'), ['a@x.com', 'b@x.com'])
})

test('discounts are totalled per sale, not per split', () => {
  const kpis = salesKpis([
    { ...splitSale[0], discountAmount: 300, discountCode: 'DIWALI20' },
    { ...splitSale[1], discountAmount: 0, discountCode: 'DIWALI20' }
  ])
  assert.equal(kpis.discount, 300)
  assert.equal(kpis.discountedTransactions, 1)
  assert.equal(kpis.listRevenue, 1300)
})

test('rows with no enrichment contribute no discount', () => {
  assert.equal(salesKpis([row()]).discount, 0)
  assert.equal(salesKpis([row()]).listRevenue, 1000)
})

test('the normalised item fields are groupable as sale fields', () => {
  const groups = groupSales([
    { ...splitSale[0], itemGroup: 'Single class' },
    { ...splitSale[1], itemGroup: 'Single class' }
  ], 'itemGroup')
  assert.equal(groups[0].transactions, 1)
  assert.equal(groups[0].grossRevenue, 1000)
})
