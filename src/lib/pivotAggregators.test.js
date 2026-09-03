// Aggregators added beyond the original eight. The engine calls `aggregate`
// with the rows of one cell, so each of these has to answer from rows alone —
// anything needing the grand total (a share) is filled in by a second pass.
import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregate, AGGREGATORS } from './pivot.js'

const rows = [
  { v: 10, s: 'a', d: '2026-01-05' },
  { v: 20, s: 'b', d: '2026-03-01' },
  { v: 30, s: 'a', d: '2026-02-01' },
  { v: 40, s: '', d: '' },
  { v: null, s: 'c', d: '2026-04-01' }
]

const agg = (id, field = 'v') => aggregate(rows, { agg: id, field })

test('the original aggregators still answer the same way', () => {
  assert.equal(agg('count'), 5)
  assert.equal(agg('sum'), 100)
  assert.equal(agg('avg'), 25)
  assert.equal(agg('min'), 10)
  assert.equal(agg('max'), 40)
  assert.equal(agg('median'), 25)
  assert.equal(agg('countDistinct', 's'), 3)
})

test('countEmpty and countFilled split a column by whether it has a value', () => {
  assert.equal(agg('countFilled', 's'), 4)
  assert.equal(agg('countEmpty', 's'), 1)
  // A null number is empty too, not zero.
  assert.equal(agg('countFilled'), 4)
})

test('first and last read the column in row order', () => {
  assert.equal(agg('first', 's'), 'a')
  assert.equal(agg('last', 's'), 'c')
})

test('range is max minus min', () => {
  assert.equal(agg('range'), 30)
})

test('percentiles answer at p25, p75 and p90', () => {
  const ordered = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }, { v: 6 }, { v: 7 }, { v: 8 }, { v: 9 }, { v: 10 }]
  assert.equal(aggregate(ordered, { agg: 'p25', field: 'v' }), 3.25)
  assert.equal(aggregate(ordered, { agg: 'p75', field: 'v' }), 7.75)
  assert.equal(aggregate(ordered, { agg: 'p90', field: 'v' }), 9.1)
})

test('stddev is the population deviation, and is zero for one row', () => {
  const simple = [{ v: 2 }, { v: 4 }, { v: 4 }, { v: 4 }, { v: 5 }, { v: 5 }, { v: 7 }, { v: 9 }]
  assert.equal(aggregate(simple, { agg: 'stddev', field: 'v' }), 2)
  assert.equal(aggregate([{ v: 3 }], { agg: 'stddev', field: 'v' }), 0)
})

test('mode is the most common value', () => {
  assert.equal(agg('mode', 's'), 'a')
})

test('uniqueList joins the distinct values for reading', () => {
  assert.equal(agg('uniqueList', 's'), 'a, b, c')
})

test('date columns answer earliest and latest', () => {
  assert.equal(agg('earliest', 'd'), '2026-01-05')
  assert.equal(agg('latest', 'd'), '2026-04-01')
})

test('an empty cell never returns NaN', () => {
  for (const { id } of AGGREGATORS) {
    const value = aggregate([], { agg: id, field: 'v' })
    assert.ok(value === 0 || value === null || value === '', `${id} returned ${value} for no rows`)
  }
})

test('every aggregator in the list is implemented', () => {
  for (const { id } of AGGREGATORS) {
    const value = aggregate(rows, { agg: id, field: 'v' })
    assert.notEqual(value, undefined, `${id} is declared but returns undefined`)
  }
})
