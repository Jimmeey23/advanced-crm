-- Maps a Supabase Auth user to an app role. Role starts at 'agent' for every
-- new signup; only the POST /api/auth/admin-code route (mastercode-gated,
-- server-side only) can promote a row to 'admin'.
create table if not exists app_users (
  user_id uuid primary key,
  email text not null,
  role text not null default 'agent' check (role in ('agent', 'admin')),
  created_at timestamptz not null default now()
);

create index if not exists app_users_email_idx on app_users (lower(email));
