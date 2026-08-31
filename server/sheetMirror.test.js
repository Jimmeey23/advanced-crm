import test from 'node:test'
import assert from 'node:assert/strict'
import { MIRROR_HEADER, mirrorRowFor, indexMirrorRows, planMirrorWrites } from './sheetMirror.js'

const db = {
  associates: [{ id: 'asc_1', name: 'Imran Shaikh' }, { id: 'asc_2', name: 'Neha Kapoor' }],
  locations: [{ id: 'loc_1', name: 'Kwality House' }]
}

const lead = {
  id: 'lead_1',
  fullName: 'Asha Rao',
  email: 'asha@example.com',
  phone: '9820011111',
  stage: 'Trial Booked',
  status: 'open',
  associateId: 'asc_1',
  locationId: 'loc_1',
  sourceName: 'Google Sheets',
  remarks: 'called twice',
  valueEstimate: 24000,
  createdAt: '2026-08-01',
  updatedAt: '2026-08-31T09:00:00.000Z'
}

test('a row is written in the fixed column order, ids resolved to names', () => {
  const row = mirrorRowFor(lead, db)
  assert.equal(row.length, MIRROR_HEADER.length)
  assert.equal(row[MIRROR_HEADER.indexOf('Lead ID')], 'lead_1')
  assert.equal(row[MIRROR_HEADER.indexOf('Owner')], 'Imran Shaikh')
  assert.equal(row[MIRROR_HEADER.indexOf('Studio')], 'Kwality House')
  assert.equal(row[MIRROR_HEADER.indexOf('Deal Value')], '24000')
})

test('missing values render as empty cells, never as "undefined"', () => {
  const row = mirrorRowFor({ id: 'lead_2' }, db)
  assert.equal(row[MIRROR_HEADER.indexOf('Owner')], '')
  assert.equal(row[MIRROR_HEADER.indexOf('Deal Value')], '')
  assert.ok(row.every(cell => typeof cell === 'string'))
})

test('a placeholder email is not mirrored as a real address', () => {
  const row = mirrorRowFor({ ...lead, email: '-' }, db)
  assert.equal(row[MIRROR_HEADER.indexOf('Email')], '')
})

test('rows are located by the lead id the app itself wrote, so re-sorting is safe', () => {
  const index = indexMirrorRows([
    ['lead_9', 'Someone'],
    ['lead_1', 'Asha Rao'],
    ['', 'a row someone typed by hand']
  ])
  assert.equal(index.get('lead_1'), 3)
  assert.equal(index.get('lead_9'), 2)
  assert.equal(index.size, 2)
})

test('known leads are updated in place, unknown ones appended', () => {
  const index = indexMirrorRows([['lead_1', 'Asha Rao']])
  const { updates, appends } = planMirrorWrites([lead, { id: 'lead_new', fullName: 'New Person' }], index, db)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].rowNumber, 2)
  assert.equal(appends.length, 1)
  assert.equal(appends[0].leadId, 'lead_new')
})
