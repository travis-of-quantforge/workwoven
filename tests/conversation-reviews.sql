\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values
('98000000-0000-4000-8000-000000000001','review-client@example.test',now()),
('98000000-0000-4000-8000-000000000002','review-pro@example.test',now());
select id as price from public.ai_pricing where model='gpt-5-mini-2025-08-07' limit 1 \gset
set role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',false);
select public.create_engagement('Conversation review fixture','client') as e \gset
select public.create_invitation(:'e','review-pro@example.test') as token \gset
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',false);
select public.accept_invitation(:'token');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',false);
select public.post_discussion_message(:'e','client','PRIVATE DO NOT INCLUDE') as private_message \gset
select public.post_discussion_message(:'e','shared','Make it easy to update.') as source \gset
select id as job from public.message_assessments where message_id=:'source' \gset
select set_config('test.review_e',:'e',false),set_config('test.review_job',:'job',false),set_config('test.review_source',:'source',false);
do $$begin
 begin perform public.shared_review_sources(current_setting('test.review_e')::uuid);raise exception 'Evidence bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
set role service_role;
select public.prepare_conversation_review(:'job');
do $$begin
 if (select review_snapshot::text like '%PRIVATE%' from public.message_assessments where id=current_setting('test.review_job')::uuid) then raise exception 'Private context leaked';end if;
end $$;
select public.claim_message_assessment(:'job',:'price',1000000) as op \gset
select public.fail_unclaimed_message_assessment(:'job','stale_worker_setup_check');
do $$begin if (select status from public.message_assessments where id=current_setting('test.review_job')::uuid)<>'running' then raise exception 'Unclaimed worker failed another reservation';end if;end $$;
select public.record_usage(:'op','review-fixture-1',:'price',100,0,20);
select jsonb_build_object('summary','Clarify editing expectations','coverage','complete','findings',jsonb_build_array(jsonb_build_object('existingId',null,'subject','content editing','reopenReason',null,'actionable',true,'categories',jsonb_build_array('ambiguity','understanding'),'explanation','Editing could mean self-service or professional updates.','nextStep','Should you edit content yourself, or should the professional apply updates?','references',jsonb_build_array(jsonb_build_object('ref','message:'||:'source','version','1','quote','easy to update')),'status','awaiting_clarification','respondent','client','resolutionReferences','[]'::jsonb))) as payload \gset
select set_config('test.review_payload',:'payload',false);
do $$begin
 begin perform public.finish_conversation_review(current_setting('test.review_job')::uuid,jsonb_set(current_setting('test.review_payload')::jsonb,'{findings,0,references,0,ref}','"message:98000000-0000-4000-8000-000000000099"'));raise exception 'Foreign evidence published';exception when raise_exception then if sqlerrm='Foreign evidence published' then raise;end if;end;
end $$;
select public.finish_conversation_review(:'job',:'payload'::jsonb);
select public.finish_conversation_review(:'job',:'payload'::jsonb);
reset role;
select id as finding from public.conversation_findings where engagement_id=:'e' \gset
select set_config('test.review_finding',:'finding',false);
do $$begin
 if(select count(*) from public.conversation_findings where engagement_id=current_setting('test.review_e')::uuid)<>1 then raise exception 'Duplicate finding';end if;
 if(select count(*) from public.notifications where engagement_id=current_setting('test.review_e')::uuid and title like 'Project agent review:%')<>2 then raise exception 'Missing or duplicate review notifications: %, assessment status %',(select count(*) from public.notifications where engagement_id=current_setting('test.review_e')::uuid and title like 'Project agent review:%'),(select status from public.message_assessments where id=current_setting('test.review_job')::uuid);end if;
 if(select count(*) from public.messages where engagement_id=current_setting('test.review_e')::uuid and kind='agent' and channel='discussion')<>0 then raise exception 'Standalone assessment intervention';end if;
 if not exists(select 1 from public.message_assessments where id=current_setting('test.review_job')::uuid and status='flagged' and notice_message_id is null) then raise exception 'Source-bound review missing';end if;
 if exists(select 1 from public.notifications where assessment_id=current_setting('test.review_job')::uuid and record_id<>current_setting('test.review_source')::uuid) then raise exception 'Review notification not linked to source';end if;
 if exists(select 1 from public.message_assessments a join public.messages m on m.id=a.message_id where m.kind='agent') then raise exception 'Recursive review';end if;
