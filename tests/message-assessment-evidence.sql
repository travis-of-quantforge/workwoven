\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values('96000000-0000-4000-8000-000000000001','evidence-client@example.test',now()),('96000000-0000-4000-8000-000000000002','evidence-pro@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
select public.create_engagement('Message context fixture','client') as e \gset
select public.create_engagement('Foreign context fixture','client') as foreign_e \gset
select public.create_invitation(:'e','evidence-pro@example.test') as t \gset
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',true);
select public.accept_invitation(:'t');
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
select public.post_discussion_message(:'e','shared','Referenced brief marker') as m \gset
select public.post_discussion_message(:'e','client','PRIVATE CLIENT SECRET') as private_m \gset
select public.post_discussion_message(:'foreign_e','shared','FOREIGN SECRET') as foreign_m \gset
reset role;
update public.message_assessments set status='failed',reason='interrupted' where message_id=:'m';
set role authenticated;
select public.retry_message_assessment(:'e',:'m') as retry \gset
reset role;
update public.message_assessments set status='checked',result='{"summary":"The image requirements need clarification.","isRequest":true,"issues":[]}',finished_at=now() where id=:'retry';
insert into public.messages(engagement_id,author_id,visibility,kind,body) values(:'e','96000000-0000-4000-8000-000000000001','shared','agent','Assessment notice fixture') returning id as notice \gset
update public.message_assessments set notice_message_id=:'notice' where id=:'retry';
select set_config('test.ctx_notice',:'notice',true);
select set_config('test.ctx_e',:'e',true),set_config('test.ctx_m',:'m',true),set_config('test.ctx_private',:'private_m',true),set_config('test.ctx_foreign',:'foreign_m',true);
set role authenticated;
do $$declare source record;begin
 select * into source from public.agent_message_context(current_setting('test.ctx_e')::uuid,'shared',array[current_setting('test.ctx_m')::uuid]);
 if source.body not like '%Referenced brief marker%' or source.body not like '%The image requirements need clarification.%' or source.body not like '%AI advice, not an agreed commitment%' or source.excerpt is null then raise exception 'Assessment context missing';end if;
 if not exists(select 1 from public.agent_message_context(current_setting('test.ctx_e')::uuid,'shared',array[current_setting('test.ctx_notice')::uuid]) where body like '%image requirements need clarification%') then raise exception 'Notice ID lost associated assessment';end if;
 if exists(select 1 from public.agent_message_context(current_setting('test.ctx_e')::uuid,'shared',array[current_setting('test.ctx_private')::uuid,current_setting('test.ctx_foreign')::uuid])) then raise exception 'Foreign/private source leaked';end if;
 if not exists(select 1 from public.search_agent_evidence(current_setting('test.ctx_e')::uuid,'shared',current_setting('test.ctx_m')) where body like '%image requirements need clarification%') then raise exception 'Copied ID lookup failed';end if;
 if not exists(select 1 from public.search_agent_evidence(current_setting('test.ctx_e')::uuid,'shared','Referenced brief marker') where body like '%image requirements need clarification%') then raise exception 'Text search omitted assessment';end if;
 if not exists(select 1 from public.agent_message_context(current_setting('test.ctx_e')::uuid,'client',array[current_setting('test.ctx_private')::uuid]) where body like '%PRIVATE CLIENT SECRET%') then raise exception 'Own private source missing';end if;
end $$;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',true);
do $$begin
 if exists(select 1 from public.agent_message_context(current_setting('test.ctx_e')::uuid,'professional',array[current_setting('test.ctx_private')::uuid])) then raise exception 'Counterparty private source leaked';end if;
 begin perform public.agent_message_context(current_setting('test.ctx_e')::uuid,'client',array[current_setting('test.ctx_private')::uuid]);raise exception 'Opposing context allowed';exception when raise_exception then if sqlerrm<>'Forbidden' then raise;end if;end;
end $$;
rollback;
