// Pivot engine: pure, synchronous, and independent of React so the same
// code can compute a preview, an export and a saved view without drift.
//
// The shape it produces is deliberately a tree rather than a flat matrix —
// nested rows and columns are the point of this builder, and a tree is what
// lets subtotals live at the level they summarise instead of being
// recomputed from flattened keys.

export const BLANK = '—'

/* ------------------------------------------------------------------ *
 * Date bucketing
 * ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const DATE_GRAINS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week (Mon)' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
  { id: 'fiscalYear', label: 'Fiscal year (Apr–Mar)' },
  { id: 'monthOfYear', label: 'Month of year' },
  { id: 'dayOfWeek', label: 'Day of week' },
  { id: 'hour', label: 'Hour of day' }
]

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return isNaN(value) ? null : value
  const raw = String(value).trim()
  if (!raw || raw === '-' || raw === BLANK) return null
  // dd/mm/yyyy is what the studio sheets use; Date.parse reads that as
  // mm/dd/yyyy and silently produces the wrong month for a third of rows.
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
    return isNaN(d) ? null : d
  }
  const d = new Date(raw)
  return isNaN(d) ? null : d
}

// Sort keys are emitted alongside labels so "Apr 2026" orders after
// "Dec 2025" instead of alphabetically.
export function bucketDate(value, grain) {
  const d = parseDate(value)
  if (!d) return { key: '￿', label: BLANK }
  const y = d.getFullYear()
  const m = d.getMonth()
  const pad = n => String(n).padStart(2, '0')

  switch (grain) {
    case 'day':
      return { key: `${y}-${pad(m + 1)}-${pad(d.getDate())}`, label: `${d.getDate()} ${MONTHS[m]} ${y}` }
    case 'week': {
      const monday = new Date(d)
      // getDay() is 0 on Sunday, which belongs to the week that started six
      // days earlier, not the one starting tomorrow.
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
      return {
        key: `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`,
        label: `w/c ${monday.getDate()} ${MONTHS[monday.getMonth()]} ${monday.getFullYear()}`
      }
    }
    case 'month':
      return { key: `${y}-${pad(m + 1)}`, label: `${MONTHS[m]} ${y}` }
    case 'quarter':
      return { key: `${y}-Q${Math.floor(m / 3) + 1}`, label: `Q${Math.floor(m / 3) + 1} ${y}` }
    case 'year':
      return { key: String(y), label: String(y) }
    case 'fiscalYear': {
      // Indian fiscal year: April through March.
      const start = m >= 3 ? y : y - 1
      return { key: `FY${start}`, label: `FY ${String(start).slice(2)}–${String(start + 1).slice(2)}` }
    }
    case 'monthOfYear':
      return { key: pad(m + 1), label: MONTHS[m] }
    case 'dayOfWeek':
      return { key: String((d.getDay() + 6) % 7), label: DAY_NAMES[d.getDay()] }
    case 'hour':
      return { key: pad(d.getHours()), label: `${pad(d.getHours())}:00` }
    default:
      return { key: `${y}-${pad(m + 1)}`, label: `${MONTHS[m]} ${y}` }
  }
}

/* ------------------------------------------------------------------ *
 * Number formatting
 * ------------------------------------------------------------------ */

export const NUMBER_STYLES = [
  { id: 'plain', label: 'Plain' },
  { id: 'compactIndian', label: 'Indian (K / L / Cr)' },
  { id: 'compactShort', label: 'Short (K / M / B)' },
  { id: 'percent', label: 'Percent' }
]

const INDIAN_UNITS = [
  { limit: 1e7, suffix: 'Cr' },
  { limit: 1e5, suffix: 'L' },
  { limit: 1e3, suffix: 'K' }
]
const SHORT_UNITS = [
  { limit: 1e9, suffix: 'B' },
  { limit: 1e6, suffix: 'M' },
  { limit: 1e3, suffix: 'K' }
]

