-- Professional payments only. AI-credit purchases have a separate ledger.
alter table public.payment_requests alter column version_id drop not null;
alter table public.payment_requests drop constraint payment_requests_status_check;
alter table public.payment_requests add constraint payment_requests_status_check check(status in('requested','superseded','paid'));
alter table public.payment_requests add column kind text not null default 'milestone' check(kind in('milestone','agreement','hourly','adhoc','bonus'));
alter table public.payment_requests add column description text not null default '';
update public.payment_requests p set kind=case when task_id is null then 'agreement' else 'milestone' end,
 description=coalesce((select title from public.milestone_tasks where id=p.task_id),'Unallocated agreement balance');
drop index public.payment_request_one_task;
create unique index payment_request_one_task on public.payment_requests(version_id,task_id) where task_id is not null and status='requested';

create table public.paypal_sellers (
 user_id uuid primary key references auth.users, tracking_id uuid not null unique default gen_random_uuid(),
 merchant_id text unique, referral_id text, onboarding_url text,
 payments_enabled boolean not null default false, refunds_enabled boolean not null default false,
 verified_at timestamptz, environment text not null default 'sandbox' check(environment='sandbox')
);
create table public.payment_transactions (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 request_id uuid not null references public.payment_requests, milestone_id uuid references public.milestones,
 payer_id uuid not null references auth.users, payee_id uuid not null references auth.users,
 merchant_id text not null, amount_cents bigint not null check(amount_cents between 1 and 100000000),
 currency text not null default 'USD' check(currency='USD'), environment text not null default 'sandbox' check(environment='sandbox'),
 status text not null default 'creating' check(status in('creating','approval_pending','processing','completed','failed','cancelled')),
 order_id text unique, capture_id text unique, approval_url text,
 operation_key uuid not null unique, failure_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_active_payment_per_request on public.payment_transactions(request_id) where status not in('failed','cancelled');
create table public.payment_refunds (
 id uuid primary key default gen_random_uuid(), payment_id uuid not null references public.payment_transactions,
 engagement_id uuid not null references public.engagements, actor_id uuid not null references auth.users,
 amount_cents bigint not null check(amount_cents between 1 and 100000000), reason text not null check(length(trim(reason)) between 1 and 2000),
 status text not null default 'processing' check(status in('processing','completed','failed','cancelled')),
 provider_refund_id text unique, operation_key uuid not null unique, failure_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.payment_ledger (
 id bigint generated always as identity primary key, engagement_id uuid not null references public.engagements,
 request_id uuid not null references public.payment_requests, payment_id uuid references public.payment_transactions,
 refund_id uuid references public.payment_refunds, kind text not null check(kind in('request_created','request_superseded','order_created','payment_processing','payment_completed','payment_failed','payment_cancelled','refund_requested','refund_completed','refund_failed')),
 amount_cents bigint not null, currency text not null default 'USD' check(currency='USD'),
 description text not null, provider_reference text, event_key text not null unique,
 environment text not null default 'sandbox' check(environment='sandbox'), created_at timestamptz not null default now()
);
create table public.paypal_webhook_events (
 id text primary key, event_type text not null, resource_id text, payload_hash text not null,
 received_at timestamptz not null default now(), processed_at timestamptz, last_error text
);
create index payment_transactions_engagement on public.payment_transactions(engagement_id,created_at);
create index payment_refunds_payment on public.payment_refunds(payment_id);
create index payment_ledger_engagement on public.payment_ledger(engagement_id,id);
do $$ declare t text;begin foreach t in array array['paypal_sellers','payment_transactions','payment_refunds','payment_ledger','paypal_webhook_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 if t<>'paypal_webhook_events' then execute format('grant select on public.%I to authenticated',t);end if;
 end loop;end $$;
grant usage,select on sequence public.payment_ledger_id_seq to service_role;
revoke update,delete on public.payment_ledger from service_role;
create policy seller_owner on public.paypal_sellers for select to authenticated using(user_id=auth.uid());
create policy transaction_member on public.payment_transactions for select to authenticated using(public.member_role(engagement_id) is not null);
create policy refund_member on public.payment_refunds for select to authenticated using(public.member_role(engagement_id) is not null);
create policy ledger_member on public.payment_ledger for select to authenticated using(public.member_role(engagement_id) is not null);

create function public.payment_request_defaults() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.description='' then new.description:=coalesce((select title from public.milestone_tasks where id=new.task_id),'Unallocated agreement balance');end if;
 if new.task_id is null and new.kind='milestone' then new.kind:='agreement';end if;
 return new;end $$;
create trigger payment_request_defaults before insert on public.payment_requests for each row execute function public.payment_request_defaults();
create function public.payment_request_ledger() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' then
 insert into public.payment_ledger(engagement_id,request_id,kind,amount_cents,description,event_key,created_at)
 values(new.engagement_id,new.id,'request_created',new.amount_cents,new.description,'request:'||new.id,new.created_at);
 elsif new.status='superseded' and old.status<>new.status then
 insert into public.payment_ledger(engagement_id,request_id,kind,amount_cents,description,event_key)
 values(new.engagement_id,new.id,'request_superseded',new.amount_cents,new.description,'superseded:'||new.id);
 end if;return new;end $$;
create trigger payment_request_ledger after insert or update on public.payment_requests for each row execute function public.payment_request_ledger();
insert into public.payment_ledger(engagement_id,request_id,kind,amount_cents,description,event_key,created_at)
select engagement_id,id,'request_created',amount_cents,description,'request:'||id,created_at from public.payment_requests;
insert into public.payment_ledger(engagement_id,request_id,kind,amount_cents,description,event_key)
select engagement_id,id,'request_superseded',amount_cents,description||' (imported superseded status)','superseded:'||id from public.payment_requests where status='superseded';

create function public.create_adhoc_payment_request(e uuid,category text,description text,cents bigint,k uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();r public.party_role;g public.engagements;payer uuid;payee uuid;prior public.payment_requests;result uuid;begin
 r:=public.member_role(e);if r is null then raise exception 'Forbidden';end if;
 select * into g from public.engagements where id=e for update;
 if g.status='archived' then raise exception 'Engagement is archived';end if;
 if (r='client' and category<>'bonus') or (r='professional' and category not in('hourly','adhoc')) or category is null then raise exception 'Forbidden';end if;
 if k is null or cents is null or cents not between 1 and 100000000 or description is null or length(trim(description)) not between 1 and 2000 then raise exception 'Invalid payment request';end if;
 select user_id into payer from public.memberships where engagement_id=e and role='client';
 select user_id into payee from public.memberships where engagement_id=e and role='professional';
 if payer is null or payee is null or payer=payee then raise exception 'Both parties must join before payments';end if;
 select * into prior from public.payment_requests where operation_key=k;
 if prior.id is not null then
 if prior.engagement_id<>e or prior.requested_by<>u or prior.kind<>category or prior.description<>trim(description) or prior.amount_cents<>cents then raise exception 'Idempotency conflict';end if;
 return prior.id;end if;
 insert into public.payment_requests(engagement_id,kind,description,requested_by,payer_id,payee_id,amount_cents,currency,payment_terms,operation_key)
 values(e,category,trim(description),u,payer,payee,cents,'USD','Explicit client approval in PayPal required.',k) returning id into result;
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(e,u,'shared','system',case when category='bonus' then 'Bonus proposed: ' else 'Payment requested: ' end||trim(description)||'. See Payments.');
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(case when r='client' then payee else payer end,e,'payment_request',result);
 return result;end $$;

-- Outstanding balances count verified sandbox captures minus completed refunds
-- across the stable milestone, while preserving each original task/version ID.
create function public.milestone_net_paid(m uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(p.amount_cents-(select coalesce(sum(r.amount_cents),0) from public.payment_refunds r where r.payment_id=p.id and r.status='completed')),0)::bigint
 from public.payment_transactions p where p.milestone_id=m and p.status='completed';
$$;
create function public.request_milestone_payment(e uuid,t uuid,k uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();task public.milestone_tasks;g public.engagements;m uuid;due bigint;prior public.payment_requests;result uuid;payer uuid;payee uuid;begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 select * into g from public.engagements where id=e for update;
 select * into prior from public.payment_requests where operation_key=k;
 if prior.id is not null then
 if prior.engagement_id<>e or prior.task_id is distinct from t or prior.requested_by<>u then raise exception 'Idempotency conflict';end if;return prior.id;end if;
 select * into task from public.milestone_tasks where id=t and engagement_id=e;
 if g.status='archived' or task.id is null or not public.is_current_milestone_task(t) then raise exception 'Select a current accepted milestone';end if;
 select mv.milestone_id into m from public.milestone_versions mv where mv.task_id=t;
 due:=task.amount_cents-coalesce(public.milestone_net_paid(m),0);
 if due<1 then raise exception 'Milestone has no outstanding balance';end if;
 select * into prior from public.payment_requests where task_id=t and status='requested';
 if prior.id is not null and prior.amount_cents=due then return prior.id;end if;
 if prior.id is not null then update public.payment_requests set status='superseded' where id=prior.id;end if;
 select user_id into payer from public.memberships where engagement_id=e and role='client';
 select user_id into payee from public.memberships where engagement_id=e and role='professional';
 if payer is null or payee is null then raise exception 'Both parties must join before payments';end if;
 insert into public.payment_requests(engagement_id,version_id,task_id,kind,description,requested_by,payer_id,payee_id,amount_cents,currency,payment_terms,operation_key)
 values(e,g.accepted_version_id,t,'milestone',task.title,u,payer,payee,due,'USD',task.payment_terms,k) returning id into result;
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(case when u=payer then payee else payer end,e,'payment_request',result);
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(e,u,'shared','system',case when u=payer then 'Milestone payment prepared: ' else 'Milestone payment requested: ' end||task.title||'. See Payments.');
 return result;end $$;

create function public.begin_paypal_payment(q uuid,k uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();r public.payment_requests;s public.paypal_sellers;p public.payment_transactions;m uuid;due bigint;begin
 select * into r from public.payment_requests where id=q;
 if r.id is null or public.member_role(r.engagement_id) is distinct from 'client'::public.party_role or r.payer_id<>u then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=r.engagement_id for update;
 select * into p from public.payment_transactions where request_id=q and status not in('failed','cancelled');
 if p.id is not null and p.status='completed' then return p.id;end if;
 if k is null or r.status<>'requested' then raise exception 'Payment request is no longer payable';end if;
 if p.id is not null then return p.id;end if;
 if r.task_id is not null then
 if not public.is_current_milestone_task(r.task_id) then raise exception 'Select a current accepted milestone';end if;
 select mv.milestone_id into m from public.milestone_versions mv where mv.task_id=r.task_id;
 select t.amount_cents into due from public.milestone_tasks t where t.id=r.task_id;
 due:=due-public.milestone_net_paid(m)-(select coalesce(sum(amount_cents),0) from public.payment_transactions where milestone_id=m and status in('creating','approval_pending','processing'));
 if r.amount_cents>due then raise exception 'Outstanding balance changed; request a new payment';end if;
 end if;
 select * into s from public.paypal_sellers where user_id=r.payee_id;
 if not coalesce(s.payments_enabled,false) or s.merchant_id is null or s.verified_at is null or s.verified_at<now()-interval '5 minutes' then raise exception 'Professional must connect PayPal sandbox first';end if;
 insert into public.payment_transactions(engagement_id,request_id,milestone_id,payer_id,payee_id,merchant_id,amount_cents,operation_key)
 values(r.engagement_id,q,m,u,r.payee_id,s.merchant_id,r.amount_cents,k) returning id into m;return m;
end $$;
create function public.authorize_paypal_capture(p uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();payment public.payment_transactions;r public.payment_requests;begin
 select * into payment from public.payment_transactions where id=p;
 if payment.id is null or payment.payer_id<>u or public.member_role(payment.engagement_id) is distinct from 'client'::public.party_role then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=payment.engagement_id for update;
 select * into payment from public.payment_transactions where id=p for update;
 if payment.status='completed' then return;end if;
 select * into r from public.payment_requests where id=payment.request_id;
 if r.status<>'requested' or payment.status in('failed','cancelled') or (r.task_id is not null and not public.is_current_milestone_task(r.task_id)) then raise exception 'Payment request is no longer payable';end if;
 update public.payment_transactions set status='processing',updated_at=now() where id=p;
end $$;
create function public.guard_milestone_capture() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.accepted_version_id is distinct from old.accepted_version_id and exists(select 1 from public.payment_transactions where milestone_id=new.id and status='processing') then raise exception 'A milestone payment is processing; refresh its status before accepting a revision';end if;
 return new;end $$;
create trigger guard_milestone_capture before update of accepted_version_id on public.milestones for each row execute function public.guard_milestone_capture();
create function public.begin_paypal_refund(p uuid,cents bigint,reason text,k uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();payment public.payment_transactions;r public.payment_refunds;reserved bigint;begin
 select * into payment from public.payment_transactions where id=p for update;
 if payment.id is null or payment.payee_id<>u or public.member_role(payment.engagement_id) is distinct from 'professional'::public.party_role then raise exception 'Forbidden';end if;
 select * into r from public.payment_refunds where operation_key=k;
 if r.id is not null then if r.payment_id<>p or r.amount_cents<>cents or r.reason<>trim(reason) then raise exception 'Idempotency conflict';end if;return r.id;end if;
 if payment.status<>'completed' or payment.capture_id is null then raise exception 'Only completed payments can be refunded';end if;
 select coalesce(sum(amount_cents),0) into reserved from public.payment_refunds where payment_id=p and status in('processing','completed');
 if cents is null or cents<1 or cents>payment.amount_cents-reserved or k is null or reason is null or length(trim(reason)) not between 1 and 2000 then raise exception 'Invalid refund amount or reason';end if;
 insert into public.payment_refunds(payment_id,engagement_id,actor_id,amount_cents,reason,operation_key)
 values(p,payment.engagement_id,u,cents,trim(reason),k) returning id into p;
 insert into public.payment_ledger(engagement_id,request_id,payment_id,refund_id,kind,amount_cents,description,event_key)
 values(payment.engagement_id,payment.request_id,payment.id,p,'refund_requested',cents,trim(reason),'refund-request:'||p);
 return p;end $$;

-- Only independently verified server provider responses reach these service RPCs.
create function public.record_paypal_payment(p uuid,provider_order text,provider_capture text,state text,approval text default null,code text default null) returns void language plpgsql security definer set search_path='' as $$
declare payment public.payment_transactions;r public.payment_requests;kind text;begin
 select * into payment from public.payment_transactions where id=p for update;
 if payment.id is null or state not in('approval_pending','processing','completed','failed','cancelled') then raise exception 'Invalid payment receipt';end if;
 if payment.order_id is not null and payment.order_id is distinct from provider_order then raise exception 'Provider reference mismatch';end if;
 if payment.capture_id is not null and payment.capture_id is distinct from provider_capture then raise exception 'Capture reference mismatch';end if;
 if payment.status='completed' then return;end if;
 if payment.status='processing' and state='approval_pending' then return;end if;
 if state='completed' and (provider_order is null or provider_capture is null) then raise exception 'Completed capture required';end if;
 update public.payment_transactions set order_id=coalesce(provider_order,order_id),capture_id=coalesce(provider_capture,capture_id),status=state,approval_url=coalesce(approval,approval_url),failure_code=code,updated_at=now() where id=p;
 select * into r from public.payment_requests where id=payment.request_id;
 kind:=case state when 'approval_pending' then 'order_created' when 'completed' then 'payment_completed' when 'failed' then 'payment_failed' when 'cancelled' then 'payment_cancelled' else 'payment_processing' end;
 insert into public.payment_ledger(engagement_id,request_id,payment_id,kind,amount_cents,description,provider_reference,event_key)
 values(payment.engagement_id,r.id,p,kind,payment.amount_cents,r.description,coalesce(provider_capture,provider_order),p||':'||kind) on conflict(event_key) do nothing;
 if state='completed' then
 update public.payment_requests set status='paid' where id=r.id;
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,payment.engagement_id,'payment_request',r.id from public.memberships where engagement_id=payment.engagement_id;
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(payment.engagement_id,payment.payer_id,'shared','system','Sandbox payment completed: '||r.description||'. See Payments for the receipt.');
 end if;
end $$;
create function public.record_paypal_refund(r uuid,provider_id text,state text,code text default null) returns void language plpgsql security definer set search_path='' as $$
declare refund public.payment_refunds;payment public.payment_transactions;kind text;begin
 select * into refund from public.payment_refunds where id=r for update;
 if refund.id is null or state not in('processing','completed','failed','cancelled') then raise exception 'Invalid refund receipt';end if;
 if refund.provider_refund_id is not null and refund.provider_refund_id is distinct from provider_id then raise exception 'Refund reference mismatch';end if;
 if refund.status='completed' then return;end if;
 if state='completed' and provider_id is null then raise exception 'Completed refund required';end if;
 update public.payment_refunds set provider_refund_id=coalesce(provider_id,provider_refund_id),status=state,failure_code=code,updated_at=now() where id=r;
 if state='processing' then return;end if;
 select * into payment from public.payment_transactions where id=refund.payment_id;
 kind:=case when state='completed' then 'refund_completed' else 'refund_failed' end;
 insert into public.payment_ledger(engagement_id,request_id,payment_id,refund_id,kind,amount_cents,description,provider_reference,event_key)
 values(refund.engagement_id,payment.request_id,payment.id,r,kind,refund.amount_cents,refund.reason,provider_id,r||':'||kind) on conflict(event_key) do nothing;
 if state='completed' then
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(payment.payer_id,payment.engagement_id,'payment_request',payment.request_id);
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(payment.engagement_id,refund.actor_id,'shared','system','Sandbox refund completed: '||refund.reason||'. See Payments for the original payment and refund receipt.');
 end if;
end $$;

create function public.import_paypal_refund(p uuid,provider_id text,cents bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare payment public.payment_transactions;result uuid;begin
 select * into payment from public.payment_transactions where id=p for update;
 if payment.id is null or payment.status<>'completed' or provider_id is null or cents not between 1 and payment.amount_cents then raise exception 'Invalid external refund';end if;
 select id into result from public.payment_refunds where provider_refund_id=provider_id;
 if result is not null then return result;end if;
 if cents+(select coalesce(sum(amount_cents),0) from public.payment_refunds where payment_id=p and status='completed')>payment.amount_cents then raise exception 'Refund exceeds captured amount';end if;
 insert into public.payment_refunds(payment_id,engagement_id,actor_id,amount_cents,reason,provider_refund_id,operation_key)
 values(p,payment.engagement_id,payment.payee_id,cents,'Refund issued directly in PayPal',provider_id,gen_random_uuid()) returning id into result;
 return result;end $$;

create function public.payment_ledger_totals(e uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform public.require_verified();if public.member_role(e) is null then raise exception 'Forbidden';end if;
 return (select jsonb_build_object('paidCents',coalesce(sum(amount_cents) filter(where kind='payment_completed'),0)::text,'refundedCents',coalesce(sum(amount_cents) filter(where kind='refund_completed'),0)::text) from public.payment_ledger where engagement_id=e);
end $$;

revoke all on function public.payment_request_defaults(),public.payment_request_ledger(),public.milestone_net_paid(uuid),public.record_paypal_payment(uuid,text,text,text,text,text),public.record_paypal_refund(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.guard_milestone_capture() from public,anon,authenticated;
revoke all on function public.authorize_paypal_capture(uuid) from public,anon;
grant execute on function public.authorize_paypal_capture(uuid) to authenticated;
grant execute on function public.record_paypal_payment(uuid,text,text,text,text,text),public.record_paypal_refund(uuid,text,text,text) to service_role;
revoke all on function public.import_paypal_refund(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.import_paypal_refund(uuid,text,bigint) to service_role;
revoke all on function public.payment_ledger_totals(uuid) from public,anon;
grant execute on function public.payment_ledger_totals(uuid) to authenticated;
revoke all on function public.create_adhoc_payment_request(uuid,text,text,bigint,uuid),public.request_milestone_payment(uuid,uuid,uuid),public.begin_paypal_payment(uuid,uuid),public.begin_paypal_refund(uuid,bigint,text,uuid) from public,anon;
grant execute on function public.create_adhoc_payment_request(uuid,text,text,bigint,uuid),public.request_milestone_payment(uuid,uuid,uuid),public.begin_paypal_payment(uuid,uuid),public.begin_paypal_refund(uuid,bigint,text,uuid) to authenticated;
