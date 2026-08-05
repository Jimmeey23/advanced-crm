# Weekly/Monthly Studio Reports Overhaul — Design

## Purpose
Current weekly/monthly tabs (`src/pages/StudioWeekly.jsx`, `StudioMonthly.jsx` → shared `src/components/StudioPerformancePage.jsx`) show only stat cards + expandable per-studio rows, no charts, no history, no trend. Overhaul to add depth: charts, breakdowns, comparisons.

## Scope
`StudioPerformancePage.jsx` and its backing endpoint `GET /api/analytics/performance/by-location` (`server/index.js:881-936`). No changes to `Dashboard.jsx`/`Performance.jsx` (separate, already chart-rich).

## Data model / API changes
Extend `GET /api/analytics/performance/by-location?range=week|month&offset=N` to also accept `&history=12` and return:
- `current`: existing per-location aggregate shape (unchanged).
- `previous`: same shape for the immediately prior period (for Δ% calculations).
- `history`: array of last 12 periods' aggregate summary `{periodLabel, newLeads, trials, won, revenue, followUpRate}` (aggregated overall, not per-location, to keep payload light — per-location history only computed for the currently expanded studio row on demand).
- `funnel`: stage counts for the current period `{new, trial, won, lost}` (aggregated overall + per-location).
- `leaderboard`: full sorted associate list (not just top/bottom) `{associateId, name, newLeads, trials, won, revenue, followUpRate}`.
- `sourceBreakdown`: leads grouped by `source` field with count + won-rate `{source, count, wonCount, wonRate}`.

All new aggregates computed from the same `db.leads`/`db.associates` query already in place — grouped differently, no new data source.

## UI changes (`StudioPerformancePage.jsx`)
1. **KPI strip**: existing 5 summary cards gain a Δ% badge (vs `previous`) and a 12-point sparkline (recharts `<Sparklines>`/mini `<LineChart>`).
2. **Trend section**: 4 small-multiple recharts line charts (leads, revenue, won, follow-up rate) fed by `history`.
3. **Funnel chart**: recharts bar/funnel of `funnel` counts, studio-filterable via existing location selector.
4. **Associate leaderboard table**: sortable table from `leaderboard`, replacing the current top/bottom-only `AssociateCard` pair (keep those cards too, as a quick-glance summary above the full table).
5. **Source breakdown table**: from `sourceBreakdown`.
6. **Per-studio expandable rows**: unchanged structure, add a small revenue sparkline per row using a lazily-fetched per-location history slice (only when a row is expanded, to avoid the heavier per-location computation up front).

## Performance
12-period history aggregated server-side in one query pass per call; no client-side repeated fetching. If slow in practice with larger datasets, revisit with caching — not implemented preemptively.

## Testing
- Endpoint test: response includes `previous`, `history` (length 12), `funnel`, `leaderboard`, `sourceBreakdown` with correct shapes.
- Component test/manual: charts render with mock data, Δ% badges compute correctly (positive/negative/zero cases).