export function formatValue(value, format = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return format.blank ?? BLANK
  const {
    style = 'plain',
    decimals = 0,
    currency = false,
    prefix = '',
    suffix = ''
  } = format

  const symbol = currency ? '₹' : ''
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (style === 'percent') {
    return `${prefix}${sign}${abs.toFixed(decimals)}%${suffix}`
  }

  const units = style === 'compactIndian' ? INDIAN_UNITS : style === 'compactShort' ? SHORT_UNITS : null
  if (units) {
    const unit = units.find(u => abs >= u.limit)
    if (unit) {
      return `${prefix}${sign}${symbol}${(abs / unit.limit).toFixed(decimals)}${unit.suffix}${suffix}`
    }
  }

  const body = abs.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return `${prefix}${sign}${symbol}${body}${suffix}`
}

/* ------------------------------------------------------------------ *
 * Aggregation
 * ------------------------------------------------------------------ */

export const AGGREGATORS = [
  { id: 'count', label: 'Count', needsField: false },
  { id: 'countDistinct', label: 'Distinct count', needsField: true },
  { id: 'sum', label: 'Sum', needsField: true },
  { id: 'avg', label: 'Average', needsField: true },
  { id: 'min', label: 'Minimum', needsField: true },
  { id: 'max', label: 'Maximum', needsField: true },
  { id: 'median', label: 'Median', needsField: true },
  { id: 'share', label: '% of total', needsField: false }
]

