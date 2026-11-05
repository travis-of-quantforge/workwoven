-- Every schedule is part of an immutable agreement version. Progress and delivery
-- facts are separate records and cannot change dates, dependencies or payment terms.
create table public.milestone_tasks (
 id uuid primary key default gen_random_uuid(), version_id uuid not null references public.scope_versions,
 engagement_id uuid not null references public.engagements, task_key uuid not null,
 position integer not null, title text not null check(length(title) between 1 and 200),
 owner public.party_role not null, start_date date not null, end_date date not null check(end_date>=start_date),
 acceptance_criteria text not null check(length(acceptance_criteria) between 1 and 5000),
 payment_terms text not null check(length(payment_terms) between 1 and 2000),
 amount_cents bigint not null check(amount_cents between 0 and 100000000),
 unique(version_id,task_key), unique(version_id,position)
);
create table public.task_dependencies (
 version_id uuid not null, task_key uuid not null, predecessor_key uuid not null,
 primary key(version_id,task_key,predecessor_key), check(task_key<>predecessor_key),
 foreign key(version_id,task_key) references public.milestone_tasks(version_id,task_key),
 foreign key(version_id,predecessor_key) references public.milestone_tasks(version_id,task_key)
);
create table public.task_progress (
 task_id uuid primary key references public.milestone_tasks, percent integer not null check(percent between 0 and 100),
 actor_id uuid not null references auth.users, updated_at timestamptz not null default now()
);
create table public.delivery_submissions (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references public.milestone_tasks,
 author_id uuid not null references auth.users, number integer not null, message text not null check(length(message) between 1 and 10000),
 links text[] not null default '{}', operation_key uuid not null unique,
 created_at timestamptz not null default now(), unique(task_id,number)
);
create table public.delivery_files (
 submission_id uuid references public.delivery_submissions, attachment_id uuid references public.attachments,
 primary key(submission_id,attachment_id)
);
create table public.delivery_reviews (
 submission_id uuid primary key references public.delivery_submissions, reviewer_id uuid not null references auth.users,
 decision text not null check(decision in('accepted','changes_requested')),
 reason text not null check(length(reason) between 1 and 5000), created_at timestamptz not null default now()
);
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in('message','mention','reply','approval','agreement_accepted','invitation_accepted','delivery','delivery_review','meeting','meeting_response'));

