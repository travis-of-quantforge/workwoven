-- Hackathon-only manual promotional credits. Purchased lots and provider receipts are untouched.
alter table public.credit_lots add column admin_removed_nano bigint not null default 0 check(admin_removed_nano>=0);
alter table public.credit_lots drop constraint credit_lots_check;
alter table public.credit_lots add constraint credit_lots_conservation
 check(original_nano=available_nano+reserved_nano+spent_nano+refunded_nano+admin_removed_nano);

create table public.admin_credit_adjustments (
 id uuid primary key default gen_random_uuid(),
 operation_key uuid not null unique,
 account_id uuid not null references public.agent_accounts,
 actor_id uuid not null references auth.users,
 delta_nano bigint not null check(delta_nano<>0),
 reason text not null check(length(reason) between 3 and 500),
 available_before_nano bigint not null,
 available_after_nano bigint not null,
 created_at timestamptz not null default now()
);
alter table public.admin_credit_adjustments enable row level security;
revoke all on public.admin_credit_adjustments from public,anon,authenticated;

create function public.admin_adjust_credits(a uuid,actor uuid,k uuid,delta bigint,why text) returns bigint
language plpgsql security definer set search_path='' as $$
declare acc public.agent_accounts; previous public.admin_credit_adjustments; lot public.credit_lots;
 remaining bigint; take bigint; before_nano bigint; cleaned text:=trim(why);
begin
 if a is null or actor is null or k is null or delta is null or delta=0 or delta not between -1000000000000 and 1000000000000
    or cleaned is null or length(cleaned) not between 3 and 500 then raise exception 'Invalid admin adjustment';end if;
 if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'Verified actor required';end if;
 select * into acc from public.agent_accounts where id=a for update;
 if acc.id is null then raise exception 'Account unavailable';end if;
 select * into previous from public.admin_credit_adjustments where operation_key=k;
 if previous.id is not null then
   if previous.account_id<>a or previous.actor_id<>actor or previous.delta_nano<>delta or previous.reason<>cleaned then raise exception 'Idempotency conflict';end if;
   return previous.available_after_nano;
 end if;
 before_nano:=acc.available_nano;
 if delta>0 then
   insert into public.credit_lots(account_id,source,original_nano,available_nano)
   values(a,'promotional',delta,delta);
   insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source)
   values(a,'admin_grant',delta,'admin:'||k,'promotional');
 else
   remaining:=-delta;
   if (select coalesce(sum(available_nano),0) from public.credit_lots where account_id=a and source='promotional')<remaining
     then raise exception 'Insufficient available promotional credits';end if;
   for lot in select * from public.credit_lots
     where account_id=a and source='promotional' and available_nano>0
     order by created_at desc,id desc for update loop
     take:=least(remaining,lot.available_nano);
     update public.credit_lots set available_nano=available_nano-take,
       admin_removed_nano=admin_removed_nano+take where id=lot.id;
     insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source)
     values(a,'admin_revoke',-take,'admin:'||k||':'||lot.id,'promotional');
     remaining:=remaining-take;
     exit when remaining=0;
   end loop;
   if remaining<>0 then raise exception 'Credit projection mismatch';end if;
 end if;
 update public.agent_accounts set available_nano=available_nano+delta where id=a;
 insert into public.admin_credit_adjustments(operation_key,account_id,actor_id,delta_nano,reason,available_before_nano,available_after_nano)
 values(k,a,actor,delta,cleaned,before_nano,before_nano+delta);
 if delta>0 and acc.visibility='shared' and before_nano+delta>=5000000000 then
   update public.engagements set funding='funded' where id=acc.engagement_id and funding='pending';
 end if;
 return before_nano+delta;
end $$;
revoke execute on function public.admin_adjust_credits(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.admin_adjust_credits(uuid,uuid,uuid,bigint,text) to service_role;
end if;end $$;
