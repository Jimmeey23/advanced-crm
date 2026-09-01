import test from 'node:test'
import assert from 'node:assert/strict'
import {
  inRangeFn, reportVelocity, reportSourceRoi, reportRankings,
  reportPipelineAgeing, reportTopLeads, reportWeekdayPattern,
  reportFollowUpHealth, reportInsights
} from './reportAggregates.js'

const START = new Date('2026-03-01T00:00:00Z')
const END = new Date('2026-04-01T00:00:00Z')

const lead = (over = {}) => ({
  id: over.id || 'l1',
  fullName: 'Test Lead',
  status: 'open',
  stage: 'New',
  sourceName: 'Website',
  valueEstimate: 0,
  createdAt: '2026-03-05T00:00:00Z',
  followUps: [],
  ...over
})

test('inRangeFn rejects blanks, dashes and unparseable dates', () => {
  const inRange = inRangeFn(START, END)
  assert.equal(inRange('2026-03-15'), true)
  assert.equal(inRange('2026-04-01T00:00:00Z'), false) // end is exclusive
  assert.equal(inRange('-'), false)
  assert.equal(inRange(''), false)
  assert.equal(inRange('not a date'), false)
})

test('velocity separates never-contacted leads from slow ones', () => {
  const leads = [
    lead({ id: 'a', createdAt: '2026-03-01T00:00:00Z', followUps: [{ date: '2026-03-03', done: true }] }),
    lead({ id: 'b', createdAt: '2026-03-01T00:00:00Z', followUps: [] }),
    lead({ id: 'c', createdAt: '2026-03-01T00:00:00Z', followUps: [{ date: '-', done: false }] })
  ]
  const v = reportVelocity(leads, START, END)
  assert.equal(v.untouchedLeads, 2, 'a "-" follow-up date is not a touch')
  assert.equal(v.touchedLeads, 1)
  assert.equal(v.medianDaysToFirstTouch, 2)
})

test('velocity measures days-to-win from creation to conversion', () => {
  const leads = [
    lead({ id: 'w1', status: 'won', createdAt: '2026-03-01T00:00:00Z', convertedAt: '2026-03-11T00:00:00Z', followUps: [{ date: '2026-03-02', done: true }, { date: '2026-03-06', done: true }] }),
    lead({ id: 'w2', status: 'won', createdAt: '2026-03-01T00:00:00Z', convertedAt: '2026-03-03T00:00:00Z', followUps: [{ date: '2026-03-02', done: true }] })
  ]
  const v = reportVelocity(leads, START, END)
  assert.equal(v.wonCount, 2)
  assert.equal(v.medianDaysToWin, 6)
  assert.equal(v.avgTouchesToWin, 1.5)
})

test('source ROI ranks by revenue and reports return per lead', () => {
  const leads = [
    lead({ id: '1', sourceName: 'Referral', status: 'won', valueEstimate: 60000 }),
    lead({ id: '2', sourceName: 'Referral', status: 'lost' }),
    lead({ id: '3', sourceName: 'Walk-in', status: 'won', valueEstimate: 20000 }),
    lead({ id: '4', sourceName: null, status: 'open' })
  ]
  const rows = reportSourceRoi(leads, START, END)
  assert.equal(rows[0].source, 'Referral')
  assert.equal(rows[0].revenuePerLead, 30000)
  assert.equal(rows[0].winRate, 50)
  assert.equal(rows[0].avgDealValue, 60000)
  assert.equal(rows.at(-1).source, 'Unspecified', 'a missing source is still a row')
})

test('rankings report movement against the previous board', () => {
  const current = [
    { associateId: 'a', name: 'Asha', revenue: 90, won: 3, newLeads: 10, trials: 4, followUpRate: 90 },
    { associateId: 'b', name: 'Bo', revenue: 40, won: 1, newLeads: 5, trials: 2, followUpRate: 40 },
    { associateId: 'c', name: 'Cal', revenue: 10, won: 0, newLeads: 4, trials: 1, followUpRate: 10 }
  ]
  const previous = [
    { associateId: 'b', name: 'Bo', revenue: 80, won: 4, newLeads: 9, trials: 3, followUpRate: 70 },
    { associateId: 'a', name: 'Asha', revenue: 50, won: 2, newLeads: 8, trials: 2, followUpRate: 80 }
  ]
  const rows = reportRankings(current, previous)
  assert.equal(rows[0].rank, 1)
  assert.equal(rows[0].rankDelta, 1, 'Asha moved up one place')
  assert.equal(rows[1].rankDelta, -1, 'Bo dropped one place')
  assert.equal(rows[2].rankDelta, null, 'a newcomer has no previous rank')
  assert.equal(rows[0].conversionRate, 30)
  assert.equal(rows[0].revenueDelta, 40)
})

test('pipeline ageing buckets only open leads and matches the drill boundaries', () => {
  const now = new Date('2026-03-31T00:00:00Z').getTime()
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString()
  const leads = [
    lead({ id: 'fresh', createdAt: daysAgo(3), valueEstimate: 1000 }),
    lead({ id: 'edge7', createdAt: daysAgo(7) }),
    lead({ id: 'mid', createdAt: daysAgo(20) }),
    lead({ id: 'old', createdAt: daysAgo(120), valueEstimate: 5000, stage: 'Trial scheduled' }),
    lead({ id: 'won', status: 'won', createdAt: daysAgo(200) })
  ]
  const a = reportPipelineAgeing(leads, now)
  assert.equal(a.openCount, 4, 'won leads are not open pipeline')
  assert.deepEqual(a.buckets.map(b => b.count), [2, 1, 0, 1])
  assert.equal(a.buckets[0].value, 1000)
  assert.equal(a.oldest.id, 'old')
  assert.equal(a.oldest.ageDays, 120)
  assert.equal(a.stages.find(s => s.stage === 'Trial scheduled').stale, 1)
})

