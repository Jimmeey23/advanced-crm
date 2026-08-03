import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import { init, load, save, saveNow, uid, nowIso, reset, markDirty, markDeleted, onRemoteChange } from './db.js'
import { enrichAll, enrichLead } from './ai.js'
import { assignLead } from './roundRobin.js'
import * as momence from './momence.js'
import * as gpt from './gpt.js'
import * as respondio from './respondio.js'
import * as mailer from './mailer.js'
import * as supabase from './supabaseStore.js'
import { runReminderDigest, startReminderScheduler } from './reminders.js'
import { parseCsv, autoMap, normalizeStage, normalizeStatus } from './csv.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load USER_* secrets from a local .env file if present (never overrides real env).
try {
  const envFile = path.join(__dirname, '..', '.env')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  }
} catch (e) { /* ignore */ }

const app = express()
app.use(express.json({ limit: '200mb' }))
app.use(express.urlencoded({ extended: true, limit: '200mb' }))

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

let db = null

function log(type, text, leadId = null) {
  db.activity.unshift({ id: uid('act'), ts: nowIso(), type, text, leadId })
  if (db.activity.length > 300) db.activity.length = 300
  save()
}

const openStatuses = ['open', 'won', 'lost']

// ---------- helpers ----------

function leadById(id) {
  return db.leads.find(l => l.id === id)
}

function safePatch(lead, body) {
  const allowed = ['fullName', 'phone', 'email', 'stage', 'status', 'associateId', 'locationId',
    'sourceName', 'sourceId', 'remarks', 'classType', 'center', 'channel', 'memberId', 'valueEstimate', 'convertedAt']
  for (const key of allowed) {
    if (key in body) lead[key] = body[key]
  }
  if ('stage' in body && body.stage) {
    const s = String(body.stage).trim()
    if (s.toLowerCase() === 'won') { lead.status = 'won'; if (!lead.convertedAt) lead.convertedAt = new Date().toISOString().slice(0, 10) }
    else if (s.toLowerCase() === 'lost') lead.status = 'lost'
    else lead.status = 'open'
  }
  if ('fullName' in body) lead.fullName = String(body.fullName || '').trim()
  lead.updatedAt = nowIso()
  save()
}

function computeFollowUpState(lead) {
  const today = new Date().toISOString().slice(0, 10)
  const open = lead.status === 'open'
  const pending = (lead.followUps || []).filter(f => f.date && f.date !== '-' && !f.done)
  const next = pending.sort((a, b) => a.date.localeCompare(b.date))[0]
  if (!next || !open) return { due: null, overdue: null, nextDate: null }
  const overdue = next.date < today ? (new Date(today).getTime() - new Date(next.date).getTime()) / 86400000 : 0
  return {
    due: next.date === today ? 'today' : null,
    overdue: next.date < today ? Math.round(overdue) : null,
    nextDate: next.date
  }
}

function buildAlerts() {
  const today = new Date().toISOString().slice(0, 10)
  const alerts = []
  const cad = db.settings.cadence || { outreachDays: 7 }
  const notif = db.settings.notifications || {}
  for (const lead of db.leads) {
    if (lead.status !== 'open') continue
    const e = enrichLead(lead, db)
    const fu = computeFollowUpState(lead)

    if (notif.followUpAlerts !== false) {
      if (fu.overdue && fu.overdue <= 90) {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'high',
          kind: 'missed_followup', title: `Follow-up missed by ${fu.overdue}d`, detail: `Next follow-up was due ${fu.nextDate}. ${e.fu.missedCount} task${e.fu.missedCount === 1 ? '' : 's'} pending.`,
          score: e.ai.score
        })
      } else if (fu.due === 'today') {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'medium',
          kind: 'today', title: 'Follow-up due today', detail: `Scheduled contact for ${fu.nextDate}.`,
          score: e.ai.score
        })
      }
    }

    if (notif.missedOutreachAlerts !== false) {
      const idleDays = e.fu.lastOutreachDays
      const hasSteps = Array.isArray(cad.steps) && cad.steps.length
      const threshold = hasSteps ? null : (cad.outreachDays || 7)
      const overdueDays = hasSteps ? e.fu.cadence.overdueDays : (idleDays > threshold ? idleDays : 0)
      if (overdueDays > 0 && idleDays <= 60 && lead.createdAt) {
        const age = Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 86400000)
        if (!hasSteps && age <= threshold) { /* skip: age gate for the flat-threshold path only */ }
        else {
          alerts.push({
            id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'medium',
            kind: 'missed_outreach',
            title: hasSteps ? `Follow-up #${e.fu.cadence.stepIndex} cadence overdue` : `Missed outreach — ${idleDays}d silent`,
            detail: `No contact logged in ${idleDays} days. AI has a ready WhatsApp draft.`,
            score: e.ai.score
          })
        }
      }
    }

    if (notif.customRuleAlerts !== false) {
      for (const flag of e.flags || []) {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'medium',
          kind: 'custom_rule', title: flag.label, detail: `Custom rule "${flag.name}" matched.`,
          color: flag.color, score: e.ai.score
        })
      }
    }

    if (!lead.associateId) {
      alerts.push({
        id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'high',
        kind: 'unassigned', title: 'Lead awaiting assignment', detail: 'Round-robin can assign instantly.',
        score: e.ai.score
      })
    }

    if (notif.highValueAlerts !== false && e.ai.score >= 70 && lead.lastActivityAt) {
      const idle = (Date.now() - new Date(lead.lastActivityAt).getTime()) / 86400000
      if (idle > 3) {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'high',
          kind: 'high_value', title: 'High-value lead idle', detail: `No activity for ${Math.round(idle)} days (score ${e.ai.score}).`,
          score: e.ai.score
        })
      }
    }

    if (notif.leadAgeAlerts !== false && (lead.followUps || []).length === 0 && lead.createdAt) {
      const age = (Date.now() - new Date(lead.createdAt).getTime()) / 86400000
      if (age > 7) {
        alerts.push({
          id: uid('alt'), leadId: lead.id, leadName: lead.fullName, level: 'medium',
          kind: 'stale', title: 'Lead cold — no follow-ups', detail: `Created ${Math.round(age)}d ago with zero logged follow-ups.`,
          score: e.ai.score
        })
      }
    }
  }
  const order = { high: 0, medium: 1, low: 2 }
  return alerts.sort((a, b) => order[a.level] - order[b.level] || (b.score || 0) - (a.score || 0)).slice(0, 150)
}

