// Report insight aggregates.
//
// Split out of the route file so each one can be tested against a fixture set
// of leads: they are pure functions of (leads, window) and know nothing about
// express, the db singleton or the caller's scope. The route resolves the
// scope, hands over an already-scoped lead array, and formats the response.

// A lead's date fields arrive from the sheet import as strings, sometimes as
// the literal "-" for "no date". Anything unparseable is out of every window
// rather than silently counting as epoch zero.
export function inRangeFn(start, end) {
  return (v) => {
    if (!v || v === '-') return false
    const d = new Date(v)
    return !isNaN(d.getTime()) && d >= start && d < end
  }
}

/* ============================================================
   REPORT INSIGHT AGGREGATES
   Everything below answers a question the three comparison columns can't:
   how fast the funnel moves, which source pays for itself, who moved up or
   down the board, and where open pipeline is going stale. All of them take
   the same (scope, entityId, start, end) contract as reportMetrics so the
   report endpoint can hand them the window it already resolved.
   ============================================================ */

const daysBetween = (a, b) => {
  const from = new Date(a), to = new Date(b)
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null
  return Math.max(0, (to - from) / 86400000)
}
const median = (values) => {
  if (!values.length) return 0
  const sorted = [...values].sort((x, y) => x - y)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const round1 = (n) => Math.round(n * 10) / 10

// How long the funnel takes, in days. Median as well as mean because a
// handful of leads that convert a year late drag the average somewhere no
// real lead has ever been.
export function reportVelocity(leads, start, end) {
  const inRange = inRangeFn(start, end)
  const wonInPeriod = leads.filter(l => l.status === 'won' && inRange(l.convertedAt))
  const toWin = wonInPeriod.map(l => daysBetween(l.createdAt, l.convertedAt)).filter(v => v !== null)

  // First touch = the earliest follow-up logged against the lead. A lead with
  // no follow-up at all is not a slow response, it is no response, and is
  // counted separately rather than skewing the average.
  const createdInPeriod = leads.filter(l => inRange(l.createdAt))
  const firstTouch = []
  let untouched = 0
  for (const l of createdInPeriod) {
    const dates = (l.followUps || []).map(f => f.date).filter(d => d && d !== '-').map(d => new Date(d)).filter(d => !isNaN(d.getTime()))
    if (!dates.length) { untouched++; continue }
    const gap = daysBetween(l.createdAt, new Date(Math.min(...dates.map(d => d.getTime()))))
    if (gap !== null) firstTouch.push(gap)
  }

  const touchesToWin = wonInPeriod.map(l => (l.followUps || []).filter(f => f.done).length)

  return {
    wonCount: wonInPeriod.length,
    avgDaysToWin: round1(toWin.reduce((s, v) => s + v, 0) / (toWin.length || 1)),
    medianDaysToWin: round1(median(toWin)),
    avgDaysToFirstTouch: round1(firstTouch.reduce((s, v) => s + v, 0) / (firstTouch.length || 1)),
    medianDaysToFirstTouch: round1(median(firstTouch)),
    untouchedLeads: untouched,
    touchedLeads: firstTouch.length,
    avgTouchesToWin: round1(touchesToWin.reduce((s, v) => s + v, 0) / (touchesToWin.length || 1))
  }
}

// Return per source, not just volume per source. A source that delivers 200
// leads and two wins is a cost centre, and the plain count breakdown reads it
// as the best performer on the page.
export function reportSourceRoi(leads, start, end) {
  const inRange = inRangeFn(start, end)
  const received = leads.filter(l => inRange(l.createdAt))
  const map = {}
  for (const l of received) {
    const key = l.sourceName || 'Unspecified'
    const row = map[key] = map[key] || { source: key, leads: 0, won: 0, lost: 0, open: 0, revenue: 0 }
    row.leads++
    if (l.status === 'won') { row.won++; row.revenue += Number(l.valueEstimate) || 0 }
    else if (l.status === 'lost') row.lost++
    else row.open++
  }
  return Object.values(map)
    .map(r => ({
      ...r,
      winRate: r.leads ? Math.round((r.won / r.leads) * 100) : 0,
      revenuePerLead: r.leads ? Math.round(r.revenue / r.leads) : 0,
      avgDealValue: r.won ? Math.round(r.revenue / r.won) : 0
    }))
    .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads)
}

