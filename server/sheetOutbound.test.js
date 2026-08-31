import test from 'node:test'
import assert from 'node:assert/strict'
import { createOutboundQueue } from './sheetOutbound.js'

function harness({ writeCells } = {}) {
  const batches = []
  const timers = []
  const queue = createOutboundQueue({
    writeCells: writeCells || (async (cells) => { batches.push(cells) }),
    schedule: (fn) => { timers.push(fn); return null },
    onError: () => {}
  })
  return { queue, batches, tick: () => timers.splice(0).forEach(fn => fn()) }
}

test('repeated edits to one cell collapse to the last value', async () => {
  const { queue, batches } = harness()
  queue.enqueue('lead_1', 'stage', 'Trial Booked')
  queue.enqueue('lead_1', 'stage', 'Trial Completed')
  queue.enqueue('lead_1', 'stage', 'Membership Sold')
  assert.equal(queue.size, 1)
  await queue.flush()
  assert.deepEqual(batches[0], [{ leadId: 'lead_1', field: 'stage', value: 'Membership Sold' }])
})

test('edits across leads and fields go out in one batch', async () => {
  const { queue, batches } = harness()
  queue.enqueueLead('lead_1', { stage: 'Lost', remarks: 'no answer' })
  queue.enqueue('lead_2', 'stage', 'Won')
  await queue.flush()
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 3)
})

test('the first edit schedules a flush; later edits ride the same one', async () => {
  const { queue, batches, tick } = harness()
  queue.enqueue('lead_1', 'stage', 'A')
  queue.enqueue('lead_2', 'stage', 'B')
  assert.equal(batches.length, 0)
  tick()
  await Promise.resolve()
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 2)
})

test('inbound edits do not echo back out to the sheet', async () => {
  const { queue, batches } = harness()
  queue.applyingFromSheet(() => {
    queue.enqueue('lead_1', 'stage', 'from the sheet')
    queue.enqueueLead('lead_1', { remarks: 'also from the sheet' })
  })
  assert.equal(queue.size, 0)
  await queue.flush()
  assert.equal(batches.length, 0)
})

test('the mute lifts again afterwards', () => {
  const { queue } = harness()
  queue.applyingFromSheet(() => {})
  assert.equal(queue.enqueue('lead_1', 'stage', 'human edit'), true)
})

test('a failed write is retried, but never over a newer value', async () => {
  let fail = true
  const written = []
  const { queue } = harness({
    writeCells: async (cells) => {
      if (fail) { fail = false; throw new Error('quota') }
      written.push(cells)
    }
  })
  queue.enqueue('lead_1', 'stage', 'A')
  await assert.rejects(queue.flush(), /quota/)
  assert.equal(queue.size, 1)

  queue.enqueue('lead_1', 'stage', 'B')
  await queue.flush()
  assert.deepEqual(written[0], [{ leadId: 'lead_1', field: 'stage', value: 'B' }])
})

test('flushing an empty queue is a no-op, not an API call', async () => {
  const { queue, batches } = harness()
  assert.deepEqual(await queue.flush(), { written: 0 })
  assert.equal(batches.length, 0)
})
