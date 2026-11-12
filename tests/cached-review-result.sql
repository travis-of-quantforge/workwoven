\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values('95000000-0000-4000-8000-000000000001','cached-review@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
select public.create_engagement('Cached review fixture','client') as e \gset
select public.post_discussion_message(:'e','shared','Please review the brief.') as m \gset
reset role;
update public.message_assessments set status='checked',context_hash=public.review_context_hash(:'e'),result='{"summary":"The brief needs clarification about who supplies the images.","isRequest":true,"issues":[]}',finished_at=now() where message_id=:'m';
set role authenticated;
select public.request_conversation_review(:'e') as j \gset
reset role;
select public.prepare_conversation_review(:'j');
select public.claim_message_assessment(:'j',null,1000000);
select set_config('test.cached_job',:'j',true);
do $$begin
 if not exists(select 1 from public.message_assessments where id=current_setting('test.cached_job')::uuid and status='checked' and reason='unchanged_context' and result->>'summary'='The brief needs clarification about who supplies the images.' and operation_id is null) then raise exception 'Cached review lost result or charged';end if;
end $$;
rollback;
