# CRM Improvements — Design Spec (2026-08-03)

Six independent changes, approved together for implementation.

## 1. Default stage list

Replace hardcoded default array in `server/seed.js` with the user-supplied 39-stage list. Only affects fresh installs (`db.stages` seed) — existing installs keep their persisted/edited list via Settings TagEditor. Also audit `server/ai.js`'s independent stage maps (`STAGE_WEIGHT`, `trialStages`) so scoring logic recognizes the new names.

## 2. Active-only associates in leaderboard/compare/filters

`active` flag already exists on associate records (`server/index.js` create default, toggle in Settings). Currently unenforced. Fix:
- `GET /api/analytics/associate-compare` — filter to `active !== false` before building rows.
- `GET /api/analytics/team` — same filter.
- Associate filter dropdowns in `Leads.jsx`, `Pipeline.jsx` — same filter.
- Do NOT filter `lead.associateId` joins — leads owned by inactive associates still render normally everywhere leads are listed.

## 3. Respond.io contact resolution fix

Root cause candidates: phone digits sent with no country-code normalization (`digits(lead.phone)`), and/or `pickContact()`'s response-shape check not matching actual Respond.io v2 payload shape.
- Normalize phone using org default country code from settings when the stored number lacks one.
- Verify/widen `pickContact()` against a real API response shape.
- Surface actual upstream error/response body in the 502 instead of the generic message, for future diagnosability.

## 4. Configurable per-followup cadence + custom rule engine

Replace flat `settings.cadence{outreachDays, followUpDays, trialReminderDays}` with:
- `cadence.steps: [{index, days, channel, label}]` — one entry per followup (1-4), independently editable in Settings.
- `cadence.rules: [{id, name, condition: {field, operator, value, join?}, action: {flagColor, flagLabel}}]` — simple field/operator/value conditions (AND-joined list), evaluated per-lead.
- `buildAlerts()` / `computeFollowUpState()` (server/index.js) extended to evaluate steps+rules instead of the flat fallback; matching leads get a new alert kind `custom_rule` and a visible flag/highlight on Leads/Pipeline rows.
- Settings UI: new tab/section for editing steps and rules.

## 5. Weekly + Monthly studio performance pages

No per-studio aggregation exists today (only org-wide time-bucket, or by-associate). Add:
- `GET /api/analytics/performance/by-location?range=week|month` — groups the existing time-bucket logic by `locationId`: new leads, trials, conversions, revenue, follow-up completion, top/bottom associate per studio.
- Two new pages, `StudioWeekly.jsx` and `StudioMonthly.jsx`, added to `NAV` and `Shell()` switch in `App.jsx`. Each studio gets an expandable detail card (reusing the `DetailList` drill-down pattern from `PerformanceModal.jsx`), more detailed than the current flat modal.

## 6. Settings persistence bug fix

Two bugs:
- `followUpChannels` sent by client isn't in server's `SETTINGS_SECTIONS` whitelist (`server/index.js`) — silently dropped. Fix: add it to the whitelist (and any other client-sent keys missing from the list, e.g. new `cadence.rules`/`steps` if nested differently).
- Supabase write in `server/db.js` `save()` is fire-and-forget with debounce, error only `console.error`'d — client always sees "saved" even on failure. Fix: await the Supabase persist call from the `PUT /api/settings` handler and return a non-200 with an error message if it throws, so the client only shows "Settings saved" on confirmed persistence.

## Verification

- Manual: change each settings section, reload app, confirm values persist (including a forced Supabase-down case if feasible).
- Manual: trigger Respond.io send from a lead with a local-format phone number, confirm success or a diagnosable error.
- Manual: mark an associate inactive, confirm they disappear from leaderboard/compare/filters but their leads remain visible in Leads/Pipeline.
- Manual: create a custom rule, confirm matching leads get flagged and an alert appears.
- Manual: load new weekly/monthly studio pages, confirm per-studio breakdown renders.
