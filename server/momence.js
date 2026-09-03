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
    extra: { sortBy: 'startsAt', sortOrder: 'ASC', includeCancelled: true, startAfter: filters.startAfter, startBefore: filters.startBefore, locationId: filters.locationId ? resolveHomeLocationId(filters.locationId, db) : undefined }
  })))
  const sessions = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  if (!sessions.length && results.some(result => result.status === 'rejected')) throw results.find(result => result.status === 'rejected').reason
  return [...new Map(sessions.map(session => [String(session.id), session])).values()].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
}

// The booking objects Momence returns carry no field for which membership
// was consumed (confirmed against the public API v2 docs — booking DTOs only
// have check-in/cancellation metadata). The closest real signal is the
// member's own active memberships, fetched per booked member.
async function attachMembershipUsed(db, bookings, market) {
  const memberIds = [...new Set(bookings.filter(b => !b.cancelledAt && b.member?.id).map(b => String(b.member.id)))]
  const byMember = new Map()
  const CONCURRENCY = 5
  for (let i = 0; i < memberIds.length; i += CONCURRENCY) {
    const batch = memberIds.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(id => getMemberMemberships(db, id, market).catch(() => [])))
    batch.forEach((id, idx) => byMember.set(id, results[idx]))
  }
  return bookings.map(b => {
    const memberships = b.member?.id ? (byMember.get(String(b.member.id)) || []) : []
    // No booking-level field ties a booking to a specific membership, so this
    // is a best-effort pick among the member's active plans: prefer one that's
    // not frozen, has an explicit active date range (a real subscription
    // rather than an undated credit pack), and still has usage left.
    const now = Date.now()
    const score = m => {
      let s = 0
      if (!m.isFrozen) s += 4
      if (m.startDate && m.endDate && new Date(m.startDate).getTime() <= now && now <= new Date(m.endDate).getTime()) s += 2
      if (m.eventCreditsLeft == null || m.eventCreditsLeft > 0) s += 1
      return s
    }
    const best = [...memberships].sort((a, b2) => score(b2) - score(a))[0] || null
    const name = best?.membership?.name || best?.type
    const isUnlimited = /unlimited/i.test(name || '')
    return {
      ...b,
      membershipUsed: best ? {
        name,
        type: best.type,
        classesLeft: isUnlimited ? null : best.eventCreditsLeft,
        unlimited: isUnlimited,
        count: memberships.length
      } : null
    }
  })
}

