-- Versioned pricing and source-aware prepaid usage. Monetary projections are mutable;
-- customer ledger and provider metering rows remain append-only to application roles.
create table public.ai_pricing (
 id uuid primary key default gen_random_uuid(), model text not null, version text not null,
 input_nano_per_token bigint not null check(input_nano_per_token>=0),
 cached_nano_per_token bigint not null check(cached_nano_per_token>=0),
 output_nano_per_token bigint not null check(output_nano_per_token>=0),
 markup integer not null default 2 check(markup=2), source_url text not null,
 effective_at timestamptz not null default now(), enabled boolean not null default true,
 unique(model,version)
);
insert into public.ai_pricing(model,version,input_nano_per_token,cached_nano_per_token,output_nano_per_token,source_url)
values('gpt-5-mini-2025-08-07','2026-11-04-standard',250,25,2000,'https://developers.openai.com/api/docs/pricing');
create table public.credit_policy_versions (
 version text primary key, supported_topups integer[] not null check(cardinality(supported_topups)>0 and 0<all(supported_topups) and array_position(supported_topups,null) is null),
 enabled boolean not null default true, created_at timestamptz not null default now()
);
create unique index credit_policy_one_active on public.credit_policy_versions(enabled) where enabled;
insert into public.credit_policy_versions(version,supported_topups) values('launch-v1',array[500,1000,2500]);
create table public.credit_purchases (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.agent_accounts,
 purchaser_id uuid not null references auth.users, amount_cents integer not null check(amount_cents>0), policy_version text not null references public.credit_policy_versions,
 currency text not null default 'USD' check(currency='USD'), operation_key uuid not null unique,
 status text not null default 'pending' check(status in('pending','completed','failed','partially_refunded','refunded')),
 provider_order_id text unique, provider_capture_id text unique, verified_at timestamptz,
 provider_snapshot jsonb, created_at timestamptz not null default now()
);
create table public.credit_lots (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.agent_accounts,
 source text not null check(source in('promotional','purchased')), purchase_id uuid unique references public.credit_purchases,
 original_nano bigint not null check(original_nano>0), available_nano bigint not null check(available_nano>=0),
 reserved_nano bigint not null default 0 check(reserved_nano>=0), spent_nano bigint not null default 0 check(spent_nano>=0),
 refunded_nano bigint not null default 0 check(refunded_nano>=0), created_at timestamptz not null default now(),
 check(original_nano=available_nano+reserved_nano+spent_nano+refunded_nano),
 check((source='purchased')=(purchase_id is not null))
);
lock table public.credit_ledger in share row exclusive mode;
-- Earlier application versions never enabled AI/purchases. Refuse an unsafe ledger adoption.
do $$ begin if exists(select 1 from public.usage_operations) or exists(select 1 from public.credit_ledger where kind<>'grant') then raise exception 'Reconcile legacy usage before upgrading credit accounting'; end if; end $$;
insert into public.credit_lots(account_id,source,original_nano,available_nano)
select account_id,'promotional',amount_nano,amount_nano from public.credit_ledger where kind='grant';
create function public.credit_grant_lot() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.kind='grant' and new.source='promotional' then insert into public.credit_lots(account_id,source,original_nano,available_nano) values(new.account_id,'promotional',new.amount_nano,new.amount_nano); end if;return new;end $$;
create trigger credit_grant_lot after insert on public.credit_ledger for each row execute function public.credit_grant_lot();
create table public.credit_allocations (
 operation_id uuid not null references public.usage_operations, lot_id uuid not null references public.credit_lots,
 reserved_nano bigint not null check(reserved_nano>0), charged_nano bigint not null default 0 check(charged_nano>=0),
 primary key(operation_id,lot_id), check(charged_nano<=reserved_nano)
);
create table public.usage_metering (
 id uuid primary key default gen_random_uuid(), operation_id uuid not null references public.usage_operations,
 provider_response_id text not null unique, pricing_id uuid not null references public.ai_pricing,
 input_tokens bigint not null check(input_tokens>=0), cached_tokens bigint not null check(cached_tokens between 0 and input_tokens),
 output_tokens bigint not null check(output_tokens>=0), provider_nano bigint not null check(provider_nano>=0),
 pricing_snapshot jsonb not null, created_at timestamptz not null default now()
);
alter table public.usage_operations add column final_outcome text;
alter table public.usage_operations add column usage_uncertain boolean not null default false;
alter table public.usage_operations add column unconfirmed_response_ids text[] not null default '{}';
create index usage_expiry on public.usage_operations(expires_at) where status in('reserved','partial_offered');
create table public.credit_refunds (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.credit_purchases,
 requested_by uuid not null references auth.users, amount_cents integer not null check(amount_cents>0),
 operation_key uuid not null unique, status text not null default 'requested' check(status in('requested','completed','rejected')),
 provider_refund_id text unique, created_at timestamptz not null default now(), resolved_at timestamptz
);
create function public.create_credit_purchase(a uuid,cents integer,k uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); acc public.agent_accounts; existing public.credit_purchases; result uuid; policy public.credit_policy_versions;begin
 select * into acc from public.agent_accounts where id=a;
 if acc.id is null or not coalesce(public.can_read(acc.engagement_id,acc.visibility),false) then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('credit-purchase:'||k::text,0));
 select * into existing from public.credit_purchases where operation_key=k;
 if existing.id is not null then if existing.account_id<>a or existing.purchaser_id<>u or existing.amount_cents<>cents then raise exception 'Idempotency conflict';end if;return existing.id;end if;
 select * into policy from public.credit_policy_versions where enabled;
 if policy.version is null or cents is null or not(cents=any(policy.supported_topups)) then raise exception 'Unsupported top-up amount';end if;
 insert into public.credit_purchases(account_id,purchaser_id,amount_cents,operation_key,policy_version) values(a,u,cents,k,policy.version) returning id into result;return result;end $$;
