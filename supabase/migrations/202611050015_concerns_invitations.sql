-- Shared concern records do not alter scope, payment, or engagement status.
create table public.concern_cases (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 opened_by uuid not null references auth.users, title text not null check(length(title) between 5 and 160),
 description text not null check(length(description) between 10 and 5000),
 desired_outcome text not null check(length(desired_outcome) between 3 and 3000),
 status text not null default 'open' check(status in('open','resolved')),
 operation_key uuid not null unique, created_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.concern_updates (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.concern_cases,
 author_id uuid not null references auth.users, body text not null check(length(body) between 1 and 5000),
 operation_key uuid not null unique, created_at timestamptz not null default now()
);
create table public.concern_acknowledgements (
 case_id uuid not null references public.concern_cases, role public.party_role not null,
 actor_id uuid not null references auth.users, created_at timestamptz not null default now(),
 primary key(case_id,role), unique(case_id,actor_id)
);
do $$declare t text;begin foreach t in array array['concern_cases','concern_updates','concern_acknowledgements'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
end loop;end $$;
create policy concern_member on public.concern_cases for select to authenticated
 using(public.member_role(engagement_id) is not null);
create policy concern_update_member on public.concern_updates for select to authenticated
 using(exists(select 1 from public.concern_cases c where c.id=case_id and public.member_role(c.engagement_id) is not null));
create policy concern_ack_member on public.concern_acknowledgements for select to authenticated
 using(exists(select 1 from public.concern_cases c where c.id=case_id and public.member_role(c.engagement_id) is not null));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
 check(kind in('message','mention','reply','approval','agreement_accepted','invitation_accepted','delivery','delivery_review','meeting','meeting_response','review_published','concern'));

create function public.revoke_invitation(i uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); inv public.invitations;begin
 select * into inv from public.invitations where id=i for update;
 if inv.id is null or public.member_role(inv.engagement_id) is null then raise exception 'Invitation unavailable';end if;
 if inv.accepted_at is not null then raise exception 'Accepted invitation cannot be revoked';end if;
 if inv.revoked_at is not null then return;end if;
 update public.invitations set revoked_at=now() where id=i;
 insert into public.audit_events(engagement_id,actor_id,action,record_id)
 values(inv.engagement_id,u,'invitation_revoked',i);
end $$;

create function public.open_concern(e uuid,t text,b text,outcome text,k uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); prior public.concern_cases; result uuid;
 cleaned_title text:=trim(t); cleaned_body text:=trim(b); cleaned_outcome text:=trim(outcome);begin
 if k is null or length(cleaned_title) not between 5 and 160 or length(cleaned_body) not between 10 and 5000
    or length(cleaned_outcome) not between 3 and 3000 then raise exception 'Invalid concern';end if;
 perform 1 from public.engagements where id=e and status<>'archived' for update;
 if not found or public.member_role(e) is null then raise exception 'Engagement unavailable';end if;
 select * into prior from public.concern_cases where operation_key=k;
 if prior.id is not null then
   if prior.engagement_id<>e or prior.opened_by<>u or prior.title<>cleaned_title or prior.description<>cleaned_body or prior.desired_outcome<>cleaned_outcome
     then raise exception 'Idempotency conflict';end if;
   return prior.id;
 end if;
 insert into public.concern_cases(engagement_id,opened_by,title,description,desired_outcome,operation_key)
 values(e,u,cleaned_title,cleaned_body,cleaned_outcome,k) returning id into result;
 insert into public.messages(engagement_id,author_id,visibility,kind,body)
 values(e,u,'shared','human','Concern opened: '||cleaned_title||E'\n'||cleaned_body||E'\nDesired outcome: '||cleaned_outcome||E'\nThis does not change the agreement.');
 insert into public.notifications(recipient_id,engagement_id,kind,record_id)
 select user_id,e,'concern',result from public.memberships where engagement_id=e and user_id<>u;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(e,u,'concern_opened',result);
 return result;
end $$;

create function public.add_concern_update(c uuid,b text,k uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); concern public.concern_cases; prior public.concern_updates; result uuid; cleaned text:=trim(b);begin
 if k is null or length(cleaned) not between 1 and 5000 then raise exception 'Invalid concern update';end if;
 select * into concern from public.concern_cases where id=c for update;
 if concern.id is null or public.member_role(concern.engagement_id) is null then raise exception 'Concern unavailable';end if;
 select * into prior from public.concern_updates where operation_key=k;
 if prior.id is not null then
   if prior.case_id<>c or prior.author_id<>u or prior.body<>cleaned then raise exception 'Idempotency conflict';end if;
   return prior.id;
 end if;
 if concern.status<>'open' then raise exception 'Concern is resolved';end if;
 insert into public.concern_updates(case_id,author_id,body,operation_key) values(c,u,cleaned,k) returning id into result;
 insert into public.messages(engagement_id,author_id,visibility,kind,body)
 values(concern.engagement_id,u,'shared','human','Concern update: '||concern.title||E'\n'||cleaned);
 insert into public.notifications(recipient_id,engagement_id,kind,record_id)
 select user_id,concern.engagement_id,'concern',c from public.memberships where engagement_id=concern.engagement_id and user_id<>u;
 return result;
end $$;

create function public.acknowledge_concern(c uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); concern public.concern_cases; r public.party_role;begin
 select * into concern from public.concern_cases where id=c for update;
 r:=public.member_role(concern.engagement_id);
 if concern.id is null or r is null then raise exception 'Concern unavailable';end if;
 if concern.status='resolved' then return;end if;
 insert into public.concern_acknowledgements(case_id,role,actor_id) values(c,r,u) on conflict(case_id,role) do nothing;
 if (select count(*) from public.concern_acknowledgements where case_id=c)=2 then
   update public.concern_cases set status='resolved',resolved_at=now() where id=c;
   insert into public.messages(engagement_id,author_id,visibility,kind,body)
   values(concern.engagement_id,u,'shared','system','Both parties marked concern resolved: '||concern.title||'. Agreement and payment records are unchanged.');
   insert into public.audit_events(engagement_id,actor_id,action,record_id)
   values(concern.engagement_id,u,'concern_resolved',c);
 else
   insert into public.notifications(recipient_id,engagement_id,kind,record_id)
   select user_id,concern.engagement_id,'concern',c from public.memberships where engagement_id=concern.engagement_id and user_id<>u;
 end if;
end $$;

revoke execute on function public.revoke_invitation(uuid),public.open_concern(uuid,text,text,text,uuid),
 public.add_concern_update(uuid,text,uuid),public.acknowledge_concern(uuid) from public,anon,authenticated;
grant execute on function public.revoke_invitation(uuid),public.open_concern(uuid,text,text,text,uuid),
 public.add_concern_update(uuid,text,uuid),public.acknowledge_concern(uuid) to authenticated;
