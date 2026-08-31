import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalSheetDate, canonicalLeadDate, serialToIsoDate } from './sheetDates.js'

test('a spreadsheet serial number becomes a full ISO date', () => {
  assert.equal(serialToIsoDate(45678), '2025-01-21')
  // The fractional part is a time of day and is dropped, so two reads of the
  // same cell can never disagree.
  assert.equal(serialToIsoDate(45678.75), '2025-01-21')
})

test('an ordinary number is not mistaken for a date', () => {
  assert.equal(serialToIsoDate(5), null)
  assert.equal(serialToIsoDate(1200), null)
  assert.equal(serialToIsoDate(900000), null)
})

test('a date with no year is rejected rather than guessed at', () => {
  // JS reads "31-Dec" as the year 2001; silently backdating a lead by 25 years
  // is worse than having no created date at all.
  assert.equal(canonicalSheetDate('31-Dec'), '')
  assert.equal(canonicalSheetDate('12/31'), '')
})

test('every year-bearing spelling survives with its year intact', () => {
  assert.equal(canonicalSheetDate('31/12/2025'), '2025-12-31')
  assert.equal(canonicalSheetDate('31-Dec-25'), '2025-12-31')
  assert.equal(canonicalSheetDate('December 31, 2025'), '2025-12-31')
  assert.equal(canonicalSheetDate('2025-12-31T18:30:00.000Z'), '2025-12-31')
  assert.equal(canonicalSheetDate(46022), '2025-12-31')
})

test('blank and placeholder cells are empty, not epoch', () => {
  for (const v of ['', '  ', '-', 'N/A', 'null', null, undefined]) {
    assert.equal(canonicalSheetDate(v), '')
  }
})

test("a lead's stored timestamp compares as the same day the sheet carries", () => {
  assert.equal(canonicalLeadDate('2026-08-31T04:15:22.123Z'), '2026-08-31')
  assert.equal(canonicalLeadDate(''), '')
})
