// Lightweight rule-based intelligence layer.
// Generates lead scores, sentiment signals, insights and next-best-action
// suggestions. Pure heuristics — no external LLM required.
import { statusGroupOf } from './leadStatus.js'

const POSITIVE = [
  'interested', 'keen', 'love', 'loved', 'confirm', 'confirmed', 'ready', 'enroll',
  'enrollment', 'excited', 'booked', 'book', 'yes', 'great', 'payment link',
  'start next month', 'annual plan', 'buddy', 'tour', 'brochure', 'wants to start',
  'will confirm', 'warm', 'trial class this week'
]
const NEGATIVE = [
  'not interested', 'no response', 'not answering', 'different studio',
  'budget constraints', "don't want", 'dont want', 'revisit later',
  'won\'t', 'wont', 'declined', 'decided to go', 'no further', 'lost'
]
const NEUTRAL = ['will get back', 'get back', 'let us know', 'next week', 'schedule shared', 'will call', 'keep well', 'not keeping well']

// Keyed by statusGroup (server/leadStatus.js), not the raw `stage` string —
// there are 30+ stage strings but only 9 funnel groups, and this used to be
// keyed by a fabricated stage set ('New Lead', 'Trial Booked', ...) that
// never matched any real lead.stage value, silently falling through to the
// `|| 8` default for every lead.
const STATUS_GROUP_WEIGHT = {
  'Pre-Trial': 10, 'Unresponsive': 4, 'Trial Scheduled': 26, 'Trial Completed': 32,
  'Post-Trial Follow-up': 40, 'Disqualified': 2, 'Not Interested': 2, 'Lost': 4, 'Won': 96
}
const SOURCE_WEIGHT = {
  'Client Referral': 12, 'Walk-in': 10, Instagram: 8, 'Website Form': 7,
  'Google Ads': 6, 'Marketing Event': 9, Facebook: 5, 'WhatsApp Campaign': 6
}

function daysBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

function textOf(lead) {
  const parts = [lead.remarks || '']
  for (const fu of lead.followUps || []) parts.push(fu.comments || '')
  return parts.join(' \u2E31 ').toLowerCase()
}

function sentimentOf(lead) {
  const text = textOf(lead)
  let pos = 0, neg = 0, neu = 0
  for (const k of POSITIVE) if (text.includes(k)) pos++
  for (const k of NEGATIVE) if (text.includes(k)) neg++
  for (const k of NEUTRAL) if (text.includes(k)) neu++
  if (pos > neg) return 'positive'
  if (neg > pos) return 'negative'
  if (neu > 0) return 'neutral'

  // Do not leave every sparse/imported lead as "unknown". When there is no
  // explicit member-language signal, use lifecycle outcome as a conservative
  // fallback and otherwise report neutral rather than inventing emotion.
  const group = statusGroupOf(lead.stage)
  if (lead.status === 'won' || group === 'Won') return 'positive'
  if (lead.status === 'lost' || ['Lost', 'Not Interested', 'Disqualified'].includes(group)) return 'negative'
  return 'neutral'
}

function scoreLead(lead, db) {
  let score = 35
  score += STATUS_GROUP_WEIGHT[statusGroupOf(lead.stage)] || 8
  score += SOURCE_WEIGHT[lead.sourceName] || 4
  if (lead.memberId) score += 5

  const fups = lead.followUps || []
  score += Math.min(fups.length * 3, 12)

  if (fups.length) {
    const lastDate = fups[fups.length - 1].date
    const d = daysBetween(lastDate, new Date())
    if (d <= 3) score += 6
    else if (d <= 7) score += 4
    else if (d <= 14) score += 2
    else if (d > 21) score -= 3
  }

  const senti = sentimentOf(lead)
  if (senti === 'positive') score += 8
  if (senti === 'negative') score -= 6

  if (lead.stage === 'Won') score = Math.max(score, 92)
  if (lead.stage === 'Lost') score = Math.min(score, 18)
  return Math.max(0, Math.min(100, Math.round(score)))
}

