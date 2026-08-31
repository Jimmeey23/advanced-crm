import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStatusCell, parseLeadKey, wasImported, resolveLead, buildLeadIndex } from './sheetIdentity.js'

test('status cell round-trips a lead id without adding a sheet column', () => {
  const cell = buildStatusCell('lead_abc123', '2026-08-31T09:00:00.000Z')
  assert.match(cell, /^Imported 2026-08-31T09:00:00\.000Z/)
  assert.equal(parseLeadKey(cell), 'lead_abc123')
  assert.equal(wasImported(cell), true)
})

test('legacy rows carry no key and rows never synced are not marked', () => {
  assert.equal(parseLeadKey('Imported 2026-08-01T00:00:00.000Z'), null)
  assert.equal(wasImported('Imported 2026-08-01T00:00:00.000Z'), true)
  assert.equal(wasImported(''), false)
  assert.equal(wasImported('something a human typed'), false)
})

test('a hand-mangled status cell still yields its key', () => {
  assert.equal(parseLeadKey('imported (see notes) L-lead_9 ok'), 'lead_9')
})

const leads = [
  { id: 'lead_1', email: 'A@Example.com', phone: '+91 98200 11111' },
  { id: 'lead_2', email: 'b@example.com', phone: '9820022222' }
]
const snapshot = { lead_2: { rowNumber: 7, values: {} } }
const index = buildLeadIndex(leads, snapshot)

test('the key in the status cell wins over every weaker signal', () => {
  const got = resolveLead(index, { leadKey: 'lead_1', rowNumber: 7, current: { email: 'b@example.com' } })
  assert.equal(got.lead.id, 'lead_1')
  assert.equal(got.via, 'key')
})

test('a keyless row falls back to its snapshot row number', () => {
  const got = resolveLead(index, { rowNumber: 7, current: {} })
  assert.equal(got.lead.id, 'lead_2')
  assert.equal(got.via, 'row')
})

test('contact matching is normalized, so casing and phone formatting do not matter', () => {
  assert.equal(resolveLead(index, { current: { email: 'a@example.COM' } }).lead.id, 'lead_1')
  assert.equal(resolveLead(index, { current: { phone: '098200-11111' } }).lead.id, 'lead_1')
})

test('editing the email cell re-keys the existing lead instead of forking it', () => {
  const got = resolveLead(index, {
    current: { email: 'new-address@example.com' },
    previous: { email: 'a@example.com' }
  })
  assert.equal(got.lead.id, 'lead_1')
  assert.equal(got.via, 'old-email')
})

test('a genuinely new row resolves to nothing', () => {
  assert.equal(resolveLead(index, { current: { email: 'nobody@example.com' } }).lead, null)
})
