// Round-robin assignment engine.
// For each location, keeps a rotation cursor and assigns the next active
// associate. In "fair" mode we simply walk the list in order; in
// "load-balanced" mode we pick the associate with the fewest open leads.

export function activeAssociatesForLocation(db, locationId) {
  return db.associates
    .filter(a => a.locationId === locationId && a.active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name))
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
  if (!lead.locationId) return null
  const id = nextAssociate(db, lead.locationId)
  if (id) lead.associateId = id
  return id
}
