-- Durable shared findings extend assessment jobs; legacy results remain intact.
alter table public.message_assessments add column review_version integer not null default 0;
alter table public.message_assessments add column review_snapshot jsonb;
alter table public.message_assessments add column context_hash text;
alter table public.message_assessments add column review_prompt text;
alter table public.message_assessments add column requested boolean not null default false;
create table public.conversation_findings(
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 issue_key text not null, categories jsonb not null, explanation text not null, next_step text not null,
 evidence jsonb not null, resolution_evidence jsonb not null default '[]', respondent text,
 status text not null check(status in('open','awaiting_clarification','resolved','dismissed')),
 revision integer not null default 1, assessment_id uuid not null references public.message_assessments,
 feedback text, marked_by uuid references auth.users, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(engagement_id,issue_key)
);
create table public.conversation_finding_events(
 id uuid primary key default gen_random_uuid(), finding_id uuid not null references public.conversation_findings,
 revision integer not null, snapshot jsonb not null, created_at timestamptz not null default now(),unique(finding_id,revision)
);
do $$declare t text;begin foreach t in array array['conversation_findings','conversation_finding_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;end $$;
create policy finding_member on public.conversation_findings for select to authenticated using(public.member_role(engagement_id) is not null);
create policy finding_event_member on public.conversation_finding_events for select to authenticated using(exists(select 1 from public.conversation_findings f where f.id=finding_id and public.member_role(f.engagement_id) is not null));

-- Service-only projection: no private data, credentials, balances or drafts.
create function public.shared_review_sources(e uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(source order by source->>'ref'),'[]'::jsonb) from (
 select jsonb_build_object('ref','message:'||m.id,'version','1','body',m.body,'date',m.created_at,'state','discussed','role',(select role from public.memberships where engagement_id=m.engagement_id and user_id=m.author_id)) source
 from public.messages m where m.engagement_id=e and m.visibility='shared' and m.channel='discussion' and m.kind in('human','share')
 union all select jsonb_build_object('ref',x->>'ref','version',x->>'version','body',x->>'body','state','agreed') from jsonb_array_elements(public.accepted_monitor_terms(e)) x
 union all select jsonb_build_object('ref','contract:'||v.id,'version',v.number::text,'body',v.body,'date',v.created_at,'state','proposed')
 from public.engagement_contracts c join public.contract_versions v on v.id=c.latest_version_id where c.engagement_id=e and v.id is distinct from c.accepted_version_id
 union all select jsonb_build_object('ref','milestone:'||v.id,'version',v.number::text,'body',jsonb_build_object('description',t.title,'acceptanceCriteria',t.acceptance_criteria,'responsibilities',v.responsibilities,'amountCents',t.amount_cents,'date',t.end_date)::text,'date',(select created_at from public.scope_versions where id=v.scope_version_id),'state','proposed')
 from public.milestones m join public.milestone_versions v on v.id=m.latest_version_id join public.milestone_tasks t on t.id=v.task_id where m.engagement_id=e and v.id is distinct from m.accepted_version_id
 union all select jsonb_build_object('ref','attachment:'||a.id,'version',t.sha256,'body',t.content,'date',a.created_at,'state',case when t.complete then 'extracted_text' else 'partial_text' end)
 from public.attachments a join public.attachment_texts t on t.attachment_id=a.id where a.engagement_id=e and a.visibility='shared' and a.upload_status='ready' and a.extraction_status in('ready','partial')
 union all select jsonb_build_object('ref','payment:'||p.id,'version',p.updated_at::text,'body',jsonb_build_object('amountCents',p.amount_cents,'currency',p.currency,'status',p.status,'providerConfirmed',p.capture_id is not null and p.status='completed','environment',p.environment)::text,'date',p.updated_at,'state','payment_record') from public.payment_transactions p where p.engagement_id=e
 union all select jsonb_build_object('ref','refund:'||r.id,'version',r.updated_at::text,'body',jsonb_build_object('amountCents',r.amount_cents,'status',r.status,'providerConfirmed',r.provider_refund_id is not null and r.status='completed')::text,'date',r.updated_at,'state','refund_record') from public.payment_refunds r where r.engagement_id=e
 ) s;
$$;
create function public.review_context_hash(e uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(public.shared_review_sources(e)::text||coalesce((select jsonb_agg(to_jsonb(f) order by id)::text from public.conversation_findings f where engagement_id=e),'[]'));
$$;
create function public.prepare_conversation_review(j uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.message_assessments;s jsonb;item jsonb;selected jsonb:='[]';used integer:=0;messages integer:=0;complete boolean:=true;findings jsonb;begin
 select * into job from public.message_assessments where id=j;
 if job.id is null or job.status<>'queued' or job.review_version<>1 then return null;end if;
 perform 1 from public.engagements where id=job.engagement_id for update;
 select * into job from public.message_assessments where id=j for update;
 if job.status<>'queued' then return null;end if;
 s:=public.shared_review_sources(job.engagement_id);
 for item in select value from jsonb_array_elements(s) order by case when value->>'state'='agreed' then 0 when value->>'ref' like 'message:%' then 2 else 1 end,value->>'date' desc nulls last loop
 if item->>'ref' like 'message:%' then messages:=messages+1;end if;
 if used+octet_length(item::text)>256000 or messages>2000 then complete:=false;continue;end if;
 selected:=selected||jsonb_build_array(item);used:=used+octet_length(item::text);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(f) order by updated_at desc),'[]') into findings from public.conversation_findings f where engagement_id=job.engagement_id;
 if jsonb_array_length(findings)>100 then raise exception 'Review finding capacity reached';end if;
 update public.message_assessments set context_hash=public.review_context_hash(job.engagement_id),review_snapshot=jsonb_build_object('sources',selected,'findings',findings,'complete',complete,'requested',requested,'requestText',review_prompt),terms=public.accepted_monitor_terms(job.engagement_id) where id=j returning review_snapshot into s;
 return s;
end $$;

-- Keep legacy claim semantics and budget limits; serialize new engagement reviews.
alter function public.claim_message_assessment(uuid,uuid,bigint) rename to claim_message_assessment_legacy;
revoke all on function public.claim_message_assessment_legacy(uuid,uuid,bigint) from service_role;
create function public.claim_message_assessment(j uuid,price uuid,budget bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare job public.message_assessments;begin
 select * into job from public.message_assessments where id=j;
 perform 1 from public.engagements where id=job.engagement_id for update;
 if job.review_version=1 then
 if exists(select 1 from public.message_assessments where engagement_id=job.engagement_id and status='running') then return null;end if;
 if job.context_hash is null or job.context_hash<>public.review_context_hash(job.engagement_id) then return null;end if;
 if exists(select 1 from public.message_assessments where engagement_id=job.engagement_id and status in('checked','flagged') and context_hash=job.context_hash) then
 update public.message_assessments set status='checked',reason='unchanged_context',finished_at=now() where id=j;return null;end if;
 -- Coalesce only older automatic queued jobs. Manual requests retain their trigger.
 update public.message_assessments set status='skipped',reason='coalesced',finished_at=now() where engagement_id=job.engagement_id and status='queued' and id<>j and not requested and created_at<=job.created_at;
 end if;
 return public.claim_message_assessment_legacy(j,price,budget);
end $$;
create or replace function public.enqueue_message_assessment() returns trigger language plpgsql security definer set search_path='' as $$
declare why text;begin
 if new.visibility<>'shared' or new.kind not in('human','share') or new.channel<>'discussion' then return new;end if;
 if not coalesce((select enabled from public.scope_monitor_settings where engagement_id=new.engagement_id),true) then why:='paused';end if;
 insert into public.message_assessments(engagement_id,message_id,actor_id,terms,status,reason,finished_at,review_version)
 values(new.engagement_id,new.id,new.author_id,public.accepted_monitor_terms(new.engagement_id),case when why is null then 'queued' else 'skipped' end,why,case when why is not null then now() end,1);
 return new;end $$;

create function public.request_conversation_review(e uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();m uuid;j uuid;begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=e for update;
 -- Agent-channel trigger markers do not enter normal discussion or self-trigger.
 select id into j from public.message_assessments where engagement_id=e and status in('queued','running') order by created_at desc limit 1;
 if j is not null then update public.message_assessments set requested=true where id=j and status='queued';return j;end if;
 insert into public.messages(engagement_id,author_id,visibility,kind,body,channel) values(e,u,'shared','human','Review the shared discussion, including unresolved questions and any disagreement.','agent') returning id into m;
 insert into public.message_assessments(engagement_id,message_id,actor_id,terms,status,review_version,requested) values(e,m,u,public.accepted_monitor_terms(e),'queued',1,true) returning id into j;return j;
end $$;
create function public.mark_conversation_finding(f uuid,s text,feedback text default '') returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();row public.conversation_findings;begin
 select * into row from public.conversation_findings where id=f;
 if row.id is null or public.member_role(row.engagement_id) is null then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=row.engagement_id for update;
 select * into row from public.conversation_findings where id=f for update;
 if s not in('resolved','dismissed') or length(feedback)>2000 then raise exception 'Invalid finding action';end if;
 if row.status=s then return;end if;
 update public.conversation_findings set status=s,feedback=mark_conversation_finding.feedback,marked_by=u,revision=revision+1,updated_at=now() where id=f returning * into row;
 insert into public.conversation_finding_events(finding_id,revision,snapshot) values(f,row.revision,to_jsonb(row));
end $$;
create function public.finish_conversation_review(j uuid,payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare job public.message_assessments;op public.usage_operations;issue jsonb;citation jsonb;src jsonb;row public.conversation_findings;existing uuid;key text;actual bigint;msg uuid;body text:='';changed boolean:=false;begin
 select * into job from public.message_assessments where id=j;
 perform 1 from public.engagements where id=job.engagement_id for update;
 select * into job from public.message_assessments where id=j for update;
 if job.status in('checked','flagged','stale') then return;end if;
 if job.status<>'running' or job.review_version<>1 then raise exception 'Review not running';end if;
 select * into op from public.usage_operations where id=job.operation_id for update;
 if op.status<>'reserved' or op.expires_at<now() then raise exception 'Review reservation expired';end if;
 if job.context_hash<>public.review_context_hash(job.engagement_id) then
 perform public.settle_usage(op.id,0,'internal_error',jsonb_build_object('reason','stale_context'));
 update public.message_assessments set status='stale',charge_nano=0,reason='context_changed',finished_at=now() where id=j;
 -- New human messages already queued a review; a revision alone needs one too.
 if not exists(select 1 from public.message_assessments where engagement_id=job.engagement_id and status='queued') then
 insert into public.messages(engagement_id,author_id,visibility,kind,body,channel) values(job.engagement_id,job.actor_id,'shared','system','Conversation review refresh','agent') returning id into msg;
 insert into public.message_assessments(engagement_id,message_id,actor_id,terms,status,review_version,requested) values(job.engagement_id,msg,job.actor_id,public.accepted_monitor_terms(job.engagement_id),'queued',1,job.requested);
 end if;return;end if;
 if jsonb_typeof(payload->'findings') is distinct from 'array' or jsonb_array_length(payload->'findings')>8 or coalesce(length(payload->>'summary'),0) not between 1 and 2000 or coalesce(payload->>'coverage','') not in('complete','incomplete') then raise exception 'Invalid review';end if;
 for issue in select value from jsonb_array_elements(payload->'findings') loop
 if coalesce(length(issue->>'subject'),0) not between 1 and 160 or jsonb_typeof(issue->'actionable') is distinct from 'boolean' or jsonb_typeof(issue->'categories') is distinct from 'array' or jsonb_array_length(issue->'categories') not between 1 and 6 or exists(select 1 from jsonb_array_elements_text(issue->'categories') c where c not in('scope','ambiguity','conflict','understanding','unanswered_question','mediation'))
 or coalesce(issue->>'status','') not in('open','awaiting_clarification','resolved') or coalesce(length(issue->>'explanation'),0) not between 1 and 2000 or coalesce(length(issue->>'nextStep'),0) not between 1 and 1000
 or jsonb_typeof(issue->'references') is distinct from 'array' or jsonb_array_length(issue->'references') not between 1 and 8 or jsonb_typeof(issue->'resolutionReferences') is distinct from 'array' or jsonb_array_length(issue->'resolutionReferences')>8 then raise exception 'Invalid finding';end if;
 if issue->>'status'='resolved' and jsonb_array_length(issue->'resolutionReferences')=0 then raise exception 'Resolution evidence required';end if;
 for citation in select value from jsonb_array_elements((issue->'references')||(issue->'resolutionReferences')) loop
 select value into src from jsonb_array_elements(job.review_snapshot->'sources') where value->>'ref'=citation->>'ref' and value->>'version'=citation->>'version';
 if src is null or coalesce(length(citation->>'quote'),0) not between 1 and 2000 or strpos(src->>'body',citation->>'quote')=0 then raise exception 'Unsupported shared evidence';end if;
 end loop;
 existing:=nullif(issue->>'existingId','')::uuid;
 if existing is not null then
 select * into row from public.conversation_findings where id=existing and engagement_id=job.engagement_id for update;
 if row.id is null then raise exception 'Unknown finding';end if;
 else
 if issue->>'status'='resolved' then raise exception 'New resolved finding';end if;
 key:=md5((issue->'references'->0->>'ref')||':'||(issue->>'subject'));
 select * into row from public.conversation_findings where engagement_id=job.engagement_id and issue_key=key for update;
 if row.id is null then
 select f.* into row from public.conversation_findings f where f.engagement_id=job.engagement_id
 and exists(select 1 from jsonb_array_elements(f.evidence) old cross join jsonb_array_elements(issue->'references') n where old->>'ref'=n->>'ref' and old->>'quote'=n->>'quote')
 and exists(select 1 from jsonb_array_elements_text(f.categories) c where (issue->'categories') ? c)
 order by f.created_at limit 1 for update;
 end if;
 end if;
 -- Do not revive participant-resolved/dismissed findings without new sources.
 if row.id is not null and row.status in('resolved','dismissed') and issue->>'status'<>'resolved' then
 if not exists(select 1 from jsonb_array_elements(issue->'references') n where not exists(select 1 from jsonb_array_elements(row.evidence) old where old->>'ref'=n->>'ref' and old->>'version'=n->>'version')) or length(coalesce(issue->>'reopenReason',''))=0 then continue;end if;
 end if;
 if row.id is null then
 insert into public.conversation_findings(engagement_id,issue_key,categories,explanation,next_step,evidence,resolution_evidence,respondent,status,assessment_id)
 values(job.engagement_id,key,issue->'categories',issue->>'explanation',issue->>'nextStep',issue->'references',issue->'resolutionReferences',issue->>'respondent',issue->>'status',j) returning * into row;
 else
 if row.status=issue->>'status' and row.evidence=issue->'references' and row.resolution_evidence=issue->'resolutionReferences' then continue;end if;
 update public.conversation_findings set categories=issue->'categories',explanation=issue->>'explanation',next_step=issue->>'nextStep',evidence=issue->'references',resolution_evidence=issue->'resolutionReferences',respondent=issue->>'respondent',status=issue->>'status',assessment_id=j,revision=revision+1,marked_by=null,feedback=null,updated_at=now() where id=row.id returning * into row;
 end if;
 insert into public.conversation_finding_events(finding_id,revision,snapshot) values(row.id,row.revision,to_jsonb(row));
 changed:=true;
 if row.status in('open','awaiting_clarification') and issue->>'actionable'='true' then body:=body||case when body='' then '' else E'\n\n' end||row.explanation||E'\n'||row.next_step||case when coalesce(issue->>'reopenReason','')<>'' then E'\nNew evidence: '||(issue->>'reopenReason') else '' end;end if;
 end loop;
 select coalesce(sum(provider_nano),0) into actual from public.usage_metering where operation_id=op.id;
 if actual*2>op.reserved_nano then raise exception 'Review exceeded budget';end if;
 perform public.settle_usage(op.id,actual,'success',op.pricing_snapshot||jsonb_build_object('purpose','conversation_review'));
 msg:=null;
 if body<>'' then insert into public.messages(engagement_id,author_id,visibility,kind,body,channel) values(job.engagement_id,job.actor_id,'shared','agent',body,'discussion') returning id into msg;end if;
 update public.message_assessments set status=case when msg is null then 'checked' else 'flagged' end,result=jsonb_build_object('summary',payload->>'summary','isRequest',true,'issues','[]'::jsonb,'review',payload),notice_message_id=msg,charge_nano=actual*2,reason=case when payload->>'coverage'='incomplete' then 'incomplete_coverage' else null end,finished_at=now(),context_hash=public.review_context_hash(job.engagement_id) where id=j;
end $$;
-- Backend functions never become public through SECURITY DEFINER defaults.
do $$declare signature text;begin foreach signature in array array['shared_review_sources(uuid)','review_context_hash(uuid)','prepare_conversation_review(uuid)','finish_conversation_review(uuid,jsonb)','claim_message_assessment(uuid,uuid,bigint)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
 execute 'grant execute on function public.'||signature||' to service_role';end loop;end $$;
revoke all on function public.request_conversation_review(uuid),public.mark_conversation_finding(uuid,text,text) from public,anon;
grant execute on function public.request_conversation_review(uuid),public.mark_conversation_finding(uuid,text,text) to authenticated;

alter publication supabase_realtime add table public.conversation_findings;

create function public.request_conversation_review_prompt(e uuid,prompt text) returns uuid language plpgsql security definer set search_path='' as $$
declare j uuid;begin
 if length(trim(prompt)) not between 1 and 30000 then raise exception 'Invalid review request';end if;
 j:=public.request_conversation_review(e);
 update public.message_assessments set review_prompt=prompt where id=j and status='queued';
 return j;
end $$;
revoke all on function public.request_conversation_review_prompt(uuid,text) from public,anon;
grant execute on function public.request_conversation_review_prompt(uuid,text) to authenticated;
-- Serialize shared evidence writes with final publication, including a reply
-- committing after the freshness comparison but before the intervention.
create function public.lock_conversation_context() returns trigger language plpgsql security definer set search_path='' as $$
declare e uuid;a uuid;begin
 if tg_table_name='attachment_texts' then
 a:=case when tg_op='DELETE' then old.attachment_id else new.attachment_id end;
 select engagement_id into e from public.attachments where id=a and visibility='shared';
 elsif tg_table_name='milestone_versions' then
 select engagement_id into e from public.milestones where id=case when tg_op='DELETE' then old.milestone_id else new.milestone_id end;
 else
 e:=case when tg_op='DELETE' then old.engagement_id else new.engagement_id end;
 if tg_table_name in('messages','attachments') then
 if (case when tg_op='DELETE' then old.visibility else new.visibility end)<>'shared' then return case when tg_op='DELETE' then old else new end;end if;
 end if;
 end if;
 perform 1 from public.engagements where id=e for update;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.lock_conversation_context() from public,anon,authenticated;
do $$declare t text;begin foreach t in array array['messages','attachments','attachment_texts','engagement_contracts','contract_versions','milestones','milestone_versions','milestone_tasks','scope_versions','payment_transactions','payment_refunds'] loop
 execute format('create trigger lock_review_context before insert or update or delete on public.%I for each row execute function public.lock_conversation_context()',t);
end loop;end $$;
