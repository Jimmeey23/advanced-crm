import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLeadFields, resolveHeaderFields, isBlankish } from './leadFieldMapping.js'

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