function nextBestAction(lead) {
  const senti = sentimentOf(lead)
  if (lead.status === 'won') return { label: 'Onboarding', text: 'Welcome the new member, book their first class and ask for referrals.' }
  if (lead.status === 'lost') return { label: 'Nurture', text: 'Log the reason, add to the reactivation list and revisit in 90 days.' }
  if (senti === 'negative') return { label: 'Re-engage', text: 'Try a different angle (new schedule, promo) or park in the nurture list.' }

  const byStatusGroup = {
    'Pre-Trial': { label: 'First outreach', text: 'Contact within 24 hours — call first, then follow up on WhatsApp with a studio intro.' },
    'Unresponsive': { label: 'Re-attempt contact', text: 'Try a different channel/time — call if WhatsApp was tried, or vice versa.' },
    'Trial Scheduled': { label: 'Confirm trial', text: 'Send a reminder and waiver link 24 hours before the trial class.' },
    'Trial Completed': { label: 'Close after trial', text: 'Ask for feedback, share membership plans and propose a start date.' },
    'Post-Trial Follow-up': { label: 'Value nudge', text: 'Send a personalised nudge (new schedule, limited offer) and request a call.' },
    'Disqualified': { label: 'Log and park', text: 'Confirm the blocker (location/language/timing) and park — revisit only if circumstances change.' },
    'Not Interested': { label: 'Nurture', text: 'Log the reason, add to the reactivation list and revisit in 90 days.' }
  }
  return byStatusGroup[statusGroupOf(lead.stage)] || { label: 'Reach out', text: 'Touch base and advance the conversation toward a trial class.' }
}

function insightsFor(lead, score) {
  const out = []
  const days = lead.createdAt ? daysBetween(lead.createdAt, new Date()) : 0
  const fups = lead.followUps || []

  if (lead.sourceName === 'Client Referral') out.push('Referred by an existing customer — typically 2x close rate.')
  else if (lead.sourceName === 'Walk-in') out.push('Walk-in leads convert well — capture intent before they cool off.')
  else if (lead.sourceName === 'Instagram' || lead.sourceName === 'Facebook') out.push('Social lead — warm up quickly while brand interest is fresh.')

  if (lead.memberId) out.push('Already present in Momence — pull sales & class history to personalise the pitch.')

  if (fups.length) {
    const last = daysBetween(fups[fups.length - 1].date, new Date())
    if (last > 14) out.push(`No meaningful contact for ${last} days — risk of going cold.`)
    else if (last <= 3) out.push('Replied/contacted within the last 3 days — momentum is good.')
  } else if (days > 21) {
    out.push(`Assigned ${days} days ago with no follow-up logged yet — needs attention.`)
  }

  const senti = sentimentOf(lead)
  if (senti === 'positive') out.push('Follow-up language is positive — strong buying signals.')
  if (senti === 'negative') out.push('Recent communication signals low interest — consider a fresh approach.')

  if (score >= 70) out.push('High-scoring lead — prioritise in today\u2019s queue.')
  if (score >= 50 && score < 70) out.push('Moderate intent — a well-timed nudge can move this forward.')

  const trialGroups = ['Trial Scheduled', 'Trial Completed']
  if (trialGroups.includes(statusGroupOf(lead.stage)) && !lead.memberId) out.push('Create the Momence member record now to map future sales history.')

  if (lead.status === 'won') out.push('Won — referrer credit and a Google review ask can generate more referrals.')
  return out.slice(0, 5)
}

function bestContactTime(lead) {
  const senti = sentimentOf(lead)
  const engaged = (lead.followUps || []).length
  if (engaged >= 3) return 'Evening (5\u20138pm) — most engaged with this pattern'
  if (senti === 'positive') return 'Morning (9\u201311am) — high responsiveness signal'
  return 'Midday (12\u20132pm) — try a WhatsApp message first'
}

