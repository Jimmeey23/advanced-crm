// Joins the cached Momence sales history onto leads.
//
// The lead record carries a coarse status a human typed, plus whatever a
// webhook happened to stamp on it. The sales cache knows what actually
// happened: how many times they bought, what they bought, what it was worth,
// what came back as a refund. These facts, and the lifecycle label derived
// from them, are what the Leads table and the pivot report on.
//
// The join is the same one the rest of the app uses -- Momence member id or
// email, never phone.

const LAPSED_AFTER_DAYS = 180

// Buying an intro offer is not converting: the whole point of a 2-for-1 is
// that it is the last step BEFORE the decision. Retail is not converting
// either -- a bottle of water says nothing about membership.
const NON_QUALIFYING_GROUPS = new Set(['Intro offer', 'Retail', 'Credits', 'Gift card', 'Refund', 'Tip'])

// Belt and braces: itemGroup comes from the name normaliser, so a name it has
// never seen still gets caught by the report's own category and by the
// newcomer-offer pattern. A zero-value row is a comp, not a purchase.
const NON_QUALIFYING_CATEGORIES = new Set(['product', 'refund', 'tip', 'gift-card'])
const NEWCOMER_RE = /newcomer|2 ?for ?1|intro pack|new client/i
const MONEY_CREDIT_RE = /money-?credit|\bcredit\b/i

function isQualifyingSale(row) {
  if (!row) return false
  if ((Number(row.paymentValue) || 0) <= 0) return false
  if (NON_QUALIFYING_GROUPS.has(row.itemGroup)) return false
  if (NON_QUALIFYING_CATEGORIES.has(String(row.paymentCategory || '').toLowerCase())) return false
  const name = String(row.paymentItem || row.itemName || '')
  return !NEWCOMER_RE.test(name) && !MONEY_CREDIT_RE.test(name)
}

export const CONVERSION_LABELS = [
  { label: 'Repeat customer', tone: 'good', hint: 'Bought a service more than once after becoming a lead' },
  { label: 'Converted', tone: 'good', hint: 'Bought a membership, pack or class after becoming a lead' },
  { label: 'Trial purchase', tone: 'warn', hint: 'Bought only an intro or newcomer offer' },
  { label: 'Retail only', tone: 'warn', hint: 'Only bought retail — no service purchased' },
  { label: 'Lapsed', tone: 'bad', hint: `Converted, but nothing bought in over ${LAPSED_AFTER_DAYS} days` },
  { label: 'Refunded', tone: 'bad', hint: 'Everything they bought was refunded' },
  { label: 'Existing customer', tone: 'neutral', hint: 'Bought only before this lead was created' },
  { label: 'Not converted', tone: 'neutral', hint: 'No purchases on record' }
]

const cleanEmail = value => String(value || '').trim().toLowerCase()
const isValidMemberId = value => {
  const id = String(value || '').trim()
  return Boolean(id && !['-', 'null', 'undefined', 'nan', '0'].includes(id.toLowerCase()))
}

// One pass over the cache, two lookup maps. Scanning 24k rows per lead would
// be 500M comparisons on a 20k-lead workspace; this is two hash lookups.
export function indexSalesByMember(rows) {
  const byMemberId = new Map()
  const byEmail = new Map()
  for (const row of rows || []) {
    if (isValidMemberId(row.memberId)) push(byMemberId, String(row.memberId), row)
    const email = cleanEmail(row.customerEmail || row.payingCustomerEmail)
    if (email) push(byEmail, email, row)
  }
  return { byMemberId, byEmail }
}

function push(map, key, value) {
  const bucket = map.get(key)
  if (bucket) bucket.push(value)
  else map.set(key, [value])
}

const round = value => Math.round(value * 100) / 100
const days = (from, to) => Math.round((to - from) / 86400000)

