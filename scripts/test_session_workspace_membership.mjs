import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(__dirname, '..', '.env')
for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const momence = await import('../server/momence.js')
const fakeDb = { settings: {} }
const now = new Date()
const start = new Date(now.getTime() - 3*86400000).toISOString()
const end = new Date(now.getTime() + 3*86400000).toISOString()
const sessions = await momence.getSessions(fakeDb, { startAfter: start, startBefore: end })
let picked = sessions.find(s => Number(s.bookingCount) > 1)
console.log('picked', picked?.id, picked?.name, picked?.bookingCount)
const { bookings } = await momence.getSessionWorkspace(fakeDb, picked.id, picked.inPersonLocation?.id)
console.log(JSON.stringify(bookings.map(b => ({ member: b.member?.firstName, membershipUsed: b.membershipUsed })), null, 2))