end $$;
set role authenticated;
do $$begin if (public.conversation_evidence_availability(current_setting('test.review_e')::uuid)->>('message:'||current_setting('test.review_source')||'@1')) is distinct from 'true' then raise exception 'Shared evidence incorrectly unavailable';end if;end $$;
select public.post_discussion_message(:'e','shared','I will edit the website content myself through an admin interface.') as answer \gset
select id as job2 from public.message_assessments where message_id=:'answer' \gset
set role service_role;
select public.prepare_conversation_review(:'job2');
select public.claim_message_assessment(:'job2',:'price',1000000) as op2 \gset
do $$begin if public.claim_message_assessment((select id from public.message_assessments where engagement_id=current_setting('test.review_e')::uuid and status='running'),null,1000000) is not null then raise exception 'Duplicate running review reserved twice';end if;end $$;
select public.record_usage(:'op2','review-fixture-2',:'price',100,0,20);
select public.finish_conversation_review(:'job2',jsonb_build_object('summary','Editing clarified','coverage','complete','findings',jsonb_build_array(jsonb_build_object('existingId',:'finding','subject','content editing','reopenReason',null,'actionable',false,'categories',jsonb_build_array('ambiguity'),'explanation','The client clarified self-service content editing.','nextStep','Use a proposal if this changes accepted scope.','references',jsonb_build_array(jsonb_build_object('ref','message:'||:'source','version','1','quote','easy to update')),'status','resolved','respondent',null,'resolutionReferences',jsonb_build_array(jsonb_build_object('ref','message:'||:'answer','version','1','quote','I will edit the website content myself'))))));
reset role;
do $$begin
 if(select status from public.conversation_findings where id=current_setting('test.review_finding')::uuid)<>'resolved' then raise exception 'Answer did not resolve';end if;
 if(select count(*) from public.conversation_finding_events where finding_id=current_setting('test.review_finding')::uuid)<>2 then raise exception 'History missing';end if;
end $$;
set role authenticated;
select public.request_conversation_review(:'e') as job3 \gset
select set_config('test.manual_review_job',:'job3',false);
set role service_role;
select public.prepare_conversation_review(:'job3');
do $$begin if public.claim_message_assessment(current_setting('test.manual_review_job')::uuid,null,1000000) is not null then raise exception 'Unchanged review charged';end if;end $$;
reset role;
do $$begin if not exists(select 1 from public.message_assessments a join public.messages m on m.id=a.notice_message_id where a.id=current_setting('test.manual_review_job')::uuid and m.channel='agent' and m.reply_to=a.message_id) then raise exception 'Explicit cached review lost its project-chat answer: %',(select jsonb_build_object('status',a.status,'reason',a.reason,'requested',a.requested,'channel',m.channel,'kind',m.kind,'notice',a.notice_message_id,'version',a.review_version,'prepared',a.context_hash is not null,'fresh',a.context_hash=public.review_context_hash(a.engagement_id),'running',(select count(*) from public.message_assessments where engagement_id=a.engagement_id and status='running')) from public.message_assessments a join public.messages m on m.id=a.message_id where a.id=current_setting('test.manual_review_job')::uuid);end if;end $$;
set role authenticated;
select public.post_discussion_message(:'e','shared','Now please launch on Friday.') as stale_source \gset
select id as stale_job from public.message_assessments where message_id=:'stale_source' \gset
set role service_role;
select public.prepare_conversation_review(:'stale_job');
select public.claim_message_assessment(:'stale_job',:'price',1000000) as stale_op \gset
set role authenticated;
select public.post_discussion_message(:'e','shared','Correction: Monday, not Friday.');
set role service_role;
select public.finish_conversation_review(:'stale_job',:'payload'::jsonb);
reset role;
do $$begin if not exists(select 1 from public.message_assessments where engagement_id=current_setting('test.review_e')::uuid and status='stale' and charge_nano=0) then raise exception 'Stale review published or charged';end if;end $$;
rollback;
