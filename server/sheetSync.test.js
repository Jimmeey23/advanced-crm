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
    settings: { googleSheets: { sheetId: 'sheet1', sheetTab: 'Leads', mirrorTab: 'CRM', fieldMapping: {}, defaults: {} }, business: {} }
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
      valueEstimate: payload.valueEstimate ?? null,
      momenceLeadId: payload.momenceLeadId || null
    }),
    updateLeadFromPayload: (lead, payload) => {
      let changed = false
      for (const key of ['fullName', 'email', 'phone', 'stage', 'valueEstimate', 'momenceLeadId']) {
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
// Two tabs, as in production: `rows` is the upstream export (read-only) and
// `mirror` is the CRM-owned tab (write-only).
function mirrorTransport(sourceHeader, rows, mirror, writes) {
  return {
    readSheetRows: async () => ({ header: sourceHeader, rows }),
    readMirrorRows: async () => ({ header: mirror.header, rows: mirror.rows }),
    writeMirror: async (data) => {
      for (const { range, values } of data) {
        const m = /!A(\d+)/.exec(range)
        const row = Number(m[1])
        if (row === 1) { mirror.header = values[0]; continue }
        mirror.rows[row - 2] = values[0]
        writes.mirrorWrites.push({ row, values: values[0] })
      }
    },
    appendMirror: async (values) => {
      values.forEach(v => mirror.rows.push(v))
      writes.mirrorAppends.push(...values)
      return {}
    }
  }
}

function install(db, rows) {
  const writes = { log: [], cells: [], mirrorWrites: [], mirrorAppends: [] }
  const mirror = { header: [], rows: [] }
  sheetSync.__setTransport(mirrorTransport(HEADER, rows, mirror, writes))
  sheetSync.__reset()
  sheetSync.configure(makeCtx(db, writes))
  writes.mirror = mirror
  return writes
}

function row({ name = '', email = '', phone = '', stage = '', value = '', status = '' }) {
  const r = new Array(HEADER.length).fill('')
  r[COL.name] = name; r[COL.email] = email; r[COL.phone] = phone
  r[COL.stage] = stage; r[COL.value] = value; r[COL.status] = status
  return r
}

test('a new sheet row becomes a lead, and the export tab is never written to', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  install(db, rows)
  const before = JSON.stringify(rows)

  const counts = await sheetSync.reconcile()
  assert.equal(counts.created, 1)
  assert.equal(db.leads.length, 1)
  // Not even an identity marker: the export rebuilds this tab, so writing to it
  // is pointless and risks corrupting a row someone else owns.
  assert.equal(JSON.stringify(rows), before)
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

test('an app edit lands in the CRM tab and leaves the export tab untouched', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  const writes = install(db, rows)
  await sheetSync.reconcile()

  db.leads[0].stage = 'Membership Sold'
  sheetSync.noteAppEdit(db.leads[0], ['stage'])
  await sheetSync.flush()

  assert.equal(rows[0][COL.stage], 'New Enquiry', 'export tab unchanged')
  const mirrored = writes.mirror.rows.find(r => r[0] === db.leads[0].id)
  assert.ok(mirrored, 'lead has a row in the CRM tab')
  assert.equal(mirrored[4], 'Membership Sold')
  assert.deepEqual(writes.mirror.header[0], 'Lead ID')
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
  const writes = install(db, rows)
  await sheetSync.reconcile()

  // App moves the stage now; the sheet's competing edit is an hour older.
  db.leads[0].stage = 'Lost'
  sheetSync.noteAppEdit(db.leads[0], ['stage'])
  rows[0][COL.stage] = 'Trial Booked'
  await sheetSync.applySheetEdit({
    rowNumber: 2, header: HEADER, values: rows[0], editedAt: '2000-01-01T00:00:00.000Z'
  })

  assert.equal(db.leads[0].stage, 'Lost')
  // The app won the field, and its value goes to the CRM tab — the export tab
  // keeps whatever upstream put there.
  await sheetSync.flush()
  const mirrored = writes.mirror.rows.find(r => r[0] === db.leads[0].id)
  assert.equal(mirrored[4], 'Lost')
  assert.equal(rows[0][COL.stage], 'Trial Booked')
})

test('a lead created in the app gets a row in the CRM tab, not the export tab', async () => {
  const db = makeDb()
  const rows = []
  const writes = install(db, rows)
  await sheetSync.reconcile()

  const lead = { id: 'lead_app', fullName: 'New Person', email: 'new@example.com', phone: '9820099999', stage: 'New Enquiry' }
  db.leads.push(lead)
  sheetSync.noteNewLead(lead)
  await sheetSync.flush()

  assert.equal(rows.length, 0, 'export tab untouched')
  assert.equal(writes.mirrorAppends.length, 1)
  assert.equal(writes.mirrorAppends[0][0], 'lead_app')
  assert.equal(writes.mirrorAppends[0][1], 'New Person')
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

// ---------------------------------------------------------------------------
// The sheet this runs against is cleared and repopulated by an upstream export
// several times a day. These are the cases that behaviour creates.
// ---------------------------------------------------------------------------

const OWNER_HEADER = ['Name', 'Email', 'Phone', 'Stage', 'Associate', 'Sync Status']
const OCOL = { name: 0, email: 1, phone: 2, stage: 3, associate: 4, status: 5 }

function ownerRow({ name = '', email = '', phone = '', stage = '', associate = '', status = '' }) {
  const r = new Array(OWNER_HEADER.length).fill('')
  r[OCOL.name] = name; r[OCOL.email] = email; r[OCOL.phone] = phone
  r[OCOL.stage] = stage; r[OCOL.associate] = associate; r[OCOL.status] = status
  return r
}

// A db whose leads carry associateId, plus a real associates list, so the
// owner projection has something to resolve against.
function ownerDb() {
  const db = makeDb()
  db.associates = [
    { id: 'asc_1', name: 'Imran Shaikh', locationId: 'loc_1' },
    { id: 'asc_2', name: 'Neha Kapoor', locationId: 'loc_1' }
  ]
  return db
}

function installOwner(db, rows) {
  const writes = { log: [], cells: [], mirrorWrites: [], mirrorAppends: [] }
  const mirror = { header: [], rows: [] }
  sheetSync.__setTransport(mirrorTransport(OWNER_HEADER, rows, mirror, writes))
  sheetSync.__reset()
  const ctx = makeCtx(db, writes)
  // Resolve the owner name the way index.js's real createLeadFrom does.
  const baseCreate = ctx.createLeadFrom
  ctx.createLeadFrom = (payload) => {
    const lead = baseCreate(payload)
    lead.associateId = payload.associateId || null
    return lead
  }
  const baseUpdate = ctx.updateLeadFromPayload
  ctx.updateLeadFromPayload = (lead, payload) => {
    const changed = baseUpdate(lead, payload)
    if (payload.associateId && payload.associateId !== lead.associateId) { lead.associateId = payload.associateId; return true }
    return changed
  }
  sheetSync.configure(ctx)
  writes.mirror = mirror
  return writes
}

// Column positions in the CRM-owned tab.
const MCOL = { id: 0, name: 1, email: 2, phone: 3, stage: 4, status: 5, owner: 6 }

test("the sheet's associate column sets the owner, and is not blanked on later passes", async () => {
  const db = ownerDb()
  const rows = [ownerRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', associate: 'Imran Shaikh' })]
  const writes = installOwner(db, rows)

  await sheetSync.reconcile()
  assert.equal(db.leads[0].associateId, 'asc_1')

  // The bug: on the second pass `lead.associateName` read as empty, so the
  // merge decided the app had cleared the owner and wrote a blank back.
  writes.mirrorWrites.length = 0
  await sheetSync.reconcile()
  assert.equal(rows[0][OCOL.associate], 'Imran Shaikh')
  assert.equal(db.leads[0].associateId, 'asc_1')
  // The old bug produced a blank owner on every pass. The mirror row is
  // rewritten whenever anything about the lead moves, so what matters is not
  // that nothing was written but that nothing ever writes a blank owner.
  for (const write of writes.mirrorWrites) assert.equal(write.values[MCOL.owner], 'Imran Shaikh')
  assert.equal(writes.mirror.rows[0][MCOL.owner], 'Imran Shaikh')
})

test('reassigning the owner in the app writes the associate NAME to the CRM tab', async () => {
  const db = ownerDb()
  const rows = [ownerRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', associate: 'Imran Shaikh' })]
  const writes = installOwner(db, rows)
  await sheetSync.reconcile()

  db.leads[0].associateId = 'asc_2'
  sheetSync.noteAppEdit(db.leads[0], ['associateId'])
  await sheetSync.flush()

  const mirrored = writes.mirror.rows.find(r => r[MCOL.id] === db.leads[0].id)
  assert.equal(mirrored[MCOL.owner], 'Neha Kapoor')
  assert.equal(rows[0][OCOL.associate], 'Imran Shaikh', 'export tab untouched')
})

test('changing the owner in the sheet moves the lead to that associate', async () => {
  const db = ownerDb()
  const rows = [ownerRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', associate: 'Imran Shaikh' })]
  installOwner(db, rows)
  await sheetSync.reconcile()

  rows[0][OCOL.associate] = 'Neha Kapoor'
  await sheetSync.applySheetEdit({ rowNumber: 2, header: OWNER_HEADER, values: rows[0], editedAt: new Date().toISOString() })
  assert.equal(db.leads[0].associateId, 'asc_2')
})

test('a cleared-and-repopulated sheet re-binds rows by contact, not by position', async () => {
  const db = ownerDb()
  const rows = [
    ownerRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', associate: 'Imran Shaikh' }),
    ownerRow({ name: 'Biju Nair', email: 'biju@example.com', phone: '9820022222', associate: 'Neha Kapoor' })
  ]
  installOwner(db, rows)
  await sheetSync.reconcile()
  const ashaId = db.leads.find(l => l.fullName === 'Asha Rao').id
  const bijuId = db.leads.find(l => l.fullName === 'Biju Nair').id

  // The upstream export rewrites the tab: same people, reversed order, and the
  // Sync Status column is gone with everything else.
  rows.length = 0
  rows.push(ownerRow({ name: 'Biju Nair', email: 'biju@example.com', phone: '9820022222', associate: 'Neha Kapoor' }))
  rows.push(ownerRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', associate: 'Imran Shaikh' }))

  const counts = await sheetSync.reconcile()
  assert.equal(counts.created, 0, 'no duplicates from the repopulate')
  assert.equal(db.leads.length, 2)
  assert.equal(db.leads.find(l => l.id === ashaId).fullName, 'Asha Rao')
  assert.equal(db.leads.find(l => l.id === bijuId).fullName, 'Biju Nair')
  assert.equal(db.leads.find(l => l.id === ashaId).associateId, 'asc_1')
  assert.equal(db.leads.find(l => l.id === bijuId).associateId, 'asc_2')
})

test('a read that catches the sheet mid-refresh deletes nothing', async () => {
  const db = ownerDb()
  const rows = []
  for (let i = 0; i < 10; i++) {
    rows.push(ownerRow({ name: `Person ${i}`, email: `p${i}@example.com`, phone: `98200000${i}${i}`, associate: 'Imran Shaikh' }))
  }
  const writes = installOwner(db, rows)
  await sheetSync.reconcile()
  assert.equal(db.leads.length, 10)

  rows.length = 0 // the export has cleared the tab and not yet written it back
  const counts = await sheetSync.reconcile()

  assert.equal(counts.deleted, 0)
  assert.equal(db.leads.length, 10)
  assert.ok(writes.log.some(line => /mid-refresh read, no leads deleted/.test(line)))
})

// ---------------------------------------------------------------------------
// the mirror as a two-way surface
// ---------------------------------------------------------------------------

test('every lead gets a mirror row, whether or not the app touched it', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  const writes = install(db, rows)

  await sheetSync.reconcile()

  assert.equal(writes.mirror.header[0], 'Lead ID')
  assert.equal(writes.mirror.rows.length, 1)
  assert.equal(writes.mirror.rows[0][0], db.leads[0].id)
  assert.equal(writes.mirror.rows[0][1], 'Asha Rao')
})

test('an edit made in the mirror tab reaches the lead', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  const writes = install(db, rows)
  await sheetSync.reconcile()

  const mirrorRow = [...writes.mirror.rows[0]]
  mirrorRow[MCOL.stage] = 'Trial Booked'
  const result = await sheetSync.applyMirrorEdit({
    header: writes.mirror.header, values: mirrorRow, editedAt: '2026-08-31T11:00:00.000Z'
  })

  assert.equal(result.outcome, 'merged')
  assert.equal(db.leads[0].stage, 'Trial Booked')
})

test('a mirror row the app itself wrote is not read back as an edit', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  const writes = install(db, rows)
  await sheetSync.reconcile()

  const result = await sheetSync.applyMirrorEdit({
    header: writes.mirror.header, values: writes.mirror.rows[0]
  })
  assert.equal(result.outcome, 'unchanged')
})

test('a mirror edit is overruled by the source tab, which stays the source of truth', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  const writes = install(db, rows)
  await sheetSync.reconcile()

  // Both tabs move the same field in the same pass.
  writes.mirror.rows[0][MCOL.stage] = 'Trial Booked'
  rows[0][COL.stage] = 'Membership Sold'
  await sheetSync.reconcile()

  assert.equal(db.leads[0].stage, 'Membership Sold')
  assert.equal(writes.mirror.rows[0][MCOL.stage], 'Membership Sold')
})

test('a mirror column moved by hand is still read correctly', async () => {
  const db = makeDb()
  const rows = [row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' })]
  const writes = install(db, rows)
  await sheetSync.reconcile()

  // Someone drags the Stage column to the end of the tab.
  const header = [...writes.mirror.header]
  const moved = header.splice(MCOL.stage, 1)[0]
  header.push(moved)
  const values = [...writes.mirror.rows[0]]
  values.splice(MCOL.stage, 1)
  values.push('Trial Booked')

  const result = await sheetSync.applyMirrorEdit({ header, values })
  assert.equal(result.outcome, 'merged')
  assert.equal(db.leads[0].stage, 'Trial Booked')
})

// ---------------------------------------------------------------------------
// dates and ownership
// ---------------------------------------------------------------------------

const DATE_HEADER = ['Name', 'Email', 'Phone', 'Created At', 'Associate', 'Sync Status']
const DCOL = { name: 0, email: 1, phone: 2, created: 3, associate: 4, status: 5 }

function dateRow({ name = '', email = '', phone = '', created = '', associate = '' }) {
  const r = new Array(DATE_HEADER.length).fill('')
  r[DCOL.name] = name; r[DCOL.email] = email; r[DCOL.phone] = phone
  r[DCOL.created] = created; r[DCOL.associate] = associate
  return r
}

// A ctx whose createLeadFrom behaves like index.js's for the two things these
// tests are about: it keeps createdAt, and it honours the round-robin
// exemption flag the sync sets.
function installDates(db, rows) {
  const writes = { log: [], cells: [], mirrorWrites: [], mirrorAppends: [] }
  const mirror = { header: [], rows: [] }
  sheetSync.__setTransport(mirrorTransport(DATE_HEADER, rows, mirror, writes))
  sheetSync.__reset()
  const ctx = makeCtx(db, writes)
  const baseCreate = ctx.createLeadFrom
  ctx.createLeadFrom = (payload) => {
    const lead = baseCreate(payload)
    lead.createdAt = payload.createdAt ? new Date(payload.createdAt).toISOString() : new Date().toISOString()
    lead.associateId = payload.associateId || null
    lead.autoAssignExempt = payload.autoAssignExempt === true
    return lead
  }
  sheetSync.configure(ctx)
  writes.mirror = mirror
  return writes
}

test('a date column read as a serial number keeps its year', async () => {
  const db = ownerDb()
  // 45678 is 2025-01-21. Displayed as "21-Jan" the year used to be lost for good.
  const rows = [dateRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', created: 45678 })]
  installDates(db, rows)

  await sheetSync.reconcile()
  assert.equal(db.leads[0].createdAt.slice(0, 10), '2025-01-21')
})

test('a date already in the app does not read as a change on every pass', async () => {
  const db = ownerDb()
  const rows = [dateRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', created: 45678 })]
  installDates(db, rows)
  await sheetSync.reconcile()

  // The lead stores a full timestamp and the sheet a bare serial; without
  // canonicalising both sides this compared unequal forever.
  const counts = await sheetSync.reconcile()
  assert.equal(counts.unchanged, 1)
  assert.equal(counts.merged, 0)
})

test('a lead from the sheet is exempt from round robin and owned by its Associate cell', async () => {
  const db = ownerDb()
  const rows = [dateRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', associate: 'Imran Shaikh' })]
  installDates(db, rows)

  await sheetSync.reconcile()
  assert.equal(db.leads[0].associateId, 'asc_1')
  assert.equal(db.leads[0].autoAssignExempt, true)
})

test('a sheet lead with no Associate stays unassigned rather than being rotated', async () => {
  const db = ownerDb()
  const rows = [dateRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111' })]
  installDates(db, rows)

  await sheetSync.reconcile()
  assert.equal(db.leads[0].associateId, null)
  // The flag is what stops round robin from filling that blank in behind the
  // sheet's back; the sheet gets to say "nobody" (see assignLead).
  assert.equal(db.leads[0].autoAssignExempt, true)
})

test('a lead deleted from the source tab leaves no ghost row in the mirror', async () => {
  const db = makeDb()
  const rows = [
    row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' }),
    row({ name: 'Ravi Menon', email: 'ravi@example.com', phone: '9820022222', stage: 'New Enquiry' })
  ]
  const writes = install(db, rows)
  await sheetSync.reconcile()
  assert.equal(writes.mirror.rows.length, 2)

  rows.shift() // the first row is deleted upstream; everything below slides up
  await sheetSync.reconcile()

  assert.equal(db.leads.length, 1)
  const remaining = writes.mirror.rows.filter(r => String(r[0] || '').trim())
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0][MCOL.name], 'Ravi Menon')
})

// ---------------------------------------------------------------------------
// two columns, one field
// ---------------------------------------------------------------------------

const SOURCE_HEADER = ['Name', 'Email', 'Phone', 'UTM Source', 'Source Name', 'Sync Status']
const SCOL = { name: 0, email: 1, phone: 2, utm: 3, source: 4, status: 5 }
const SOURCE_INTEG = { 'UTM Source': 'source', 'Source Name': 'source' }

function installSources(db, rows) {
  const writes = { log: [], cells: [], mirrorWrites: [], mirrorAppends: [] }
  const mirror = { header: [], rows: [] }
  db.settings.googleSheets.fieldMapping = SOURCE_INTEG
  sheetSync.__setTransport(mirrorTransport(SOURCE_HEADER, rows, mirror, writes))
  sheetSync.__reset()
  const ctx = makeCtx(db, writes)
  const baseCreate = ctx.createLeadFrom
  ctx.createLeadFrom = (payload) => {
    const lead = baseCreate(payload)
    lead.sourceName = payload.sourceName || null
    return lead
  }
  const baseUpdate = ctx.updateLeadFromPayload
  ctx.updateLeadFromPayload = (lead, payload) => {
    const changed = baseUpdate(lead, payload)
    if (payload.sourceName && lead.sourceName !== payload.sourceName) {
      lead.sourceName = payload.sourceName
      return true
    }
    return changed
  }
  sheetSync.configure(ctx)
  writes.mirror = mirror
  return writes
}

function sourceRow({ name = '', email = '', phone = '', utm = '', source = '' }) {
  const r = new Array(SOURCE_HEADER.length).fill('')
  r[SCOL.name] = name; r[SCOL.email] = email; r[SCOL.phone] = phone
  r[SCOL.utm] = utm; r[SCOL.source] = source
  return r
}

test('a "-" in the first source column does not hide the second', async () => {
  const db = makeDb()
  const rows = [sourceRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', utm: '-', source: 'Website' })]
  installSources(db, rows)

  await sheetSync.reconcile()
  assert.equal(db.leads[0].sourceName, 'Website')
})

test('a lead already carrying "-" as its source is healed by the sheet', async () => {
  const db = makeDb()
  // The state the old resolver produced: nothing usable in either column, and
  // the literal "-" written onto the lead as though it were a source.
  const rows = [sourceRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', utm: '-' })]
  installSources(db, rows)
  await sheetSync.reconcile()
  db.leads[0].sourceName = '-'

  // The sheet's own source column, read properly this time.
  rows[0][SCOL.source] = 'Website'
  await sheetSync.reconcile()

  assert.equal(db.leads[0].sourceName, 'Website')
  // And the sheet keeps its value — the lead's "-" must never be written back.
  assert.equal(rows[0][SCOL.source], 'Website')
})

test('a source column that is blank everywhere never writes "-" onto a lead', async () => {
  const db = makeDb()
  const rows = [sourceRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', utm: '-', source: 'N/A' })]
  installSources(db, rows)

  await sheetSync.reconcile()
  assert.notEqual(db.leads[0].sourceName, '-')
  assert.notEqual(db.leads[0].sourceName, 'N/A')
})

// ---------------------------------------------------------------------------
// studio and owner come from the sheet
// ---------------------------------------------------------------------------

const PLACE_HEADER = ['Name', 'Email', 'Phone', 'Center', 'Associate', 'Sync Status']
const PCOL = { name: 0, email: 1, phone: 2, center: 3, associate: 4, status: 5 }

function placeDb() {
  const db = makeDb()
  db.locations = [
    { id: 'loc_kemps', name: 'Kwality House, Kemps Corner' },
    { id: 'loc_kenkere', name: 'Kenkere House, Bengaluru' }
  ]
  db.associates = [
    { id: 'asc_1', name: 'Imran Shaikh', locationId: 'loc_kemps' },
    { id: 'asc_2', name: 'Prathap kp', locationId: 'loc_kenkere' }
  ]
  return db
}

function installPlaces(db, rows) {
  const writes = { log: [], cells: [], mirrorWrites: [], mirrorAppends: [] }
  const mirror = { header: [], rows: [] }
  sheetSync.__setTransport(mirrorTransport(PLACE_HEADER, rows, mirror, writes))
  sheetSync.__reset()
  const ctx = makeCtx(db, writes)
  const baseCreate = ctx.createLeadFrom
  ctx.createLeadFrom = (payload) => {
    const lead = baseCreate(payload)
    lead.center = payload.center || null
    lead.associateId = payload.associateId || null
    // index.js's fallback: with no studio of its own a lead lands on the first
    // one in the list. That fallback is what the Center column must pre-empt.
    lead.locationId = payload.locationId || db.locations[0].id
    return lead
  }
  sheetSync.configure(ctx)
  writes.mirror = mirror
  return writes
}

function placeRow({ name = '', email = '', phone = '', center = '', associate = '' }) {
  const r = new Array(PLACE_HEADER.length).fill('')
  r[PCOL.name] = name; r[PCOL.email] = email; r[PCOL.phone] = phone
  r[PCOL.center] = center; r[PCOL.associate] = associate
  return r
}

test("the sheet's Center column decides the lead's studio", async () => {
  const db = placeDb()
  const rows = [placeRow({
    name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111',
    center: 'Kenkere House, Bengaluru', associate: 'Prathap kp'
  })]
  installPlaces(db, rows)

  await sheetSync.reconcile()
  assert.equal(db.leads[0].locationId, 'loc_kenkere')
})

test('a lead already filed under the wrong studio is moved back', async () => {
  const db = placeDb()
  const rows = [placeRow({
    name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111',
    center: 'Kenkere House, Bengaluru', associate: 'Prathap kp'
  })]
  installPlaces(db, rows)
  await sheetSync.reconcile()

  // The state ~11,000 leads were in: Center says Bengaluru, the record says
  // Kemps Corner, and Center never changes again so no merge ever notices.
  db.leads[0].locationId = 'loc_kemps'
  await sheetSync.reconcile()
  assert.equal(db.leads[0].locationId, 'loc_kenkere')
})

test('an owner changed behind the sheet\'s back is put back', async () => {
  const db = placeDb()
  const rows = [placeRow({
    name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111',
    center: 'Kenkere House, Bengaluru', associate: 'Prathap kp'
  })]
  installPlaces(db, rows)
  await sheetSync.reconcile()
  assert.equal(db.leads[0].associateId, 'asc_2')

  db.leads[0].associateId = 'asc_1'
  await sheetSync.reconcile()
  assert.equal(db.leads[0].associateId, 'asc_2')
})

test('an owner the team list has never heard of is reported, not applied', async () => {
  const db = placeDb()
  const rows = [placeRow({
    name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111',
    center: 'Kenkere House, Bengaluru', associate: 'Someone Unknown'
  })]
  const writes = installPlaces(db, rows)

  await sheetSync.reconcile()
  assert.equal(db.leads[0].associateId, null)
  assert.ok(writes.log.some(line => line.startsWith('warn') && line.includes('Someone Unknown')))
})

test('a Center naming no studio at all leaves the lead where it is', async () => {
  const db = placeDb()
  const rows = [placeRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', center: 'Pop up' })]
  installPlaces(db, rows)

  await sheetSync.reconcile()
  assert.equal(db.leads[0].locationId, 'loc_kemps') // the fallback, untouched
})

test('a studio named without its city still resolves', async () => {
  const db = placeDb()
  const rows = [placeRow({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', center: 'Kenkere House' })]
  installPlaces(db, rows)

  await sheetSync.reconcile()
  assert.equal(db.leads[0].locationId, 'loc_kenkere')
})

// ---------------------------------------------------------------------------
// row count vs lead count
// ---------------------------------------------------------------------------

test('two rows for the same person become one lead, and the pass says so', async () => {
  const db = makeDb()
  const rows = [
    row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' }),
    // Same person, enquiring a second time — same phone, no email this time.
    row({ name: 'Asha Rao', phone: '9820011111', stage: 'Trial Booked' })
  ]
  install(db, rows)

  const counts = await sheetSync.reconcile()
  assert.equal(db.leads.length, 1)
  assert.equal(counts.sheetRows, 2)
  assert.equal(counts.duplicates, 1)
})

test('a snapshot full of dead leads does not switch deletion detection off', async () => {
  const db = makeDb()
  const rows = [
    row({ name: 'Asha Rao', email: 'asha@example.com', phone: '9820011111', stage: 'New Enquiry' }),
    row({ name: 'Ravi Menon', email: 'ravi@example.com', phone: '9820022222', stage: 'New Enquiry' }),
    row({ name: 'Kiran Shah', email: 'kiran@example.com', phone: '9820033333', stage: 'New Enquiry' }),
    row({ name: 'Meera Nair', email: 'meera@example.com', phone: '9820044444', stage: 'New Enquiry' }),
    row({ name: 'Sanya Bose', email: 'sanya@example.com', phone: '9820055555', stage: 'New Enquiry' }),
    row({ name: 'Rhea Iyer', email: 'rhea@example.com', phone: '9820066666', stage: 'New Enquiry' })
  ]
  const writes = install(db, rows)
  await sheetSync.reconcile()
  assert.equal(db.leads.length, 6)

  // Leads deleted outside the sync leave their snapshot rows behind. Left in,
  // those orphans inflate the "rows we knew about" figure the mid-refresh guard
  // measures the sheet against, and a healthy read starts looking truncated.
  db.leads = db.leads.slice(0, 1)
  rows.length = 1

  const counts = await sheetSync.reconcile()
  assert.ok(!writes.log.some(line => line.includes('mid-refresh')), 'a real read must not be dismissed as mid-refresh')
  assert.equal(counts.sheetRows, 1)
})

// The Momence lead id is the key the portal push is addressed to. It is
// inbound-only, which used to mean "no reader", which the merge read as "the
// app cleared this field" on every pass — so it never reached a lead, and the
// portal push silently skipped every edit.
test('the sheet\'s Momence lead id lands on the lead, and is never written back', async () => {
  const header = ['ID', 'Name', 'Email', 'Phone', 'Stage', 'Sync Status']
  const db = makeDb()
  const rows = [['4415887', 'Asha Rao', 'asha@example.com', '9820011111', 'New Enquiry', '']]
  const writes = { log: [], cells: [], mirrorWrites: [], mirrorAppends: [] }
  const mirror = { header: [], rows: [] }
  sheetSync.__setTransport(mirrorTransport(header, rows, mirror, writes))
  sheetSync.__reset()
  sheetSync.configure(makeCtx(db, writes))

  await sheetSync.reconcile()
  assert.equal(db.leads[0].momenceLeadId, '4415887')

  // The id column is Momence's, not ours: nothing the app does may propose a
  // value for it, and the export tab is never written to at all.
  const before = JSON.stringify(rows)
  db.leads[0].stage = 'Trial Booked'
  sheetSync.noteAppEdit(db.leads[0], ['stage'])
  await sheetSync.flushPending?.()
  assert.equal(JSON.stringify(rows), before)
  assert.ok(!writes.mirrorWrites.some(w => w.values.includes('4415887')) || mirror.header.every(h => h !== 'ID'))
})

test('an existing lead missing the Momence id is backfilled on the next pass', async () => {
  const header = ['ID', 'Name', 'Email', 'Phone', 'Stage', 'Sync Status']
  const db = makeDb()
  const rows = [['4415887', 'Asha Rao', 'asha@example.com', '9820011111', 'New Enquiry', '']]
  const writes = { log: [], cells: [], mirrorWrites: [], mirrorAppends: [] }
  const mirror = { header: [], rows: [] }
  sheetSync.__setTransport(mirrorTransport(header, rows, mirror, writes))
  sheetSync.__reset()
  sheetSync.configure(makeCtx(db, writes))

  await sheetSync.reconcile()
  // Simulate the leads created before the id was ever resolved: snapshot still
  // carries the sheet's value, so the merge sees no sheet-side change.
  db.leads[0].momenceLeadId = null
  await sheetSync.reconcile()
  assert.equal(db.leads[0].momenceLeadId, '4415887')
})