// The leaderboard, plus where each associate stood in the preceding period,
// so a row can say "up two places" instead of only "third".
export function reportRankings(current, previous) {
  const prevRank = new Map(previous.map((a, i) => [a.associateId, i + 1]))
  const prevById = new Map(previous.map(a => [a.associateId, a]))
  return current.map((a, i) => {
    const before = prevById.get(a.associateId)
    const rankBefore = prevRank.get(a.associateId) || null
    return {
      ...a,
      rank: i + 1,
      previousRank: rankBefore,
      rankDelta: rankBefore ? rankBefore - (i + 1) : null,
      revenueDelta: before ? a.revenue - before.revenue : null,
      wonDelta: before ? a.won - before.won : null,
      conversionRate: a.newLeads ? Math.round((a.won / a.newLeads) * 100) : 0,
      revenuePerLead: a.newLeads ? Math.round(a.revenue / a.newLeads) : 0
    }
  })
}

// Open pipeline by stage and by age bucket. Point-in-time, deliberately not
// period-filtered: a lead that has sat in "Trial scheduled" for 90 days is a
// problem today regardless of the month it arrived in.
export function reportPipelineAgeing(leads, now = Date.now()) {
  const open = leads.filter(l => l.status === 'open' || !l.status)
  const BUCKETS = [
    { key: '0-7', label: '0–7 days', max: 7 },
    { key: '8-30', label: '8–30 days', max: 30 },
    { key: '31-90', label: '31–90 days', max: 90 },
    { key: '90+', label: '90+ days', max: Infinity }
  ]
  const buckets = BUCKETS.map(b => ({ ...b, count: 0, value: 0 }))
  const stageMap = {}
  let oldest = null
  for (const l of open) {
    const age = Math.max(0, Math.round((now - new Date(l.createdAt).getTime()) / 86400000))
    const bucket = buckets.find(b => age <= b.max) || buckets[buckets.length - 1]
    bucket.count++
    bucket.value += Number(l.valueEstimate) || 0
    const key = l.stage || 'Unspecified'
    const row = stageMap[key] = stageMap[key] || { stage: key, count: 0, ageSum: 0, value: 0, stale: 0 }
    row.count++
    row.ageSum += age
    row.value += Number(l.valueEstimate) || 0
    if (age > 30) row.stale++
    if (!oldest || age > oldest.ageDays) oldest = { id: l.id, name: l.fullName, stage: l.stage, ageDays: age }
  }
  const stages = Object.values(stageMap)
    .map(r => ({ stage: r.stage, count: r.count, value: r.value, stale: r.stale, avgAgeDays: r.count ? Math.round(r.ageSum / r.count) : 0 }))
    .sort((a, b) => b.count - a.count)
  return { buckets: buckets.map(({ max, ...b }) => b), stages, openCount: open.length, oldest }
}

// The named rows behind the aggregates — the biggest wins of the period and
// the largest open deals still in play, each one openable in the drawer.
export function reportTopLeads(leads, start, end) {
  const inRange = inRangeFn(start, end)
  const shape = (l, extra = {}) => ({
    id: l.id, fullName: l.fullName, stage: l.stage, status: l.status,
    source: l.sourceName || 'Unspecified', value: Number(l.valueEstimate) || 0,
    associateId: l.associateId || null, createdAt: l.createdAt, ...extra
  })
  const wins = leads
    .filter(l => l.status === 'won' && inRange(l.convertedAt))
    .sort((a, b) => (Number(b.valueEstimate) || 0) - (Number(a.valueEstimate) || 0))
    .slice(0, 8)
    .map(l => shape(l, { convertedAt: l.convertedAt, daysToWin: Math.round(daysBetween(l.createdAt, l.convertedAt) ?? 0) }))
  const now = Date.now()
  const openDeals = leads
    .filter(l => (l.status === 'open' || !l.status) && (Number(l.valueEstimate) || 0) > 0)
    .sort((a, b) => (Number(b.valueEstimate) || 0) - (Number(a.valueEstimate) || 0))
    .slice(0, 8)
    .map(l => shape(l, { ageDays: Math.max(0, Math.round((now - new Date(l.createdAt).getTime()) / 86400000)) }))
  const losses = leads
    .filter(l => l.status === 'lost' && inRange(l.updatedAt || l.createdAt))
    .sort((a, b) => (Number(b.valueEstimate) || 0) - (Number(a.valueEstimate) || 0))
    .slice(0, 8)
    .map(l => shape(l))
  return { wins, openDeals, losses }
}

// Which day of the week the leads arrive on, and which day's leads actually
// convert — the two are rarely the same, and staffing follows the first.
export function reportWeekdayPattern(all, start, end) {
  const inRange = inRangeFn(start, end)
  const leads = all.filter(l => inRange(l.createdAt))
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const rows = names.map(label => ({ label, leads: 0, won: 0 }))
  for (const l of leads) {
    const d = new Date(l.createdAt)
    if (isNaN(d.getTime())) continue
    const row = rows[d.getDay()]
    row.leads++
    if (l.status === 'won') row.won++
  }
  return rows.map(r => ({ ...r, winRate: r.leads ? Math.round((r.won / r.leads) * 100) : 0 }))
}

