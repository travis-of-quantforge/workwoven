create table public.usage_operations (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.agent_accounts,
 actor_id uuid not null references auth.users, operation_key uuid not null unique,
 reserved_nano bigint not null check(reserved_nano>0), provider_nano bigint,
 charge_nano bigint not null default 0, pricing_snapshot jsonb,
 status text not null default 'reserved' check(status in ('reserved','partial_offered','settled','released')),
 expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now()
);
alter table public.usage_operations enable row level security;
revoke all on public.usage_operations from anon,authenticated;
grant select on public.usage_operations to authenticated;
create policy usage_scope on public.usage_operations for select to authenticated using(exists(select 1 from public.agent_accounts a where a.id=account_id and public.can_read(a.engagement_id,a.visibility)));
-- Reservations are service-only: clients cannot reserve credits merely by supplying an amount.
create function public.reserve_usage(a uuid,actor uuid,k uuid,maximum_nano bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare acc public.agent_accounts; op public.usage_operations; r public.party_role; begin
 if maximum_nano<=0 or maximum_nano>1000000000 then raise exception 'Invalid operation budget'; end if;
 select * into acc from public.agent_accounts where id=a for update;
 if acc.id is null then raise exception 'Account unavailable'; end if;
 select role into r from public.memberships where engagement_id=acc.engagement_id and user_id=actor;
 if r is null or (acc.visibility<>'shared' and acc.visibility::text<>r::text) then raise exception 'Forbidden'; end if;
 select * into op from public.usage_operations where operation_key=k;
 if op.id is not null then
 if op.account_id<>a or op.actor_id<>actor or op.reserved_nano<>maximum_nano then raise exception 'Idempotency conflict'; end if; return op.id; end if;
 if acc.available_nano<maximum_nano then raise exception 'Insufficient credits'; end if;
 update public.agent_accounts set available_nano=available_nano-maximum_nano,reserved_nano=reserved_nano+maximum_nano where id=a;
 insert into public.usage_operations(account_id,actor_id,operation_key,reserved_nano) values(a,actor,k,maximum_nano) returning * into op;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(a,'reservation',-maximum_nano,'reserve:'||k,'usage');
 return op.id; end $$;
create function public.settle_usage(op_id uuid,provider_cost bigint,outcome text,snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare op public.usage_operations; charge bigint:=0; begin
 select * into op from public.usage_operations where id=op_id for update;
 if op.id is null then raise exception 'Operation unavailable'; end if;
 if op.status in ('settled','released') then return; end if;
 if outcome not in ('success','internal_error','provider_error','partial') or provider_cost<0 then raise exception 'Invalid outcome'; end if;
 if outcome in ('success','partial') and (provider_cost is null or snapshot is null) then raise exception 'Metered usage required'; end if;
 if outcome='partial' then
 if provider_cost*2>op.reserved_nano then raise exception 'Budget exceeded'; end if;
 update public.usage_operations set status='partial_offered',provider_nano=provider_cost,pricing_snapshot=snapshot,expires_at=now()+interval '24 hours' where id=op_id; return; end if;
 if outcome='success' then charge:=provider_cost*2; end if;
 if charge>op.reserved_nano then raise exception 'Budget exceeded'; end if;
 update public.agent_accounts set reserved_nano=reserved_nano-op.reserved_nano,available_nano=available_nano+op.reserved_nano-charge where id=op.account_id;
 update public.usage_operations set status=case when charge=0 then 'released' else 'settled' end,provider_nano=provider_cost,charge_nano=charge,pricing_snapshot=snapshot where id=op_id;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(op.account_id,'release',op.reserved_nano,'release:'||op.operation_key,'usage');
 if charge>0 then insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(op.account_id,'charge',-charge,'charge:'||op.operation_key,'usage'); end if;
 end $$;
create function public.resolve_partial(op_id uuid,keep boolean) returns void
language plpgsql security definer set search_path='' as $$
declare op public.usage_operations; begin
 select * into op from public.usage_operations where id=op_id for update;
 if op.actor_id is distinct from auth.uid() or not public.can_read((select engagement_id from public.agent_accounts where id=op.account_id),(select visibility from public.agent_accounts where id=op.account_id)) then raise exception 'Forbidden'; end if;
 if op.status<>'partial_offered' then raise exception 'No partial result to resolve'; end if;
 if op.expires_at<=now() then keep:=false; end if;
 perform public.settle_usage(op_id,op.provider_nano,case when keep then 'success' else 'provider_error' end,op.pricing_snapshot);
 end $$;
revoke execute on function public.reserve_usage,public.settle_usage,public.resolve_partial from public,anon,authenticated;
grant execute on function public.resolve_partial to authenticated;
-- Supabase service_role only; not available to authenticated RPC callers.
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.reserve_usage,public.settle_usage to service_role;
 end if; end $$;
