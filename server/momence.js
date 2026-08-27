// Momence Public API v2 client (https://api.momence.com)
import { save, nowIso } from './db.js'

const BASE = 'https://api.momence.com'
const TOKEN_URL = `${BASE}/api/v2/auth/token`

export function momenceConfig(db) {
  return db.settings.momence || {}
}

// Effective config: env vars take priority, then Settings, then defaults.
export function effectiveConfig(db, market = 'mumbai') {
  const c = momenceConfig(db)
  const suffix = market === 'blr' ? '_BLR' : ''
  const env = {
    clientId: (process.env[`USER_MOMENCE_CLIENT_ID${suffix}`] || '').trim(),
    clientSecret: (process.env[`USER_MOMENCE_CLIENT_SECRET${suffix}`] || '').trim(),
    username: (process.env[`USER_MOMENCE_USERNAME${suffix}`] || '').trim(),
    password: (process.env[`USER_MOMENCE_PASSWORD${suffix}`] || '').trim(),
    hostId: (process.env[`USER_MOMENCE_HOST_ID${suffix}`] || '').trim()
  }
  const stored = market === 'blr' ? (c.blr || {}) : c
  return {
    clientId: env.clientId || stored.clientId || '',
    clientSecret: env.clientSecret || stored.clientSecret || '',
    username: env.username || stored.username || '',
    password: env.password || stored.password || '',
    hostId: env.hostId || stored.hostId || (market === 'blr' ? '33905' : '13752')
  }
}

export function isConfigured(db, market = 'mumbai') {
  const c = effectiveConfig(db, market)
  return Boolean(c.clientId && c.clientSecret && c.username && c.password)
}

export function isAnyConfigured(db) {
  return isConfigured(db, 'mumbai') || isConfigured(db, 'blr')
}

export const HOME_LOCATION_IDS = Object.freeze({
  kwality: 9030,
  supreme: 29821,
  kenkere: 22116,
  copper: 36372,
  plash: 287883
})

export const PAYMENT_METHODS = Object.freeze({
  blr: [
    { id: 5802, paymentMode: 'immediate', label: 'Bank Transfer', canBeUsedOffSession: false },
    { id: 5886, paymentMode: 'immediate', label: 'Cheque', canBeUsedOffSession: false },
    { id: 5831, paymentMode: 'immediate', label: 'POS', canBeUsedOffSession: false },
    { id: 57340, paymentMode: 'immediate', label: 'Razorpay', canBeUsedOffSession: false },
    { id: 5801, paymentMode: 'immediate', label: 'Stripe Link', canBeUsedOffSession: false },
    { id: 5800, paymentMode: 'immediate', label: 'UPI', canBeUsedOffSession: false }
  ],
  mumbai: [
    { id: 4470, paymentMode: 'immediate', label: 'Bank Transfer', canBeUsedOffSession: false },
    { id: 4469, paymentMode: 'immediate', label: 'POS Machine', canBeUsedOffSession: false },
    { id: 20860, paymentMode: 'immediate', label: 'Razorpay', canBeUsedOffSession: false },
    { id: 4578, paymentMode: 'immediate', label: 'Stripe Link', canBeUsedOffSession: false },
    { id: 4352, paymentMode: 'immediate', label: 'UPI', canBeUsedOffSession: false }
  ]
})

export function paymentMethodsForLocation(locationId, db) {
  return PAYMENT_METHODS[marketForLocation(locationId, db)]
}

export function resolveHomeLocationId(value, db) {
  const numeric = Number(value)
  if (Number.isInteger(numeric) && numeric > 0) return numeric
  const location = db?.locations?.find(item => String(item.id) === String(value))
  const text = `${location?.name || ''} ${location?.city || ''} ${value || ''}`.toLowerCase()
  if (text.includes('kwality') || text.includes('kemps')) return HOME_LOCATION_IDS.kwality
  if (text.includes('supreme') || text.includes('bandra')) return HOME_LOCATION_IDS.supreme
  if (text.includes('kenkere')) return HOME_LOCATION_IDS.kenkere
  if (text.includes('copper') || text.includes('indiranagar')) return HOME_LOCATION_IDS.copper
  if (text.includes('plash')) return HOME_LOCATION_IDS.plash
  return null
}

export function marketForLocation(value, db) {
  const id = resolveHomeLocationId(value, db)
  return [HOME_LOCATION_IDS.kenkere, HOME_LOCATION_IDS.copper, HOME_LOCATION_IDS.plash].includes(id) ? 'blr' : 'mumbai'
}

export function isValidMemberId(memberId) {
  const id = String(memberId || '').trim()
  return Boolean(id && !['-', 'null', 'undefined', 'nan'].includes(id.toLowerCase()))
}

