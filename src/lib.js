// Default views (dashboard, pipeline, leads table) scope to the current
// calendar month unless the user explicitly widens the range.
export const currentMonthRange = () => {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const pad = n => String(n).padStart(2, '0')
  const from = `${y}-${pad(m + 1)}-01`
  const lastDay = new Date(y, m + 1, 0).getDate()
  const to = `${y}-${pad(m + 1)}-${pad(lastDay)}`
  return { dateFrom: from, dateTo: to }
}

export const fmtDate = (iso) => {
  if (!iso || iso === '-' || iso === 'null') return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const fmtDateCompact = (iso) => {
  if (!iso || iso === '-' || iso === 'null') return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  if (isToday) return 'Today'
  // The year is always shown. Dropping it for the current year saved four
  // characters and made a lead created in January indistinguishable from one
  // created in January of any other year — the same omission that lost the
  // year on the way in from the sheet.
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

export const fmtDateTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const timeAgo = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(iso)
}

export const daysFromNow = (dateStr) => {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

export const money = (n, currency = 'INR') => {
  if (n === null || n === undefined) return '—'
  const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 })
  return fmt.format(n)
}

export const initials = (name) =>
  (name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

const normalizedStage = (stage) => String(stage || 'Unspecified').trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ')

/* ------------------------------------------------------------
   STAGE PALETTE
   One ramp, ten hues, all at the same OKLCH lightness and chroma.
   Uniform L/C is the point: with per-hue Tailwind values (a 500
   blue next to a 500 amber) the amber badge reads twice as loud
   as the blue one and the column looks scattered. Fixed L/C
   means hue carries the meaning and nothing else varies.
   `solid` is the badge ink/tint source on dark, `badge` the
   darker step light mode needs to clear 4.5:1 on white.
   ------------------------------------------------------------ */
const STAGE_HUES = {
  blue:    248,
  indigo:  272,
  violet:  292,
  magenta: 328,
  rose:    18,
  orange:  48,
  amber:   72,
  green:   145,
  teal:    178,
  cyan:    212
}

const stageTone = (hue) => ({
  solid: `oklch(0.72 0.135 ${hue})`,
  badge: `oklch(0.52 0.145 ${hue})`,
  hover: `oklch(0.45 0.14 ${hue})`
})

const STAGE_TONES = Object.fromEntries(
  Object.entries(STAGE_HUES).map(([name, hue]) => [name, stageTone(hue)])
)

/* Hash fallback draws only from hues no semantic rule claims, so an
   unmapped stage can never borrow won-green or lost-rose. */
const STAGE_BADGE_PALETTE = [
  STAGE_TONES.indigo,
  STAGE_TONES.violet,
  STAGE_TONES.magenta,
  STAGE_TONES.cyan,
  STAGE_TONES.teal,
  STAGE_TONES.amber
]

const semanticStageColor = (key) => {
  if (/won|enrolled|membership purchased|converted/.test(key)) return STAGE_TONES.green
  if (/lost|not interested|disqual|declined/.test(key)) return STAGE_TONES.rose
  if (/trial completed|positive trial/.test(key)) return STAGE_TONES.teal
  if (/trial scheduled|trial booked|trial rescheduled/.test(key)) return STAGE_TONES.cyan
  if (/unresponsive|no response|not answering|did not answer/.test(key)) return STAGE_TONES.orange
  if (/follow.?up|will get back|later date/.test(key)) return STAGE_TONES.violet
  if (/proposal|pricing|package|payment|exclusive deal/.test(key)) return STAGE_TONES.magenta
  if (/new enquiry|initial contact|introductory/.test(key)) return STAGE_TONES.blue
  return null
}

export const stageColor = (stage) => {
  const key = normalizedStage(stage)
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const unsigned = hash >>> 0
  const color = semanticStageColor(key) || STAGE_BADGE_PALETTE[unsigned % STAGE_BADGE_PALETTE.length]
  return {
    solid: color.solid,
    badge: color.badge,
    badgeHover: color.hover,
    background: `color-mix(in srgb, ${color.solid} 16%, transparent)`,
    border: `color-mix(in srgb, ${color.solid} 46%, transparent)`,
    ink: `color-mix(in srgb, ${color.solid} 35%, white)`,
    lightInk: color.badge,
    lightBackground: `color-mix(in srgb, ${color.solid} 13%, transparent)`
  }
}

export const stageBadgeStyle = (stage) => {
  const color = stageColor(stage)
  return {
    '--stage-solid': color.solid,
    '--stage-badge-bg': color.badge,
    '--stage-badge-hover': color.badgeHover,
    '--stage-bg': color.background,
    '--stage-border': color.border,
    '--stage-ink': color.ink,
    '--stage-light-ink': color.lightInk,
    '--stage-light-bg': color.lightBackground
  }
}

export const stageClass = () => 'stage-badge'

export const riskClass = (risk) => `risk-${risk || 'cold'}`

export const scoreColor = (score) => {
  if (score >= 70) return '#34d399'
  if (score >= 45) return '#fbbf24'
  return '#94a3b8'
}

export const AVATAR_COLORS = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6', '#e11d48', '#7c3aed']

// Longest-dialing-code-first so e.g. +1242 (Bahamas) isn't mistaken for +1 (US).
const COUNTRY_CALLING_CODES = [
  ['1242', '🇧🇸'], ['1246', '🇧🇧'], ['971', '🇦🇪'], ['966', '🇸🇦'], ['974', '🇶🇦'], ['965', '🇰🇼'],
  ['973', '🇧🇭'], ['968', '🇴🇲'], ['880', '🇧🇩'], ['977', '🇳🇵'], ['960', '🇲🇻'], ['94', '🇱🇰'],
  ['92', '🇵🇰'], ['91', '🇮🇳'], ['86', '🇨🇳'], ['82', '🇰🇷'], ['81', '🇯🇵'], ['65', '🇸🇬'],
  ['66', '🇹🇭'], ['60', '🇲🇾'], ['63', '🇵🇭'], ['62', '🇮🇩'], ['64', '🇳🇿'], ['61', '🇦🇺'],
  ['49', '🇩🇪'], ['44', '🇬🇧'], ['41', '🇨🇭'], ['39', '🇮🇹'], ['34', '🇪🇸'], ['33', '🇫🇷'],
  ['31', '🇳🇱'], ['27', '🇿🇦'], ['20', '🇪🇬'], ['1', '🇺🇸']
]
export const phoneCountryFlag = (phone) => {
  const digits = String(phone || '').replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) {
    const bare = digits.slice(1)
    const hit = COUNTRY_CALLING_CODES.find(([code]) => bare.startsWith(code))
    if (hit) return hit[1]
  } else if (digits.length > 10) {
    const hit = COUNTRY_CALLING_CODES.find(([code]) => digits.startsWith(code))
    if (hit) return hit[1]
  }
  return '🇮🇳'
}

