// Google returns 503 "The service is currently unavailable." routinely. Before
// this, only 429 was retried, so a single transient blip recorded
// lastSyncError and every dashboard read "Sheet failing" until the next
// scheduled pass hours later.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isTransientSheetsError } from './googleSheets.js'

test('quota and rate limiting are transient', () => {
  assert.equal(isTransientSheetsError({ status: 429 }), true)
  assert.equal(isTransientSheetsError({ status: 200, googleStatus: 'RESOURCE_EXHAUSTED' }), true)
})

test('the 5xx family Google actually returns is transient', () => {
  for (const status of [500, 502, 503, 504, 408]) {
    assert.equal(isTransientSheetsError({ status }), true, `${status} should retry`)
  }
  assert.equal(isTransientSheetsError({ googleStatus: 'UNAVAILABLE' }), true)
  assert.equal(isTransientSheetsError({ googleStatus: 'DEADLINE_EXCEEDED' }), true)
  assert.equal(isTransientSheetsError({ googleStatus: 'internal' }), true)
})

test('a socket-level failure is transient', () => {
  assert.equal(isTransientSheetsError({ cause: new Error('ECONNRESET') }), true)
})

test('a request that is actually wrong is not retried', () => {
  assert.equal(isTransientSheetsError({ status: 400 }), false)
  assert.equal(isTransientSheetsError({ status: 401 }), false)
  assert.equal(isTransientSheetsError({ status: 403, googleStatus: 'PERMISSION_DENIED' }), false)
  assert.equal(isTransientSheetsError({ status: 404 }), false)
  assert.equal(isTransientSheetsError({}), false)
})
