// Aggregation over Momence payment-split rows, shared by the server's summary
// endpoint and the dashboard page so both can never disagree.
//
// The grain is a payment split: one row per way a sale was paid for. Splits
// partition a sale's value, so summing split money is exact. Anything that
// describes the sale rather than the split -- its count, its value, its
// refund, its customer -- must be read only off the primary split, or a class
// paid with cash plus two membership credits would count as three sales.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export const GROUPINGS = [
  { field: 'itemGroup', label: 'Item group' },
  { field: 'customerName', label: 'Customer' },
  { field: 'itemName', label: 'Item' },
  { field: 'paymentItem', label: 'Item (raw name)' },
  { field: 'itemTerm', label: 'Membership term' },
  { field: 'discountCode', label: 'Discount code' },
  { field: 'paymentSource', label: 'Sold through' },
  { field: 'paymentCategory', label: 'Category' },
  { field: 'membershipType', label: 'Membership type' },
  { field: 'splitPaymentMethod', label: 'Payment method' },
  { field: 'soldBy', label: 'Sold by' },
  { field: 'location', label: 'Location' },
  { field: 'month', label: 'Month' },
  { field: 'paymentStatus', label: 'Status' }
]

// Fields that belong to the sale. Grouping by one of these must not multiply
// the sale's own figures across its splits.
const SALE_FIELDS = new Set(['customerName', 'paymentItem', 'itemName', 'itemGroup', 'itemTerm', 'paymentCategory', 'membershipType', 'soldBy', 'location', 'month', 'paymentStatus', 'customerEmail', 'market', 'memberId', 'discountCode', 'paymentSource', 'purchaseType'])

const num = value => Number(value) || 0

