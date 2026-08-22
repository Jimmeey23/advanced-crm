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

  return (
    <button
      type="button"
      className="flip-card w-full text-left"
      onClick={() => setFlipped(f => !f)}
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
                  const barColor = isLast ? (lastUp ? '#10b981' : '#3b82f6') : isMax ? '#3b82f6' : undefined
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
          {description && <div className="metric-card-desc">{description}</div>}
          {analysis && <div className="metric-card-analysis">{analysis}</div>}
          <div className="metric-card-pills">
            <TrendPill label="MoM" pct={mom} />
            <TrendPill label="YoY" pct={yoy} />
          </div>
        </div>
      </div>
    </button>
  )
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
