\set ON_ERROR_STOP on
begin;
reset role;
insert into auth.users(id,email,email_confirmed_at) values
('99000000-0000-4000-8000-000000000001','milestone-client@example.test',now()),
('99000000-0000-4000-8000-000000000002','milestone-pro@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',false);
select public.create_engagement('Independent milestone test','client') as e \gset
select public.create_invitation(:'e','milestone-pro@example.test') as token \gset
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',false);
select public.accept_invitation(:'token');
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',false);
select public.submit_individual_milestones(:'e','[
 {"description":"Build the reporting dashboard","amountCents":10000,"targetDate":"2026-12-15","acceptanceCriteria":"Regional totals reconcile with the example CSV","responsibilities":"Supply CSV"},
 {"description":"Document the handover","amountCents":2000,"targetDate":"2026-12-20","acceptanceCriteria":"Guide covers upload and filters","responsibilities":""}
]', '99000000-0000-4000-8000-000000000010') as versions \gset
select id as m,latest_version_id as v from public.milestones where engagement_id=:'e' order by created_at,id limit 1 \gset
select id as other,latest_version_id as other_v from public.milestones where engagement_id=:'e' and id<>:'m' \gset
select set_config('test.individual_e',:'e',false),set_config('test.individual_m',:'m',false),set_config('test.individual_v',:'v',false),set_config('test.other_v',:'other_v',false);
do $$begin
 if (select count(*) from public.milestone_approvals where version_id=current_setting('test.individual_v')::uuid)<>1 then raise exception 'Submission did not approve author';end if;
 if (select accepted_version_id from public.engagements where id=current_setting('test.individual_e')::uuid) is not null then raise exception 'One party accepted';end if;
 begin perform public.approve_scope(current_setting('test.individual_v')::uuid);raise exception 'Legacy approval bypass';exception when raise_exception then if sqlerrm='Legacy approval bypass' then raise;end if;end;
 begin perform public.submit_individual_milestones(current_setting('test.individual_e')::uuid,'[{"description":"Incomplete","amountCents":1,"targetDate":"2026-12-15","acceptanceCriteria":"","responsibilities":""}]',gen_random_uuid());raise exception 'Blank criteria accepted';exception when raise_exception then if sqlerrm='Blank criteria accepted' then raise;end if;end;
 begin update public.milestone_versions set reason='Rewrite';raise exception 'History rewritten';exception when insufficient_privilege then null;end;
end $$;
select public.accept_milestone(:'v'); -- Author cannot accept for the counterpart.
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',false);
select public.accept_milestone(:'v');
select public.accept_milestone(:'v'); -- Replay.
select accepted_version_id as snapshot from public.engagements where id=:'e' \gset
select task_id as task from public.milestone_versions where id=:'v' \gset
select public.create_payment_request(:'e',:'snapshot',:'task','99000000-0000-4000-8000-000000000011') as payment \gset
select set_config('test.individual_payment',:'payment',false);
select public.report_task_progress(:'task',20);
select public.submit_delivery(:'task','Review the reporting dashboard','{}','{}','99000000-0000-4000-8000-000000000012') as delivery \gset
select public.accept_milestone(:'other_v'); -- Unrelated accepted milestone updates snapshot.
select public.create_payment_request(:'e',:'snapshot',:'task','99000000-0000-4000-8000-000000000011'); -- Old snapshot replay retains request.
do $$begin
 begin perform public.create_payment_request(current_setting('test.individual_e')::uuid,(select accepted_version_id from public.engagements where id=current_setting('test.individual_e')::uuid),null,gen_random_uuid());raise exception 'Allocated snapshot charged twice';exception when raise_exception then if sqlerrm='Allocated snapshot charged twice' then raise;end if;end;
 if (select status from public.payment_requests where id=current_setting('test.individual_payment')::uuid)<>'requested' then raise exception 'Unrelated acceptance superseded payment';end if;
 if(select count(*) from public.milestone_events where version_id=current_setting('test.individual_v')::uuid and event='accepted')<>1 then raise exception 'Duplicate acceptance event';end if;
 if not exists(select 1 from public.milestone_agent_context(current_setting('test.individual_e')::uuid) where record_id=current_setting('test.individual_v')::uuid and state='agreed') then raise exception 'Individual accepted evidence unavailable';end if;
