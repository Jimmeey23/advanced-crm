import test from 'node:test'
import assert from 'node:assert/strict'
import { planDedupe, isSafeToMerge } from './leadDedupe.js'

const lead = (id, over = {}) => ({
  id, fullName: 'Amy Brown', email: '', phone: '',
  createdAt: '2026-01-01T00:00:00.000Z', ...over
})

test('the oldest lead in a cluster survives', () => {
  const { toRemove, groups } = planDedupe([
    lead('new', { email: 'amy@example.com', createdAt: '2026-05-01T00:00:00.000Z' }),
    lead('old', { email: 'amy@example.com', createdAt: '2026-01-01T00:00:00.000Z' })
  ])
  assert.deepEqual(toRemove.map(l => l.id), ['new'])
  assert.equal(groups[0].survivor.id, 'old')
})

test('leads that are not duplicates are left alone', () => {
  const { toRemove } = planDedupe([
    lead('a', { email: 'amy@example.com' }),
    lead('b', { fullName: 'Zed Other', email: 'zed@example.com' })
  ])
  assert.equal(toRemove.length, 0)
})

// --- strict mode ------------------------------------------------------------

test('strict mode removes a duplicate whose keys the survivor already carries', () => {
  const { toRemove, skipped } = planDedupe([
    lead('old', { email: 'amy@example.com', phone: '9876543210' }),
    lead('dup', { email: 'amy@example.com', phone: '9876543210', createdAt: '2026-06-01T00:00:00.000Z' })
  ], { strict: true })
  assert.deepEqual(toRemove.map(l => l.id), ['dup'])
  assert.equal(skipped.length, 0)
})

test('strict mode keeps a duplicate holding an email the survivor does not have', () => {
  // Joined by a fuzzy name match. Deleting it would lose that address — and
  // the sheet mirror, which resolves by email, would re-create it on the next
  // sync, to be deleted again on the next pass.
  const { toRemove, skipped } = planDedupe([
    lead('old', { phone: '9876543210' }),
    lead('dup', { phone: '9876543210', email: 'amy.other@example.com', createdAt: '2026-06-01T00:00:00.000Z' })
  ], { strict: true })
  assert.equal(toRemove.length, 0)
  assert.deepEqual(skipped.map(l => l.id), ['dup'])
})

test('strict mode keeps a duplicate holding a different phone number', () => {
  const { toRemove } = planDedupe([
    lead('old', { email: 'amy@example.com', phone: '9876543210' }),
    lead('dup', { email: 'amy@example.com', phone: '9000000009', createdAt: '2026-06-01T00:00:00.000Z' })
  ], { strict: true })
  assert.equal(toRemove.length, 0)
})

test('a duplicate with no contact details at all is safe to fold in', () => {
  assert.equal(isSafeToMerge({ email: 'amy@example.com', phone: '9876543210' }, { email: '', phone: '' }), true)
})

test('the manual (non-strict) plan still removes what strict declines to', () => {
  const leads = [
    lead('old', { phone: '9876543210' }),
    lead('dup', { phone: '9876543210', email: 'amy.other@example.com', createdAt: '2026-06-01T00:00:00.000Z' })
  ]
  assert.equal(planDedupe(leads).toRemove.length, 1)
  assert.equal(planDedupe(leads, { strict: true }).toRemove.length, 0)
})

test('a group is only reported when something is actually removable', () => {
  const { groups } = planDedupe([
    lead('old', { phone: '9876543210' }),
    lead('dup', { phone: '9876543210', email: 'other@example.com', createdAt: '2026-06-01T00:00:00.000Z' })
  ], { strict: true })
  assert.equal(groups.length, 0)
})

test('phone formatting differences do not block a merge', () => {
  const { toRemove } = planDedupe([
    lead('old', { phone: '+91 98765 43210', email: 'amy@example.com' }),
    lead('dup', { phone: '09876543210', email: 'AMY@Example.com', createdAt: '2026-06-01T00:00:00.000Z' })
  ], { strict: true })
  assert.deepEqual(toRemove.map(l => l.id), ['dup'])
})

test('nothing in, nothing out', () => {
  assert.deepEqual(planDedupe([]).toRemove, [])
  assert.deepEqual(planDedupe().toRemove, [])
})
