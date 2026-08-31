// Date values coming out of Google Sheets.
//
// The sheet is read with valueRenderOption=UNFORMATTED_VALUE and
// dateTimeRenderOption=SERIAL_NUMBER, so a real date cell arrives as a
// spreadsheet serial number rather than whatever the cell's display format
// happens to be. That change is the fix for the missing year: a cell formatted
// "31-Dec" or "31/12" used to reach us as exactly that text, and a date with no
// year in it cannot be turned back into one — the import silently picked the
// current year, or nothing at all.
//
// Everything the sync treats as a date is canonicalised to "YYYY-MM-DD" here,
// on BOTH sides of the merge, so the sheet's representation and the lead's
// stored ISO timestamp compare equal instead of looking like a change on every
// single pass.
import { parseFlexibleDate } from './csv.js'

// Lead fields (in the sheet's vocabulary) whose cells hold a date.
export const SHEET_DATE_FIELDS = new Set(['createdAt', 'convertedAt'])

export function isSheetDateField(field) {
  return SHEET_DATE_FIELDS.has(field)
}

// Spreadsheet serial -> ISO date. Day 0 is 1899-12-30 in both Sheets and Excel.
// The fractional part is the time of day and is dropped: the sync stores dates,
// and keeping a partial day would make two reads of the same cell differ.
export function serialToIsoDate(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n)) return null
  // Bounds keep an ordinary number that merely happens to sit in a date column
  // (a member id, a count) from being reinterpreted as a date. 20000 is
  // 1954-10-03; 80000 is 2119-01-13.
  if (n < 20000 || n > 80000) return null
  const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000)
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}

// Any of: a serial number, a full ISO timestamp, or one of the many human
// spellings parseFlexibleDate understands. Returns "YYYY-MM-DD", or '' when the
// cell holds nothing recognisable as a date — never the raw text, so a
// half-parsed date can't reach a lead record.
export function canonicalSheetDate(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)

  const raw = String(value).trim()
  if (!raw) return ''

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const iso = serialToIsoDate(raw)
    return iso || ''
  }
  // A cell whose display format omitted the year ("31-Dec", "12/31") reaches
  // us with no year to recover, and guessing one silently backdates leads by
  // decades — JS's own parser reads "31-Dec" as the year 2001. Reject it
  // outright instead; the serial-number read above is what stops real date
  // cells from ever landing here in the first place.
  if (!hasYear(raw)) return ''
  return parseFlexibleDate(raw) || ''
}

// Enough of a year to work with: an explicit 4-digit year anywhere, or three
// separated components (the third being a 2-digit year, as in "31-Dec-25").
function hasYear(raw) {
  if (/\d{4}/.test(raw)) return true
  if (/^\s*[A-Za-z0-9]+[./\-\s,]+[A-Za-z0-9]+[./\-\s,]+\d{2}\s*$/.test(raw)) return true
  // Relative references carry their own year ("today", "3 days ago").
  return /[A-Za-z]{3}/.test(raw) && !/^\d{1,2}[./\-\s]/.test(raw) && /ago|today|yesterday|tomorrow|now|week|month/i.test(raw)
}

// The app's side of the same comparison: a lead stores createdAt as a full ISO
// timestamp, and the sheet only ever carries the day.
export function canonicalLeadDate(value) {
  if (!value) return ''
  const raw = String(value).trim()
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(raw)
  if (iso) return raw.slice(0, 10)
  return parseFlexibleDate(raw) || ''
}