export function istDay(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

// The running totals every aggregate is built from. `saleCounted` decides
// whether the sale-level figures on this row have already been banked.
function accumulate(bucket, row, { countSale }) {
  bucket.splits += 1
  bucket.paidInCurrency += num(row.paidInCurrency)
  bucket.paidInMoneyCredits += num(row.splitPaidInMoneyCredits)
  bucket.splitVat += num(row.splitVatAmount)
  if (countSale) {
    bucket.transactions += 1
    bucket.grossRevenue += num(row.paymentValue)
    bucket.discount += num(row.discountAmount)
    if (row.discountCode) bucket.discountedTransactions += 1
    bucket.vat += num(row.paymentVat)
    bucket.refunded += num(row.refunded)
    if (num(row.refunded) > 0) bucket.refundedTransactions += 1
    if (row.memberId != null) bucket.members.add(row.memberId)
  }
  return bucket
}

const emptyBucket = () => ({
  splits: 0,
  transactions: 0,
  grossRevenue: 0,
  paidInCurrency: 0,
  paidInMoneyCredits: 0,
  vat: 0,
  splitVat: 0,
  refunded: 0,
  refundedTransactions: 0,
  discount: 0,
  discountedTransactions: 0,
  members: new Set()
})

function finalise(bucket) {
  const netRevenue = bucket.grossRevenue - bucket.refunded
  const uniqueMembers = bucket.members.size
  return {
    splits: bucket.splits,
    transactions: bucket.transactions,
    grossRevenue: round(bucket.grossRevenue),
    netRevenue: round(netRevenue),
    paidInCurrency: round(bucket.paidInCurrency),
    paidInMoneyCredits: round(bucket.paidInMoneyCredits),
    vat: round(bucket.vat),
    splitVat: round(bucket.splitVat),
    refunded: round(bucket.refunded),
    refundedTransactions: bucket.refundedTransactions,
    discount: round(bucket.discount),
    discountedTransactions: bucket.discountedTransactions,
    // What the sales would have been at list price. Only meaningful for rows
    // whose transaction detail has been fetched; zero elsewhere, never negative.
    listRevenue: round(bucket.grossRevenue + bucket.discount),
    uniqueMembers,
    averageTransactionValue: bucket.transactions ? round(bucket.grossRevenue / bucket.transactions) : 0,
    averageRevenuePerMember: uniqueMembers ? round(bucket.grossRevenue / uniqueMembers) : 0
  }
}

const round = value => Math.round(value * 100) / 100

export function salesKpis(rows) {
  const bucket = emptyBucket()
  for (const row of rows || []) accumulate(bucket, row, { countSale: row.isPrimarySplit !== false })
  return finalise(bucket)
}

// Grouping by a SALE field keeps one-sale-one-count. Grouping by a SPLIT field
// (payment method, above all) deliberately counts a sale under each method it
// used -- "how many sales took cash" is a question about splits -- while the
// money still only ever comes from the split itself.
export function groupSales(rows, field) {
  const saleField = SALE_FIELDS.has(field)
  const buckets = new Map()
  const seenSalePerGroup = new Set()
  for (const row of rows || []) {
    const key = row?.[field] === null || row?.[field] === undefined || row?.[field] === '' ? 'Unspecified' : String(row[field])
    if (!buckets.has(key)) buckets.set(key, emptyBucket())
    // For a sale field the primary split is the sale's one representative. For
    // a split field, the first split of a sale landing in this group is.
    let countSale
    if (saleField) {
      countSale = row.isPrimarySplit !== false
    } else {
      const saleKey = `${key}::${row.paymentTransactionId ?? row.saleItemId ?? row.id}`
      countSale = !seenSalePerGroup.has(saleKey)
      if (countSale) seenSalePerGroup.add(saleKey)
    }
    accumulate(buckets.get(key), row, { countSale })
  }
  const groups = [...buckets.entries()].map(([key, bucket]) => ({ key, ...finalise(bucket) }))
  const total = groups.reduce((sum, group) => sum + group.grossRevenue, 0)
  return groups
    .map(group => ({ ...group, share: total ? round(group.grossRevenue / total * 10000) / 10000 : 0 }))
    .sort((a, b) => b.grossRevenue - a.grossRevenue || b.transactions - a.transactions)
}

// Continuous daily series — a gap day has to render as zero, not as a line
// drawn straight across it.
export function trendByDay(rows) {
  const byDay = new Map()
  for (const row of rows || []) {
    const day = istDay(row.paymentDate)
    if (!day) continue
    if (!byDay.has(day)) byDay.set(day, emptyBucket())
    accumulate(byDay.get(day), row, { countSale: row.isPrimarySplit !== false })
  }
  const days = [...byDay.keys()].sort()
  if (!days.length) return []
  const points = []
  for (let cursor = new Date(`${days[0]}T00:00:00.000Z`); cursor <= new Date(`${days[days.length - 1]}T00:00:00.000Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10)
    points.push({ date: day, ...finalise(byDay.get(day) || emptyBucket()) })
  }
  return points
}

export function distinctValues(rows, field) {
  const values = new Set()
  for (const row of rows || []) {
    const value = row?.[field]
    if (value !== null && value !== undefined && value !== '') values.add(String(value))
  }
  return [...values].sort((a, b) => a.localeCompare(b))
}

const SEARCH_FIELDS = ['customerName', 'customerEmail', 'payingCustomerName', 'payingCustomerEmail', 'paymentItem', 'itemName', 'itemGroup', 'saleReference', 'soldBy', 'paymentTransactionId', 'memberId', 'discountCode']

// `filters` is {field: [allowed values]} plus an optional free-text `search`.
// An absent or empty list means "no constraint on this field".
export function filterSales(rows, filters = {}) {
  const { search, ...fields } = filters
  const active = Object.entries(fields).filter(([, values]) => Array.isArray(values) && values.length)
  const needle = String(search || '').trim().toLowerCase()
  return (rows || []).filter(row => {
    for (const [field, values] of active) {
      if (!values.includes(String(row?.[field] ?? ''))) return false
    }
    if (!needle) return true
    return SEARCH_FIELDS.some(field => String(row?.[field] ?? '').toLowerCase().includes(needle))
  })
}
