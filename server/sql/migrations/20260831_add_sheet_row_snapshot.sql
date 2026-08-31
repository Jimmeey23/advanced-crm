-- Snapshot of what the Google Sheet said at the end of the last sync: one row
-- per lead, keyed by lead id, holding the sheet's row number and the value of
-- every mapped column.
--
-- This is what makes per-field last-write-wins possible without adding an
-- "Updated At" column to the sheet. Comparing the sheet and the app against
-- this baseline says WHICH side changed a field; only fields changed on both
-- sides need a timestamp to break the tie. It also gives row-deletion
-- detection something to diff against.
--
-- Rebuildable at any time by re-reading the sheet, so it carries no data of
-- its own worth backing up.
create table if not exists sheet_row_snapshot (
  lead_id     text primary key,
  row_number  integer,
  values      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists sheet_row_snapshot_row_number_idx
  on sheet_row_snapshot (row_number);
