-- Owner-only RLS and the authenticated recipient filter also govern live bells.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
 alter publication supabase_realtime add table public.notifications;
 end if;
end $$;
