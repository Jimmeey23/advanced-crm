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

// find a session in the near past/future with bookings
const now = new Date()
const start = new Date(now.getTime() - 3*86400000).toISOString()
const end = new Date(now.getTime() + 3*86400000).toISOString()
const sessions = await momence.getSessions(fakeDb, { startAfter: start, startBefore: end })
console.log('sessions found:', sessions.length)
let picked = null
for (const s of sessions) {
  if (Number(s.bookingCount) > 0) { picked = s; break }
}
if (!picked) { console.log('no session with bookings found'); process.exit(0) }
console.log('picked session', picked.id, picked.name, picked.bookingCount)
const { bookings } = await momence.getSessionWorkspace(fakeDb, picked.id, picked.inPersonLocation?.id)
console.log('bookings count', bookings.length)
console.log(JSON.stringify(bookings[0], null, 2))
