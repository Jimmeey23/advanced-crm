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

const membershipRows = data => data?.payload || data?.items || data?.memberships || (Array.isArray(data) ? data : [])

export async function getAvailableBookingMemberships(db, memberId, sessionId, locationId) {
  const market = marketForLocation(locationId, db)
  return membershipRows(await dashboardRequest(db, `/auto-book/member/${Number(memberId)}/session/${Number(sessionId)}/memberships`, { market }))
}

export async function autoBookMember(db, sessionId, memberId, options = {}) {
  const market = marketForLocation(options.locationId, db)
  const memberships = await getAvailableBookingMemberships(db, memberId, sessionId, options.locationId)
  const selected = options.membershipId
    ? memberships.find(item => String(item.id || item.membershipId || item.boughtMembershipId) === String(options.membershipId))
    : memberships.find(item => item.isActive !== false && item.isEligible !== false && item.canBook !== false)
  const membershipId = selected?.id || selected?.membershipId || selected?.boughtMembershipId
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
      createRecurringBooking: Boolean(options.createRecurringBooking),
      isCapacityOverriden: Boolean(options.overrideCapacity),
      isAgeRestrictionOverridden: Boolean(options.overrideAgeRestriction)
    }
  })
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
  return safePaginate(db, '/api/v2/host/memberships', { market, pageSize: 200, extra: { locationId, includeInactive: false } }, [])
}

export async function getMemberNotes(db, memberId, market = 'mumbai') {
  return safePaginate(db, `/api/v2/host/members/${memberId}/notes`, { market }, [])
}

export async function getMemberAppointments(db, memberId, market = 'mumbai') {
  return safePaginate(db, `/api/v2/host/members/${memberId}/appointments`, { market, extra: { includeCancelled: true } }, [])
}

export async function getSales(db, { memberId, market = 'mumbai' } = {}) {
  return paginate(db, '/api/v2/host/sales', { market })
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

export function mapSalesHistory(sales) {
  const rows = []
  for (const sale of sales || []) {
    for (const item of sale.items || []) {
      rows.push({
        id: sale.id,
        saleDate: sale.saleDate,
        itemType: item.itemType,
        itemName: item.itemName || item.descriptiveItemName || sale.items[0]?.itemName || 'Sale',
        quantity: item.quantity,
        unitPriceInCurrency: item.unitPriceExcludingTaxInCurrency,
        totalInCurrency: item.unitPriceExcludingTaxInCurrency ? String((parseFloat(item.unitPriceExcludingTaxInCurrency) || 0) * (item.quantity || 1)) : null,
        paymentMethod: (sale.paymentTransaction?.items || [])[0]?.paymentMethodType || 'unknown',
        payingMember: item.payingMember ? `${item.payingMember.firstName} ${item.payingMember.lastName}`.trim() : null
      })
    }
  }
  return rows.sort((a, b) => new Date(b.saleDate) - new Date(a.saleDate))
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
    const sales = await getSales(db, { market })
    salesHistory = mapSalesHistory(sales.filter(s =>
      (s.items || []).some(it =>
        (it.payingMember && String(it.payingMember.id) === String(memberId)) ||
        (it.targetMember && String(it.targetMember.id) === String(memberId))
      )
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
