# Supabase auth + role-based location scoping

## Goal
Add a Supabase-backed login page (email/password + Google OAuth). Every new
user defaults to `agent` role, scoped to their own location(s). Entering
mastercode `9818` (at signup or later) grants `admin`, which is unrestricted.

## Data model
New Supabase table `app_users`:
- `user_id uuid primary key` (= `auth.users.id`)
- `email text not null`
- `role text not null default 'agent'` (`'agent' | 'admin'`)
- `created_at timestamptz default now()`

No new table for location mapping — an agent's location(s) are derived by
matching `app_users.email` (case-insensitive) against `db.associates[].email`,
reusing `associate.locationIds || [associate.locationId]`. An agent whose
email matches no associate has `locationIds = []` (sees nothing, not an
error).

## Backend (server/)
### `server/auth.js` (new)
- `requireAuth` middleware, mounted on all `/api/*` routes:
  - Reads `Authorization: Bearer <token>`. No/invalid token → 401.
  - `supabase.auth.getUser(token)` → email. Upserts `app_users` row
    (default `role='agent'`) if missing.
  - Finds matching associate by email (case-insensitive); derives
    `locationIds` (empty array if no match).
  - Sets `req.authUser = { email, role, associateId, locationIds }`.
  - Uses a service-role Supabase client (server-side env var
    `SUPABASE_SERVICE_ROLE_KEY`) so `app_users` writes bypass RLS safely —
    the anon key must never grant role self-elevation.
- `scopeLocation` middleware, mounted after `requireAuth`:
  - `role === 'admin'` → no-op.
  - `role === 'agent'`:
    - Overwrites `req.query.locationId` / `req.body.locationId` with the
      agent's `locationIds` (comma-joined if the filter supports a list, else
      first id — see per-endpoint note below).
    - For `/api/inbox*` routes specifically, overwrites `req.query.associate`
      with `req.authUser.associateId` instead (so inbox scoping is by
      respond.io assignee-email match via the existing
      `resolveAssigneeId`, per spec, not by location).
- `POST /api/auth/admin-code` (new route): body `{ code }`. If
  `code === '9818'`, update caller's own `app_users.role = 'admin'`. Else
  400. No other way for a client to set role.
- Import/delete guard: `requireAuth` (or a small `blockAgentWrite` helper)
  returns 403 for `role === 'agent'` on:
  - `POST /api/leads/import/parse`
  - `POST /api/leads/import/apply`
  - `DELETE /api/leads/bulk`

### Existing handlers (server/index.js) — minimal edits
- `applyFilters` / location-scoped analytics helpers (`periodFunnel`,
  `periodChannelPerformance`, `periodRevenueMix`, `periodCohortConversion`,
  associate leaderboard, team analytics, momence schedule query) already
  accept a `locationId` query param — verify each one and extend any that
  only accept a single id to also accept a `locationIds` array param, since
  `scopeLocation` needs to pass multiple ids for a multi-location agent.
  Where extending isn't practical, filter the *response* instead of the
  query as a fallback (still server-enforced).
- `GET /api/associates`: add optional `locationId`/`locationIds` filter
  (currently returns all).
- `/api/boot`: include `authUser: { email, role, associateId, locationIds }`
  in the response so the frontend can gate UI without a second round trip.

## Frontend (src/)
### `src/lib/supabaseClient.js` (new)
`createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)`.

### `src/pages/LoginPage.jsx` (new)
- Full-screen, dark gradient + animated blurred blobs (CSS keyframes, no
  extra dependency), centered glass card.
- Tabs: Sign in / Sign up. Fields: email, password (+ confirm on sign-up,
  + optional "Admin code" input on sign-up).
- "Continue with Google" button → `supabase.auth.signInWithOAuth({provider:'google'})`.
- On successful sign-up with a non-empty admin code, call
  `POST /api/auth/admin-code` right after the session is established.
- Inline validation states, loading spinners, error toasts — matches
  existing app's card/button/input classes in `index.css` for visual
  consistency, layered with new animation classes.

### `App.jsx`
- `AppProvider` gains an auth gate: subscribe to
  `supabase.auth.onAuthStateChange`; no session → render `LoginPage`;
  session → existing shell. Sign-out control added to topbar/sidebar.

### `api.js`
- Every request attaches `Authorization: Bearer <session.access_token>`
  from the current Supabase session.

### `store.jsx`
- Expose `role`, `locationIds`, `authUser` from `boot.authUser` via
  `useApp()`.

### UI gating (defense-in-depth, not the security boundary)
- Sidebar (`App.jsx` `NAV`): hide "Import CSV" for `role==='agent'`.
- `Leads.jsx`, `Team.jsx`, `MomenceSchedule.jsx`, `Performance.jsx`,
  `StudioWeekly.jsx`, `StudioMonthly.jsx`: location filter dropdowns are
  locked to the agent's own location (disabled, pre-selected) instead of
  removed, so layout is unchanged.
- `Settings.jsx`: agents see a reduced `TABS` set — only tabs that are
  personal/appearance-scoped; org-wide tabs (Teams, Data, Integrations,
  Lead config, Alerts & AI) hidden for `role==='agent'`.
- `AddLeadModal`/bulk-delete controls in `Leads.jsx`: hidden for agents.
- `Inbox.jsx`: the `associate`/`studio` filter dropdowns are locked to the
  agent's own associate for agents.

## Out of scope
- Password reset flows beyond Supabase's default email link.
- Per-tab granular permission editing UI (mastercode is binary agent/admin).
- Revoking/downgrading admin from the UI (can be done directly in the
  `app_users` table if ever needed).

## Env vars (new)
- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Backend: `SUPABASE_SERVICE_ROLE_KEY` (in addition to existing
  `USER_SUPABASE_URL`/`USER_SUPABASE_ANON_KEY`).
