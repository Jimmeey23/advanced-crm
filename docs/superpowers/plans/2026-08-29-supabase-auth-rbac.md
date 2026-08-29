# Supabase Auth + Role-Based Location Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase email/Google login, default every user to `agent` role scoped to their own studio location(s) (matched by email against `associates`), let mastercode `9818` grant unrestricted `admin`, and enforce that scoping server-side across leads, team, performance, weekly/monthly reports, calendar, settings, and inbox — with import/bulk-delete disabled for agents.

**Architecture:** Supabase Auth issues a JWT the frontend attaches as a Bearer token on every `/api/*` call. A new `server/auth.js` verifies that token, resolves `{ role, associateId, locationIds }` from a new `app_users` table + email-match against `db.associates`, and two Express middlewares (`requireAuth`, `scopeLocation`) enforce it before any handler runs — overwriting the `locationId`/`associate` query params agents send rather than trusting them. Frontend gating (hidden nav/locked filters) is UX polish only, not the security boundary.

**Tech Stack:** `@supabase/supabase-js` (already a dependency, both ends), Express middleware, no new frontend framework — CSS keyframe animations for the login page.

**Spec:** `docs/superpowers/specs/2026-08-29-supabase-auth-rbac-design.md`

## Global Constraints

- Mastercode is exactly `9818`, checked only server-side.
- New backend env vars follow the existing `USER_`-prefix convention (see `.env.example`): `USER_SUPABASE_SERVICE_ROLE_KEY`.
- New frontend env vars use Vite's required `VITE_` prefix: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Every `/api/*` route requires a valid Supabase session except `/api/runtime` (used for basic health/uptime checks, keep public).
- No test framework exists in this repo (`package.json` has no test script) — verification steps in this plan use manual `curl`/browser checks, matching existing repo convention, not automated unit tests.
- Agents' location scope is derived, never client-supplied: always recompute `locationIds` server-side from `req.authUser.email` → matching `db.associates[].email` on every request.

---

## Task 1: Database migration + env scaffolding

**Files:**
- Create: `server/sql/migrations/20260829_add_app_users.sql`
- Modify: `.env.example`

**Interfaces:**
- Produces: Supabase table `app_users(user_id uuid pk, email text not null, role text not null default 'agent', created_at timestamptz default now())`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- server/sql/migrations/20260829_add_app_users.sql
-- Maps a Supabase Auth user to an app role. Role starts at 'agent' for every
-- new signup; only the POST /api/auth/admin-code route (mastercode-gated,
-- server-side only) can promote a row to 'admin'.
create table if not exists app_users (
  user_id uuid primary key,
  email text not null,
  role text not null default 'agent' check (role in ('agent', 'admin')),
  created_at timestamptz not null default now()
);

create index if not exists app_users_email_idx on app_users (lower(email));
```

- [ ] **Step 2: Run it in the Supabase SQL editor (manual, one-time)**

Report back: "Run `server/sql/migrations/20260829_add_app_users.sql` in your Supabase project's SQL editor, then confirm `select * from app_users;` returns an empty table with no error." Wait for confirmation before continuing — later tasks assume this table exists.

- [ ] **Step 3: Also enable Google as an auth provider (manual, one-time)**

Report back: "In your Supabase dashboard: Authentication > Providers > Google — enable it and fill in your OAuth client id/secret (from Google Cloud Console). Confirm when done." This is required for `signInWithOAuth({ provider: 'google' })` to work; the app cannot configure this for you.

- [ ] **Step 4: Add the new env vars to `.env.example`**

Add this block, following the file's existing section style:

```
# ---------- Supabase Auth (login) ----------
# Same project as USER_SUPABASE_URL above. Get the service role key from
# Project Settings > API > service_role secret — NEVER expose this to the
# frontend, it bypasses row-level security.
USER_SUPABASE_SERVICE_ROLE_KEY=

# Frontend build-time vars (Vite requires the VITE_ prefix). Same project
# URL/anon key as USER_SUPABASE_URL / USER_SUPABASE_ANON_KEY above.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- [ ] **Step 5: Commit**