// ---------- bootstrap ----------

app.get('/api/bootstrap', (req, res) => {
  res.json({
    settings: db.settings,
    locations: db.locations,
    associates: db.associates,
    stages: db.stages,
    sources: db.sources,
    channels: db.channels,
    classTypes: db.classTypes,
    integrations: {
      supabase: supabase.isEnabled(),
      gpt: gpt.isEnabled(db),
      gptModel: gpt.modelName(db),
      respondio: respondio.isConfigured(db),
      mailtrap: mailer.isConfigured(db),
      momence: momence.isConfigured(db)
    }
  })
})

// ---------- alerts ----------

app.get('/api/alerts', (req, res) => res.json(buildAlerts()))

// ---------- locations ----------

app.get('/api/locations', (req, res) => res.json(db.locations))
app.put('/api/locations', (req, res) => {
  if (Array.isArray(req.body)) db.locations = req.body.map(l => ({ ...l }))
  save()
  res.json(db.locations)
})
app.post('/api/locations', (req, res) => {
  const loc = { id: uid('loc'), active: true, ...req.body }
  db.locations.push(loc)
  save()
  log('location', `Added location ${loc.name}`)
  res.status(201).json(loc)
})
app.patch('/api/locations/:id', (req, res) => {
  const loc = db.locations.find(l => l.id === req.params.id)
  if (!loc) return res.status(404).json({ error: 'Location not found' })
  Object.assign(loc, req.body)
  save()
  res.json(loc)
})

// ---------- associates ----------

app.get('/api/associates', (req, res) => res.json(db.associates))
app.put('/api/associates', (req, res) => {
  if (Array.isArray(req.body)) db.associates = req.body.map(a => ({ ...a }))
  save()
  res.json(db.associates)
})
app.post('/api/associates', (req, res) => {
  const asn = { id: uid('asn'), active: true, order: db.associates.length, ...req.body }
  db.associates.push(asn)
  save()
  log('associate', `Added associate ${asn.name}`)
  res.status(201).json(asn)
})
app.patch('/api/associates/:id', (req, res) => {
  const asn = db.associates.find(a => a.id === req.params.id)
  if (!asn) return res.status(404).json({ error: 'Associate not found' })
  Object.assign(asn, req.body)
  save()
  res.json(asn)
})

// ---------- leads ----------

function applyFilters(list, q) {
  const now = Date.now()
  let out = list
  if (q.locationId) out = out.filter(l => l.locationId === q.locationId)
  if (q.associateId) out = out.filter(l => l.associateId === q.associateId)
  if (q.stage) out = out.filter(l => l.stage === q.stage)
  if (q.status) out = out.filter(l => l.status === q.status)
  if (q.sourceName) out = out.filter(l => l.sourceName === q.sourceName)
  if (q.channel) out = out.filter(l => l.channel === q.channel)
  if (q.classType) out = out.filter(l => l.classType === q.classType)
  if (q.risk) out = out.filter(l => {
    const e = enrichLead(l, db)
    return e.ai.risk === q.risk
  })
  if (q.minScore !== undefined || q.maxScore !== undefined) {
    out = out.filter(l => {
      const s = enrichLead(l, db).ai.score
      if (q.minScore !== undefined && s < Number(q.minScore)) return false
      if (q.maxScore !== undefined && s > Number(q.maxScore)) return false
      return true
    })
  }
  if (q.search) {
    const s = String(q.search).toLowerCase()
    out = out.filter(l =>
      l.fullName.toLowerCase().includes(s) ||
      String(l.phone || '').includes(s) ||
      String(l.email || '').toLowerCase().includes(s) ||
      String(l.remarks || '').toLowerCase().includes(s)
    )
  }
  if (q.dateFrom || q.dateTo) {
    out = out.filter(l => {
      const t = new Date(l.createdAt).getTime()
      if (q.dateFrom && t < new Date(q.dateFrom).getTime()) return false
      if (q.dateTo && t > new Date(q.dateTo).getTime() + 86400000) return false
      return true
    })
  }
  if (q.createdWithinDays) {
    out = out.filter(l => now - new Date(l.createdAt).getTime() < Number(q.createdWithinDays) * 86400000)
  }
  return out
}

app.get('/api/leads', (req, res) => {
  let list = [...db.leads]
  list = applyFilters(list, req.query)

  const sortBy = req.query.sortBy || 'createdAt'
  const dir = req.query.sortDir === 'asc' ? 1 : -1
  if (sortBy === 'ai.score' || sortBy === 'score') {
    list.sort((a, b) => {
      const va = enrichLead(a, db).ai.score
      const vb = enrichLead(b, db).ai.score
      return va < vb ? -dir : va > vb ? dir : 0
    })
  } else {
    list.sort((a, b) => {
      const va = a[sortBy] || ''
      const vb = b[sortBy] || ''
      return va < vb ? -dir : va > vb ? dir : 0
    })
  }

  const page = Math.max(0, Number(req.query.page) || 0)
  const pageSize = Math.min(5000, Number(req.query.pageSize) || 50)
  const total = list.length
  const sliced = list.slice(page * pageSize, page * pageSize + pageSize)

  res.json({
    items: enrichAll(sliced, db),
    total,
    page,
    pageSize
  })
})

