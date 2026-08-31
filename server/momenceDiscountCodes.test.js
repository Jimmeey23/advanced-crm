import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertMarketAccess,
  createDiscountCodeHandlers,
  createDiscountCodeService,
  hostIdForMarket,
  marketsForAuthUser,
  normalizeMemberships,
  serializeDiscountCode
} from './momenceDiscountCodes.js'

const locations = [
  { id: 'loc_supreme', name: 'Supreme Bandra', city: 'Mumbai' },
  { id: 'loc_indiranagar', name: 'Copper + Cloves Indiranagar', city: 'Bengaluru' }
]

const validCode = {
  type: 'percentage', discountPercentage: 10, discountValue: null, code: 'WELCOME10', description: '',
  isUnlimited: false, usageAmount: 5, usageAmountGlobal: null, numberOfRenewalsDiscountIsValidFor: null,
  validFrom: '2026-08-31T02:38:00.000Z', expiresAt: '2026-09-30T18:23:00.000Z',
  isUsableForGiftCards: false, isNewCustomersOnly: true, assignedEvents: [], assignedSessionTemplates: [],
  assignedProducts: [], assignedVideos: [], assignedAppointmentServices: [], assignedCourses: [], assignedMemberships: [12, 12, '13']
}

test('maps markets to fixed Momence hosts', () => {
  assert.equal(hostIdForMarket('mumbai'), '13752')
  assert.equal(hostIdForMarket('blr'), '33905')
  assert.throws(() => hostIdForMarket('other'), /Unknown Momence market/)
})

test('derives agent markets from server-side location assignments', () => {
  assert.deepEqual(marketsForAuthUser({ role: 'admin', locationIds: null }, locations), ['mumbai', 'blr'])
  assert.deepEqual(marketsForAuthUser({ role: 'agent', locationIds: ['loc_supreme', 'loc_indiranagar'] }, locations), ['mumbai', 'blr'])
  assert.deepEqual(marketsForAuthUser({ role: 'agent', locationIds: [] }, locations), [])
  assert.throws(() => assertMarketAccess({ role: 'agent', locationIds: ['loc_supreme'] }, 'blr', locations), /not authorized/i)
})

test('serializes a percentage code with unique positive membership IDs', () => {
  const result = serializeDiscountCode(validCode)
  assert.equal(result.discountPercentage, 10)
  assert.equal(result.discountValue, null)
  assert.deepEqual(result.assignedMemberships, [12, 13])
  assert.equal(Object.keys(result).length, 20)
})

test('serializes fixed discounts and rejects invalid business values', () => {
  const fixed = serializeDiscountCode({ ...validCode, type: 'fixed', discountPercentage: null, discountValue: 1500 })
  assert.equal(fixed.discountValue, 1500)
  assert.equal(fixed.discountPercentage, null)
  assert.throws(() => serializeDiscountCode({ ...validCode, discountPercentage: 101 }), /percentage/i)
  assert.throws(() => serializeDiscountCode({ ...validCode, assignedMemberships: [0] }), /membership/i)
  assert.throws(() => serializeDiscountCode({ ...validCode, expiresAt: '2026-01-01T00:00:00Z' }), /later than/i)
  assert.throws(() => serializeDiscountCode({ ...validCode, unexpected: true }), /Unknown discount code field/)
})

test('normalizes and deduplicates memberships from varied response shapes', () => {
  assert.deepEqual(normalizeMemberships(
    [{ id: 1, name: 'Annual', type: 'subscription' }],
    { items: [{ id: 2, name: '10 Pack', type: 'package-events' }, { id: 1, name: 'Annual duplicate' }] }
  ), [
    { id: 1, name: 'Annual', type: 'subscription', group: 'Subscriptions', disabled: false },
    { id: 2, name: '10 Pack', type: 'package-events', group: 'Packages', disabled: false }
  ])
})

test('service builds allowlisted paths and complete mutation requests', async () => {
  const calls = []
  const client = { request: async (path, init = {}) => {
    calls.push({ path, init })
    if (path.includes('type=subscription')) return { data: [{ id: 1, name: 'Annual', type: 'subscription' }] }
    if (path.includes('type%5B%5D=package-events')) return [{ id: 2, name: 'Pack', type: 'package-events' }]
    return { id: 99, ...JSON.parse(init.body || '{}') }
  } }
  const service = createDiscountCodeService({ client, now: () => new Date('2026-08-31T12:00:00Z'), idempotenceKey: () => 'request-id' })

  const memberships = await service.memberships('blr')
  const created = await service.create('mumbai', validCode)
  await service.setEnabled('mumbai', 99, validCode, false)
  await service.remove('blr', 99)

  assert.deepEqual(memberships.map(item => item.id), [1, 2])
  assert.equal(created.id, 99)
  assert.match(calls[0].path, /host\/33905\/memberships/)
  assert.equal(calls[2].init.headers['x-idempotence-key'], 'request-id')
  assert.equal(JSON.parse(calls[3].init.body).expiresAt, '2026-08-31T12:00:00.000Z')
  assert.equal(calls[4].init.method, 'DELETE')
})

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    sendStatus(code) { this.statusCode = code; this.body = null; return this }
  }
}

test('handlers reject unauthorized agent markets before calling the service', async () => {
  const calls = []
  const handlers = createDiscountCodeHandlers({
    service: { create: async (...args) => calls.push(args) },
    getDb: () => ({ locations })
  })
  const req = { authUser: { role: 'agent', locationIds: ['loc_supreme'] }, query: { market: 'blr' }, body: validCode, params: {} }
  const res = responseDouble()

  await handlers.create(req, res)

  assert.equal(res.statusCode, 403)
  assert.equal(calls.length, 0)
})

test('handlers expose normalized list and validate status payload', async () => {
  const service = {
    list: async () => [{ id: 4, code: 'TEST' }],
    setEnabled: async () => ({ ok: true })
  }
  const handlers = createDiscountCodeHandlers({ service, getDb: () => ({ locations }) })
  const authUser = { role: 'admin', locationIds: null }
  const listRes = responseDouble()
  await handlers.list({ authUser, query: { market: 'mumbai', includeExpired: 'true' }, params: {} }, listRes)
  assert.deepEqual(listRes.body, { codes: [{ id: 4, code: 'TEST' }], markets: ['mumbai', 'blr'] })

  const statusRes = responseDouble()
  await handlers.setEnabled({ authUser, query: { market: 'mumbai' }, params: { id: '4' }, body: { enabled: 'yes', code: validCode } }, statusRes)
  assert.equal(statusRes.statusCode, 400)
  assert.match(statusRes.body.error, /enabled must be a boolean/i)
})
