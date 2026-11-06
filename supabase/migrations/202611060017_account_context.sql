-- Account context is a preference. Engagement membership remains the authority for actions.
alter table public.profiles add column default_role public.party_role not null default 'client';
alter table public.profiles add column active_role public.party_role not null default 'client';

insert into public.profiles(id,default_role,active_role)
select u.id, chosen.role, chosen.role
from auth.users u
left join lateral (
 select m.role from public.memberships m join public.engagements e on e.id=m.engagement_id
 where m.user_id=u.id order by e.created_at,e.id limit 1
) first_membership on true
cross join lateral (
 select case
   when u.raw_user_meta_data->>'profile_type' in('client','professional')
     then (u.raw_user_meta_data->>'profile_type')::public.party_role
   else coalesce(first_membership.role,'client'::public.party_role)
 end as role
) chosen
on conflict(id) do update set default_role=excluded.default_role,active_role=excluded.active_role;

create function public.create_account_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare role_choice public.party_role;begin
 role_choice:=case when new.raw_user_meta_data->>'profile_type'='professional'
   then 'professional'::public.party_role else 'client'::public.party_role end;
 insert into public.profiles(id,default_role,active_role) values(new.id,role_choice,role_choice)
 on conflict(id) do nothing;
 return new;
end $$;
create trigger account_profile_created after insert on auth.users for each row
 execute function public.create_account_profile();

create function public.set_active_role(next_role public.party_role) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();begin
 if next_role is null then raise exception 'Choose a profile type';end if;
 update public.profiles set active_role=next_role,updated_at=now() where id=u;
 if not found then raise exception 'Account profile unavailable';end if;
end $$;

create or replace function public.create_engagement(p_title text,p_role public.party_role) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); e uuid; a uuid; eligible boolean; chosen_role public.party_role;begin
 select active_role into chosen_role from public.profiles where id=u;
 if chosen_role is null or p_role is distinct from chosen_role then raise exception 'Switch profile context before creating an engagement';end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 160 then raise exception 'Invalid engagement title';end if;
 perform 1 from auth.users where id=u for update;
 eligible:=not exists(select 1 from public.starter_grants where user_id=u);
 insert into public.engagements(creator_id,title,funding)
 values(u,trim(p_title),case when eligible then 'funded' else 'pending' end) returning id into e;
 insert into public.memberships values(e,u,chosen_role);
 insert into public.agent_accounts(engagement_id,visibility) select e,v from unnest(enum_range(null::public.visibility)) v;
 insert into public.agent_configs(engagement_id,visibility) select e,v from unnest(enum_range(null::public.visibility)) v;
 if eligible then
   insert into public.starter_grants(user_id,engagement_id) values(u,e);
   update public.agent_accounts set available_nano=5000000000 where engagement_id=e and visibility='shared' returning id into a;
   insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source)
   values(a,'grant',5000000000,'starter:'||u,'promotional');
 end if;
 return e;
end $$;

create function public.create_engagement(p_title text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); chosen_role public.party_role;begin
 select active_role into chosen_role from public.profiles where id=u;
 if chosen_role is null then raise exception 'Account profile unavailable';end if;
 return public.create_engagement(p_title,chosen_role);
end $$;
revoke execute on function public.create_account_profile(),public.set_active_role(public.party_role),
 public.create_engagement(text) from public,anon,authenticated;
grant execute on function public.set_active_role(public.party_role),public.create_engagement(text) to authenticated;