app.get('/api/leads/:id', (req, res) => {
  const lead = leadById(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  res.json(enrichLead(lead, db))
})

function createLeadFrom(payload) {
  const lead = {
    id: uid('lead'),
    fullName: (payload.fullName || payload.name || 'Unnamed Lead').trim(),
    phone: payload.phone || '',
    email: payload.email || '-',
    createdAt: payload.createdAt ? new Date(payload.createdAt).toISOString() : nowIso(),
    sourceId: payload.sourceId || null,
    sourceName: payload.sourceName || 'Website Form',
    memberId: payload.memberId || null,
    convertedAt: payload.convertedAt || null,
    stage: normalizeStage(payload.stage, db.stages) || db.stages[0],
    status: normalizeStatus(payload.stage, payload.status),
    associateId: payload.associateId || null,
    locationId: payload.locationId || db.locations[0]?.id || null,
    center: payload.center || null,
    classType: payload.classType || null,
    hostId: payload.hostId || null,
    remarks: payload.remarks || '',
    channel: payload.channel || 'In-Studio',
    period: payload.period || 'All Time',
    valueEstimate: payload.valueEstimate ? Number(payload.valueEstimate) : null,
    followUps: payload.followUps || [],
    lastActivityAt: nowIso(),
    createdAtByImport: payload._imported || false
  }
  if (lead.status === 'won') { lead.convertedAt = lead.convertedAt || new Date().toISOString().slice(0, 10) }
  if (payload.associateName) {
    const asn = db.associates.find(a => a.name.toLowerCase() === String(payload.associateName).toLowerCase())
    if (asn) { lead.associateId = asn.id; lead.locationId = asn.locationId }
  }
  return lead
}

app.post('/api/leads', (req, res) => {
  const lead = createLeadFrom(req.body)
  const settings = db.settings.roundRobin
  if (!lead.associateId && settings.enabled) assignLead(db, lead)
  db.leads.push(lead)
  markDirty(lead.id)
  save()
  log('lead', `Created lead ${lead.fullName}`, lead.id)
  res.status(201).json(enrichLead(lead, db))
})

app.patch('/api/leads/:id', (req, res) => {
  const lead = leadById(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  const before = lead.stage
  safePatch(lead, req.body)
  markDirty(lead.id)
  if (req.body.associateId) log('assign', `Assigned ${lead.fullName}`, lead.id)
  if (req.body.stage && req.body.stage !== before) log('stage', `${lead.fullName} moved ${before} → ${req.body.stage}`, lead.id)
  res.json(enrichLead(lead, db))
})

app.patch('/api/leads/bulk', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
  const patch = req.body?.patch || {}
  let updated = 0
  for (const id of ids) {
    const lead = leadById(id)
    if (!lead) continue
    const before = lead.stage
    safePatch(lead, patch)
    markDirty(lead.id)
    if (patch.stage && patch.stage !== before) log('stage', `${lead.fullName} moved ${before} → ${patch.stage}`)
    updated++
  }
  log('lead', `Bulk updated ${updated} lead${updated === 1 ? '' : 's'}`)
  res.json({ ok: true, updated })
})

app.delete('/api/leads/bulk', (req, res) => {
  const ids = new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])
  const before = db.leads.length
  db.leads = db.leads.filter(l => !ids.has(l.id))
  const deleted = before - db.leads.length
  for (const id of ids) markDeleted(id)
  save()
  log('lead', `Bulk deleted ${deleted} lead${deleted === 1 ? '' : 's'}`)
  res.json({ ok: true, deleted })
})

app.post('/api/leads/:id/followups', (req, res) => {
  const lead = leadById(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  const fu = {
    id: uid('fu'),
    date: req.body.date || new Date().toISOString().slice(0, 10),
    comments: req.body.comments || '',
    channel: ['call', 'whatsapp', 'email', 'sms'].includes(req.body.channel) ? req.body.channel : null,
    done: Boolean(req.body.done)
  }
  lead.followUps.push(fu)
  lead.lastActivityAt = nowIso()
  markDirty(lead.id)
  save()
  log('followup', `Follow-up logged for ${lead.fullName}`, lead.id)
  res.status(201).json(enrichLead(lead, db))
})

app.post('/api/leads/:id/assign', (req, res) => {
  const lead = leadById(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  if (req.body.associateId) {
    lead.associateId = req.body.associateId
    if (req.body.locationId) lead.locationId = req.body.locationId
  } else {
    assignLead(db, lead)
  }
  lead.lastActivityAt = nowIso()
  markDirty(lead.id)
  save()
  log('assign', `Assigned ${lead.fullName}`, lead.id)
  res.json(enrichLead(lead, db))
})

app.post('/api/leads/bulk', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : req.body?.rows || []
  const created = []
  let skipped = 0
  for (const row of rows) {
    if (!row.fullName && !row.name) { skipped++; continue }
    const lead = createLeadFrom(row)
    if (!lead.associateId && db.settings.roundRobin.enabled) assignLead(db, lead)
    db.leads.push(lead)
    markDirty(lead.id)
    created.push(lead)
  }
  save()
  log('import', `Bulk import created ${created.length} leads (${skipped} skipped)`)
  res.status(201).json({ created: created.length, skipped, items: enrichAll(created, db) })
})

// ---------- CSV import ----------

app.post('/api/leads/import/parse', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })
  const text = req.file.buffer.toString('utf8')
  const { columns, rows, errors } = parseCsv(text)
  if (!columns.length) return res.status(400).json({ error: 'No columns detected in CSV' })
  res.json({
    fileName: req.file.originalname,
    columns,
    total: rows.length,
    rows,
    preview: rows.slice(0, 5),
    autoMap: autoMap(columns),
    parseErrors: errors.slice(0, 5)
  })
})

