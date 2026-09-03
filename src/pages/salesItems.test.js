// 756 distinct payment-item names across the two hosts is unusable as a
// grouping dimension. These map the real names (taken from the cache) onto a
// small set of commercial buckets, so "how did unlimited memberships do" is
// one row instead of forty.
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeItem, itemGroupOf, ITEM_GROUPS } from './salesItems.js'

const group = (paymentItem, over = {}) => itemGroupOf({ paymentItem, paymentCategory: 'membership', ...over })

test('unlimited memberships group together whatever the term', () => {
  for (const name of [
    'Studio 1 Month Unlimited Membership',
    'Studio 3 Month Unlimited Membership',
    'Studio 6 Month Unlimited Membership',
    'Studio Annual Unlimited Membership',
    'Studio 2 Week Unlimited Membership',
    'Barre 1 month Unlimited ',
    'powerCycle 2 week Unlimited'
  ]) assert.equal(group(name), 'Unlimited membership', name)
})

test('the term is kept as its own facet', () => {
  assert.equal(normalizeItem({ paymentItem: 'Studio 3 Month Unlimited Membership' }).itemTerm, '3 months')
  assert.equal(normalizeItem({ paymentItem: 'Studio Annual Unlimited Membership' }).itemTerm, '12 months')
  assert.equal(normalizeItem({ paymentItem: 'Studio 2 Week Unlimited Membership' }).itemTerm, '2 weeks')
  assert.equal(normalizeItem({ paymentItem: 'Studio Single Class' }).itemTerm, null)
})

test('class packs group together, and their size is kept', () => {
  for (const name of [
    'Studio 4 Class Package', 'Studio 8 Class Package', 'Studio 12 Class Package',
    'Studio 10 Single Class Pack', 'Studio Extended 10 Single Class Pack', 'Studio 20 Single Class Pack',
    'Copper + Cloves Single Class Package'
  ]) assert.equal(group(name), 'Class pack', name)
  assert.equal(normalizeItem({ paymentItem: 'Studio 12 Class Package' }).itemSize, 12)
  assert.equal(normalizeItem({ paymentItem: 'Studio Extended 10 Single Class Pack' }).itemSize, 10)
})

test('a single class is not a pack', () => {
  assert.equal(group('Studio Single Class'), 'Single class')
  assert.equal(normalizeItem({ paymentItem: 'Studio Single Class' }).itemSize, null)
})

test('newcomer and intro offers are their own bucket, however they are spelled', () => {
  for (const name of ['Newcomers 2 For 1', 'Studio Newcomer 2 for 1 ', 'New Client Intro Pack'])
    assert.equal(group(name), 'Intro offer', name)
})

test('privates group separately from group classes', () => {
  for (const name of ['Studio Private Class', 'Studio Private Class X 10', 'Studio Private - Anisha (Single Class)', 'Virtual Privates - Anisha x 10', 'Studio Happy Hour Private'])
    assert.equal(group(name), 'Private training', name)
})

test('a booked class is a class booking, not a membership', () => {
  for (const name of ['Studio Barre 57', 'Studio Mat 57', 'powerCycle', 'Studio Cardio Barre', 'Studio FIT', 'Copper + Cloves Barre 57', 'Strength Lab (Focus)'])
    assert.equal(itemGroupOf({ paymentItem: name, paymentCategory: 'event' }), 'Class booking', name)
})

test('retail is retail whatever the SKU is called', () => {
  for (const name of [
    'SQ-Cacao & Maca Ball', 'Impact Water 500ML', 'P57 - SOCKS', 'P57 - Muscle Crop Tee',
    'Poptein Peanut Butter - (50g)', 'The Huda Bar - Almond Nutjob',
    'Enabl Life - EnCloud Fitted Tee - Short sleeve - Black'
  ]) assert.equal(itemGroupOf({ paymentItem: name, paymentCategory: 'product' }), 'Retail', name)
})

test('credits, gift cards, refunds and tips are not sales of a service', () => {
  assert.equal(itemGroupOf({ paymentItem: 'money-credit', paymentCategory: 'membership' }), 'Credits')
  assert.equal(itemGroupOf({ paymentItem: 'Copper + Cloves Credit', paymentCategory: 'membership' }), 'Credits')
  assert.equal(itemGroupOf({ paymentItem: 'Gift card', paymentCategory: 'gift-card' }), 'Gift card')
  assert.equal(itemGroupOf({ paymentItem: 'Refund', paymentCategory: 'refund' }), 'Refund')
  assert.equal(itemGroupOf({ paymentItem: 'Tip', paymentCategory: 'tip' }), 'Tip')
})

test('an appointment is its own group', () => {
  assert.equal(itemGroupOf({ paymentItem: 'Body composition scan', paymentCategory: 'appointment' }), 'Appointment')
})

test('anything unrecognised falls back to a labelled bucket rather than vanishing', () => {
  assert.equal(itemGroupOf({ paymentItem: 'Something brand new', paymentCategory: 'membership' }), 'Other membership')
  assert.equal(itemGroupOf({ paymentItem: '', paymentCategory: null }), 'Unspecified')
})

test('the brand prefix is stripped so the same product from both hosts groups as one', () => {
  assert.equal(normalizeItem({ paymentItem: 'Copper + Cloves Barre 57', paymentCategory: 'event' }).itemName, 'Barre 57')
  assert.equal(normalizeItem({ paymentItem: 'Studio Barre 57', paymentCategory: 'event' }).itemName, 'Barre 57')
  assert.equal(normalizeItem({ paymentItem: 'Plash Pilates Barre 57 ', paymentCategory: 'event' }).itemName, 'Barre 57')
})

test('every group is declared, so the UI can colour and order them', () => {
  const declared = new Set(ITEM_GROUPS)
  for (const name of ['Studio Single Class', 'Newcomers 2 For 1', 'money-credit', 'Studio Private Class'])
    assert.ok(declared.has(group(name)), `${name} produced an undeclared group`)
})
