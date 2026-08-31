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
  const memberships = normalizeMemberships(
    [{ id: 1, name: 'Annual', type: 'subscription' }],
    { items: [{ id: 2, name: '10 Pack', type: 'package-events' }, { id: 1, name: 'Annual duplicate' }] }
  )
  assert.equal(memberships.length, 2)
  assert.deepEqual(memberships.map(({ id, name, type, group, disabled }) => ({ id, name, type, group, disabled })), [
    { id: 1, name: 'Annual', type: 'subscription', group: 'Fixed-term memberships', disabled: false },
    { id: 2, name: '10 Pack', type: 'package-events', group: 'Class packages', disabled: false }
  ])
})

test('membership catalog exposes detailed read-only fields and a public purchase URL', () => {
  const [membership] = normalizeMemberships([{ id: 97885, hostId: 13752, hostName: 'Physique 57 Mumbai', name: 'Studio 12 Class Package', type: 'subscription', price: 17000, duration: 90, durationUnit: 'days', autoRenew: false, numberOfEvents: 12, description: 'Twelve studio sessions' }])
  assert.equal(membership.group, 'Fixed-term memberships')
  assert.equal(membership.price, 17000)
  assert.equal(membership.duration, 90)
  assert.equal(membership.description, 'Twelve studio sessions')
  assert.equal(membership.purchaseUrl, 'https://momence.com/Physique-57-Mumbai/membership/Studio-12-Class-Package/97885')
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

test('agent list returns active codes only and direct mutations are forbidden', async () => {
  const service = {
    list: async () => [
      { id: 1, code: 'ACTIVE' },
      { id: 2, code: 'EXPIRED', expiresAt: '2026-08-01T00:00:00Z' },
      { id: 3, code: 'FUTURE', validFrom: '2026-10-01T00:00:00Z' }
    ],
    create: async () => { throw new Error('must not be called') }
  }
  const handlers = createDiscountCodeHandlers({ service, getDb: () => ({ locations, discountCodeRequests: [] }), now: () => new Date('2026-08-31T00:00:00Z') })
  const authUser = { role: 'agent', email: 'agent@example.com', userId: 'user-1', locationIds: ['loc_supreme'] }
  const listRes = responseDouble()
  await handlers.list({ authUser, query: { market: 'mumbai' }, params: {} }, listRes)
  assert.deepEqual(listRes.body.codes.map(code => code.code), ['ACTIVE'])

  const createRes = responseDouble()
  await handlers.create({ authUser, query: { market: 'mumbai' }, body: validCode, params: {} }, createRes)
  assert.equal(createRes.statusCode, 403)
})

test('agent can request a code and admin approval creates it once and notifies the agent', async () => {
  const db = { locations, discountCodeRequests: [] }
  const created = []
  const emails = []
  let saves = 0
  const handlers = createDiscountCodeHandlers({
    service: { create: async (market, payload) => { created.push({ market, payload }); return { id: 700, code: payload.code } } },
    getDb: () => db,
    saveMeta: async () => { saves++ },
    sendMail: async (_db, email) => { emails.push(email); return { ok: true } },
    makeId: () => 'dcr_1',
    now: () => new Date('2026-08-31T00:00:00Z')
  })
  const agent = { role: 'agent', email: 'agent@example.com', userId: 'user-1', associateId: 'asn-1', locationIds: ['loc_supreme'] }
  const requestRes = responseDouble()
  await handlers.createRequest({ authUser: agent, query: { market: 'mumbai' }, body: { ...validCode, locationId: 'loc_supreme' }, params: {} }, requestRes)
  assert.equal(requestRes.statusCode, 201)
  assert.equal(db.discountCodeRequests[0].status, 'pending')
  assert.equal('locationId' in db.discountCodeRequests[0].payload, false)

  const admin = { role: 'admin', email: 'admin@example.com', userId: 'admin-1', locationIds: null }
  const decisionRes = responseDouble()
  await handlers.decideRequest({ authUser: admin, params: { id: 'dcr_1' }, body: { decision: 'approve', note: 'Approved' }, query: {} }, decisionRes)
  assert.equal(decisionRes.body.request.status, 'approved')
  assert.equal(decisionRes.body.request.momenceCodeId, 700)
  assert.equal(created.length, 1)
  assert.equal(emails[0].to, 'agent@example.com')
  assert.ok(saves >= 2)

  const repeatRes = responseDouble()
  await handlers.decideRequest({ authUser: admin, params: { id: 'dcr_1' }, body: { decision: 'approve' }, query: {} }, repeatRes)
  assert.equal(repeatRes.statusCode, 409)
  assert.equal(created.length, 1)
})

test('admin can decline a request without creating a Momence code', async () => {
  const db = { locations, discountCodeRequests: [{ id: 'dcr_2', market: 'blr', status: 'pending', requestedByEmail: 'agent@example.com', payload: validCode }] }
  let creates = 0
  const handlers = createDiscountCodeHandlers({
    service: { create: async () => { creates++; return {} } }, getDb: () => db,
    saveMeta: async () => {}, sendMail: async () => ({ skipped: true }), now: () => new Date('2026-08-31T00:00:00Z')
  })
  const res = responseDouble()
  await handlers.decideRequest({ authUser: { role: 'admin', email: 'admin@example.com' }, params: { id: 'dcr_2' }, body: { decision: 'decline', note: 'Use the seasonal campaign.' }, query: {} }, res)
  assert.equal(res.body.request.status, 'declined')
  assert.equal(res.body.request.decisionNote, 'Use the seasonal campaign.')
  assert.equal(creates, 0)
})