export function leadSalesFacts(lead, index, { now = new Date() } = {}) {
  const seen = new Set()
  const rows = []
  const collect = bucket => {
    for (const row of bucket || []) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
    }
  }
  if (isValidMemberId(lead?.memberId)) collect(index?.byMemberId?.get(String(lead.memberId)))
  const email = cleanEmail(lead?.email)
  if (email) collect(index?.byEmail?.get(email))

  const createdAt = lead?.createdAt ? new Date(lead.createdAt) : null
  // Only the primary split carries the sale's own value; the others are the
  // same money counted a second way.
  const sales = rows
    .filter(row => row.isPrimarySplit !== false)
    .sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate))

  const after = []
  let priorPurchaseCount = 0
  let priorValue = 0
  for (const row of sales) {
    if (createdAt && new Date(row.paymentDate) <= createdAt) {
      priorPurchaseCount += 1
      priorValue += Number(row.paymentValue) || 0
      continue
    }
    after.push(row)
  }

  const totals = after.reduce((acc, row) => {
    acc.value += Number(row.paymentValue) || 0
    acc.currency += Number(row.paidInCurrency) || 0
    acc.credits += Number(row.splitPaidInMoneyCredits) || 0
    acc.refunded += Number(row.refunded) || 0
    acc.discount += Number(row.discountAmount) || 0
    if (row.discountCode) acc.codes.add(row.discountCode)
    if (row.itemGroup) acc.groups.add(row.itemGroup)
    if (row.location) acc.locations.add(row.location)
    return acc
  }, { value: 0, currency: 0, credits: 0, refunded: 0, discount: 0, codes: new Set(), groups: new Set(), locations: new Set() })

  // Splits are summed separately so "paid in credits" stays truthful for a
  // sale settled partly from a package.
  for (const row of rows) {
    if (row.isPrimarySplit === false && createdAt && new Date(row.paymentDate) > createdAt) {
      totals.currency += Number(row.paidInCurrency) || 0
      totals.credits += Number(row.splitPaidInMoneyCredits) || 0
    }
  }

  const first = after[0] || null
  const last = after[after.length - 1] || null
  const qualifying = after.filter(isQualifyingSale)
  const firstQualifying = qualifying[0] || null
  // "First purchase" as a studio means it: the first PAID purchase of an
  // actual service, over the member's whole history. A retail sale, a
  // money-credit top-up, a newcomer 2-for-1 and a zero-value comp are all
  // excluded, and unlike the conversion fields this ignores when the lead
  // record happened to be created.
  const firstPaidEver = sales.filter(isQualifyingSale)[0] || null

  const facts = {
    purchaseCount: after.length,
    qualifyingCount: qualifying.length,
    priorPurchaseCount,
    priorValue: round(priorValue),
    lifetimeValue: round(totals.value),
    paidInCurrency: round(totals.currency),
    paidInCredits: round(totals.credits),
    refundedTotal: round(totals.refunded),
    discountTotal: round(totals.discount),
    discountCodes: [...totals.codes].join(', '),
    itemGroups: [...totals.groups].sort().join(', '),
    purchaseLocations: [...totals.locations].sort().join(', '),
    averageOrderValue: after.length ? round(totals.value / after.length) : 0,
    firstPurchaseDate: first?.paymentDate || null,
    lastPurchaseDate: last?.paymentDate || null,
    firstPurchaseItem: first ? (first.itemName || first.paymentItem || null) : null,
    lastPurchaseItem: last ? (last.itemName || last.paymentItem || null) : null,
    firstQualifyingDate: firstQualifying?.paymentDate || null,
    firstPaidPurchaseDate: firstPaidEver?.paymentDate || null,
    firstPaidPurchaseItem: firstPaidEver ? (firstPaidEver.itemName || firstPaidEver.paymentItem || null) : null,
    daysToConvert: firstQualifying && createdAt ? days(createdAt, new Date(firstQualifying.paymentDate)) : null,
    daysSinceLastPurchase: last ? days(new Date(last.paymentDate), now) : null,
    fullyRefunded: after.length > 0 && totals.refunded >= totals.value && totals.value > 0
  }
  facts.conversionLabel = conversionLabel(facts)
  return facts
}

// Derived only from the facts above, so the UI can re-label a row it has
// already filtered or edited without going back to the sales cache.
export function conversionLabel(facts = {}) {
  const {
    purchaseCount = 0, qualifyingCount = 0, priorPurchaseCount = 0,
    daysSinceLastPurchase = null, fullyRefunded = false
  } = facts

  if (purchaseCount === 0) return priorPurchaseCount > 0 ? 'Existing customer' : 'Not converted'
  if (fullyRefunded) return 'Refunded'
  if (qualifyingCount === 0) {
    // Bought something, but nothing that counts as taking up the service.
    return facts.itemGroups && !String(facts.itemGroups).includes('Intro offer') ? 'Retail only' : 'Trial purchase'
  }
  if (daysSinceLastPurchase !== null && daysSinceLastPurchase > LAPSED_AFTER_DAYS) return 'Lapsed'
  return qualifyingCount > 1 ? 'Repeat customer' : 'Converted'
}

export const LABEL_TONES = Object.fromEntries(CONVERSION_LABELS.map(entry => [entry.label, entry.tone]))
