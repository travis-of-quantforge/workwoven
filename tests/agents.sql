\set ON_ERROR_STOP on
reset role;
select id as engagement from public.engagements where title='Reporting dashboard' and creator_id='00000000-0000-0000-0000-000000000001' \gset
select id as pricing from public.ai_pricing where model='gpt-5-mini-2025-08-07' limit 1 \gset
select set_config('test.engagement',:'engagement',false);
select set_config('test.pricing',:'pricing',false);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.send_message(:'engagement','shared','fixture_token shared fact');
select public.send_message(:'engagement','client','fixture_token client secret');
select public.register_attachment(:'engagement','client','private-fixture.csv','text/csv',10) as private_path \gset
insert into storage.objects(bucket_id,name) values('engagement-files',:'private_path');
select public.confirm_attachment_with_message(:'private_path','Private source file for planning.');
reset role;
select public.store_attachment_text(:'private_path','00000000-0000-0000-0000-000000000001','fixture_token privateCSV',repeat('a',64),true);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.send_message(:'engagement','professional','fixture_token professional secret');
do $$ begin
 if exists(select 1 from public.search_agent_evidence(current_setting('test.engagement')::uuid,'shared','fixture_token') where body like '%secret%' or body like '%privateCSV%') then raise exception 'Project agent private retrieval leak';end if;
 if exists(select 1 from public.search_agent_evidence(current_setting('test.engagement')::uuid,'professional','fixture_token') where body like '%client secret%' or body like '%privateCSV%') then raise exception 'Professional private retrieval leak';end if;
 if not exists(select 1 from public.search_agent_evidence(current_setting('test.engagement')::uuid,'professional','fixture_token') where body like '%professional secret%') then raise exception 'Own professional source missing';end if;
 begin perform public.search_agent_evidence(current_setting('test.engagement')::uuid,'client','fixture_token');raise exception 'Opposing agent scope allowed';exception when raise_exception then if sqlerrm='Opposing agent scope allowed' then raise;end if;end;
 if exists(select 1 from public.attachment_texts) then raise exception 'Private extraction exposed';end if;
 if exists(select 1 from public.file_previews(current_setting('test.engagement')::uuid,'shared') where content like '%privateCSV%') then raise exception 'Private preview exposed';end if;
 begin perform public.file_previews(current_setting('test.engagement')::uuid,'client');raise exception 'Opposing private previews allowed';exception when raise_exception then if sqlerrm='Opposing private previews allowed' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 if not exists(select 1 from public.search_agent_evidence(current_setting('test.engagement')::uuid,'client','fixture_token') where body like '%privateCSV%') then raise exception 'Own private extraction missing';end if;
 if exists(select 1 from public.search_agent_evidence(current_setting('test.engagement')::uuid,'client','fixture_token') where body like '%professional secret%') then raise exception 'Client private retrieval leak';end if;
end $$;
reset role;
set role service_role;
select public.begin_agent_run(:'engagement','shared','00000000-0000-0000-0000-000000000001','Fixture shared question','40000000-0000-0000-0000-000000000001',100000000,:'pricing','fixture-run') as run \gset
select public.begin_agent_run(:'engagement','shared','00000000-0000-0000-0000-000000000001','Fixture shared question','40000000-0000-0000-0000-000000000001',100000000,:'pricing','fixture-run');
reset role;
select set_config('test.run',:'run',false);
do $$ begin
 if not public.claim_agent_run(current_setting('test.run')::uuid) then raise exception 'Initial claim failed';end if;
 if public.claim_agent_run(current_setting('test.run')::uuid) then raise exception 'Duplicate model execution allowed';end if;
 if(select count(*) from public.messages where body='Fixture shared question')<>1 then raise exception 'Duplicate agent prompt';end if;
end $$;
select public.record_usage(:'run','fixture-agent-success',:'pricing',100,80,50);
select public.finish_agent_run(:'run','{"kind":"advice","answer":"Fixture recommendation"}','Fixture recommendation','success');
select public.finish_agent_run(:'run','{"kind":"advice","answer":"Fixture recommendation"}','Fixture recommendation','success');
do $$ begin
 if(select count(*) from public.messages where body='Fixture recommendation' and kind='agent')<>1 then raise exception 'Duplicate agent output';end if;
 if(select charge_nano from public.usage_operations where id=current_setting('test.run')::uuid)<>214000 then raise exception 'Agent billing incorrect';end if;
end $$;
select public.begin_agent_run(:'engagement','client','00000000-0000-0000-0000-000000000001','Fixture private partial','40000000-0000-0000-0000-000000000002',100000000,:'pricing','fixture-partial') as partial \gset
select public.record_usage(:'partial','fixture-agent-partial',:'pricing',100,80,50);
select public.finish_agent_run(:'partial','{"kind":"advice","answer":"Private partial fixture"}','Private partial fixture','partial');
select set_config('test.partial',:'partial',false);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if exists(select 1 from public.agent_runs where id=current_setting('test.partial')::uuid) then raise exception 'Private run exposed';end if;
 begin perform public.resolve_partial(current_setting('test.partial')::uuid,true);raise exception 'Opposing party billed partial';exception when raise_exception then if sqlerrm='Opposing party billed partial' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.resolve_partial(:'partial',true);
select public.resolve_partial(:'partial',true);
reset role;
do $$ begin if(select status from public.agent_runs where id=current_setting('test.partial')::uuid)<>'succeeded' then raise exception 'Retained partial not published';end if;end $$;
select public.begin_agent_run(:'engagement','shared','00000000-0000-0000-0000-000000000001','Fixture abandoned run','40000000-0000-0000-0000-000000000003',100000000,:'pricing','fixture-abandoned') as abandoned \gset
update public.usage_operations set expires_at=now()-interval '1 minute' where id=:'abandoned';
select public.recover_agent_runs();
select set_config('test.abandoned',:'abandoned',false);
do $$ begin if(select status from public.agent_runs where id=current_setting('test.abandoned')::uuid)<>'failed' then raise exception 'Abandoned run not recovered';end if;end $$;
\echo 'Agent retrieval, history isolation, billing, consent and recovery assertions passed'
