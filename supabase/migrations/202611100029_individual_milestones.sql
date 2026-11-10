-- Individual milestone identities retain immutable scope/task references used by
-- evidence, deliveries and payments. Accepted-set snapshots carry references,
-- never fabricated party approvals.
create table public.milestones (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 proposer_id uuid not null references auth.users, latest_version_id uuid,
 accepted_version_id uuid, created_at timestamptz not null default now()
);
create table public.milestone_versions (
 id uuid primary key, scope_version_id uuid not null references public.scope_versions, milestone_id uuid not null references public.milestones,
 number integer not null check(number>0), task_id uuid not null unique references public.milestone_tasks,
 responsibilities text not null default '', reason text not null default '',
 operation_key uuid not null, unique(milestone_id,number)
);
create table public.milestone_events (
 message_id uuid primary key references public.messages, milestone_id uuid not null references public.milestones,
 version_id uuid not null references public.milestone_versions, event text not null check(event in('proposed','accepted')),
 unique(version_id,event)
);
create table public.milestone_operations (
 operation_key uuid primary key, engagement_id uuid not null references public.engagements,
 actor_id uuid not null references auth.users, payload jsonb not null, result uuid[] not null
);
do $$ declare t text;begin
 foreach t in array array['milestones','milestone_versions','milestone_events','milestone_operations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy milestone_member on public.milestones for select to authenticated using(public.member_role(engagement_id) is not null);
create policy milestone_version_member on public.milestone_versions for select to authenticated using(exists(select 1 from public.milestones m where m.id=milestone_id));
create policy milestone_event_member on public.milestone_events for select to authenticated using(exists(select 1 from public.milestones m where m.id=milestone_id));
create policy milestone_operation_actor on public.milestone_operations for select to authenticated using(actor_id=auth.uid() and public.member_role(engagement_id) is not null);

-- Import each historical task as its own identity: old randomly generated keys
-- are not evidence that tasks across whole-scope revisions are the same item.
-- Preserve actual scope approval records; never auto-approve legacy proposals.
do $$ declare t record; m uuid;begin
 for t in select task.*,s.author_id,s.content,g.accepted_version_id from public.milestone_tasks task
 join public.scope_versions s on s.id=task.version_id join public.engagements g on g.id=task.engagement_id loop
 insert into public.milestones(engagement_id,proposer_id,latest_version_id,accepted_version_id)
 values(t.engagement_id,t.author_id,t.version_id,case when t.version_id=t.accepted_version_id then t.version_id end) returning id into m;
 insert into public.milestone_versions(id,scope_version_id,milestone_id,number,task_id,responsibilities,reason,operation_key)
 values(t.id,t.version_id,m,1,t.id,coalesce(t.content->>'responsibilities',''),'Imported original agreement',gen_random_uuid());
 update public.milestones set latest_version_id=t.id,accepted_version_id=case when t.version_id=t.accepted_version_id then t.id end where id=m;
 end loop;
end $$;

alter table public.milestones add foreign key(latest_version_id) references public.milestone_versions deferrable initially deferred;
alter table public.milestones add foreign key(accepted_version_id) references public.milestone_versions deferrable initially deferred;

create function public.is_current_milestone_task(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.milestone_tasks task join public.engagements g on g.id=task.engagement_id
 where task.id=t and public.member_role(g.id) is not null and
 (exists(select 1 from public.milestone_versions v join public.milestones m on m.id=v.milestone_id where v.task_id=task.id and m.accepted_version_id=v.id)
 or (not exists(select 1 from public.milestone_versions v where v.task_id=task.id) and task.version_id=g.accepted_version_id)));
$$;

create function public.milestone_event(v uuid,action text) returns void language plpgsql security definer set search_path='' as $$
declare m public.milestones; msg uuid; n integer;begin
 select x.* into m from public.milestones x join public.milestone_versions mv on mv.milestone_id=x.id where mv.id=v;
 select number into n from public.milestone_versions where id=v;
 if exists(select 1 from public.milestone_events where version_id=v and event=action) then return;end if;
 insert into public.messages(engagement_id,author_id,visibility,kind,body)
 values(m.engagement_id,auth.uid(),'shared','system','Milestone '||action||' · version '||n||': '||(select title from public.milestone_tasks where id=(select task_id from public.milestone_versions where id=v))) returning id into msg;
 insert into public.milestone_events values(msg,m.id,v,action);
 insert into public.notifications(recipient_id,engagement_id,kind,record_id)
 select user_id,m.engagement_id,case when action='accepted' then 'agreement_accepted' else 'approval' end,v
 from public.memberships where engagement_id=m.engagement_id and user_id<>auth.uid();
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(m.engagement_id,auth.uid(),'milestone_'||action,v);
end $$;

create function public.snapshot_accepted_milestones(e uuid) returns void language plpgsql security definer set search_path='' as $$
declare c jsonb; s uuid; n integer;begin
 select jsonb_build_object('deliverables',string_agg(case when source.content ? 'milestoneId' then source.content->>'deliverables' else t.title end,E'\n' order by m.created_at,m.id),
 'acceptanceCriteria',string_agg(t.acceptance_criteria,E'\n' order by m.created_at,m.id),
 'responsibilities',string_agg(v.responsibilities,E'\n' order by m.created_at,m.id),
 'priceCents',sum(t.amount_cents),'currency','USD','paymentTerms','Due on client acceptance of each milestone.',
 'schedule',string_agg(t.end_date::text,E'\n' order by m.created_at,m.id),
 'exclusions','','assumptions','','milestones','[]'::jsonb,
 'acceptedMilestones',jsonb_agg(jsonb_build_object('milestoneId',m.id,'versionId',v.id,'taskId',t.id,'description',case when source.content ? 'milestoneId' then source.content->>'deliverables' else t.title end,'acceptanceCriteria',t.acceptance_criteria,'responsibilities',v.responsibilities,'amountCents',t.amount_cents,'targetDate',t.end_date) order by m.created_at,m.id),
 'change',jsonb_build_object('reason','Accepted milestone set updated','baseVersion',g.accepted_version_id)) into c
 from public.milestones m join public.milestone_versions v on v.id=m.accepted_version_id
 join public.milestone_tasks t on t.id=v.task_id join public.scope_versions source on source.id=v.scope_version_id join public.engagements g on g.id=m.engagement_id where m.engagement_id=e group by g.accepted_version_id;
 if c is null then return;end if;
 select coalesce(max(number),0)+1 into n from public.scope_versions where engagement_id=e;
 insert into public.scope_versions(engagement_id,author_id,number,content) values(e,auth.uid(),n,c) returning id into s;
 update public.engagements set accepted_version_id=s,status='active' where id=e;
end $$;

create function public.submit_individual_milestones(e uuid,rows jsonb,k uuid,m uuid default null,expected uuid default null,reason text default '') returns uuid[]
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); r public.party_role; g public.engagements; prior public.milestone_operations;
 item public.milestones; row jsonb; c jsonb; v uuid; task uuid; n integer; local_number integer; result uuid[]:='{}'; payload jsonb;