app.post('/api/leads/import/apply', (req, res) => {
  const { rows, mapping, options } = req.body
  const locId = options?.locationId || db.locations[0]?.id
  const created = []
  let skipped = 0
  const errors = []

  rows.forEach((row, i) => {
    try {
      const get = (field) => mapping[field] ? row[mapping[field]] : null
      const fullName = get('fullName') || get('name')
      if (!fullName || String(fullName).trim() === '-' || String(fullName).trim() === '') { skipped++; return }
      const fuChannels = db.settings.followUpChannels?.length ? db.settings.followUpChannels : ['call', 'whatsapp', 'email', 'sms']
      const todayKey = new Date().toISOString().slice(0, 10)
      const followUps = (mapping.followUps || [])
        .filter(p => p.date || p.comments)
        .map((p, idx) => {
          const date = p.date && row[p.date] && row[p.date] !== '-' ? String(row[p.date]).slice(0, 10) : null
          return {
            id: uid('fu'),
            date,
            comments: p.comments && row[p.comments] && row[p.comments] !== '-' ? String(row[p.comments]) : '',
            channel: fuChannels[idx % fuChannels.length],
            done: date ? date <= todayKey : true
          }
        })
        .filter(p => p.date || p.comments)

      const stageVal = get('stage') || ''
      const lead = createLeadFrom({
        fullName: String(fullName).trim(),
        phone: String(get('phone') || '').trim(),
        email: String(get('email') || '-').trim() || '-',
        createdAt: get('createdAt') || nowIso(),
        sourceName: get('sourceName') || 'Website Form',
        sourceId: get('sourceId'),
        memberId: get('memberId'),
        convertedAt: get('convertedAt'),
        stage: stageVal,
        status: get('status'),
        associateName: get('associate'),
        remarks: get('remarks'),
        center: get('center'),
        classType: get('classType'),
        hostId: get('hostId'),
        channel: get('channel') || 'In-Studio',
        period: get('period'),
        valueEstimate: get('valueEstimate'),
        locationId: locId,
        followUps,
        _imported: true
      })
      if (!lead.associateId && db.settings.roundRobin.enabled && db.settings.roundRobin.autoAssignOnImport !== false) assignLead(db, lead)
      db.leads.push(lead)
      markDirty(lead.id)
      created.push(lead)
    } catch (e) {
      errors.push({ row: i + 2, message: e.message })
    }
  })

  if (created.length) {
    db.importHistory.unshift({
      id: uid('imp'), at: nowIso(), fileName: options?.fileName || 'CSV upload',
      created: created.length, skipped, locationId: locId
    })
    if (db.importHistory.length > 50) db.importHistory.length = 50
    save()
    log('import', `Imported ${created.length} leads from CSV (${skipped} skipped)`)
  }
  res.status(201).json({ created: created.length, skipped, errors })
})

// ---------- analytics ----------

app.get('/api/analytics/overview', (req, res) => {
  const leads = db.leads
  const now = Date.now()
  const thisMonth = new Date().toISOString().slice(0, 7)
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7)

  const open = leads.filter(l => l.status === 'open')
  const won = leads.filter(l => l.status === 'won')
  const lost = leads.filter(l => l.status === 'lost')

  const monthKey = (iso) => (iso || '').slice(0, 7)
  const wonThisMonth = won.filter(l => monthKey(l.convertedAt || l.createdAt) === thisMonth).length
  const wonLastMonth = won.filter(l => monthKey(l.convertedAt || l.createdAt) === lastMonth).length

  const newThisMonth = leads.filter(l => monthKey(l.createdAt) === thisMonth).length
  const newLastMonth = leads.filter(l => monthKey(l.createdAt) === lastMonth).length

  const revenueThisMonth = won.filter(l => monthKey(l.convertedAt) === thisMonth)
    .reduce((s, l) => s + (l.valueEstimate || 0), 0)
  const revenueLastMonth = won.filter(l => monthKey(l.convertedAt) === lastMonth)
    .reduce((s, l) => s + (l.valueEstimate || 0), 0)

  const trialBooked = open.filter(l => ['Trial Booked', 'Trial Completed'].includes(l.stage)).length

  const unassigned = open.filter(l => !l.associateId).length

  const hot = open.filter(l => enrichLead(l, db).ai.risk === 'hot').length

  res.json({
    totalLeads: leads.length,
    openLeads: open.length,
    won: won.length,
    lost: lost.length,
    conversionRate: leads.length ? Math.round((won.length / leads.length) * 1000) / 10 : 0,
    newThisMonth,
    newLastMonth,
    newDeltaPct: newLastMonth ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100) : 0,
    wonThisMonth,
    wonLastMonth,
    wonDeltaPct: wonLastMonth ? Math.round(((wonThisMonth - wonLastMonth) / wonLastMonth) * 100) : 0,
    revenueThisMonth,
    revenueLastMonth,
    revenueDeltaPct: revenueLastMonth ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100) : 0,
    avgDealValue: won.length ? Math.round(won.reduce((s, l) => s + (l.valueEstimate || 0), 0) / won.length) : 0,
    trialBooked,
    hotLeads: hot,
    unassigned,
    monthlyTarget: db.associates.reduce((s, a) => s + (a.targetMonthly || 0), 0),
    closedThisMonth: wonThisMonth
  })
})