const CHANNELS = ['call', 'whatsapp', 'email', 'sms', 'in_person']
const CHANNEL_LABEL = { call: 'Call', whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS' }

// Build per-channel outreach summary for the lead.
function channelOutreach(lead) {
  const out = {}
  const channels = [...new Set([...CHANNELS, ...(lead.followUps || []).map(followUp => followUp.channel).filter(Boolean)])]
  for (const ch of channels) {
    out[ch] = { filled: false, date: null, comments: null, pending: null }
  }
  const fups = (lead.followUps || []).filter(f => f.comments && f.comments !== '-')
  for (const f of fups) {
    const ch = CHANNELS.includes(f.channel) ? f.channel : null
    if (!ch) continue
    const cur = out[ch]
    if (!cur.date || f.date > cur.date) {
      cur.filled = true
      cur.date = f.date
      cur.comments = f.comments
      cur.pending = f.done === false ? f.date : null
    }
  }
  return out
}

function missedFollowUps(lead) {
  const today = new Date().toISOString().slice(0, 10)
  if (lead.status !== 'open') return []
  return (lead.followUps || []).filter(f => f.date && f.date !== '-' && f.done === false && f.date < today)
}

function lastOutreachDays(lead) {
  const fups = (lead.followUps || []).filter(f => f.comments && f.comments !== '-')
  if (!fups.length) return lead.createdAt ? Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 86400000) : 99
  const last = fups.map(f => f.date).sort().slice(-1)[0]
  return Math.max(0, Math.round((Date.now() - new Date(last).getTime()) / 86400000))
}

// Per-followup cadence: how many days a lead may sit idle before the Nth
// follow-up is considered overdue, based on how many real touches already
// happened. `steps` is db.settings.cadence.steps, one entry per followup 1-4.
function cadenceState(lead, steps) {
  if (lead.status !== 'open') return { stepIndex: null, dueInDays: null, overdueDays: 0 }
  const touchCount = (lead.followUps || []).filter(f => f.comments && f.comments !== '-').length
  const list = Array.isArray(steps) && steps.length ? steps : [{ days: 7 }]
  const step = list[Math.min(touchCount, list.length - 1)] || { days: 7 }
  const idle = lastOutreachDays(lead)
  const overdueDays = Math.max(0, idle - (step.days || 7))
  return { stepIndex: touchCount + 1, dueInDays: (step.days || 7) - idle, overdueDays }
}

const RULE_OPERATORS = {
  eq: (a, b) => String(a) === String(b),
  neq: (a, b) => String(a) !== String(b),
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  contains: (a, b) => String(a || '').toLowerCase().includes(String(b || '').toLowerCase())
}

function ruleFieldValue(field, lead, score) {
  switch (field) {
    case 'stage': return lead.stage || ''
    case 'status': return lead.status || ''
    case 'sourceName': return lead.sourceName || ''
    case 'locationId': return lead.locationId || ''
    case 'associateId': return lead.associateId || ''
    case 'score': return score
    case 'valueEstimate': return lead.valueEstimate || 0
    case 'followUpCount': return (lead.followUps || []).length
    case 'daysSinceCreated': return lead.createdAt ? daysBetween(lead.createdAt, new Date()) : 0
    case 'daysSinceLastContact': return lastOutreachDays(lead)
    default: return undefined
  }
}

// Evaluate db.settings.cadence.rules against a lead. Each rule's conditions
// are AND-joined. Returns the flags for every rule that matched.
function evaluateRules(lead, db, score) {
  const rules = db?.settings?.cadence?.rules || []
  const flags = []
  for (const rule of rules) {
    if (!rule || rule.active === false || !Array.isArray(rule.conditions) || !rule.conditions.length) continue
    const matched = rule.conditions.every(c => {
      const op = RULE_OPERATORS[c.operator]
      if (!op) return false
      const value = ruleFieldValue(c.field, lead, score)
      if (value === undefined) return false
      return op(value, c.value)
    })
    if (matched) flags.push({ id: rule.id, name: rule.name || 'Rule', label: rule.flagLabel || rule.name || 'Flagged', color: rule.flagColor || '#f59e0b' })
  }
  return flags
}

