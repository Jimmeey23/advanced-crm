// Normalises Momence payment-item names into a small set of commercial
// buckets.
//
// The raw names are studio-authored and there are ~750 of them: the same
// product appears as "Studio Barre 57", "Copper + Cloves Barre 57" and
// "Plash Pilates Barre 57 ", and a membership's term is baked into its name.
// Grouping by the raw string is therefore useless for anything but a lookup,
// so every row also carries a group, a cleaned name, and — where the name
// states them — a term and a pack size.
//
// Rules are ordered: the first match wins, and the order encodes the business
// meaning (an intro offer is an intro offer even though it is also a pack).

export const ITEM_GROUPS = [
  'Unlimited membership',
  'Class pack',
  'Single class',
  'Intro offer',
  'Private training',
  'Class booking',
  'Appointment',
  'Retail',
  'Credits',
  'Gift card',
  'Refund',
  'Tip',
  'Other membership',
  'Unspecified'
]

// Host/venue prefixes that say where a class was sold, not what was sold.
const BRAND_PREFIXES = /^(studio|copper \+ cloves|plash pilates|plash|kwality house[, ]*kemps corner|kenkere house|physique ?57( ?[-x])?)\s*/i

const clean = value => String(value || '').replace(/\s+/g, ' ').trim()

const RULES = [
  { group: 'Refund', test: (name, category) => category === 'refund' || /^refund\b/i.test(name) },
  { group: 'Tip', test: (name, category) => category === 'tip' || /^tips?$/i.test(name) },
  { group: 'Gift card', test: (name, category) => category === 'gift-card' || /gift ?card/i.test(name) },
  { group: 'Credits', test: name => /(^|\b)money-?credit|(\bcredit\b\s*$)|credit pack/i.test(name) },
  // Before packs and unlimiteds: an intro offer is often sold as a 2-class pack.
  { group: 'Intro offer', test: name => /newcomer|2 ?for ?1|intro pack|new client/i.test(name) },
  { group: 'Private training', test: name => /\bprivate\b|\bprivates\b|1[ -]?(on|to)[ -]?1|semi[- ]private/i.test(name) },
  { group: 'Unlimited membership', test: name => /unlimited/i.test(name) },
  { group: 'Class pack', test: name => /\bpack(age)?\b|\bx ?\d+\b|\b\d+ ?class(es)?\b/i.test(name) },
  { group: 'Single class', test: name => /single class|\bdrop[- ]?in\b/i.test(name) },
  { group: 'Appointment', test: (name, category) => category === 'appointment' },
  { group: 'Retail', test: (name, category) => category === 'product' },
  { group: 'Class booking', test: (name, category) => category === 'event' }
]

const TERM_PATTERNS = [
  [/annual|1 ?year|yearly/i, '12 months'],
  [/(\d+)\s*month/i, match => `${match[1]} month${match[1] === '1' ? '' : 's'}`],
  [/(\d+)\s*week/i, match => `${match[1]} week${match[1] === '1' ? '' : 's'}`],
  [/(\d+)\s*day/i, match => `${match[1]} day${match[1] === '1' ? '' : 's'}`]
]

function termOf(name) {
  for (const [pattern, resolve] of TERM_PATTERNS) {
    const match = name.match(pattern)
    if (match) return typeof resolve === 'function' ? resolve(match) : resolve
  }
  return null
}

// The pack size, when the name states one: "12 Class Package", "x 10",
// "Extended 10 Single Class Pack".
function sizeOf(name, group) {
  if (group !== 'Class pack' && group !== 'Private training') return null
  const match = name.match(/\b(\d+)\s*(?:single\s*)?class(?:es)?\b/i) || name.match(/\bx\s?(\d+)\b/i) || name.match(/\b(\d+)\s*(?:class\s*)?pack\b/i)
  return match ? Number(match[1]) : null
}

export function itemGroupOf(row) {
  const name = clean(row?.paymentItem)
  const category = String(row?.paymentCategory || '').toLowerCase()
  if (!name && !category) return 'Unspecified'
  for (const rule of RULES) if (rule.test(name, category)) return rule.group
  // A membership-category sale whose name matches nothing above is still a
  // membership sale; saying so beats a bucket called "Other".
  return category === 'membership' ? 'Other membership' : 'Unspecified'
}

export function normalizeItem(row) {
  const raw = clean(row?.paymentItem)
  const itemGroup = itemGroupOf(row)
  const itemName = clean(raw.replace(BRAND_PREFIXES, '')) || raw || 'Unspecified'
  return {
    itemGroup,
    itemName,
    itemTerm: itemGroup === 'Unlimited membership' ? termOf(raw) : null,
    itemSize: sizeOf(raw, itemGroup)
  }
}

// Applied at read time rather than baked into the cache, so changing a rule
// takes effect on all history immediately instead of needing a re-fetch of
// every month from Momence.
export function withNormalizedItems(rows) {
  return (rows || []).map(row => (row.itemGroup ? row : { ...row, ...normalizeItem(row) }))
}