app.get('/api/analytics/timeline', (req, res) => {
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = d.toISOString().slice(0, 7)
    const leads = db.leads.filter(l => (l.createdAt || '').slice(0, 7) === key)
    const won = db.leads.filter(l => (l.convertedAt || '').slice(0, 7) === key)
    months.push({
      month: d.toLocaleString('en-US', { month: 'short' }),
      key,
      newLeads: leads.length,
      won: won.length,
      revenue: won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    })
  }
  res.json(months)
})

app.get('/api/analytics/funnel', (req, res) => {
  const funnel = db.stages.map(stage => ({
    stage,
    count: db.leads.filter(l => l.stage === stage).length
  }))
  res.json(funnel)
})

app.get('/api/analytics/sources', (req, res) => {
  const map = {}
  for (const l of db.leads) {
    const key = l.sourceName || 'Unknown'
    map[key] = map[key] || { source: key, count: 0, won: 0 }
    map[key].count++
    if (l.status === 'won') map[key].won++
  }
  res.json(Object.values(map).sort((a, b) => b.count - a.count))
})

app.get('/api/analytics/team', (req, res) => {
  const rows = db.associates.filter(a => a.active !== false).map(a => {
    const owned = db.leads.filter(l => l.associateId === a.id)
    const won = owned.filter(l => l.status === 'won')
    const revenue = won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    return {
      associateId: a.id, name: a.name, locationId: a.locationId,
      open: owned.filter(l => l.status === 'open').length,
      won: won.length,
      revenue,
      total: owned.length,
      conversion: owned.length ? Math.round((won.length / owned.length) * 100) : 0,
      target: a.targetMonthly || 10
    }
  }).sort((a, b) => b.revenue - a.revenue)
  res.json(rows)
})

// ---------- momence ----------

app.get('/api/momence/config', (req, res) => {
  const c = momence.momenceConfig(db)
  res.json({
    clientId: c.clientId, username: c.username, hostId: c.hostId,
    connected: momence.isConfigured(db),
    configured: momence.isConfigured(db),
    lastSyncAt: c.lastSyncAt || null
  })
})

app.put('/api/momence/config', (req, res) => {
  const c = momence.momenceConfig(db)
  const patch = req.body
  if ('clientId' in patch) c.clientId = String(patch.clientId || '').trim()
  if ('clientSecret' in patch) c.clientSecret = String(patch.clientSecret || '').trim()
  if ('username' in patch) c.username = String(patch.username || '').trim()
  if ('password' in patch) c.password = String(patch.password || '').trim()
  if ('hostId' in patch) c.hostId = String(patch.hostId || '').trim()
  c.token = null
  c.configured = momence.isConfigured(db)
  c.connected = c.configured
  save()
  log('momence', 'Momence configuration updated')
  res.json({ ok: true, configured: momence.isConfigured(db), connected: c.configured })
})

