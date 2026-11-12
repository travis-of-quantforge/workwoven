\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values('94000000-0000-4000-8000-000000000001','retry-fixture@example.test',now()),('94000000-0000-4000-8000-000000000002','retry-outsider@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
select public.create_engagement('Retry check fixture','client') as e \gset
select public.post_discussion_message(:'e','shared','Please clarify the website brief.') as m \gset
select public.post_discussion_message(:'e','client','PRIVATE source') as private_m \gset
select set_config('test.retry_e',:'e',true),set_config('test.retry_m',:'m',true),set_config('test.retry_private',:'private_m',true);
reset role;
update public.message_assessments set status='skipped',reason='ai_unavailable' where message_id=:'m';
set role authenticated;
select public.retry_message_assessment(:'e',:'m') as retry \gset
select set_config('test.retry_job',:'retry',true);
select public.retry_message_assessment(:'e',:'m') as replay \gset
select (:'retry'=:'replay') as same_retry \gset
\if :same_retry
\else
\quit 1
\endif
do $$begin
 if (select count(*) from public.message_assessments where retry_message_id=current_setting('test.retry_m')::uuid)<>1 then raise exception 'Duplicate retry';end if;
 if not exists(select 1 from public.message_assessments where message_id=current_setting('test.retry_m')::uuid and status='skipped' and reason='ai_unavailable') then raise exception 'Previous attempt changed';end if;
 if not exists(select 1 from public.message_assessments where id=current_setting('test.retry_job')::uuid and status='queued' and requested and operation_id is null and review_version=1) then raise exception 'Retry bypassed normal queue';end if;
 begin perform public.retry_message_assessment(current_setting('test.retry_e')::uuid,current_setting('test.retry_private')::uuid);raise exception 'Private check retried';exception when raise_exception then if sqlerrm<>'Message unavailable' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000002',true);
do $$begin
 begin perform public.retry_message_assessment(current_setting('test.retry_e')::uuid,current_setting('test.retry_m')::uuid);raise exception 'Outsider retry allowed';exception when raise_exception then if sqlerrm<>'Forbidden' then raise;end if;end;
end $$;
reset role;
update public.message_assessments set status='checked' where id=:'retry';
set role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
select public.retry_message_assessment(:'e',:'m');
do $$begin if (select count(*) from public.message_assessments where retry_message_id=current_setting('test.retry_m')::uuid)<>1 then raise exception 'Successful check replayed';end if;end $$;
rollback;
