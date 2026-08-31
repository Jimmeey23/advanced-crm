# Momence Discount Code Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, market-scoped Momence discount-code CRUD and membership assignment for CRM agents and admins.

**Architecture:** Keep Momence dashboard authentication and private API access behind two focused Express-side modules. Expose allowlisted, CRM-authenticated routes, then add one React management page registered in existing navigation. Use Node's built-in test runner for server units and extract pure frontend helpers so form/status behavior is testable without adding a browser test framework.

**Tech Stack:** Node.js ESM, Express, native `fetch`, `node:test`, React 18, Vite, Lucide, existing CRM CSS system.

---

## File Map

- Create `server/momenceDashboardAuth.js`: login, TOTP generation, cookie merge/cache, authenticated request retry.
- Create `server/momenceDiscountCodes.js`: market policy, authorization, validation, normalization, and private Momence calls.
- Create `server/momenceDashboardAuth.test.js`: authentication unit coverage.
- Create `server/momenceDiscountCodes.test.js`: policy, payload, and normalization unit coverage.
- Modify `server/index.js`: register six authenticated proxy routes.
- Modify `package.json`: add targeted and aggregate Node test scripts and `otplib` dependency.
- Create `src/pages/discountCodeModel.js`: pure editor/status/date helpers.
- Create `src/pages/discountCodeModel.test.js`: frontend-model unit coverage using Node.
- Create `src/pages/DiscountCodes.jsx`: complete management page and dialogs.
- Modify `src/App.jsx`: navigation, import, rendering, and page-specific marquee behavior.
- Modify `src/components/CommandPalette.jsx`: register the new page.
- Modify `src/index.css`: effective final theme-aware feature styles.

### Task 1: Establish the test runner and authentication contract

**Files:**
- Modify: `package.json`
- Create: `server/momenceDashboardAuth.test.js`

- [ ] **Step 1: Add the test scripts and dependency declaration**

Add these scripts:

```json
"test": "node --test server/*.test.js src/pages/*.test.js",
"test:momence-discounts": "node --test server/momenceDashboardAuth.test.js server/momenceDiscountCodes.test.js src/pages/discountCodeModel.test.js"
```

Add `"otplib": "^12.0.1"` to dependencies, then run `npm install` so `package-lock.json` is updated.

- [ ] **Step 2: Write failing cookie and configuration tests**

Create tests that import `mergeCookieHeaders`, `dashboardAuthConfig`, and `createMomenceDashboardClient` and assert:

```js
assert.equal(
  mergeCookieHeaders(['challenge=one; Path=/'], ['challenge=two; Path=/', 'ribbon.connect.sid=session; HttpOnly']),
  'challenge=two; ribbon.connect.sid=session'
)
assert.throws(
  () => dashboardAuthConfig({}),
  /USER_MOMENCE_DASHBOARD_EMAIL, USER_MOMENCE_DASHBOARD_PASSWORD, USER_MOMENCE_DASHBOARD_TOTP_SECRET/
)
```

Use an injected `fetchImpl` to assert two concurrent `request('/path')` calls cause one login and one MFA request, both receive the merged cookie, and a first 401 causes exactly one forced re-authentication and retry.

- [ ] **Step 3: Run the test and verify RED**

