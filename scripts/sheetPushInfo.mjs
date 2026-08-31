// Prints the three values the sheet's Apps Script needs, and mints the hook
// secret if one does not exist yet. Run with:
//   node --env-file=.env scripts/sheetPushInfo.mjs [public-base-url]
import { randomUUID } from 'node:crypto'
import * as store from '../server/supabaseStore.js'

const base = (process.argv[2] || '').replace(/\/$/, '')
const state = await store.loadState()
if (!state) {
  console.error('No state in Supabase — check USER_SUPABASE_URL / USER_SUPABASE_ANON_KEY.')
  process.exit(1)
}

const g = state.settings.googleSheets = state.settings.googleSheets || {}
let minted = false
if (!g.hookSecret) { g.hookSecret = randomUUID().replace(/-/g, ''); minted = true }

console.log('connected      :', Boolean(g.refreshToken || g.accessToken))
console.log('connectedEmail :', g.connectedEmail || '(none)')
console.log('sheetId        :', g.sheetId || '(NOT SET — save it in Settings first)')
console.log('')
console.log('--- paste these into the Apps Script editor ---')
console.log(`var HOOK_URL = '${base ? base + '/api/google-sheets/hook' : '<your public base url>/api/google-sheets/hook'}'`)
console.log(`var HOOK_SECRET = '${g.hookSecret}'`)
console.log(`var SHEET_TAB = '${g.sheetTab || '<your tab name>'}'`)

if (minted) {
  await store.persistMetaState(state)
  console.log('\n(secret generated and saved to Supabase)')
}
process.exit(0)
