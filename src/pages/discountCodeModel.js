const ARRAY_FIELDS = [
  'assignedEvents', 'assignedSessionTemplates', 'assignedProducts', 'assignedVideos',
  'assignedAppointmentServices', 'assignedCourses', 'assignedMemberships'
]

export function emptyDiscountCode() {
  return {
    type: 'percentage', discountPercentage: 10, discountValue: '', code: '', description: '', isUnlimited: true,
    usageAmount: '', usageAmountGlobal: '', numberOfRenewalsDiscountIsValidFor: '', validFrom: '', expiresAt: '',
    isUsableForGiftCards: false, isNewCustomersOnly: false, assignedEvents: [], assignedSessionTemplates: [],
    assignedProducts: [], assignedVideos: [], assignedAppointmentServices: [], assignedCourses: [], assignedMemberships: []
  }
}

export function toDateTimeLocal(value, timeZone = 'Asia/Kolkata') {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function fromDateTimeLocal(value) {
  if (!value) return null
  const date = new Date(`${value}:00+05:30`)
  return Number.isFinite(date.getTime()) ? date.toISOString() : value
}

function ids(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => Number(item?.id ?? item)).filter(id => Number.isInteger(id) && id > 0))]
}

export function toEditorModel(code = {}) {
  const model = { ...emptyDiscountCode(), ...code }
  model.type = code.type === 'value' ? 'fixed' : (code.type || 'percentage')
  model.description = code.description || ''
  model.validFrom = toDateTimeLocal(code.validFrom)
  model.expiresAt = toDateTimeLocal(code.expiresAt)
  for (const field of ARRAY_FIELDS) model[field] = ids(code[field])
  return model
}

export function toApiPayload(model) {
  const payload = {
    type: model.type,
    discountPercentage: model.type === 'percentage' ? Number(model.discountPercentage) : null,
    discountValue: model.type === 'fixed' ? Number(model.discountValue) : null,
    code: String(model.code || '').trim(),
    description: String(model.description || '').trim(),
    isUnlimited: Boolean(model.isUnlimited),
    usageAmount: model.usageAmount === '' ? null : Number(model.usageAmount),
    usageAmountGlobal: model.usageAmountGlobal === '' ? null : Number(model.usageAmountGlobal),
    numberOfRenewalsDiscountIsValidFor: model.numberOfRenewalsDiscountIsValidFor === '' ? null : Number(model.numberOfRenewalsDiscountIsValidFor),
    validFrom: fromDateTimeLocal(model.validFrom),
    expiresAt: fromDateTimeLocal(model.expiresAt),
    isUsableForGiftCards: Boolean(model.isUsableForGiftCards),
    isNewCustomersOnly: Boolean(model.isNewCustomersOnly)
  }
  for (const field of ARRAY_FIELDS) payload[field] = ids(model[field])
  return payload
}

export function discountCodeStatus(code, now = new Date()) {
  const time = now.getTime()
  if (code?.expiresAt && new Date(code.expiresAt).getTime() <= time) return 'expired'
  if (code?.validFrom && new Date(code.validFrom).getTime() > time) return 'scheduled'
  return 'active'
}

export function discountLabel(code) {
  return String(code?.type) === 'percentage'
    ? `${Number(code.discountPercentage || 0).toLocaleString()}% off`
    : `₹${Number(code?.discountValue || 0).toLocaleString('en-IN')} off`
}
