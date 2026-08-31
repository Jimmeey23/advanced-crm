import crypto from 'node:crypto'

export const DISCOUNT_HOSTS = Object.freeze({ mumbai: '13752', blr: '33905' })

const ASSIGNMENT_FIELDS = Object.freeze([
  'assignedEvents', 'assignedSessionTemplates', 'assignedProducts', 'assignedVideos',
  'assignedAppointmentServices', 'assignedCourses', 'assignedMemberships'
])
const PAYLOAD_FIELDS = new Set([
  'type', 'discountPercentage', 'discountValue', 'code', 'description', 'isUnlimited',
  'usageAmount', 'usageAmountGlobal', 'numberOfRenewalsDiscountIsValidFor', 'validFrom', 'expiresAt',
  'isUsableForGiftCards', 'isNewCustomersOnly', ...ASSIGNMENT_FIELDS
])

export function hostIdForMarket(market) {
  const hostId = DISCOUNT_HOSTS[String(market || '').toLowerCase()]
  if (!hostId) throw Object.assign(new Error('Unknown Momence market'), { status: 400 })
  return hostId
}

function locationMarket(location) {
  const text = `${location?.name || ''} ${location?.city || ''}`.toLowerCase()
  return /(bengaluru|bangalore|indiranagar|kenkere|copper|plash)/.test(text) ? 'blr' : 'mumbai'
}

export function marketsForAuthUser(authUser, locations = []) {
  if (authUser?.role === 'admin') return ['mumbai', 'blr']
  const allowed = new Set(authUser?.locationIds || [])
  const markets = new Set(locations.filter(location => allowed.has(location.id)).map(locationMarket))
  return ['mumbai', 'blr'].filter(market => markets.has(market))
}

export function assertMarketAccess(authUser, market, locations = []) {
  hostIdForMarket(market)
  if (!marketsForAuthUser(authUser, locations).includes(market)) {
    throw Object.assign(new Error(`You are not authorized to manage ${market === 'blr' ? 'Bengaluru' : 'Mumbai'} discount codes`), { status: 403 })
  }
  return market
}

function nullableNumber(value, label, { positive = false } = {}) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0)) throw new Error(`${label} must be ${positive ? 'greater than zero' : 'zero or greater'}`)
  return number
}

function nullableDate(value, label) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date`)
  return date.toISOString()
}

function positiveIds(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const ids = value.map(Number)
  if (ids.some(id => !Number.isInteger(id) || id <= 0)) throw new Error(`${label} contains an invalid membership or resource ID`)
  return [...new Set(ids)]
}

export function serializeDiscountCode(input = {}) {
  const unknown = Object.keys(input).filter(key => !PAYLOAD_FIELDS.has(key))
  if (unknown.length) throw new Error(`Unknown discount code field: ${unknown.join(', ')}`)
  const type = input.type === 'fixed' || input.type === 'value' ? 'fixed' : input.type
  if (!['percentage', 'fixed'].includes(type)) throw new Error('Discount type must be percentage or fixed')
  const code = String(input.code || '').trim()
  if (!code) throw new Error('Discount code is required')
  const discountPercentage = type === 'percentage' ? nullableNumber(input.discountPercentage, 'Discount percentage', { positive: true }) : null
  const discountValue = type === 'fixed' ? nullableNumber(input.discountValue, 'Discount value', { positive: true }) : null
  if (discountPercentage > 100) throw new Error('Discount percentage cannot exceed 100')
  const validFrom = nullableDate(input.validFrom, 'Valid from')
  const expiresAt = nullableDate(input.expiresAt, 'Expiry')
  if (validFrom && expiresAt && new Date(expiresAt) <= new Date(validFrom)) throw new Error('Expiry must be later than valid from')
  const payload = {
    type: type === 'fixed' ? 'value' : type,
    discountPercentage,
    discountValue,
    code,
    description: input.description == null ? '' : String(input.description).trim(),
    isUnlimited: Boolean(input.isUnlimited),
    usageAmount: nullableNumber(input.usageAmount, 'Usage amount', { positive: true }),
    usageAmountGlobal: nullableNumber(input.usageAmountGlobal, 'Global usage amount', { positive: true }),
    numberOfRenewalsDiscountIsValidFor: nullableNumber(input.numberOfRenewalsDiscountIsValidFor, 'Renewal limit'),
    validFrom,
    expiresAt,
    isUsableForGiftCards: Boolean(input.isUsableForGiftCards),
    isNewCustomersOnly: Boolean(input.isNewCustomersOnly)
  }
  for (const field of ASSIGNMENT_FIELDS) payload[field] = positiveIds(input[field] || [], field)
  return payload
}

function rowsFrom(response) {
  if (Array.isArray(response)) return response
  for (const key of ['items', 'data', 'results', 'memberships', 'discountCodes']) {
    if (Array.isArray(response?.[key])) return response[key]
  }
  return []
}

export function normalizeMemberships(...responses) {
  const seen = new Set()
  const result = []
  for (const raw of responses.flatMap(rowsFrom)) {
    const id = Number(raw?.id)
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    const type = String(raw.type || raw.membershipType || '')
    result.push({
      id,
      name: String(raw.name || raw.title || `Membership #${id}`),
      type,
      group: type === 'subscription' ? 'Subscriptions' : 'Packages',
      disabled: Boolean(raw.disabled)
    })
  }
  return result
}

