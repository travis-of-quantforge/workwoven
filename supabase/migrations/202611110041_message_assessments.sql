create table public.scope_monitor_settings(engagement_id uuid primary key references public.engagements,enabled boolean not null default true);
create table public.message_assessments (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 message_id uuid not null unique references public.messages, actor_id uuid not null references auth.users,
 terms jsonb not null, status text not null check(status in('queued','running','checked','flagged','skipped','failed','stale')),
 reason text, result jsonb, operation_id uuid unique references public.usage_operations,
 notice_message_id uuid unique references public.messages, budget_nano bigint, charge_nano bigint,
 created_at timestamptz not null default now(), finished_at timestamptz
);
create index assessment_pending on public.message_assessments(status,created_at);
do $$declare t text;begin foreach t in array array['scope_monitor_settings','message_assessments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy monitor_member on public.%I for select to authenticated using(public.member_role(engagement_id) is not null)',t);
 end loop;end $$;

create function public.accepted_monitor_terms(e uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(term order by term->>'ref'),'[]'::jsonb) from (
 select jsonb_build_object('ref','contract:'||v.id,'version',v.number::text,'body',v.body) term
 from public.engagement_contracts c join public.contract_versions v on v.id=c.accepted_version_id where c.engagement_id=e
 union all
 select jsonb_build_object('ref','milestone:'||v.id,'version',v.number::text,'body',
 jsonb_build_object('description',case when s.content ? 'milestoneId' then s.content->>'deliverables' else t.title end,'acceptanceCriteria',t.acceptance_criteria,'clientResponsibilities',v.responsibilities,'amountCents',t.amount_cents,'currency','USD','targetDate',t.end_date,'paymentTerms',t.payment_terms)::text)
 from public.milestones m join public.milestone_versions v on v.id=m.accepted_version_id join public.milestone_tasks t on t.id=v.task_id join public.scope_versions s on s.id=v.scope_version_id where m.engagement_id=e
 union all
 select jsonb_build_object('ref','agreement:'||s.id,'version',s.number::text,'body',s.content::text)
 from public.engagements g join public.scope_versions s on s.id=g.accepted_version_id where g.id=e and not exists(select 1 from public.milestones m where m.engagement_id=e and m.accepted_version_id is not null)
 ) accepted;
$$;
revoke all on function public.accepted_monitor_terms(uuid) from public,anon,authenticated;
grant execute on function public.accepted_monitor_terms(uuid) to service_role;

create function public.enqueue_message_assessment() returns trigger language plpgsql security definer set search_path='' as $$
declare terms jsonb;why text;begin
 if new.visibility<>'shared' or new.kind not in('human','share') or new.channel<>'discussion' then return new;end if;
 terms:=public.accepted_monitor_terms(new.engagement_id);
 if coalesce((select enabled from public.scope_monitor_settings where engagement_id=new.engagement_id),true)=false then why:='paused';
 elsif terms='[]'::jsonb then why:='no_accepted_terms';end if;
 if why is null and octet_length(terms::text)+octet_length(new.body)>48000 then why:='context_too_large';end if;
 insert into public.message_assessments(engagement_id,message_id,actor_id,terms,status,reason,finished_at)
 values(new.engagement_id,new.id,new.author_id,terms,case when why is null then 'queued' else 'skipped' end,why,case when why is not null then now() end);
 return new;end $$;
create trigger enqueue_message_assessment after insert on public.messages for each row execute function public.enqueue_message_assessment();
revoke all on function public.enqueue_message_assessment() from public,anon,authenticated;

create function public.set_scope_monitor(e uuid,enabled boolean) returns void language plpgsql security definer set search_path='' as $$begin
 perform public.require_verified();if public.member_role(e) is null then raise exception 'Forbidden';end if;
 insert into public.scope_monitor_settings values(e,enabled) on conflict(engagement_id) do update set enabled=excluded.enabled;
end $$;
revoke all on function public.set_scope_monitor(uuid,boolean) from public,anon;
grant execute on function public.set_scope_monitor(uuid,boolean) to authenticated;

create function public.claim_message_assessment(j uuid,price uuid,budget bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare job public.message_assessments;a uuid;op uuid;why text;e uuid;begin
 select engagement_id into e from public.message_assessments where id=j;
 perform 1 from public.engagements where id=e for update;
 select * into job from public.message_assessments where id=j for update skip locked;
 if job.id is null or job.status<>'queued' then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('scope-check:'||job.actor_id::text,0));
 if not exists(select 1 from public.engagements where id=e and status in('discussion','active') and funding='funded') then why:='engagement_unavailable';
 elsif not coalesce((select enabled from public.scope_monitor_settings where engagement_id=e),true) then why:='paused';
 elsif job.terms<>public.accepted_monitor_terms(e) then why:='terms_changed';
 elsif budget is null or budget<=0 or budget>100000000 then why:='operation_budget';
 elsif (select count(*) from public.message_assessments where engagement_id=e and operation_id is not null and created_at>now()-interval '1 day')>=60 then why:='daily_limit';
 elsif (select count(*) from public.message_assessments where actor_id=job.actor_id and operation_id is not null and created_at>now()-interval '1 minute')>=6 then why:='rate_limit';
 elsif (select coalesce(sum(coalesce(charge_nano,budget_nano)),0) from public.message_assessments where engagement_id=e and operation_id is not null and created_at>now()-interval '1 day')+budget>500000000 then why:='daily_budget';
 elsif not exists(select 1 from public.ai_pricing where id=price and enabled and markup=2) then why:='pricing_unavailable';end if;
 if why is not null then update public.message_assessments set status='skipped',reason=why,finished_at=now() where id=j;return null;end if;
 select id into a from public.agent_accounts where engagement_id=e and visibility='shared';
 begin op:=public.reserve_usage(a,job.actor_id,job.id,budget);
 exception when others then update public.message_assessments set status='skipped',reason='credits_unavailable',finished_at=now() where id=j;return null;end;
 update public.usage_operations set pricing_snapshot=(select (to_jsonb(p)-'enabled')||jsonb_build_object('purpose','scope_monitor') from public.ai_pricing p where p.id=price) where id=op;
 update public.message_assessments set status='running',operation_id=op,budget_nano=budget where id=j;return op;
 -- Pricing quantities are also snapshotted by record_usage per provider response.
