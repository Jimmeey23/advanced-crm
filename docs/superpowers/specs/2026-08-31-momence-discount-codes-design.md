# Momence Discount Code Management Design

## Purpose

Add a CRM workspace where authorized Physique 57 agents can create and manage Momence discount codes for their assigned market. Mumbai uses Momence host `13752`; Bengaluru uses host `33905`. Admins can access both markets. Agents can access only markets represented by their CRM studio assignments.

## Scope

The feature includes:

- listing current and expired discount codes;
- creating percentage or fixed-value codes;
- editing every supported discount-code field;
- disabling a code by expiring it immediately;
- enabling an expired code by clearing its expiry unless the agent supplies a new expiry;
- deleting a code after explicit confirmation;
- loading active subscription and package memberships from Momence;
- assigning any combination of those memberships to a code;
- dynamically obtaining and refreshing a Momence dashboard session through login and TOTP MFA.

Event, session-template, product, video, appointment-service, and course assignment selectors are outside this release. Their payload arrays remain empty and are preserved safely when Momence returns them on an existing code.

## User Experience

A new `Discount Codes` destination appears in the Work navigation group. The page uses the CRM's existing compact, high-contrast visual language.

The page header contains market selection, search, refresh, and `Create discount code`. Admins may switch between Mumbai and Bengaluru. Agents see only their authorized market; an agent assigned to studios across both markets may switch between those two markets.

The main table displays code, discount, validity, usage, membership scope, and status. Actions provide edit, disable/enable, and delete. Destructive deletion requires a confirmation step naming the code. Empty, loading, authentication failure, and upstream Momence failure states are explicit.

Create and edit use one modal with these groups:

1. Code identity: code and description.
2. Discount: percentage or fixed value and currency-aware validation.
3. Validity: optional start and expiry dates.
4. Limits: unlimited toggle, per-code/global usage limits, and renewal limit.
5. Eligibility: new-customer-only and gift-card flags.
6. Membership scope: searchable multi-select grouped into subscriptions and packages.

The disable action states that it expires the code immediately. Re-enable states that it clears the expiry unless the agent chooses a replacement expiry in the editor.

## Architecture

### Frontend

`src/pages/DiscountCodes.jsx` owns page state, filtering, market selection, CRUD dialogs, membership selection, confirmations, and API error presentation. `src/App.jsx` registers the navigation item and renders the page. The command palette receives the same destination. Feature-specific CSS is added to the effective final section of `src/index.css` and supports dark and light themes.

The browser sends only the selected authorized market and validated business fields. It never receives Momence credentials, session cookies, TOTP secrets, or raw upstream headers.

### Server

`server/momenceDashboardAuth.js` implements the reusable dashboard authentication boundary:

- reads login email, password, and TOTP secret exclusively from environment variables;
- calls Momence login followed by TOTP verification;
- combines cookies from both responses by cookie name;
- caches the cookie header in process memory only;
- deduplicates concurrent login attempts;
- retries an upstream request once after a 401 or 403 with a fresh session;
- redacts sensitive values from logs and errors.

No logic that writes tokens, cookies, response bodies, `.env` files, or backup files is copied from the reference script. No credentials from the supplied cURL examples or the reference file are retained in source control.

`server/momenceDiscountCodes.js` owns host allowlisting, upstream request construction, response normalization, validation, and payload serialization. It supports only the fixed hosts `13752` and `33905` and the known discount-code and membership paths.

`server/index.js` exposes authenticated CRM routes:

- `GET /api/momence-discount-codes?market=...&includeExpired=...`
- `GET /api/momence-discount-codes/memberships?market=...`
- `POST /api/momence-discount-codes?market=...`
- `PUT /api/momence-discount-codes/:id?market=...`
- `POST /api/momence-discount-codes/:id/status?market=...`
- `DELETE /api/momence-discount-codes/:id?market=...`

Every route derives allowed markets from the authenticated CRM user's role and assigned location IDs. The server rejects unknown markets, unauthorized markets, invalid numeric IDs, unknown payload keys, and invalid limits/dates before contacting Momence.

