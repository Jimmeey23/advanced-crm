import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicLeadWebhookPath } from './auth.js'

test('only keyed inbound lead webhook URLs bypass Supabase bearer authentication', () => {
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/abc123'), true)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/abc123?source=form'), true)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/abc123/'), true)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks'), false)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/wh_1/test'), false)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/'), false)
  assert.equal(isPublicLeadWebhookPath('/api/webhooks/leads/abc123/logs'), false)
})
