// The total-sales report returns one item per sale, each carrying its payment
// splits nested under transactionItems. The dashboard's table row IS a split,
// so flattening has to lift every parent field, every split field and every
// key of the polymorphic `details` object onto one flat row -- and must not
// invent revenue when a sale is paid three ways.
import test from 'node:test'
import assert from 'node:assert/strict'
import { flattenSalesRows, monthKey, monthRange } from './salesRows.js'

const splitPaid = {
  memberId: 789936,
  customerName: 'Libby Swan',
  customerEmail: 'swanjlibby@gmail.com',
  payingCustomerEmail: 'swanjlibby@gmail.com',
  payingCustomerName: 'Libby Swan',
  payingMemberId: 789936,
  saleItemId: 311977750,
  paymentDate: '2026-08-01T12:40:04.093Z',
  serviceDate: '2026-08-13T05:30:00.000Z',
  paymentValue: 1837.5,
  paidInMoneyCredits: 237.5,
  paymentVat: 87.5,
  paymentItem: 'Studio Single Class',
  paymentMethod: 'multiple-payment-methods',
  paymentStatus: 'succeeded',
  paymentTransactionId: 325676800,
  refunded: 0,
  stripeToken: 'multiple-payment-methods',
  currency: null,
  soldBy: 'vahishta@physique57mumbai.com',
  transactionItems: [
    {
      paymentTransactionItemId: 258768103,
      paymentTransactionId: 325676800,
      paymentMethod: 'cash',
      paidInCurrency: 1600,
      paidInMoneyCredits: 0,
      vatAmountInCurrency: 76.19,
      membershipType: null,
      membershipName: null,
      homeLocation: 'Kwality House, Kemps Corner',
      note: null,
      saleReference: '325676800',
      paymentMethodWeight: 0.87,
      saleItemId: 311977750
    },
    {
      paymentTransactionItemId: 258768102,
      paymentTransactionId: 325676800,
      paymentMethod: 'membership',
      paidInCurrency: 0,
      paidInMoneyCredits: 154.5,
      vatAmountInCurrency: 7.36,
      membershipType: 'package-money',
      membershipName: null,
      homeLocation: 'Kwality House, Kemps Corner',
      note: null,
      saleReference: '325676800',
      paymentMethodWeight: 0.08,
      saleItemId: 311977750
    },
    {
      paymentTransactionItemId: 258768101,
      paymentTransactionId: 325676800,
      paymentMethod: 'membership',
      paidInCurrency: 0,
      paidInMoneyCredits: 83,
      vatAmountInCurrency: 3.95,
      membershipType: 'package-money',
      membershipName: null,
      homeLocation: 'Kwality House, Kemps Corner',
      note: null,
      saleReference: '325676800',
      paymentMethodWeight: 0.05,
      saleItemId: 311977750
    }
  ],
  location: null,
  saleReference: '325676800',
  paymentCategory: 'membership',
  membershipType: 'package-events',
  details: { boughtMembershipId: 71582026, membershipId: 27845, membershipType: 'package-events' }
}

const product = {
  memberId: 25431983,
  customerName: 'Hiya Shah',
  customerEmail: 'hiyaas5@gmail.com',
  saleItemId: 311909781,
  paymentDate: '2026-08-01T07:04:36.429Z',
  paymentValue: 115,
  paidInMoneyCredits: 0,
  paymentVat: 5.48,
  paymentItem: 'Impact Water 500ML',
  paymentMethod: 'UPI',
  paymentStatus: 'succeeded',
  paymentTransactionId: 325606743,
  refunded: 0,
  currency: 'inr',
  soldBy: 'sheetal@physique57mumbai.com',
  transactionItems: [{
    paymentTransactionItemId: 258700787,
    paymentTransactionId: 325606743,
    paymentMethod: 'UPI',
    paidInCurrency: 115,
    paidInMoneyCredits: 0,
    vatAmountInCurrency: 5.48,
    homeLocation: 'Kwality House, Kemps Corner',
    saleReference: '325606743',
    paymentMethodWeight: 1,
    saleItemId: 311909781
  }],
  saleReference: '325606743',
  paymentCategory: 'product',
  details: { productId: 503995, variantId: null, productOrderId: 4160931 }
}

const booking = {
  memberId: 22611222,
  customerName: 'Khushali Dodia',
  saleItemId: 311903094,
  paymentDate: '2026-08-01T06:35:05.279Z',
  serviceDate: '2026-07-26T11:45:00.000Z',
  paymentValue: 1837.5,
  paidInMoneyCredits: 1837,
  paymentVat: 87.5,
  paymentItem: 'Studio Mat 57',
  paymentMethod: 'multiple-payment-methods',
  paymentStatus: 'succeeded',
  paymentTransactionId: 325599994,
  refunded: 0,
  location: 'Kwality House, Kemps Corner',
  saleReference: '325599994',
  paymentCategory: 'event',
  eventType: 'fitness',
  eventIsSemesterClass: false,
  transactionItems: [{
    paymentTransactionItemId: 258694132,
    paymentTransactionId: 325599994,
    paymentMethod: 'membership',
    paidInCurrency: 0,
    paidInMoneyCredits: 1837,
    vatAmountInCurrency: 87.48,
    membershipType: 'package-money',
    homeLocation: 'Kwality House, Kemps Corner',
    saleReference: '325599994',
    paymentMethodWeight: 1,
    saleItemId: 311903094
  }],
  details: {
    eventType: 'fitness',
    sessionId: 138890005,
    sessionBookingId: 336936856,
    additionalMultiTicketBookingOfId: null,
    isBookingCancelled: false
  }
}

