\set ON_ERROR_STOP on
reset role;
select id as engagement from public.engagements where title='Concern and invitation fixture' \gset
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.submit_scope(:'engagement','{"deliverables":"Reconcile dashboard totals","exclusions":"Hosting","assumptions":"CSV supplied","responsibilities":"Client provides sample data","acceptanceCriteria":"Totals match CSV","priceCents":12000,"currency":"USD","paymentTerms":"After client acceptance","schedule":"Two weeks","milestones":[{"key":"70000000-0000-4000-8000-000000000011","title":"Reconcile totals","owner":"professional","startDate":"2026-11-05","endDate":"2026-11-10","acceptanceCriteria":"Regional totals match CSV","paymentTerms":"After acceptance","amountCents":10000,"dependencies":[]}]}'::jsonb,null) as accepted \gset
select public.approve_scope(:'accepted');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.approve_scope(:'accepted');
reset role;
select id as task from public.milestone_tasks where version_id=:'accepted' and amount_cents>0 limit 1 \gset
select set_config('test.payment_engagement',:'engagement',false);
select set_config('test.payment_accepted',:'accepted',false);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$begin
 begin perform public.create_payment_request(current_setting('test.payment_engagement')::uuid,
 current_setting('test.payment_accepted')::uuid,null,gen_random_uuid());raise exception 'Client created payment request';
 exception when raise_exception then if sqlerrm='Client created payment request' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.create_payment_request(:'engagement',:'accepted',:'task','60000000-0000-4000-8000-000000000001') as request \gset
select public.create_payment_request(:'engagement',:'accepted',:'task','60000000-0000-4000-8000-000000000001');
select public.create_payment_request(:'engagement',:'accepted',null,'60000000-0000-4000-8000-000000000003') as balance_request \gset
select set_config('test.payment_request',:'request',false);
do $$begin
 if (select amount_cents from public.payment_requests where id=current_setting('test.payment_request')::uuid)<>10000
   then raise exception 'Amount not derived from accepted scope';end if;
 if (select amount_cents from public.payment_requests where operation_key='60000000-0000-4000-8000-000000000003')<>2000
   then raise exception 'Unallocated balance not calculated';end if;
 if (select count(*) from public.payment_requests where engagement_id=current_setting('test.payment_engagement')::uuid)<>2
   then raise exception 'Payment request replay duplicated';end if;
 begin perform public.create_payment_request(current_setting('test.payment_engagement')::uuid,
 current_setting('test.payment_accepted')::uuid,null,gen_random_uuid());raise exception 'Duplicate agreement balance request';
 exception when unique_violation then null;when raise_exception then if sqlerrm='Duplicate agreement balance request' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.submit_scope(:'engagement',
 jsonb_set((select content from public.scope_versions where id=:'accepted'),'{priceCents}','13000'::jsonb)
 || jsonb_build_object('change',jsonb_build_object('baseVersion',:'accepted','reason','Add data audit work','affectedReferences','Price and deliverables','costImpact','Additional USD 10 proposed','scheduleImpact','No date change')),
 :'accepted') as revision \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$begin
 begin perform public.create_payment_request(current_setting('test.payment_engagement')::uuid,
 (select id from public.scope_versions where engagement_id=current_setting('test.payment_engagement')::uuid order by number desc limit 1),null,gen_random_uuid());
 raise exception 'Unaccepted revision billed';
 exception when raise_exception then if sqlerrm='Unaccepted revision billed' then raise;end if;end;
end $$;
select public.approve_scope(:'revision');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.approve_scope(:'revision');
reset role;
do $$begin
 if (select status from public.payment_requests where id=current_setting('test.payment_request')::uuid)<>'superseded'
   then raise exception 'Historical request not superseded';end if;
 if (select amount_cents from public.payment_requests where id=current_setting('test.payment_request')::uuid)<>10000
   then raise exception 'Historical request amount changed';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.create_payment_request(:'engagement',:'revision',null,'60000000-0000-4000-8000-000000000002') as newer \gset
do $$begin
 if (select amount_cents from public.payment_requests where operation_key='60000000-0000-4000-8000-000000000002')<>3000
   then raise exception 'Revised amount incorrect';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$begin
 if not exists(select 1 from public.notifications where kind='payment_request' and record_id=current_setting('test.payment_request')::uuid)
   then raise exception 'Client notification missing';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$begin
 if exists(select 1 from public.payment_requests) then raise exception 'Outsider saw payment requests';end if;
end $$;
reset role;
\echo 'Version-bound, role-safe payment request assertions passed'
