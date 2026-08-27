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
let count = 0
const start = Date.now()
for (let i = 0; i < 15; i++) {
  const res = await fetch('https://api.momence.com/api/v2/host/members/26634211/sessions?page=0&pageSize=5&includeCancelled=true', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  })
  count++
  console.log(i, res.status, 'rate headers:', JSON.stringify({
    limit: res.headers.get('x-ratelimit-limit') || res.headers.get('ratelimit-limit'),
    remaining: res.headers.get('x-ratelimit-remaining') || res.headers.get('ratelimit-remaining'),
    reset: res.headers.get('x-ratelimit-reset') || res.headers.get('ratelimit-reset'),
    retryAfter: res.headers.get('retry-after')
  }), 'elapsed ms:', Date.now() - start)
  if (res.status === 429) { console.log('BODY:', await res.text()); break }
}
