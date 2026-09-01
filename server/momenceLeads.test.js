import test from 'node:test'
import assert from 'node:assert/strict'
import * as momenceLeads from './momenceLeads.js'

const { buildPayload, splitName, formatPhone, marketFor } = momenceLeads

function db() {
  return {
    locations: [
      { id: 'loc_kemps', name: 'Kwality House, Kemps Corner' },
      { id: 'loc_kenkere', name: 'Kenkere House, Bengaluru' }
    ],
    associates: [{ id: 'asc_1', name: 'Shipra Bhika', email: 'shipra@physique57mumbai.com' }],
    settings: { momence: {} }
  }
}

// One field per code, shaped the way the portal returns them.
function activeFields(pairs) {
  return Object.entries(pairs).map(([code, value]) => ({
    data: { string: value },
    customerLeadsField: { code }
  }))
}

test('a name splits into the portal\'s two columns', () => {
  assert.deepEqual(splitName('Shashank Hebbar'), { first: 'Shashank', last: 'Hebbar' })
  assert.deepEqual(splitName('Nunu G Yepthomi'), { first: 'Nunu G', last: 'Yepthomi' })
  assert.deepEqual(splitName('Prathap'), { first: 'Prathap', last: '' })
  assert.deepEqual(splitName('  '), { first: '', last: '' })
})

test('phone numbers reach the portal in E.164', () => {
  assert.equal(formatPhone('9773600001'), '+919773600001')
  assert.equal(formatPhone('919773600001'), '+919773600001')
  assert.equal(formatPhone('+91 97736 00001'), '+919773600001')
  assert.equal(formatPhone(''), '')
})

test('a lead is routed to the host its Host ID names', () => {
  assert.equal(marketFor(db(), { hostId: '33905' }), 'blr')
  assert.equal(marketFor(db(), { hostId: '13752' }), 'mumbai')
  // No Host ID: the studio decides.
  assert.equal(marketFor(db(), { locationId: 'loc_kenkere' }), 'blr')
  assert.equal(marketFor(db(), { locationId: 'loc_kemps' }), 'mumbai')
})

test('fields the app does not own are carried through untouched', () => {
  // The PUT replaces the whole custom-field set, so anything dropped here is
  // erased in the portal. These are fields only Momence knows about.
  const current = {
    firstName: 'Shashank', lastName: 'Hebbar', email: 'shank@example.com', phoneNumber: '+919019074263',
    activeFields: activeFields({
      zipCode: '400011', utm_campaign: 'open-barre-trial', discoveryAnswer: 'Instagram',
      dob: '1990-01-01', remarks: 'old remark'
    })
  }
  const body = buildPayload(current, { fullName: 'Shashank Hebbar', remarks: 'new remark' }, db())

  assert.equal(body.zipCode, '400011')
  assert.equal(body.utm_campaign, 'open-barre-trial')
  assert.equal(body.discoveryAnswer, 'Instagram')
  assert.equal(body.dob, '1990-01-01')
  assert.equal(body.remarks, 'new remark')
})

test('a field the app has nothing for never clears what the portal holds', () => {
  const current = { activeFields: activeFields({ remarks: 'staff typed this', center: 'Kwality House, Kemps Corner' }) }
  // No remarks on our side at all.
  const body = buildPayload(current, { fullName: 'Asha Rao' }, db())
  assert.equal(body.remarks, 'staff typed this')
})

test('follow-ups fill the portal\'s numbered pairs in order', () => {
  const current = { activeFields: activeFields({ fu1D: '', fu1C: '', fu2D: '', fu2C: '', FU3D: '', FU3C: '' }) }
  const lead = {
    fullName: 'Asha Rao',
    followUps: [
      { date: '2026-01-05', comments: 'called, no answer' },
      { date: '2026-01-09', comments: 'sent pricing' },
      { date: '2026-01-14', comments: 'booked a trial' }
    ]
  }
  const body = buildPayload(current, lead, db())

  assert.equal(body.fu1D, '2026-01-05')
  assert.equal(body.fu1C, 'called, no answer')
  assert.equal(body.fu2D, '2026-01-09')
  // Momence spells the third pair in capitals on both hosts.
  assert.equal(body.FU3D, '2026-01-14')
  assert.equal(body.FU3C, 'booked a trial')
})

test('the studio and owner go out as the names the portal uses', () => {
  const current = { activeFields: activeFields({ center: 'Kwality House, Kemps Corner', associate: 'Someone Else' }) }
  const lead = { fullName: 'Asha Rao', locationId: 'loc_kenkere', associateId: 'asc_1' }
  const body = buildPayload(current, lead, db())

  assert.equal(body.center, 'Kenkere House, Bengaluru')
  assert.equal(body.associate, 'Shipra Bhika')
})

