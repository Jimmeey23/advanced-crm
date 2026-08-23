import React, { useState } from 'react'
import { X, Info, ArrowUpRight, ArrowDownRight } from 'lucide-react'

/**
 * Shared flip metric card.
 * Front: title, big value, 12-point trend bars.
 * Back: icon + title, value, description, MoM/YoY pills.
 */
export default function MetricCard({
  icon: Icon,
  color = '#64748b',
  title,
  value,
  description,
  calculation,
  trend = [],
  mom,
  yoy,
}) {
  const [flipped, setFlipped] = useState(false)
  const hasTrend = trend.length > 0
  const max = Math.max(1, ...trend.map(t => Math.abs(t.value) || 0))
  const maxIdx = hasTrend
    ? trend.reduce((bi, t, i, arr) => (Math.abs(t.value) > Math.abs(arr[bi].value) ? i : bi), 0)
    : -1
  const lastIdx = trend.length - 1
  const lastUp = lastIdx > 0 && trend[lastIdx].value >= trend[lastIdx - 1].value
  const analysis = buildAnalysis(title, trend, mom, yoy)

  const toggle = () => setFlipped(f => !f)

  return (
    <div
      role="button"
      tabIndex={0}
      className="flip-card w-full text-left"
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggle()
        }
      }}
      title="Click for more analytics"
      style={{ '--metric-accent': color }}
    >
      <div className={`flip-card-inner card reference-metric-card metric-card-v2 ${flipped ? 'is-flipped' : ''}`}>
        <div className="flip-face metric-card-front">
          <div className="flex items-center justify-between">
            <span className="metric-card-title">{title}</span>
            <span className="metric-card-x"><X size={12} /></span>
          </div>
          <div className="metric-card-value">{value}</div>
          {hasTrend && (
            <div className="metric-card-trend">
              <div className="metric-card-trend-label">12-month trend</div>
              <div className="metric-card-bars">
                {trend.map((t, i) => {
                  const h = Math.max(6, Math.round((Math.abs(t.value) / max) * 100))
                  const isLast = i === lastIdx
                  const isMax = i === maxIdx && !isLast
                  const barColor = isLast || isMax ? 'var(--metric-accent)' : undefined
                  return (
                    <div key={i} className="metric-card-bar-col">
                      <div
                        className="metric-card-bar"
                        style={{ height: `${h}%`, background: barColor }}
                      />
                      <span className="metric-card-bar-label">{t.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flip-face flip-face-back metric-card-back">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="metric-card-icon" style={{ background: `${color}22`, color }}>
                {Icon ? <Icon size={14} /> : null}
              </span>
              <span className="metric-card-back-title truncate">{title}</span>
              <Info size={12} className="text-slate-500 shrink-0" />
            </div>
            <span className="metric-card-value metric-card-value-sm">{value}</span>
          </div>
          <div className="metric-card-desc">
            <strong>Summary:</strong> {description || defaultSummary(title, value)}
          </div>
          <div className="metric-card-calc">
            <strong>Calculation:</strong> {calculation || defaultCalculation(title)}
          </div>
          {analysis && <div className="metric-card-analysis">{analysis}</div>}
          <div className="metric-card-pills">
            <TrendPill label="MoM" pct={mom} />
            <TrendPill label="YoY" pct={yoy} />
          </div>
        </div>
      </div>
    </div>
  )
}

function defaultSummary(title, value) {
  return `${title || 'This metric'} is currently ${value ?? '—'} for the selected scope and period.`
}

function defaultCalculation(title) {
  const name = (title || '').toLowerCase()
  if (name.includes('open lead')) return 'Count of leads where status is open, excluding won and lost records.'
  if (name.includes('new lead')) return 'Count of leads created during the selected reporting period.'
  if (name.includes('trial')) return 'Count of leads in trial-booked or trial-completed stages during the selected period.'
  if (name.includes('won')) return 'Count of closed-won leads using their conversion date when available.'
  if (name.includes('revenue')) return 'Sum of value estimates for closed-won leads in the selected period.'
  if (name.includes('follow')) return 'Completed follow-ups divided by total scheduled/logged follow-ups.'
  if (name.includes('response')) return 'Average elapsed time between logged member touchpoints.'
  if (name.includes('overdue')) return 'Count of follow-ups with due dates before today and not marked done.'
  return 'Computed from the filtered lead, associate, studio, and follow-up records in this view.'
}

function buildAnalysis(title, trend, mom, yoy) {
  const name = (title || 'This metric').toLowerCase()
  const parts = []

  if (trend.length >= 2) {
    const best = trend.reduce((b, t) => (t.value > b.value ? t : b), trend[0])
    const worst = trend.reduce((w, t) => (t.value < w.value ? t : w), trend[0])
    const dir = mom > 0 ? 'trending up' : mom < 0 ? 'trending down' : 'holding steady'
    parts.push(`${cap(name)} is ${dir} month over month.`)
    if (best.value !== worst.value) {
      parts.push(`Peaked in ${best.label}, lowest in ${worst.label}.`)
    }
  } else if (mom !== undefined && mom !== null && !Number.isNaN(mom)) {
    parts.push(`${cap(name)} moved ${mom >= 0 ? 'up' : 'down'} ${Math.abs(mom).toFixed(1)}% vs. the prior period.`)
  }

  if (yoy !== undefined && yoy !== null && !Number.isNaN(yoy)) {
    parts.push(`${yoy >= 0 ? 'Up' : 'Down'} ${Math.abs(yoy).toFixed(1)}% compared to the same period last year.`)
  }

  return parts.join(' ')
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1) }

function TrendPill({ label, pct }) {
  if (pct === undefined || pct === null || Number.isNaN(pct)) {
    return (
      <div className="metric-card-pill">
        <div className="metric-card-pill-label">{label}</div>
        <div className="metric-card-pill-value text-slate-500">—</div>
      </div>
    )
  }
  const up = pct >= 0
  return (
    <div className="metric-card-pill">
      <div className="metric-card-pill-label">{label}</div>
      <div className={`metric-card-pill-value ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
        {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
        {Math.abs(pct).toFixed(1)}%
      </div>
    </div>
  )
}
