\set ON_ERROR_STOP on
do $$begin
 if(select count(*) from public.milestones)<>4 then raise exception 'Historical identities inferred or lost';end if;
 if(select count(*) from public.milestones where accepted_version_id is not null)<>2 then raise exception 'Imported acceptance changed';end if;
 if(select count(*) from public.approvals)<>2 then raise exception 'Fabricated or lost historical approvals';end if;
 if(select count(*) from public.milestone_versions)<>4 then raise exception 'Missing imported versions';end if;
 if(select count(*) from public.milestone_tasks)<>4 then raise exception 'Legacy task IDs changed';end if;
 if(select count(*) from public.milestone_events where event='proposed')<>4 or (select count(*) from public.milestone_events where event='accepted')<>2 then raise exception 'Missing historical discussion cards';end if;
 if exists(select 1 from public.milestone_events ev join public.messages msg on msg.id=ev.message_id join public.milestone_versions v on v.id=ev.version_id join public.scope_versions s on s.id=v.scope_version_id where ev.event='proposed' and msg.created_at<>s.created_at) then raise exception 'Proposal chronology changed';end if;
 if not exists(select 1 from public.delivery_submissions d join public.milestone_versions v on v.task_id=d.task_id join public.milestones m on m.id=v.milestone_id where m.accepted_version_id=v.id) then raise exception 'Historical delivery reference lost';end if;
 if not exists(select 1 from public.payment_requests p join public.milestone_versions v on v.task_id=p.task_id join public.milestones m on m.id=v.milestone_id where m.accepted_version_id=v.id and p.version_id=v.scope_version_id and p.status='requested') then raise exception 'Historical payment reference lost';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',false);
select public.report_task_progress((select task_id from public.milestone_versions v join public.milestones m on m.accepted_version_id=v.id limit 1),50);

-- Each unaccepted imported task now receives its own approvals. Accepting one
-- cannot implicitly approve the other task that shared its original scope.
select v.id as pending, v.scope_version_id as pending_scope from public.milestone_versions v join public.milestones m on m.id=v.milestone_id where m.accepted_version_id is null order by v.id limit 1 \gset
select set_config('test.import_pending',:'pending',false),set_config('test.import_scope',:'pending_scope',false);
select public.accept_milestone(:'pending');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',false);
select public.accept_milestone(:'pending');
do $$begin
 if (select count(*) from public.milestone_approvals where version_id=current_setting('test.import_pending')::uuid)<>2 then raise exception 'Imported task not independently accepted';end if;
 if exists(select 1 from public.milestone_approvals a join public.milestone_versions v on v.id=a.version_id where v.scope_version_id=current_setting('test.import_scope')::uuid and v.id<>current_setting('test.import_pending')::uuid) then raise exception 'Imported sibling approved implicitly';end if;
 if exists(select 1 from public.approvals where version_id=current_setting('test.import_scope')::uuid) then raise exception 'Original scope approval history rewritten';end if;
end $$;
