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
const token = await momence.getAccessToken(fakeDb, 'mumbai')

async function tryPath(path) {
  const res = await fetch(`https://api.momence.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  console.log(path, '->', res.status)
  if (res.ok) {
    const data = await res.json()
    console.log(JSON.stringify(data, null, 2).slice(0, 1500))
  } else {
    console.log(await res.text())
  }
}

await tryPath('/api/v2/host/members/24758344/session-bookings?page=0&pageSize=5')
