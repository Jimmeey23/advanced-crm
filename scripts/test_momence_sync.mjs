import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(__dirname, '..', '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

const momence = await import('../server/momence.js')

// Location IDs pulled from HOME_LOCATION_IDS export — one mumbai, one blr.
const fakeDb = {
  settings: {},
  locations: [
    { id: 'loc-mumbai', name: 'Kwality House, Kemps Corner' },
    { id: 'loc-blr', name: 'Kenkere House' }
  ]
}

async function main() {
  // Real member pulled from the live sales report in the previous test run.
  const knownSale = {
    memberId: 26634211,
    email: 'niharika@mercuryind.com',
    saleDate: new Date('2026-08-27T08:09:09.512Z')
  }

  const leads = [
    {
      id: 'test-lead-real-member',
      locationId: 'loc-mumbai',
      memberId: String(knownSale.memberId),
      email: knownSale.email,
      // createdAt BEFORE the known sale — should register as a purchase.
      createdAt: new Date(knownSale.saleDate.getTime() - 10 * 86400000).toISOString()
    },
    {
      id: 'test-lead-no-match',
      locationId: 'loc-mumbai',
      memberId: '999999999999',
      email: 'definitely-not-a-real-member@example.com',
      createdAt: new Date(Date.now() - 20 * 86400000).toISOString()
    },
    {
      id: 'test-lead-created-after-sale',
      locationId: 'loc-mumbai',
      memberId: String(knownSale.memberId),
      email: knownSale.email,
      // createdAt AFTER the known sale — sale should NOT count (must be after createdAt).
      createdAt: new Date(knownSale.saleDate.getTime() + 86400000).toISOString()
    }
  ]

  console.log('running syncLifecycleEvidence against 3 synthetic leads (1 real member, 1 bogus, 1 created-after-sale)...')
  const result = await momence.syncLifecycleEvidence(fakeDb, leads)
  console.log('sync summary:', JSON.stringify(result.summary, null, 2))
  console.log('updatedLeadIds:', result.updatedLeadIds)
  for (const lead of leads) {
    console.log(`\nlead ${lead.id}:`, JSON.stringify(lead.momenceEvidence, null, 2))
  }

  // Sanity checks
  const matched = leads.find(l => l.id === 'test-lead-real-member')
  const bogus = leads.find(l => l.id === 'test-lead-no-match')
  const afterSale = leads.find(l => l.id === 'test-lead-created-after-sale')

  console.log('\n--- ASSERTIONS ---')
  console.log('matched lead has firstPurchaseDate:', Boolean(matched.momenceEvidence?.firstPurchaseDate), matched.momenceEvidence?.firstPurchaseDate)
  console.log('bogus lead has NO firstPurchaseDate:', !bogus.momenceEvidence?.firstPurchaseDate)
  console.log('afterSale lead has NO firstPurchaseDate (sale predates lead):', !afterSale.momenceEvidence?.firstPurchaseDate)
}

main().catch(e => { console.log('FATAL', e); process.exit(1) })
