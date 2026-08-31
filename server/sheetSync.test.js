// End-to-end tests for the sync engine against a fake sheet. The Sheets HTTP
// layer is stubbed at googleSheets.js's boundary, so everything below it —
// column planning, identity, merge, snapshot, write-back — is the real code.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as sheetSync from './sheetSync.js'

const HEADER = ['Name', 'Email', 'Phone', 'Stage', 'Deal Value', 'Sync Status']
const COL = { name: 0, email: 1, phone: 2, stage: 3, value: 4, status: 5 }

function makeDb() {
  return {
    leads: [],
    stages: ['New Enquiry', 'Trial Booked', 'Membership Sold', 'Lost'],
    associates: [],
    locations: [{ id: 'loc_1', name: 'Kwality House' }],
    sources: ['Google Sheets'],
    settings: { googleSheets: { sheetId: 'sheet1', sheetTab: 'Leads', fieldMapping: {}, defaults: {} }, business: {} }
  }
}

// Minimal stand-ins for index.js's lead helpers.
function makeCtx(db, writes) {
  let n = 0
  return {
    db: () => db,
    createLeadFrom: (payload) => ({
      id: `lead_${++n}`,
      fullName: payload.fullName || '',
      email: payload.email || '',
      phone: payload.phone || '',
      stage: payload.stage || 'New Enquiry',
      valueEstimate: payload.valueEstimate ?? null
    }),
    updateLeadFromPayload: (lead, payload) => {
      let changed = false
      for (const key of ['fullName', 'email', 'phone', 'stage', 'valueEstimate']) {
        const value = payload[key]
        if (value === undefined || value === null || value === '') continue
        if (String(lead[key] ?? '') !== String(value)) { lead[key] = value; changed = true }
      }
      return changed
    },
    deleteLead: (id) => {
      const before = db.leads.length
      db.leads = db.leads.filter(l => l.id !== id)
      return db.leads.length < before
    },
    markDirty: () => {},
    logSync: (outcome, detail) => writes.log.push(`${outcome}: ${detail}`),
    save: () => {},
    flushDelay: 0
  }
}

// The fake sheet: an array of rows, mutated by the writes the engine sends.
function install(db, rows) {
  const writes = { log: [], cells: [], appended: [] }
  sheetSync.__setTransport({
    readSheetRows: async () => ({ header: HEADER, rows }),
    batchUpdate: async (data) => {
      for (const { range, values } of data) {
        const m = /!([A-Z]+)(\d+)/.exec(range)
        const col = m[1].charCodeAt(0) - 65
        const row = Number(m[2]) - 2
        if (!rows[row]) rows[row] = new Array(HEADER.length).fill('')
        rows[row][col] = values[0][0]
        writes.cells.push({ row: row + 2, col, value: values[0][0] })
      }
    },
    append: async (values) => {
      const first = rows.length + 2
      values.forEach(v => rows.push(v))
      writes.appended.push(...values)
      return { updates: { updatedRange: `Leads!A${first}:F${rows.length + 1}` } }
    },
    putHeader: async () => {}
  })
  sheetSync.__reset()
  sheetSync.configure(makeCtx(db, writes))
  return writes
}

function row({ name = '', email = '', phone = '', stage = '', value = '', status = '' }) {
  const r = new Array(HEADER.length).fill('')
  r[COL.name] = name; r[COL.email] = email; r[COL.phone] = phone
  r[COL.stage] = stage; r[COL.value] = value; r[COL.status] = status
  return r
}

test('a new sheet row becomes a lead and the row is stamped with its id', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  install(db, rows)

  const counts = await sheetSync.reconcile()
  assert.equal(counts.created, 1)
  assert.equal(db.leads.length, 1)
  assert.match(rows[0][COL.status], new RegExp(`L-${db.leads[0].id}`))
})

test('a second pass over an unchanged sheet changes nothing', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  install(db, rows)
  await sheetSync.reconcile()
  const counts = await sheetSync.reconcile()
  assert.equal(counts.created, 0)
  assert.equal(counts.unchanged, 1)
  assert.equal(db.leads.length, 1)
})

test('a sheet edit reaches the app without a full read', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  install(db, rows)
  await sheetSync.reconcile()

  rows[0][COL.stage] = 'Trial Booked'
  const result = await sheetSync.applySheetEdit({
    rowNumber: 2, header: HEADER, values: rows[0], editedAt: '2026-08-31T10:00:00.000Z'
  })
  assert.equal(result.outcome, 'merged')
  assert.equal(db.leads[0].stage, 'Trial Booked')
})

test('an app edit is written back into the right cell', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  const writes = install(db, rows)
  await sheetSync.reconcile()

  db.leads[0].stage = 'Membership Sold'
  sheetSync.noteAppEdit(db.leads[0], ['stage'])
  await sheetSync.flush()

  assert.equal(rows[0][COL.stage], 'Membership Sold')
  assert.ok(writes.cells.some(c => c.col === COL.stage && c.value === 'Membership Sold'))
})

