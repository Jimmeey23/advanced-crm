# Google Sheets lead import — design

## Goal

Let the app pull new lead rows out of a Google Sheet, deduplicated against
existing leads, without requiring a real user-login system (this app has
none — associates are a static list, not authenticated accounts).

## Scope decisions (confirmed with user)

- **Connection is a single org-wide config**, stored in `db.settings`
  exactly like Momence/Mailtrap/GPT today — not a per-login-user OAuth
  grant, since no login system exists. The Settings UI still runs a real
  Google OAuth consent screen ("connect your Google account"); the
  resulting tokens just live in the one shared settings object, same as
  every other integration in this app.
- **Fetch trigger**: manual "Sync now" button + a server-side polling
  interval once a sheet is configured (mirrors the existing `refreshAlerts`
  interval pattern, server-side instead of client-side).
- **Row tracking**: a `Sync Status` column written back into the sheet
  (`Imported` + timestamp) after each row is processed, so re-syncs skip
  done rows regardless of manual edits/reordering. Backed up by the
  existing `findDuplicateLead` (email/phone) dedup as a second safety net.
- **OAuth client credentials**: admin pastes their own Google Cloud OAuth
  Client ID + Secret (own GCP project) — same pattern as Momence's
  clientId/clientSecret. No credentials are baked into the app.
- **Column mapping**: reuses the exact field-mapping/defaults/alias-detect
  system just built for lead webhooks — a sheet row becomes a
  `{header: cellValue}` object, fed through the same resolver used for
  webhook payloads.
- **No new npm dependency.** Plain `fetch` against Google's OAuth2 and
  Sheets v4 REST endpoints, matching the existing `momence.js` style
  (raw HTTP client, no SDK).

## Architecture

### New backend module: `server/googleSheets.js`

Mirrors `server/momence.js`'s shape:

- `effectiveConfig(db)` — reads `db.settings.googleSheets` (clientId,
  clientSecret, refreshToken, accessToken, tokenExpiresAt, connectedEmail,
  sheetId, sheetTab, fieldMapping, defaults, lastSyncAt, lastSyncCount).
- `isConfigured(db)` — has clientId/clientSecret/refreshToken.
- `getAccessToken(db)` — cached-token pattern identical to
  `momence.getAccessToken`, refreshing via
  `https://oauth2.googleapis.com/token` with `grant_type=refresh_token`
  when the cached token is within 5 minutes of expiry.
- `buildAuthUrl(redirectUri, state)` — builds the
  `accounts.google.com/o/oauth2/v2/auth` URL with
  `scope=https://www.googleapis.com/auth/spreadsheets
  https://www.googleapis.com/auth/userinfo.email`, `access_type=offline`,
  `prompt=consent` (forces refresh_token on every connect, since Google
  only issues one on first consent).
- `exchangeCode(code, redirectUri)` — POSTs to
  `oauth2.googleapis.com/token` with `grant_type=authorization_code`,
  stores `refreshToken`/`accessToken`/`tokenExpiresAt`, then calls
  `https://www.googleapis.com/oauth2/v2/userinfo` to capture
  `connectedEmail` for display.
- `readSheetRows(db)` — `GET
  spreadsheets/{sheetId}/values/{sheetTab}` (full range), returns
  `{header: [...], rows: [[...], ...]}`.
- `writeSyncStatus(db, rowUpdates)` — batched
  `spreadsheets/{sheetId}/values:batchUpdate` writing `Imported` +
  ISO timestamp into the status column for each processed row.
- `runSync(db, { save, markDirty, log })` — the actual sync: reads rows,
  skips any already marked in the status column, resolves each row through
  `resolveWebhookLeadFields`-equivalent logic (see "Shared mapping" below),
  dedups via `findDuplicateLead`, creates leads via `createLeadFrom`,
  writes status back, returns `{created, duplicates, skipped}`.

### Shared mapping logic (refactor, not duplicate)

`resolveWebhookLeadFields`, `WEBHOOK_FIELD_ALIASES`, and
`buildLeadPayloadFromResolved` in `server/index.js` are lead-source-agnostic
already (they take a plain `{key: value}` object + a
`{fieldMapping, defaults}`-shaped config). Move them to a new
`server/leadFieldMapping.js` module, imported by both the webhook handler
and `googleSheets.js`, so both features stay in lock-step instead of
duplicating alias logic. A sheet row `[cell1, cell2, ...]` is zipped with
the header row into `{header[i]: cell[i]}` before being passed in — same
shape a webhook body already has.

