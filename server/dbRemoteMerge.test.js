// A remote duplicate used to be re-merged on every event it emitted: the merge
// scheduled a write, the write produced events, and the two sides ping-ponged
// forever — thousands of merges of the same six ids, ending in a Supabase
// statement timeout. These pin the fix: merge once, remember it, and delete
// the duplicate row so it stops coming back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { __testing } from './db.js'

const { applyRemoteLeadChange, setState, resetMergeTracking, getDeletedIds, mergedRemoteCount } = __testing

const local = () => ([
  { id: 'local1', fullName: 'Amy Brown', email: 'amy@example.com', phone: '9876543210', stage: 'Trial' }
])

const remoteDuplicate = (over = {}) => ({
  id: 'remote1', fullName: 'Amy Brown', email: 'amy@example.com', phone: '9876543210', stage: 'Won', ...over
})

const insert = row => applyRemoteLeadChange({ eventType: 'INSERT', id: row.id, data: row })

test('a remote duplicate is merged into the local lead exactly once', () => {
  setState({ leads: local() })
  resetMergeTracking()
  insert(remoteDuplicate())
  assert.equal(mergedRemoteCount(), 1)

  // Replay the same row ten more times, as Realtime would.
  for (let i = 0; i < 10; i++) insert(remoteDuplicate())
  assert.equal(mergedRemoteCount(), 1, 'the merge was repeated')
})

test('the merge does not append a second lead', () => {
  const state = { leads: local() }
  setState(state)
  resetMergeTracking()
  for (let i = 0; i < 5; i++) insert(remoteDuplicate())
  assert.equal(state.leads.length, 1)
  assert.equal(state.leads[0].id, 'local1')
  // The remote row's newer fields still land on the surviving lead.
  assert.equal(state.leads[0].stage, 'Won')
})

test('the duplicate row is queued for deletion, so it stops being replayed', () => {
  setState({ leads: local() })
  resetMergeTracking()
  insert(remoteDuplicate())
  assert.ok(getDeletedIds().includes('remote1'))
})

test('later updates to a merged id are applied to the row it was merged into', () => {
  const state = { leads: local() }
  setState(state)
  resetMergeTracking()
  insert(remoteDuplicate())
  applyRemoteLeadChange({ eventType: 'UPDATE', id: 'remote1', data: remoteDuplicate({ stage: 'Lost' }) })
  assert.equal(state.leads.length, 1)
  assert.equal(state.leads[0].stage, 'Lost')
  assert.equal(state.leads[0].id, 'local1')
})

test('the echo of our own deletion is swallowed, not re-applied', () => {
  const state = { leads: local() }
  setState(state)
  resetMergeTracking()
  insert(remoteDuplicate())
  applyRemoteLeadChange({ eventType: 'DELETE', id: 'remote1' })
  assert.equal(state.leads.length, 1)
  assert.equal(state.leads[0].id, 'local1')
  // Forgotten, so a genuinely new row reusing that id would be reconciled afresh.
  assert.equal(mergedRemoteCount(), 0)
})

test('a genuinely new remote lead is still appended', () => {
  const state = { leads: local() }
  setState(state)
  resetMergeTracking()
  insert({ id: 'remote2', fullName: 'Zed Other', email: 'zed@example.com', phone: '9000000001' })
  assert.equal(state.leads.length, 2)
  assert.equal(mergedRemoteCount(), 0)
})

test('if the row a duplicate was merged into disappears, the mapping is dropped', () => {
  const state = { leads: local() }
  setState(state)
  resetMergeTracking()
  insert(remoteDuplicate())
  state.leads.length = 0
  __testing.invalidateIndexes()
  applyRemoteLeadChange({ eventType: 'UPDATE', id: 'remote1', data: remoteDuplicate() })
  assert.equal(mergedRemoteCount(), 0)
})
