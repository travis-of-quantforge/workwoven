\set ON_ERROR_STOP on
reset role;
select id as e from public.engagements where title='Reporting dashboard' and creator_id='00000000-0000-0000-0000-000000000001' \gset
select id as expected from public.scope_versions where engagement_id=:'e' order by number desc limit 1 \gset
select accepted_version_id as base from public.engagements where id=:'e' \gset
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.propose_milestones(:'e','[
 {"key":"70000000-0000-4000-8000-000000000001","title":"Reconcile dashboard totals","owner":"professional","startDate":"2026-11-05","endDate":"2026-11-10","acceptanceCriteria":"Regional totals match the supplied CSV","paymentTerms":"After client acceptance","amountCents":10000,"dependencies":[]},
 {"key":"70000000-0000-4000-8000-000000000002","title":"Client review","owner":"client","startDate":"2026-11-10","endDate":"2026-11-12","acceptanceCriteria":"Provide written review","paymentTerms":"Included","amountCents":0,"dependencies":["70000000-0000-4000-8000-000000000001"]}
]',:'expected',:'base','Add an explicit delivery and review schedule') as plan \gset
select set_config('test.plan',:'plan',false);
select set_config('test.milestone_e',:'e',false);
select id as task from public.milestone_tasks where version_id=:'plan' and position=1 \gset
select set_config('test.task',:'task',false);
do $$ begin
 if(select count(*) from public.milestone_tasks where version_id=current_setting('test.plan')::uuid)<>2 then raise exception 'Tasks not persisted';end if;
 begin perform public.report_task_progress(current_setting('test.task')::uuid,50);raise exception 'Proposed task editable';exception when raise_exception then if sqlerrm='Proposed task editable' then raise;end if;end;
 begin update public.milestone_tasks set title='Mutated' where id=current_setting('test.task')::uuid;raise exception 'Accepted task mutation';exception when insufficient_privilege then null;end;
end $$;
select public.approve_scope(:'plan');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.approve_scope(:'plan');
select public.report_task_progress(:'task',100);
do $$ begin
 if exists(select 1 from public.delivery_submissions where task_id=current_setting('test.task')::uuid) then raise exception 'Progress implied delivery';end if;
 begin perform public.propose_milestones(current_setting('test.milestone_e')::uuid,
  (select jsonb_set(content->'milestones','{0,amountCents}','99999999') from public.scope_versions where id=current_setting('test.plan')::uuid),current_setting('test.plan')::uuid,current_setting('test.plan')::uuid,'Invalid allocation');raise exception 'Excess allocation allowed';exception when raise_exception then if sqlerrm='Excess allocation allowed' then raise;end if;end;
 begin perform public.propose_milestones(current_setting('test.milestone_e')::uuid,
  (select jsonb_set(content->'milestones','{0,dependencies}','["70000000-0000-4000-8000-000000000002"]') from public.scope_versions where id=current_setting('test.plan')::uuid),current_setting('test.plan')::uuid,current_setting('test.plan')::uuid,'Invalid cycle');raise exception 'Dependency cycle allowed';exception when raise_exception then if sqlerrm='Dependency cycle allowed' then raise;end if;end;
 begin perform public.propose_milestones(current_setting('test.milestone_e')::uuid,'[]',current_setting('test.plan')::uuid,null,'Stale accepted base');raise exception 'Stale schedule base allowed';exception when raise_exception then if sqlerrm='Stale schedule base allowed' then raise;end if;end;
end $$;
select public.submit_delivery(:'task','Dashboard totals reconcile; please review region filters.','{https://example.test/review}','{}','71000000-0000-4000-8000-000000000001') as submission \gset
select public.submit_delivery(:'task','Dashboard totals reconcile; please review region filters.','{https://example.test/review}','{}','71000000-0000-4000-8000-000000000001');
select set_config('test.delivery',:'submission',false);
do $$ begin
 if(select count(*) from public.delivery_submissions where task_id=current_setting('test.task')::uuid)<>1 then raise exception 'Duplicate delivery';end if;
 begin perform public.review_delivery(current_setting('test.delivery')::uuid,'accepted','Self approval');raise exception 'Professional accepted own work';exception when raise_exception then if sqlerrm='Professional accepted own work' then raise;end if;end;
 begin perform public.submit_delivery(current_setting('test.task')::uuid,'Private file leak','{}',array[(select id from public.attachments where visibility='professional' limit 1)],gen_random_uuid());raise exception 'Private delivery file allowed';exception when raise_exception then if sqlerrm='Private delivery file allowed' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.review_delivery(:'submission','changes_requested','The regional filter must update totals as required by the milestone criteria.');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.submit_delivery(:'task','Regional filtering fixed and totals rechecked.','{}','{}','71000000-0000-4000-8000-000000000002') as second \gset
select set_config('test.second_delivery',:'second',false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.review_delivery(:'second','accepted','Totals and filters match the CSV acceptance criteria.');
select public.review_delivery(:'second','accepted','Totals and filters match the CSV acceptance criteria.');
do $$ begin
 if(select count(*) from public.delivery_reviews where submission_id=current_setting('test.second_delivery')::uuid)<>1 then raise exception 'Review replay duplicated';end if;
 begin perform public.review_delivery(current_setting('test.second_delivery')::uuid,'changes_requested','Rewrite review');raise exception 'Review mutation allowed';exception when raise_exception then if sqlerrm='Review mutation allowed' then raise;end if;end;
 begin perform public.report_task_progress(current_setting('test.task')::uuid,0);raise exception 'Client rewrote professional progress';exception when raise_exception then if sqlerrm='Client rewrote professional progress' then raise;end if;end;
end $$;
-- New accepted schedules do not rewrite historical delivery references.
select public.propose_milestones(:'e',(select jsonb_set(content->'milestones','{0,endDate}','"2026-11-09"') from public.scope_versions where id=:'plan'),:'plan',:'plan','Agree an earlier completion date') as revision \gset
select public.approve_scope(:'revision');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.approve_scope(:'revision');
do $$ begin
 begin perform public.submit_delivery(current_setting('test.task')::uuid,'Stale task submission','{}','{}',gen_random_uuid());raise exception 'Superseded task delivered';exception when raise_exception then if sqlerrm='Superseded task delivered' then raise;end if;end;
 if(select task_id from public.delivery_submissions where id=current_setting('test.second_delivery')::uuid)<>current_setting('test.task')::uuid then raise exception 'Historical submission changed';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin
 if exists(select 1 from public.milestone_tasks) or exists(select 1 from public.task_dependencies) or exists(select 1 from public.delivery_submissions) or exists(select 1 from public.delivery_reviews) then raise exception 'Outsider milestone leak';end if;
end $$;
