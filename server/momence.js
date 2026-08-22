// Momence Public API v2 client (https://api.momence.com)
import { save, nowIso } from './db.js'

const BASE = 'https://api.momence.com'
const TOKEN_URL = `${BASE}/api/v2/auth/token`

export function momenceConfig(db) {
  return db.settings.momence || {}
}

// Effective config: env vars take priority, then Settings, then defaults.
export function effectiveConfig(db) {
  const c = momenceConfig(db)
  const env = {
    clientId: (process.env.USER_MOMENCE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.USER_MOMENCE_CLIENT_SECRET || '').trim(),
    username: (process.env.USER_MOMENCE_USERNAME || '').trim(),
    password: (process.env.USER_MOMENCE_PASSWORD || '').trim(),
    hostId: (process.env.USER_MOMENCE_HOST_ID || '').trim()
  }
  return {
    clientId: env.clientId || c.clientId || '',
    clientSecret: env.clientSecret || c.clientSecret || '',
    username: env.username || c.username || '',
    password: env.password || c.password || '',
    hostId: env.hostId || c.hostId || ''
  }
}

export function isConfigured(db) {
  const c = effectiveConfig(db)
  return Boolean(c.clientId && c.clientSecret && c.username && c.password)
}

export function getCachedToken(db) {
  const c = momenceConfig(db)
  if (c.token && c.token.expiresAt && new Date(c.token.expiresAt).getTime() > Date.now() + 300000) {
    return c.token.accessToken
  }
  return null
}

export async function getAccessToken(db) {
  const cached = getCachedToken(db)
  if (cached) return cached

  const c = effectiveConfig(db)
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
  c.token = {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
  }
  save()
  return accessToken
}

async function request(db, path, { method = 'GET', query, body } = {}) {
  const token = await getAccessToken(db)
  const url = new URL(BASE + path)
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (res.status === 401) {
    momenceConfig(db).token = null
    save()
    const token2 = await getAccessToken(db)
    headers.Authorization = `Bearer ${token2}`
    const retry = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (!retry.ok) throw new Error(`Momence API ${res.status}: ${await retry.text()}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`Momence API ${res.status} for ${path}: ${await res.text()}`)
  return res.json()
}

async function paginate(db, path, { pageSize = 100, extra = {} } = {}) {
  const all = []
  let page = 0
  for (;;) {
    const data = await request(db, path, { query: { page, pageSize, ...extra } })
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

export async function getMember(db, memberId) {
  return request(db, `/api/v2/host/members/${memberId}`)
}

export async function getMemberSessions(db, memberId) {
  return paginate(db, `/api/v2/host/members/${memberId}/sessions`, { extra: { includeCancelled: true } })
}

export async function getMemberMemberships(db, memberId) {
  return safePaginate(db, `/api/v2/host/members/${memberId}/bought-memberships/active`, { extra: { includeFrozen: true } }, [])
}

export async function getMemberNotes(db, memberId) {
  return safePaginate(db, `/api/v2/host/members/${memberId}/notes`, {}, [])
}

export async function getMemberAppointments(db, memberId) {
  return paginate(db, `/api/v2/host/members/${memberId}/appointments`, { extra: { includeCancelled: true } })
}

export async function getSales(db, { memberId } = {}) {
  return paginate(db, '/api/v2/host/sales')
}

export async function searchMembers(db, query) {
  return paginate(db, '/api/v2/host/members', { extra: { query } })
}

const digitsOnly = (v) => String(v || '').replace(/\D+/g, '')
const normEmail = (v) => String(v || '').trim().toLowerCase()

// Locate the Momence member(s) matching a lead's email/phone — this is how a
// lead gets linked without anyone having to know or paste a numeric Momence
// member ID. Email match takes priority (unique in practice); phone falls
// back to comparing the last 10 digits, since Momence and CRM numbers may
// differ in country-code formatting.
export async function findMemberCandidates(db, { email, phone } = {}) {
  const wantEmail = normEmail(email)
  const wantPhone = digitsOnly(phone).slice(-10)

  if (wantEmail) {
    const byEmail = await searchMembers(db, email)
    const exact = byEmail.filter(m => normEmail(m.email) === wantEmail)
    if (exact.length) return exact
  }

  if (wantPhone && wantPhone.length >= 7) {
    const byPhone = await searchMembers(db, phone)
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
      location: s.session?.inPersonLocation?.name || null,
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
    autoRenewing: m.membership?.autoRenewing ?? null
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

export async function buildProfile(db, memberId) {
  const safeMemberId = String(memberId || '').trim()
  if (!safeMemberId || safeMemberId === '-' || safeMemberId === 'undefined' || safeMemberId === 'null') {
    throw new Error('Momence member ID is missing or invalid.')
  }
  const [member, sessions, memberships, notes, appointments] = await Promise.all([
    getMember(db, safeMemberId),
    getMemberSessions(db, safeMemberId),
    getMemberMemberships(db, safeMemberId),
    getMemberNotes(db, safeMemberId),
    getMemberAppointments(db, safeMemberId).catch(() => [])
  ])
  let salesHistory = []
  try {
    const sales = await getSales(db)
    salesHistory = mapSalesHistory(sales.filter(s =>
      (s.items || []).some(it =>
        (it.payingMember && String(it.payingMember.id) === String(memberId)) ||
        (it.targetMember && String(it.targetMember.id) === String(memberId))
      )
    ))
  } catch (e) {
    salesHistory = []
  }
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
      tags: (member.customerTags || []).map(t => t.name)
    },
    memberships: mapMemberships(memberships),
    classHistory: mapClassHistory(sessions),
    appointments: mapAppointments(appointments),
    salesHistory,
    notes: (notes || []).slice(0, 10),
    syncedAt: nowIso()
  }
  return profile
}

export async function syncLeadMomence(db, lead) {
  if (!String(lead?.memberId || '').trim() || ['-','null','undefined'].includes(String(lead.memberId).trim())) {
    throw new Error('Lead is not linked to a valid Momence member yet.')
  }
  const profile = await buildProfile(db, lead.memberId)
  lead.momence = profile
  lead.momenceSyncedAt = nowIso()
  save()
  return profile
}

// Resolves a lead's Momence member ID by contact match and persists it,
// so future syncs skip the lookup. Throws with a message safe to surface
// to the UI ('no-match' / 'ambiguous') when the caller needs to branch.
export async function resolveLeadMember(db, lead) {
  if (lead.memberId) return { memberId: lead.memberId, candidates: null }

  const candidates = await findMemberCandidates(db, { email: lead.email, phone: lead.phone })
  if (candidates.length === 1) {
    lead.memberId = String(candidates[0].id)
    save()
    return { memberId: lead.memberId, candidates: null }
  }
  return { memberId: null, candidates }
}
