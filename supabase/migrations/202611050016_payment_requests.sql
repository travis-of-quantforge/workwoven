-- Payment requests are records of a professional's request, not charges or receipts.
create table public.payment_requests (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 version_id uuid not null references public.scope_versions, task_id uuid references public.milestone_tasks,
 requested_by uuid not null references auth.users, payer_id uuid not null references auth.users,
 payee_id uuid not null references auth.users, amount_cents bigint not null check(amount_cents between 1 and 100000000),
 currency text not null check(currency='USD'), payment_terms text not null,
 status text not null default 'requested' check(status in('requested','superseded')),
 operation_key uuid not null unique, created_at timestamptz not null default now()
);
create unique index payment_request_one_task on public.payment_requests(version_id,task_id) where task_id is not null;
create unique index payment_request_one_balance on public.payment_requests(version_id) where task_id is null;
alter table public.payment_requests enable row level security;
revoke all on public.payment_requests from anon,authenticated;
grant select on public.payment_requests to authenticated;
create policy payment_request_member on public.payment_requests for select to authenticated
 using(public.member_role(engagement_id) is not null);
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
 check(kind in('message','mention','reply','approval','agreement_accepted','invitation_accepted','delivery','delivery_review','meeting','meeting_response','review_published','concern','payment_request'));

create function public.create_payment_request(e uuid,expected uuid,t uuid,k uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); engagement public.engagements; scope public.scope_versions;
 task public.milestone_tasks; prior public.payment_requests; payer uuid; cents bigint; terms text; label text; result uuid;begin
 if e is null or expected is null or k is null then raise exception 'Invalid payment request';end if;
 select * into engagement from public.engagements where id=e for update;
 if engagement.id is null or engagement.accepted_version_id is distinct from expected or engagement.status='archived'
    or public.member_role(e) is distinct from 'professional'::public.party_role then
    raise exception 'Current accepted agreement and professional authority required';end if;
 select user_id into payer from public.memberships where engagement_id=e and role='client';
 if payer is null then raise exception 'Client has not joined';end if;
 select * into prior from public.payment_requests where operation_key=k;
 if prior.id is not null then
   if prior.engagement_id<>e or prior.version_id<>expected or prior.task_id is distinct from t or prior.requested_by<>u
     then raise exception 'Idempotency conflict';end if;
   return prior.id;
 end if;
 select * into scope from public.scope_versions where id=expected and engagement_id=e;
 if scope.id is null or scope.content->>'currency'<>'USD' then raise exception 'Accepted scope unavailable';end if;
 if t is not null then
   select * into task from public.milestone_tasks where id=t and version_id=expected and engagement_id=e;
   if task.id is null or task.amount_cents<1 then raise exception 'Payable accepted milestone required';end if;
   cents:=task.amount_cents;terms:=task.payment_terms;label:=task.title;
 else
   cents:=(scope.content->>'priceCents')::bigint-
     (select coalesce(sum(amount_cents),0) from public.milestone_tasks where version_id=expected);
   if cents<1 then raise exception 'No unallocated agreement balance';end if;
   terms:=scope.content->>'paymentTerms';label:='Unallocated agreement balance';
 end if;
 insert into public.payment_requests(engagement_id,version_id,task_id,requested_by,payer_id,payee_id,amount_cents,currency,payment_terms,operation_key)
 values(e,expected,t,u,payer,u,cents,'USD',terms,k) returning id into result;
 insert into public.messages(engagement_id,author_id,visibility,kind,body)
 values(e,u,'shared','system','Payment requested: '||label||' (agreement version '||scope.number||'). No charge or transfer has occurred. See Payments.');
 insert into public.notifications(recipient_id,engagement_id,kind,record_id)
 values(payer,e,'payment_request',result);
 insert into public.audit_events(engagement_id,actor_id,action,record_id)
 values(e,u,'payment_requested',result);
 return result;
end $$;

create function public.supersede_payment_requests() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.accepted_version_id is distinct from old.accepted_version_id and new.accepted_version_id is not null then
   update public.payment_requests set status='superseded' where engagement_id=new.id
     and version_id<>new.accepted_version_id and status='requested';
 end if;
 return new;
end $$;
create trigger supersede_payment_requests after update of accepted_version_id on public.engagements
 for each row execute function public.supersede_payment_requests();
revoke execute on function public.create_payment_request(uuid,uuid,uuid,uuid),public.supersede_payment_requests() from public,anon,authenticated;
grant execute on function public.create_payment_request(uuid,uuid,uuid,uuid) to authenticated;