end $$;

create function public.finish_message_assessment(j uuid,payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare job public.message_assessments;source public.messages;term jsonb;issue jsonb;actual bigint;op public.usage_operations;msg uuid;verdict text;e uuid;begin
 select engagement_id into e from public.message_assessments where id=j;
 perform 1 from public.engagements where id=e for update;
 select * into job from public.message_assessments where id=j for update;
 if job.status in('checked','flagged','stale') then return;end if;
 if job.status<>'running' then raise exception 'Assessment not running';end if;
 select * into op from public.usage_operations where id=job.operation_id for update;
 if op.status<>'reserved' or op.expires_at<now() then raise exception 'Assessment reservation expired';end if;
 if job.terms<>public.accepted_monitor_terms(e) then
 perform public.settle_usage(op.id,0,'internal_error',jsonb_build_object('purpose','scope_monitor','reason','stale_terms'));
 update public.message_assessments set status='stale',charge_nano=0,reason='terms_changed',finished_at=now() where id=j;return;end if;
 select * into source from public.messages where id=job.message_id and engagement_id=e and author_id=job.actor_id and visibility='shared' and kind in('human','share') and channel='discussion';
 verdict:=payload->>'verdict';
 if source.id is null or not(payload ?& array['verdict','isRequest','summary','issues']) or verdict is null or verdict not in('no_issue','potential_conflict','needs_clarification') or jsonb_typeof(payload->'isRequest')<>'boolean' or jsonb_typeof(payload->'summary')<>'string' or length(payload->>'summary') not between 1 and 2000 or jsonb_typeof(payload->'issues')<>'array' or jsonb_array_length(payload->'issues')>3 then raise exception 'Invalid assessment';end if;
 if verdict='potential_conflict' and (payload->>'isRequest'<>'true' or jsonb_array_length(payload->'issues')=0) then raise exception 'Grounded issue required';end if;
 for issue in select * from jsonb_array_elements(payload->'issues') loop
 if not(issue ?& array['messageQuote','termRef','termQuote','explanation']) or jsonb_typeof(issue->'messageQuote')<>'string' or jsonb_typeof(issue->'termQuote')<>'string' or jsonb_typeof(issue->'explanation')<>'string' then raise exception 'Ungrounded assessment';end if;
 select value into term from jsonb_array_elements(job.terms) where value->>'ref'=issue->>'termRef';
 if term is null or length(issue->>'messageQuote') not between 1 and 2000 or strpos(source.body,issue->>'messageQuote')=0 or length(issue->>'termQuote') not between 1 and 2000 or strpos(term->>'body',issue->>'termQuote')=0 or length(issue->>'explanation') not between 1 and 2000 then raise exception 'Ungrounded assessment';end if;
 end loop;
 select coalesce(sum(provider_nano),0) into actual from public.usage_metering where operation_id=op.id;
 if actual*2>op.reserved_nano then raise exception 'Assessment exceeded budget';end if;
 perform public.settle_usage(op.id,actual,'success',op.pricing_snapshot||jsonb_build_object('messageId',source.id));
 if verdict='potential_conflict' then
 insert into public.messages(engagement_id,author_id,visibility,kind,body,reply_to,channel)
 values(e,job.actor_id,'shared','agent','Potential scope or contract issue (AI advice): '||(payload->>'summary'),source.id,'discussion') returning id into msg;
 end if;
 update public.message_assessments set status=case when msg is null then 'checked' else 'flagged' end,result=payload,notice_message_id=msg,charge_nano=actual*2,finished_at=now() where id=j;
end $$;

create function public.fail_message_assessment(j uuid,why text) returns void language plpgsql security definer set search_path='' as $$
declare job public.message_assessments;begin
 select * into job from public.message_assessments where id=j for update;
 if job.id is null or job.status not in('queued','running') then return;end if;
 if job.operation_id is not null then perform public.settle_usage(job.operation_id,0,'internal_error',jsonb_build_object('purpose','scope_monitor'));end if;
 update public.message_assessments set status=case when operation_id is null then 'skipped' else 'failed' end,charge_nano=0,reason=left(why,100),finished_at=now() where id=j;
end $$;
revoke all on function public.claim_message_assessment(uuid,uuid,bigint),public.finish_message_assessment(uuid,jsonb),public.fail_message_assessment(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_message_assessment(uuid,uuid,bigint),public.finish_message_assessment(uuid,jsonb),public.fail_message_assessment(uuid,text) to service_role;
do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.message_assessments;end if;end $$;

-- Manual shared-agent prompts are inserted into their own channel before the
-- queue trigger sees them, rather than being reclassified after insertion.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.begin_agent_run(uuid,public.visibility,uuid,text,uuid,bigint,uuid,text,integer,integer)'::regprocedure);
 definition:=replace(definition,'insert into public.messages(engagement_id,author_id,visibility,body) values(e,actor,v,question)',
 'insert into public.messages(engagement_id,author_id,visibility,body,channel) values(e,actor,v,question,''agent'')');
 execute definition;
end $$;
