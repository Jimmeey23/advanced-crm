// Sales facts folded onto leads. The lifecycle labels a studio actually cares
// about ("did they buy again", "did they lapse") cannot be read off the lead
// record alone -- they need the purchase history behind it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { indexSalesByMember, leadSalesFacts, conversionLabel, CONVERSION_LABELS } from './salesLeadLink.js'

const sale = (over = {}) => ({
  id: 1,
  memberId: 555,
  customerEmail: 'amy@example.com',
  paymentDate: '2026-02-01T00:00:00.000Z',
  paymentValue: 5000,
  paidInCurrency: 5000,
  splitPaidInMoneyCredits: 0,
  refunded: 0,
  isPrimarySplit: true,
  paymentItem: 'Studio 1 Month Unlimited Membership',
  itemGroup: 'Unlimited membership',
  itemName: '1 Month Unlimited Membership',
  discountCode: null,
  discountAmount: 0,
  location: 'Kwality House, Kemps Corner',
  market: 'mumbai',
  ...over
})

const lead = (over = {}) => ({
  id: 'l1', memberId: '555', email: 'amy@example.com',
  createdAt: '2026-01-01T00:00:00.000Z', ...over
})

const factsFor = (leadRow, sales, now = new Date('2026-03-01T00:00:00.000Z')) =>
  leadSalesFacts(leadRow, indexSalesByMember(sales), { now })

test('a lead with no sales gets zeroes and a "no purchase" label', () => {
  const facts = factsFor(lead(), [])
  assert.equal(facts.purchaseCount, 0)
  assert.equal(facts.lifetimeValue, 0)
  assert.equal(facts.firstPurchaseDate, null)
  assert.equal(facts.conversionLabel, 'Not converted')
})

test('sales join on the Momence member id', () => {
  const facts = factsFor(lead(), [sale(), sale({ id: 2, paymentDate: '2026-02-20T00:00:00.000Z', paymentValue: 3000, paidInCurrency: 3000 })])
  assert.equal(facts.purchaseCount, 2)
  assert.equal(facts.lifetimeValue, 8000)
  assert.equal(facts.firstPurchaseDate, '2026-02-01T00:00:00.000Z')
  assert.equal(facts.lastPurchaseDate, '2026-02-20T00:00:00.000Z')
  assert.equal(facts.averageOrderValue, 4000)
})

test('sales join on email when the member id is missing', () => {
  const facts = factsFor(lead({ memberId: '' }), [sale()])
  assert.equal(facts.purchaseCount, 1)
})

test('a sale matching both keys is counted once', () => {
  const facts = factsFor(lead(), [sale()])
  assert.equal(facts.purchaseCount, 1)
})

test('only the primary split contributes money, so a split payment is one sale', () => {
  const facts = factsFor(lead(), [
    sale({ id: 1, paidInCurrency: 3000, isPrimarySplit: true }),
    sale({ id: 2, paidInCurrency: 2000, isPrimarySplit: false })
  ])
  assert.equal(facts.purchaseCount, 1)
  assert.equal(facts.lifetimeValue, 5000)
  assert.equal(facts.paidInCurrency, 5000)
})

test('purchases before the lead existed are excluded from conversion but kept as prior spend', () => {
  const facts = factsFor(lead({ createdAt: '2026-02-15T00:00:00.000Z' }), [sale()])
  assert.equal(facts.purchaseCount, 0)
  assert.equal(facts.priorPurchaseCount, 1)
  assert.equal(facts.conversionLabel, 'Existing customer')
})

test('discounts, refunds and credits are summarised', () => {
  const facts = factsFor(lead(), [
    sale({ id: 1, discountCode: 'ZAP10', discountAmount: 500 }),
    sale({ id: 2, paymentDate: '2026-02-10T00:00:00.000Z', refunded: 1000, splitPaidInMoneyCredits: 250, paidInCurrency: 4750 })
  ])
  assert.equal(facts.discountTotal, 500)
  assert.equal(facts.discountCodes, 'ZAP10')
  assert.equal(facts.refundedTotal, 1000)
  assert.equal(facts.paidInCredits, 250)
})

test('what they bought is summarised for the table', () => {
  const facts = factsFor(lead(), [
    sale({ id: 1, itemGroup: 'Intro offer', itemName: 'Newcomers 2 For 1', paymentDate: '2026-02-01T00:00:00.000Z' }),
    sale({ id: 2, itemGroup: 'Unlimited membership', itemName: '1 Month Unlimited Membership', paymentDate: '2026-02-20T00:00:00.000Z' })
  ])
  assert.equal(facts.firstPurchaseItem, 'Newcomers 2 For 1')
  assert.equal(facts.lastPurchaseItem, '1 Month Unlimited Membership')
  assert.equal(facts.itemGroups, 'Intro offer, Unlimited membership')
  // Measured to the purchase that counts as converting (20 Feb), not to the
  // intro offer that preceded it.
  assert.equal(facts.daysToConvert, 50)
})

// --- conversion labelling ---------------------------------------------------

test('one purchase after the lead was created is a conversion', () => {
  assert.equal(factsFor(lead(), [sale()]).conversionLabel, 'Converted')
})

test('a second purchase makes them a repeat customer', () => {
  const facts = factsFor(lead(), [sale(), sale({ id: 2, paymentDate: '2026-02-20T00:00:00.000Z' })])
  assert.equal(facts.conversionLabel, 'Repeat customer')
})

