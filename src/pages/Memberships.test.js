import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogGroup } from './membershipModel.js'

test('groups the membership catalog into unlimited, class packages and complimentary', () => {
  assert.equal(catalogGroup({ name: 'Studio Annual Unlimited Membership', price: 60000 }), 'Unlimited memberships')
  assert.equal(catalogGroup({ name: 'Studio 3 Month U/L Monthly Installment', price: 25000 }), 'Unlimited memberships')
  assert.equal(catalogGroup({ name: 'Studio 12 Class Package', price: 17000 }), 'Class packages')
  assert.equal(catalogGroup({ name: 'Flexible Package', price: null }), 'Class packages')
  assert.equal(catalogGroup({ name: 'Studio Complimentary Referral Class', price: 0 }), 'Complimentary')
  assert.equal(catalogGroup({ name: 'Partner Sign Up Link', price: 0 }), 'Complimentary')
})
