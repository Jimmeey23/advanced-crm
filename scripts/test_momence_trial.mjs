import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(__dirname, '..', '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const momence = await import('../server/momence.js')
const fakeDb = { settings: {}, locations: [{ id: 'loc-mumbai', name: 'Kwality House, Kemps Corner' }] }

const memberId = 26634211
const leads = [
  { id: 'trial-before', locationId: 'loc-mumbai', memberId: String(memberId), email: 'niharika@mercuryind.com', createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'trial-after', locationId: 'loc-mumbai', memberId: String(memberId), email: 'niharika@mercuryind.com', createdAt: '2026-01-01T00:00:00.000Z' }
]

const result = await momence.syncLifecycleEvidence(fakeDb, leads)
console.log('summary:', JSON.stringify(result.summary))
for (const l of leads) console.log(l.id, JSON.stringify(l.momenceEvidence))
console.log('\nASSERT trial-before has trialCompleted=true:', leads[0].momenceEvidence.trialCompleted === true)
console.log('ASSERT trial-after has trialCompleted=false (all attended classes predate createdAt):', leads[1].momenceEvidence.trialCompleted === false)
