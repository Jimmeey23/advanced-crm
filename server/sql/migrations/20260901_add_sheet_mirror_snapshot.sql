-- The mirror tab's half of the snapshot: what the CRM-owned tab said for this
-- lead at the end of the last sync.
--
-- Same job as `values` does for the source tab. Without it a mirror row can be
-- compared against the lead but not against what the sync last wrote there, so
-- a person's edit in the mirror is indistinguishable from an app-side change
-- and the two sides fight over the cell instead of converging.
alter table sheet_row_snapshot
  add column if not exists mirror jsonb;