### New API endpoints (`server/index.js`)

- `GET /api/google-sheets/config` — returns sanitized config (no secrets),
  `connected: bool`, `connectedEmail`.
- `PUT /api/google-sheets/config` — saves clientId/clientSecret/sheetId/
  sheetTab/fieldMapping/defaults.
- `GET /api/google-sheets/oauth/start` — redirects to Google's consent
  screen (builds redirect URI from the request host, like
  `webhookUrlForReq` does today).
- `GET /api/google-sheets/oauth/callback` — exchanges the code, saves
  tokens, redirects back to `/settings?tab=integrations&googleSheets=connected`.
- `POST /api/google-sheets/disconnect` — clears stored tokens.
- `POST /api/google-sheets/sync-now` — runs `runSync`, returns
  `{created, duplicates, skipped}`.
- `GET /api/google-sheets/logs` — same shape as `/api/webhooks/:id/logs`,
  backed by a new `db.sheetSyncLogs` array capped at 300 like
  `webhookLogs`.

### Background polling

In `server/index.js` (near existing interval-style code, or a new
`setInterval` registered at server startup): every 5 minutes, if
`googleSheets.isConfigured(db)` and a sheet is set, call `runSync`
silently, logging outcome/errors to `sheetSyncLogs` without throwing —
mirrors how `checkRateLimit`'s bucket and the existing alert refresh
already run as fire-and-forget background loops.

### Data model additions

- `db.settings.googleSheets = { clientId, clientSecret, refreshToken,
  accessToken, tokenExpiresAt, connectedEmail, sheetId, sheetTab,
  statusColumn, fieldMapping, defaults, lastSyncAt, lastSyncCounts }`
- `db.sheetSyncLogs = []` (same shape as `webhookLogs`: `{id, ts, outcome,
  detail}`).
- Both persisted via the existing Supabase meta sync (`META_FIELDS` list in
  `db.js` gains `sheetSyncLogs`; `googleSheets` settings ride along inside
  `settings`, already synced).

## UI (`src/pages/Settings.jsx`)

New `Section` in the Integrations tab, styled like the Momence section:

- Client ID / Client Secret inputs + Save (before connecting).
- "Connect Google Account" button → navigates to
  `/api/google-sheets/oauth/start` (full page redirect, not a popup —
  simplest, no postMessage plumbing, consistent with this app having no
  existing OAuth popup pattern to reuse).
- Once connected: shows `connectedEmail` chip + "Disconnect" button.
- Sheet URL/ID + tab-name inputs + Save.
- Field-mapping + defaults tables — **extracted into a shared
  `<FieldMappingEditor>` component** (new `src/components/FieldMappingEditor.jsx`)
  used by both `WebhookRow` and this new section, so the two features'
  mapping UI doesn't fork. Props: `mapping`, `defaults`, `onSaveMapping`,
  `onSaveDefaults`, `fieldOptions` (defaults to the existing
  `LEAD_FIELD_OPTIONS` list, exported from `Settings.jsx` or moved to a
  shared constants file).
- "Sync now" button + last-sync timestamp + created/duplicate/skipped
  counts from the last run.
- Sync log list (reuses the existing `OutcomeChip` component).

## Error handling

- Missing/expired refresh token → clear error surfaced in the section
  ("Reconnect your Google account") rather than a generic 500.
- Sheet not found / no access → surfaced verbatim from Google's error
  body (matches how `humanMomenceError` in `LeadDrawer.jsx` translates
  known Momence errors — a similar small translator function for common
  Google API error shapes, e.g. 403 "The caller does not have permission").
- Background poll failures are logged to `sheetSyncLogs` with outcome
  `error` and never thrown/crash the server.

## Testing

- Manual: connect a real (or throwaway) Google account against a test
  sheet, verify OAuth round-trip, mapping, dedup, and status-column
  write-back.
- No unit test framework exists in this repo currently (verified: no
  test runner configured in `package.json`) — this feature follows the
  same manual-verification approach already used for Momence/Respond.io.