export function getCachedToken(db, market = 'mumbai') {
  const c = momenceConfig(db)
  const token = market === 'blr' ? c.tokenBlr : c.token
  if (token && token.expiresAt && new Date(token.expiresAt).getTime() > Date.now() + 300000) {
    return token.accessToken
  }
  return null
}

export async function getAccessToken(db, market = 'mumbai') {
  const cached = getCachedToken(db, market)
  if (cached) return cached

  const c = effectiveConfig(db, market)
  if (!c.clientId || !c.clientSecret || !c.username || !c.password) {
    throw new Error('Momence is not configured. Add client ID, secret, username and password in Settings.')
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    username: c.username,
    password: c.password,
    scope: 'public-api-v2'
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`
    },
    body: body.toString()
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Momence auth failed (${res.status}): ${data.error_description || data.message || JSON.stringify(data)}`)
  }

  const accessToken = data.accessToken || data.access_token
  if (!accessToken) throw new Error('Momence returned no access token.')

  const expiresIn = data.accessTokenExpiresIn || data.expires_in || 3600
  const tokenRecord = {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
  }
  if (market === 'blr') momenceConfig(db).tokenBlr = tokenRecord
  else momenceConfig(db).token = tokenRecord
  save()
  return accessToken
}

async function request(db, path, { method = 'GET', query, body, market = 'mumbai' } = {}) {
  const token = await getAccessToken(db, market)
  const url = new URL(BASE + path)
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (res.status === 401) {
    if (market === 'blr') momenceConfig(db).tokenBlr = null
    else momenceConfig(db).token = null
    save()
    const token2 = await getAccessToken(db, market)
    headers.Authorization = `Bearer ${token2}`
    const retry = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (!retry.ok) throw new Error(`Momence API ${retry.status}: ${await retry.text()}`)
    const retryText = await retry.text()
    return retryText ? JSON.parse(retryText) : { ok: true }
  }
  if (!res.ok) throw new Error(`Momence API ${res.status} for ${path}: ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : { ok: true }
}

export async function getSessions(db, filters = {}) {
  const locationMarket = filters.locationId ? marketForLocation(filters.locationId, db) : null
  const markets = locationMarket ? [locationMarket] : ['mumbai', 'blr'].filter(market => isConfigured(db, market))
  const results = await Promise.allSettled(markets.map(market => paginate(db, '/api/v2/host/sessions', {
    pageSize: 200, market,
    extra: { sortBy: 'startsAt', sortOrder: 'ASC', includeCancelled: true, startAfter: filters.startAfter, startBefore: filters.startBefore, locationId: filters.locationId }
  })))
  const sessions = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  if (!sessions.length && results.some(result => result.status === 'rejected')) throw results.find(result => result.status === 'rejected').reason
  return [...new Map(sessions.map(session => [String(session.id), session])).values()].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
}

export async function getSessionWorkspace(db, sessionId, locationId) {
  const market = marketForLocation(locationId, db)
  const [session, bookings] = await Promise.all([
    request(db, `/api/v2/host/sessions/${sessionId}`, { market }),
    paginate(db, `/api/v2/host/sessions/${sessionId}/bookings`, {
      pageSize: 100, market, extra: { sortBy: 'firstName', sortOrder: 'ASC', includeCancelled: true }
    })
  ])
  return { session, bookings }
}

export function addMemberToSession(db, sessionId, memberId, createRecurringBooking = false, locationId) {
  return request(db, `/api/v2/host/sessions/${sessionId}/bookings/free`, {
    method: 'POST', market: marketForLocation(locationId, db), body: { memberId: Number(memberId), createRecurringBooking: Boolean(createRecurringBooking) }
  })
}

export function addMemberToWaitlist(db, sessionId, memberId, locationId) {
  return request(db, `/api/v2/host/sessions/${sessionId}/waitlist/bookings`, {
    method: 'POST', market: marketForLocation(locationId, db), body: { memberId: Number(memberId) }
  })
}

export function setBookingCheckIn(db, bookingId, checkedIn, locationId) {
  return request(db, `/api/v2/host/session-bookings/${bookingId}/check-in`, {
    method: checkedIn ? 'POST' : 'DELETE', market: marketForLocation(locationId, db)
  })
}

export function cancelSessionBooking(db, bookingId, options = {}) {
  return request(db, `/api/v2/host/session-bookings/${bookingId}`, {
    method: 'DELETE', market: marketForLocation(options.locationId, db),
    body: {
      refund: options.refund !== false,
      disableNotifications: Boolean(options.disableNotifications),
      isLateCancellation: Boolean(options.isLateCancellation)
    }
  })
}

function dashboardCookie(market) {
  return String(market === 'blr'
    ? (process.env.MOMENCE_ALL_COOKIES_BLR || process.env.MOMENCE_BLR_COOKIES || '')
    : (process.env.MOMENCE_ALL_COOKIES || process.env.MOMENCE_MUMBAI_COOKIES || '')).trim()
}

async function dashboardRequest(db, path, { market = 'mumbai', method = 'GET', body } = {}) {
  const cookie = dashboardCookie(market)
  if (!cookie) throw new Error(`Momence dashboard session is not configured for ${market === 'blr' ? 'Bengaluru' : 'Mumbai'}. Refresh the server-side login cookie first.`)
  const hostId = effectiveConfig(db, market).hostId
  const origin = `https://momence.com/dashboard/${hostId}`
  const response = await fetch(`https://momence.com/_api/primary/host/${hostId}${path}`, {
    method,
    headers: {
      Accept: 'application/json, text/plain, */*',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Cookie: cookie,
      Origin: 'https://momence.com',
      Referer: `${origin}/`,
      'x-origin': origin,
      'x-idempotence-key': crypto.randomUUID()
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await response.text()
  const data = text ? (() => { try { return JSON.parse(text) } catch { return { message: text } } })() : { ok: true }
  if (!response.ok) throw new Error(`Momence dashboard API ${response.status}: ${data.error || data.message || 'Request failed'}`)
  return data
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// Public API v2 async report runner (POST to start, poll GET until complete).
// Used for sales/purchase history instead of the /host/sales endpoint, which
// only returns a shallow live listing — the reports endpoint is what Momence
// itself uses for full, refund-aware sales history.
export async function runHostReport(db, reportType, { market = 'mumbai', startDate, endDate, locationId, ...extra } = {}) {
  const hostId = Number(effectiveConfig(db, market).hostId)
  if (!hostId) throw new Error(`Momence host ID is not configured for ${market === 'blr' ? 'Bengaluru' : 'Mumbai'}.`)
  const parameters = { reportType, dateRange: { from: startDate, to: endDate }, hostId, ...extra }
  const resolvedLocationId = resolveHomeLocationId(locationId, db)
  if (resolvedLocationId) parameters.locationId = resolvedLocationId
  const started = await request(db, '/api/v2/host/reports', { method: 'POST', market, body: { parameters } })
  const runId = started?.id
  if (!runId) throw new Error(`Momence ${reportType} report did not return a report ID.`)
  for (let attempt = 0; attempt < 180; attempt++) {
    const result = await request(db, `/api/v2/host/reports/${runId}`, { market })
    const status = String(result?.status || '').toLowerCase()
    if (['failed', 'error', 'cancelled'].includes(status)) throw new Error(`Momence ${reportType} report ${runId} ${status}.`)
    if (status === 'completed') return result?.data?.items || []
    await wait(1000)
  }
  throw new Error(`Momence ${reportType} report timed out.`)
}
const firstValue = (value, keys) => {
  for (const key of keys) if (value?.[key] !== undefined && value?.[key] !== null && value?.[key] !== '') return value[key]
  if (value && typeof value === 'object') {
    const wanted = new Set(keys.map(key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '')))
    for (const [key, fieldValue] of Object.entries(value)) {
      if (wanted.has(String(key).toLowerCase().replace(/[^a-z0-9]/g, '')) && fieldValue !== undefined && fieldValue !== null && fieldValue !== '') return fieldValue
    }
  }
  return null
}

const cleanPhone = value => String(value || '').replace(/\D/g, '').slice(-10)
const cleanEmail = value => String(value || '').trim().toLowerCase()
const asBool = value => value === true || value === 1 || ['true', 'yes', 'y', '1'].includes(String(value || '').trim().toLowerCase())
const rowDate = (row, keys) => {
  // Momence report exports put dates on different nested objects depending on
  // the report version. Keep the report-driven lifecycle fields populated even
  // when the matching member is present on the flattened item row.
  const candidates = [
    row,
    row?.item,
    row?.sale,
    row?.booking,
    row?.session,
    row?.bookedEntity,
    row?.member,
    row?.customer
  ]
  for (const candidate of candidates) {
    const value = firstValue(candidate, keys)
    const date = value ? new Date(value) : null
    if (date && !Number.isNaN(date.getTime())) return date
  }
  return null
}
const rowMemberId = row => String(firstValue(row, ['memberId', 'customerId', 'clientId', 'targetMemberId', 'payingMemberId']) || firstValue(row?.member, ['id']) || firstValue(row?.customer, ['id']) || '').trim()
const rowEmail = row => cleanEmail(firstValue(row, ['email', 'memberEmail', 'customerEmail', 'clientEmail', 'payingCustomerEmail']) || row?.member?.email || row?.customer?.email)
const rowPhone = row => cleanPhone(firstValue(row, ['phone', 'phoneNumber', 'memberPhone', 'customerPhone']) || row?.member?.phoneNumber || row?.customer?.phoneNumber)
const matchesLead = (row, lead) => {
  const idMatch = isValidMemberId(lead.memberId) && rowMemberId(row) && String(lead.memberId) === rowMemberId(row)
  const emailMatch = Boolean(lead.email && rowEmail(row) && cleanEmail(lead.email) === rowEmail(row))
  // Reports must be joined by the lead's linked Momence member ID or email.
  // Phone values are too easily shared/rewritten to establish lifecycle proof.
  return Boolean(idMatch || emailMatch)
}
const saleType = row => String(firstValue(row, ['saleType', 'itemType', 'type', 'productType', 'category', 'paymentCategory', 'membershipType']) || firstValue(row?.item, ['itemType', 'type']) || '').toLowerCase()
const isQualifiedMembershipSale = row => {
  const type = saleType(row)
  const voided = asBool(firstValue(row, ['voided', 'isVoided', 'cancelled', 'isCancelled']))
  const refundedAmount = Number(firstValue(row, ['refunded']) ?? 0)
  const refunded = asBool(firstValue(row, ['fullyRefunded', 'isRefunded'])) || refundedAmount > 0 || String(firstValue(row, ['status', 'paymentStatus']) || '').toLowerCase().includes('refund')
  const failed = String(firstValue(row, ['paymentStatus']) || '').toLowerCase() === 'failed'
  return /membership|subscription|pack/.test(type) && !voided && !refunded && !failed
}

// Trial completion is proven by the member's own attended-class history, not
// a booking report — a booking can be made and never shown up to. Only counts
// if the first attended class happened after the lead was created.
async function firstAttendedClassDate(db, memberId, market) {
  try {
    const sessions = await getMemberSessions(db, memberId, market)
    const attendedDates = sessions
      .filter(s => !s.cancelledAt && asBool(firstValue(s, ['checkedIn', 'attended', 'isCheckedIn'])))
      .map(s => rowDate(s, ['startsAt', 'sessionStartsAt', 'sessionDate', 'classDate']))
      .filter(Boolean)
      .sort((a, b) => a - b)
    return attendedDates[0] || null
  } catch (e) {
    return null
  }
}

export function applyLifecycleEvidence(leads, salesRows, trialDateByMemberId, market, db) {
  const expandedSales = salesRows.flatMap(row => Array.isArray(row?.items) && row.items.length ? row.items.map(item => ({ ...row, ...item, item, member: item.targetMember || item.payingMember || row.member, customer: item.targetMember || item.payingMember || row.customer })) : [row])
  let updated = 0
  const updatedLeadIds = []
  for (const lead of leads) {
    if (marketForLocation(lead.locationId, db) !== market) continue
    const createdAt = new Date(lead.createdAt || 0)
    if (Number.isNaN(createdAt.getTime())) continue
    const firstPurchase = expandedSales
      .filter(row => matchesLead(row, lead) && isQualifiedMembershipSale(row))
      .map(row => rowDate(row, ['saleDate', 'soldAt', 'purchaseDate', 'transactionDate', 'paymentDate', 'createdAt', 'date']))
      .filter(date => date && date > createdAt)
      .sort((a, b) => a - b)[0] || null
    const attended = isValidMemberId(lead.memberId) ? trialDateByMemberId.get(String(lead.memberId)) : null
    const firstTrial = attended && attended > createdAt ? attended : null
    const evidence = {
      market,
      trialCompleted: Boolean(firstTrial),
      trialDate: firstTrial?.toISOString() || null,
      membershipSold: Boolean(firstPurchase),
      firstPurchaseDate: firstPurchase?.toISOString() || null
    }
    const previous = lead.momenceEvidence || {}
    const previousEvidence = { market: previous.market, trialCompleted: Boolean(previous.trialCompleted), trialDate: previous.trialDate || null, membershipSold: Boolean(previous.membershipSold), firstPurchaseDate: previous.firstPurchaseDate || null }
    if (JSON.stringify(previousEvidence) !== JSON.stringify(evidence)) {
      updated++
      updatedLeadIds.push(lead.id)
      lead.momenceEvidence = { ...evidence, checkedAt: nowIso() }
      if (firstPurchase) lead.convertedAt = firstPurchase.toISOString()
    }
  }
  return { updated, updatedLeadIds }
}

export async function syncLifecycleEvidence(db, leads = db.leads || []) {
  const validDates = leads.map(lead => new Date(lead.createdAt)).filter(date => !Number.isNaN(date.getTime()))
  const startDate = (validDates.sort((a, b) => a - b)[0] || new Date(Date.now() - 365 * 86400000)).toISOString()
  const endDate = new Date().toISOString()
  const summary = []
  const updatedLeadIds = []
  for (const market of ['mumbai', 'blr']) {
    if (!isConfigured(db, market)) { summary.push({ market, skipped: true, reason: 'not-configured' }); continue }
    const marketLeads = leads.filter(lead => marketForLocation(lead.locationId, db) === market)
    let sales = []
    try {
      sales = await runHostReport(db, 'total-sales', {
        market,
        startDate,
        endDate,
        saleTypes: ['membership', 'session', 'appointment', 'monthly-subscription', 'custom-member-payment-plan-installment'],
        moneyCreditSalesFilter: 'noFilter',
        includeRefunds: true,
        excludeGiftCardPaymentMethod: true,
        excludeTransactionFeesInSaleValue: false
      })
    } catch (e) {
      summary.push({ market, skipped: true, reason: e.message })
      continue
    }
    const memberIds = [...new Set(marketLeads.map(lead => lead.memberId).filter(isValidMemberId).map(String))]
    const trialDateByMemberId = new Map()
    const CONCURRENCY = 5
    for (let i = 0; i < memberIds.length; i += CONCURRENCY) {
      const batch = memberIds.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map(id => firstAttendedClassDate(db, id, market)))
      batch.forEach((id, idx) => trialDateByMemberId.set(id, results[idx]))
    }
    const applied = applyLifecycleEvidence(marketLeads, sales, trialDateByMemberId, market, db)
    updatedLeadIds.push(...applied.updatedLeadIds)
    summary.push({ market, sales: sales.length, members: memberIds.length, updated: applied.updated })
  }
  save()
  return { summary, updatedLeadIds: [...new Set(updatedLeadIds)] }
}

const membershipRows = data => {
  if (Array.isArray(data)) return data
  for (const value of [data?.memberships, data?.items, data?.payload?.memberships, data?.payload?.items, data?.payload, data?.data?.memberships, data?.data]) {
    if (Array.isArray(value)) return value
  }
  return []
}
const bookingMembershipId = item => item?.bookingMembershipId || item?.boughtMembershipId || item?.boughtMembership?.id || item?.id || item?.membershipId
const activeBookingMembership = item => {
  const now = Date.now()
  const startValue = firstValue(item, ['startDate', 'startsAt', 'validFrom', 'activatedAt'])
  const endValue = firstValue(item, ['endDate', 'endsAt', 'validTo', 'expiresAt', 'expirationDate'])
  const start = startValue ? new Date(startValue).getTime() : null
  const end = endValue ? new Date(endValue).getTime() : null
  const state = String(item?.status || item?.membershipStatus || '').toLowerCase()
  if (item?.deletedAt || item?.isVoided || item?.isFreezed || item?.isFrozen || item?.isActive === false || item?.active === false || ['expired', 'inactive', 'cancelled', 'canceled', 'voided', 'frozen'].includes(state)) return false
  if (item?.membership?.disabled || item?.membership?.isDeleted) return false
  if (Number.isFinite(start) && start > now) return false
  if (Number.isFinite(end) && end < now) return false
  if (item?.classesLeft !== null && item?.classesLeft !== undefined && Number(item.classesLeft) <= 0) return false
  if (item?.combinedUsageLimit !== null && item?.combinedUsageLimit !== undefined && item?.combinedUsage !== null && item?.combinedUsage !== undefined && Number(item.combinedUsage) >= Number(item.combinedUsageLimit)) return false
  return Boolean(bookingMembershipId(item))
}

export async function getAvailableBookingMemberships(db, memberId, sessionId, locationId, recurringBooking = false) {
  const market = marketForLocation(locationId, db)
  const rows = membershipRows(await dashboardRequest(db, `/auto-book/member/${Number(memberId)}/session/${Number(sessionId)}/memberships?recurringBooking=${Boolean(recurringBooking)}`, { market }))
  return rows.filter(activeBookingMembership).map(item => ({ ...item, bookingMembershipId: bookingMembershipId(item) }))
}

export async function autoBookMember(db, sessionId, memberId, options = {}) {
  const market = marketForLocation(options.locationId, db)
  const recurringBooking = Boolean(options.createRecurringBooking || options.recurringBooking)
  // Always re-fetch immediately before booking. This validates that the
  // membership selected by the UI is still active and eligible for this exact
  // session, instead of trusting stale client state.
  const memberships = await getAvailableBookingMemberships(db, memberId, sessionId, options.locationId, recurringBooking)
  const selected = options.membershipId
    ? memberships.find(item => String(bookingMembershipId(item)) === String(options.membershipId))
    : memberships.find(item => item.isActive !== false && item.isEligible !== false && item.canBook !== false)
  const membershipId = bookingMembershipId(selected)
  if (!membershipId) {
    const error = new Error('No eligible active membership is available for this session. Select a host membership to create a new sale first.')
    error.code = 'NO_ELIGIBLE_MEMBERSHIP'
    error.memberships = memberships
    throw error
  }
  return dashboardRequest(db, `/auto-book/member/${Number(memberId)}/session/${Number(sessionId)}`, {
    market,
    method: 'POST',
    body: {
      autoCheckin: Boolean(options.autoCheckin),
      membershipIds: [Number(membershipId)],
      addToWaitlist: false,
      isCapacityOverriden: Boolean(options.overrideCapacity),
      isAgeRestrictionOverridden: Boolean(options.overrideAgeRestriction)
    }
  })
}

export async function purchaseMembership(db, memberId, options = {}) {
  const market = marketForLocation(options.locationId, db)
  const methods = PAYMENT_METHODS[market]
  const paymentMethod = methods.find(method => String(method.id) === String(options.paymentMethodId))
  if (!paymentMethod) throw new Error('Select a valid payment method for this studio.')
  const catalog = await getHostMemberships(db, options.locationId)
  const membership = catalog.find(item => String(item.id) === String(options.membershipId) && item.disabled !== true && item.isDeleted !== true)
  if (!membership) throw new Error('The selected host membership is no longer available.')
  const priceInCurrency = Number(options.priceInCurrency ?? membership.price)
  if (!Number.isFinite(priceInCurrency) || priceInCurrency < 0) throw new Error('The selected membership has an invalid price.')
  const guid = crypto.randomUUID()
  const item = {
    guid,
    type: 'membership',
    quantity: 1,
    priceInCurrency,
    isPaymentPlanUsed: false,
    membershipId: Number(membership.id),
    appliedPriceRuleIds: []
  }
  await dashboardRequest(db, '/pos/payments/recalculate-cart', {
    market,
    method: 'POST',
    body: { hostId: Number(effectiveConfig(db, market).hostId), items: [item], payingMemberId: Number(memberId), targetMemberId: Number(memberId), discounts: {} }
  })
  const result = await dashboardRequest(db, '/pos/payments/pay-cart', {
    market,
    method: 'POST',
    body: {
      hostId: Number(effectiveConfig(db, market).hostId),
      payingMemberId: Number(memberId),
      targetMemberId: Number(memberId),
      items: [item],
      paymentMethods: [{ type: 'custom', customPaymentMethodId: Number(paymentMethod.id), weightRelative: 1, guid: crypto.randomUUID() }],
      isEmailSent: Boolean(options.isEmailSent),
      homeLocationId: resolveHomeLocationId(options.locationId, db)
    }
  })
  return { result, membership: { id: membership.id, name: membership.name }, paymentMethod }
}

export async function createMember(db, input = {}) {
  const email = String(input.email || '').trim()
  const firstName = String(input.firstName || '').trim()
  const lastName = String(input.lastName || '').trim()
  const phoneNumber = String(input.phoneNumber || '').trim()
  const homeLocationId = resolveHomeLocationId(input.homeLocationId, db)

  if (!email || !firstName || !lastName) {
    throw new Error('Email, first name and last name are required to create a Momence member.')
  }
  if (email.length > 100 || firstName.length > 100 || lastName.length > 100) {
    throw new Error('Email, first name and last name must each be 100 characters or fewer.')
  }

  const payload = { email, firstName, lastName }
  if (phoneNumber) payload.phoneNumber = phoneNumber
  if (!homeLocationId) throw new Error('Select a supported home location before creating the Momence member.')
  payload.homeLocationId = homeLocationId

  const created = await request(db, '/api/v2/host/members', { method: 'POST', market: marketForLocation(homeLocationId, db), body: payload })
  if (!isValidMemberId(created?.memberId)) throw new Error('Momence created the member but returned no valid member ID.')
  return { memberId: String(created.memberId) }
}

async function paginate(db, path, { pageSize = 100, extra = {}, market = 'mumbai' } = {}) {
  const all = []
  let page = 0
  for (;;) {
    const data = await request(db, path, { market, query: { page, pageSize, ...extra } })
    const payload = data.payload || data.items || data.data || []
    all.push(...payload)
    const meta = data.meta || {}
    const total = typeof meta.total === 'number' ? meta.total : all.length + 1
    if (page * pageSize + payload.length >= total || payload.length < pageSize || payload.length === 0) break
    page++
    if (page > 50) break
  }
  return all
}

async function safePaginate(db, path, opts = {}, fallback = []) {
  try {
    return await paginate(db, path, opts)
  } catch (e) {
    if (String(e?.message || '').includes('Momence API 404')) return fallback
    throw e
  }
}

export async function getProfile(db) {
  return request(db, '/api/v2/auth/profile')
}

export async function getMember(db, memberId, market = 'mumbai') {
  return request(db, `/api/v2/host/members/${memberId}`, { market })
}

export async function getMemberSessions(db, memberId, market = 'mumbai') {
  return safePaginate(db, `/api/v2/host/members/${memberId}/sessions`, { market, extra: { includeCancelled: true } }, [])
}

export async function getMemberMemberships(db, memberId, market = 'mumbai') {
  return safePaginate(db, `/api/v2/host/members/${memberId}/bought-memberships/active`, { market, extra: { includeFrozen: true } }, [])
}

export async function getHostMemberships(db, locationId) {
  const market = marketForLocation(locationId, db)
  return safePaginate(db, '/api/v2/host/memberships', {
    market,
    pageSize: 200,
    extra: {
      sortOrder: 'DESC',
      sortBy: 'name',
      includeDisabled: false,
      onlyFeatured: true
    }
  }, [])
}

export async function getMemberNotes(db, memberId, market = 'mumbai') {
  return safePaginate(db, `/api/v2/host/members/${memberId}/notes`, { market }, [])
}

export async function getMemberAppointments(db, memberId, market = 'mumbai') {
  return safePaginate(db, `/api/v2/host/members/${memberId}/appointments`, { market, extra: { includeCancelled: true } }, [])
}

export async function searchMembers(db, query, market = 'mumbai') {
  return paginate(db, '/api/v2/host/members', { market, extra: { query } })
}

const digitsOnly = (v) => String(v || '').replace(/\D+/g, '')
const normEmail = (v) => String(v || '').trim().toLowerCase()

// Locate the Momence member(s) matching a lead's email/phone — this is how a
// lead gets linked without anyone having to know or paste a numeric Momence
// member ID. Email match takes priority (unique in practice); phone falls
// back to comparing the last 10 digits, since Momence and CRM numbers may
// differ in country-code formatting.
export async function findMemberCandidates(db, { email, phone, locationId } = {}) {
  const market = marketForLocation(locationId, db)
  const wantEmail = normEmail(email)
  const wantPhone = digitsOnly(phone).slice(-10)

  if (wantEmail) {
    const byEmail = await searchMembers(db, email, market)
    const exact = byEmail.filter(m => normEmail(m.email) === wantEmail)
    if (exact.length) return exact
  }

  if (wantPhone && wantPhone.length >= 7) {
    const byPhone = await searchMembers(db, phone, market)
    const exact = byPhone.filter(m => digitsOnly(m.phoneNumber).slice(-10) === wantPhone)
    if (exact.length) return exact
  }

  return []
}

export async function testConnection(db) {
  const profile = await getProfile(db)
  return { ok: true, profile }
}

export function mapClassHistory(sessions) {
  return (sessions || [])
    .map(s => ({
      id: s.id,
      name: s.session?.name || 'Class',
      type: s.session?.type || 'fitness',
      startsAt: s.session?.startsAt,
      endsAt: s.session?.endsAt,
      teacher: s.session?.teacher ? `${s.session.teacher.firstName || ''} ${s.session.teacher.lastName || ''}`.trim() : null,
      locationName: s.session?.inPersonLocation?.name || s.session?.location?.name || null,
      roomName: s.session?.room?.name || s.session?.space?.name || null,
      checkedIn: s.checkedIn,
      cancelledAt: s.cancelledAt
    }))
    .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt))
}

// Maps items from the /host/reports "total-sales" report run — the
// refund-aware, complete purchase history — not the shallow /host/sales listing.
export function mapSalesHistoryReport(items) {
  return (items || [])
    .map(item => ({
      id: item.paymentTransactionId || item.saleItemId,
      saleDate: item.paymentDate || item.serviceDate,
      itemType: item.paymentCategory || item.membershipType || 'sale',
      itemName: item.paymentItem || 'Sale',
      totalInCurrency: String(Math.max(0, (Number(item.paymentValue) || 0) - (Number(item.refunded) || 0))),
      paymentMethod: item.paymentMethod || 'unknown',
      payingMember: item.payingCustomerName || null
    }))
    .sort((a, b) => new Date(b.saleDate) - new Date(a.saleDate))
}

export function mapMemberships(memberships) {
  return (memberships || []).map(m => ({
    id: m.id,
    type: m.type,
    name: m.membership?.name || m.type,
    startDate: m.startDate,
    endDate: m.endDate,
    isFrozen: m.isFrozen,
    eventCreditsLeft: m.eventCreditsLeft,
    eventCreditsTotal: m.eventCreditsTotal,
    moneyCreditsLeft: m.moneyCreditsLeft,
    moneyCreditsTotal: m.moneyCreditsTotal,
    usedSessions: m.usedSessions,
    combinedUsage: m.combinedUsage,
    combinedUsageLimit: m.combinedUsageLimit,
    autoRenewing: m.membership?.autoRenewing ?? null,
    locationName: m.location?.name || m.membership?.location?.name || null
  }))
}

export function mapAppointments(appointments) {
  return (appointments || [])
    .map(a => ({
      id: a.id,
      name: a.appointment?.name || a.service?.name || 'Appointment',
      startsAt: a.startsAt || a.appointment?.startsAt,
      endsAt: a.endsAt || a.appointment?.endsAt,
      staff: a.staff ? `${a.staff.firstName || ''} ${a.staff.lastName || ''}`.trim() : null,
      status: a.status || (a.cancelledAt ? 'cancelled' : 'booked'),
      cancelledAt: a.cancelledAt
    }))
    .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt))
}

