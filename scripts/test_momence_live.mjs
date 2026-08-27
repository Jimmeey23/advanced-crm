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
const fakeDb = { settings: {}, leads: [] }

async function main() {
  console.log('isConfigured mumbai:', momence.isConfigured(fakeDb, 'mumbai'))
  console.log('isConfigured blr:', momence.isConfigured(fakeDb, 'blr'))

  for (const market of ['mumbai', 'blr']) {
    try {
      const token = await momence.getAccessToken(fakeDb, market)
      console.log(`[${market}] token ok, len=`, token.length)
    } catch (e) {
      console.log(`[${market}] token FAILED:`, e.message)
      continue
    }

    try {
      const now = new Date()
      const start = new Date(now.getTime() - 30 * 86400000).toISOString()
      const end = now.toISOString()
      console.log(`[${market}] running host report total-sales`, start, end)
      const items = await momence.runHostReport(fakeDb, 'total-sales', {
        market,
        startDate: start,
        endDate: end,
        saleTypes: ['membership', 'session', 'appointment', 'monthly-subscription', 'custom-member-payment-plan-installment'],
        moneyCreditSalesFilter: 'noFilter',
        includeRefunds: true,
        excludeGiftCardPaymentMethod: true,
        excludeTransactionFeesInSaleValue: false
      })
      console.log(`[${market}] report items:`, items.length)
      if (items[0]) console.log(`[${market}] sample item:`, JSON.stringify(items[0], null, 2))
    } catch (e) {
      console.log(`[${market}] runHostReport FAILED:`, e.message)
    }
  }
}

main().catch(e => { console.log('FATAL', e); process.exit(1) })

async function testMapper() {
  const fakeDb2 = { settings: {}, leads: [] }
  const now = new Date()
  const start = new Date(now.getTime() - 30 * 86400000).toISOString()
  const end = now.toISOString()
  const items = await momence.runHostReport(fakeDb2, 'total-sales', {
    market: 'mumbai', startDate: start, endDate: end,
    saleTypes: ['membership'], moneyCreditSalesFilter: 'noFilter', includeRefunds: true,
    excludeGiftCardPaymentMethod: true, excludeTransactionFeesInSaleValue: false
  })
  const mapped = momence.mapSalesHistoryReport(items.slice(0, 3))
  console.log('mapped sample:', JSON.stringify(mapped, null, 2))

  // pick a real memberId from the items to test getMemberSessions/trial logic
  const memberId = items[0]?.memberId
  console.log('testing getMemberSessions for memberId', memberId)
  const sessions = await momence.getMemberSessions(fakeDb2, memberId, 'mumbai')
  console.log('sessions count:', sessions.length)
  if (sessions[0]) console.log('sample session:', JSON.stringify(sessions[0], null, 2).slice(0, 800))
}
testMapper().catch(e => console.log('mapper test FAILED:', e.message))