function codeRows(response) {
  if (Array.isArray(response)) return response
  return rowsFrom(response)
}

export function createDiscountCodeService({ client, now = () => new Date(), idempotenceKey = () => crypto.randomUUID() }) {
  const base = market => `/_api/primary/host/${hostIdForMarket(market)}`
  const jsonInit = (method, input) => ({
    method,
    headers: { 'content-type': 'application/json', 'x-idempotence-key': idempotenceKey() },
    body: JSON.stringify(serializeDiscountCode(input))
  })
  const validId = id => {
    const number = Number(id)
    if (!Number.isInteger(number) || number <= 0) throw Object.assign(new Error('Invalid discount code ID'), { status: 400 })
    return number
  }
  return {
    async list(market, includeExpired = true) {
      const response = await client.request(`${base(market)}/discount-codes?includeExpired=${includeExpired !== false}`)
      return codeRows(response)
    },
    async memberships(market) {
      const subscriptionQuery = new URLSearchParams({ type: 'subscription', disabled: 'false', placeSharedLast: 'true' })
      const packageQuery = new URLSearchParams([['type[]', 'package-events'], ['type[]', 'package-money'], ['disabled', 'false'], ['placeSharedLast', 'true']])
      const [subscriptions, packages] = await Promise.all([
        client.request(`${base(market)}/memberships?${subscriptionQuery}`),
        client.request(`${base(market)}/memberships?${packageQuery}`)
      ])
      return normalizeMemberships(subscriptions, packages)
    },
    create: (market, input) => client.request(`${base(market)}/discount-codes`, jsonInit('POST', input)),
    update: (market, id, input) => client.request(`${base(market)}/discount-codes/${validId(id)}`, jsonInit('PUT', input)),
    setEnabled(market, id, input, enabled) {
      return client.request(`${base(market)}/discount-codes/${validId(id)}`, jsonInit('PUT', { ...input, expiresAt: enabled ? null : now().toISOString() }))
    },
    remove: (market, id) => client.request(`${base(market)}/discount-codes/${validId(id)}`, { method: 'DELETE' })
  }
}

function booleanQuery(value, fallback = true) {
  if (value === undefined) return fallback
  return String(value).toLowerCase() !== 'false'
}

function positiveRouteId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Invalid discount code ID'), { status: 400 })
  return id
}

