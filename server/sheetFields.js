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

import { canonicalLeadDate } from './sheetDates.js'

const SAME_NAME = [
  'fullName', 'phone', 'email', 'stage', 'status', 'classType', 'channel',
  'center', 'memberId', 'hostId', 'period', 'valueEstimate', 'purchasesMade',
  'visits', 'trialStatus', 'conversionStatus', 'retentionStatus',
  'locationId', 'associateId',
  // Readable so the merge can compare it, but listed in INBOUND_ONLY below so
  // it is never written back to the sheet.
  'momenceLeadId'
]

// field -> how to read the app's current value for it
const READERS = {
  source: (lead) => lead.sourceName,
  notes: (lead) => lead.remarks,
  // The owner is an id on the lead and a name in the sheet, so it round-trips
  // through db.associates in both directions.
  associateName: (lead, db) => db.associates.find(a => a.id === lead.associateId)?.name || '',
  // Dates are compared and written as plain "YYYY-MM-DD". The lead stores a
  // full ISO timestamp and the sheet only ever carries the day, so without
  // trimming to the day every pass saw a difference and rewrote the cell — and
  // the value written back always carries its year, which is the whole point.
  createdAt: (lead) => canonicalLeadDate(lead.createdAt),
  convertedAt: (lead) => canonicalLeadDate(lead.convertedAt)
}
for (const field of SAME_NAME) READERS[field] = (lead) => lead[field]

// Fields the sheet may set on a lead but that must never be written back.
// `momenceLeadId` is Momence's own identifier for the row: the app has no
// business proposing a value for that column, but it does have to be able to
// READ its current value — without a reader, leadView reports the field as
// empty, the merge reads that emptiness as "the app cleared it", and the id is
// pushed back out as a blank instead of landing on the lead. That is why every
// lead in the database had an empty momenceLeadId, and therefore why app-side
// edits never reached the Momence portal: the push is keyed on that id.
export const INBOUND_ONLY = new Set(['momenceLeadId'])

export function isRoundTrippable(field) {
  return field in READERS && !INBOUND_ONLY.has(field)
}

// Inbound-only fields the sheet actually carries, for the caller that has to
// apply them to the lead directly (the merge cannot: with no writable side,
// every comparison for them resolves to "write back to the sheet").
export function inboundOnlyFields(fields) {
  return fields.filter(field => INBOUND_ONLY.has(field))
}

export function readLeadField(lead, field, db) {
  return field in READERS ? READERS[field](lead, db) : undefined
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