test('a host with different field codes is served by the same projection', () => {
  // Bengaluru's field set: no childName/dob/size, but pregnant/campaign/source.
  const current = { activeFields: activeFields({ pregnant: 'No', campaign: 'diwali', landingPage: '/blr', remarks: '' }) }
  const body = buildPayload(current, { fullName: 'Rinkle Jain', remarks: 'called back' }, db())

  assert.equal(body.pregnant, 'No')
  assert.equal(body.campaign, 'diwali')
  assert.equal(body.remarks, 'called back')
  // Nothing invented for codes this host does not have.
  assert.equal('childName' in body, false)
  assert.equal('dob' in body, false)
})

test('a lead with no Momence id is skipped rather than guessed at', async () => {
  const result = await momenceLeads.pushLead(db(), { id: 'lead_1', fullName: 'Asha Rao' })
  assert.equal(result.outcome, 'skipped')
})

test('an edit that touches nothing Momence carries makes no write', async () => {
  const calls = []
  momenceLeads.__setTransport(async (_db, _market, path, options = {}) => {
    calls.push(`${options.method || 'GET'} ${path}`)
    if (path.includes('/stages')) return { payload: [{ id: 1, name: 'New Enquiry' }] }
    if (path.includes('/users/list')) return []
    if (path.includes('/sources')) return { payload: [] }
    return {
      id: 99, stageId: 1, activeFields: activeFields({ remarks: 'same' }),
      firstName: 'Asha', lastName: 'Rao', email: '', phoneNumber: ''
    }
  })
  momenceLeads.__clearReference()

  const lead = { id: 'lead_1', momenceLeadId: '99', hostId: '13752', fullName: 'Asha Rao', remarks: 'same', stage: 'New Enquiry' }
  const result = await momenceLeads.pushLead(db(), lead)

  assert.equal(result.outcome, 'unchanged')
  assert.ok(!calls.some(c => c.startsWith('PUT')), 'nothing should have been written')
})

// A recording transport, so the exact requests a push makes can be asserted on
// — these are third-party endpoints with no schema to check against, and the
// method and path are the two things easiest to get quietly wrong.
function recorder({ current, stages = [], users = [], sources = [] }) {
  const calls = []
  momenceLeads.__setTransport(async (_db, _market, path, options = {}) => {
    calls.push({ method: options.method || 'GET', path, body: options.body })
    if (path.includes('/customer-leads/stages')) return { payload: stages }
    if (path.includes('/users/list')) return users
    if (path.includes('/customer-leads/sources')) return { payload: sources }
    return current
  })
  momenceLeads.__clearReference()
  return calls
}

test('a stage change PATCHes the plural stages endpoint with the mapped id', async () => {
  const calls = recorder({
    current: {
      id: 1470831, stageId: 1803, firstName: 'Asha', lastName: 'Rao', email: '', phoneNumber: '',
      activeFields: activeFields({ remarks: 'old' })
    },
    stages: [{ id: 1803, name: 'New Enquiry' }, { id: 1810, name: 'Client Unresponsive' }]
  })

  const lead = {
    id: 'lead_1', momenceLeadId: '1470831', hostId: '13752',
    fullName: 'Asha Rao', remarks: 'new', stage: 'Client Unresponsive'
  }
  await momenceLeads.pushLead(db(), lead)

  const stageCall = calls.find(c => c.path.endsWith('/stages') && c.method === 'PATCH')
  assert.ok(stageCall, 'expected a PATCH to /customer-leads/1470831/stages')
  assert.equal(stageCall.path, '/customer-leads/1470831/stages')
  assert.deepEqual(stageCall.body, { stageId: 1810 })
})

test('an owner change PATCHes the singular handler endpoint with the user id', async () => {
  const calls = recorder({
    current: {
      id: 1470831, stageId: 1803, customerLeadHandler: { userId: 99999 },
      firstName: 'Asha', lastName: 'Rao', email: '', phoneNumber: '',
      activeFields: activeFields({ remarks: 'old' })
    },
    users: [{ id: 12006523, firstName: 'Shipra', lastName: 'Bhika', email: 'shipra@physique57mumbai.com' }]
  })

  const lead = {
    id: 'lead_1', momenceLeadId: '1470831', hostId: '13752',
    fullName: 'Asha Rao', remarks: 'new', associateId: 'asc_1'
  }
  await momenceLeads.pushLead(db(), lead)

  const handlerCall = calls.find(c => c.path.endsWith('/handler'))
  assert.ok(handlerCall, 'expected a PATCH to /customer-leads/1470831/handler')
  assert.equal(handlerCall.method, 'PATCH')
  assert.deepEqual(handlerCall.body, { userId: 12006523 })
})