-- Validation also runs on direct RPC calls; browser schemas are only a convenience.
create function public.materialize_milestones() returns trigger language plpgsql security definer set search_path='' as $$
declare tasks jsonb:=coalesce(new.content->'milestones','[]'); t jsonb; d jsonb; pos integer:=0; begin
 if jsonb_typeof(tasks)<>'array' or jsonb_array_length(tasks)>30 then raise exception 'Invalid milestone plan';end if;
 for t in select value from jsonb_array_elements(tasks) loop
 pos:=pos+1;
 if not(t ?& array['key','title','owner','startDate','endDate','acceptanceCriteria','paymentTerms','amountCents','dependencies']) or
 jsonb_typeof(t->'title')<>'string' or jsonb_typeof(t->'acceptanceCriteria')<>'string' or jsonb_typeof(t->'paymentTerms')<>'string' or
 (t->>'startDate') !~ '^\d{4}-\d{2}-\d{2}$' or (t->>'endDate') !~ '^\d{4}-\d{2}-\d{2}$' or
 jsonb_typeof(t->'amountCents')<>'number' or (t->>'amountCents') !~ '^[0-9]+$' or jsonb_typeof(t->'dependencies')<>'array' then raise exception 'Invalid milestone plan';end if;
 insert into public.milestone_tasks(version_id,engagement_id,task_key,position,title,owner,start_date,end_date,acceptance_criteria,payment_terms,amount_cents)
 values(new.id,new.engagement_id,(t->>'key')::uuid,pos,t->>'title',(t->>'owner')::public.party_role,(t->>'startDate')::date,(t->>'endDate')::date,t->>'acceptanceCriteria',t->>'paymentTerms',(t->>'amountCents')::bigint);
 end loop;
 if (select coalesce(sum(amount_cents),0) from public.milestone_tasks where version_id=new.id)>(new.content->>'priceCents')::bigint then raise exception 'Milestone amounts exceed agreement price';end if;
 for t in select value from jsonb_array_elements(tasks) loop
 for d in select value from jsonb_array_elements(t->'dependencies') loop
 insert into public.task_dependencies values(new.id,(t->>'key')::uuid,(d#>>'{}')::uuid);
 end loop;end loop;
 if exists(with recursive chain(start,key) as (
 select task_key,predecessor_key from public.task_dependencies where version_id=new.id
 union select c.start,d.predecessor_key from chain c join public.task_dependencies d on d.version_id=new.id and d.task_key=c.key
 )select 1 from chain where start=key) then raise exception 'Milestone dependencies contain a cycle';end if;
 if exists(select 1 from public.task_dependencies d join public.milestone_tasks t on t.version_id=d.version_id and t.task_key=d.task_key join public.milestone_tasks p on p.version_id=d.version_id and p.task_key=d.predecessor_key where d.version_id=new.id and t.start_date<p.end_date) then raise exception 'Dependent tasks must start after their predecessors finish';end if;
 return new;end $$;
create trigger materialize_milestones after insert on public.scope_versions for each row execute function public.materialize_milestones();

create or replace function public.submit_scope(e uuid,c jsonb,expected uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); latest uuid; n integer; s uuid; field text; g public.engagements; begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 select * into g from public.engagements where id=e for update;
 if g.status not in('discussion','active') then raise exception 'Engagement is closed';end if;
 select id,number into latest,n from public.scope_versions where engagement_id=e order by number desc limit 1;
 if latest is distinct from expected then raise exception 'Stale version; refresh before submitting';end if;
 if c is null or jsonb_typeof(c)<>'object' or not(c ?& array['deliverables','exclusions','assumptions','responsibilities','acceptanceCriteria','priceCents','currency','paymentTerms','schedule']) or c->>'currency'<>'USD' or jsonb_typeof(c->'priceCents')<>'number' or (c->>'priceCents') !~ '^[0-9]+$' or (c->>'priceCents')::bigint>100000000 then raise exception 'Invalid scope';end if;
 foreach field in array array['deliverables','exclusions','assumptions','responsibilities','acceptanceCriteria','paymentTerms','schedule'] loop
 if jsonb_typeof(c->field)<>'string' or length(trim(c->>field))=0 or length(c->>field)>(case when field in('deliverables','acceptanceCriteria') then 10000 else 5000 end) then raise exception 'Invalid scope';end if;end loop;
 -- Legacy submissions are still allowed; new UI revisions include this metadata.
 if c ? 'change' then
 if g.accepted_version_id is null or (c->'change'->>'baseVersion')::uuid is distinct from g.accepted_version_id or
 not(c->'change' ?& array['baseVersion','reason','affectedReferences','costImpact','scheduleImpact']) then raise exception 'Change must reference the accepted agreement';end if;
 foreach field in array array['reason','affectedReferences','costImpact','scheduleImpact'] loop
 if jsonb_typeof(c->'change'->field)<>'string' or length(trim(c->'change'->>field))=0 or length(c->'change'->>field)>3000 then raise exception 'Invalid change details';end if;end loop;end if;
 insert into public.scope_versions(engagement_id,author_id,number,supersedes,content) values(e,u,coalesce(n,0)+1,latest,c) returning id into s;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(e,u,'scope_submitted',s);
 return s;end $$;

create function public.propose_milestones(e uuid,tasks jsonb,expected uuid,base uuid,reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c jsonb; g public.engagements;begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 select * into g from public.engagements where id=e for update;
 if g.accepted_version_id is distinct from base then raise exception 'Accepted agreement changed; refresh';end if;
 select content into c from public.scope_versions where id=expected and engagement_id=e;
 if c is null then raise exception 'Submit scope before a milestone plan';end if;
 if length(trim(coalesce(reason,'')))=0 or length(reason)>3000 then raise exception 'Explain the schedule change';end if;
 c:=c||jsonb_build_object('milestones',tasks);
 if base is not null then c:=c||jsonb_build_object('change',jsonb_build_object('baseVersion',base,'reason',reason,'affectedReferences','Milestone schedule, dependencies and deliverables','costImpact','Agreement price unchanged; milestone allocation shown in proposal','scheduleImpact',reason));end if;
 return public.submit_scope(e,c,expected);end $$;

create function public.report_task_progress(t uuid,p integer) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); task public.milestone_tasks;begin
 select * into task from public.milestone_tasks where id=t;
 perform 1 from public.engagements where id=task.engagement_id and accepted_version_id=task.version_id and status='active' for update;
 if not found or public.member_role(task.engagement_id) is distinct from task.owner then raise exception 'Only the accepted task owner can report progress';end if;
 insert into public.task_progress values(t,p,u,now()) on conflict(task_id) do update set percent=excluded.percent,actor_id=u,updated_at=now();end $$;
create function public.submit_delivery(t uuid,b text,links text[],files uuid[],k uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); task public.milestone_tasks; prior public.delivery_submissions; s uuid; n integer;begin
 select * into task from public.milestone_tasks where id=t for update;
 if public.member_role(task.engagement_id) is distinct from 'professional'::public.party_role then raise exception 'Only the professional can submit delivery';end if;
 select * into prior from public.delivery_submissions where operation_key=k;
 if prior.id is not null then
 if prior.task_id<>t or prior.author_id<>u or prior.message<>b or prior.links is distinct from links or (select array_agg(attachment_id order by attachment_id) from public.delivery_files where submission_id=prior.id) is distinct from (select array_agg(x order by x) from(select distinct unnest(files) x) q) then raise exception 'Idempotency conflict';end if;
 return prior.id;end if;
 perform 1 from public.engagements where id=task.engagement_id and accepted_version_id=task.version_id and status='active' for update;
 if not found then raise exception 'Delivery requires the current accepted milestone';end if;
 if links is null or cardinality(links)>10 or exists(select 1 from unnest(links) l where l is null or length(l)>2000 or l !~ '^https://[^[:space:][:cntrl:]]+$') or files is null or cardinality(files)>10 then raise exception 'Invalid delivery links or files';end if;
 if exists(select 1 from unnest(files) f where f is null or not exists(select 1 from public.attachments where id=f and engagement_id=task.engagement_id and visibility='shared' and upload_status='ready')) then raise exception 'Delivery files must be shared in this engagement';end if;
 if exists(select 1 from public.delivery_submissions ds join public.delivery_reviews dr on dr.submission_id=ds.id where ds.task_id=t and dr.decision='accepted') then raise exception 'This milestone delivery is already accepted';end if;
 select max(number)+1 into n from public.delivery_submissions where task_id=t;
 insert into public.delivery_submissions(task_id,author_id,number,message,links,operation_key) values(t,u,coalesce(n,1),b,links,k) returning id into s;
 insert into public.delivery_files select s,f from(select distinct unnest(files) f)q;
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(task.engagement_id,u,'shared','system','Delivery submitted for '||task.title||' (agreement version '||(select number from public.scope_versions where id=task.version_id)||'). Review the versioned submission in Milestones.');
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,task.engagement_id,'delivery',s from public.memberships where engagement_id=task.engagement_id and role='client';
 return s;end $$;
create function public.review_delivery(s uuid,decision text,reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); sub public.delivery_submissions; task public.milestone_tasks; prior public.delivery_reviews;begin
 select * into sub from public.delivery_submissions where id=s;
 select * into task from public.milestone_tasks where id=sub.task_id for update;
 if public.member_role(task.engagement_id) is distinct from 'client'::public.party_role then raise exception 'Only the client can review delivery';end if;
 select * into prior from public.delivery_reviews where submission_id=s;
 if prior.submission_id is not null then if prior.decision<>decision or prior.reason<>reason then raise exception 'Delivery review already recorded';end if;return;end if;
 perform 1 from public.engagements where id=task.engagement_id and accepted_version_id=task.version_id and status='active' for update;
 if not found or sub.number<>(select max(number) from public.delivery_submissions where task_id=task.id) then raise exception 'Review the latest delivery against the current accepted milestone';end if;
 insert into public.delivery_reviews values(s,u,decision,reason,now());
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(task.engagement_id,u,'shared','system','Delivery '||replace(decision,'_',' ')||' for '||task.title||'. Agreement version '||(select number from public.scope_versions where id=task.version_id)||'. Reason: '||reason);
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,task.engagement_id,'delivery_review',s from public.memberships where engagement_id=task.engagement_id and role='professional';
 end $$;

do $$ declare t text;begin foreach t in array array['milestone_tasks','task_dependencies','task_progress','delivery_submissions','delivery_files','delivery_reviews'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy tasks_member on public.milestone_tasks for select to authenticated using(public.member_role(engagement_id) is not null);
create policy dependencies_member on public.task_dependencies for select to authenticated using(exists(select 1 from public.scope_versions s where s.id=version_id and public.member_role(s.engagement_id) is not null));
create policy progress_member on public.task_progress for select to authenticated using(exists(select 1 from public.milestone_tasks t where t.id=task_id and public.member_role(t.engagement_id) is not null));
create policy deliveries_member on public.delivery_submissions for select to authenticated using(exists(select 1 from public.milestone_tasks t where t.id=task_id and public.member_role(t.engagement_id) is not null));
create policy delivery_files_member on public.delivery_files for select to authenticated using(exists(select 1 from public.delivery_submissions s where s.id=submission_id));
create policy delivery_reviews_member on public.delivery_reviews for select to authenticated using(exists(select 1 from public.delivery_submissions s where s.id=submission_id));
revoke execute on function public.materialize_milestones,public.propose_milestones,public.report_task_progress,public.submit_delivery,public.review_delivery from public,anon,authenticated;
grant execute on function public.propose_milestones,public.report_task_progress,public.submit_delivery,public.review_delivery to authenticated;