```bash
git add server/sql/migrations/20260829_add_app_users.sql .env.example
git commit -m "feat: add app_users table migration and auth env scaffolding"
```

---

## Task 2: Backend auth middleware (`server/auth.js`)

**Files:**
- Create: `server/auth.js`
- Modify: `server/index.js` (mount middleware, add admin-code route)

**Interfaces:**
- Consumes: `db.associates` (array of `{ id, email, locationId, locationIds, active, ... }`, from `server/db.js`'s in-memory `db`, already imported in `server/index.js` as `db`).
- Produces:
  - `requireAuth(req, res, next)` — sets `req.authUser = { userId, email, role, associateId, locationIds }` or responds 401/403.
  - `scopeLocation(req, res, next)` — mutates `req.query`/`req.body` for agents.
  - `blockAgentWrite(req, res, next)` — 403s for `role === 'agent'`.
  - `adminCodeHandler(req, res)` — Express handler for `POST /api/auth/admin-code`.
  - All exported from `server/auth.js`.

- [ ] **Step 1: Write `server/auth.js`**

```js
// server/auth.js
// Verifies the Supabase session on every API request and resolves the
// caller's role + location scope. Agents' locationIds are always
// recomputed from their matched associate row — never trusted from the
// client — so a forged query param can't widen access.
import { createClient } from '@supabase/supabase-js'

const ADMIN_CODE = '9818'

let serviceClient = null
function getServiceClient() {
  if (serviceClient) return serviceClient
  const url = (process.env.USER_SUPABASE_URL || '').trim()
  const key = (process.env.USER_SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !key) return null
  serviceClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return serviceClient
}

async function resolveAppUser(client, userId, email) {
  const { data: existing, error: readErr } = await client
    .from('app_users').select('role').eq('user_id', userId).maybeSingle()
  if (readErr) throw new Error(`app_users read failed: ${readErr.message}`)
  if (existing) return existing.role
  const { error: insertErr } = await client
    .from('app_users').insert({ user_id: userId, email, role: 'agent' })
  if (insertErr) throw new Error(`app_users insert failed: ${insertErr.message}`)
  return 'agent'
}

function findAssociateByEmail(db, email) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return null
  return db.associates.find(a => String(a.email || '').trim().toLowerCase() === target) || null
}

export function locationIdsOf(associate) {
  if (!associate) return []
  return [...new Set((associate.locationIds || [associate.locationId]).filter(Boolean))]
}

export function requireAuth(db) {
  return async (req, res, next) => {
    const client = getServiceClient()
    if (!client) return res.status(500).json({ error: 'Auth not configured: USER_SUPABASE_SERVICE_ROLE_KEY missing' })

    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Missing bearer token' })

    const { data: userRes, error: userErr } = await client.auth.getUser(token)
    if (userErr || !userRes?.user) return res.status(401).json({ error: 'Invalid or expired session' })
    const { id: userId, email } = userRes.user

    let role
    try {
      role = await resolveAppUser(client, userId, email)
    } catch (e) {
      return res.status(502).json({ error: e.message })
    }

    const associate = findAssociateByEmail(db, email)
    const locationIds = role === 'admin' ? null : locationIdsOf(associate)

    req.authUser = { userId, email, role, associateId: associate?.id || null, locationIds }
    next()
  }
}

// Overwrites (never merely defaults) the location/associate filters on the
// request for agents, so a client can't ask for a different location than
// the one their associate record grants.
export function scopeLocation(req, res, next) {
  const { role, associateId, locationIds } = req.authUser
  if (role === 'admin') return next()

  const isInbox = req.path.startsWith('/api/inbox')
  if (isInbox) {
    req.query.associate = associateId || '__none__'
  } else {
    const value = (locationIds && locationIds.length) ? locationIds.join(',') : '__none__'
    req.query.locationId = value
    if (req.body && typeof req.body === 'object') req.body.locationId = value
  }
  next()
}

export function blockAgentWrite(req, res, next) {
  if (req.authUser.role === 'agent') return res.status(403).json({ error: 'Agents cannot perform this action' })
  next()
}

export function adminCodeHandler(req, res) {
  const client = getServiceClient()
  if (!client) return res.status(500).json({ error: 'Auth not configured' })
  const code = String(req.body?.code || '').trim()
  if (code !== ADMIN_CODE) return res.status(400).json({ error: 'Invalid admin code' })

  client.from('app_users').update({ role: 'admin' }).eq('user_id', req.authUser.userId)
    .then(({ error }) => {
      if (error) return res.status(502).json({ error: error.message })
      res.json({ role: 'admin' })
    })
}
```

- [ ] **Step 2: Mount the middleware in `server/index.js`**

Find the block around `server/index.js:66-67` (`app.use(express.json(...))` / `app.use(express.urlencoded(...))`) and the import list at the top. Add the import next to the other `import * as X from './x.js'` lines (near line 15, after `import * as supabase from './supabaseStore.js'`):

```js
import { requireAuth, scopeLocation, blockAgentWrite, adminCodeHandler } from './auth.js'
```

Immediately after the `express.urlencoded` line (currently `server/index.js:67`), add:

```js
// Public health check stays unauthenticated; everything else under /api
// requires a verified Supabase session.
app.get('/api/auth/whoami', requireAuth(db), (req, res) => res.json(req.authUser))
app.post('/api/auth/admin-code', requireAuth(db), adminCodeHandler)
app.use('/api', (req, res, next) => {
  if (req.path === '/runtime') return next()
  requireAuth(db)(req, res, (err) => {
    if (err) return next(err)
    scopeLocation(req, res, next)
  })
})
app.delete('/api/leads/bulk', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/leads/import/parse', (req, res, next) => blockAgentWrite(req, res, next))
app.post('/api/leads/import/apply', (req, res, next) => blockAgentWrite(req, res, next))
```

Note: Express matches middleware in registration order and does not stop later route handlers with the same path from also running, so these three `blockAgentWrite` lines must be registered **before** the real `app.delete('/api/leads/bulk', ...)` / `app.post('/api/leads/import/...', ...)` handlers further down the file (they currently start at lines ~604, ~1206, ~1222 — leave those definitions where they are, just ensure the guard lines above are added earlier in the file, right after the `app.use('/api', ...)` block).

- [ ] **Step 3: Extend `applyFilters` to accept a comma-joined `locationId` list**

In `server/index.js`, find `function applyFilters(list, q) {` (~line 367) and its line `if (q.locationId) out = out.filter(l => l.locationId === q.locationId)`. Replace that one line with:

```js
  if (q.locationId) {
    const ids = String(q.locationId).split(',').filter(Boolean)
    out = out.filter(l => ids.includes(l.locationId))
  }
```

- [ ] **Step 4: Add `locationId` filtering to `GET /api/associates`**

Find `app.get('/api/associates', (req, res) => res.json(db.associates))` (~line 341). Replace with:

```js
app.get('/api/associates', (req, res) => {
  if (!req.query.locationId) return res.json(db.associates)
  const ids = String(req.query.locationId).split(',').filter(Boolean)
  res.json(db.associates.filter(a => associateInLocation(a, ids[0]) || ids.some(id => associateInLocation(a, id))))
})
```

- [ ] **Step 5: Include `authUser` in `/api/bootstrap`**

In the `app.get('/api/bootstrap', ...)` handler (~line 270), add `authUser: req.authUser,` as the first key of the returned object.

- [ ] **Step 6: Manual verification (no test framework in this repo)**

Start the server (`npm run server`) and confirm the app still boots without a Supabase session configured causing a crash on unrelated routes:

```bash
curl -s http://localhost:3001/api/runtime
# Expected: {"app":"physique57-leads",...} — still public, no auth required

curl -s http://localhost:3001/api/bootstrap
# Expected: {"error":"Missing bearer token"} with HTTP 401 — auth now required
```

- [ ] **Step 7: Commit**

```bash
git add server/auth.js server/index.js
git commit -m "feat: add Supabase auth middleware with role + location scoping"
```

---

## Task 3: Frontend Supabase client + login page

**Files:**
- Create: `src/lib/supabaseClient.js`
- Create: `src/pages/LoginPage.jsx`

**Interfaces:**
- Produces: `supabase` (default export) from `src/lib/supabaseClient.js`, a configured Supabase JS client.
- Produces: `LoginPage` (default export) from `src/pages/LoginPage.jsx` — a self-contained component with no required props; on successful auth it does nothing itself (the caller, wired in Task 4, listens to `supabase.auth.onAuthStateChange`).

- [ ] **Step 1: Write `src/lib/supabaseClient.js`**

```js
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — login will not work until .env is configured')
}

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder')
export default supabase
```

- [ ] **Step 2: Write `src/pages/LoginPage.jsx`**

```jsx
import React, { useState } from 'react'
import { Mail, Lock, ShieldCheck, Loader2, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

async function claimAdminCode(code) {
  if (!code.trim()) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  await fetch('/api/auth/admin-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ code: code.trim() })
  })
}

export default function LoginPage() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [adminCode, setAdminCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password })
        if (err) throw err
        await claimAdminCode(adminCode)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const withGoogle = async () => {
    setError('')
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google' })
      if (err) throw err
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-blob login-blob-1" />
      <div className="login-blob login-blob-2" />
      <div className="login-blob login-blob-3" />

      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">P57</div>
          <div>
            <div className="login-brand-name">Lead Studio</div>
            <div className="login-brand-sub">Physique 57</div>
          </div>
        </div>

        <div className="login-tabs">
          <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Sign up</button>
        </div>

        <form onSubmit={submit} className="login-form">
          <label className="login-field">
            <Mail size={15} />
            <input type="email" required placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label className="login-field">
            <Lock size={15} />
            <input type="password" required minLength={6} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          {mode === 'signup' && (
            <>
              <label className="login-field">
                <Lock size={15} />
                <input type="password" required minLength={6} placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              </label>
              <label className="login-field login-field-optional">
                <ShieldCheck size={15} />
                <input type="text" placeholder="Admin code (optional)" value={adminCode} onChange={e => setAdminCode(e.target.value)} />
              </label>
            </>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <>{mode === 'signin' ? 'Sign in' : 'Create account'} <ArrowRight size={15} /></>}
          </button>
        </form>

        <div className="login-divider"><span>or</span></div>

        <button type="button" className="login-google" onClick={withGoogle} disabled={busy}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l6-6C34.6 5.5 29.6 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l6-6C34.6 6.5 29.6 4.5 24 4.5 16 4.5 9 8.9 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44.5c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.4c-2 1.5-4.6 2.5-7.6 2.5-5.4 0-9.9-3.4-11.5-8.2l-6.6 5.1C9 40 16 44.5 24 44.5z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2-2 3.7-3.7 5l6.6 5.4C41.5 35.7 44.5 30.3 44.5 24c0-1.2-.1-2.4-.3-3.5z"/>
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add login page styles to `src/index.css`**

Append to the end of `src/index.css`:

```css
.login-page {
  position: relative;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: radial-gradient(circle at 20% 20%, #1a1024 0%, #0a0a0f 60%);
}

.login-blob {
  position: absolute;
  border-radius: 9999px;
  filter: blur(80px);
  opacity: 0.45;
  animation: login-float 14s ease-in-out infinite;
}
.login-blob-1 { width: 420px; height: 420px; top: -100px; left: -80px; background: #f43f5e; animation-delay: 0s; }
.login-blob-2 { width: 380px; height: 380px; bottom: -120px; right: -60px; background: #6366f1; animation-delay: 3s; }
.login-blob-3 { width: 300px; height: 300px; bottom: 10%; left: 30%; background: #a855f7; animation-delay: 6s; }

@keyframes login-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(30px, -30px) scale(1.08); }
}

.login-card {
  position: relative;
  z-index: 1;
  width: 380px;
  padding: 32px 28px;
  border-radius: 24px;
  background: rgba(20, 20, 26, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(24px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  animation: login-card-in 0.5s ease-out;
}

@keyframes login-card-in {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.login-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.login-brand-mark {
  width: 44px; height: 44px; border-radius: 14px;
  background: linear-gradient(135deg, #f43f5e, #a855f7);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; color: white; font-size: 13px;
}
.login-brand-name { color: white; font-weight: 700; font-size: 15px; }
.login-brand-sub { color: #9ca3af; font-size: 11px; letter-spacing: 0.05em; }

.login-tabs { display: flex; gap: 4px; padding: 4px; background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 20px; }
.login-tabs button {
  flex: 1; padding: 8px; border-radius: 9px; border: none; background: transparent;
  color: #9ca3af; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s;
}
.login-tabs button.active { background: rgba(255,255,255,0.1); color: white; }

.login-form { display: flex; flex-direction: column; gap: 10px; }
.login-field {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 12px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  color: #9ca3af; transition: border-color 0.2s;
}
.login-field:focus-within { border-color: #f43f5e; }
.login-field input {
  flex: 1; background: transparent; border: none; outline: none;
  color: white; font-size: 13px;
}
.login-field-optional { opacity: 0.75; }

.login-error {
  color: #fca5a5; font-size: 12px; background: rgba(248,113,113,0.1);
  border: 1px solid rgba(248,113,113,0.2); border-radius: 10px; padding: 8px 10px;
}

.login-submit {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 11px; border-radius: 12px; border: none; margin-top: 6px;
  background: linear-gradient(135deg, #f43f5e, #ec4899);
  color: white; font-weight: 600; font-size: 13px; cursor: pointer;
  transition: transform 0.15s, opacity 0.15s;
}
.login-submit:hover:not(:disabled) { transform: translateY(-1px); }
.login-submit:disabled { opacity: 0.6; cursor: not-allowed; }

.login-divider { display: flex; align-items: center; gap: 10px; margin: 18px 0; color: #6b7280; font-size: 11px; }
.login-divider::before, .login-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.08); }

.login-google {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.03); color: #e5e7eb; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: background 0.15s;
}
.login-google:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
.login-google:disabled { opacity: 0.6; cursor: not-allowed; }
```

- [ ] **Step 4: Manual verification**

Run `npm run dev`, temporarily render `<LoginPage />` in place of the app root (or wait for Task 4 to wire it in) — confirm blobs animate, tab switch toggles fields, and submitting with an empty Supabase config shows the `login-error` box rather than crashing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseClient.js src/pages/LoginPage.jsx src/index.css
git commit -m "feat: add Supabase-backed login page with signup/Google OAuth"
```

---

## Task 4: Wire auth into `App.jsx`, `api.js`, `store.jsx`

**Files:**
- Modify: `src/api.js`
- Modify: `src/store.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabaseClient.js` (Task 3); `boot.authUser = { userId, email, role, associateId, locationIds }` from `/api/bootstrap` (Task 2, Step 5).
- Produces: `useApp()` gains `role`, `locationIds`, `associateId`, and `signOut()`; `App.jsx` no longer renders the shell without a session.

- [ ] **Step 1: Read `src/api.js` and add the auth header**

Read the file first (its exact current shape wasn't captured in the design doc). Locate the central `fetch`/request helper the `api.get/post/put/delete/patch` methods funnel through, and before the request is sent, add:

```js
import { supabase } from './lib/supabaseClient.js'
// ...inside the shared request function, before building fetch options:
const { data: { session } } = await supabase.auth.getSession()
const authHeaders = session ? { Authorization: `Bearer ${session.access_token}` } : {}
```

Merge `authHeaders` into whatever headers object is already being sent (do not remove the existing `Content-Type: application/json` header logic — merge additively).

- [ ] **Step 2: Read `src/store.jsx` and expose auth fields**

Read the file to find where `boot` is stored and what `useApp()` currently returns. Add to the returned context value:

```js
role: boot?.authUser?.role || 'agent',
locationIds: boot?.authUser?.locationIds || [],
associateId: boot?.authUser?.associateId || null,
signOut: () => supabase.auth.signOut()
```

(Import `supabase` from `./lib/supabaseClient.js` at the top of the file.)

- [ ] **Step 3: Modify `App.jsx` to gate on session**

In `src/App.jsx`, add the import:

```js
import { useEffect, useState as useState2 } from 'react' // if useState isn't already imported with this name, just extend the existing `useState` import
import { supabase } from './lib/supabaseClient.js'
import LoginPage from './pages/LoginPage.jsx'
```

(Use the file's existing `React, { useState }` import — add `useEffect` to it instead of aliasing.)

Change the default export:

```jsx
export default function App() {
  const [addOpen, setAddOpen] = useState(false)
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (authLoading) return <AppLoader />
  if (!session) return <LoginPage />

  return (
    <AppProvider>
      <BootstrapGate>
        <div className="h-screen flex overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <Topbar onAdd={() => setAddOpen(true)} />
            <main className="flex-1 overflow-y-auto scrollbar-thin">
              <MarqueeBanner />
              <Shell />
            </main>
          </div>
        </div>
      </BootstrapGate>
      <LeadDrawer />
      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} />
      <Toasts />
    </AppProvider>
  )
}
```

- [ ] **Step 4: Add a sign-out button to `Topbar`**

In `Topbar` (still `App.jsx`), add a `LogOut` icon import from `lucide-react` and a button next to the theme toggle:

```jsx
<button
  className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
  onClick={() => useApp().signOut()}
  title="Sign out"
>
  <LogOut size={16} />
</button>
```

Note: hooks can't be called inside a JSX event handler like that — instead destructure `signOut` at the top of `Topbar` alongside the existing `useApp()` call (`const { view, navigate, alerts, boot, theme, setTheme, refreshData, toast, signOut } = useApp()`) and reference `signOut` directly in `onClick={signOut}`.

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```
Open the browser: confirm the login page renders first, signing up creates a session and the app shell appears, and the sign-out button returns you to the login page.

- [ ] **Step 6: Commit**

```bash
git add src/api.js src/store.jsx src/App.jsx
git commit -m "feat: gate app on Supabase session, attach bearer token to API calls"
```

---

## Task 5: Frontend role-based UI gating

**Files:**
- Modify: `src/App.jsx` (Sidebar NAV filtering)
- Modify: `src/pages/Leads.jsx`
- Modify: `src/pages/Team.jsx`
- Modify: `src/pages/Settings.jsx`
- Modify: `src/pages/Inbox.jsx`
- Modify: `src/pages/MomenceSchedule.jsx`
- Modify: `src/pages/Performance.jsx`
- Modify: `src/pages/StudioWeekly.jsx`
- Modify: `src/pages/StudioMonthly.jsx`

**Interfaces:**
- Consumes: `role`, `locationIds` from `useApp()` (Task 4).

This task is UI polish, not the security boundary (Task 2 already enforces scoping server-side) — read each file before editing to match its existing patterns; these are illustrative diffs, not exact line numbers.

- [ ] **Step 1: Hide "Import CSV" nav item for agents**

In `App.jsx`'s `Sidebar`, change:
```js
const { view, navigate, boot, alerts, sidebarCollapsed, toggleSidebar } = useApp()
```
to also destructure `role`, and filter the nav list before rendering:
```js
const visibleNav = NAV.filter(item => role === 'admin' || item.id !== 'import')
```
Render `visibleNav.map(...)` instead of `NAV.map(...)`.

- [ ] **Step 2: Lock the location filter in `Leads.jsx` and hide bulk-delete/import affordances**

Read `src/pages/Leads.jsx`. Wherever the location-filter `<select>` is rendered, destructure `role, locationIds` from `useApp()` and:
```jsx
<select value={locationFilter} onChange={...} disabled={role === 'agent'}>
```
When `role === 'agent'`, initialize that filter state to `locationIds[0] || ''` instead of `''`. Find any "Delete selected" / bulk-delete button and wrap it: `{role !== 'agent' && <button ...>Delete</button>}`.

- [ ] **Step 3: Lock `Team.jsx` to the agent's own location(s)**

Read `src/pages/Team.jsx`. Filter the associates list rendered to `associates.filter(a => role === 'admin' || (a.locationIds || [a.locationId]).some(id => locationIds.includes(id)))`, and hide any "Add associate" / "Edit location" controls when `role === 'agent'`.

- [ ] **Step 4: Reduce `Settings.jsx` tabs for agents**

Read `src/pages/Settings.jsx`, find the `TABS` const (currently: General, Appearance, Lead config, Teams, Alerts & AI, Integrations, Data). Change the render to:
```js
const { role } = useApp()
const AGENT_TABS = ['General', 'Appearance']
const visibleTabs = TABS.filter(t => role === 'admin' || AGENT_TABS.includes(t.label || t.name || t))
```
(Match whichever property `TABS` entries actually use — read the file to confirm the shape before writing this filter.)

- [ ] **Step 5: Lock `Inbox.jsx`'s associate/studio filters for agents**

Read `src/pages/Inbox.jsx` around its `associate`/`studio` state (per the earlier exploration, around line 242). For agents, force `associate` to `associateId` from `useApp()` on mount and disable that filter's dropdown; hide/disable the `studio` dropdown too since agent inbox scoping is by associate, not location.

- [ ] **Step 6: Lock location filters in `MomenceSchedule.jsx`, `Performance.jsx`, `StudioWeekly.jsx`, `StudioMonthly.jsx`**

Read each file, find its studio/location filter control, and apply the same pattern as Step 2: `disabled={role === 'agent'}`, defaulted to `locationIds[0]` for agents.

- [ ] **Step 7: Manual verification**

With an agent-role test account (sign up with no admin code) and an admin-role test account (sign up, then enter `9818` as the admin code), open each page in the browser and confirm:
- Agent: Import CSV nav item is gone; Leads/Team/Performance/weekly/monthly/Calendar location filters are locked to one studio and show only that studio's data; Settings shows only General + Appearance; Inbox shows only conversations assigned to that agent's own email; bulk-delete/import buttons are gone.
- Admin: everything is visible and unfiltered.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/pages/Leads.jsx src/pages/Team.jsx src/pages/Settings.jsx src/pages/Inbox.jsx src/pages/MomenceSchedule.jsx src/pages/Performance.jsx src/pages/StudioWeekly.jsx src/pages/StudioMonthly.jsx
git commit -m "feat: gate UI by role — hide import/delete and lock location filters for agents"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full manual walkthrough**

1. `npm run server` (with `USER_SUPABASE_SERVICE_ROLE_KEY` set) and `npm run dev` in a second terminal.
2. Sign up a brand-new email with no admin code → confirm role is `agent` and, if that email matches no `db.associates` row, every page shows empty data (not an error, not other studios' data).
3. Add that email to one `db.associates` row (via an existing admin session's Team page, or directly), sign out/in again → confirm Leads/Team/Performance/weekly/monthly/Calendar now show only that associate's location, and only that location.
4. Attempt `curl -X DELETE http://localhost:3001/api/leads/bulk -H "Authorization: Bearer <agent token>" -H "Content-Type: application/json" -d '{"ids":["x"]}'` → expect `403`.
5. Sign up a second email, enter `9818` as the admin code → confirm that account sees every location, every tab, and can import/delete.
6. Confirm `curl http://localhost:3001/api/bootstrap` with no Authorization header returns `401`, and with a valid admin token returns `authUser.role === "admin"` and `authUser.locationIds === null`.

- [ ] **Step 2: Report results to the user**

Summarize pass/fail for each of the 6 checks above before considering the feature complete.