test('top leads splits wins, open deals and losses by value', () => {
  const leads = [
    lead({ id: 'w', status: 'won', valueEstimate: 5000, createdAt: '2026-03-01T00:00:00Z', convertedAt: '2026-03-06T00:00:00Z' }),
    lead({ id: 'o1', valueEstimate: 9000 }),
    lead({ id: 'o2', valueEstimate: 0 }),
    lead({ id: 'lo', status: 'lost', valueEstimate: 3000, updatedAt: '2026-03-20T00:00:00Z' })
  ]
  const top = reportTopLeads(leads, START, END)
  assert.deepEqual(top.wins.map(l => l.id), ['w'])
  assert.equal(top.wins[0].daysToWin, 5)
  assert.deepEqual(top.openDeals.map(l => l.id), ['o1'], 'a zero-value open lead is not a deal')
  assert.deepEqual(top.losses.map(l => l.id), ['lo'])
})

test('weekday pattern counts arrivals and their wins', () => {
  const leads = [
    lead({ id: '1', createdAt: '2026-03-02T09:00:00Z', status: 'won' }), // Monday
    lead({ id: '2', createdAt: '2026-03-02T18:00:00Z' }),
    lead({ id: '3', createdAt: '2026-03-07T10:00:00Z' })                 // Saturday
  ]
  const rows = reportWeekdayPattern(leads, START, END)
  const monday = rows.find(r => r.label === 'Mon')
  assert.equal(monday.leads, 2)
  assert.equal(monday.won, 1)
  assert.equal(monday.winRate, 50)
  assert.equal(rows.find(r => r.label === 'Sun').leads, 0)
})

test('follow-up health counts overdue only for open leads', () => {
  const past = '2026-03-02'
  const leads = [
    lead({ id: 'open', createdAt: '2026-03-01T00:00:00Z', followUps: [{ date: past, done: false }] }),
    lead({ id: 'won', status: 'won', createdAt: '2026-03-01T00:00:00Z', followUps: [{ date: past, done: false }] }),
    lead({ id: 'clean', createdAt: '2026-03-01T00:00:00Z', followUps: [{ date: '2026-03-10', done: true }] }),
    lead({ id: 'none', createdAt: '2026-03-01T00:00:00Z', followUps: [] })
  ]
  const h = reportFollowUpHealth(leads, START, END)
  assert.equal(h.logged, 3)
  assert.equal(h.done, 1)
  assert.equal(h.missed, 2)
  assert.equal(h.overdue, 1, 'a past-due follow-up on a won lead is not chasing work')
  assert.equal(h.leadsWithNoFollowUp, 1)
  assert.equal(h.completionRate, 33)
})

test('insights read the aggregates rather than recomputing them', () => {
  const comparisons = {
    current: { leadsReceived: 120, converted: 24, conversionRate: 20 },
    previousPeriod: { leadsReceived: 100, converted: 15, conversionRate: 15 },
    yoy: { leadsReceived: 90, converted: 10, conversionRate: 11 }
  }
  const out = reportInsights({
    comparisons,
    sourceRoi: [{ source: 'Referral', leads: 10, won: 5, winRate: 50, revenuePerLead: 4000 }, { source: 'Flyers', leads: 20, won: 1, winRate: 5, revenuePerLead: 100 }],
    rankings: [{ name: 'Asha', rank: 1, rankDelta: 2, revenue: 90000, won: 3 }],
    velocity: { untouchedLeads: 4, touchedLeads: 60, medianDaysToFirstTouch: 2 },
    ageing: { buckets: [{ key: '90+', count: 12, value: 300000 }] },
    followUp: { overdue: 7, completionRate: 62 }
  })
  const titles = out.map(i => i.title)
  assert.ok(titles.some(t => t.includes('Lead volume up 20%')))
  assert.ok(titles.some(t => t.includes('Conversion improved 5 points')))
  assert.ok(titles.some(t => t.includes('Referral returns the most per lead')))
  assert.ok(titles.some(t => t.includes('Flyers converts below')))
  assert.ok(titles.some(t => t.includes('4 leads received no follow-up')))
  assert.ok(titles.some(t => t.includes('12 open leads are older than 90 days')))
  assert.ok(titles.some(t => t.includes('Asha climbed 2 places')))
})

test('insights stay quiet when nothing moved', () => {
  const flat = { leadsReceived: 100, converted: 20, conversionRate: 20 }
  const out = reportInsights({
    comparisons: { current: flat, previousPeriod: { ...flat }, yoy: { ...flat } },
    sourceRoi: [],
    rankings: [],
    velocity: { untouchedLeads: 0, touchedLeads: 100, medianDaysToFirstTouch: 1 },
    ageing: { buckets: [{ key: '90+', count: 0, value: 0 }] },
    followUp: { overdue: 0, completionRate: 100 }
  })
  assert.deepEqual(out, [])
})