// Follow-up discipline for the window, scoped the same way as everything
// else (the existing periodFollowUpAnalytics is location-only).
export function reportFollowUpHealth(leads, start, end) {
  const inRange = inRangeFn(start, end)
  const today = new Date().toISOString().slice(0, 10)
  let logged = 0, done = 0, missed = 0, overdue = 0
  const byLead = []
  for (const l of leads) {
    let leadLogged = 0
    for (const f of l.followUps || []) {
      if (!f.date || f.date === '-') continue
      if (inRange(f.date)) {
        logged++; leadLogged++
        if (f.done) done++; else missed++
      }
      if (f.done === false && f.date < today && (l.status === 'open' || !l.status)) overdue++
    }
    if (inRange(l.createdAt)) byLead.push(leadLogged)
  }
  return {
    logged, done, missed, overdue,
    completionRate: logged ? Math.round((done / logged) * 100) : 0,
    avgPerLead: byLead.length ? round1(byLead.reduce((s, v) => s + v, 0) / byLead.length) : 0,
    leadsWithNoFollowUp: byLead.filter(v => v === 0).length
  }
}

// Plain-language readings of the numbers above. Generated server-side so the
// same sentence appears in the UI, the CSV and the PDF instead of three
// slightly different hand-rolled versions.
export function reportInsights({ comparisons, sourceRoi, rankings, velocity, ageing, followUp }) {
  const out = []
  const pct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null)
  const cur = comparisons.current, prev = comparisons.previousPeriod, yoy = comparisons.yoy

  const leadDelta = pct(cur.leadsReceived, prev.leadsReceived)
  if (leadDelta !== null && Math.abs(leadDelta) >= 5) {
    out.push({
      tone: leadDelta > 0 ? 'good' : 'warning',
      title: `Lead volume ${leadDelta > 0 ? 'up' : 'down'} ${Math.abs(leadDelta)}% vs the previous period`,
      detail: `${cur.leadsReceived} received against ${prev.leadsReceived}. Same period last year: ${yoy.leadsReceived}.`
    })
  }
  const convDelta = cur.conversionRate - prev.conversionRate
  if (Math.abs(convDelta) >= 2) {
    out.push({
      tone: convDelta > 0 ? 'good' : 'serious',
      title: `Conversion ${convDelta > 0 ? 'improved' : 'slipped'} ${Math.abs(convDelta)} points`,
      detail: `${cur.conversionRate}% this period against ${prev.conversionRate}% previously, on ${cur.converted} wins.`
    })
  }
  const best = sourceRoi.filter(s => s.leads >= 3).sort((a, b) => b.revenuePerLead - a.revenuePerLead)[0]
  const worst = sourceRoi.filter(s => s.leads >= 5).sort((a, b) => a.winRate - b.winRate)[0]
  if (best) out.push({ tone: 'good', title: `${best.source} returns the most per lead`, detail: `${money0(best.revenuePerLead)} per lead across ${best.leads} leads, ${best.winRate}% win rate.` })
  if (worst && worst.winRate < (cur.conversionRate || 0)) {
    out.push({ tone: 'warning', title: `${worst.source} converts below the period average`, detail: `${worst.winRate}% win rate on ${worst.leads} leads against a ${cur.conversionRate}% average.` })
  }
  if (velocity.untouchedLeads > 0) {
    out.push({
      tone: velocity.untouchedLeads > velocity.touchedLeads ? 'critical' : 'warning',
      title: `${velocity.untouchedLeads} lead${velocity.untouchedLeads === 1 ? '' : 's'} received no follow-up at all`,
      detail: `Median first touch on the rest was ${velocity.medianDaysToFirstTouch} day${velocity.medianDaysToFirstTouch === 1 ? '' : 's'}.`
    })
  }
  const stale = ageing.buckets.find(b => b.key === '90+')
  if (stale && stale.count) {
    out.push({ tone: 'serious', title: `${stale.count} open leads are older than 90 days`, detail: `${money0(stale.value)} of pipeline value sitting in the oldest bucket.` })
  }
  if (followUp.overdue) {
    out.push({ tone: 'warning', title: `${followUp.overdue} follow-ups are past due`, detail: `${followUp.completionRate}% of follow-ups scheduled in this period were completed.` })
  }
  const climber = rankings.filter(r => r.rankDelta !== null && r.rankDelta > 0).sort((a, b) => b.rankDelta - a.rankDelta)[0]
  if (climber) out.push({ tone: 'good', title: `${climber.name} climbed ${climber.rankDelta} place${climber.rankDelta === 1 ? '' : 's'}`, detail: `Now #${climber.rank} on revenue with ${money0(climber.revenue)} from ${climber.won} wins.` })
  return out
}

const money0 = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
