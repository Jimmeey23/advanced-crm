import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicLeadWebhookPath, isStandingAdmin, adminEmailList } from './auth.js'

test('only keyed inbound lead webhook URLs bypass Supabase bearer authentication', () => {
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/abc123'), true)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/abc123?source=form'), true)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/abc123/'), true)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks'), false)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/wh_1/test'), false)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/'), false)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/abc123/logs'), false)
})

test('the standing admin list is matched case- and whitespace-insensitively', () => {
  delete process.env.ADMIN_EMAILS
  assert.equal(isStandingAdmin('saachi@physique57india.com'), true)
  assert.equal(isStandingAdmin('  Mitali@Physique57India.com  '), true)
  assert.equal(isStandingAdmin('jimmeey@physique57india.com'), true)
  // Not on the list, and near-misses must not slip through.
  assert.equal(isStandingAdmin('someone@physique57india.com'), false)
  assert.equal(isStandingAdmin('saachi@physique57india.com.evil.com'), false)
  assert.equal(isStandingAdmin('saachi@gmail.com'), false)
  assert.equal(isStandingAdmin(''), false)
  assert.equal(isStandingAdmin(null), false)
})

test('ADMIN_EMAILS replaces the built-in list outright', () => {
  process.env.ADMIN_EMAILS = ' One@example.com , two@example.com '
  const list = adminEmailList()
  assert.deepEqual([...list].sort(), ['one@example.com', 'two@example.com'])
  assert.equal(isStandingAdmin('one@example.com'), true)
  // Replaced, not merged: an address removed from the env list loses the role
  // on its next sign-in rather than lingering because the code still names it.
  assert.equal(isStandingAdmin('saachi@physique57india.com'), false)
  delete process.env.ADMIN_EMAILS
})

test('an empty ADMIN_EMAILS falls back to the built-in list rather than locking everyone out', () => {
  process.env.ADMIN_EMAILS = '   '
  assert.equal(isStandingAdmin('saachi@physique57india.com'), true)
  delete process.env.ADMIN_EMAILS
})