// ---------- Airtable-style column engine ----------
// Base (built-in) fields available to formula/lookup columns and the table.
export function baseColumnValue(id, l, lookup) {
  const owner = lookup?.asnById?.[l.associateId]
  const loc = lookup?.locById?.[l.locationId]
  switch (id) {
    case 'phone': return l.phone || ''
    case 'source': return l.sourceName || ''
    case 'owner': return owner?.name || 'Unassigned'
    case 'location': return loc?.name || ''
    case 'score': return l.ai?.score ?? null
    case 'risk': return l.ai?.risk || ''
    case 'valueEstimate': return l.valueEstimate ?? null
    case 'classType': return l.classType || ''
    case 'missedCount': return l.fu?.missedCount ?? 0
    case 'lastOutreachDays': return l.fu?.lastOutreachDays ?? null
    case 'created': return l.createdAt || ''
    case 'remarks': return l.remarks || ''
    case 'stage': return l.stage || ''
    case 'status': return l.status || ''
    case 'statusGroup': return l.statusGroup || ''
    case 'trialDate': return l.trialDate || l.momenceEvidence?.trialDate || ''
    // The member's first PAID purchase of a service, from the sales cache:
    // retail, money-credit top-ups, newcomer 2-for-1s and zero-value comps are
    // not first purchases. The stored fields are only a fallback for a lead
    // whose sales history has not been cached yet.
    case 'firstPurchaseDate': return l.sales?.firstPaidPurchaseDate || l.firstPurchaseDate || l.momenceEvidence?.firstPurchaseDate || ''
    case 'firstPurchaseItem': return l.sales?.firstPaidPurchaseItem || ''
    case 'fullName': return l.fullName || ''
    case 'email': return l.email || ''
    // ---- Momence sales (server folds these on as `lead.sales`) ----
    case 'conversionLabel': return l.sales?.conversionLabel || 'Not converted'
    case 'purchaseCount': return l.sales?.purchaseCount ?? 0
    case 'lifetimeValue': return l.sales?.lifetimeValue ?? 0
    case 'averageOrderValue': return l.sales?.averageOrderValue ?? 0
    case 'lastPurchaseDate': return l.sales?.lastPurchaseDate || ''
    case 'firstPurchaseItem': return l.sales?.firstPurchaseItem || ''
    case 'lastPurchaseItem': return l.sales?.lastPurchaseItem || ''
    case 'itemGroups': return l.sales?.itemGroups || ''
    case 'discountTotal': return l.sales?.discountTotal ?? 0
    case 'discountCodes': return l.sales?.discountCodes || ''
    case 'refundedTotal': return l.sales?.refundedTotal ?? 0
    case 'paidInCredits': return l.sales?.paidInCredits ?? 0
    case 'daysToConvert': return l.sales?.daysToConvert ?? null
    case 'daysSincePurchase': return l.sales?.daysSinceLastPurchase ?? null
    case 'purchaseLocations': return l.sales?.purchaseLocations || ''
    default: return ''
  }
}