app.post('/api/momence/test', async (req, res) => {
  try {
    if (!momence.isConfigured(db)) return res.status(400).json({ ok: false, error: 'Momence is not configured' })
    const profile = await momence.getProfile(db)
    momence.momenceConfig(db).lastSyncAt = nowIso()
    momence.momenceConfig(db).connected = true
    momence.momenceConfig(db).configured = true
    save()
    res.json({ ok: true, profile })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

app.post('/api/momence/sync/:leadId', async (req, res) => {
  const lead = leadById(req.params.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  if (!momence.isConfigured(db)) return res.status(400).json({ ok: false, error: 'Momence is not configured' })
  if (!lead.memberId) return res.status(400).json({ ok: false, error: 'Lead has no Momence member ID' })
  try {
    const profile = await momence.syncLeadMomence(db, lead)
    lead.lastActivityAt = nowIso()
    markDirty(lead.id)
    save()
    log('sync', `Synced Momence profile for ${lead.fullName}`, lead.id)
    res.json({ ok: true, profile: enrichLead(lead, db).momence, syncedAt: lead.momenceSyncedAt })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

// ---------- settings ----------

const SETTINGS_SECTIONS = ['org', 'ui', 'business', 'cadence', 'notifications', 'ai', 'roundRobin', 'reminders', 'momence', 'gpt', 'respondio', 'mailtrap']

app.get('/api/settings', (req, res) => res.json(db.settings))
app.put('/api/settings', async (req, res) => {
  const body = req.body || {}
  for (const section of SETTINGS_SECTIONS) {
    if (body[section] && typeof body[section] === 'object' && !Array.isArray(body[section])) {
      db.settings[section] = { ...(db.settings[section] || {}), ...body[section] }
    }
  }
  if (Array.isArray(body.followUpChannels)) db.settings.followUpChannels = body.followUpChannels.filter(Boolean)
  try {
    await saveNow()
  } catch (e) {
    return res.status(502).json({ error: `Settings saved locally but failed to sync to Supabase: ${e.message}` })
  }
  log('settings', 'Settings updated')
  res.json(db.settings)
})

app.put('/api/lists', (req, res) => {
  const { stages, sources, channels, classTypes } = req.body || {}
  if (Array.isArray(stages)) db.stages = stages.filter(Boolean)
  if (Array.isArray(sources)) db.sources = sources.filter(Boolean)
  if (Array.isArray(channels)) db.channels = channels.filter(Boolean)
  if (Array.isArray(classTypes)) db.classTypes = classTypes.filter(Boolean)
  save()
  log('settings', 'Lead list options updated')
  res.json({ stages: db.stages, sources: db.sources, channels: db.channels, classTypes: db.classTypes })
})

app.post('/api/reset', (req, res) => {
  const fresh = reset()
  log('system', 'Database reset to demo dataset')
  res.json({ ok: true, leads: fresh.leads.length })
})

// ---------- performance analytics ----------

function weekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}

app.get('/api/analytics/performance', (req, res) => {
  const range = req.query.range === 'week' ? 'week' : 'month'
  const now = new Date()
  const buckets = []
  let fmt, key

  if (range === 'week') {
    const start = weekStart(now)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(start.getTime() + i * 86400000)
      buckets.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleString('en-US', { weekday: 'short' }) })
    }
    fmt = (d) => d.toISOString().slice(0, 10)
  } else {
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
      buckets.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-US', { month: 'short' }) })
    }
    fmt = (d) => d.toISOString().slice(0, 7)
  }

  const row = buckets.map(b => ({ ...b, newLeads: 0, won: 0, revenue: 0, followUps: 0, missed: 0 }))
  const idx = Object.fromEntries(row.map((r, i) => [r.key, i]))

  const validDate = (v) => v && v !== '-' && !isNaN(new Date(v).getTime())

  for (const l of db.leads) {
    if (validDate(l.createdAt)) {
      const ck = fmt(new Date(l.createdAt))
      if (idx[ck] !== undefined) row[idx[ck]].newLeads++
    }
    if (l.status === 'won' && validDate(l.convertedAt)) {
      const wk = fmt(new Date(l.convertedAt))
      if (idx[wk] !== undefined) { row[idx[wk]].won++; row[idx[wk]].revenue += l.valueEstimate || 0 }
    }
    for (const f of l.followUps || []) {
      if (!validDate(f.date)) continue
      const fk = fmt(new Date(f.date))
      if (idx[fk] !== undefined) {
        row[idx[fk]].followUps++
        if (f.done === false) row[idx[fk]].missed++
      }
    }
  }

  const totals = row.reduce((acc, r) => {
    acc.newLeads += r.newLeads; acc.won += r.won; acc.revenue += r.revenue
    acc.followUps += r.followUps; acc.missed += r.missed
    return acc
  }, { newLeads: 0, won: 0, revenue: 0, followUps: 0, missed: 0 })
  totals.followUpRate = totals.followUps ? Math.round(((totals.followUps - totals.missed) / totals.followUps) * 100) : 0

  res.json({ range, buckets: row, totals })
})

// Per-studio breakdown for a single week/month period. `offset` counts periods
// back from the current one (week: 0 = this week, 1 = last week; month: 0 =
// this month). Used by the dedicated weekly/monthly studio performance pages.
app.get('/api/analytics/performance/by-location', (req, res) => {
  const range = req.query.range === 'month' ? 'month' : 'week'
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const now = new Date()

  let start, end, label
  if (range === 'week') {
    const thisWeekStart = weekStart(now)
    start = new Date(thisWeekStart.getTime() - offset * 7 * 86400000)
    end = new Date(start.getTime() + 7 * 86400000)
    label = `Week of ${start.toISOString().slice(0, 10)}`
  } else {
    const y = now.getFullYear(), m = now.getMonth() - offset
    start = new Date(y, m, 1)
    end = new Date(y, m + 1, 1)
    label = start.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  }

  const inRange = (v) => {
    if (!v || v === '-') return false
    const d = new Date(v)
    return !isNaN(d.getTime()) && d >= start && d < end
  }
  const isTrialStage = (s) => /trial/i.test(s || '')

  const rows = db.locations.map(loc => {
    const leads = db.leads.filter(l => l.locationId === loc.id)
    const newLeads = leads.filter(l => inRange(l.createdAt))
    const won = leads.filter(l => l.status === 'won' && inRange(l.convertedAt))
    const trials = leads.filter(l => isTrialStage(l.stage) && inRange(l.createdAt || l.updatedAt))
    const revenue = won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    let followUps = 0, missed = 0
    for (const l of leads) {
      for (const f of l.followUps || []) {
        if (!inRange(f.date)) continue
        followUps++
        if (f.done === false) missed++
      }
    }
    const byAssociate = {}
    for (const l of won) {
      if (!l.associateId) continue
      byAssociate[l.associateId] = (byAssociate[l.associateId] || 0) + (l.valueEstimate || 0)
    }
    const ranked = Object.entries(byAssociate)
      .map(([associateId, rev]) => ({ associateId, name: db.associates.find(a => a.id === associateId)?.name || 'Unknown', revenue: rev }))
      .sort((a, b) => b.revenue - a.revenue)

    return {
      locationId: loc.id, locationName: loc.name,
      newLeads: newLeads.length, trials: trials.length, won: won.length, revenue,
      followUps, missed,
      followUpRate: followUps ? Math.round(((followUps - missed) / followUps) * 100) : 0,
      topAssociate: ranked[0] || null,
      bottomAssociate: ranked.length > 1 ? ranked[ranked.length - 1] : null,
      newLeadDetails: newLeads.map(l => ({ id: l.id, fullName: l.fullName, stage: l.stage, associateId: l.associateId })),
      wonDetails: won.map(l => ({ id: l.id, fullName: l.fullName, revenue: l.valueEstimate || 0, associateId: l.associateId }))
    }
  }).sort((a, b) => b.revenue - a.revenue)

  res.json({
    range, offset, label,
    start: start.toISOString().slice(0, 10), end: new Date(end.getTime() - 86400000).toISOString().slice(0, 10),
    rows
  })
})

app.get('/api/analytics/associate-compare', (req, res) => {
  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7)
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7)
  const rows = db.associates.filter(a => a.active !== false).map(a => {
    const owned = db.leads.filter(l => l.associateId === a.id)
    const open = owned.filter(l => l.status === 'open')
    const won = owned.filter(l => l.status === 'won')
    const revenue = won.reduce((s, l) => s + (l.valueEstimate || 0), 0)
    const followUps = owned.reduce((s, l) => s + (l.followUps || []).length, 0)
    const missed = owned.reduce((s, l) => s + (l.fu && l.fu.missedCount ? l.fu.missedCount : 0), 0)
    const newThisMonth = owned.filter(l => (l.createdAt || '').slice(0, 7) === thisMonth).length
    const wonThisMonth = owned.filter(l => l.status === 'won' && (l.convertedAt || l.createdAt || '').slice(0, 7) === thisMonth).length
    const wonLastMonth = owned.filter(l => l.status === 'won' && (l.convertedAt || l.createdAt || '').slice(0, 7) === lastMonth).length
    const enriched = owned.map(l => enrichLead(l, db))
    const avgScore = enriched.length ? Math.round(enriched.reduce((s, l) => s + l.ai.score, 0) / enriched.length) : 0
    return {
      associateId: a.id, name: a.name, locationId: a.locationId,
      open: open.length, won: won.length, lost: owned.filter(l => l.status === 'lost').length,
      revenue, total: owned.length,
      conversion: owned.length ? Math.round((won.length / owned.length) * 100) : 0,
      target: a.targetMonthly || 10,
      followUps, missed,
      avgScore,
      newThisMonth, wonThisMonth, wonLastMonth,
      attainment: Math.min(100, Math.round((wonThisMonth / (a.targetMonthly || 10)) * 100)),
      hot: enriched.filter(l => l.ai.risk === 'hot').length
    }
  })
  res.json(rows.sort((a, b) => b.revenue - a.revenue))
})

