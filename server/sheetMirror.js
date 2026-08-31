// The CRM-owned tab.
//
// The source tab is rebuilt several times a day by an upstream export, so
// anything the app writes there is wiped within hours. This tab is the app's
// own: fixed columns, one row per lead, written only by the CRM and never read
// back as truth. It exists so the spreadsheet can still show CRM state —
// stage, owner, remarks — next to the upstream data.
//
// Column set is deliberately fixed rather than mapped. Nothing else writes
// here, so there is no third-party header to accommodate, and a stable layout
// means a person's filters and formulas survive every sync.
export const MIRROR_HEADER = [
  'Lead ID', 'Name', 'Email', 'Phone', 'Stage', 'Status', 'Owner',
  'Studio', 'Source', 'Remarks', 'Deal Value', 'Created', 'Last Updated'
]

// Same order as MIRROR_HEADER. Each entry reads one column off a lead.
const COLUMNS = [
  (lead) => lead.id,
  (lead) => lead.fullName || '',
  (lead) => lead.email && lead.email !== '-' ? lead.email : '',
  (lead) => lead.phone || '',
  (lead) => lead.stage || '',
  (lead) => lead.status || '',
  (lead, db) => db.associates.find(a => a.id === lead.associateId)?.name || '',
  (lead, db) => db.locations.find(l => l.id === lead.locationId)?.name || lead.center || '',
  (lead) => lead.sourceName || '',
  (lead) => lead.remarks || '',
  (lead) => lead.valueEstimate ?? '',
  // Written as an explicit "YYYY-MM-DD HH:mm" rather than a raw ISO string or a
  // bare date: the sheet's own date formatting is what dropped the year in the
  // first place, and a value written as text keeps the year visible whatever
  // format the column is set to.
  (lead) => stamp(lead.createdAt),
  (lead) => stamp(lead.updatedAt || lead.lastActivityAt)
]

function stamp(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return String(value)
  const iso = d.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

// Which lead field each mirror column carries, in MIRROR_HEADER order. `null`
// marks a column nobody may edit their way back into the app: the lead id is
// the row's key, and the two timestamps are reported by the app, not set from
// the sheet. Names are in the SHEET's vocabulary (see sheetFields.js), so an
// edit here goes through exactly the same projection as an edit to the source
// tab.
export const MIRROR_FIELDS = [
  null, 'fullName', 'email', 'phone', 'stage', 'status', 'associateName',
  'center', 'source', 'notes', 'valueEstimate', null, null
]

// The editable half of one mirror row, as {field: value}. Used both to read a
// person's edit and to work out what the row SHOULD say for a lead, so the two
// are always compared in the same shape.
export function mirrorValues(row) {
  const out = {}
  MIRROR_FIELDS.forEach((field, i) => {
    if (field) out[field] = row[i] === undefined || row[i] === null ? '' : String(row[i])
  })
  return out
}

export function leadIdFromMirrorRow(row) {
  return String(row?.[0] || '').trim() || null
}

export function mirrorRowFor(lead, db) {
  return COLUMNS.map(read => {
    const value = read(lead, db)
    return value === undefined || value === null ? '' : String(value)
  })
}

// The mirror is keyed by the lead id in column A, which the app writes itself —
// so unlike the source tab, identity here is exact and survives re-sorting.
export function indexMirrorRows(rows) {
  const byLeadId = new Map()
  rows.forEach((row, i) => {
    const id = String(row?.[0] || '').trim()
    if (id && !byLeadId.has(id)) byLeadId.set(id, i + 2) // +1 zero-index, +1 header
  })
  return byLeadId
}

// Splits the leads into rows to overwrite in place and rows to append.
export function planMirrorWrites(leads, byLeadId, db) {
  const updates = []
  const appends = []
  for (const lead of leads) {
    const values = mirrorRowFor(lead, db)
    const rowNumber = byLeadId.get(lead.id)
    if (rowNumber) updates.push({ rowNumber, values })
    else appends.push({ leadId: lead.id, values })
  }
  return { updates, appends }
}