function numbersFrom(rows, field) {
  const out = []
  for (const r of rows) {
    const n = Number(r[field])
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

// `share` is deliberately not computed here — a percentage of the grand
// total cannot be known from a single cell's rows, so it is filled in by a
// second pass once the grand total exists.
export function aggregate(rows, measure) {
  const { agg = 'count', field } = measure
  if (!rows.length) return agg === 'count' || agg === 'countDistinct' ? 0 : null

  switch (agg) {
    case 'count':
    case 'share':
      return rows.length
    case 'countDistinct': {
      const seen = new Set()
      for (const r of rows) {
        const v = r[field]
        if (v !== null && v !== undefined && v !== '') seen.add(v)
      }
      return seen.size
    }
    case 'sum': {
      const nums = numbersFrom(rows, field)
      return nums.reduce((a, b) => a + b, 0)
    }
    case 'avg': {
      const nums = numbersFrom(rows, field)
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
    }
    case 'min': {
      const nums = numbersFrom(rows, field)
      return nums.length ? Math.min(...nums) : null
    }
    case 'max': {
      const nums = numbersFrom(rows, field)
      return nums.length ? Math.max(...nums) : null
    }
    case 'median': {
      const nums = numbersFrom(rows, field).sort((a, b) => a - b)
      if (!nums.length) return null
      const mid = Math.floor(nums.length / 2)
      return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
    }
    default:
      return rows.length
  }
}

/* ------------------------------------------------------------------ *
 * Grouping
 * ------------------------------------------------------------------ */

// One dimension's value for one row, as a {key,label} pair. Keys drive
// sorting and identity; labels are what the header renders, so a renamed
// dimension value changes the label without disturbing grouping.
export function dimensionValue(row, dim) {
  const raw = row[dim.field]
  if (dim.type === 'date') {
    const bucket = bucketDate(raw, dim.grain || 'month')
    return { key: bucket.key, label: dim.renames?.[bucket.key] ?? bucket.label }
  }
  if (dim.type === 'number' && dim.buckets?.length) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return { key: '￿', label: BLANK }
    const edges = [...dim.buckets].sort((a, b) => a - b)
    let i = 0
    while (i < edges.length && n >= edges[i]) i++
    const lo = i === 0 ? null : edges[i - 1]
    const hi = i === edges.length ? null : edges[i]
    const label = lo === null ? `< ${edges[0]}` : hi === null ? `${lo}+` : `${lo}–${hi - 1}`
    return { key: String(i).padStart(3, '0'), label: dim.renames?.[String(i)] ?? label }
  }
  const value = raw === null || raw === undefined || raw === '' ? BLANK : String(raw)
  return { key: value, label: dim.renames?.[value] ?? value }
}

function sortNodes(nodes, dim) {
  const dir = dim?.sortDir === 'desc' ? -1 : 1
  const by = dim?.sortBy || 'key'
  return nodes.sort((a, b) => {
    // Blanks always sort last regardless of direction — a missing value is
    // not "the largest", it is absent, and floating it to the top of every
    // report buries the real data.
    if (a.key === '￿') return 1
    if (b.key === '￿') return -1
    if (by === 'value') return ((a.sortValue ?? 0) - (b.sortValue ?? 0)) * dir
    if (by === 'label') return a.label.localeCompare(b.label) * dir
    return String(a.key).localeCompare(String(b.key), undefined, { numeric: true }) * dir
  })
}

// Recursively groups rows by a list of dimensions, producing a tree whose
// leaves still hold their source rows so any aggregator can run at any level.
function buildTree(rows, dims, depth = 0) {
  if (depth >= dims.length) return null
  const dim = dims[depth]
  const groups = new Map()
  for (const row of rows) {
    const { key, label } = dimensionValue(row, dim)
    let g = groups.get(key)
    if (!g) { g = { key, label, rows: [] }; groups.set(key, g) }
    g.rows.push(row)
  }
  const nodes = [...groups.values()].map(g => ({
    key: g.key,
    label: g.label,
    depth,
    field: dim.field,
    rows: g.rows,
    children: buildTree(g.rows, dims, depth + 1)
  }))
  return sortNodes(nodes, dim)
}

// Depth-first walk producing the visible row list, honouring collapse state
// and emitting subtotal rows where the spec asks for them.
function flattenTree(nodes, { collapsed, subtotals, path = [] }) {
  const out = []
  if (!nodes) return out
  for (const node of nodes) {
    const nodePath = [...path, node.key]
    const pathKey = nodePath.join('␟')
    const isCollapsed = collapsed.has(pathKey)
    const hasChildren = Boolean(node.children?.length)
    out.push({ kind: 'group', node, path: nodePath, pathKey, collapsed: isCollapsed, hasChildren })
    if (hasChildren && !isCollapsed) {
      out.push(...flattenTree(node.children, { collapsed, subtotals, path: nodePath }))
      if (subtotals) out.push({ kind: 'subtotal', node, path: nodePath, pathKey })
    }
  }
  return out
}

// Column headers are a tree too, but they render as stacked header rows, so
// each level is emitted with the span it covers.
function columnLeaves(nodes, path = []) {
  if (!nodes?.length) return [{ path, label: null, leaf: true, rows: null }]
  const out = []
  for (const node of nodes) {
    const nodePath = [...path, node.key]
    if (node.children?.length) out.push(...columnLeaves(node.children, nodePath))
    else out.push({ path: nodePath, label: node.label, leaf: true, rows: node.rows, node })
  }
  return out
}

function columnHeaderRows(nodes, depth = 0, acc = []) {
  if (!nodes?.length) return acc
  acc[depth] = acc[depth] || []
  for (const node of nodes) {
    const span = countLeaves(node)
    acc[depth].push({ key: node.key, label: node.label, span, node })
    if (node.children?.length) columnHeaderRows(node.children, depth + 1, acc)
  }
  return acc
}

function countLeaves(node) {
  if (!node.children?.length) return 1
  return node.children.reduce((n, c) => n + countLeaves(c), 0)
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */

export const EMPTY_SPEC = {
  rows: [],
  cols: [],
  measures: [{ id: 'm1', agg: 'count', label: 'Leads', format: { style: 'plain', decimals: 0 } }],
  filters: [],
  options: {
    rowSubtotals: true,
    colSubtotals: false,
    grandTotalRow: true,
    grandTotalCol: true,
    layout: 'outline',
    showEmpty: false,
    heatmap: false,
    stripes: true,
    compact: false
  }
}

export function applyFilters(rows, filters = []) {
  if (!filters.length) return rows
  return rows.filter(row => filters.every(f => {
    const raw = row[f.field]
    const value = raw === null || raw === undefined || raw === '' ? BLANK : String(raw)
    const set = f.values || []
    if (!set.length) return true
    return f.mode === 'exclude' ? !set.includes(value) : set.includes(value)
  }))
}

// Returns everything the renderer needs: the visible row list, the column
// header levels, the leaf columns, the cell matrix and the totals.
export function buildPivot(sourceRows, spec, collapsed = new Set()) {
  const { rows: rowDims = [], cols: colDims = [], measures = [], options = {} } = spec
  const data = applyFilters(sourceRows, spec.filters)

  const rowTree = buildTree(data, rowDims)
  const colTree = buildTree(data, colDims)

  const visibleRows = rowDims.length
    ? flattenTree(rowTree, { collapsed, subtotals: options.rowSubtotals })
    : [{ kind: 'all', node: { key: '__all__', label: 'All', rows: data, depth: 0 }, path: ['__all__'], pathKey: '__all__' }]

  const headerLevels = columnHeaderRows(colTree)
  const leaves = colDims.length ? columnLeaves(colTree) : [{ path: [], label: null, leaf: true, rows: data }]

  // Rows in a cell = rows in the row-group ∩ rows in the column-group.
  // Intersecting by identity is far cheaper than re-grouping per cell.
  const leafRowSets = leaves.map(l => (l.rows ? new Set(l.rows) : null))

  const cellsFor = (nodeRows) => leaves.map((leaf, i) => {
    const set = leafRowSets[i]
    const cellRows = set ? nodeRows.filter(r => set.has(r)) : nodeRows
    return measures.map(m => aggregate(cellRows, m))
  })

  const body = visibleRows.map(entry => ({
    ...entry,
    cells: cellsFor(entry.node.rows),
    total: measures.map(m => aggregate(entry.node.rows, m))
  }))

  const grandCells = cellsFor(data)
  const grandTotal = measures.map(m => aggregate(data, m))

  // Second pass for "% of total": each measure's grand total is now known.
  measures.forEach((m, mi) => {
    if (m.agg !== 'share') return
    const denom = grandTotal[mi] || 0
    const pct = v => (denom ? (v / denom) * 100 : null)
    body.forEach(r => {
      r.cells.forEach(c => { c[mi] = pct(c[mi]) })
      r.total[mi] = pct(r.total[mi])
    })
    grandCells.forEach(c => { c[mi] = pct(c[mi]) })
    grandTotal[mi] = denom ? 100 : null
  })

  return {
    body,
    leaves,
    headerLevels,
    measures,
    grandCells,
    grandTotal,
    rowDims,
    colDims,
    sourceCount: sourceRows.length,
    filteredCount: data.length
  }
}

// Flattens a computed pivot into rows of strings for CSV export, matching
// exactly what is on screen — including subtotal rows and the grand total.
export function pivotToCsv(pivot, spec) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const measures = pivot.measures
  const header = [
    ...pivot.rowDims.map(d => d.label || d.field),
    ...pivot.leaves.flatMap(leaf =>
      measures.map(m => [leaf.label, m.label].filter(Boolean).join(' · ') || m.label || m.agg))
  ]
  if (spec.options?.grandTotalCol) header.push(...measures.map(m => `Total ${m.label || m.agg}`))

  const lines = [header.map(esc).join(',')]
  for (const row of pivot.body) {
    const indent = row.kind === 'subtotal' ? `${row.node.label} total` : row.node.label
    const cells = [
      ...Array(Math.max(0, row.node.depth || 0)).fill(''),
      indent,
      ...Array(Math.max(0, pivot.rowDims.length - (row.node.depth || 0) - 1)).fill('')
    ].slice(0, Math.max(1, pivot.rowDims.length))
    const values = row.cells.flatMap((c, i) => c.map((v, mi) => formatValue(v, measures[mi].format)))
    const totals = spec.options?.grandTotalCol ? row.total.map((v, mi) => formatValue(v, measures[mi].format)) : []
    lines.push([...cells, ...values, ...totals].map(esc).join(','))
  }
  if (spec.options?.grandTotalRow) {
    const cells = Array(Math.max(1, pivot.rowDims.length)).fill('')
    cells[0] = 'Grand total'
    const values = pivot.grandCells.flatMap(c => c.map((v, mi) => formatValue(v, measures[mi].format)))
    const totals = spec.options?.grandTotalCol ? pivot.grandTotal.map((v, mi) => formatValue(v, measures[mi].format)) : []
    lines.push([...cells, ...values, ...totals].map(esc).join(','))
  }
  return lines.join('\n')
}