app.get('/api/activity', (req, res) => res.json(db.activity.slice(0, 40)))

app.get('/api/imports', (req, res) => res.json(db.importHistory))

// ---------- OpenAI GPT enrichment ----------

app.get('/api/gpt/status', (req, res) => {
  res.json({ configured: gpt.isEnabled(db), model: gpt.modelName(db), enabled: db.settings.gpt?.enabled !== false })
})

app.post('/api/gpt/test', async (req, res) => {
  try {
    const probe = { fullName: 'Sample Lead', stage: 'Contacted', status: 'open', sourceName: 'Website Form', phone: '919999999999', email: 'sample@example.com', remarks: 'Keen on a trial class this week. Wants evening slots.', followUps: [] }
    const result = await gpt.enrichLeadWithGpt(probe, db)
    if (!result) return res.status(400).json({ ok: false, error: 'OpenAI is not configured. Add your API key.' })
    res.json({ ok: true, gpt: result })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

app.post('/api/leads/:id/enrich', async (req, res) => {
  const lead = leadById(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  try {
    const result = await gpt.enrichLeadWithGpt(lead, db)
    if (!result) return res.status(400).json({ ok: false, error: 'OpenAI is not configured. Add your API key in Settings > Integrations (or OPENAI_API_KEY env).' })
    lead.aiGpt = result
    lead.lastActivityAt = nowIso()
    markDirty(lead.id)
    save()
    res.json({ ok: true, gpt: result })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

// ---------- Respond.io messaging ----------

app.get('/api/respondio/status', (req, res) => {
  res.json({ configured: respondio.isConfigured(db), workspaceId: respondio.workspaceId(db) })
})

app.post('/api/respondio/test', async (req, res) => {
  try {
    const r = await respondio.testConnection(db)
    res.json({ ok: true, ...r })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

app.get('/api/respondio/conversations/:leadId', async (req, res) => {
  const lead = leadById(req.params.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  if (!respondio.isConfigured(db)) return res.json({ configured: false, conversations: [] })
  try {
    const data = await respondio.syncLeadConversations(db, lead)
    if (data?.contact?.id && data.contact.id !== lead.respondId) {
      lead.respondId = data.contact.id
      markDirty(lead.id)
      save()
    }
    res.json({ configured: true, ...data })
  } catch (e) {
    res.status(502).json({ configured: true, error: e.message, conversations: [] })
  }
})

app.post('/api/respondio/send', async (req, res) => {
  const lead = leadById(req.body.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  const channel = ['call', 'whatsapp', 'email', 'sms'].includes(req.body.channel) ? req.body.channel : 'whatsapp'
  const text = String(req.body.message || '').trim()
  if (!text) return res.status(400).json({ error: 'Message is required' })
  if (!respondio.isConfigured(db)) return res.status(400).json({ error: 'Respond.io is not configured. Add your API key in Settings > Integrations.' })
  try {
    const contact = await respondio.getOrCreateContact(db, lead)
    if (!contact?.id) return res.status(502).json({ error: 'Could not resolve a Respond.io contact for this lead.' })
    lead.respondId = contact.id
    try {
      await respondio.setConversationStatus(db, lead, 'open')
    } catch (e) {
      return res.status(502).json({ error: `Could not open a ${channel} conversation: ${e.message}` })
    }
    const msg = await respondio.sendMessage(db, lead, text, channel)
    if (req.body.logFollowUp !== false) {
      lead.followUps.push({
        id: uid('fu'),
        date: new Date().toISOString().slice(0, 10),
        comments: `[${channel}] ${text}`,
        channel,
        done: true,
        via: 'respondio',
        conversationId: lead.respondId
      })
    }
    lead.lastActivityAt = nowIso()
    markDirty(lead.id)
    save()
    res.json({ ok: true, contactId: contact.id, message: msg })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// ---------- Mailtrap email ----------

app.get('/api/mailtrap/status', (req, res) => {
  const c = mailer.config(db)
  res.json({ configured: mailer.isConfigured(db), enabled: c.enabled !== false, host: c.host, fromEmail: c.fromEmail, digestEnabled: db.settings.reminders?.emailReminders !== false })
})

app.post('/api/mailtrap/test', async (req, res) => {
  const to = String(req.body.to || '').trim()
  if (!to) return res.status(400).json({ error: 'Recipient email is required' })
  try {
    const r = await mailer.testMail(db, to)
    res.json(r)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.post('/api/mailtrap/reminders', async (req, res) => {
  try {
    const r = await runReminderDigest(db)
    res.json(r)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// ---------- performance details ----------

app.get('/api/analytics/performance/details', (req, res) => {
  const range = req.query.range === 'week' ? 'week' : 'month'
  const now = new Date()
  const buckets = []
  let fmt, key

  if (range === 'week') {
    const start = weekStart(now)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(start.getTime() + i * 86400000)
      buckets.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleString('en-US', { weekday: 'short', day: 'numeric' }) })
    }
    fmt = (d) => d.toISOString().slice(0, 10)
  } else {
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
      buckets.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-US', { month: 'long' }) })
    }
    fmt = (d) => d.toISOString().slice(0, 7)
  }

  const row = buckets.map(b => ({ ...b, newLeads: [], won: [], missed: [] }))
  const idx = Object.fromEntries(row.map((r, i) => [r.key, i]))

  const validDate2 = (v) => v && v !== '-' && !isNaN(new Date(v).getTime())

  for (const l of db.leads) {
    if (validDate2(l.createdAt)) {
      const ck = fmt(new Date(l.createdAt))
      if (idx[ck] !== undefined && row[idx[ck]].newLeads.length < 200) row[idx[ck]].newLeads.push({ id: l.id, fullName: l.fullName, stage: l.stage, status: l.status })
    }
    if (l.status === 'won' && validDate2(l.convertedAt)) {
      const wk = fmt(new Date(l.convertedAt))
      if (idx[wk] !== undefined && row[idx[wk]].won.length < 200) row[idx[wk]].won.push({ id: l.id, fullName: l.fullName, stage: l.stage, value: l.valueEstimate })
    }
    for (const f of l.followUps || []) {
      if (!validDate2(f.date) || f.done !== false) continue
      const fk = fmt(new Date(f.date))
      if (idx[fk] !== undefined && row[idx[fk]].missed.length < 200) row[idx[fk]].missed.push({ id: l.id, fullName: l.fullName, date: f.date, comments: f.comments })
    }
  }

  res.json({ range, buckets: row })
})

// ---------- realtime (SSE) ----------
// Notifies open browser tabs when Supabase reports a change we didn't just
// make ourselves (two-way sync), so the UI can refetch instead of going stale.

const sseClients = new Set()

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  res.write('retry: 3000\n\n')
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

onRemoteChange(() => {
  for (const res of sseClients) res.write(`data: ${JSON.stringify({ type: 'remote-change' })}\n\n`)
})

// ---------- static hosting ----------

const dist = path.join(__dirname, '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const PORT = process.env.PORT || 3001

// One-time backfill: older CSV imports created follow-ups without an id,
// channel or done flag, which silently breaks the per-channel outreach
// columns (they only match followUps with a recognized `channel`) and the
// timeline's done/overdue badges (`!f.done` treats undefined as pending).
function backfillFollowUps(db) {
  const fuChannels = db.settings.followUpChannels?.length ? db.settings.followUpChannels : ['call', 'whatsapp', 'email', 'sms']
  const todayKey = new Date().toISOString().slice(0, 10)
  let touched = 0
  for (const lead of db.leads) {
    let changed = false
    lead.followUps = (lead.followUps || []).map((f, idx) => {
      const patch = {}
      if (!f.id) patch.id = uid('fu')
      if (!f.channel) patch.channel = fuChannels[idx % fuChannels.length]
      if (f.done === undefined) patch.done = f.date && f.date !== '-' ? f.date <= todayKey : true
      if (Object.keys(patch).length) { changed = true; return { ...f, ...patch } }
      return f
    })
    if (changed) { markDirty(lead.id); touched++ }
  }
  if (touched) {
    console.log(`[physique57-leads] backfilled follow-up channel/done on ${touched} lead(s)`)
    save()
  }
}

async function start() {
  await init()
  db = load()
  backfillFollowUps(db)
  startReminderScheduler(db)
  app.listen(PORT, () => {
    console.log(`[physique57-leads] server listening on http://localhost:${PORT}`)
    console.log(`[physique57-leads] storage: ${supabase.isEnabled() ? 'Supabase' : 'local JSON'}`)
    console.log(`[physique57-leads] gpt: ${gpt.isEnabled(db) ? gpt.modelName(db) : 'heuristics only'}`)
    console.log(`[physique57-leads] respondio: ${respondio.isConfigured(db) ? 'configured' : 'not configured'}`)
    console.log(`[physique57-leads] mailtrap: ${mailer.isConfigured(db) ? 'configured' : 'not configured'}`)
    console.log(`[physique57-leads] momence configured: ${momence.isConfigured(db)}`)
  })
}

start()
