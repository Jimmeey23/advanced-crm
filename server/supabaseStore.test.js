// Covers the write-volume behaviour of the Supabase store: which rows a save
// actually touches. These are the properties that keep the project's compute
// bounded, and they are invisible to every other test — a regression here
// costs money and eventually statement timeouts, not a failing assertion.
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.USER_SUPABASE_URL = 'https://example.supabase.co'
process.env.USER_SUPABASE_ANON_KEY = 'test-anon-key'

const store = await import('./supabaseStore.js')

// Records every PostgREST call supabase-js makes so a test can assert on the
// table and method rather than on internals of the store.
function installFetchRecorder() {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    calls.push({
      table: url.pathname.replace('/rest/v1/', ''),
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : null
    })
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

function makeState(overrides = {}) {
  return {
    version: 2,
    seededAt: '2026-01-01T00:00:00.000Z',
    settings: { taxonomyVersion: 2 },
    locations: [], associates: [], stages: [], sources: [], channels: [], classTypes: [],
    activity: [], importHistory: [], webhookIntegrations: [], webhookLogs: [],
    payments: [], discountCodeRequests: [], sheetSyncLogs: [],
    leads: [{ id: 'lead_1', email: 'a@example.com', phone: '+919000000001' }],
    inbox: { messages: [{ id: 'm1', key: 'lead_1' }], conversations: {} },
    ...overrides
  }
}

const writesTo = (calls, table) => calls.filter(c => c.table === table && c.method !== 'GET')

test('a lead-only save does not rewrite the meta blob a second time', async () => {
  const { calls, restore } = installFetchRecorder()
  try {
    store.setInboxPersistEnabled(true)
    const state = makeState()

    await store.persistState(state, ['lead_1'], [])
    assert.equal(writesTo(calls, 'app_state').length, 1, 'first save must write the meta row')

    calls.length = 0
    state.leads[0].name = 'changed'
    await store.persistState(state, ['lead_1'], [])

    assert.equal(writesTo(calls, 'app_state').length, 0, 'unchanged meta must not be rewritten')
    assert.equal(writesTo(calls, 'leads').length, 1, 'the dirty lead must still be upserted')
  } finally { restore() }
})

test('the inbox is written to its own table, never into the meta blob', async () => {
  const { calls, restore } = installFetchRecorder()
  try {
    store.setInboxPersistEnabled(true)
    // A distinct inbox from the other tests' — the skip-if-unchanged cache is
    // module-global by design, so reusing one would be skipped as already saved.
    const state = makeState({
      settings: { taxonomyVersion: 2, marker: 'inbox-table-test' },
      inbox: { messages: [{ id: 'm-inbox-table-test', key: 'lead_1' }], conversations: {} }
    })

    await store.persistState(state, [], [])

    const meta = writesTo(calls, 'app_state').at(-1)
    assert.ok(meta, 'expected a meta write')
    assert.equal(meta.body.data.inbox, undefined, 'inbox must not ride along in the meta blob')
    assert.equal(writesTo(calls, 'app_inbox').length, 1, 'inbox must go to app_inbox')

    calls.length = 0
    await store.persistState(state, [], [])
    assert.equal(writesTo(calls, 'app_inbox').length, 0, 'an unchanged inbox must not be rewritten')
  } finally { restore() }
})

test('the inbox is not written before it has finished loading', async () => {
  const { calls, restore } = installFetchRecorder()
  try {
    // The window between boot and loadInbox() resolving: state.inbox is an
    // empty placeholder, and writing it would destroy the stored inbox.
    store.setInboxPersistEnabled(false)
    const state = makeState({
      settings: { taxonomyVersion: 2, marker: 'boot-window-test' },
      inbox: { messages: [], conversations: {} }
    })

    await store.persistState(state, ['lead_1'], [])

    assert.equal(writesTo(calls, 'app_inbox').length, 0, 'no inbox write may happen during the boot window')
    assert.equal(writesTo(calls, 'leads').length, 1, 'leads must still persist during the boot window')
  } finally {
    store.setInboxPersistEnabled(true)
    restore()
  }
})
