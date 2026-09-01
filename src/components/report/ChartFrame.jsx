// One chart component for every plotted series on the report pages.
//
// It owns the parts that were previously copy-pasted (and drifted) per chart:
// the series toggles, the chart-type switch, a legend that is always present
// for two or more series, the hover tooltip, and the table view that makes the
// same numbers readable without colour. Marks follow the dataviz spec — 2px
// lines, rounded 4px data-ends on bars, recessive grid, no dual axis.
import React, { useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'
import { LineChart as LineIcon, BarChart3, AreaChart as AreaIcon, Table2 } from 'lucide-react'
import { useApp } from '../../store.jsx'
import { seriesColor } from '../../chartPalette.js'

const TYPES = [
  { value: 'line', label: 'Line', icon: LineIcon },
  { value: 'area', label: 'Area', icon: AreaIcon },
  { value: 'bar', label: 'Bar', icon: BarChart3 }
]

function ReportTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rp-tooltip">
      <div className="rp-tooltip-label">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="rp-tooltip-row">
          <span className="rp-tooltip-swatch" style={{ background: p.color }} />
          <span className="rp-tooltip-name">{p.name}</span>
          <span className="rp-tooltip-value">{formatter ? formatter(p.value, p.dataKey) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function ChartFrame({
  data = [],
  series = [],            // [{ key, label, format? }]
  xKey = 'label',
  height = 240,
  defaultType = 'line',
  allowTypes = true,
  valueFormat,
  onPointClick,
  emptyText = 'No data in this period.'
}) {
  const { theme } = useApp()
  const mode = theme === 'light' ? 'light' : 'dark'
  const [type, setType] = useState(defaultType)
  const [hidden, setHidden] = useState(() => new Set())
  const [tableView, setTableView] = useState(false)

  const colored = useMemo(
    // Slot is fixed by declaration order, so hiding a series never repaints
    // the ones that remain.
    () => series.map((s, i) => ({ ...s, color: s.color || seriesColor(i, mode) })),
    [series, mode]
  )
  const shown = colored.filter(s => !hidden.has(s.key))
  const toggle = (key) => setHidden(h => {
    const next = new Set(h)
    if (next.has(key)) next.delete(key)
    // Never hide the last visible series — an empty plot is not a state
    // anyone chose deliberately.
    else if (shown.length > 1) next.add(key)
    return next
  })

  const axis = { fill: 'var(--rp-axis)', fontSize: 10.5 }
  const grid = 'var(--rp-grid)'
  const handleClick = onPointClick ? (payload) => payload?.activeLabel !== undefined && onPointClick(payload.activeLabel, payload) : undefined

  const body = () => {
    if (!data.length) return <p className="rp-empty">{emptyText}</p>
    if (tableView) {
      return (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead>
              <tr>
                <th>{xKey === 'label' ? 'Period' : xKey}</th>
                {colored.map(s => <th key={s.key} className="is-right">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  <td>{row[xKey]}</td>
                  {colored.map(s => <td key={s.key} className="is-right rp-num">{valueFormat ? valueFormat(row[s.key], s.key) : row[s.key]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    const common = {
      data,
      margin: { top: 6, right: 8, left: -14, bottom: 0 },
      onClick: handleClick
    }
    const axes = (
      <>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey={xKey} tick={axis} axisLine={false} tickLine={false} />
        <YAxis tick={axis} axisLine={false} tickLine={false} width={46} />
        <Tooltip content={<ReportTooltip formatter={valueFormat} />} cursor={{ stroke: 'var(--rp-cursor)', strokeWidth: 1 }} />
        {shown.length > 1 && <Legend verticalAlign="top" height={26} iconType="plainline" iconSize={12} wrapperStyle={{ fontSize: 11, color: 'var(--rp-axis)' }} />}
      </>
    )
    if (type === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart {...common} barGap={2}>
            {axes}
            {shown.map(s => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={26} />)}
          </BarChart>
        </ResponsiveContainer>
      )
    }
    if (type === 'area') {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart {...common}>
            <defs>
              {shown.map(s => (
                <linearGradient key={s.key} id={`rpfill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {axes}
            {shown.map(s => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={`url(#rpfill-${s.key})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )
    }
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart {...common}>
          {axes}
          {shown.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <div className="rp-chart">
      <div className="rp-chart-controls">
        <div className="rp-series-toggles">
          {colored.map(s => (
            <button
              key={s.key}
              type="button"
              className={`rp-series-toggle ${hidden.has(s.key) ? 'is-off' : ''}`}
              onClick={() => toggle(s.key)}
              aria-pressed={!hidden.has(s.key)}
            >
              <span className="rp-swatch" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
        <div className="rp-chart-modes">
          {allowTypes && TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              className={type === t.value && !tableView ? 'is-active' : ''}
              onClick={() => { setType(t.value); setTableView(false) }}
              title={`${t.label} chart`}
              aria-label={`${t.label} chart`}
            >
              <t.icon size={12} />
            </button>
          ))}
          <button
            type="button"
            className={tableView ? 'is-active' : ''}
            onClick={() => setTableView(v => !v)}
            title="Table view"
            aria-label="Table view"
          >
            <Table2 size={12} />
          </button>
        </div>
      </div>
      {body()}
    </div>
  )
}
