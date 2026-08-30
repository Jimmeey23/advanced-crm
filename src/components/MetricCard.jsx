import React from 'react'
import { Info, X, ArrowUpRight, ArrowDownRight } from 'lucide-react'
// NOTE: this app toggles theme via [data-theme] attribute, not Tailwind's `dark:` variant,
// so custom classes (mcard-*) are used here with matching rules in index.css for both themes.

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
  const [flipped, setFlipped] = React.useState(false)

  React.useEffect(() => {
    if (!flipped) return
    const handleFlip = (e) => {
      if (e.detail !== title) setFlipped(false)
    }
    window.addEventListener('metric-flip', handleFlip)
    return () => window.removeEventListener('metric-flip', handleFlip)
  }, [flipped, title])

  const toggle = (e) => {
    e?.preventDefault()
    e?.stopPropagation()
    const next = !flipped
    setFlipped(next)
    if (next) window.dispatchEvent(new CustomEvent('metric-flip', { detail: title }))
  }

  const hasTrend = trend.length > 0
  const max = Math.max(1, ...trend.map(t => Math.abs(t.value) || 0))
  const maxIdx = hasTrend
    ? trend.reduce((bi, t, i, arr) => (Math.abs(t.value) > Math.abs(arr[bi].value) ? i : bi), 0)
    : -1
  const lastIdx = trend.length - 1

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      className={`flip-card w-full h-full text-left group flex flex-col ${flipped ? 'z-20 relative' : ''}`}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggle()
        }
      }}
      style={{ '--metric-accent': color }}
    >
      <div className={`flip-card-inner flex-1 w-full !h-[154px] !min-h-[154px] ${flipped ? 'is-flipped' : ''} transition-transform duration-500`} style={{ transitionTimingFunction: 'initial' }}>

        {/* --- FRONT SIDE --- */}
        <div
          className="flip-face card mcard-front !absolute inset-0 flex flex-col justify-start items-start cursor-pointer transition-all duration-300 hover:-translate-y-0.5"
          style={{ animation: 'none', WebkitTransform: 'translateZ(1px)', WebkitBackfaceVisibility: 'hidden' }}
        >
          {/* decorative floating glow blobs, clipped to the card's rounded corners */}
          <div className="mcard-glow-layer">
            <span className="mcard-glow mcard-glow-a" style={{ background: color }} />
            <span className="mcard-glow mcard-glow-b" style={{ background: color }} />
          </div>

          {/* Top Row: icon + label, with divider below, info tooltip at the right */}
          <div className="mcard-head flex items-center justify-between w-full mb-3 pb-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="mcard-icon flex items-center justify-center w-[24px] h-[24px] rounded-full shrink-0" style={{ background: color }}>
                {Icon ? <Icon size={12} strokeWidth={2.5} color="#ffffff" /> : null}
              </span>
              <span className="mcard-title font-bold text-sm tracking-tight truncate">{title}</span>
            </div>
            <InfoTip text={description || defaultSummary(title, value)} />
          </div>

          {/* Value row: sits on its own line below the label */}
          <div className="relative z-10 w-full mb-3">
            <div className="mcard-value leading-none tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {value}
            </div>
          </div>

          {/* Bottom Row: MOM and YOY */}
          <div className="mt-auto relative z-10 flex w-full gap-2.5">
             <TrendBox label="MOM" pct={mom} />
             <TrendBox label="YOY" pct={yoy} />
          </div>
        </div>

        {/* --- BACK SIDE --- */}
        <div
          className="flip-face card mcard-back !absolute inset-0 flip-face-back flex flex-col cursor-pointer"
          style={{ animation: 'none', WebkitTransform: 'rotateY(180deg) translateZ(1px)', WebkitBackfaceVisibility: 'hidden' }}
        >
          <div className="mcard-glow-layer">
            <span className="mcard-glow mcard-glow-a" style={{ background: color }} />
          </div>

          <div className="relative z-10 flex justify-between items-start mb-2.5 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="mcard-back-title text-xs font-bold uppercase tracking-widest truncate">{title}</span>
            </div>
            <button className="mcard-x w-[22px] h-[22px] shrink-0 flex items-center justify-center rounded-full transition-colors">
              <X size={13} strokeWidth={2.5} />
            </button>
          </div>

          <div className="mcard-desc relative z-10 text-xs font-medium mb-2.5 line-clamp-2 shrink-0 leading-relaxed">
            {description || defaultSummary(title, value)}
          </div>

          {hasTrend && (
            <div className="mcard-chart-wrap relative z-10 flex-1 flex flex-col justify-end min-h-0 pt-2">
              <div className="h-[36px] flex items-end gap-[3px] shrink-0">
                {trend.map((t, i) => {
                  const h = Math.max(12, Math.round((Math.abs(t.value) / max) * 100))
                  const isLast = i === lastIdx
                  const isMax = i === maxIdx
                  const [m, y] = splitLabel(t.label)
                  const edge = i === 0 ? 'left' : i === lastIdx ? 'right' : 'center'

                  return (
                    <div key={i} className="flex-1 h-full flex flex-col items-center justify-end relative group/bar cursor-crosshair">
                      <div
                        className={`mcard-bar w-[80%] max-w-[12px] rounded-t-sm transition-opacity duration-200 hover:opacity-100 ${isLast ? 'mcard-bar-active' : isMax ? 'mcard-bar-peak' : ''}`}
                        style={{ height: `${h}%`, ...(isLast ? { background: color } : {}) }}
                      />
                      <div className="mcard-bar-label mt-1 text-center font-bold" style={{ fontSize: '7.5px', lineHeight: '8px', letterSpacing: '-0.02em', WebkitTransform: 'scale(0.9)', transformOrigin: 'center' }}>
                        <div>{m}</div>
                        <div>{y}</div>
                      </div>

                      {/* Tooltip: rendered above the bar so it never gets clipped by the card edge */}
                      <div
                        className={`mcard-tooltip2 bottom-[calc(100%+9px)] group-hover/bar:opacity-100 group-hover/bar:translate-y-0 group-hover/bar:scale-100 whitespace-nowrap ${
                          edge === 'left' ? 'left-0' : edge === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
                        }`}
                      >
                        <span className="font-semibold opacity-70 mr-1.5">{t.label}</span>
                        <span className="font-extrabold">{t.value}</span>
                        <div
                          className={`mcard-tooltip2-arrow ${edge === 'left' ? 'left-3' : edge === 'right' ? 'right-3' : 'left-1/2 -translate-x-1/2'}`}
                          style={{ bottom: '-4px', transform: `rotate(45deg) ${edge === 'center' ? 'translateX(-50%)' : ''}` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoTip({ text }) {
  return (
    <span className="mcard-info-wrap relative inline-flex items-center shrink-0 group/info">
      <Info size={12} className="mcard-info opacity-60 transition-colors" />
      <span className="mcard-tooltip2 mcard-info-tip top-[calc(100%+8px)] right-0 group-hover/info:opacity-100 group-hover/info:translate-y-0 group-hover/info:scale-100 normal-case font-medium">
        {text}
        <span className="mcard-tooltip2-arrow" style={{ top: '-4px', right: '8px', transform: 'rotate(45deg)' }} />
      </span>
    </span>
  )
}

function TrendBox({ label, pct }) {
  if (pct === undefined || pct === null || Number.isNaN(pct)) {
    return (
      <div className="mcard-trendbox flex-1 flex flex-col rounded-[10px] py-1.5 px-2.5 items-center justify-center">
        <div className="mcard-trendbox-label text-2xs font-bold uppercase tracking-widest">{label}</div>
        <div className="mcard-trendbox-empty text-base font-extrabold mt-[1px]">—</div>
      </div>
    )
  }
  const up = pct >= 0
  const rounded = Math.round(Math.abs(pct))
  return (
    <div className="mcard-trendbox flex-1 flex flex-col rounded-[10px] py-1.5 px-2.5 items-center justify-center transition-colors">
      <div className="mcard-trendbox-label text-2xs font-bold uppercase tracking-widest">{label}</div>
      <div className={`mt-[1px] text-base font-extrabold flex items-center justify-center gap-[1px] ${up ? 'mcard-trendbox-up' : 'mcard-trendbox-down'}`}>
        {up ? <ArrowUpRight size={14} strokeWidth={2.5} /> : <ArrowDownRight size={14} strokeWidth={2.5} />}
        {up ? '+' : '-'}{rounded}%
      </div>
    </div>
  )
}

function splitLabel(lbl = '') {
  const parts = lbl.trim().split(' ')
  if (parts.length === 1) return [parts[0], '']
  return [parts[0].slice(0, 3) || '', parts[1].slice(-2) || '']
}

function defaultSummary(title, value) {
  return `${title || 'This metric'} is currently ${value ?? '—'} for the selected scope and period.`
}