### Momence Requests

For the selected allowlisted host, listing uses `GET /_api/primary/host/:hostId/discount-codes?includeExpired=true`. Create uses `POST /discount-codes`; edit uses `PUT /discount-codes/:id`; delete uses `DELETE /discount-codes/:id`.

Membership loading performs both active queries and merges them by membership ID:

- `type=subscription&disabled=false&placeSharedLast=true`
- `type[]=package-events&type[]=package-money&disabled=false&placeSharedLast=true`

The dashboard cookie is sent server-to-server. Browser-only tracing, Sentry, Stripe, Intercom, Mixpanel, client-hint, and copied user-agent headers are omitted.

## Data and Validation

The normalized editor model contains:

- `type`: `percentage` or `fixed`;
- `discountPercentage` or `discountValue`, mutually exclusive;
- `code`, trimmed and non-empty;
- optional `description`;
- `isUnlimited`, `usageAmount`, and `usageAmountGlobal`;
- optional `numberOfRenewalsDiscountIsValidFor`;
- optional `validFrom` and `expiresAt` ISO timestamps;
- `isUsableForGiftCards` and `isNewCustomersOnly`;
- `assignedMemberships`, a unique array of positive integer IDs;
- preserved assignment arrays for unsupported resource types when editing.

Percentage values must be greater than zero and at most 100. Fixed values and all limits must be non-negative, with positive usage limits when present. When both dates exist, expiry must be later than start. Code IDs and membership IDs must be positive integers.

Disable fetches or uses the current normalized code, sets `expiresAt` to the current server time, and submits the complete edit payload. Enable clears `expiresAt`. These semantics are visible in the UI because Momence supplied no separate enabled/disabled endpoint.

## Error Handling

Configuration failures identify missing environment-variable names without echoing values. Authentication failures return a generic actionable message. Upstream validation errors are normalized into safe user-facing text. Network and 5xx errors do not optimistically update the table. After successful mutations, the page reloads the selected market. Delete and status mutations remain disabled while in flight to prevent duplicates.

## Security

- Dashboard credentials and the TOTP secret remain server-side environment values.
- Session cookies are memory-only and never persisted or returned to clients.
- Hosts and upstream paths are server allowlists, preventing SSRF and cross-host access.
- Existing CRM authentication applies to all proxy routes.
- Agent market access is enforced server-side, not only hidden in the UI.
- Mutation payloads use an explicit schema and discard unknown keys.
- Logs contain operation, market, and safe status only; they contain no cookie, OTP, password, or raw Momence response.

The existing hardcoded credentials in the external reference script are not copied. They should be rotated independently because they were present in plaintext outside this repository.

## Testing and Verification

Automated tests cover:

- cookie parsing/merging, cache reuse, concurrent-login deduplication, and one-time 401/403 refresh;
- environment configuration errors without secret leakage;
- market-to-host mapping and agent/admin authorization;
- membership response normalization and deduplication;
- payload validation and complete Momence serialization;
- list/create/edit/status/delete route behavior;
- percentage, fixed-value, date, limit, and membership-ID edge cases.

Verification includes targeted tests, full existing tests, server syntax checks, production build, and browser checks in both themes for admin market switching, agent restrictions, form validation, membership search/selection, CRUD refresh, confirmations, loading, and error states. Live Momence mutations are performed only with explicit test-code details and are cleaned up after verification.

## Environment Variables

The server reads these values:

- `USER_MOMENCE_DASHBOARD_EMAIL`
- `USER_MOMENCE_DASHBOARD_PASSWORD`
- `USER_MOMENCE_DASHBOARD_TOTP_SECRET`

One dashboard identity is used for both allowlisted hosts. If later operations prove that host-specific identities are required, this can be extended with market suffixes without changing the frontend API.

## Success Criteria

The feature is complete when an agent can access only their assigned market, load real Momence memberships, create a scoped code, edit it, expire/re-enable it with the documented semantics, and delete it; an admin can do the same for either market; no dashboard secret reaches browser or disk; and automated plus rendered-flow verification passes.
