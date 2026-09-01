-- Compute optimisation: move the inbox out of the app_state['app'] jsonb blob.
--
-- The inbox (18k+ messages, 13k+ conversations) had grown to ~7.4 MB, and
-- persistState() rewrote the whole app_state['app'] row on *every* save --
-- including saves that only touched a single lead. Each of those writes cost a
-- full TOAST rewrite, ~7.4 MB of WAL, dead-tuple bloat, and -- because
-- app_state is in the supabase_realtime publication -- a 7.4 MB realtime
-- broadcast straight back to the server that wrote it. Boot then had to
-- detoast the same 7.4 MB in one statement, which is what started timing out.
--
-- Giving the inbox its own table, deliberately NOT added to supabase_realtime,
-- keeps app_state small (~70 KB) so it can stay in the publication and go on
-- syncing settings across instances, while inbox writes stop being broadcast
-- at all.
create table if not exists app_inbox (
  key        text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Backfill from the existing blob, then drop it out of app_state so the next
-- boot doesn't detoast it. Both steps are safe to re-run.
insert into app_inbox (key, data)
select 'inbox', data->'inbox' from app_state where key = 'app' and data ? 'inbox'
on conflict (key) do update set data = excluded.data, updated_at = now();

update app_state set data = data - 'inbox' where key = 'app' and data ? 'inbox';
