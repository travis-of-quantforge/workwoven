\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values('97000000-0000-4000-8000-000000000001','prior-assessment@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select public.create_engagement('Prior assessment fixture','client') as e \gset
select public.create_engagement('Foreign assessment fixture','client') as other_e \gset
select public.post_discussion_message(:'e','shared','Who supplies the images?') as m \gset
select public.post_discussion_message(:'other_e','shared','OTHER ENGAGEMENT QUESTION') as other_m \gset
reset role;
update public.message_assessments set status='checked',result='{"summary":"We already asked who supplies images."}',finished_at=now() where message_id=:'m';
update public.message_assessments set status='checked',result='{"summary":"FOREIGN SUMMARY MUST NOT LEAK"}',finished_at=now() where message_id=:'other_m';
set role authenticated;
select public.post_discussion_message(:'e','shared','The delivery date is next week.') as next_m \gset
reset role;
select id as j from public.message_assessments where message_id=:'next_m' \gset
select set_config('test.prior_j',:'j',true);
do $$declare snapshot jsonb;begin
 snapshot:=public.prepare_conversation_review(current_setting('test.prior_j')::uuid);
 if jsonb_array_length(snapshot->'priorAssessments')<>1 or snapshot->'priorAssessments'->0->>'summary'<>'We already asked who supplies images.' or snapshot->'priorAssessments'->0->>'assessedAt' is null then raise exception 'Prior assessment context missing';end if;
 if snapshot::text like '%FOREIGN SUMMARY%' then raise exception 'Foreign assessment leaked';end if;
end $$;
rollback;
