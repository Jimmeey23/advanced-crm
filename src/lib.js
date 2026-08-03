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

export const stageClass = (stage) => {
  const key = (stage || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')
  return `stage-${key}` || 'stage-new'
}

export const riskClass = (risk) => `risk-${risk || 'cold'}`

export const scoreColor = (score) => {
  if (score >= 70) return '#34d399'
  if (score >= 45) return '#fbbf24'
  return '#94a3b8'
}

export const AVATAR_COLORS = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6', '#e11d48', '#7c3aed']

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