test('a stage and owner already correct are not re-sent', async () => {
  const calls = recorder({
    current: {
      id: 1470831, stageId: 1810, customerLeadHandler: { userId: 12006523 },
      firstName: 'Asha', lastName: 'Rao', email: '', phoneNumber: '',
      activeFields: activeFields({ remarks: 'old' })
    },
    stages: [{ id: 1810, name: 'Client Unresponsive' }],
    users: [{ id: 12006523, firstName: 'Shipra', lastName: 'Bhika', email: 'shipra@physique57mumbai.com' }]
  })

  const lead = {
    id: 'lead_1', momenceLeadId: '1470831', hostId: '13752',
    fullName: 'Asha Rao', remarks: 'new', stage: 'Client Unresponsive', associateId: 'asc_1'
  }
  await momenceLeads.pushLead(db(), lead)

  assert.ok(!calls.some(c => c.method === 'PATCH'), 'nothing should have been PATCHed')
  // The field write still happens — remarks did change.
  assert.ok(calls.some(c => c.method === 'PUT'))
})

test('a stage Momence does not have leaves the portal alone and says so', async () => {
  const calls = recorder({
    current: {
      id: 1470831, stageId: 1803, firstName: 'Asha', lastName: 'Rao', email: '', phoneNumber: '',
      activeFields: activeFields({ remarks: 'old' })
    },
    stages: [{ id: 1803, name: 'New Enquiry' }]
  })
  const warnings = []

  const lead = {
    id: 'lead_1', momenceLeadId: '1470831', hostId: '13752',
    fullName: 'Asha Rao', remarks: 'new', stage: 'Looking for Virtual Classes'
  }
  await momenceLeads.pushLead(db(), lead, { log: (outcome, detail) => warnings.push(`${outcome}: ${detail}`) })

  assert.ok(!calls.some(c => c.path.endsWith('/stages') && c.method === 'PATCH'))
  assert.ok(warnings.some(w => w.includes('Looking for Virtual Classes')), warnings.join(' | '))
})

// ---------------------------------------------------------------------------
// finding the portal lead when the app does not know its id
// ---------------------------------------------------------------------------

function searchTransport({ items = [], current = null }) {
  const calls = []
  momenceLeads.__setTransport(async (_db, _market, path, options = {}) => {
    calls.push({ method: options.method || 'GET', path, body: options.body })
    if (path.includes('/stages')) return { payload: [{ id: 1, name: 'New Enquiry' }] }
    if (path.includes('/users/list')) return []
    if (path.includes('/sources')) return { payload: [] }
    if (path.includes('query=')) return { payload: items }
    return current || { id: 77, stageId: 1, activeFields: [], firstName: '', lastName: '', email: '', phoneNumber: '' }
  })
  momenceLeads.__clearReference()
  momenceLeads.__clearLookupCache()
  return calls
}

test('an edit to a lead with no portal id finds the lead and pushes it', async () => {
  const calls = searchTransport({
    items: [
      { id: 500, firstName: 'Other', lastName: 'Person', email: 'other@example.com', phoneNumber: '+919000000000' },
      { id: 501, firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phoneNumber: '+919773600001' }
    ],
    current: { id: 501, stageId: 1, activeFields: activeFields({ remarks: 'old' }), firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phoneNumber: '+919773600001' }
  })

  const lead = { id: 'lead_1', hostId: '13752', fullName: 'Asha Rao', email: 'asha@example.com', phone: '9773600001', remarks: 'new remark', stage: 'New Enquiry' }
  const result = await momenceLeads.pushLead(db(), lead)

  assert.equal(result.outcome, 'pushed')
  assert.equal(result.momenceId, '501')
  // Handed back so the caller can store it — the next edit costs no search.
  assert.equal(result.learnedId, '501')
  assert.ok(calls.some(c => c.method === 'PUT' && c.path.includes('/customer-leads/501')))
})

test('the sheet snapshot answers the id without any portal search', async () => {
  const calls = searchTransport({
    current: { id: 4415887, stageId: 1, activeFields: activeFields({ remarks: 'old' }), firstName: 'Asha', lastName: 'Rao', email: '', phoneNumber: '' }
  })
  const lead = { id: 'lead_1', hostId: '13752', fullName: 'Asha Rao', email: 'asha@example.com', remarks: 'new', stage: 'New Enquiry' }

  const result = await momenceLeads.pushLead(db(), lead, { sheetLookup: () => '4415887' })
  assert.equal(result.momenceId, '4415887')
  assert.equal(result.learnedId, '4415887')
  const searches = calls.filter(c => c.path.includes('query=') && !c.path.includes('/stages') && !c.path.includes('/sources'))
  assert.equal(searches.length, 0, 'the portal should not have been searched')
})