Run: `node --test server/momenceDashboardAuth.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `momenceDashboardAuth.js`.

- [ ] **Step 4: Commit the red tests**

```bash
git add package.json package-lock.json server/momenceDashboardAuth.test.js
git commit -m "test: define Momence dashboard auth contract"
```

### Task 2: Implement secure dashboard authentication

**Files:**
- Create: `server/momenceDashboardAuth.js`
- Test: `server/momenceDashboardAuth.test.js`

- [ ] **Step 1: Implement configuration and cookie helpers**

Export:

```js
export function dashboardAuthConfig(env = process.env) {
  const values = {
    email: String(env.USER_MOMENCE_DASHBOARD_EMAIL || '').trim(),
    password: String(env.USER_MOMENCE_DASHBOARD_PASSWORD || '').trim(),
    totpSecret: String(env.USER_MOMENCE_DASHBOARD_TOTP_SECRET || '').trim()
  }
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => ({
    email: 'USER_MOMENCE_DASHBOARD_EMAIL',
    password: 'USER_MOMENCE_DASHBOARD_PASSWORD',
    totpSecret: 'USER_MOMENCE_DASHBOARD_TOTP_SECRET'
  })[key])
  if (missing.length) throw new Error(`Momence dashboard authentication is not configured: ${missing.join(', ')}`)
  return values
}
```

Implement `mergeCookieHeaders(...sources)` using a `Map`, retaining only each `name=value` pair and letting later responses replace earlier cookies of the same name.

- [ ] **Step 2: Implement the injected authenticated client**

`createMomenceDashboardClient({ fetchImpl = fetch, env = process.env, generateTotp })` must expose `request(path, init)`. It must:

1. POST JSON login data to `https://api.momence.com/auth/login`.
2. Generate TOTP only after login returns.
3. POST MFA JSON to `https://api.momence.com/auth/mfa/totp/verify` with login cookies.
4. Cache merged login/MFA cookies in module memory.
5. Reuse one in-flight login promise for concurrent calls.
6. send requests only to `https://momence.com` paths received from the allowlisted service module;
7. retry once after 401/403 with cache cleared;
8. throw safe errors containing status and Momence's short error message, never request headers or credentials.

Use `authenticator.generate(config.totpSecret)` from `otplib` as the default `generateTotp`.

- [ ] **Step 3: Run authentication tests and verify GREEN**

Run: `node --test server/momenceDashboardAuth.test.js`

Expected: all authentication tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/momenceDashboardAuth.js server/momenceDashboardAuth.test.js
git commit -m "feat: authenticate Momence dashboard requests securely"
```

### Task 3: Define market authorization, payload validation, and normalization

**Files:**
- Create: `server/momenceDiscountCodes.test.js`
- Create: `server/momenceDiscountCodes.js`

- [ ] **Step 1: Write failing service tests**

Cover these exported pure functions:

```js
assert.equal(hostIdForMarket('mumbai'), '13752')
assert.equal(hostIdForMarket('blr'), '33905')
assert.throws(() => hostIdForMarket('other'), /Unknown Momence market/)

assert.deepEqual(marketsForAuthUser({ role: 'admin', locationIds: null }), ['mumbai', 'blr'])
assert.deepEqual(
  marketsForAuthUser({ role: 'agent', locationIds: ['loc_supreme', 'loc_indiranagar'] }, locations),
  ['mumbai', 'blr']
)
assert.throws(() => assertMarketAccess(agent, 'blr', mumbaiOnlyLocations), /not authorized/)
```

Test `serializeDiscountCode` with percentage and fixed inputs, unknown keys, invalid dates, invalid percentages, duplicate/invalid membership IDs, and preservation of all assignment arrays. Test `normalizeMemberships` against array, `{items: []}`, and `{data: []}` response shapes and duplicate IDs across subscription/package calls.

- [ ] **Step 2: Run service tests and verify RED**

Run: `node --test server/momenceDiscountCodes.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement pure policy and model helpers**

Add immutable host mapping:

```js
export const DISCOUNT_HOSTS = Object.freeze({ mumbai: '13752', blr: '33905' })
```

Map an auth user's assigned `locationIds` through actual `db.locations` names/cities: Bengaluru/Indiranagar/Kenkere/Copper/Plash map to `blr`; all known Mumbai studios map to `mumbai`. Admin receives both. Empty agent scope receives none. `assertMarketAccess` must reject before any upstream call.

`serializeDiscountCode(input)` returns only the exact Momence fields from the spec, converts blank optionals to `null`, makes membership IDs unique positive integers, and rejects unknown top-level keys.

- [ ] **Step 4: Implement private API operations**

Export `createDiscountCodeService({ client })` with:

```js
list(market, includeExpired)
memberships(market)
create(market, input)
update(market, id, input)
setEnabled(market, id, input, enabled)
remove(market, id)
```