begin
 r:=public.member_role(e);if r is null then raise exception 'Forbidden';end if;
 select * into g from public.engagements where id=e for update;
 payload:=jsonb_build_object('rows',rows,'milestone',m,'expected',expected,'reason',reason);
 select * into prior from public.milestone_operations where operation_key=k;
 if prior.operation_key is not null then
 if prior.engagement_id<>e or prior.actor_id<>u or prior.payload<>payload then raise exception 'Idempotency conflict';end if;
 return prior.result;end if;
 if k is null or g.funding<>'funded' or g.status not in('discussion','active') then raise exception 'Engagement unavailable';end if;
 if rows is null or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows) not between 1 and 30 or (m is not null and jsonb_array_length(rows)<>1) then raise exception 'Invalid milestones';end if;
 if m is not null then
 select * into item from public.milestones where id=m and engagement_id=e for update;
 if item.id is null then raise exception 'Forbidden';end if;
 if item.latest_version_id is distinct from expected then raise exception 'Stale milestone version; refresh before submitting';end if;
 if item.accepted_version_id is not null and length(trim(coalesce(reason,'')))=0 then raise exception 'Explain the milestone revision';end if;
 elsif expected is not null then raise exception 'Unexpected version';end if;
 if length(coalesce(reason,''))>3000 then raise exception 'Revision reason too long';end if;
 for row in select value from jsonb_array_elements(rows) loop
 if not(row ?& array['description','amountCents','targetDate','acceptanceCriteria','responsibilities']) or
 jsonb_typeof(row->'description')<>'string' or length(trim(row->>'description')) not between 1 and 5000 or
 jsonb_typeof(row->'acceptanceCriteria')<>'string' or length(trim(row->>'acceptanceCriteria')) not between 1 and 5000 or
 jsonb_typeof(row->'responsibilities')<>'string' or length(row->>'responsibilities')>5000 or
 jsonb_typeof(row->'amountCents')<>'number' or (row->>'amountCents') !~ '^[0-9]+$' or (row->>'amountCents')::bigint>100000000 or
 (row->>'targetDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid milestone details';end if;
 if m is null then
 insert into public.milestones(engagement_id,proposer_id) values(e,u) returning * into item;
 end if;
 select coalesce(max(number),0)+1 into local_number from public.milestone_versions where milestone_id=item.id;
 select coalesce(max(number),0)+1 into n from public.scope_versions where engagement_id=e;
 c:=jsonb_build_object('deliverables',row->>'description','acceptanceCriteria',row->>'acceptanceCriteria','responsibilities',row->>'responsibilities',
 'priceCents',(row->>'amountCents')::bigint,'currency','USD','paymentTerms','Due on client acceptance of this milestone.',
 'schedule',row->>'targetDate','assumptions','','exclusions','',
 'milestoneId',item.id,'milestoneNumber',local_number,
 'milestones',jsonb_build_array(jsonb_build_object('key',item.id,'title',left(row->>'description',200),'owner','professional',
 'startDate',row->>'targetDate','endDate',row->>'targetDate','acceptanceCriteria',row->>'acceptanceCriteria',
 'paymentTerms','Due on client acceptance of this milestone.','amountCents',(row->>'amountCents')::bigint,'dependencies','[]'::jsonb)),
 'change',jsonb_build_object('baseVersion',g.accepted_version_id,'reason',reason));
 insert into public.scope_versions(engagement_id,author_id,number,supersedes,content) values(e,u,n,item.latest_version_id,c) returning id into v;
 select id into task from public.milestone_tasks where version_id=v;
 insert into public.milestone_versions values(v,v,item.id,local_number,task,row->>'responsibilities',coalesce(reason,''),k);
 insert into public.approvals(version_id,user_id,role) values(v,u,r);
 update public.milestones set latest_version_id=v where id=item.id;
 perform public.milestone_event(v,'proposed');result:=array_append(result,v);
 end loop;
 insert into public.milestone_operations values(k,e,u,payload,result);return result;
end $$;

create function public.accept_milestone(v uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); m public.milestones; r public.party_role; e uuid; scope_id uuid;begin
 select x.engagement_id into e from public.milestones x join public.milestone_versions mv on mv.milestone_id=x.id where mv.id=v;
 r:=public.member_role(e);if r is null then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=e and status in('discussion','active') for update;
 if not found then raise exception 'Engagement is closed';end if;
 select x.* into m from public.milestones x join public.milestone_versions mv on mv.milestone_id=x.id where mv.id=v for update of x;
 if m.latest_version_id<>v then raise exception 'Stale milestone version; review the latest proposal';end if;
 if m.accepted_version_id=v then return;end if;
 select scope_version_id into scope_id from public.milestone_versions where id=v;
 insert into public.approvals(version_id,user_id,role) values(scope_id,u,r) on conflict do nothing;
 if (select count(distinct user_id) from public.approvals where version_id=scope_id)=2 then
 update public.milestones set accepted_version_id=v where id=m.id;
 perform public.snapshot_accepted_milestones(e);perform public.milestone_event(v,'accepted');
 end if;
end $$;

-- Keep existing delivery and calendar behaviour, changing only their accepted
-- task predicate. Assert the original definition matches before replacing it.
do $$ declare signature text; definition text; old text;begin
 foreach signature in array array['public.report_task_progress(uuid,integer)','public.submit_delivery(uuid,text,text[],uuid[],uuid)','public.review_delivery(uuid,text,text)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 old:='accepted_version_id=task.version_id';
 if position(old in definition)=0 then raise exception 'Unexpected task authorization definition';end if;
 execute replace(definition,old,'public.is_current_milestone_task(task.id)');
 end loop;
 definition:=pg_get_functiondef('public.propose_meeting(uuid,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,uuid,uuid)'::regprocedure);
 execute replace(definition,'t.version_id=g.accepted_version_id','public.is_current_milestone_task(t.id)');
end $$;

create or replace function public.supersede_payment_requests() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.accepted_version_id is distinct from old.accepted_version_id and new.accepted_version_id is not null then
 update public.payment_requests p set status='superseded' where p.engagement_id=new.id and p.status='requested' and
 ((p.task_id is not null and not public.is_current_milestone_task(p.task_id)) or (p.task_id is null and p.version_id<>new.accepted_version_id));
 end if;return new;end $$;

revoke all on function public.milestone_event(uuid,text),public.snapshot_accepted_milestones(uuid) from public,anon,authenticated;
revoke all on function public.is_current_milestone_task(uuid),public.submit_individual_milestones(uuid,jsonb,uuid,uuid,uuid,text),public.accept_milestone(uuid) from public,anon;
grant execute on function public.is_current_milestone_task(uuid),public.submit_individual_milestones(uuid,jsonb,uuid,uuid,uuid,text),public.accept_milestone(uuid) to authenticated;

-- Retain the existing payment RPC and its authorization/idempotency checks.
-- Only substitute current-task selection and normalize its immutable reference.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.create_payment_request(uuid,uuid,uuid,uuid)'::regprocedure);
 definition:=replace(definition,'where id=t and version_id=expected and engagement_id=e','where id=t and public.is_current_milestone_task(id) and engagement_id=e');
 definition:=replace(definition,'cents:=task.amount_cents;terms:=task.payment_terms;label:=task.title;',
 'if exists(select 1 from public.payment_requests where task_id=t and status=''requested'') then raise exception ''Payment already requested for this milestone'';end if; cents:=task.amount_cents;terms:=task.payment_terms;label:=task.title;');
 -- The snapshot is the exact accepted set at request time; task_id pins the
 -- individual version. Unrelated snapshot changes cannot supersede it.
 execute definition;
end $$;

-- Prevent the legacy whole-set acceptance endpoint bypassing individual review.
create or replace function public.approve_scope(s uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); e uuid; r public.party_role;begin
 select engagement_id into e from public.scope_versions where id=s;
 if exists(select 1 from public.milestones where engagement_id=e) then raise exception 'Use individual milestone acceptance';end if;
 r:=public.member_role(e);if r is null then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=e and status in('discussion','active') for update;
 if not found then raise exception 'Engagement is closed';end if;
 if s is distinct from(select id from public.scope_versions where engagement_id=e order by number desc limit 1) then raise exception 'Stale version';end if;
 insert into public.approvals(version_id,user_id,role) values(s,u,r) on conflict do nothing;
 if(select count(*) from public.approvals where version_id=s)=2 then update public.engagements set accepted_version_id=s,status='active' where id=e;end if;
end $$;

-- Existing notifications fire for legacy agreements; individual events own
-- their notification so submissions/replays produce exactly one notice.
create or replace function public.notify_approval() returns trigger language plpgsql security definer set search_path='' as $$
declare e uuid;begin
 select engagement_id into e from public.scope_versions where id=new.version_id;
 if exists(select 1 from public.scope_versions where id=new.version_id and content ? 'milestoneId') then return new;end if;
 insert into public.notifications(recipient_id,engagement_id,kind,record_id)
 select user_id,e,'approval',new.version_id from public.memberships where engagement_id=e and user_id<>new.user_id;
 return new;end $$;
create or replace function public.notify_engagement_event() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.accepted_version_id is distinct from old.accepted_version_id and new.accepted_version_id is not null
 and not exists(select 1 from public.scope_versions where id=new.accepted_version_id and content ? 'acceptedMilestones') then
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,new.id,'agreement_accepted',new.accepted_version_id from public.memberships where engagement_id=new.id;
 end if;return new;end $$;
create or replace function public.require_change_explanation() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.milestones where engagement_id=new.engagement_id) and not(new.content ? 'milestoneId' or new.content ? 'acceptedMilestones') then raise exception 'Submit individual milestone proposals';end if;
 if exists(select 1 from public.engagements where id=new.engagement_id and accepted_version_id is not null) and not(new.content ? 'change') then raise exception 'Explain the change against the accepted agreement';end if;
 return new;end $$;

-- Retrieval continues to use stable agreement citations. Include each current
-- pending/accepted milestone source, and distinguish it from the set snapshot.
create function public.milestone_scope_state(s uuid) returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.engagements g where g.accepted_version_id=s) or
 exists(select 1 from public.milestones m join public.milestone_versions v on v.id=m.accepted_version_id where v.scope_version_id=s) then 'agreed' else 'proposed' end;