test('a phone-only lead matches on the last ten digits', async () => {
  searchTransport({
    items: [{ id: 620, firstName: 'Bo', lastName: 'M', email: '', phoneNumber: '+919773600002' }],
    current: { id: 620, stageId: 1, activeFields: [], firstName: 'Bo', lastName: 'M', email: '', phoneNumber: '+919773600002' }
  })
  const lead = { id: 'lead_2', hostId: '13752', fullName: 'Bo M', email: '-', phone: '9773600002', remarks: 'call back', stage: 'New Enquiry' }
  const result = await momenceLeads.pushLead(db(), lead)
  assert.equal(result.momenceId, '620')
})

test('a name-only resemblance is never accepted as a match', async () => {
  searchTransport({ items: [{ id: 700, firstName: 'Asha', lastName: 'Rao', email: 'different@example.com', phoneNumber: '+919111111111' }] })
  const lead = { id: 'lead_3', hostId: '13752', fullName: 'Asha Rao', email: 'asha@example.com', phone: '9773600001', remarks: 'x' }
  const result = await momenceLeads.pushLead(db(), lead)
  assert.equal(result.outcome, 'skipped')
  assert.match(result.reason, /no matching lead/)
})

test('a lead with no usable contact detail is not searched for at all', async () => {
  const calls = searchTransport({ items: [] })
  const lead = { id: 'lead_4', hostId: '13752', fullName: 'No Contact', email: '-', phone: '', remarks: 'x' }
  const result = await momenceLeads.pushLead(db(), lead)
  assert.equal(result.outcome, 'skipped')
  assert.ok(!calls.length, 'nothing should have been requested')
})

test('a fruitless search is not repeated on the next edit', async () => {
  const calls = searchTransport({ items: [] })
  const lead = { id: 'lead_5', hostId: '13752', fullName: 'Ghost', email: 'ghost@example.com', remarks: 'x' }

  const searchCount = () => calls.filter(c => c.path.includes('query=') && !c.path.includes('/stages') && !c.path.includes('/sources')).length
  await momenceLeads.pushLead(db(), lead)
  const afterFirst = searchCount()
  assert.ok(afterFirst > 0)

  await momenceLeads.pushLead(db(), lead)
  assert.equal(searchCount(), afterFirst, 'the miss should have been cached')
})

test('the search hits the endpoint the portal itself uses', async () => {
  const calls = searchTransport({
    items: [{ id: 810, firstName: 'Aishu', lastName: 'Gandhi', email: 'aishu@example.com', phoneNumber: '+917506119406', memberId: null }],
    current: { id: 810, stageId: 1, activeFields: [], firstName: 'Aishu', lastName: 'Gandhi', email: 'aishu@example.com', phoneNumber: '+917506119406' }
  })
  const lead = { id: 'lead_6', hostId: '13752', fullName: 'Aishu Gandhi', email: 'aishu@example.com', remarks: 'x', stage: 'New Enquiry' }
  const result = await momenceLeads.pushLead(db(), lead)

  assert.equal(result.momenceId, '810')
  const search = calls.find(c => c.path.startsWith('/customer-leads?page='))
  assert.ok(search, 'the leads-screen search endpoint should have been called')
  assert.match(search.path, /pageSize=\d+&query=aishu%40example\.com$/)
})

test("Momence's autogenerated placeholder address never matches", async () => {
  // The portal mints "<id>+<ts>@autogenerated.momence.com" for members who gave
  // no address. Two such leads share nothing but the domain.
  searchTransport({
    items: [{ id: 900, firstName: 'Chota', lastName: 'Test', email: '15199641+1785135037534@autogenerated.momence.com', phoneNumber: null }]
  })
  const lead = { id: 'lead_7', hostId: '13752', fullName: 'Chota Test', email: '15199641+9999999999999@autogenerated.momence.com', remarks: 'x' }
  const result = await momenceLeads.pushLead(db(), lead)
  assert.equal(result.outcome, 'skipped')
})

test('the Momence member id settles a match the contact details cannot', async () => {
  searchTransport({
    items: [{ id: 950, firstName: 'Asha', lastName: 'Rao', email: 'stale@example.com', phoneNumber: null, memberId: 33091641 }],
    current: { id: 950, stageId: 1, activeFields: [], firstName: 'Asha', lastName: 'Rao', email: 'stale@example.com', phoneNumber: '' }
  })
  const lead = { id: 'lead_8', hostId: '13752', fullName: 'Asha Rao', email: 'asha@example.com', memberId: '33091641', remarks: 'x', stage: 'New Enquiry' }
  const result = await momenceLeads.pushLead(db(), lead)
  assert.equal(result.momenceId, '950')
})
