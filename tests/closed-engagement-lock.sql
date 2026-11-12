\set ON_ERROR_STOP on
begin;
reset role;
insert into auth.users(id,email,email_confirmed_at) values('96000000-0000-4000-8000-000000000001','closed-lock@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
select public.create_engagement('Closed lock fixture') as e \gset
select public.send_message(:'e','shared','Who supplies the project materials?') as question \gset
select public.register_attachment(:'e','shared','pending.txt','text/plain',10) as pending \gset
select set_config('test.closed_e',:'e',true);
select set_config('test.closed_pending',:'pending',true);
reset role;
select id as price from public.ai_pricing where enabled order by effective_at desc limit 1 \gset
select set_config('request.jwt.claim.sub','',true);
set role service_role;
select public.begin_agent_run(:'e','shared','96000000-0000-4000-8000-000000000001','A pre-closure agent question',gen_random_uuid(),1000000,:'price','closed-fixture') as run \gset
select set_config('test.closed_run',:'run',true);
select set_config('test.closed_price',:'price',true);
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
select public.close_engagement(:'e','cancelled',null,'Ending this test engagement.');
select public.set_engagement_archived(:'e',true);
select public.set_engagement_archived(:'e',false);
do $$declare e uuid:=current_setting('test.closed_e')::uuid; t text;begin
 if (select status from public.engagements where id=e)<>'cancelled' then raise exception 'Cancellation missing';end if;
 if not exists(select 1 from public.messages where engagement_id=e and body like 'Engagement cancelled.%') then raise exception 'Final cancellation entry missing';end if;
 begin perform public.send_message(e,'shared','Late shared text');raise exception 'Closed shared send allowed';exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
 begin perform public.send_message(e,'client','Late private text');raise exception 'Closed private send allowed';exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
 begin perform public.register_attachment(e,'shared','late.txt','text/plain',10);raise exception 'Closed upload registration allowed';exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
 begin perform public.request_conversation_review(e);raise exception 'Closed review request allowed';exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
 begin insert into storage.objects(bucket_id,name) values('engagement-files',current_setting('test.closed_pending'));raise exception 'Old pending upload allowed';exception when insufficient_privilege then null;end;
end $$;
-- Exercise SECURITY DEFINER paths and every direct engagement table boundary,
-- including ones with no browser write privilege, before FK/NOT NULL checks.
reset role;
do $$declare e uuid:=current_setting('test.closed_e')::uuid;t text;begin
 foreach t in array array['messages','attachments','scope_versions','contract_versions','engagement_contracts','invitations','share_events','memberships','agent_configs','milestone_tasks','milestones','milestone_operations','completion_approvals','meetings','concern_cases','payment_requests','payment_transactions','payment_refunds','scope_monitor_settings','conversation_findings','reviews','portfolio_items','agent_runs','message_assessments'] loop
 begin
 execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).*',t,t) using jsonb_build_object('engagement_id',e,'id',gen_random_uuid());
 raise exception 'Closed table write allowed: %',t;
 exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
 end loop;
 begin update public.engagements set status='active' where id=e;raise exception 'Reopening allowed';exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','',true);
set role service_role;
select public.finish_agent_run(:'run','{"kind":"chat"}','A late result','success',null);
reset role;
do $$declare r public.agent_runs;o public.usage_operations;j uuid;begin
 select * into r from public.agent_runs where id=current_setting('test.closed_run')::uuid;
 select * into o from public.usage_operations where id=r.id;
 if r.status<>'failed' or r.output_message_id is not null or r.failure_code<>'engagement_closed' then raise exception 'Agent published after closure';end if;
 if o.charge_nano<>0 then raise exception 'Closed result charged';end if;
 begin perform public.begin_agent_run(current_setting('test.closed_e')::uuid,'shared','96000000-0000-4000-8000-000000000001','Late question',gen_random_uuid(),1000000,current_setting('test.closed_price')::uuid,'late');raise exception 'Late agent run allowed';exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
 select id into j from public.message_assessments where engagement_id=current_setting('test.closed_e')::uuid and status='queued' limit 1;
 if j is not null then
 if public.claim_message_assessment(j,current_setting('test.closed_price')::uuid,1000000) is not null then raise exception 'Closed assessment reserved credits';end if;
 if (select reason from public.message_assessments where id=j)<>'engagement_closed' then raise exception 'Closed assessment not skipped';end if;
 end if;
end $$;
reset role;
rollback;