export async function getSessionWorkspace(db, sessionId, locationId) {
  const market = marketForLocation(locationId, db)
  const [session, bookings] = await Promise.all([
    request(db, `/api/v2/host/sessions/${sessionId}`, { market }),
    paginate(db, `/api/v2/host/sessions/${sessionId}/bookings`, {
      pageSize: 100, market, extra: { sortBy: 'firstName', sortOrder: 'ASC', includeCancelled: true }
    })
  ])
  const enrichedBookings = await attachMembershipUsed(db, bookings, market)
  return { session, bookings: enrichedBookings }
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
  for (let attempt = 0; attempt < 60; attempt++) {
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
// A $0 "membership" row is how Momence records a free trial pack — it's a
// real, non-voided membership sale by every other field, so without an
// amount check it reads as the member's first purchase. First *paid*
// purchase is what "first purchase date" is supposed to mean.
const saleAmount = row => Number(firstValue(row, ['totalInCurrency', 'total', 'amount', 'price', 'netAmount']) ?? 0)
const isQualifiedMembershipSale = row => {
  const type = saleType(row)
  const voided = asBool(firstValue(row, ['voided', 'isVoided', 'cancelled', 'isCancelled']))
  const refundedAmount = Number(firstValue(row, ['refunded']) ?? 0)
  const refunded = asBool(firstValue(row, ['fullyRefunded', 'isRefunded'])) || refundedAmount > 0 || String(firstValue(row, ['status', 'paymentStatus']) || '').toLowerCase().includes('refund')
  const failed = String(firstValue(row, ['paymentStatus']) || '').toLowerCase() === 'failed'
  return /membership|subscription|pack/.test(type) && !voided && !refunded && !failed && saleAmount(row) > 0
}

// Trial completion is proven by the member's own attended-class history, not
// a booking report — a booking can be made and never shown up to. Only counts
// if the first attended class happened after the lead was created.
// The lifecycle job's sales report covers the org's whole history, and
// starting one makes Momence build a report server-side which we then poll for
// up to 60 rounds. The 15s-after-boot run and the 6-hourly run (and any manual
// trigger in between) were each paying for that in full. Same parameters
// within the window means the same answer, so serve it from memory.
//
// Only the lifecycle path uses this; runHostReport stays uncached for callers
// that are explicitly asking Momence for a fresh report right now.
const REPORT_CACHE_TTL_MS = 60 * 60 * 1000
const reportCache = new Map()

async function runHostReportCached(db, reportType, params, { fresh = false } = {}) {
  const key = JSON.stringify([reportType, params])
  const hit = reportCache.get(key)
  // `fresh` is how a human-triggered sync opts out: someone who just pressed
  // "sync now" is asking Momence, not asking us what Momence said earlier.
  if (!fresh && hit && Date.now() - hit.at < REPORT_CACHE_TTL_MS) return hit.rows
  const rows = await runHostReport(db, reportType, params)
  reportCache.set(key, { at: Date.now(), rows })
  // One report per market per window; anything older than the window is dead
  // weight, and this map must not grow for the life of the process.
  for (const [k, v] of reportCache) if (Date.now() - v.at >= REPORT_CACHE_TTL_MS) reportCache.delete(k)
  return rows
}

async function firstAttendedClassDate(db, memberId, market, retried = false) {
  try {
    const sessions = await getMemberSessions(db, memberId, market)
    const attendedDates = sessions
      .filter(s => !s.cancelledAt && asBool(firstValue(s, ['checkedIn', 'attended', 'isCheckedIn'])))
      .map(s => rowDate(s, ['startsAt', 'sessionStartsAt', 'sessionDate', 'classDate']))
      .filter(Boolean)
      .sort((a, b) => a - b)
    return attendedDates[0] || null
  } catch (e) {
    if (!retried && /429|rate limit/i.test(String(e?.message || ''))) {
      await wait(2000)
      return firstAttendedClassDate(db, memberId, market, true)
    }
    return null
  }
}

export function applyLifecycleEvidence(leads, salesRows, trialDateByMemberId, market, db) {
  const expandedSales = salesRows.flatMap(row => Array.isArray(row?.items) && row.items.length ? row.items.map(item => ({ ...row, ...item, item, member: item.targetMember || item.payingMember || row.member, customer: item.targetMember || item.payingMember || row.customer })) : [row])

  // matchesLead joins on exactly two exact-match keys: the Momence member id
  // and the email. Scanning every sale row per lead made this O(leads x sales)
  // -- 24k leads against a full sales history is hundreds of millions of
  // comparisons per run. Indexing the sales side once makes it O(leads + sales)
  // and returns the same rows, since both keys were already exact equality.
  //
  // Only qualified membership sales can ever produce evidence, so the filter
  // moves up here too: rows that could never match are never indexed.
  const byMemberId = new Map()
  const byEmail = new Map()
  const push = (map, key, row) => {
    if (!key) return
    const bucket = map.get(key)
    if (bucket) bucket.push(row)
    else map.set(key, [row])
  }
  for (const row of expandedSales) {
    if (!isQualifiedMembershipSale(row)) continue
    push(byMemberId, rowMemberId(row), row)
    push(byEmail, rowEmail(row), row)
  }

  let updated = 0
  const updatedLeadIds = []
  for (const lead of leads) {
    if (marketForLocation(lead.locationId, db) !== market) continue
    const createdAt = new Date(lead.createdAt || 0)
    if (Number.isNaN(createdAt.getTime())) continue
    // A lead can match by id, by email, or by both — the union, de-duplicated,
    // is what the old per-row `matchesLead` filter would have returned.
    const candidates = new Set()
    if (isValidMemberId(lead.memberId)) {
      for (const row of byMemberId.get(String(lead.memberId)) || []) candidates.add(row)
    }
    if (lead.email) {
      for (const row of byEmail.get(cleanEmail(lead.email)) || []) candidates.add(row)
    }
    const firstPurchase = [...candidates]
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

// One /host/members/:id/sessions call per member — bounded per run so a large
// backlog can't turn a single sync into an hours-long, rate-limit-inviting run.
// Uncovered members just get picked up first next cycle (see hasEvidence sort).
const MAX_MEMBERS_PER_MARKET_PER_RUN = 4000

export async function syncLifecycleEvidence(db, leads = db.leads || [], { fresh = false } = {}) {
  const validDates = leads.map(lead => new Date(lead.createdAt)).filter(date => !Number.isNaN(date.getTime()))
  const startDate = (validDates.sort((a, b) => a - b)[0] || new Date(Date.now() - 365 * 86400000)).toISOString()
  // Rounded down to the hour so two runs inside the same hour produce the same
  // cache key. The at-most-one-hour of sales this trims off is picked up by the
  // next run, on a job that otherwise fires every six hours.
  const endDate = fresh
    ? new Date().toISOString()
    : new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString()
  const summary = []
  const updatedLeadIds = []
  for (const market of ['mumbai', 'blr']) {
    if (!isConfigured(db, market)) { summary.push({ market, skipped: true, reason: 'not-configured' }); continue }
    const marketLeads = leads.filter(lead => marketForLocation(lead.locationId, db) === market)
    let sales = []
    try {
      sales = await runHostReportCached(db, 'total-sales', {
        market,
        startDate,
        endDate,
        saleTypes: ['membership', 'session', 'appointment', 'monthly-subscription', 'custom-member-payment-plan-installment'],
        moneyCreditSalesFilter: 'noFilter',
        includeRefunds: true,
        excludeGiftCardPaymentMethod: true,
        excludeTransactionFeesInSaleValue: false
      }, { fresh })
    } catch (e) {
      summary.push({ market, skipped: true, reason: e.message })
      continue
    }
    // A member's first attended class is a fact about the past: once we know
    // it, it can never change. Re-fetching it every run was the single largest
    // source of Momence traffic in the app -- up to 4,000 paginated
    // /members/:id/sessions calls per market per run, on a job that fires 15s
    // after every boot. Seed the known dates from the evidence already stored
    // on the leads and only call Momence for the ones still unknown.
    //
    // A *missing* date is not reusable the same way: it means "has not attended
    // yet", which can change tomorrow, so those are always re-checked.
    const trialDateByMemberId = new Map()
    if (!fresh) {
      for (const lead of marketLeads) {
        const evidence = lead.momenceEvidence
        const known = evidence?.trialDate
        if (!known || !isValidMemberId(lead.memberId)) continue
        // Only reuse a date this same market established. Evidence carried
        // over from the other market (a lead moved studios, or an early run
        // before the location was mapped) has to be re-derived here, or a
        // Bengaluru trial date would silently stand as Mumbai's answer.
        if (evidence.market && evidence.market !== market) continue
        const asDate = new Date(known)
        if (!Number.isNaN(asDate.getTime())) trialDateByMemberId.set(String(lead.memberId), asDate)
      }
    }

    // Leads without any evidence yet go first, so a large backlog converges
    // over successive runs instead of an already-checked member starving out
    // a never-checked one within the same run's cap.
    const hasEvidence = new Set(marketLeads.filter(lead => lead.momenceEvidence).map(lead => String(lead.memberId)))
    const memberIds = [...new Set(marketLeads.map(lead => lead.memberId).filter(isValidMemberId).map(String))]
      .filter(id => !trialDateByMemberId.has(id))
      .sort((a, b) => Number(hasEvidence.has(a)) - Number(hasEvidence.has(b)))
      .slice(0, MAX_MEMBERS_PER_MARKET_PER_RUN)
    const reused = trialDateByMemberId.size
    const CONCURRENCY = 3
    for (let i = 0; i < memberIds.length; i += CONCURRENCY) {
      const batch = memberIds.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map(id => firstAttendedClassDate(db, id, market)))
      batch.forEach((id, idx) => trialDateByMemberId.set(id, results[idx]))
      if (i + CONCURRENCY < memberIds.length) await wait(120)
    }
    const applied = applyLifecycleEvidence(marketLeads, sales, trialDateByMemberId, market, db)
    updatedLeadIds.push(...applied.updatedLeadIds)
    summary.push({ market, sales: sales.length, members: memberIds.length, membersReused: reused, updated: applied.updated })
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

// Fast path for a single member's sales — a couple of bounded, non-polling
// GETs, unlike runHostReport() below (which starts a whole-org report run
// and polls for it to finish; fine for the nightly bulk lifecycle job that
// already amortizes one report across every lead, but far too slow to run
// per-lead every time a drawer opens). Tries the member-scoped listing that
// matches every other member sub-resource in this file, then falls back to
// the top-level sales controller filtered by memberId.
export async function getMemberSalesDirect(db, memberId, market = 'mumbai') {
  const nested = await safePaginate(db, `/api/v2/host/members/${memberId}/sales`, { market }, null)
  if (nested && nested.length) return nested
  return safePaginate(db, '/api/v2/host/sales', { market, extra: { memberId } }, [])
}

export function mapSalesDirect(items) {
  return (items || [])
    .map(item => {
      const amount = Number(firstValue(item, ['totalInCurrency', 'total', 'amount', 'netAmount', 'price']) ?? 0)
      const refunded = Number(firstValue(item, ['refunded', 'refundedAmount']) ?? 0)
      return {
        id: firstValue(item, ['id', 'saleId', 'paymentTransactionId']),
        saleDate: firstValue(item, ['saleDate', 'soldAt', 'purchaseDate', 'transactionDate', 'paymentDate', 'createdAt', 'date']),
        itemType: String(firstValue(item, ['itemType', 'type', 'saleType', 'category']) || 'sale').toLowerCase(),
        itemName: firstValue(item, ['itemName', 'name', 'membershipName', 'description']) || 'Sale',
        totalInCurrency: String(Math.max(0, amount - refunded)),
        paymentMethod: firstValue(item, ['paymentMethod', 'method']) || 'unknown',
        payingMember: firstValue(item, ['payingMemberName', 'customerName']) || null
      }
    })
    .filter(s => s.saleDate)
    .sort((a, b) => new Date(b.saleDate) - new Date(a.saleDate))
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

export async function getPaymentTransaction(db, paymentTransactionId, market = 'mumbai') {
  return request(db, `/api/v2/host/payment-transactions/${paymentTransactionId}`, { market })
}

// No get-by-id endpoint exists for host memberships, only the list — paginate
// unfiltered (unlike getHostMemberships, which restricts to featured/enabled
// for the picker UI) so a disabled or non-featured membership still resolves.
export async function getMembershipById(db, membershipId, market = 'mumbai') {
  const all = await safePaginate(db, '/api/v2/host/memberships', { market, pageSize: 200, extra: { includeDisabled: true } }, [])
  return all.find(m => String(m.id) === String(membershipId)) || null
}

const EXCLUDED_MEMBERSHIP_TYPES = new Set(['package-money'])
const EXCLUDED_PURCHASE_TYPES = new Set(['product', 'refund', 'tips'])
const NEWCOMER_2FOR1_RE = /newcomer.*2.?for.?1|2.?for.?1.*newcomer/i

// Shared gate for "does this purchase count toward Membership Sold / LTV" —
// excludes products, money-credit packs, and the newcomer 2-for-1 offer per
// business rule, regardless of which webhook event surfaced the purchase.
export function isQualifyingPurchase({ purchaseType, membershipType, itemName } = {}) {
  const type = String(purchaseType || '').toLowerCase()
  const mType = String(membershipType || '').toLowerCase()
  const name = String(itemName || '')
  if (EXCLUDED_PURCHASE_TYPES.has(type)) return false
  if (EXCLUDED_MEMBERSHIP_TYPES.has(mType)) return false
  if (NEWCOMER_2FOR1_RE.test(name)) return false
  return true
}

// Flattens a payment-transaction payload into the same row shape mapSalesDirect
// produces, so a webhook-cached sale and a live-fetched one render identically.
//
// The transaction DTO gives per-unit figures excluding tax, so the line total
// has to be reassembled: quantity * (price + tax - discount). Reading
// txn.paidInCurrency instead would be wrong the moment a cart mixes a
// membership with a product — that total covers lines we deliberately exclude.
export function mapTransactionSales(txn) {
  const paymentMethod = txn?.transactionItems?.[0]?.paymentMethod || 'unknown'
  const payingMember = txn?.payingMember
    ? `${txn.payingMember.firstName || ''} ${txn.payingMember.lastName || ''}`.trim() || null
    : null
  const rows = []
  for (const sale of txn?.sales || []) {
    for (const item of sale?.items || []) {
      const quantity = Number(item.quantity) || 1
      const unit = (Number(item.unitPriceExcludingTaxInCurrency) || 0) + (Number(item.unitTaxAmountInCurrency) || 0)
      const discount = (Number(item.discountCode?.unitDiscountExcludingTaxInCurrency) || 0) +
        (Number(item.discountCode?.unitDiscountTaxAmountInCurrency) || 0)
      rows.push({
        id: `${sale.id}:${item.saleItemId ?? item.id}`,
        saleDate: sale.saleDate || txn.createdAt,
        itemType: String(item.itemType || 'sale').toLowerCase(),
        itemName: item.itemName || item.descriptiveItemName || 'Sale',
        totalInCurrency: String(Math.max(0, quantity * (unit - discount))),
        paymentMethod,
        payingMember
      })
    }
  }
  return rows
}

// The webhook-doc join: a Momence member maps to the newest lead in the same
// market matching on member id or email. `before` applies the extra rule that
// only purchase evidence needs — a purchase predating the lead says nothing
// about that lead's conversion — and is left off when merely locating the lead
// a member's sales history belongs to.
export function findLeadForMember(db, { market, memberId, email, before } = {}) {
  const pseudoRow = { memberId, email }
  return (db?.leads || [])
    .filter(l => marketForLocation(l.locationId, db) === market)
    .filter(l => matchesLead(pseudoRow, l))
    .filter(l => !before || new Date(l.createdAt || 0) < before)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null
}

const MAX_CACHED_SALES = 200

// Appends webhook-derived sale rows to the lead's cache, newest first. Momence
// redelivers a transaction on retry, so rows are keyed by sale-item id and the
// newer copy wins.
export function cacheLeadSales(lead, rows) {
  if (!lead || !rows?.length) return lead
  const byId = new Map((lead.momenceSales?.rows || []).map(row => [row.id, row]))
  for (const row of rows) byId.set(row.id, row)
  lead.momenceSales = {
    rows: [...byId.values()]
      .sort((a, b) => new Date(b.saleDate || 0) - new Date(a.saleDate || 0))
      .slice(0, MAX_CACHED_SALES),
    updatedAt: nowIso()
  }
  return lead
}

// The lead's cached sale rows, or null when the profile has to go to Momence
// for them. The cache never goes stale on its own: every new transaction
// arrives as a webhook and appends to it, so only an explicit refresh (or a
// lead that predates the cache) needs the live call.
export function usableCachedSales(lead, { fresh = false } = {}) {
  if (fresh) return null
  const rows = lead?.momenceSales?.rows
  return rows?.length ? rows : null
}

// Applies one confirmed purchase (from a Momence webhook) to whichever lead it
// belongs to. A purchase only counts if it can be matched to a lead created
// before the purchase happened (webhook basics doc's memberId/email join,
// same as matchesLead) and passes isQualifyingPurchase.
// `amount` should only be passed from payment-transaction-succeeded (the
// event that actually carries a paid amount) — bought-membership-activated
// is used only to backfill date/item name when no transaction event matched,
// and never contributes to ltv, so the same purchase can't be double-counted.
export function recordLeadPurchase(db, { market, memberId, email, purchaseDate, itemName, amount, purchaseType, membershipType, items }) {
  if (!purchaseDate || Number.isNaN(new Date(purchaseDate).getTime())) return null
  // With line items, each is gated on its own itemType/name and only the ones
  // that survive contribute to LTV — a cart mixing a membership with retail
  // must not bank the retail. Without them (bought-membership-activated), the
  // whole event is gated as one, as before.
  let qualifying = null
  if (items) {
    qualifying = items.filter(item => isQualifyingPurchase({
      purchaseType: item.itemType,
      membershipType,
      itemName: item.itemName
    }))
    if (!qualifying.length) return null
    amount = qualifying.reduce((sum, item) => sum + (Number(item.totalInCurrency) || 0), 0)
    itemName = qualifying[0].itemName || itemName || null
  } else if (!isQualifyingPurchase({ purchaseType, membershipType, itemName })) {
    return null
  }
  const date = new Date(purchaseDate)
  const lead = findLeadForMember(db, { market, memberId, email, before: date })
  if (!lead) return null
  const previous = lead.momenceEvidence || {}
  const isEarliest = !previous.firstPurchaseDate || date < new Date(previous.firstPurchaseDate)
  lead.momenceEvidence = {
    ...previous,
    market,
    membershipSold: true,
    firstPurchaseDate: isEarliest ? date.toISOString() : previous.firstPurchaseDate,
    firstPurchaseItemName: isEarliest ? (itemName || previous.firstPurchaseItemName || null) : (previous.firstPurchaseItemName || itemName || null),
    ltv: (Number(previous.ltv) || 0) + (Number(amount) || 0),
    checkedAt: nowIso()
  }
  if (!lead.convertedAt || date < new Date(lead.convertedAt)) lead.convertedAt = date.toISOString()
  save()
  return lead
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

export async function buildProfile(db, memberId, locationId, { lead = null, fresh = false } = {}) {
  const safeMemberId = String(memberId || '').trim()
  if (!isValidMemberId(safeMemberId)) {
    throw new Error('Momence member ID is missing or invalid.')
  }
  const market = marketForLocation(locationId, db)
  const member = await getMember(db, safeMemberId, market)
  // All member sub-resources fetched in parallel, all fast bounded GETs —
  // no report-run polling here, so opening a lead's drawer never waits on
  // Momence generating a whole-org report (see getMemberSalesDirect above).
  //
  // Sales are the exception: every sale arrives here as a
  // payment-transaction-succeeded webhook and is cached on the lead, so a lead
  // with a cache skips the sales call entirely and this becomes four requests
  // instead of five. A lead whose cache is empty (created before the webhook,
  // or never having bought anything) still fetches, and seeds the cache.
  const cachedSales = usableCachedSales(lead, { fresh })
  const [sessions, memberships, notes, appointments, salesRaw] = await Promise.all([
    getMemberSessions(db, safeMemberId, market).catch(() => []),
    getMemberMemberships(db, safeMemberId, market).catch(() => []),
    getMemberNotes(db, safeMemberId, market).catch(() => []),
    getMemberAppointments(db, safeMemberId, market).catch(() => []),
    cachedSales ? Promise.resolve([]) : getMemberSalesDirect(db, safeMemberId, market).catch(() => [])
  ])
  const salesHistory = cachedSales || mapSalesDirect(salesRaw)
  // A forced refresh replaces the cache rather than merging into it: the live
  // list is authoritative, so this is also how a row Momence has since voided
  // leaves the cache.
  if (!cachedSales && lead && salesHistory.length) {
    if (fresh) lead.momenceSales = null
    cacheLeadSales(lead, salesHistory)
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

export async function syncLeadMomence(db, lead, { fresh = false } = {}) {
  if (!isValidMemberId(lead?.memberId)) {
    throw new Error('Lead is not linked to a valid Momence member yet.')
  }
  const profile = await buildProfile(db, lead.memberId, lead.locationId, { lead, fresh })
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
