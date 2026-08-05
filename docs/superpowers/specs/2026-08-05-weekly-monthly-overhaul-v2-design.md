# Weekly/Monthly Studio Reports — Phase 2 (Controls + Deeper Analytics)

## Purpose
Phase 1 (`2026-08-05-weekly-monthly-overhaul-design.md`, merged) added KPI deltas/sparklines, 4 trend charts, funnel, leaderboard, source breakdown. This phase adds controls (custom range, compare mode, export) and 5 new analytical sections: channel performance, follow-up analytics, revenue mix, cohort conversion, goal tracking.

## Scope
Same files: `src/components/StudioPerformancePage.jsx`, `GET /api/analytics/performance/by-location` in `server/index.js`. `targetMonthly` field already exists on associates (`server/seed.js:65`) — reuse it for goal tracking, no schema change needed there.

## Controls

1. **Custom date range**: alongside existing week/month period nav, add a date-range picker (start/end) that overrides bucket-based navigation when active. Endpoint accepts `&from=YYYY-MM-DD&to=YYYY-MM-DD` as an alternative to `range`/`offset` — when present, all aggregates compute over that explicit window instead of the bucketed period.
2. **Compare mode**: a selector next to the period nav — "vs previous period" (default, already exists via `previous`) or "vs same period last year". Endpoint accepts `&compare=prev|yoy`; `previous` in the response reflects whichever is chosen.
3. **Export**: a button that exports the current view's tables (KPI summary, leaderboard, source breakdown, channel performance, revenue mix) as CSV — client-side generation from already-fetched JSON, no new endpoint. PDF export out of scope for this phase (CSV covers the practical need; revisit only if requested).

## New data / API additions

Extend the same endpoint response with:
- `channelPerformance`: per-channel (call/whatsapp/email/sms) stats `{channel, attempted, responded, responseRate, won, conversionRate}` — derived from `lead.followUps[].channel` and outcome.
- `followUpAnalytics`: `{overdueCount, avgResponseHours, completionRateByAssociate: [{associateId, name, rate}], missedByChannel: [{channel, count}]}`.
- `revenueMix`: leads grouped by `classType`/membership-type field (check actual lead schema field name before implementing — likely `classType` per earlier grep) `{type, count, revenue, wonRate}`.
- `cohortConversion`: for each of the last 6 period-cohorts (weeks or months matching current `range`), track what % of that cohort's new leads converted to won by 1/2/4 periods later: `[{cohortLabel, size, convertedByP1, convertedByP2, convertedByP4}]`. Computed from `lead.createdAt` + `lead.convertedAt`.
- `goalTracking`: per-associate and per-studio target vs actual for the current period `{associateId/locationId, name, target, actual, attainmentPct}`, using existing `targetMonthly` (pro-rate to week if `range=week`).

All computed server-side in the same aggregation pass over `db.leads`/`db.associates`/`db.locations` already in place — no new data sources, no new DB tables.

## UI additions (`StudioPerformancePage.jsx`)

Below the existing Phase 1 sections, add:
1. **Channel performance table** — response rate & conversion rate per channel, small bar chart alongside.
2. **Follow-up analytics panel** — overdue count + avg response time as stat tiles, completion-rate-by-associate mini bar chart, missed-by-channel breakdown.
3. **Revenue mix** — donut/pie chart + table, by class/membership type.
4. **Cohort conversion table** — rows = cohort period, columns = P1/P2/P4 conversion %, heatmap-style cell shading by value.
5. **Goal tracking** — per-associate and per-studio progress bars (target vs actual, color by attainment tier: red <60%, amber 60-90%, green 90%+).

Controls (date range, compare selector, export button) sit in the existing header/period-nav row.

## Performance
Cohort conversion requires looking back further than the 12-period history window (needs `convertedAt` lookups across cohorts) — compute only for the last 6 cohorts to bound cost, matching the spec above. If this proves slow at current data volume (~24k leads), revisit with caching; not preemptively optimized.

## Testing
- Endpoint test: response includes all 5 new fields with correct shapes for both `range=week` and `range=month`, and for `&from/&to` custom range.
- Manual verification: export produces a valid CSV matching on-screen table data; compare-mode toggle changes `previous` values; goal tracking attainment % matches `actual/target`.