export function createDiscountCodeHandlers({
  service,
  getDb,
  saveMeta = async () => {},
  sendMail = async () => ({ skipped: true, reason: 'Email unavailable' }),
  makeId = () => `dcr_${crypto.randomUUID()}`,
  now = () => new Date()
}) {
  function context(req) {
    const db = getDb()
    const market = String(req.query?.market || '').toLowerCase()
    assertMarketAccess(req.authUser, market, db?.locations || [])
    return { market, markets: marketsForAuthUser(req.authUser, db?.locations || []) }
  }
  function fail(res, error, validation = false) {
    const status = [400, 403, 404, 409].includes(error?.status) ? error.status : validation ? 400 : 502
    return res.status(status).json({ error: String(error?.message || 'Momence request failed').slice(0, 300) })
  }
  function requireAdmin(req) {
    if (req.authUser?.role !== 'admin') throw Object.assign(new Error('Only admins can create, modify, enable, disable, or delete discount codes'), { status: 403 })
  }
  function requestStore() {
    const db = getDb()
    if (!Array.isArray(db.discountCodeRequests)) db.discountCodeRequests = []
    return { db, requests: db.discountCodeRequests }
  }
  function requestView(request) {
    return { ...request, payload: { ...request.payload } }
  }
  async function notifyDecision(db, request) {
    const approved = request.status === 'approved'
    const statusText = approved ? 'approved and created in Momence' : 'declined'
    try {
      const result = await sendMail(db, {
        to: request.requestedByEmail,
        subject: `Discount code request ${approved ? 'approved' : 'declined'} — ${request.payload.code}`,
        text: `Your ${MARKET_LABELS[request.market]} discount code request for ${request.payload.code} was ${statusText}.${request.decisionNote ? `\n\nAdmin note: ${request.decisionNote}` : ''}`,
        html: `<p>Your <strong>${MARKET_LABELS[request.market]}</strong> discount code request for <strong>${escapeHtml(request.payload.code)}</strong> was ${statusText}.</p>${request.decisionNote ? `<p><strong>Admin note:</strong> ${escapeHtml(request.decisionNote)}</p>` : ''}`
      })
      request.emailNotification = result?.ok ? 'sent' : `skipped: ${result?.reason || 'unknown reason'}`
    } catch (error) {
      request.emailNotification = `failed: ${String(error?.message || 'unknown error').slice(0, 160)}`
    }
    await saveMeta()
  }
  return {
    async list(req, res) {
      try {
        const { market, markets } = context(req)
        const includeExpired = req.authUser?.role === 'admin' && booleanQuery(req.query?.includeExpired)
        let codes = await service.list(market, includeExpired)
        if (req.authUser?.role !== 'admin') codes = codes.filter(code => isCodeActive(code, now()))
        res.json({ codes, markets })
      } catch (error) { fail(res, error) }
    },
    async memberships(req, res) {
      try {
        const { market } = context(req)
        res.json({ memberships: await service.memberships(market) })
      } catch (error) { fail(res, error) }
    },
    async create(req, res) {
      try {
        requireAdmin(req)
        const { market } = context(req)
        serializeDiscountCode(req.body)
        res.status(201).json({ code: await service.create(market, req.body) })
      } catch (error) { fail(res, error, !error?.status) }
    },
    async update(req, res) {
      try {
        requireAdmin(req)
        const { market } = context(req)
        const id = positiveRouteId(req.params?.id)
        serializeDiscountCode(req.body)
        res.json({ code: await service.update(market, id, req.body) })
      } catch (error) { fail(res, error, !error?.status) }
    },
    async setEnabled(req, res) {
      try {
        requireAdmin(req)
        const { market } = context(req)
        const id = positiveRouteId(req.params?.id)
        if (typeof req.body?.enabled !== 'boolean') throw Object.assign(new Error('enabled must be a boolean'), { status: 400 })
        serializeDiscountCode(req.body?.code)
        res.json({ code: await service.setEnabled(market, id, req.body.code, req.body.enabled) })
      } catch (error) { fail(res, error, !error?.status) }
    },
    async remove(req, res) {
      try {
        requireAdmin(req)
        const { market } = context(req)
        await service.remove(market, positiveRouteId(req.params?.id))
        res.json({ ok: true })
      } catch (error) { fail(res, error) }
    },
    async requests(req, res) {
      try {
        const { requests } = requestStore()
        const visible = req.authUser?.role === 'admin'
          ? requests
          : requests.filter(request => request.requestedByUserId === req.authUser?.userId || request.requestedByEmail === req.authUser?.email)
        res.json({ requests: visible.slice().sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).map(requestView) })
      } catch (error) { fail(res, error) }
    },
    async createRequest(req, res) {
      try {
        if (req.authUser?.role === 'admin') throw Object.assign(new Error('Admins can create discount codes directly'), { status: 400 })
        const { market } = context(req)
        // scopeLocation adds locationId to agent request bodies as an
        // authorization clamp. It is not a Momence discount-code field and
        // must never cross the integration boundary.
        const { locationId: _scopedLocationId, ...discountCodeInput } = req.body || {}
        const payload = serializeDiscountCode(discountCodeInput)
        const { db, requests } = requestStore()
        const duplicate = requests.find(request => request.status === 'pending' && request.requestedByUserId === req.authUser.userId && request.market === market && request.payload?.code === payload.code)
        if (duplicate) throw Object.assign(new Error(`A pending request already exists for ${payload.code}`), { status: 409 })
        const associate = db.associates?.find(item => item.id === req.authUser?.associateId)
        const requestedAt = now().toISOString()
        const request = {
          id: makeId(), market, status: 'pending', payload,
          requestedAt, updatedAt: requestedAt,
          requestedByUserId: req.authUser?.userId || null,
          requestedByAssociateId: req.authUser?.associateId || null,
          requestedByName: associate?.name || req.authUser?.email || 'Agent',
          requestedByEmail: req.authUser?.email || associate?.email || ''
        }
        requests.unshift(request)
        await saveMeta()
        res.status(201).json({ request: requestView(request) })
      } catch (error) { fail(res, error, !error?.status) }
    },
    async decideRequest(req, res) {
      let request = null
      try {
        requireAdmin(req)
        const decision = String(req.body?.decision || '').toLowerCase()
        if (!['approve', 'decline'].includes(decision)) throw Object.assign(new Error('Decision must be approve or decline'), { status: 400 })
        const { db, requests } = requestStore()
        request = requests.find(item => item.id === req.params?.id)
        if (!request) throw Object.assign(new Error('Discount code request not found'), { status: 404 })
        if (request.status !== 'pending') throw Object.assign(new Error('This discount code request has already been decided'), { status: 409 })
        request.status = 'processing'
        request.updatedAt = now().toISOString()
        await saveMeta()
        if (decision === 'approve') {
          const created = await service.create(request.market, request.payload)
          request.status = 'approved'
          request.momenceCodeId = Number(created?.id) || created?.id || null
        } else {
          request.status = 'declined'
        }
        request.decisionNote = String(req.body?.note || '').trim().slice(0, 1000)
        request.decidedAt = now().toISOString()
        request.decidedByUserId = req.authUser?.userId || null
        request.decidedByEmail = req.authUser?.email || ''
        request.updatedAt = request.decidedAt
        await saveMeta()
        await notifyDecision(db, request)
        res.json({ request: requestView(request) })
      } catch (error) {
        if (request?.status === 'processing') {
          request.status = 'pending'
          request.updatedAt = now().toISOString()
          await saveMeta().catch(() => {})
        }
        fail(res, error)
      }
    }
  }
}

const MARKET_LABELS = Object.freeze({ mumbai: 'Mumbai', blr: 'Bengaluru' })

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

export function isCodeActive(code, now = new Date()) {
  const time = now.getTime()
  if (code?.validFrom && new Date(code.validFrom).getTime() > time) return false
  if (code?.expiresAt && new Date(code.expiresAt).getTime() <= time) return false
  return true
}
