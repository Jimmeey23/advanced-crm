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
