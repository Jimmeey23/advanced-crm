import test from 'node:test'
import assert from 'node:assert/strict'
import { createMomenceDashboardClient, dashboardAuthConfig, mergeCookieHeaders } from './momenceDashboardAuth.js'

const env = {
  USER_MOMENCE_DASHBOARD_EMAIL: 'agent@example.com',
  USER_MOMENCE_DASHBOARD_PASSWORD: 'safe-test-password',
  USER_MOMENCE_DASHBOARD_TOTP_SECRET: 'TESTSECRET'
}

function response(status, body = {}, cookies = []) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'set-cookie': cookies.join(', ') }
  })
}

test('mergeCookieHeaders retains only latest unique cookie pairs', () => {
  assert.equal(
    mergeCookieHeaders(['challenge=one; Path=/'], ['challenge=two; Path=/', 'ribbon.connect.sid=session; HttpOnly']),
    'challenge=two; ribbon.connect.sid=session'
  )
})

test('dashboardAuthConfig names missing environment variables without values', () => {
  assert.throws(
    () => dashboardAuthConfig({}),
    /USER_MOMENCE_DASHBOARD_EMAIL, USER_MOMENCE_DASHBOARD_PASSWORD, USER_MOMENCE_DASHBOARD_TOTP_SECRET/
  )
})

test('concurrent dashboard requests share one login and MFA flow', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/auth/login')) return response(200, {}, ['challenge=one; Path=/'])
    if (String(url).endsWith('/auth/mfa/totp/verify')) return response(200, {}, ['ribbon.connect.sid=session; HttpOnly'])
    return response(200, { ok: true })
  }
  const client = createMomenceDashboardClient({ fetchImpl, env, generateTotp: () => '123456' })

  await Promise.all([client.request('/_api/primary/host/13752/discount-codes'), client.request('/_api/primary/host/13752/memberships')])

  assert.equal(calls.filter(call => call.url.endsWith('/auth/login')).length, 1)
  assert.equal(calls.filter(call => call.url.endsWith('/auth/mfa/totp/verify')).length, 1)
  assert.equal(calls.filter(call => call.url.includes('/_api/')).length, 2)
  assert.match(calls.at(-1).init.headers.cookie, /ribbon\.connect\.sid=session/)
})

test('401 clears the cookie and retries once with a new login', async () => {
  let loginCount = 0
  let apiCount = 0
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/auth/login')) return response(200, {}, [`challenge=${++loginCount}`])
    if (String(url).endsWith('/auth/mfa/totp/verify')) return response(200, {}, [`ribbon.connect.sid=session-${loginCount}`])
    apiCount++
    return apiCount === 1 ? response(401, { error: 'expired' }) : response(200, { ok: true })
  }
  const client = createMomenceDashboardClient({ fetchImpl, env, generateTotp: () => '123456' })

  const result = await client.request('/_api/primary/host/13752/discount-codes')

  assert.deepEqual(result, { ok: true })
  assert.equal(loginCount, 2)
  assert.equal(apiCount, 2)
})
