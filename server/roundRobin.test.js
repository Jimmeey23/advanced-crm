import test from 'node:test'
import assert from 'node:assert/strict'
import { assignLead } from './roundRobin.js'

function db() {
  return {
    leads: [],
    associates: [
      { id: 'asc_1', name: 'Imran Shaikh', locationId: 'loc_1', locationIds: ['loc_1'], order: 1 },
      { id: 'asc_2', name: 'Neha Kapoor', locationId: 'loc_1', locationIds: ['loc_1'], order: 2 }
    ],
    settings: { roundRobin: { mode: 'fair', rotation: {} } }
  }
}

test('an ordinary lead is rotated to the next associate', () => {
  const d = db()
  const lead = { locationId: 'loc_1' }
  assert.equal(assignLead(d, lead), 'asc_1')
  assert.equal(lead.associateId, 'asc_1')
})

test('a lead owned by the Google Sheet is never rotated', () => {
  const d = db()
  // The sheet's Associate column decides ownership. Rotating this lead would
  // be undone by the next read of the sheet, flipping the owner back and forth.
  const lead = { locationId: 'loc_1', autoAssignExempt: true }
  assert.equal(assignLead(d, lead), null)
  assert.equal(lead.associateId, undefined)
  // The rotation cursor must not advance either, or a sheet lead would silently
  // cost the next real lead its turn.
  assert.deepEqual(d.settings.roundRobin.rotation, {})
})