Use `URLSearchParams` for both membership queries so `type[]` is encoded correctly. `setEnabled` serializes the supplied complete current code and sets `expiresAt` to `new Date().toISOString()` when disabling or `null` when enabling. All mutation requests use `content-type: application/json` and a fresh `crypto.randomUUID()` in `x-idempotence-key` for POST/PUT.

- [ ] **Step 5: Run service tests and verify GREEN**

Run: `node --test server/momenceDiscountCodes.test.js`

Expected: all policy, validation, normalization, and request-shape tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/momenceDiscountCodes.js server/momenceDiscountCodes.test.js
git commit -m "feat: add scoped Momence discount code service"
```

### Task 4: Add authenticated Express routes

**Files:**
- Modify: `server/index.js`
- Modify: `server/momenceDiscountCodes.test.js`

- [ ] **Step 1: Add failing handler tests**

Extract and export `createDiscountCodeHandlers({ service, getDb })` from `momenceDiscountCodes.js`. Test handlers with minimal request/response doubles:

```js
const req = { authUser: agent, query: { market: 'blr' }, body: validCode, params: {} }
await handlers.create(req, res)
assert.equal(res.statusCode, 403)
assert.equal(serviceCalls.length, 0)
```

Cover admin access, dual-market agent access, invalid IDs, normalized `{ codes }`/`{ memberships }` responses, status body requiring a boolean `enabled`, and safe 400/403/502 mapping.

- [ ] **Step 2: Run and verify RED**

Run: `node --test server/momenceDiscountCodes.test.js`

Expected: handler-contract assertions fail because the factory is absent.

- [ ] **Step 3: Implement and register handlers**

Instantiate the dashboard client and discount service once in `server/index.js`, then register:

```js
app.get('/api/momence-discount-codes', discountHandlers.list)
app.get('/api/momence-discount-codes/memberships', discountHandlers.memberships)
app.post('/api/momence-discount-codes', discountHandlers.create)
app.put('/api/momence-discount-codes/:id', discountHandlers.update)
app.post('/api/momence-discount-codes/:id/status', discountHandlers.setEnabled)
app.delete('/api/momence-discount-codes/:id', discountHandlers.remove)
```

Register the static `/memberships` route before `/:id` patterns. Do not apply `blockAgentWrite`; the handler's market authorization is the intended write policy.

- [ ] **Step 4: Verify routes**

Run:

```bash
node --test server/momenceDiscountCodes.test.js
node --check server/index.js
```

Expected: tests pass and syntax check exits 0.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/momenceDiscountCodes.js server/momenceDiscountCodes.test.js
git commit -m "feat: expose Momence discount code API"
```

### Task 5: Build and test frontend model helpers

**Files:**
- Create: `src/pages/discountCodeModel.test.js`
- Create: `src/pages/discountCodeModel.js`

- [ ] **Step 1: Write failing pure-model tests**

Test:

```js
assert.equal(discountCodeStatus({ expiresAt: '2026-08-30T00:00:00Z' }, now), 'expired')
assert.equal(discountCodeStatus({ validFrom: '2026-09-02T00:00:00Z' }, now), 'scheduled')
assert.equal(discountCodeStatus({}, now), 'active')
assert.equal(toDateTimeLocal('2026-08-31T02:38:00.000Z', 'Asia/Kolkata'), '2026-08-31T08:08')
assert.deepEqual(emptyDiscountCode(), expectedDefaults)
assert.deepEqual(toEditorModel(upstreamCode), expectedEditorFields)
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/pages/discountCodeModel.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement helpers and verify GREEN**

Implement `emptyDiscountCode`, `toEditorModel`, `toApiPayload`, `discountCodeStatus`, `discountLabel`, `toDateTimeLocal`, and `fromDateTimeLocal`. Keep timezone conversion explicit and never truncate a UTC ISO string as a substitute for local time.

Run: `node --test src/pages/discountCodeModel.test.js`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/discountCodeModel.js src/pages/discountCodeModel.test.js
git commit -m "feat: add discount code editor model"
```

### Task 6: Implement the Discount Codes page

**Files:**
- Create: `src/pages/DiscountCodes.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/CommandPalette.jsx`

- [ ] **Step 1: Build data loading and authorization-aware market selection**

