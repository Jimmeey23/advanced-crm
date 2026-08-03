-- Run once in Supabase SQL Editor (Project > SQL Editor > New query).

create table if not exists app_state (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists leads (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

insert into app_state (key, data)
values ('app', '{}'::jsonb)
on conflict (key) do nothing;