end $$;
-- The recipient submits an amendment; their submission approves only version 2.
select public.submit_individual_milestones(:'e','[{"description":"Revised dashboard","amountCents":12000,"targetDate":"2026-12-22","acceptanceCriteria":"Totals and region filters match CSV","responsibilities":"Supply CSV"}]',
'99000000-0000-4000-8000-000000000013',:'m',:'v','Include a regional filter') as amended \gset
select latest_version_id as v2 from public.milestones where id=:'m' \gset
select set_config('test.individual_v2',:'v2',false);
do $$begin
 if (select accepted_version_id from public.milestones where id=current_setting('test.individual_m')::uuid)<>current_setting('test.individual_v')::uuid then raise exception 'Pending amendment changed accepted terms';end if;
 if(select count(*) from public.milestone_approvals where version_id=current_setting('test.individual_v2')::uuid)<>1 then raise exception 'Amendment inherited approvals';end if;
 begin perform public.accept_milestone(current_setting('test.individual_v')::uuid);raise exception 'Stale version accepted';exception when raise_exception then if sqlerrm='Stale version accepted' then raise;end if;end;
 begin perform public.submit_individual_milestones(current_setting('test.individual_e')::uuid,'[{"description":"Race","amountCents":100,"targetDate":"2026-12-22","acceptanceCriteria":"Exact criteria","responsibilities":""}]',gen_random_uuid(),current_setting('test.individual_m')::uuid,current_setting('test.individual_v')::uuid,'Stale edit');raise exception 'Stale edit accepted';exception when raise_exception then if sqlerrm='Stale edit accepted' then raise;end if;end;
end $$;
-- Retry must return the same version without creating another event/approval.
select public.submit_individual_milestones(:'e','[{"description":"Revised dashboard","amountCents":12000,"targetDate":"2026-12-22","acceptanceCriteria":"Totals and region filters match CSV","responsibilities":"Supply CSV"}]',
'99000000-0000-4000-8000-000000000013',:'m',:'v','Include a regional filter');
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',false);
select public.review_delivery(:'delivery','accepted','Meets the original accepted criteria');
select public.accept_milestone(:'v2');
do $$begin
 if (select accepted_version_id from public.milestones where id=current_setting('test.individual_m')::uuid)<>current_setting('test.individual_v2')::uuid then raise exception 'Amendment not accepted';end if;
 if (select status from public.payment_requests where id=current_setting('test.individual_payment')::uuid)<>'superseded' then raise exception 'Changed milestone payment still current';end if;
 if (select count(*) from public.milestone_versions where milestone_id=current_setting('test.individual_m')::uuid)<>2 then raise exception 'Duplicate retry version';end if;
 if (select count(*) from public.milestone_approvals where version_id=current_setting('test.other_v')::uuid)<>2 then raise exception 'Unrelated approvals changed';end if;
 if exists(select 1 from public.milestone_approvals a join public.scope_versions s on s.id=a.version_id where s.engagement_id=current_setting('test.individual_e')::uuid and s.content ? 'acceptedMilestones') then raise exception 'Fabricated snapshot approvals';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$begin
 if exists(select 1 from public.milestones) or exists(select 1 from public.milestone_versions) or exists(select 1 from public.milestone_events) or exists(select 1 from public.milestone_operations) then raise exception 'Outsider milestone leak';end if;
 begin perform public.accept_milestone(current_setting('test.individual_v2')::uuid);raise exception 'Outsider accepted';exception when raise_exception then if sqlerrm='Outsider accepted' then raise;end if;end;
end $$;
rollback;
