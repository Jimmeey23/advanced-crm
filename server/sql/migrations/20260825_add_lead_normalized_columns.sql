-- Apply to existing Advanced CRM Supabase projects before creating the
-- normalized uniqueness indexes in server/sql/schema.sql.
alter table public.leads add column if not exists email_norm text;
alter table public.leads add column if not exists phone_norm text;

-- Refresh PostgREST's schema cache immediately after the migration.
notify pgrst, 'reload schema';