test('an intro offer alone is a trial, not a conversion', () => {
  const facts = factsFor(lead(), [sale({ itemGroup: 'Intro offer', itemName: 'Newcomers 2 For 1' })])
  assert.equal(facts.conversionLabel, 'Trial purchase')
})

test('an intro offer followed by a real membership converts', () => {
  const facts = factsFor(lead(), [
    sale({ id: 1, itemGroup: 'Intro offer' }),
    sale({ id: 2, itemGroup: 'Unlimited membership', paymentDate: '2026-02-20T00:00:00.000Z' })
  ])
  assert.equal(facts.conversionLabel, 'Converted')
})

test('a customer who has not bought in a long while has lapsed', () => {
  const facts = factsFor(
    lead(),
    [sale(), sale({ id: 2, paymentDate: '2026-02-05T00:00:00.000Z' })],
    new Date('2026-09-01T00:00:00.000Z')
  )
  assert.equal(facts.conversionLabel, 'Lapsed')
  assert.ok(facts.daysSinceLastPurchase > 180)
})

test('a fully refunded conversion is labelled as refunded, not converted', () => {
  const facts = factsFor(lead(), [sale({ refunded: 5000 })])
  assert.equal(facts.conversionLabel, 'Refunded')
})

test('retail alone is not a conversion', () => {
  const facts = factsFor(lead(), [sale({ itemGroup: 'Retail', itemName: 'Impact Water 500ML', paymentValue: 115, paidInCurrency: 115 })])
  assert.equal(facts.conversionLabel, 'Retail only')
})

test('every label the function can return is declared', () => {
  const declared = new Set(CONVERSION_LABELS.map(entry => entry.label))
  const cases = [
    [], [sale()], [sale(), sale({ id: 2, paymentDate: '2026-02-20T00:00:00.000Z' })],
    [sale({ itemGroup: 'Intro offer' })], [sale({ itemGroup: 'Retail' })], [sale({ refunded: 5000 })]
  ]
  for (const sales of cases) assert.ok(declared.has(factsFor(lead(), sales).conversionLabel))
})

test('the label function is callable on its own facts, for reuse in the UI', () => {
  assert.equal(conversionLabel({ purchaseCount: 0, priorPurchaseCount: 0 }), 'Not converted')
  assert.equal(conversionLabel({ purchaseCount: 3, qualifyingCount: 3, daysSinceLastPurchase: 10 }), 'Repeat customer')
})

// --- "first purchase" as a studio means it ----------------------------------

test('the first paid purchase skips retail, credits and newcomer offers', () => {
  const facts = factsFor(lead(), [
    sale({ id: 1, paymentDate: '2026-01-10T00:00:00.000Z', itemGroup: 'Retail', paymentCategory: 'product', paymentItem: 'Impact Water 500ML' }),
    sale({ id: 2, paymentDate: '2026-01-15T00:00:00.000Z', itemGroup: 'Credits', paymentItem: 'money-credit' }),
    sale({ id: 3, paymentDate: '2026-01-20T00:00:00.000Z', itemGroup: 'Intro offer', paymentItem: 'Newcomers 2 For 1' }),
    sale({ id: 4, paymentDate: '2026-02-01T00:00:00.000Z', paymentItem: 'Studio 1 Month Unlimited Membership' })
  ])
  assert.equal(facts.firstPaidPurchaseDate, '2026-02-01T00:00:00.000Z')
  assert.equal(facts.firstPaidPurchaseItem, '1 Month Unlimited Membership')
})

test('a zero-value comp is not a first purchase', () => {
  const facts = factsFor(lead(), [
    sale({ id: 1, paymentDate: '2026-01-05T00:00:00.000Z', paymentValue: 0, paidInCurrency: 0 }),
    sale({ id: 2, paymentDate: '2026-02-01T00:00:00.000Z' })
  ])
  assert.equal(facts.firstPaidPurchaseDate, '2026-02-01T00:00:00.000Z')
})

test('an unrecognised newcomer name is still excluded, by name and category', () => {
  const facts = factsFor(lead(), [
    sale({ id: 1, paymentDate: '2026-01-05T00:00:00.000Z', itemGroup: 'Other membership', paymentItem: 'Studio Newcomer 2 for 1 ' }),
    sale({ id: 2, paymentDate: '2026-01-06T00:00:00.000Z', itemGroup: 'Other membership', paymentCategory: 'product', paymentItem: 'P57 - SOCKS' }),
    sale({ id: 3, paymentDate: '2026-03-01T00:00:00.000Z' })
  ])
  assert.equal(facts.firstPaidPurchaseDate, '2026-03-01T00:00:00.000Z')
})

test('a purchase made before the lead existed still counts as their first purchase', () => {
  // The conversion fields deliberately ignore it; "first purchase" is a fact
  // about the member, not about this lead record.
  const facts = factsFor(lead({ createdAt: '2026-02-15T00:00:00.000Z' }), [sale()])
  assert.equal(facts.firstPaidPurchaseDate, '2026-02-01T00:00:00.000Z')
  assert.equal(facts.firstQualifyingDate, null)
})

test('a member with nothing but retail has no first purchase date', () => {
  const facts = factsFor(lead(), [sale({ itemGroup: 'Retail', paymentCategory: 'product' })])
  assert.equal(facts.firstPaidPurchaseDate, null)
})
