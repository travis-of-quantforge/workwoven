\set ON_ERROR_STOP on
insert into auth.users(id,email,email_confirmed_at) values
('98000000-0000-4000-8000-000000000001','import-client@example.test',now()),
('98000000-0000-4000-8000-000000000002','import-pro@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',false);
select public.create_engagement('Legacy import fixture','client') as e \gset
select public.create_invitation(:'e','import-pro@example.test') as token \gset
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',false);
select public.accept_invitation(:'token');
select public.submit_scope(:'e','{
 "deliverables":"Dashboard and guide","exclusions":"Email","assumptions":"CSV","responsibilities":"Provide CSV","acceptanceCriteria":"CSV totals match","priceCents":12000,"currency":"USD","paymentTerms":"On acceptance","schedule":"December",
 "milestones":[
 {"key":"98000000-0000-4000-8000-000000000010","title":"Dashboard","owner":"professional","startDate":"2026-12-01","endDate":"2026-12-10","acceptanceCriteria":"CSV totals match","paymentTerms":"On acceptance","amountCents":10000,"dependencies":[]},
 {"key":"98000000-0000-4000-8000-000000000011","title":"Guide","owner":"professional","startDate":"2026-12-11","endDate":"2026-12-15","acceptanceCriteria":"Upload documented","paymentTerms":"On acceptance","amountCents":2000,"dependencies":[]}
 ]}',null) as v \gset
select public.approve_scope(:'v');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',false);
select public.approve_scope(:'v');
select id as task from public.milestone_tasks where version_id=:'v' and position=1 \gset
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',false);
select public.submit_delivery(:'task','Original dashboard delivery','{}','{}','98000000-0000-4000-8000-000000000020');
select public.create_payment_request(:'e',:'v',:'task','98000000-0000-4000-8000-000000000021');
-- Same old task keys still do not establish continuity: preserve independent
-- historical records without guessing which rows represent an amendment.
select public.submit_scope(:'e',(select content || jsonb_build_object('change',jsonb_build_object('baseVersion',:'v','reason','Discuss a new deadline','affectedReferences','Dates','costImpact','Unchanged','scheduleImpact','Later date')) from public.scope_versions where id=:'v'),:'v');
reset role;
