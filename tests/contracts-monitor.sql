\set ON_ERROR_STOP on
begin;
reset role;
insert into auth.users(id,email,email_confirmed_at) values
('95000000-0000-4000-8000-000000000001','monitor-client@example.test',now()),
('95000000-0000-4000-8000-000000000002','monitor-pro@example.test',now());
select id as price from public.ai_pricing where model='gpt-5-mini-2025-08-07' limit 1 \gset
set role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',false);
select public.create_engagement_with_contract('Contract monitor fixture','Only CSV dashboards are included. Scheduled emails are excluded. Client supplies CSV data.','custom') as e \gset
select public.post_discussion_message(:'e','shared','Can we discuss the project?') as first_message \gset
select public.create_invitation(:'e','monitor-pro@example.test') as token \gset
select public.propose_contract(:'e','Only CSV dashboards are included. Scheduled emails are excluded. Client supplies CSV data.',null,gen_random_uuid()) as v \gset
select set_config('test.monitor_e',:'e',false),set_config('test.monitor_v',:'v',false),set_config('test.monitor_first',:'first_message',false);
do $$begin
 if not exists(select 1 from public.message_assessments where message_id=current_setting('test.monitor_first')::uuid and status='skipped' and reason='no_accepted_terms') then raise exception 'Unaccepted draft treated as agreement';end if;
 if exists(select 1 from public.contract_approvals where version_id=current_setting('test.monitor_v')::uuid) then raise exception 'Submitting approved automatically';end if;
 begin perform public.approve_contract(current_setting('test.monitor_v')::uuid);raise exception 'Creator approved before counterpart joined';exception when raise_exception then if sqlerrm='Creator approved before counterpart joined' then raise;end if;end;
 begin update public.contract_versions set body='Silently changed';raise exception 'Contract edited directly';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',false);
select public.accept_invitation(:'token');
select public.approve_contract(:'v');
do $$begin if exists(select 1 from public.engagement_contracts where engagement_id=current_setting('test.monitor_e')::uuid and accepted_version_id is not null) then raise exception 'Single approval accepted contract';end if;end $$;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',false);
select public.approve_contract(:'v');
select public.post_discussion_message(:'e','client','PRIVATE client request for secret pricing') as private_message \gset
select public.post_discussion_message(:'e','shared','Please add scheduled email reports.') as source \gset
select id as job from public.message_assessments where message_id=:'source' \gset
select set_config('test.monitor_job',:'job',false),set_config('test.monitor_source',:'source',false),set_config('test.monitor_private',:'private_message',false);
do $$begin
 if exists(select 1 from public.message_assessments where message_id=current_setting('test.monitor_private')::uuid) then raise exception 'Private message queued';end if;
 if not exists(select 1 from public.search_agent_evidence(current_setting('test.monitor_e')::uuid,'shared','contract') where ref='contract:'||current_setting('test.monitor_v') and state='agreed') then raise exception 'Accepted contract missing from retrieval';end if;
 if exists(select 1 from public.message_assessments where terms::text like '%PRIVATE%') then raise exception 'Private retrieval leaked';end if;
 begin perform public.claim_message_assessment(current_setting('test.monitor_job')::uuid,null,1);raise exception 'Client reserved monitoring credits';exception when insufficient_privilege then null;end;
end $$;
reset role;
select public.begin_agent_run(:'e','shared','95000000-0000-4000-8000-000000000001','Manual project agent request',gen_random_uuid(),1000000,:'price','fixture-manual-monitor') as manual_op \gset
do $$begin if exists(select 1 from public.message_assessments a join public.agent_runs r on a.message_id=r.question_message_id where r.engagement_id=current_setting('test.monitor_e')::uuid) then raise exception 'Agent chat recursively monitored';end if;end $$;
select public.finish_agent_run(:'manual_op',null,null,'internal_error');
set role service_role;
select public.claim_message_assessment(:'job',:'price',1000000) as op \gset
select set_config('test.monitor_op',:'op',false);
do $$begin if public.claim_message_assessment(current_setting('test.monitor_job')::uuid,null,1) is not null then raise exception 'Duplicate job claimed';end if;end $$;
select public.record_usage(:'op','monitor-response-1',:'price',100,0,20) as cost \gset
select set_config('test.monitor_cost',:'cost',false);
do $$begin
 begin perform public.finish_message_assessment(current_setting('test.monitor_job')::uuid,jsonb_build_object('isRequest',true,'verdict','potential_conflict','summary','Potential extra work','issues',jsonb_build_array(jsonb_build_object('messageQuote','invented quotation','termRef','contract:'||current_setting('test.monitor_v'),'termQuote','Scheduled emails are excluded.','explanation','Different work'))));raise exception 'Invented quotation published';exception when raise_exception then if sqlerrm='Invented quotation published' then raise;end if;end;