// AI: generate ready-to-send follow-up message drafts per channel.
export function suggestFollowups(lead) {
  const senti = sentimentOf(lead)
  const first = (lead.fullName || 'there').split(' ')[0]
  const center = lead.center || 'your studio'
  const stage = lead.stage || 'New Lead'
  const missed = missedFollowUps(lead)
  const lastDays = lastOutreachDays(lead)
  const out = []

  if (lead.status === 'won') {
    out.push({ channel: 'whatsapp', label: 'WhatsApp', text: `Hi ${first}! Welcome to Physique 57 🎉 Shall I book your first class at ${center} and set you up with an instructor?` })
    out.push({ channel: 'email', label: 'Email', text: `Welcome to Physique 57, ${first}! Your membership is active. Reply here to schedule your first session at ${center} and share referrals.` })
    return out
  }
  if (lead.status === 'lost') {
    out.push({ channel: 'whatsapp', label: 'WhatsApp', text: `Hi ${first}, thanks for your time. If anything changes, we'd love to host you at ${center} — we run specials every few months.` })
    return out
  }

  if (missed.length) {
    out.push({ channel: 'whatsapp', label: 'WhatsApp', text: `Hi ${first}, I missed connecting with you earlier — still keen on a trial at ${center}? I can hold a slot for you this week.` })
    out.push({ channel: 'call', label: 'Call', text: `Call ${first} — missed follow-up by ${daysBetween(missed[0].date, new Date().toISOString().slice(0, 10))} days. Best time ${bestContactTime(lead)}.` })
  }

  const byStatusGroup = {
    'Pre-Trial': [
      { channel: 'call', label: 'Call', text: `Call ${first} — introduce the ${center} studio and lock a trial slot.` },
      { channel: 'whatsapp', label: 'WhatsApp', text: `Hi ${first}! 👋 Welcome to Physique 57. We'd love to host you for a free trial at ${center} — does this week work?` }
    ],
    'Unresponsive': [
      { channel: 'whatsapp', label: 'WhatsApp', text: `Hi ${first}, trying to reach you about a free trial at ${center} — what time works this week?` },
      { channel: 'sms', label: 'SMS', text: `Trial slots at ${center}: Tue 10:30a, Thu 7p, Sat 11a. Which works? — Physique 57` }
    ],
    'Trial Scheduled': [
      { channel: 'whatsapp', label: 'WhatsApp', text: `Reminder ${first}! Your trial class at ${center} is coming up. Here's the waiver link — arrive 10 min early. Can't wait!` },
      { channel: 'call', label: 'Call', text: `Call ${first} — confirm trial attendance and share waiver link 24h before.` }
    ],
    'Trial Completed': [
      { channel: 'whatsapp', label: 'WhatsApp', text: `Hi ${first}, hope you loved the class! I can share membership plans for ${center} — would you like the monthly or annual options?` },
      { channel: 'email', label: 'Email', text: `Thanks for trying us out, ${first}! Attached are membership options for ${center}. Happy to answer any questions.` }
    ],
    'Post-Trial Follow-up': [
      { channel: 'whatsapp', label: 'WhatsApp', text: `Hi ${first}, a quick nudge — we have a limited-time offer on memberships at ${center}. Interested in details?` },
      { channel: 'call', label: 'Call', text: `Call ${first} — value nudge on membership, address any pricing objections.` }
    ]
  }

  const suggestions = byStatusGroup[statusGroupOf(stage)] || [{ channel: 'whatsapp', label: 'WhatsApp', text: `Hi ${first}, touching base about Physique 57 at ${center} — happy to help with anything!` }]
  for (const s of suggestions) {
    if (!out.some(o => o.channel === s.channel && o.text === s.text)) out.push(s)
  }

  if (lastDays > 7) {
    out.push({ channel: 'sms', label: 'SMS', text: `Hi ${first} — haven't heard back in a while. Still interested in a free trial at ${center}? Reply STOP to opt out.` })
  }
  if (senti === 'positive' && !out.some(o => o.channel === 'email')) {
    out.push({ channel: 'email', label: 'Email', text: `Great to hear you're keen, ${first}! Here's a quick look at membership options at ${center} — we can start you as soon as this week.` })
  }
  return out.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Cheap projection
//
// enrichLead builds summary prose, an insights list, per-channel message
// drafts and a fresh ISO timestamp for every lead. Filtering and sorting only
// ever look at four fields, so calling the full version there meant generating
// paragraphs of English for 24,031 leads to compare one number — 1.38s per
// filter pass, and ~40s for a sort (two full enrichments per comparison).
//
// projectLead computes exactly those four fields. enrichLead is built on top
// of it so the two can't drift: whatever `status`/`statusGroup`/`score`/`risk`
// a filter sees is the same value the row itself reports.
// ---------------------------------------------------------------------------
export function projectLead(lead, db) {
  const score = scoreLead(lead, db)
  const risk = lead.status === 'open' ? (score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cold') : lead.status

  const rawStatusGroup = statusGroupOf(lead.stage)
  const evidence = lead.momenceEvidence || {}
  const statusGroup = evidence.membershipSold
    ? 'Membership Sold'
    : evidence.trialCompleted
      ? 'Trial Completed'
      : rawStatusGroup === 'Won' || rawStatusGroup === 'Trial Completed'
        ? 'Pre-Trial'
        : rawStatusGroup
  const status = evidence.membershipSold ? 'won' : (lead.status === 'won' ? 'open' : lead.status)

  return { score, risk, status, statusGroup, evidence }
}

// Everything the alert builder reads, and nothing else. /api/alerts walks
// every open lead (16,214 of them here) on a 60s poll from every open tab; on
// the full enrichment that was ~940ms of blocked event loop per call, almost
// all of it spent generating prose and per-channel message drafts that an
// alert never shows.
export function projectAlertFacts(lead, db) {
  const base = projectLead(lead, db)
  const missed = missedFollowUps(lead)
  return {
    ...base,
    ai: { score: base.score, risk: base.risk },
    fu: {
      missedCount: missed.length,
      missedDates: missed.map(m => m.date),
      lastOutreachDays: lastOutreachDays(lead),
      outreach: channelOutreach(lead),
      cadence: cadenceState(lead, db?.settings?.cadence?.steps)
    },
    flags: evaluateRules(lead, db, base.score)
  }
}

export function enrichLead(lead, db) {
  // Built on the projections above so a filter, an alert and the row itself
  // can never disagree about a lead's score, status or flags.
  const facts = projectAlertFacts(lead, db)
  const { score, risk, status: verifiedOutcome, statusGroup: verifiedStatusGroup, evidence, fu, flags } = facts
  const senti = sentimentOf(lead)
  const action = nextBestAction(lead)
  const insights = insightsFor(lead, score)

  let summary
  if (lead.status === 'won') {
    summary = `${lead.fullName} closed with ${lead.center}. Member record ${lead.memberId ? 'linked (' + lead.memberId + ')' : 'not yet created'}. Valuable source: ${lead.sourceName}.`
  } else if (lead.status === 'lost') {
    summary = `Opportunity lost at ${lead.stage} stage. Flagged for future reactivation via ${lead.sourceName}.`
  } else {
    summary = `${lead.fullName} is in "${lead.stage}" at ${lead.center}. ` +
      `Sentiment reads ${senti}. ${insights[0] ? insights[0] : 'A steady follow-up cadence is recommended.'}`
  }

  return {
    ...lead,
    status: verifiedOutcome,
    statusGroup: verifiedStatusGroup,
    trialDate: evidence.trialDate || null,
    firstPurchaseDate: evidence.firstPurchaseDate || null,
    gpt: lead.aiGpt || null,
    fu,
    flags,
    ai: {
      score,
      risk,
      sentiment: senti,
      nextAction: action,
      insights,
      bestContactTime: bestContactTime(lead),
      summary,
      followupSuggestions: suggestFollowups(lead),
      generatedAt: new Date().toISOString()
    }
  }
}

export function enrichAll(leads, db) {
  return leads.map(l => enrichLead(l, db))
}
