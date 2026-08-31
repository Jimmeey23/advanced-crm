import test from 'node:test'
import assert from 'node:assert/strict'
import { config, isConfigured, transportOptions } from './mailer.js'

const KEYS = ['USER_MAILTRAP_ENABLED', 'USER_MAILTRAP_HOST', 'USER_MAILTRAP_PORT', 'USER_MAILTRAP_USER', 'USER_MAILTRAP_PASS', 'USER_MAILTRAP_FROM_EMAIL', 'USER_MAILTRAP_FROM_NAME']

function withoutMailEnv(fn) {
  const prior = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
  KEYS.forEach(key => delete process.env[key])
  try { return fn() } finally {
    KEYS.forEach(key => prior[key] === undefined ? delete process.env[key] : (process.env[key] = prior[key]))
  }
}

test('Mailtrap defaults use Email Sending SMTP with STARTTLS', () => withoutMailEnv(() => {
  const c = config({ settings: { mailtrap: {} } })
  assert.equal(c.host, 'live.smtp.mailtrap.io')
  assert.equal(c.port, 587)
  assert.equal(c.user, 'api')
  assert.equal(c.fromEmail, 'hello@physique57india.com')
  assert.equal(c.enabled, false)
  assert.deepEqual(transportOptions({ ...c, pass: 'secret' }), {
    host: 'live.smtp.mailtrap.io', port: 587, secure: false, requireTLS: true,
    auth: { user: 'api', pass: 'secret' }, tls: { minVersion: 'TLSv1.2' }
  })
}))

test('Mailtrap secret and enable flag come from environment with precedence', () => withoutMailEnv(() => {
  process.env.USER_MAILTRAP_PASS = 'env-token'
  process.env.USER_MAILTRAP_ENABLED = 'true'
  const db = { settings: { mailtrap: { pass: 'stored-token', enabled: false } } }
  const c = config(db)
  assert.equal(c.pass, 'env-token')
  assert.equal(c.enabled, true)
  assert.equal(isConfigured(db), true)
}))