test('an inbound edit does not echo back out to the sheet', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  const writes = install(db, rows)
  await sheetSync.reconcile()
  writes.cells.length = 0

  rows[0][COL.stage] = 'Trial Booked'
  await sheetSync.applySheetEdit({ rowNumber: 2, header: HEADER, values: rows[0] })
  assert.equal(writes.cells.filter(c => c.col === COL.stage).length, 0)
})

test('editing the email cell re-keys the lead instead of creating a duplicate', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  install(db, rows)
  await sheetSync.reconcile()
  const id = db.leads[0].id

  rows[0][COL.email] = 'asha.rao@example.com'
  await sheetSync.applySheetEdit({
    rowNumber: 2, header: HEADER, values: rows[0], previous: { email: 'asha@example.com' }
  })
  assert.equal(db.leads.length, 1)
  assert.equal(db.leads[0].id, id)
  assert.equal(db.leads[0].email, 'asha.rao@example.com')
})

test('conflicting edits resolve by timestamp, per field', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  install(db, rows)
  await sheetSync.reconcile()

  // App moves the stage now; the sheet's competing edit is an hour older.
  db.leads[0].stage = 'Lost'
  sheetSync.noteAppEdit(db.leads[0], ['stage'])
  rows[0][COL.stage] = 'Trial Booked'
  await sheetSync.applySheetEdit({
    rowNumber: 2, header: HEADER, values: rows[0], editedAt: '2000-01-01T00:00:00.000Z'
  })

  assert.equal(db.leads[0].stage, 'Lost')
  assert.equal(rows[0][COL.stage], 'Lost')
})

test('a lead created in the app gets a row appended', async () => {
  const db = makeDb()
  const rows = []
  const writes = install(db, rows)
  await sheetSync.reconcile()

  const lead = { id: 'lead_app', fullName: 'New Person', email: 'new@example.com', phone: '9820099999', stage: 'New Enquiry' }
  db.leads.push(lead)
  sheetSync.noteNewLead(lead)
  await sheetSync.flush()

  assert.equal(writes.appended.length, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0][COL.name], 'New Person')
  assert.match(rows[0][COL.status], /L-lead_app/)
})

test('a row deleted from the sheet hard-deletes its lead', async () => {
  const db = makeDb()
  const rows = [
    row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111' }),
    row({ name: 'Biju Nair', email: 'biju@example.com', phone: '9820022222' })
  ]
  install(db, rows)
  await sheetSync.reconcile()
  assert.equal(db.leads.length, 2)

  rows.splice(0, 1) // someone deletes Asha's row
  const counts = await sheetSync.reconcile()
  assert.equal(counts.deleted, 1)
  assert.deepEqual(db.leads.map(l => l.fullName), ['Biju Nair'])
})

test('emptying a row does not delete the lead — clearing data is not deleting a row', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111' })]
  install(db, rows)
  await sheetSync.reconcile()

  const status = rows[0][COL.status]
  rows[0] = new Array(HEADER.length).fill('')
  rows[0][COL.status] = status
  const counts = await sheetSync.reconcile()
  assert.equal(counts.deleted, 0)
  assert.equal(db.leads.length, 1)
})

test('a row whose status cell and contacts are all overwritten stays bound to its lead', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111' })]
  install(db, rows)
  await sheetSync.reconcile()
  const id = db.leads[0].id

  // Nothing left to match on except the row's position, which the snapshot
  // still remembers — so the row keeps its lead instead of forking a new one
  // and stranding the old.
  rows[0][COL.status] = ''
  rows[0][COL.email] = 'someone.else@example.com'
  rows[0][COL.phone] = '9820033333'
  const counts = await sheetSync.reconcile()

  assert.equal(counts.deleted, 0)
  assert.equal(db.leads.length, 1)
  assert.equal(db.leads[0].id, id)
  assert.equal(db.leads[0].email, 'someone.else@example.com')
  // ...and it is re-stamped, so the next pass has the strong key back.
  assert.match(rows[0][COL.status], new RegExp(`L-${id}`))
})

test('force ignores the snapshot so the sheet wins every field', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  install(db, rows)
  await sheetSync.reconcile()

  db.leads[0].stage = 'Lost'
  await sheetSync.reconcile({ force: true })
  assert.equal(db.leads[0].stage, 'New Enquiry')
})

test('rows with no name or no usable contact are skipped, not created', async () => {
  const db = makeDb()
  const rows = [
    row({ name: '', email: 'nobody@example.com' }),
    row({ name: 'No Contact', email: 'n/a', phone: 'call reception' })
  ]
  install(db, rows)
  const counts = await sheetSync.reconcile()
  assert.equal(counts.created, 0)
  assert.equal(counts.skipped, 2)
})
