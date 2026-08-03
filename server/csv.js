import Papa from 'papaparse'

export function parseCsv(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: h => (h || '').replace(/^\uFEFF/, '').trim()
  })
  return {
    columns: result.meta.fields || [],
    rows: result.data,
    errors: result.errors || []
  }
}

// Auto-detect a sensible column mapping given the available columns.
export function autoMap(columns) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const map = {}
  const table = {
    fullName: ['fullname', 'name', 'leadname', 'customername'],
    phone: ['phonenumber', 'phone', 'mobile', 'contact', 'mobile number', 'contactnumber'],
    email: ['email', 'emailaddress', 'emailid'],
    createdAt: ['createdat', 'created', 'createddate', 'date', 'leadcreatedat'],
    sourceName: ['sourcename', 'source', 'leadsource'],
    sourceId: ['sourceid'],
    memberId: ['memberid', 'member', 'momenceid', 'customerid'],
    convertedAt: ['convertedtocustomerat', 'convertedat', 'conversiondate', 'wonat'],
    stage: ['stagename', 'stage', 'pipeline'],
    associate: ['associate', 'owner', 'assignedto', 'agent', 'salesrep'],
    remarks: ['remarks', 'notes', 'comments', 'remark', 'lastcomment'],
    center: ['center', 'location', 'studio', 'centerlocation'],
    classType: ['classtype', 'class', 'typeofclass'],
    hostId: ['hostid'],
    status: ['status'],
    channel: ['channel', 'sourcechannel', 'leadchannel'],
    period: ['period'],
    valueEstimate: ['value', 'leadvalue', 'estimatedvalue', 'amount', 'price']
  }
  for (const [field, aliases] of Object.entries(table)) {
    for (const c of columns) {
      if (aliases.includes(norm(c))) {
        map[field] = c
        break
      }
    }
  }

  // Follow-up date/comment pairs: "Follow Up 1 Date" + "Follow Up Comments (1)"
  const followUps = []
  const fuRe = /follow\s*up\s*(\d+)/i
  for (const c of columns) {
    const m = c.match(fuRe)
    if (m) {
      const idx = parseInt(m[1], 10)
      let pair = followUps.find(p => p.index === idx)
      if (!pair) {
        pair = { index: idx, date: null, comments: null }
        followUps.push(pair)
      }
      if (/comment/i.test(c)) pair.comments = c
      else if (/date/i.test(c)) pair.date = c
    }
  }
  followUps.sort((a, b) => a.index - b.index)
  map.followUps = followUps

  return map
}

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
}
const BLANK_DATE = /^(-|n\/?a|na|null|none|unknown|tbd|not\s*set)?$/i

function pad2(n) { return String(n).padStart(2, '0') }
function toIsoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d))
  if (isNaN(dt.getTime()) || dt.getUTCMonth() !== m) return null // rejects e.g. day=31 in a 30-day month
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}
function fullYear(y) {
  if (y >= 100) return y
  return y <= 50 ? 2000 + y : 1900 + y
}