$$;
revoke all on function public.milestone_scope_state(uuid) from public,anon,authenticated;
do $$ declare signature text;definition text;begin
 foreach signature in array array['public.milestone_agent_context(uuid)','public.search_agent_evidence(uuid,public.visibility,text)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 definition:=replace(definition,'case when s.id=g.accepted_version_id then ''agreed'' else ''proposed'' end','public.milestone_scope_state(s.id)');
 definition:=replace(definition,'(s.id=g.accepted_version_id or s.number=(select max(number) from public.scope_versions where engagement_id=e))',
 '(s.id=g.accepted_version_id or s.number=(select max(number) from public.scope_versions where engagement_id=e) or exists(select 1 from public.milestones mi join public.milestone_versions mv on mv.id in(mi.latest_version_id,mi.accepted_version_id) where mi.engagement_id=e and mv.scope_version_id=s.id))');
 execute definition;
 end loop;
end $$;

-- Import chronological proposal/acceptance announcements at their original
-- timestamps. No invitation, notification, or email is sent by this backfill.
do $$ declare v record;msg uuid;begin
 for v in select mv.*,s.engagement_id,s.author_id,s.created_at,t.title,m.accepted_version_id from public.milestone_versions mv
 join public.scope_versions s on s.id=mv.scope_version_id join public.milestone_tasks t on t.id=mv.task_id join public.milestones m on m.id=mv.milestone_id loop
 insert into public.messages(engagement_id,author_id,visibility,kind,body,created_at)
 values(v.engagement_id,v.author_id,'shared','system','Milestone proposed · version 1: '||v.title,v.created_at) returning id into msg;
 insert into public.milestone_events values(msg,v.milestone_id,v.id,'proposed');
 if v.accepted_version_id=v.id then
 insert into public.messages(engagement_id,author_id,visibility,kind,body,created_at)
 values(v.engagement_id,v.author_id,'shared','system','Milestone accepted · version 1: '||v.title,coalesce((select max(created_at) from public.approvals where version_id=v.scope_version_id),v.created_at)) returning id into msg;
 insert into public.milestone_events values(msg,v.milestone_id,v.id,'accepted');
 end if;
 end loop;
end $$;
