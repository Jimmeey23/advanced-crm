-- Run once in Supabase SQL Editor (Project > SQL Editor > New query).
-- If the `leads` table already exists from a previous run, `create table if
-- not exists` below is a no-op and won't add the new columns/indexes — run
-- this against an existing table instead:
--   alter table leads add column if not exists email_norm text;
--   alter table leads add column if not exists phone_norm text;
--   create unique index if not exists leads_email_norm_uk on leads (email_norm) where email_norm <> '';
--   create unique index if not exists leads_phone_norm_uk on leads (phone_norm) where phone_norm <> '';
-- Existing duplicate rows will make the index creation fail — resolve those
-- (via the app's /api/leads/dedupe review) before adding the indexes.

create table if not exists app_state (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists leads (
  id text primary key,
  data jsonb not null,
  -- Normalized email/phone, computed application-side (server/duplicateMatch.js
  -- normalizeEmail/normalizePhone) and written on every upsert. Kept here —
  -- rather than reimplementing the same validity/format rules in SQL — so
  -- there is exactly one place that decides what counts as a duplicate; the
  -- app already had two independently-drifted copies of that logic once
  -- (see duplicateMatch.js header comment) and a third one in SQL would
  -- reopen the same failure mode.
  email_norm text,
  phone_norm text,
  updated_at timestamptz not null default now()
);

-- Empty string means "no usable email/phone" (placeholder, missing, invalid
-- format) and must not collide with every other such lead, hence the
-- partial index excluding ''.
create unique index if not exists leads_email_norm_uk on leads (email_norm) where email_norm <> '';
create unique index if not exists leads_phone_norm_uk on leads (phone_norm) where phone_norm <> '';

insert into app_state (key, data)
values ('app', '{}'::jsonb)
on conflict (key) do nothing;

insert into app_state (key, data)
values ('settings', '{}'::jsonb)
on conflict (key) do nothing;

-- Enables two-way sync: lets the server's Supabase Realtime subscription see
-- changes made directly in the Supabase dashboard (or by another instance).
alter publication supabase_realtime add table app_state;
alter publication supabase_realtime add table leads;

-- See migrations/20260831_add_sheet_row_snapshot.sql
create table if not exists sheet_row_snapshot (
  lead_id     text primary key,
  row_number  integer,
  values      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists sheet_row_snapshot_row_number_idx on sheet_row_snapshot (row_number);
