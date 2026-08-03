import Papa from 'papaparse'

export function parseCsv(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: h => (h || '').replace(/^\uFEFF/, '').trim()
  })
  return {
    columns: result.meta.fields || [],
    rows: result.data,
    errors: result.errors || []
  }
}

// Auto-detect a sensible column mapping given the available columns.
export function autoMap(columns) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const map = {}
  const table = {
    fullName: ['fullname', 'name', 'leadname', 'customername'],
    phone: ['phonenumber', 'phone', 'mobile', 'contact', 'mobile number', 'contactnumber'],
    email: ['email', 'emailaddress', 'emailid'],
    createdAt: ['createdat', 'created', 'createddate', 'date', 'leadcreatedat'],
    sourceName: ['sourcename', 'source', 'leadsource'],
    sourceId: ['sourceid'],
    memberId: ['memberid', 'member', 'momenceid', 'customerid'],
    convertedAt: ['convertedtocustomerat', 'convertedat', 'conversiondate', 'wonat'],
    stage: ['stagename', 'stage', 'pipeline'],
    associate: ['associate', 'owner', 'assignedto', 'agent', 'salesrep'],
    remarks: ['remarks', 'notes', 'comments', 'remark', 'lastcomment'],
    center: ['center', 'location', 'studio', 'centerlocation'],
    classType: ['classtype', 'class', 'typeofclass'],
    hostId: ['hostid'],
    status: ['status'],
    channel: ['channel', 'sourcechannel', 'leadchannel'],
    period: ['period'],
    valueEstimate: ['value', 'leadvalue', 'estimatedvalue', 'amount', 'price']
  }
  for (const [field, aliases] of Object.entries(table)) {
    for (const c of columns) {
      if (aliases.includes(norm(c))) {
        map[field] = c
        break
      }
    }
  }

  // Follow-up date/comment pairs: "Follow Up 1 Date" + "Follow Up Comments (1)"
  const followUps = []
  const fuRe = /follow\s*up\s*(\d+)/i
  for (const c of columns) {
    const m = c.match(fuRe)
    if (m) {
      const idx = parseInt(m[1], 10)
      let pair = followUps.find(p => p.index === idx)
      if (!pair) {
        pair = { index: idx, date: null, comments: null }
        followUps.push(pair)
      }
      if (/comment/i.test(c)) pair.comments = c
      else if (/date/i.test(c)) pair.date = c
    }
  }
  followUps.sort((a, b) => a.index - b.index)
  map.followUps = followUps

  return map
}

export function normalizeStage(value, stages) {
  if (!value || value === '-') return null
  const v = String(value).trim()
  const exact = stages.find(s => s.toLowerCase() === v.toLowerCase())
  if (exact) return exact
  return v
}

export function normalizeStatus(stage, explicitStatus) {
  if (explicitStatus) {
    const s = String(explicitStatus).toLowerCase()
    if (['won', 'lost'].includes(s)) return s
  }
  if (/won|sold|converted/i.test(stage)) return 'won'
  if (/lost|not interested|dead/i.test(stage)) return 'lost'
  return 'open'
}
