// Round-robin assignment engine.
// For each location, keeps a rotation cursor and assigns the next active
// associate. In "fair" mode we simply walk the list in order; in
// "load-balanced" mode we pick the associate with the fewest open leads.

export function activeAssociatesForLocation(db, locationId) {
  const base = db.associates
    .filter(a => (a.locationIds || [a.locationId]).filter(Boolean).includes(locationId) && a.active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name))
  return applyShiftFilter(db, base)
}

// Narrows the roster down to associates Zoho People says are on a working
// shift today — only when shift-aware round robin is turned on and today's
// on-duty cache is actually populated. If the cache is missing/stale (Zoho
// unreachable, integration not yet refreshed today) or nobody in the
// location's roster matches an on-duty email, this falls back to the full
// roster rather than assigning nothing — a Zoho outage should never stop
// leads from being assigned, it should just stop being shift-aware for a
// bit.
function applyShiftFilter(db, list) {
  const zoho = db.settings.zohoPeople
  if (!zoho?.enabled || !zoho.onDuty || zoho.onDuty.date !== todayKeyLocal()) return list
  const onDutyEmails = new Set(zoho.onDuty.emails || [])
  const shiftMatched = list.filter(a => a.email && onDutyEmails.has(String(a.email).toLowerCase().trim()))
  return shiftMatched.length ? shiftMatched : list
}

function todayKeyLocal() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function nextAssociate(db, locationId) {
  const list = activeAssociatesForLocation(db, locationId)
  if (list.length === 0) return null

  const mode = db.settings.roundRobin?.mode || 'fair'
  if (mode === 'load-balanced') {
    const openCount = (id) =>
      db.leads.filter(l => l.locationId === locationId && l.associateId === id && l.status === 'open').length
    const min = Math.min(...list.map(a => openCount(a.id)))
    const candidates = list.filter(a => openCount(a.id) === min)
    return candidates[Math.floor(Math.random() * candidates.length)].id
  }

  const rotation = (db.settings.roundRobin.rotation ||= {})
  let cursor = rotation[locationId] || 0
  const chosen = list[cursor % list.length]
  rotation[locationId] = cursor + 1
  return chosen.id
}

export function assignLead(db, lead) {
  // Leads that arrived through the Google Sheet sync are owned by the sheet's
  // Associate column, full stop. Rotating one to somebody else would contradict
  // the sheet on the next read and flip the owner back and forth forever, so a
  // sheet lead with a blank/unrecognised Associate stays unassigned instead.
  if (lead.autoAssignExempt) return null
  if (!lead.locationId) return null
  const id = nextAssociate(db, lead.locationId)
  if (id) lead.associateId = id
  return id
}
