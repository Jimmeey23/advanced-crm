// The Realtime path swapped two linear scans for indexes. Both have to agree
// with the scan they replaced on real-shaped data, including the awkward cases
// (placeholder emails, country-code prefixes, missing contact info) that
// isDuplicatePair has special handling for.
import test from 'node:test'
import assert from 'node:assert/strict'
import { __testing } from './db.js'
import { findDuplicateAmong } from './duplicateMatch.js'

const lead = (id, email, phone) => ({ id, email, phone, fullName: id })

const LEADS = [
  lead('a', 'Amy@Example.com', '+91 98765 43210'),
  lead('b', 'bob@example.com', '9876500000'),
  lead('c', '', ''),
  lead('d', 'N/A', 'N/A'),
  lead('e', 'dup@example.com', '9000000001'),
  lead('f', 'dup@example.com', '9000000002'),
  lead('g', null, '09876543210'),
  lead('h', 'weird@nodomain', '12345')
]

test('leadIndexOf agrees with findIndex for every id, present or not', () => {
  __testing.setState({ leads: LEADS })
  for (const l of LEADS) {
    assert.equal(__testing.leadIndexOf(l.id), LEADS.findIndex(x => x.id === l.id), l.id)
  }
  assert.equal(__testing.leadIndexOf('nope'), -1)
})

test('leadIndexOf self-heals after the array is reordered behind its back', () => {
  const leads = [...LEADS]
  __testing.setState({ leads })
  assert.equal(__testing.leadIndexOf('a'), 0)
  leads.reverse() // mutated in place: same length, every position now wrong
  assert.equal(__testing.leadIndexOf('a'), leads.findIndex(l => l.id === 'a'))
  assert.equal(__testing.leadIndexOf('b'), leads.findIndex(l => l.id === 'b'))
})

test('findDuplicateIndexed returns the same lead findDuplicateAmong returns', () => {
  __testing.setState({ leads: LEADS })
  const candidates = [
    lead('x', 'amy@example.com', ''),          // normalized email hit
    lead('x', '', '98765 43210'),              // normalized phone, no country code
    lead('x', '', '+919876543210'),            // normalized phone, with it
    lead('x', 'dup@example.com', ''),          // two rows match; must pick the first
    lead('x', 'N/A', 'N/A'),                   // placeholder: raw fallback only
    lead('x', 'weird@nodomain', ''),           // invalid email, raw fallback
    lead('x', '', '12345'),                    // invalid phone, raw fallback
    lead('x', 'nobody@example.com', '5550001'),// no match
    lead('x', '', ''),                         // no contact info at all
    lead('x', null, null)
  ]
  for (const candidate of candidates) {
    const expected = findDuplicateAmong(LEADS, candidate)
    const actual = __testing.findDuplicateIndexed(candidate)
    assert.equal(actual?.id ?? null, expected?.id ?? null, JSON.stringify(candidate))
  }
})

test('findDuplicateIndexed rebuilds when a lead is appended', () => {
  const leads = [...LEADS]
  __testing.setState({ leads })
  assert.equal(__testing.findDuplicateIndexed(lead('x', 'new@example.com', '')), null)
  leads.push(lead('i', 'new@example.com', '9111111111'))
  assert.equal(__testing.findDuplicateIndexed(lead('x', 'new@example.com', ''))?.id, 'i')
})

// --- freshness / integrity guards -------------------------------------------

test('replacing state wholesale drops the duplicate index', () => {
  // The duplicate index validates itself on lead COUNT, so a swap to a
  // different array of the same length is exactly the case it cannot notice
  // on its own — setState has to invalidate, and so must every other
  // assignment to `state` in the module.
  __testing.setState({ leads: [lead('a', 'amy@example.com', '9000000001')] })
  assert.equal(__testing.findDuplicateIndexed(lead('x', 'amy@example.com', ''))?.id, 'a')
  __testing.setState({ leads: [lead('z', 'zed@example.com', '9000000002')] })
  assert.equal(__testing.findDuplicateIndexed(lead('x', 'amy@example.com', '')), null)
  assert.equal(__testing.findDuplicateIndexed(lead('x', 'zed@example.com', ''))?.id, 'z')
})

test('an in-place contact edit is not served from a stale index', () => {
  const leads = [lead('a', 'old@example.com', '9000000001')]
  __testing.setState({ leads })
  assert.equal(__testing.findDuplicateIndexed(lead('x', 'old@example.com', ''))?.id, 'a')
  leads[0].email = 'new@example.com'
  // Same length, same ids — only an explicit invalidation can catch this, which
  // is what markDirty does on every local edit.
  __testing.invalidateIndexes()
  assert.equal(__testing.findDuplicateIndexed(lead('x', 'old@example.com', '')), null)
  assert.equal(__testing.findDuplicateIndexed(lead('x', 'new@example.com', ''))?.id, 'a')
})
