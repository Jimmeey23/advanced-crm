// Flattens Momence's total-sales report into the dashboard's table rows.
//
// The report nests two levels: an item per sale, and inside it one
// transactionItem per way that sale was paid for (a class bought with cash
// plus two membership credits is one item and three splits). The dashboard's
// row is the split, because that is the only grain at which "how was this
// paid" is answerable -- and because splits partition the sale's value, so
// summing them is still the sale total, not a multiple of it.
//
// Everything the report knows is lifted onto the row. `details` is
// polymorphic (membership ids for a membership sale, product ids for retail,
// session ids for a booking), so its keys are spread rather than mapped -- a
// new detail key from Momence shows up as a new column instead of vanishing.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// Studios report in IST. A sale at 23:30 UTC on the 31st is next month's
// business, and bucketing it by the UTC month would put it in the wrong one.
export function monthKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`
}

// The report's dateRange is UTC, so an IST calendar month is asked for as the
// UTC instants that bound it.
export function monthRange(key) {
  const [year, month] = String(key).split('-').map(Number)
  const from = new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS)
  const to = new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function currentMonthKey(now = new Date()) {
  return monthKey(now)
}

// "2026-08" -> "2026-07". Used to walk the backfill backwards.
export function previousMonthKey(key) {
  const [year, month] = String(key).split('-').map(Number)
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

export function nextMonthKey(key) {
  const [year, month] = String(key).split('-').map(Number)
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
}

const num = value => (value === null || value === undefined || value === '' ? 0 : Number(value) || 0)

// `details` carries a membershipType of its own that means the same thing as
// the sale's but is sometimes absent; letting the spread win would blank the
// sale-level value on those rows.
const OVERSHADOWED_DETAIL_KEYS = new Set(['membershipType', 'eventType'])

function detailFields(details) {
  const out = {}
  for (const [key, value] of Object.entries(details || {})) {
    if (OVERSHADOWED_DETAIL_KEYS.has(key)) continue
    out[key] = value
  }
  return out
}

export function flattenSalesRows(items, { market = 'mumbai' } = {}) {
  const rows = []
  // Two kinds of repetition come out of the live report and both have to be
  // collapsed here, before anything sums a column:
  //
  //  * the same sale item listed twice in one report run;
  //  * the same payment split listed twice under one sale item -- which would
  //    count its money a second time.
  //
  // What is NOT a duplicate: one split paying for several sale items (four
  // single classes on one card charge). Those share a paymentTransactionItemId
  // but are four real sales, so row identity is the pair, never the split
  // alone.
  const seenSaleItems = new Set()
  const seenRowIds = new Set()
  for (const item of items || []) {
    if (!item?.paymentDate) continue
    const saleItemKey = `${item.saleItemId}:${item.paymentTransactionId}`
    if (seenSaleItems.has(saleItemKey)) continue
    seenSaleItems.add(saleItemKey)
    const month = monthKey(item.paymentDate)
    const splits = item.transactionItems?.length
      ? item.transactionItems
      // A sale with no splits recorded still happened; treat the sale itself as
      // its own single split so it is not silently missing from the table.
      : [{
          paymentTransactionItemId: null,
          paymentMethod: item.paymentMethod,
          paidInCurrency: num(item.paymentValue) - num(item.paidInMoneyCredits),
          paidInMoneyCredits: num(item.paidInMoneyCredits),
          vatAmountInCurrency: num(item.paymentVat),
          homeLocation: item.location || null,
          saleReference: item.saleReference || null,
          paymentMethodWeight: 1
        }]

    let kept = 0
    const emitted = []
    splits.forEach(split => {
      const id = `${item.saleItemId}:${split.paymentTransactionItemId ?? 'sale'}`
      if (seenRowIds.has(id)) return
      seenRowIds.add(id)
      const index = kept
      kept += 1
      emitted.push({
        id,
        market,
        month,

        // --- sale ---------------------------------------------------------
        memberId: item.memberId ?? null,
        customerName: item.customerName ?? null,
        customerEmail: item.customerEmail ?? null,
        payingMemberId: item.payingMemberId ?? null,
        payingCustomerName: item.payingCustomerName ?? null,
        payingCustomerEmail: item.payingCustomerEmail ?? null,
        saleItemId: item.saleItemId ?? null,
        paymentTransactionId: item.paymentTransactionId ?? null,
        saleReference: item.saleReference ?? split.saleReference ?? null,
        paymentDate: item.paymentDate,
        serviceDate: item.serviceDate ?? null,
        paymentItem: item.paymentItem ?? null,
        paymentCategory: item.paymentCategory ?? null,
        membershipType: item.membershipType ?? null,
        eventType: item.eventType ?? null,
        eventIsSemesterClass: item.eventIsSemesterClass ?? null,
        paymentMethod: item.paymentMethod ?? null,
        paymentStatus: item.paymentStatus ?? null,
        stripeToken: item.stripeToken ?? null,
        currency: item.currency ?? null,
        soldBy: item.soldBy ?? null,
        paymentValue: num(item.paymentValue),
        paymentVat: num(item.paymentVat),
        salePaidInMoneyCredits: num(item.paidInMoneyCredits),
        refunded: num(item.refunded),
        location: item.location ?? split.homeLocation ?? null,

        // --- split --------------------------------------------------------
        splitPaymentMethod: split.paymentMethod ?? null,
        paidInCurrency: num(split.paidInCurrency),
        splitPaidInMoneyCredits: num(split.paidInMoneyCredits),
        splitVatAmount: num(split.vatAmountInCurrency),
        splitMembershipType: split.membershipType ?? null,
        splitMembershipName: split.membershipName ?? null,
        paymentMethodWeight: split.paymentMethodWeight ?? null,
        homeLocation: split.homeLocation ?? null,
        note: split.note ?? null,
        // Sale-level figures (paymentValue, refunded, the member) belong to the
        // sale, not to each of its splits. Aggregations that must not multiply
        // them count only the primary split.
        isPrimarySplit: index === 0,
        // Filled in below, once the duplicates have been dropped.
        splitCount: 0,

        // --- polymorphic details -------------------------------------------
        ...detailFields(item.details)
      })
    })
    for (const row of emitted) row.splitCount = kept
    rows.push(...emitted)
  }
  return rows
}
