// Outbound half of the sheet sync: app-side edits queued as individual cells
// and flushed as one batchUpdate.
//
// Coalescing matters more than it looks. Dragging a lead through three stages
// in ten seconds is three edits to one cell; sent as they happen that is
// three API calls against a per-minute write quota, and the sheet briefly
// shows a stage the lead has already left. Keyed by leadId+field, only the
// last value survives to the flush.
//
// `mute` is the echo guard. Applying an inbound sheet edit goes through the
// same lead-mutation path as a human clicking in the app, so without it every
// inbound change would immediately queue itself for write-back — the sheet
// would be told what it just told us, burning quota and, on a conflict the
// app won, fighting the merge.
const DEFAULT_DELAY = 3000

function defaultSchedule(fn, ms) {
  const timer = setTimeout(fn, ms)
  timer.unref?.()
  return timer
}

export function createOutboundQueue({
  writeCells,
  delay = DEFAULT_DELAY,
  schedule = defaultSchedule,
  onError = () => {}
} = {}) {
  const pending = new Map()
  let timer = null
  let inFlight = null
  let muted = 0

  const key = (leadId, field) => `${leadId} ${field}`

  function enqueue(leadId, field, value) {
    if (muted > 0 || !leadId || !field) return false
    pending.set(key(leadId, field), { leadId, field, value })
    if (!timer) timer = schedule(() => { timer = null; flush().catch(onError) }, delay)
    return true
  }

  function enqueueLead(leadId, values) {
    let queued = 0
    for (const [field, value] of Object.entries(values || {})) {
      if (enqueue(leadId, field, value)) queued++
    }
    return queued
  }

  // Serialised rather than concurrent: two overlapping batchUpdates touching
  // the same cell can land out of order, leaving the sheet on the older value.
  async function flush() {
    if (inFlight) return inFlight
    if (!pending.size) return { written: 0 }
    const batch = [...pending.values()]
    pending.clear()
    inFlight = (async () => {
      try {
        await writeCells(batch)
        return { written: batch.length }
      } catch (err) {
        // Put the cells back so a transient failure retries on the next
        // flush, but never over a newer value queued since.
        for (const cell of batch) {
          const k = key(cell.leadId, cell.field)
          if (!pending.has(k)) pending.set(k, cell)
        }
        throw err
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  // Anything queued inside the callback is dropped. Deliberately synchronous
  // so callers cannot leave the queue muted across an await.
  function applyingFromSheet(fn) {
    muted++
    try { return fn() } finally { muted-- }
  }

  return { enqueue, enqueueLead, flush, applyingFromSheet, get size() { return pending.size } }
}