const FORMULA_CONTEXT_FIELDS = [
  'fullName', 'phone', 'email', 'source', 'owner', 'location', 'score', 'risk',
  'valueEstimate', 'classType', 'missedCount', 'lastOutreachDays', 'created', 'remarks', 'stage', 'status', 'trialDate', 'firstPurchaseDate',
  'conversionLabel', 'purchaseCount', 'lifetimeValue', 'averageOrderValue', 'lastPurchaseDate', 'firstPurchaseItem',
  'firstPurchaseItem', 'lastPurchaseItem', 'itemGroups', 'discountTotal', 'discountCodes', 'refundedTotal', 'paidInCredits',
  'daysToConvert', 'daysSincePurchase', 'purchaseLocations'
]

export function buildFormulaContext(l, lookup) {
  const ctx = {}
  for (const f of FORMULA_CONTEXT_FIELDS) ctx[f] = baseColumnValue(f, l, lookup)
  return ctx
}

// Formulas are short JS expressions the user types for their own saved column
// config (e.g. "score * 2" or "valueEstimate > 50000 ? 'big' : 'small'").
// Scoped to just the lead's field values via `with` — no DOM/network access
// beyond what a same-origin <script> already has in this app.
export function evalFormula(formula, ctx) {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(ctx), `try { return (${formula}); } catch (e) { return null; }`)
    return fn(...Object.values(ctx))
  } catch (e) {
    return null
  }
}

export function lookupColumnValue(relatedTable, relatedField, l, lookup) {
  const src = relatedTable === 'associate' ? lookup?.asnById?.[l.associateId] : lookup?.locById?.[l.locationId]
  return src?.[relatedField] ?? null
}

export function formatColumnValue(value, col) {
  if (value === null || value === undefined || value === '') return '—'
  const decimals = col.decimals ?? 0
  switch (col.type) {
    case 'number': {
      const n = Number(value)
      if (isNaN(n)) return String(value)
      return `${n.toFixed(decimals)}${col.unit ? ` ${col.unit}` : ''}`
    }
    case 'currency': return money(Number(value) || 0)
    case 'percent': {
      const n = Number(value)
      if (isNaN(n)) return String(value)
      return `${n.toFixed(decimals)}%`
    }
    case 'date': return fmtDate(value)
    default: return String(value)
  }
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
