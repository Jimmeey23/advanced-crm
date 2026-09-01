import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLeadFields, resolveHeaderFields, isBlankish, flattenRecord } from './leadFieldMapping.js'

// The real sheet maps two of its columns onto `source`.
const INTEG = {
  fieldMapping: {
    'UTM Source': 'source',
    'Source Name': 'source',
    'Full Name': 'fullName',
    'Source ID': 'sourceId'
  },
  defaults: {}
}

test('a placeholder cell is not a value', () => {
  for (const v of ['-', '--', 'N/A', 'n/a', 'null', 'none', 'TBD', '#N/A', '  ', '']) {
    assert.equal(isBlankish(v), true, `${JSON.stringify(v)} should read as blank`)
  }
  assert.equal(isBlankish('Website'), false)
  assert.equal(isBlankish(0), false)
})

test('a field mapped from two columns falls through the empty one', () => {
  // The bug: "UTM Source" came first in the mapping and held "-", which is not
  // an empty string, so "Source Name" was never looked at and 2,669 leads ended
  // up with the source "-".
  const resolved = resolveLeadFields(
    { 'Full Name': 'Asha Rao', 'UTM Source': '-', 'Source Name': 'Website' },
    INTEG
  )
  assert.equal(resolved.source, 'Website')
})

test('the first mapped column still wins when it has a value', () => {
  const resolved = resolveLeadFields(
    { 'UTM Source': 'instagram', 'Source Name': 'Website' },
    INTEG
  )
  assert.equal(resolved.source, 'instagram')
})

test('a field every column leaves blank resolves to nothing at all', () => {
  const resolved = resolveLeadFields({ 'UTM Source': '-', 'Source Name': 'N/A' }, INTEG)
  assert.equal('source' in resolved, false)
})

test('a static default fills in only after every column has been tried', () => {
  const resolved = resolveLeadFields(
    { 'UTM Source': '-', 'Source Name': '' },
    { ...INTEG, defaults: { source: 'Walk-in' } }
  )
  assert.equal(resolved.source, 'Walk-in')
})

test('the header plan keeps every column a field is carried by', () => {
  const header = ['Full Name', 'UTM Source', 'Source Name']
  const { columnByField, columnsByField } = resolveHeaderFields(header, INTEG)
  // The primary column is where a write-back goes...
  assert.equal(columnByField.source, 1)
  // ...but both are available to read from.
  assert.deepEqual(columnsByField.source, [1, 2])
})

test('flattenRecord lifts nested form payloads so aliases can see them', () => {
  const flat = flattenRecord({
    data: { first_name: 'Asha', last_name: 'Rao', email: 'asha@example.com' },
    meta: { source: 'Instagram' }
  })
  assert.equal(flat.first_name, 'Asha')
  assert.equal(flat['data.first_name'], 'Asha')
  assert.equal(flat.email, 'asha@example.com')
  assert.equal(flat.source, 'Instagram')
})

test('flattenRecord reads label/value field lists', () => {
  const flat = flattenRecord({
    fields: [
      { label: 'First Name', value: 'Bo' },
      { label: 'Phone', value: '9773600001' },
      { label: 'Email', value: 'bo@example.com' }
    ]
  })
  assert.equal(flat['First Name'], 'Bo')
  assert.equal(flat.Phone, '9773600001')
  assert.equal(flat.Email, 'bo@example.com')
})

test('flattenRecord keeps the outermost value when a leaf name repeats', () => {
  const flat = flattenRecord({ email: 'top@example.com', data: { email: 'nested@example.com' } })
  assert.equal(flat.email, 'top@example.com')
  assert.equal(flat['data.email'], 'nested@example.com')
})

test('flattenRecord joins primitive arrays rather than dropping them', () => {
  const flat = flattenRecord({ data: { interests: ['barre', 'reformer'] } })
  assert.equal(flat.interests, 'barre, reformer')
})

test('resolveLeadFields builds fullName from a nested split name', () => {
  const resolved = resolveLeadFields(
    { data: { firstName: 'Asha', lastName: 'Rao', phone: '9773600001' } },
    { fieldMapping: {}, defaults: {} }
  )
  assert.equal(resolved.fullName, 'Asha Rao')
  assert.equal(resolved.phone, '9773600001')
})

test('resolveLeadFields still honours an explicit mapping onto a dotted path', () => {
  const resolved = resolveLeadFields(
    { payload: { contact: { em: 'x@example.com' } }, name: 'Cal' },
    { fieldMapping: { 'payload.contact.em': 'email' }, defaults: {} }
  )
  assert.equal(resolved.email, 'x@example.com')
  assert.equal(resolved.fullName, 'Cal')
})
