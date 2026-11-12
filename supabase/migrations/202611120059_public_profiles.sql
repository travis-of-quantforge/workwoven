-- Published reputation is visible for both roles; private workspace data retains
-- its existing RLS and the public_profile RPC retains its explicit projection.
alter table public.profiles alter column is_public set default true;
update public.profiles set is_public=true where not is_public;
create function public.keep_profile_public() returns trigger
language plpgsql set search_path='' as $$
begin new.is_public:=true;return new;end $$;
revoke all on function public.keep_profile_public() from public,anon,authenticated;
create trigger profile_always_public before insert or update of is_public on public.profiles
for each row execute function public.keep_profile_public();