end $$;
select public.finish_message_assessment(:'job',jsonb_build_object('isRequest',true,'verdict','potential_conflict','summary','The request may add excluded email reporting.','issues',jsonb_build_array(jsonb_build_object('messageQuote','scheduled email reports','termRef','contract:'||:'v','termQuote','Scheduled emails are excluded.','explanation','The accepted contract excludes email reports. Discuss and approve a revision before committing.'))));
select public.finish_message_assessment(:'job','{}'); -- Replay must not publish or charge twice.
reset role;
do $$begin
 if(select charge_nano from public.message_assessments where id=current_setting('test.monitor_job')::uuid)<>current_setting('test.monitor_cost')::bigint*2 then raise exception 'Monitoring markup incorrect';end if;
 if(select count(*) from public.messages where reply_to=current_setting('test.monitor_source')::uuid and kind='agent' and channel='discussion')<>1 then raise exception 'Duplicate or missing shared warning';end if;
 if exists(select 1 from public.message_assessments a join public.messages m on m.id=a.message_id where m.kind='agent') then raise exception 'Monitoring recursively invoked itself';end if;
 if exists(select 1 from public.agent_accounts where engagement_id=current_setting('test.monitor_e')::uuid and visibility<>'shared' and (available_nano<>0 or reserved_nano<>0)) then raise exception 'Private credits touched';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',false);
do $$begin if not exists(select 1 from public.message_assessments where id=current_setting('test.monitor_job')::uuid and status='flagged') then raise exception 'Counterparty cannot see shared assessment';end if;end $$;
select public.post_discussion_message(:'e','shared','Please add scheduled email reports for every region.',:'source') as reply_source \gset
select id as reply_job from public.message_assessments where message_id=:'reply_source' \gset
reset role;
select public.claim_message_assessment(:'reply_job',:'price',1000000) as reply_op \gset
select public.record_usage(:'reply_op','monitor-response-reply',:'price',100,0,20);
select public.finish_message_assessment(:'reply_job',jsonb_build_object('isRequest',true,'verdict','potential_conflict','summary','Email remains excluded.','issues',jsonb_build_array(jsonb_build_object('messageQuote','scheduled email reports','termRef','contract:'||:'v','termQuote','Scheduled emails are excluded.','explanation','This is excluded from the accepted work.'))));
select set_config('test.monitor_reply_job',:'reply_job',false);
do $$begin if not exists(select 1 from public.message_assessments j join public.messages m on m.id=j.notice_message_id where j.id=current_setting('test.monitor_reply_job')::uuid and m.reply_to=current_setting('test.monitor_source')::uuid) then raise exception 'Thread reply warning hidden by nesting';end if;end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',false);
select public.post_discussion_message(:'e','shared','Please add email reports after all.') as stale_source \gset
select id as stale_job from public.message_assessments where message_id=:'stale_source' \gset
reset role;
select public.claim_message_assessment(:'stale_job',:'price',1000000) as stale_op \gset
set role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',false);
select public.propose_contract(:'e','CSV dashboards and email reports are included. Client supplies CSV data.',:'v',gen_random_uuid()) as v2 \gset
select set_config('test.monitor_v2',:'v2',false),set_config('test.monitor_stale',:'stale_job',false);
do $$begin
 if not exists(select 1 from public.engagement_contracts where engagement_id=current_setting('test.monitor_e')::uuid and accepted_version_id=current_setting('test.monitor_v')::uuid) then raise exception 'Proposed edit changed acceptance';end if;
 begin perform public.approve_contract(current_setting('test.monitor_v')::uuid);raise exception 'Stale approval accepted';exception when raise_exception then if sqlerrm='Stale approval accepted' then raise;end if;end;