export async function buildProfile(db, memberId, locationId) {
  const safeMemberId = String(memberId || '').trim()
  if (!isValidMemberId(safeMemberId)) {
    throw new Error('Momence member ID is missing or invalid.')
  }
  const market = marketForLocation(locationId, db)
  const member = await getMember(db, safeMemberId, market)
  const [sessions, memberships, notes, appointments] = await Promise.all([
    getMemberSessions(db, safeMemberId, market).catch(() => []),
    getMemberMemberships(db, safeMemberId, market).catch(() => []),
    getMemberNotes(db, safeMemberId, market).catch(() => []),
    getMemberAppointments(db, safeMemberId, market).catch(() => [])
  ])
  let salesHistory = []
  try {
    const from = member.firstSeen ? new Date(member.firstSeen) : new Date(Date.now() - 3 * 365 * 86400000)
    const items = await runHostReport(db, 'total-sales', {
      market,
      locationId,
      startDate: from.toISOString(),
      endDate: new Date().toISOString(),
      saleTypes: ['membership', 'session', 'appointment', 'monthly-subscription', 'custom-member-payment-plan-installment'],
      moneyCreditSalesFilter: 'noFilter',
      includeRefunds: true,
      excludeGiftCardPaymentMethod: true,
      excludeTransactionFeesInSaleValue: false
    })
    salesHistory = mapSalesHistoryReport(items.filter(item =>
      String(item.memberId) === String(safeMemberId) || String(item.payingMemberId) === String(safeMemberId)
    ))
  } catch (e) {
    salesHistory = []
  }
  const customFields = member.customFields || member.customFieldValues || {}
  const profile = {
    member: {
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      phoneNumber: member.phoneNumber,
      firstSeen: member.firstSeen,
      lastSeen: member.lastSeen,
      visits: member.visits,
      homeLocationName: member.homeLocation?.name || member.homeLocationName || member.location?.name || null,
      customFields,
      tags: (member.customerTags || []).map(t => t.name)
    },
    customFields,
    memberships: mapMemberships(memberships),
    classHistory: mapClassHistory(sessions),
    appointments: mapAppointments(appointments),
    salesHistory,
    notes: mapNotes(notes).slice(0, 20),
    syncedAt: nowIso()
  }
  return profile
}

