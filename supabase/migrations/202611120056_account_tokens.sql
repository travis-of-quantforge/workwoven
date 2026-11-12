-- Promotional account tokens are allocated, never purchased, at engagement creation.
create table public.account_token_settings(
 singleton boolean primary key default true check(singleton),free_signup_nano bigint not null default 11000000000 check(free_signup_nano between 0 and 1000000000000)
);
insert into public.account_token_settings default values;
create table public.account_token_wallets(user_id uuid primary key references auth.users,available_nano bigint not null check(available_nano>=0));
create table public.account_token_ledger(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,actor_id uuid references auth.users,
 kind text not null check(kind in('signup','engagement_allocation','admin_adjustment')),amount_nano bigint not null,balance_after_nano bigint not null check(balance_after_nano>=0),
 operation_key text not null unique,engagement_id uuid references public.engagements,reason text not null default '',created_at timestamptz not null default now()
);
create table public.account_token_setting_events(
 operation_key uuid primary key,actor_id uuid not null references auth.users,previous_nano bigint not null,next_nano bigint not null,created_at timestamptz not null default now()
);
alter table public.account_token_settings enable row level security;
alter table public.account_token_wallets enable row level security;
alter table public.account_token_ledger enable row level security;
alter table public.account_token_setting_events enable row level security;
revoke all on public.account_token_settings,public.account_token_wallets,public.account_token_ledger,public.account_token_setting_events from public,anon,authenticated,service_role;
grant select on public.account_token_settings to anon,authenticated,service_role;
grant select on public.account_token_wallets,public.account_token_ledger to authenticated,service_role;
grant select on public.account_token_setting_events to service_role;
create policy signup_setting_read on public.account_token_settings for select to anon,authenticated using(true);
create policy wallet_owner on public.account_token_wallets for select to authenticated using(user_id=auth.uid());
create policy wallet_ledger_owner on public.account_token_ledger for select to authenticated using(user_id=auth.uid());
-- All existing accounts receive the new allowance; prior engagement balances stay untouched.
insert into public.account_token_wallets(user_id,available_nano) select id,11000000000 from auth.users;
insert into public.account_token_ledger(user_id,kind,amount_nano,balance_after_nano,operation_key,reason)
 select id,'signup',11000000000,11000000000,'signup:'||id,'Initial account allowance' from auth.users;
create function public.grant_signup_tokens() returns trigger language plpgsql security definer set search_path='' as $$
declare amount bigint;begin
 select free_signup_nano into amount from public.account_token_settings where singleton;
 insert into public.account_token_wallets(user_id,available_nano) values(new.id,amount);
 insert into public.account_token_ledger(user_id,kind,amount_nano,balance_after_nano,operation_key,reason) values(new.id,'signup',amount,amount,'signup:'||new.id,'Account creation allowance');return new;
end $$;
create trigger signup_account_tokens after insert on auth.users for each row execute function public.grant_signup_tokens();
revoke all on function public.grant_signup_tokens() from public,anon,authenticated;
create or replace function public.create_engagement(p_title text,p_role public.party_role) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();e uuid;a uuid;balance bigint;chosen public.party_role;begin
 select active_role into chosen from public.profiles where id=u;
 if chosen is null or p_role is distinct from chosen then raise exception 'Switch profile context before creating an engagement';end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 160 then raise exception 'Invalid engagement title';end if;
 select available_nano into balance from public.account_token_wallets where user_id=u for update;
 if balance is null or balance<5000000000 then raise exception 'You need at least 50 available tokens to create an engagement';end if;
 insert into public.engagements(creator_id,title,funding) values(u,trim(p_title),'funded') returning id into e;
 insert into public.memberships values(e,u,chosen);
 insert into public.agent_accounts(engagement_id,visibility) select e,v from unnest(enum_range(null::public.visibility)) v;
 insert into public.agent_configs(engagement_id,visibility) select e,v from unnest(enum_range(null::public.visibility)) v;
 update public.account_token_wallets set available_nano=available_nano-5000000000 where user_id=u;
 insert into public.account_token_ledger(user_id,actor_id,kind,amount_nano,balance_after_nano,operation_key,engagement_id,reason) values(u,u,'engagement_allocation',-5000000000,balance-5000000000,'engagement:'||e,e,'50 shared tokens allocated at creation');
 update public.agent_accounts set available_nano=5000000000 where engagement_id=e and visibility='shared' returning id into a;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(a,'grant',5000000000,'account-allocation:'||e,'promotional');
 -- Retain the old first-engagement marker for historical consumers; it no
 -- longer creates a grant or changes funding eligibility.
 insert into public.starter_grants(user_id,engagement_id) values(u,e) on conflict(user_id) do nothing;
 return e;
