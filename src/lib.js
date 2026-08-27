export const fmtDate = (iso) => {
  if (!iso || iso === '-' || iso === 'null') return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const fmtDateTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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

const STAGE_BADGE_PALETTE = [
  { solid: '#3b82f6', badge: '#2563eb', hover: '#1d4ed8' }, // cobalt
  { solid: '#8b5cf6', badge: '#7c3aed', hover: '#6d28d9' }, // violet
  { solid: '#ec4899', badge: '#be185d', hover: '#9d174d' }, // magenta
  { solid: '#14b8a6', badge: '#0f766e', hover: '#115e59' }, // teal
  { solid: '#f97316', badge: '#c2410c', hover: '#9a3412' }, // orange
  { solid: '#06b6d4', badge: '#0e7490', hover: '#155e75' }  // cyan
]

const semanticStageColor = (key) => {
  if (/won|enrolled|membership purchased|converted/.test(key)) return { solid: '#10b981', badge: '#047857', hover: '#065f46' }
  if (/lost|not interested|disqual|declined/.test(key)) return { solid: '#f43f5e', badge: '#be123c', hover: '#9f1239' }
  if (/trial completed|positive trial/.test(key)) return { solid: '#14b8a6', badge: '#0f766e', hover: '#115e59' }
  if (/trial scheduled|trial booked|trial rescheduled/.test(key)) return { solid: '#06b6d4', badge: '#0e7490', hover: '#155e75' }
  if (/unresponsive|no response|not answering|did not answer/.test(key)) return { solid: '#f97316', badge: '#c2410c', hover: '#9a3412' }
  if (/follow.?up|will get back|later date/.test(key)) return { solid: '#a855f7', badge: '#7e22ce', hover: '#6b21a8' }
  if (/proposal|pricing|package|payment|exclusive deal/.test(key)) return { solid: '#ec4899', badge: '#be185d', hover: '#9d174d' }
  if (/new enquiry|initial contact|introductory/.test(key)) return { solid: '#3b82f6', badge: '#2563eb', hover: '#1d4ed8' }
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
    case 'trialDate': return l.trialDate || ''
    case 'firstPurchaseDate': return l.firstPurchaseDate || ''
    case 'fullName': return l.fullName || ''
    case 'email': return l.email || ''
    default: return ''
  }
}

const FORMULA_CONTEXT_FIELDS = [
  'fullName', 'phone', 'email', 'source', 'owner', 'location', 'score', 'risk',
  'valueEstimate', 'classType', 'missedCount', 'lastOutreachDays', 'created', 'remarks', 'stage', 'status', 'trialDate', 'firstPurchaseDate'
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
