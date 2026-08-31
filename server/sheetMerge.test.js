import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeRow, nextSnapshot, SHEET_WINS, APP_WINS } from './sheetMerge.js'

const fields = ['fullName', 'phone', 'stage', 'valueEstimate']

test('a field only the sheet changed flows into the app', () => {
  const got = mergeRow({
    fields,
    sheet: { fullName: 'Asha Rao', stage: 'Trial Booked' },
    snapshot: { fullName: 'Asha Rao', stage: 'New Enquiry' },
    lead: { fullName: 'Asha Rao', stage: 'New Enquiry' }
  })
  assert.deepEqual(got.toLead, { stage: 'Trial Booked' })
  assert.deepEqual(got.toSheet, {})
  assert.deepEqual(got.conflicts, [])
})

test('a field only the app changed flows out to the sheet', () => {
  const got = mergeRow({
    fields,
    sheet: { stage: 'New Enquiry' },
    snapshot: { stage: 'New Enquiry' },
    lead: { stage: 'Membership Sold' }
  })
  assert.deepEqual(got.toSheet, { stage: 'Membership Sold' })
  assert.deepEqual(got.toLead, {})
})

test('both sides changed: the later timestamp wins the field', () => {
  const sheetWon = mergeRow({
    fields,
    sheet: { stage: 'Trial Booked' },
    snapshot: { stage: 'New Enquiry' },
    lead: { stage: 'Lost' },
    fieldUpdatedAt: { stage: '2026-08-31T09:00:00.000Z' },
    sheetEditedAt: '2026-08-31T10:00:00.000Z'
  })
  assert.deepEqual(sheetWon.toLead, { stage: 'Trial Booked' })
  assert.equal(sheetWon.conflicts[0].winner, SHEET_WINS)

  const appWon = mergeRow({
    fields,
    sheet: { stage: 'Trial Booked' },
    snapshot: { stage: 'New Enquiry' },
    lead: { stage: 'Lost' },
    fieldUpdatedAt: { stage: '2026-08-31T11:00:00.000Z' },
    sheetEditedAt: '2026-08-31T10:00:00.000Z'
  })
  assert.deepEqual(appWon.toSheet, { stage: 'Lost' })
  assert.equal(appWon.conflicts[0].winner, APP_WINS)
})

test('the sheet wins a conflict with no usable timestamps', () => {
  const got = mergeRow({
    fields,
    sheet: { stage: 'Trial Booked' },
    snapshot: { stage: 'New Enquiry' },
    lead: { stage: 'Lost' }
  })
  assert.deepEqual(got.toLead, { stage: 'Trial Booked' })
  assert.equal(got.conflicts[0].winner, SHEET_WINS)
})

test('both sides changed to the same value is not a conflict', () => {
  const got = mergeRow({
    fields,
    sheet: { stage: 'Trial Booked' },
    snapshot: { stage: 'New Enquiry' },
    lead: { stage: 'Trial Booked' }
  })
  assert.deepEqual(got, { toLead: {}, toSheet: {}, conflicts: [] })
})

test('clearing a cell that had a value is a deliberate clear and propagates', () => {
  const got = mergeRow({
    fields,
    sheet: { phone: '' },
    snapshot: { phone: '9820011111' },
    lead: { phone: '9820011111' }
  })
  assert.deepEqual(got.toLead, { phone: '' })
})

test('a cell that was always blank never wipes the app; the app value goes out', () => {
  const got = mergeRow({
    fields,
    sheet: { phone: '' },
    snapshot: { phone: '' },
    lead: { phone: '9820011111' }
  })
  assert.deepEqual(got.toLead, {})
  assert.deepEqual(got.toSheet, { phone: '9820011111' })
})

test('numbers and strings for the same value are not a change', () => {
  const got = mergeRow({
    fields,
    sheet: { valueEstimate: '5000' },
    snapshot: { valueEstimate: '5000' },
    lead: { valueEstimate: 5000 }
  })
  assert.deepEqual(got, { toLead: {}, toSheet: {}, conflicts: [] })
})

test('first sight of a row: sheet values land, app-only values are pushed out', () => {
  const got = mergeRow({
    fields,
    sheet: { fullName: 'Asha Rao', stage: '' },
    snapshot: null,
    lead: { fullName: 'A Rao', stage: 'Trial Booked' }
  })
  assert.deepEqual(got.toLead, { fullName: 'Asha Rao' })
  assert.deepEqual(got.toSheet, { stage: 'Trial Booked' })
})

test('the stored snapshot is the post-merge state, so a change is detected once only', () => {
  const merged = mergeRow({
    fields,
    sheet: { fullName: 'Asha Rao', stage: 'Trial Booked' },
    snapshot: { fullName: 'A Rao', stage: 'Trial Booked' },
    lead: { fullName: 'A Rao', stage: 'Membership Sold' }
  })
  const snap = nextSnapshot({ fields, sheet: { fullName: 'Asha Rao', stage: 'Trial Booked' }, ...merged })
  assert.equal(snap.fullName, 'Asha Rao')
  assert.equal(snap.stage, 'Membership Sold')

  const again = mergeRow({ fields, sheet: snap, snapshot: snap, lead: { fullName: 'Asha Rao', stage: 'Membership Sold' } })
  assert.deepEqual(again, { toLead: {}, toSheet: {}, conflicts: [] })
})

test('on an export-rebuilt tab a blank cell never wipes app data', () => {
  const got = mergeRow({
    fields,
    sheet: { phone: '', stage: 'Trial Booked' },
    snapshot: { phone: '9820011111', stage: 'New Enquiry' },
    lead: { phone: '9820011111', stage: 'New Enquiry' },
    blankMeansMissing: true
  })
  // The cleared phone is ignored rather than applied...
  assert.equal('phone' in got.toLead, false)
  // ...while a real change on the same row still lands.
  assert.deepEqual(got.toLead, { stage: 'Trial Booked' })
})

test('without the flag, clearing a cell is still a deliberate clear', () => {
  const got = mergeRow({
    fields,
    sheet: { phone: '' },
    snapshot: { phone: '9820011111' },
    lead: { phone: '9820011111' }
  })
  assert.deepEqual(got.toLead, { phone: '' })
})
