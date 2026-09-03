// Discount and fee detail for cached sales rows.
//
// The total-sales report knows what was paid but not what was taken off: no
// discount code, no price rule, no processor fee, no payment source. All of
// that lives on GET /host/payment-transactions/{id}, one call per
// transaction, so transactions are fetched lazily, once, and cached forever —
// a completed transaction's discount never changes (a later refund does, and
// the row's own `refunded` from the report already covers that case).
const num = value => (value === null || value === undefined || value === '' ? 0 : Number(value) || 0)

export function transactionEnrichment(txn) {
  const bySaleItem = {}
  for (const sale of txn?.sales || []) {
    for (const item of sale?.items || []) {
      const quantity = num(item.quantity) || 1
      const discount = item.discountCode
      // Discount figures are per unit, like the price they reduce.
      const perUnitExcludingTax = num(discount?.unitDiscountExcludingTaxInCurrency)
      const perUnitTax = num(discount?.unitDiscountTaxAmountInCurrency)
      const unit = num(item.unitPriceExcludingTaxInCurrency) + num(item.unitTaxAmountInCurrency)
      bySaleItem[String(item.saleItemId ?? item.id)] = {
        saleId: sale.id,
        itemType: item.itemType || null,
        itemNameFull: item.descriptiveItemName || item.itemName || null,
        quantity,
        unitPriceExcludingTax: num(item.unitPriceExcludingTaxInCurrency),
        unitTaxAmount: num(item.unitTaxAmountInCurrency),
        // What the sale would have been at list price, before the code.
        grossBeforeDiscount: round(quantity * (unit + perUnitExcludingTax + perUnitTax)),
        discountCode: discount?.code || null,
        discountCodeId: discount?.discountCodeId ?? null,
        priceRuleId: discount?.priceRuleId ?? null,
        discountType: discount?.type || null,
        discountAmount: round(quantity * (perUnitExcludingTax + perUnitTax)),
        discountAmountExcludingTax: round(quantity * perUnitExcludingTax),
        targetMemberId: item.targetMember?.id ?? null,
        targetMemberName: item.targetMember ? `${item.targetMember.firstName || ''} ${item.targetMember.lastName || ''}`.trim() : null,
        sessionName: item.session?.name || null,
        sessionStartsAt: item.session?.startsAt || null,
        appointmentName: item.appointment?.name || null,
        productName: item.product?.name || null,
        productVariant: item.productVariant?.name || null,
        openArea: item.openArea?.name || null
      }
    }
  }

  const firstItem = txn?.transactionItems?.[0] || {}
  const refunds = txn?.refunds || []

  return {
    fetchedAt: new Date().toISOString(),
    bySaleItem,
    transaction: {
      paymentTransactionId: txn?.id ?? null,
      paymentSource: txn?.paymentSource || null,
      purchaseType: txn?.purchaseType || null,
      currency: txn?.currency || null,
      priceExcludingVat: num(txn?.priceExcludingVatInCurrency),
      paidInCurrencyTotal: num(txn?.paidInCurrency),
      vatAmount: num(txn?.vatAmountInCurrency),
      processorFeeCustomer: num(txn?.paymentProcessorFeeCoveredByCustomerInCurrency),
      processorFeeHost: num(txn?.paymentProcessorFeeCoveredByHostInCurrency),
      platformFeeCustomer: num(txn?.platformFeeCoveredByCustomerInCurrency),
      platformFeeHost: num(txn?.platformFeeCoveredByHostInCurrency),
      paidInMoneyCreditsTotal: num(txn?.paidInMoneyCredits),
      paidInEventCredits: num(txn?.paidInEventCredits),
      usedMembershipName: firstItem.usedMembership?.name || null,
      usedMembershipType: firstItem.usedMembership?.type || null,
      usedBoughtMembershipId: firstItem.usedBoughtMembership?.id ?? null,
      usedGiftCardCode: firstItem.usedGiftCard?.code || null,
      customPaymentMethod: firstItem.customPaymentMethod || null,
      isApplePay: txn?.metadata?.isApplePay ?? null,
      isGooglePay: txn?.metadata?.isGooglePay ?? null,
      failureReason: txn?.failure?.failureReason ?? null,
      refundedInCurrency: round(refunds.reduce((sum, refund) => sum + num(refund.refundedInCurrency), 0)),
      refundedInMoneyCredits: round(refunds.reduce((sum, refund) => sum + num(refund.refundedInMoneyCredits), 0)),
      refundCount: refunds.length,
      lastRefundAt: refunds.map(refund => refund.createdAt).sort().slice(-1)[0] || null
    }
  }
}

const round = value => Math.round(value * 100) / 100

// Money fields are banked on the sale's primary split only, for the same
// reason the sale's own value is: a three-way payment is still one discount.
const MONEY_FIELDS = ['discountAmount', 'discountAmountExcludingTax', 'grossBeforeDiscount']

// Present on every row whether or not detail was found, so the table never
// has to distinguish "no discount" from "field missing".
const EMPTY_ITEM = Object.freeze({
  discountCode: null, discountCodeId: null, priceRuleId: null, discountType: null,
  discountAmount: 0, discountAmountExcludingTax: 0, grossBeforeDiscount: 0
})

export function applyEnrichment(rows, enrichmentById = {}) {
  return (rows || []).map(row => {
    const entry = enrichmentById[String(row.paymentTransactionId)]
    if (!entry) return { ...row, ...EMPTY_ITEM, enriched: false }
    // A transaction can be fetched without carrying this exact sale item (a
    // refund row, a sale item Momence has since removed): the transaction-level
    // detail still applies, the per-item detail is simply empty.
    const item = { ...EMPTY_ITEM, ...(entry.bySaleItem?.[String(row.saleItemId)] || {}) }
    const primary = row.isPrimarySplit !== false
    const money = {}
    for (const field of MONEY_FIELDS) money[field] = primary ? (item[field] || 0) : 0
    return { ...row, ...entry.transaction, ...item, ...money, enriched: true }
  })
}

// Fetches the transactions a set of rows refers to, once each, in small
// concurrent batches. Never throws for one bad transaction: a 404 on a single
// sale must not cost the whole batch.
export function createEnricher({ store, fetchTransaction, concurrency = 3, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), pauseMs = 120 } = {}) {
  let running = false

  async function enrich(rows, { limit = 400 } = {}) {
    const wanted = new Map()
    for (const row of rows || []) {
      const id = row?.paymentTransactionId
      if (!id || wanted.has(String(id))) continue
      if (store.getTransaction(id)) continue
      // Keyed by string to dedupe, but the id is passed on as Momence gave it.
      wanted.set(String(id), { id, market: row.market || 'mumbai' })
    }
    const queue = [...wanted.entries()]
    const remaining = Math.max(0, queue.length - limit)
    const batch = queue.slice(0, limit)

    let fetched = 0
    let failed = 0
    running = true
    try {
      for (let index = 0; index < batch.length; index += concurrency) {
        const slice = batch.slice(index, index + concurrency)
        const results = await Promise.all(slice.map(async ([key, { id, market }]) => {
          try {
            return [key, transactionEnrichment(await fetchTransaction(market, id))]
          } catch {
            failed += 1
            return null
          }
        }))
        const entries = {}
        for (const result of results) if (result) { entries[result[0]] = result[1]; fetched += 1 }
        if (Object.keys(entries).length) store.putTransactions(entries)
        if (index + concurrency < batch.length) await wait(pauseMs)
      }
    } finally {
      running = false
    }
    return { fetched, failed, remaining, requested: queue.length }
  }

  return { enrich, isRunning: () => running }
}
