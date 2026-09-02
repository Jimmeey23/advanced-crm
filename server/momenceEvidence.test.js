// applyLifecycleEvidence had its per-lead scan of the sales list replaced with
// an index. The join keys (member id, email) were already exact equality, so
// the result must be identical — including the awkward parts: a lead matching
// by id AND email must not count a row twice, a sale on or before the lead's
// creation date must be ignored, and only qualified membership sales count.
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyLifecycleEvidence } from './momence.js'

const db = {
  locations: [{ id: 'loc1', name: 'Kwality House' }],
  settings: { momence: { marketsByLocation: {} } }
}

const lead = (over = {}) => ({
  id: 'l1', locationId: 'loc1', createdAt: '2026-01-01T00:00:00.000Z',
  email: 'amy@example.com', memberId: '555', ...over
})

const sale = (over = {}) => ({
  memberId: '555', email: 'amy@example.com',
  saleDate: '2026-02-01T00:00:00.000Z',
  saleType: 'membership', paymentStatus: 'paid', total: 5000, ...over
})

// marketForLocation resolves an unmapped location to the default market, and
// every case below uses the same one, so 'mumbai' is what the leads land in.
const run = (leads, sales, trials = new Map()) =>
  applyLifecycleEvidence(leads, sales, trials, 'mumbai', db)

test('matches a sale by member id', () => {
  const leads = [lead()]
  const out = run(leads, [sale({ email: 'other@example.com' })])
  assert.equal(out.updated, 1)
  assert.equal(leads[0].momenceEvidence.membershipSold, true)
  assert.equal(leads[0].momenceEvidence.firstPurchaseDate, '2026-02-01T00:00:00.000Z')
})

test('matches a sale by email when the member id differs', () => {
  const leads = [lead()]
  run(leads, [sale({ memberId: '999' })])
  assert.equal(leads[0].momenceEvidence.membershipSold, true)
})

test('a row matching on both keys is counted once, earliest sale wins', () => {
  const leads = [lead()]
  run(leads, [
    sale({ saleDate: '2026-03-01T00:00:00.000Z' }),
    sale({ saleDate: '2026-02-15T00:00:00.000Z' })
  ])
  assert.equal(leads[0].momenceEvidence.firstPurchaseDate, '2026-02-15T00:00:00.000Z')
})

// A lead with no qualifying evidence still gets an evidence record written —
// all-false is a real finding ("we checked, nothing"), and the app relies on
// it to distinguish that from "never checked".
test('ignores sales at or before the lead was created', () => {
  const leads = [lead({ createdAt: '2026-06-01T00:00:00.000Z' })]
  run(leads, [sale()])
  assert.equal(leads[0].momenceEvidence.membershipSold, false)
  assert.equal(leads[0].momenceEvidence.firstPurchaseDate, null)
})

test('ignores a sale that is not a qualified membership sale', () => {
  const leads = [lead()]
  run(leads, [sale({ saleType: 'retail', total: 100 })])
  assert.equal(leads[0].momenceEvidence.membershipSold, false)
})

test('a lead with no contact keys matches nothing', () => {
  const leads = [lead({ email: '', memberId: '' })]
  run(leads, [sale()])
  assert.equal(leads[0].momenceEvidence.membershipSold, false)
})

test('expands line items so a multi-item sale still matches', () => {
  const leads = [lead({ memberId: '', email: 'kid@example.com' })]
  run(leads, [sale({
    memberId: '', email: '',
    items: [{ targetMember: { id: '777', email: 'kid@example.com' }, saleType: 'membership', total: 5000, paymentStatus: 'paid' }]
  })])
  assert.equal(leads[0].momenceEvidence?.membershipSold, true)
})

test('trial evidence comes from the attended-date map, gated on createdAt', () => {
  const leads = [lead()]
  run(leads, [], new Map([['555', new Date('2026-02-02T00:00:00.000Z')]]))
  assert.equal(leads[0].momenceEvidence.trialCompleted, true)

  const early = [lead({ id: 'l2', createdAt: '2026-05-01T00:00:00.000Z' })]
  run(early, [], new Map([['555', new Date('2026-02-02T00:00:00.000Z')]]))
  assert.equal(early[0].momenceEvidence.trialCompleted, false)
})

test('unchanged evidence does not re-mark the lead dirty', () => {
  const leads = [lead()]
  assert.equal(run(leads, [sale()]).updated, 1)
  assert.equal(run(leads, [sale()]).updated, 0)
})

// --- freshness guards -------------------------------------------------------

test('a trial date established for the other market is not reused', () => {
  // syncLifecycleEvidence seeds known trial dates from stored evidence to avoid
  // re-fetching an immutable fact. Evidence stamped with a different market
  // must not be trusted here, or one market's answer stands in for the other's.
  const leads = [lead({
    momenceEvidence: { market: 'blr', trialCompleted: true, trialDate: '2026-02-02T00:00:00.000Z' }
  })]
  // Re-running the apply step for 'mumbai' with no trial data must clear the
  // stale claim rather than carry it forward.
  run(leads, [], new Map())
  assert.equal(leads[0].momenceEvidence.market, 'mumbai')
  assert.equal(leads[0].momenceEvidence.trialCompleted, false)
})

test('evidence records the market that established it', () => {
  const leads = [lead()]
  run(leads, [sale()], new Map([['555', new Date('2026-02-02T00:00:00.000Z')]]))
  assert.equal(leads[0].momenceEvidence.market, 'mumbai')
  assert.equal(leads[0].momenceEvidence.trialCompleted, true)
  assert.equal(leads[0].momenceEvidence.membershipSold, true)
})