Use `boot.authUser.role`, `boot.authUser.locationIds`, and `boot.locations` to derive the same visible market list for presentation, while treating server authorization as authoritative. Load codes and memberships in parallel for the selected market:

```js
const [codeData, membershipData] = await Promise.all([
  api.get(`/api/momence-discount-codes?market=${market}&includeExpired=true`),
  api.get(`/api/momence-discount-codes/memberships?market=${market}`)
])
```

Abort stale state writes when market changes or the component unmounts. Render skeleton, retry, empty, and configuration/authentication error states.

- [ ] **Step 2: Build the compact table and actions**

Render searchable rows with code, description, discount, active/scheduled/expired badge, date range, usage, membership count/names, and an overflow action menu. Disable action buttons while the selected mutation is in flight. Status changes POST `{ enabled, code: toApiPayload(row) }`. Delete requires typing or explicitly confirming the code name.

- [ ] **Step 3: Build the shared create/edit dialog**

Use controlled fields for every design-spec property. Membership selection must include:

- search;
- subscription/package group headings;
- select visible, clear, selected count;
- membership ID as the submitted value;
- no client-created membership options.

On submit call POST for create or PUT `/:id` for edit. Keep the modal open with field/server errors on failure; close, toast, and reload only after success.

- [ ] **Step 4: Register navigation and command palette**

Import `BadgePercent` and `DiscountCodes`. Add `{ id: 'discount-codes', label: 'Discount codes', title: 'Momence Discount Codes', icon: BadgePercent }` after class schedule in Work, add the `Shell` case, and add the same page to command palette pages. Do not mark it admin-only.

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: Vite build succeeds; existing chunk-size warnings are acceptable, new compile errors are not.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DiscountCodes.jsx src/App.jsx src/components/CommandPalette.jsx
git commit -m "feat: add discount code management workspace"
```

### Task 7: Add polished theme-aware presentation

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add feature styles to the effective final cascade**

Add a `.discount-codes-page` namespace with compact header, market segmented control, metric strip, responsive table, status badges, action menu, two-column modal form, switch controls, membership selector, confirmation dialog, skeleton, and empty/error treatments. Use existing CSS variables and keep row height information-dense.

- [ ] **Step 2: Add explicit light-theme and responsive rules**

Verify text inside badges, menus, inputs, and membership rows—not only their shells—has sufficient foreground/background contrast. At widths below 820px, collapse the modal grid to one column and turn table rows into labeled cards without hiding actions.

- [ ] **Step 3: Run static verification**

Run:

```bash
npm run build
git diff --check
```

Expected: build succeeds and diff check has no output.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "style: polish discount code management"
```

### Task 8: Full verification and live-safe handoff

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run all automated checks**

```bash
npm test
node --check server/index.js
node --check server/momenceDashboardAuth.js
node --check server/momenceDiscountCodes.js
npm run build
git diff --check
```

Expected: all tests and checks pass; build may show only the repository's known chunk-size warning.

- [ ] **Step 2: Start both local processes**

Run `npm run server` and reuse an already-running API on port 3001 if startup reports `EADDRINUSE`. Run `npm run dev` for Vite. Confirm `/api/runtime` and the authenticated bootstrap flow before UI acceptance.

- [ ] **Step 3: Browser-check the rendered workflow**

Verify in dark and light themes:

1. admin can switch Mumbai/Bengaluru;
2. agent market options reflect assigned locations;
3. real subscription/package memberships load and search correctly;
4. create/edit validation is legible;
5. status and deletion confirmations explain consequences;
6. loading, empty, failure, and responsive states render correctly;
7. no cookie, OTP, or credential appears in browser network response bodies or console.

- [ ] **Step 4: Perform live mutation verification only with an approved disposable code**

Create a uniquely named short-lived test code, confirm it appears, edit it, disable it, re-enable it, and delete it. If no disposable code is approved, report CRUD as mocked/automated verification only and do not mutate Momence production data.

- [ ] **Step 5: Review final scope and status**

Run `git status --short` and `git log --oneline -10`. Confirm no secrets, generated auth backups, `.env` content, unrelated user changes, or temporary browser artifacts are staged.