function mapNotes(notes) {
  return (notes || [])
    .map(n => ({
      id: n.id,
      note: n.note || n.text || n.content || n.body || '',
      createdAt: n.createdAt || n.created_at || n.updatedAt,
      author: n.author ? `${n.author.firstName || ''} ${n.author.lastName || ''}`.trim() : (n.createdBy || n.staffName || null)
    }))
    .filter(n => n.note || n.createdAt)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
}

export async function syncLeadMomence(db, lead) {
  if (!isValidMemberId(lead?.memberId)) {
    throw new Error('Lead is not linked to a valid Momence member yet.')
  }
  const profile = await buildProfile(db, lead.memberId, lead.locationId)
  lead.momence = profile
  lead.momenceSyncedAt = nowIso()
  save()
  return profile
}

// Resolves a lead's Momence member ID by contact match and persists it,
// so future syncs skip the lookup. Throws with a message safe to surface
// to the UI ('no-match' / 'ambiguous') when the caller needs to branch.
export async function resolveLeadMember(db, lead) {
  if (isValidMemberId(lead.memberId)) return { memberId: String(lead.memberId).trim(), candidates: null }
  if (lead.memberId) lead.memberId = ''

  const candidates = await findMemberCandidates(db, { email: lead.email, phone: lead.phone, locationId: lead.locationId })
  if (candidates.length === 1) {
    lead.memberId = String(candidates[0].id)
    save()
    return { memberId: lead.memberId, candidates: null }
  }
  return { memberId: null, candidates }
}
