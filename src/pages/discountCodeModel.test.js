import test from 'node:test'
import assert from 'node:assert/strict'
import { discountCodeStatus, emptyDiscountCode, toApiPayload, toDateTimeLocal, toEditorModel } from './discountCodeModel.js'

test('classifies active, scheduled, and expired codes', () => {
  const now = new Date('2026-08-31T00:00:00Z')
  assert.equal(discountCodeStatus({ expiresAt: '2026-08-30T00:00:00Z' }, now), 'expired')
  assert.equal(discountCodeStatus({ validFrom: '2026-09-02T00:00:00Z' }, now), 'scheduled')
  assert.equal(discountCodeStatus({}, now), 'active')
})

test('formats UTC values as Asia Kolkata datetime-local values', () => {
  assert.equal(toDateTimeLocal('2026-08-31T02:38:00.000Z', 'Asia/Kolkata'), '2026-08-31T08:08')
  assert.equal(toDateTimeLocal(null, 'Asia/Kolkata'), '')
})

test('creates stable form defaults and normalizes upstream codes', () => {
  assert.deepEqual(emptyDiscountCode(), {
    type: 'percentage', discountPercentage: 10, discountValue: '', code: '', description: '', isUnlimited: true,
    usageAmount: '', usageAmountGlobal: '', numberOfRenewalsDiscountIsValidFor: '', validFrom: '', expiresAt: '',
    isUsableForGiftCards: false, isNewCustomersOnly: false, assignedEvents: [], assignedSessionTemplates: [],
    assignedProducts: [], assignedVideos: [], assignedAppointmentServices: [], assignedCourses: [], assignedMemberships: []
  })
  const model = toEditorModel({ id: 1, type: 'value', discountValue: 500, code: 'SAVE', assignedMemberships: [{ id: 7 }] })
  assert.equal(model.type, 'fixed')
  assert.equal(model.discountValue, 500)
  assert.deepEqual(model.assignedMemberships, [7])
})

test('converts editor values to the exact API payload', () => {
  const payload = toApiPayload({ ...emptyDiscountCode(), code: ' TEST ', assignedMemberships: [4, '5'] })
  assert.equal(payload.code, 'TEST')
  assert.deepEqual(payload.assignedMemberships, [4, 5])
  assert.equal(Object.keys(payload).length, 20)
})