const rows = (items, market = 'mumbai') => flattenSalesRows(items, { market })

test('one row per payment split', () => {
  assert.equal(rows([splitPaid]).length, 3)
  assert.equal(rows([product]).length, 1)
})

test('the split is the row identity', () => {
  const out = rows([splitPaid])
  assert.deepEqual(out.map(r => r.id), [258768103, 258768102, 258768101])
  assert.deepEqual(out.map(r => r.splitPaymentMethod), ['cash', 'membership', 'membership'])
})

test('split amounts sum to the sale value, so revenue never double counts', () => {
  const out = rows([splitPaid])
  const total = out.reduce((sum, r) => sum + r.paidInCurrency + r.splitPaidInMoneyCredits, 0)
  assert.equal(Math.round(total * 100) / 100, splitPaid.paymentValue)
  // Only one split of the sale is primary, so counting transactions or the
  // sale's own paymentValue stays a one-per-sale question.
  assert.deepEqual(out.map(r => r.isPrimarySplit), [true, false, false])
})

test('every parent field is carried onto the row', () => {
  const [row] = rows([splitPaid])
  assert.equal(row.memberId, 789936)
  assert.equal(row.customerName, 'Libby Swan')
  assert.equal(row.customerEmail, 'swanjlibby@gmail.com')
  assert.equal(row.payingCustomerName, 'Libby Swan')
  assert.equal(row.payingCustomerEmail, 'swanjlibby@gmail.com')
  assert.equal(row.payingMemberId, 789936)
  assert.equal(row.saleItemId, 311977750)
  assert.equal(row.paymentDate, '2026-08-01T12:40:04.093Z')
  assert.equal(row.serviceDate, '2026-08-13T05:30:00.000Z')
  assert.equal(row.paymentValue, 1837.5)
  assert.equal(row.salePaidInMoneyCredits, 237.5)
  assert.equal(row.paymentVat, 87.5)
  assert.equal(row.paymentItem, 'Studio Single Class')
  assert.equal(row.paymentMethod, 'multiple-payment-methods')
  assert.equal(row.paymentStatus, 'succeeded')
  assert.equal(row.paymentTransactionId, 325676800)
  assert.equal(row.refunded, 0)
  assert.equal(row.stripeToken, 'multiple-payment-methods')
  assert.equal(row.soldBy, 'vahishta@physique57mumbai.com')
  assert.equal(row.saleReference, '325676800')
  assert.equal(row.paymentCategory, 'membership')
  assert.equal(row.membershipType, 'package-events')
})

test('every split field is carried onto the row', () => {
  const [, second] = rows([splitPaid])
  assert.equal(second.paidInCurrency, 0)
  assert.equal(second.splitPaidInMoneyCredits, 154.5)
  assert.equal(second.splitVatAmount, 7.36)
  assert.equal(second.splitMembershipType, 'package-money')
  assert.equal(second.splitMembershipName, null)
  assert.equal(second.paymentMethodWeight, 0.08)
  assert.equal(second.note, null)
})

test('details keys are flattened, whatever shape they take', () => {
  const [membershipRow] = rows([splitPaid])
  assert.equal(membershipRow.boughtMembershipId, 71582026)
  assert.equal(membershipRow.membershipId, 27845)

  const [productRow] = rows([product])
  assert.equal(productRow.productId, 503995)
  assert.equal(productRow.variantId, null)
  assert.equal(productRow.productOrderId, 4160931)

  const [bookingRow] = rows([booking])
  assert.equal(bookingRow.sessionId, 138890005)
  assert.equal(bookingRow.sessionBookingId, 336936856)
  assert.equal(bookingRow.isBookingCancelled, false)
  assert.equal(bookingRow.eventType, 'fitness')
  assert.equal(bookingRow.eventIsSemesterClass, false)
})

test('details.membershipType does not overwrite the sale-level one', () => {
  const [row] = rows([splitPaid])
  assert.equal(row.membershipType, 'package-events')
})

test('location falls back to the split home location', () => {
  assert.equal(rows([splitPaid])[0].location, 'Kwality House, Kemps Corner')
  assert.equal(rows([booking])[0].location, 'Kwality House, Kemps Corner')
})

test('market and month are stamped on every row', () => {
  const [row] = rows([splitPaid], 'blr')
  assert.equal(row.market, 'blr')
  assert.equal(row.month, '2026-08')
})

test('a sale with no splits still produces one row carrying the whole value', () => {
  const bare = { ...product, transactionItems: [] }
  const [row] = rows([bare])
  assert.equal(row.id, 'sale:311909781')
  assert.equal(row.paidInCurrency, 115)
  assert.equal(row.splitPaymentMethod, 'UPI')
  assert.equal(row.isPrimarySplit, true)
})

test('a row without a payment date is dropped', () => {
  assert.deepEqual(rows([{ ...product, paymentDate: null }]), [])
  assert.deepEqual(rows(null), [])
})

// --- month helpers ----------------------------------------------------------

test('monthKey buckets by the studio calendar month', () => {
  assert.equal(monthKey('2026-08-01T12:40:04.093Z'), '2026-08')
  // 23:30 UTC on the 31st is already the 1st in IST, and the studios report in
  // IST, so it belongs to the next month.
  assert.equal(monthKey('2026-08-31T23:30:00.000Z'), '2026-09')
})

test('monthRange spans the whole month in IST', () => {
  const { from, to } = monthRange('2026-08')
  assert.equal(from, '2026-07-31T18:30:00.000Z')
  assert.equal(to, '2026-08-31T18:30:00.000Z')
})