end $$;
create function public.admin_set_signup_tokens(actor uuid,k uuid,amount bigint) returns void language plpgsql security definer set search_path='' as $$
declare previous bigint;event public.account_token_setting_events;begin
 if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'Verified actor required';end if;
 if amount is null or amount not between 0 and 1000000000000 or k is null then raise exception 'Invalid signup allowance';end if;
 select free_signup_nano into previous from public.account_token_settings where singleton for update;
 select * into event from public.account_token_setting_events where operation_key=k;
 if found then if event.actor_id<>actor or event.next_nano<>amount then raise exception 'Idempotency conflict';end if;return;end if;
 update public.account_token_settings set free_signup_nano=amount where singleton;
 insert into public.account_token_setting_events values(k,actor,previous,amount,now());
end $$;
create function public.admin_adjust_account_tokens(subject uuid,actor uuid,k uuid,delta bigint,why text) returns bigint language plpgsql security definer set search_path='' as $$
declare balance bigint;event public.account_token_ledger;begin
 if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'Verified actor required';end if;
 if k is null or delta is null or delta=0 or delta not between -1000000000000 and 1000000000000 or length(trim(coalesce(why,''))) not between 3 and 500 then raise exception 'Invalid admin adjustment';end if;
 select available_nano into balance from public.account_token_wallets where user_id=subject for update;
 if not found then raise exception 'Account unavailable';end if;
 select * into event from public.account_token_ledger where operation_key='admin:'||k;
 if found then if event.user_id<>subject or event.actor_id<>actor or event.amount_nano<>delta or event.reason<>trim(why) then raise exception 'Idempotency conflict';end if;return event.balance_after_nano;end if;
 if balance+delta<0 then raise exception 'Insufficient available account tokens';end if;
 update public.account_token_wallets set available_nano=balance+delta where user_id=subject;
 insert into public.account_token_ledger(user_id,actor_id,kind,amount_nano,balance_after_nano,operation_key,reason) values(subject,actor,'admin_adjustment',delta,balance+delta,'admin:'||k,trim(why));return balance+delta;
end $$;
revoke all on function public.admin_set_signup_tokens(uuid,uuid,bigint),public.admin_adjust_account_tokens(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.admin_set_signup_tokens(uuid,uuid,bigint),public.admin_adjust_account_tokens(uuid,uuid,uuid,bigint,text) to service_role;
create function public.allocate_existing_engagement_tokens(e uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();project public.engagements;balance bigint;a uuid;begin
 select * into project from public.engagements where id=e for update;
 if project.id is null or project.creator_id<>u then raise exception 'Forbidden';end if;
 if project.funding='funded' then return;end if;
 select available_nano into balance from public.account_token_wallets where user_id=u for update;
 if balance is null or balance<5000000000 then raise exception 'You need at least 50 available tokens to create an engagement';end if;
 select id into a from public.agent_accounts where engagement_id=e and visibility='shared' for update;
 update public.account_token_wallets set available_nano=available_nano-5000000000 where user_id=u;
 insert into public.account_token_ledger(user_id,actor_id,kind,amount_nano,balance_after_nano,operation_key,engagement_id,reason) values(u,u,'engagement_allocation',-5000000000,balance-5000000000,'engagement:'||e,e,'50 shared tokens allocated to existing engagement');
 update public.agent_accounts set available_nano=available_nano+5000000000 where id=a;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(a,'grant',5000000000,'account-allocation:'||e,'promotional');
 update public.engagements set funding='funded' where id=e;
end $$;
revoke all on function public.allocate_existing_engagement_tokens(uuid) from public,anon;
grant execute on function public.allocate_existing_engagement_tokens(uuid) to authenticated;
