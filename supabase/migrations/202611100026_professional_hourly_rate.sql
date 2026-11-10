alter table public.profiles add column hourly_rate_cents integer
 check(hourly_rate_cents between 1 and 100000000);

create function public.set_hourly_rate(cents integer) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();begin
 if cents is not null and cents not between 1 and 100000000 then raise exception 'Invalid hourly rate';end if;
 update public.profiles set hourly_rate_cents=cents where id=u;
end $$;
create function public.engagement_hourly_rate(e uuid) returns integer
language plpgsql stable security definer set search_path='' as $$begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 return (select p.hourly_rate_cents from public.memberships m join public.profiles p on p.id=m.user_id
 where m.engagement_id=e and m.role='professional');
end $$;
create or replace function public.create_account_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare role_choice public.party_role; rate integer; raw_rate text:=new.raw_user_meta_data->>'hourly_rate_cents';begin
 role_choice:=case when new.raw_user_meta_data->>'profile_type'='professional'
 then 'professional'::public.party_role else 'client'::public.party_role end;
 if raw_rate ~ '^[0-9]{1,9}$' then
  if raw_rate::bigint between 1 and 100000000 then rate:=raw_rate::integer;end if;
 end if;
 insert into public.profiles(id,default_role,active_role,hourly_rate_cents)
 values(new.id,role_choice,role_choice,rate) on conflict(id) do nothing;
 return new;
end $$;
revoke all on function public.set_hourly_rate(integer),public.engagement_hourly_rate(uuid) from public,anon;
grant execute on function public.set_hourly_rate(integer),public.engagement_hourly_rate(uuid) to authenticated;