// Parse a date value from a CSV cell that may be in almost any shape:
// ISO, DD/MM/YYYY or MM/DD/YYYY (ambiguous — day-first is assumed, the more
// common convention outside the US, unless the first part can't be a day),
// "31-Dec-2025" / "December 31, 2025", Excel serial numbers, relative
// references ("today", "yesterday", "3 days ago", "last week"), or blank/
// placeholder markers ("-", "N/A"). Returns an ISO "YYYY-MM-DD" string, or
// null if nothing recognizable was found — never throws, so one bad cell
// can't fail an entire import row.
export function parseFlexibleDate(raw, { now = new Date() } = {}) {
  if (raw === null || raw === undefined) return null
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10)

  const s = String(raw).trim()
  if (!s || BLANK_DATE.test(s)) return null

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const addDays = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10)
  const addMonths = (n) => {
    const d = new Date(today)
    d.setUTCMonth(d.getUTCMonth() + n)
    return d.toISOString().slice(0, 10)
  }

  // Relative references
  const low = s.toLowerCase()
  if (low === 'today' || low === 'now') return addDays(0)
  if (low === 'yesterday') return addDays(-1)
  if (low === 'tomorrow') return addDays(1)
  if (low === 'last week') return addDays(-7)
  if (low === 'next week') return addDays(7)
  if (low === 'last month') return addMonths(-1)
  if (low === 'next month') return addMonths(1)
  let m = low.match(/^(\d+)\s*(day|days|wk|week|weeks|mo|month|months)\s*(ago|back|before|earlier)$/)
  if (m) {
    const n = Number(m[1])
    if (/day/.test(m[2])) return addDays(-n)
    if (/wk|week/.test(m[2])) return addDays(-n * 7)
    return addMonths(-n)
  }
  m = low.match(/^(?:in\s*)?(\d+)\s*(day|days|wk|week|weeks|mo|month|months)\s*(from now|later|hence)?$/)
  if (m) {
    const n = Number(m[1])
    if (/day/.test(m[2])) return addDays(n)
    if (/wk|week/.test(m[2])) return addDays(n * 7)
    return addMonths(n)
  }

  // Excel serial date (days since 1899-12-30) — plain integer, plausible range
  if (/^\d{4,6}(\.\d+)?$/.test(s) && !/^(19|20)\d{2}$/.test(s)) {
    const serial = Number(s)
    if (serial > 20000 && serial < 60000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
      if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10)
    }
  }

  // ISO or ISO-datetime — fast path
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return toIsoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])) || null

  // "31 Dec 2025", "Dec 31 2025", "December 31, 2025", "31-Dec-25", "31/Dec/2025"
  m = s.match(/^(\d{1,2})[\s\-/]+([A-Za-z]{3,})[,\s\-/]+(\d{2,4})/)
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    return toIsoDate(fullYear(Number(m[3])), MONTHS[m[2].toLowerCase()], Number(m[1]))
  }
  m = s.match(/^([A-Za-z]{3,})[\s\-/]+(\d{1,2})[,\s\-/]+(\d{2,4})/)
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
    return toIsoDate(fullYear(Number(m[3])), MONTHS[m[1].toLowerCase()], Number(m[2]))
  }

  // Numeric DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, YYYY/MM/DD (any of . / - as separator)
  m = s.match(/^(\d{1,4})[./\-](\d{1,2})[./\-](\d{1,4})/)
  if (m) {
    let [, a, b, c] = m
    a = Number(a); b = Number(b); c = Number(c)
    if (a > 31) { // YYYY-M-D style with a non-ISO separator
      return toIsoDate(fullYear(a), b - 1, c)
    }
    if (c < 100 || c > 31) {
      // a/b/YYYY — one of a,b is day, the other month. Day-first (DD/MM) is
      // assumed unless a can't be a valid day-of-month (then it must be MM/DD).
      const year = fullYear(c)
      if (a > 12 && a <= 31) return toIsoDate(year, b - 1, a) // a must be day
      if (b > 12 && b <= 31) return toIsoDate(year, a - 1, b) // b must be day
      return toIsoDate(year, b - 1, a) // ambiguous — default day-first
    }
  }

  // Last resort — let the JS Date parser have a shot at anything else
  // (RFC 2822, "Mon Dec 31 2025", already-valid ISO datetimes, etc.)
  const native = new Date(s)
  if (!isNaN(native.getTime())) return native.toISOString().slice(0, 10)

  return null
}

export function normalizeStage(value, stages) {
  if (!value || value === '-') return null
  const v = String(value).trim()
  const exact = stages.find(s => s.toLowerCase() === v.toLowerCase())
  if (exact) return exact
  return v
}

export function normalizeStatus(stage, explicitStatus) {
  if (explicitStatus) {
    const s = String(explicitStatus).toLowerCase()
    if (['won', 'lost'].includes(s)) return s
  }
  if (/won|sold|converted/i.test(stage)) return 'won'
  if (/lost|not interested|dead/i.test(stage)) return 'lost'
  return 'open'
}