end $$;
select public.approve_contract(:'v2');
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',false);
select public.approve_contract(:'v2');
reset role;
select public.finish_message_assessment(:'stale_job','{}');
do $$begin if not exists(select 1 from public.message_assessments where id=current_setting('test.monitor_stale')::uuid and status='stale' and charge_nano=0 and notice_message_id is null) then raise exception 'Changed terms allowed stale warning';end if;end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',false);
select public.post_discussion_message(:'e','shared','Thanks for explaining.') as clear_source \gset
select id as clear_job from public.message_assessments where message_id=:'clear_source' \gset
reset role;
select public.claim_message_assessment(:'clear_job',:'price',1000000) as clear_op \gset
select public.record_usage(:'clear_op','monitor-response-clear',:'price',30,0,10);
select public.finish_message_assessment(:'clear_job','{"isRequest":false,"verdict":"no_issue","summary":"No request identified.","issues":[]}');
select set_config('test.monitor_clear',:'clear_job',false);
do $$begin if not exists(select 1 from public.message_assessments where id=current_setting('test.monitor_clear')::uuid and status='checked' and notice_message_id is null) then raise exception 'Unsolicited response to non-request';end if;end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',false);
select public.post_discussion_message(:'e','shared','Could we discuss another idea?') as failed_source \gset
select id as failed_job from public.message_assessments where message_id=:'failed_source' \gset
reset role;
select public.claim_message_assessment(:'failed_job',:'price',1000000) as failed_op \gset
select public.record_usage(:'failed_op','monitor-response-failed',:'price',30,0,10);
select public.fail_message_assessment(:'failed_job','internal_error');
select set_config('test.monitor_failed',:'failed_op',false);
do $$begin if not exists(select 1 from public.usage_operations where id=current_setting('test.monitor_failed')::uuid and status='released' and charge_nano=0) then raise exception 'Failed automatic assessment charged user';end if;end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',false);
select public.set_scope_monitor(:'e',false);
select public.post_discussion_message(:'e','shared','An ordinary message while paused.') as paused_source \gset
select set_config('test.monitor_paused',:'paused_source',false);
do $$begin if not exists(select 1 from public.message_assessments where message_id=current_setting('test.monitor_paused')::uuid and status='skipped' and reason='paused') then raise exception 'Pause ignored';end if;end $$;
select public.set_scope_monitor(:'e',true);
select public.post_discussion_message(:'e','shared','Please change the report layout.') as exhausted_source \gset
select id as exhausted_job from public.message_assessments where message_id=:'exhausted_source' \gset
select set_config('test.monitor_exhausted',:'exhausted_job',false);
reset role;
do $$declare a uuid;n bigint;begin
 select id,available_nano into a,n from public.agent_accounts where engagement_id=current_setting('test.monitor_e')::uuid and visibility='shared';
 while n>0 loop
 perform public.reserve_usage(a,'95000000-0000-4000-8000-000000000001',gen_random_uuid(),least(n,1000000000));
 select available_nano into n from public.agent_accounts where id=a;
 end loop;
end $$;
select public.claim_message_assessment(:'exhausted_job',:'price',1000000);
do $$begin
 if not exists(select 1 from public.message_assessments where id=current_setting('test.monitor_exhausted')::uuid and status='skipped' and reason='credits_unavailable' and operation_id is null) then raise exception 'Exhausted shared balance did not pause check';end if;
 if not exists(select 1 from public.messages where body='Please change the report layout.' and engagement_id=current_setting('test.monitor_e')::uuid) then raise exception 'AI exhaustion blocked human message';end if;
 if exists(select 1 from public.message_assessments where operation_id is not null and claimed_at is null) then raise exception 'Claim time missing';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$begin
 if exists(select 1 from public.engagement_contracts where engagement_id=current_setting('test.monitor_e')::uuid) or exists(select 1 from public.contract_versions where engagement_id=current_setting('test.monitor_e')::uuid) or exists(select 1 from public.message_assessments where engagement_id=current_setting('test.monitor_e')::uuid) then raise exception 'Contract/assessment cross-engagement leak';end if;
 begin perform public.approve_contract(current_setting('test.monitor_v2')::uuid);raise exception 'Outsider approved contract';exception when raise_exception then if sqlerrm='Outsider approved contract' then raise;end if;end;
end $$;
rollback;
