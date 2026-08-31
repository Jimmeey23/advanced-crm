// Projection between the sheet's field vocabulary and the lead record's.
//
// The alias dictionary in leadFieldMapping.js names fields after the SHEET's
// idea of them (`source`, `notes`, `associateName`), and a lead stores three of
// those under different names — or, in the owner's case, not as text at all but
// as an id pointing at db.associates. Merging without this projection reads
// `lead.associateName` as empty on every pass, concludes the app cleared the
// owner, and writes a blank back over the sheet's Associate column. That is
// exactly how the wrong owners appeared.
//
// So every field the sync round-trips needs an explicit reader here. A field
// with no reader is inbound-only: the sheet can set it, but nothing is ever
// written back to that column, which is the safe default for anything we
// cannot faithfully read back out of a lead.

const SAME_NAME = [
  'fullName', 'phone', 'email', 'stage', 'status', 'classType', 'channel',
  'center', 'memberId', 'hostId', 'period', 'valueEstimate', 'purchasesMade',
  'visits', 'trialStatus', 'conversionStatus', 'retentionStatus',
  'convertedAt', 'createdAt', 'locationId', 'associateId'
]

// field -> how to read the app's current value for it
const READERS = {
  source: (lead) => lead.sourceName,
  notes: (lead) => lead.remarks,
  // The owner is an id on the lead and a name in the sheet, so it round-trips
  // through db.associates in both directions.
  associateName: (lead, db) => db.associates.find(a => a.id === lead.associateId)?.name || ''
}
for (const field of SAME_NAME) READERS[field] = (lead) => lead[field]

export function isRoundTrippable(field) {
  return field in READERS
}

// A view of the lead in the SHEET's vocabulary, for handing to mergeRow.
export function leadView(lead, fields, db) {
  const out = {}
  for (const field of fields) {
    if (!(field in READERS)) continue
    const value = READERS[field](lead, db)
    out[field] = value === undefined || value === null ? '' : value
  }
  return out
}

// The value to write into the sheet for one field. Same readers, so the sheet
// receives the owner's NAME rather than the internal associate id a person
// reading the spreadsheet could do nothing with.
export function sheetValueFor(lead, field, db) {
  if (!(field in READERS)) return null
  const value = READERS[field](lead, db)
  return value === undefined || value === null ? '' : value
}

// Fields the merge is allowed to propose writing back. Everything else stays
// inbound-only.
export function writableFields(fields) {
  return fields.filter(isRoundTrippable)
}