-- Caller must first verify provider authenticity, capture status, amount, currency and platform payee.
create function public.verify_credit_purchase(p uuid,capture text,cents integer,currency_code text,snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare order_row public.credit_purchases; amount bigint; e uuid;begin
 select * into order_row from public.credit_purchases where id=p for update;
 if order_row.id is null or cents is distinct from order_row.amount_cents or currency_code is distinct from 'USD' or capture is null or length(capture)=0 or snapshot is null then raise exception 'Purchase verification mismatch';end if;
 if order_row.status in('completed','partially_refunded','refunded') then if order_row.provider_capture_id is distinct from capture then raise exception 'Capture mismatch';end if;return;end if;
 amount:=cents::bigint*10000000;
 perform 1 from public.agent_accounts where id=order_row.account_id for update;
 insert into public.credit_lots(account_id,source,purchase_id,original_nano,available_nano) values(order_row.account_id,'purchased',p,amount,amount);
 update public.agent_accounts set available_nano=available_nano+amount where id=order_row.account_id;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(order_row.account_id,'purchase',amount,'purchase:'||p,'purchased');
 update public.credit_purchases set status='completed',provider_capture_id=capture,provider_snapshot=snapshot,verified_at=now() where id=p;
 select engagement_id into e from public.agent_accounts where id=order_row.account_id and visibility='shared';
 update public.engagements set funding='funded' where id=e and funding='pending' and creator_id=order_row.purchaser_id;
 end $$;
create or replace function public.reserve_usage(a uuid,actor uuid,k uuid,maximum_nano bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare acc public.agent_accounts; op public.usage_operations; r public.party_role; lot public.credit_lots; remaining bigint:=maximum_nano; take bigint;begin
 if maximum_nano is null or maximum_nano<=0 or maximum_nano>1000000000 or k is null or actor is null then raise exception 'Invalid operation budget';end if;
 select * into acc from public.agent_accounts where id=a for update;
 if acc.id is null then raise exception 'Account unavailable';end if;
 select role into r from public.memberships where engagement_id=acc.engagement_id and user_id=actor;
 if r is null or (acc.visibility<>'shared' and acc.visibility::text<>r::text) or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'Forbidden';end if;
 select * into op from public.usage_operations where operation_key=k;
 if op.id is not null then if op.account_id<>a or op.actor_id<>actor or op.reserved_nano<>maximum_nano then raise exception 'Idempotency conflict';end if;return op.id;end if;
 if acc.available_nano<maximum_nano then raise exception 'Insufficient credits';end if;
 insert into public.usage_operations(account_id,actor_id,operation_key,reserved_nano) values(a,actor,k,maximum_nano) returning * into op;
 for lot in select * from public.credit_lots where account_id=a and available_nano>0 order by case source when 'promotional' then 0 else 1 end,created_at,id for update loop
 take:=least(remaining,lot.available_nano);
 update public.credit_lots set available_nano=available_nano-take,reserved_nano=reserved_nano+take where id=lot.id;
 insert into public.credit_allocations(operation_id,lot_id,reserved_nano) values(op.id,lot.id,take);
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(a,'reservation',-take,'reserve:'||k||':'||lot.id,lot.source);
 remaining:=remaining-take;exit when remaining=0;end loop;
 if remaining<>0 then raise exception 'Credit projection mismatch';end if;
 update public.agent_accounts set available_nano=available_nano-maximum_nano,reserved_nano=reserved_nano+maximum_nano where id=a;return op.id;end $$;
create function public.record_usage(op_id uuid,response_id text,price uuid,inputs bigint,cached bigint,outputs bigint) returns bigint
language plpgsql security definer set search_path='' as $$
declare rate public.ai_pricing; previous public.usage_metering; cost bigint; snapshot jsonb;begin
 if response_id is null or length(response_id)=0 or inputs is null or cached is null or outputs is null or inputs<0 or cached<0 or cached>inputs or outputs<0 then raise exception 'Invalid metering';end if;
 perform 1 from public.usage_operations where id=op_id for update;if not found then raise exception 'Operation unavailable';end if;
 select * into rate from public.ai_pricing where id=price;if rate.id is null then raise exception 'Pricing unavailable';end if;
 cost:=(inputs-cached)*rate.input_nano_per_token+cached*rate.cached_nano_per_token+outputs*rate.output_nano_per_token;
 select * into previous from public.usage_metering where provider_response_id=response_id;
 if previous.id is not null then if previous.operation_id<>op_id or previous.pricing_id<>price or previous.input_tokens<>inputs or previous.cached_tokens<>cached or previous.output_tokens<>outputs then raise exception 'Metering replay mismatch';end if;return previous.provider_nano;end if;
 snapshot:=to_jsonb(rate)-'enabled';
 insert into public.usage_metering(operation_id,provider_response_id,pricing_id,input_tokens,cached_tokens,output_tokens,provider_nano,pricing_snapshot) values(op_id,response_id,price,inputs,cached,outputs,cost,snapshot);
 update public.usage_operations set provider_nano=(select sum(provider_nano) from public.usage_metering where operation_id=op_id) where id=op_id;return cost;end $$;
create or replace function public.settle_usage(op_id uuid,provider_cost bigint,outcome text,snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare op public.usage_operations; actual bigint; metered integer; charge bigint:=0; remaining bigint; allocation record; take bigint;begin
 select * into op from public.usage_operations where id=op_id for update;if op.id is null then raise exception 'Operation unavailable';end if;
 if op.status in('settled','released') or (op.status='partial_offered' and outcome='partial') then return;end if;
 if outcome is null or outcome not in('success','internal_error','provider_error','partial','abandoned') or provider_cost<0 then raise exception 'Invalid outcome';end if;
 select coalesce(sum(provider_nano),0),count(*) into actual,metered from public.usage_metering where operation_id=op_id;
 if outcome in('success','partial') and (metered=0 or provider_cost is distinct from actual or snapshot is null) then raise exception 'Verified metering required';end if;
 if outcome in('success','partial') then charge:=actual*2;end if;
 if charge>op.reserved_nano then charge:=0;outcome:='internal_error';end if;
 if outcome='partial' then update public.usage_operations set status='partial_offered',provider_nano=actual,pricing_snapshot=snapshot,expires_at=now()+interval '24 hours' where id=op_id;return;end if;
 perform 1 from public.agent_accounts where id=op.account_id for update;
 remaining:=charge;
 for allocation in select x.*,l.source from public.credit_allocations x join public.credit_lots l on l.id=x.lot_id where x.operation_id=op_id order by case l.source when 'promotional' then 0 else 1 end,l.created_at,l.id loop
 take:=least(remaining,allocation.reserved_nano);
 update public.credit_lots set reserved_nano=reserved_nano-allocation.reserved_nano,available_nano=available_nano+allocation.reserved_nano-take,spent_nano=spent_nano+take where id=allocation.lot_id;
 update public.credit_allocations set charged_nano=take where operation_id=op_id and lot_id=allocation.lot_id;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(op.account_id,'release',allocation.reserved_nano,'release:'||op.operation_key||':'||allocation.lot_id,allocation.source);
 if take>0 then insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(op.account_id,'charge',-take,'charge:'||op.operation_key||':'||allocation.lot_id,allocation.source);end if;
 remaining:=remaining-take;end loop;
 if remaining<>0 then raise exception 'Credit allocation mismatch';end if;
 update public.agent_accounts set reserved_nano=reserved_nano-op.reserved_nano,available_nano=available_nano+op.reserved_nano-charge where id=op.account_id;
 update public.usage_operations set status=case when charge=0 then 'released' else 'settled' end,provider_nano=case when metered>0 then actual else null end,charge_nano=charge,pricing_snapshot=snapshot,final_outcome=outcome where id=op_id;
 end $$;
create function public.request_credit_refund(p uuid,cents integer,k uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); purchase public.credit_purchases; lot public.credit_lots; previous public.credit_refunds; result uuid; amount bigint:=cents::bigint*10000000;begin
 select * into purchase from public.credit_purchases where id=p for update;
 if purchase.id is null or purchase.purchaser_id<>u or purchase.status not in('completed','partially_refunded') then raise exception 'Refund unavailable';end if;
 select * into previous from public.credit_refunds where operation_key=k;
 if previous.id is not null then if previous.purchase_id<>p or previous.requested_by<>u or previous.amount_cents<>cents then raise exception 'Idempotency conflict';end if;return previous.id;end if;
 perform 1 from public.agent_accounts where id=purchase.account_id for update;
 select * into lot from public.credit_lots where purchase_id=p for update;
 if cents is null or cents<=0 or lot.available_nano<amount then raise exception 'Insufficient unused purchased credits';end if;
 insert into public.credit_refunds(purchase_id,requested_by,amount_cents,operation_key) values(p,u,cents,k) returning id into result;
 update public.credit_lots set available_nano=available_nano-amount,reserved_nano=reserved_nano+amount where id=lot.id;
 update public.agent_accounts set available_nano=available_nano-amount,reserved_nano=reserved_nano+amount where id=lot.account_id;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(lot.account_id,'refund_reservation',-amount,'refund-reserve:'||result,'purchased');return result;end $$;
create function public.resolve_credit_refund(r uuid,provider_id text,approved boolean) returns void
language plpgsql security definer set search_path='' as $$
declare request public.credit_refunds; lot public.credit_lots; amount bigint; refunded bigint;begin
 select * into request from public.credit_refunds where id=r for update;
 if request.id is null then raise exception 'Refund unavailable';end if;if request.status<>'requested' then return;end if;
 if approved is null or (approved and (provider_id is null or length(provider_id)=0)) then raise exception 'Verified provider refund required';end if;
 perform 1 from public.credit_purchases where id=request.purchase_id for update;
 select * into lot from public.credit_lots where purchase_id=request.purchase_id;
 perform 1 from public.agent_accounts where id=lot.account_id for update;
 amount:=request.amount_cents::bigint*10000000;
 update public.credit_lots set reserved_nano=reserved_nano-amount,available_nano=available_nano+case when approved then 0 else amount end,refunded_nano=refunded_nano+case when approved then amount else 0 end where id=lot.id returning refunded_nano into refunded;
 update public.agent_accounts set reserved_nano=reserved_nano-amount,available_nano=available_nano+case when approved then 0 else amount end where id=lot.account_id;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(lot.account_id,'refund_release',amount,'refund-release:'||r,'purchased');
 if approved then insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(lot.account_id,'refund',-amount,'refund:'||r,'purchased');update public.credit_purchases set status=case when refunded=lot.original_nano then 'refunded' else 'partially_refunded' end where id=request.purchase_id;end if;
 update public.credit_refunds set status=case when approved then 'completed' else 'rejected' end,provider_refund_id=case when approved then provider_id else null end,resolved_at=now() where id=r;end $$;
create function public.recover_usage(max_rows integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare op public.usage_operations; recovered integer:=0;begin
 for op in select * from public.usage_operations where status in('reserved','partial_offered') and expires_at<now() order by expires_at limit least(greatest(max_rows,1),100) for update skip locked loop
 perform public.settle_usage(op.id,null,'abandoned',op.pricing_snapshot);recovered:=recovered+1;end loop;return recovered;end $$;
create function public.credit_summary(e uuid,v public.visibility) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a uuid;begin
 if not coalesce(public.can_read(e,v),false) then raise exception 'Forbidden';end if;
 select id into a from public.agent_accounts where engagement_id=e and visibility=v;
 return jsonb_build_object('accountId',a,'availableNano',(select available_nano::text from public.agent_accounts where id=a),'reservedNano',(select reserved_nano::text from public.agent_accounts where id=a),'spentNano',(select coalesce(sum(spent_nano),0)::text from public.credit_lots where account_id=a),'promotionalAvailableNano',(select coalesce(sum(available_nano),0)::text from public.credit_lots where account_id=a and source='promotional'),'purchasedAvailableNano',(select coalesce(sum(available_nano),0)::text from public.credit_lots where account_id=a and source='purchased'));
 end $$;
do $$ declare t text;begin foreach t in array array['ai_pricing','credit_policy_versions','credit_purchases','credit_lots','credit_allocations','usage_metering','credit_refunds'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy credit_policy_read on public.credit_policy_versions for select to authenticated using(true);
create policy pricing_read on public.ai_pricing for select to authenticated using(true);
create policy purchase_read on public.credit_purchases for select to authenticated using(exists(select 1 from public.agent_accounts a where a.id=account_id and public.can_read(a.engagement_id,a.visibility)));
create policy lot_read on public.credit_lots for select to authenticated using(exists(select 1 from public.agent_accounts a where a.id=account_id and public.can_read(a.engagement_id,a.visibility)));
create policy allocation_read on public.credit_allocations for select to authenticated using(exists(select 1 from public.usage_operations o join public.agent_accounts a on a.id=o.account_id where o.id=operation_id and public.can_read(a.engagement_id,a.visibility)));
create policy metering_read on public.usage_metering for select to authenticated using(exists(select 1 from public.usage_operations o join public.agent_accounts a on a.id=o.account_id where o.id=operation_id and public.can_read(a.engagement_id,a.visibility)));
create policy refund_read on public.credit_refunds for select to authenticated using(requested_by=auth.uid());
revoke execute on function public.credit_grant_lot,public.create_credit_purchase,public.verify_credit_purchase,public.record_usage,public.request_credit_refund,public.resolve_credit_refund,public.recover_usage,public.credit_summary from public,anon,authenticated;
grant execute on function public.create_credit_purchase,public.request_credit_refund,public.credit_summary to authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.verify_credit_purchase,public.record_usage,public.resolve_credit_refund,public.recover_usage to service_role;end if;end $$;

create function public.immutable_ai_pricing() returns trigger language plpgsql set search_path='' as $$ begin
 if (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then raise exception 'Create a new pricing version instead of editing rates';end if;return new;end $$;
create trigger immutable_ai_pricing before update on public.ai_pricing for each row execute function public.immutable_ai_pricing();
revoke execute on function public.immutable_ai_pricing from public,anon,authenticated;
create table public.usage_corrections (
 operation_id uuid primary key references public.usage_operations, operation_key uuid not null unique,
 amount_nano bigint not null check(amount_nano>0), reason text not null check(length(reason) between 1 and 1000),
 created_at timestamptz not null default now()
);
alter table public.usage_corrections enable row level security;
revoke all on public.usage_corrections from anon,authenticated;
grant select on public.usage_corrections to authenticated;
create policy correction_read on public.usage_corrections for select to authenticated using(exists(select 1 from public.usage_operations o join public.agent_accounts a on a.id=o.account_id where o.id=operation_id and public.can_read(a.engagement_id,a.visibility)));
create function public.reverse_usage_charge(op_id uuid,k uuid,why text) returns void
language plpgsql security definer set search_path='' as $$
declare op public.usage_operations; previous public.usage_corrections; allocation record;begin
 select * into op from public.usage_operations where id=op_id for update;
 if op.id is null or op.status<>'settled' or op.charge_nano<=0 then raise exception 'Charged operation unavailable';end if;
 select * into previous from public.usage_corrections where operation_id=op_id;
 if previous.operation_id is not null then if previous.operation_key is distinct from k then raise exception 'Charge already corrected';end if;return;end if;
 perform 1 from public.agent_accounts where id=op.account_id for update;
 insert into public.usage_corrections(operation_id,operation_key,amount_nano,reason) values(op_id,k,op.charge_nano,why);
 for allocation in select x.*,l.source from public.credit_allocations x join public.credit_lots l on l.id=x.lot_id where x.operation_id=op_id and x.charged_nano>0 loop
 update public.credit_lots set available_nano=available_nano+allocation.charged_nano,spent_nano=spent_nano-allocation.charged_nano where id=allocation.lot_id;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(op.account_id,'correction',allocation.charged_nano,'correction:'||k||':'||allocation.lot_id,allocation.source);
 end loop;
 update public.agent_accounts set available_nano=available_nano+op.charge_nano where id=op.account_id;
 end $$;
create function public.promotional_spend_report(since timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('grantCount',(select count(*) from public.credit_ledger where source='promotional' and kind='grant' and created_at>=since),'promotionalProviderCostNano',(select coalesce(sum(m.provider_nano),0)::text from public.usage_metering m where m.created_at>=since and exists(select 1 from public.credit_allocations a join public.credit_lots l on l.id=a.lot_id where a.operation_id=m.operation_id and l.source='promotional')),'unconfirmedFailedOperations',(select count(*) from public.usage_operations o where created_at>=since and status='released' and provider_nano is null and exists(select 1 from public.credit_allocations a join public.credit_lots l on l.id=a.lot_id where a.operation_id=o.id and l.source='promotional')))
$$;
revoke execute on function public.reverse_usage_charge,public.promotional_spend_report from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.reverse_usage_charge,public.promotional_spend_report to service_role;end if;end $$;

create trigger immutable_credit_policy before update on public.credit_policy_versions for each row execute function public.immutable_ai_pricing();
