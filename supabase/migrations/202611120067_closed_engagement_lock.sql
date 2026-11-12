-- Closed engagements retain readable history, but accept no new participant work.
-- Lock the parent row to serialize writes against completion/cancellation.
create function public.require_open_engagement(e uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.engagements where id=e and status in('discussion','active') for update;
 if not found then raise exception 'This engagement has ended and is read-only';end if;
end $$;
revoke all on function public.require_open_engagement(uuid) from public,anon,authenticated;
grant execute on function public.require_open_engagement(uuid) to service_role;

create function public.guard_closed_engagement() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb; e uuid;begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 -- Trusted receipt reconciliation and billing recovery must remain possible.
 -- Participant RPCs still carry auth.uid(), even inside SECURITY DEFINER.
 if auth.uid() is null and tg_op<>'INSERT' then return coalesce(new,old);end if;
 if tg_argv[0]='account' then
   select engagement_id into e from public.agent_accounts where id=(row_data->>'account_id')::uuid;
 elsif tg_argv[0]='purchase' then
   select a.engagement_id into e from public.credit_purchases p join public.agent_accounts a on a.id=p.account_id where p.id=(row_data->>'purchase_id')::uuid;
 elsif tg_argv[0]='scope' then
   select engagement_id into e from public.scope_versions where id=(row_data->>'version_id')::uuid;
 elsif tg_argv[0]='contract' then
   select v.engagement_id into e from public.contract_versions v where v.id=(row_data->>'version_id')::uuid;
 elsif tg_argv[0]='milestone' then
   select m.engagement_id into e from public.milestone_versions v join public.milestones m on m.id=v.milestone_id where v.id=(row_data->>'version_id')::uuid;
 elsif tg_argv[0]='milestone_record' then
   select engagement_id into e from public.milestones where id=(row_data->>'milestone_id')::uuid;
 elsif tg_argv[0]='task' then
   select engagement_id into e from public.milestone_tasks where id=(row_data->>'task_id')::uuid;
 elsif tg_argv[0]='delivery' then
   select t.engagement_id into e from public.delivery_submissions s join public.milestone_tasks t on t.id=s.task_id where s.id=(row_data->>'submission_id')::uuid;
 elsif tg_argv[0]='meeting' then
   select engagement_id into e from public.meetings where id=(row_data->>'meeting_id')::uuid;
 elsif tg_argv[0]='meeting_version' then
   select m.engagement_id into e from public.meeting_versions v join public.meetings m on m.id=v.meeting_id where v.id=(row_data->>'version_id')::uuid;
 elsif tg_argv[0]='concern' then
   select engagement_id into e from public.concern_cases where id=(row_data->>'case_id')::uuid;
 elsif tg_argv[0]='review' then
   select engagement_id into e from public.reviews where id=(row_data->>'review_id')::uuid;
 elsif tg_argv[0]='finding' then
   select engagement_id into e from public.conversation_findings where id=(row_data->>'finding_id')::uuid;
 else e:=(row_data->>'engagement_id')::uuid;
 end if;
 -- Only trusted provider receipt functions can add system messages after closing.
 if auth.uid() is null and tg_table_name='messages' and row_data->>'kind'='system' then return coalesce(new,old);end if;
 -- Financial reconciliation is service-only; do not suppress verified receipts.
 if auth.uid() is null and tg_table_name in('payment_transactions','payment_refunds') then return coalesce(new,old);end if;
 perform public.require_open_engagement(e);
 return coalesce(new,old);
end $$;
revoke all on function public.guard_closed_engagement() from public,anon,authenticated;

do $$declare t text;begin
 foreach t in array array['messages','attachments','scope_versions','engagement_contracts','contract_versions','invitations','share_events','memberships','agent_configs','milestone_tasks','milestones','milestone_operations','completion_approvals','meetings','concern_cases','payment_requests','payment_transactions','payment_refunds','scope_monitor_settings','conversation_findings','reviews','portfolio_items','agent_runs','message_assessments'] loop
 execute format('create trigger closed_engagement_guard before insert or update or delete on public.%I for each row execute function public.guard_closed_engagement(''direct'')',t);
 end loop;
end $$;
create trigger closed_engagement_guard before insert or update on public.usage_operations for each row execute function public.guard_closed_engagement('account');
create trigger closed_engagement_guard before insert on public.credit_purchases for each row execute function public.guard_closed_engagement('account');
create trigger closed_engagement_guard before insert or update or delete on public.approvals for each row execute function public.guard_closed_engagement('scope');
create trigger closed_engagement_guard before insert or update or delete on public.task_dependencies for each row execute function public.guard_closed_engagement('scope');
create trigger closed_engagement_guard before insert or update or delete on public.contract_approvals for each row execute function public.guard_closed_engagement('contract');
create trigger closed_engagement_guard before insert or update or delete on public.milestone_approvals for each row execute function public.guard_closed_engagement('milestone');
create trigger closed_engagement_guard before insert or update or delete on public.task_progress for each row execute function public.guard_closed_engagement('task');
create trigger closed_engagement_guard before insert or update or delete on public.delivery_submissions for each row execute function public.guard_closed_engagement('task');
create trigger closed_engagement_guard before insert or update or delete on public.delivery_files for each row execute function public.guard_closed_engagement('delivery');
create trigger closed_engagement_guard before insert or update or delete on public.delivery_reviews for each row execute function public.guard_closed_engagement('delivery');
create trigger closed_engagement_guard before insert or update or delete on public.meeting_versions for each row execute function public.guard_closed_engagement('meeting');
create trigger closed_engagement_guard before insert or update or delete on public.meeting_responses for each row execute function public.guard_closed_engagement('meeting_version');
create trigger closed_engagement_guard before insert or update or delete on public.meeting_notes for each row execute function public.guard_closed_engagement('meeting_version');
create trigger closed_engagement_guard before insert or update or delete on public.concern_updates for each row execute function public.guard_closed_engagement('concern');
create trigger closed_engagement_guard before insert or update or delete on public.concern_acknowledgements for each row execute function public.guard_closed_engagement('concern');
create trigger closed_engagement_guard before insert or update or delete on public.review_replies for each row execute function public.guard_closed_engagement('review');
create trigger closed_engagement_guard before insert or update or delete on public.review_reports for each row execute function public.guard_closed_engagement('review');

-- Preserve the final closure entry, then change status last while holding the
-- same parent lock. No participant can interleave a new write after closing.
create or replace function public.close_engagement(e uuid,target text,expected uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); g public.engagements; r public.party_role;finished boolean:=false;begin
 select * into g from public.engagements where id=e for update;r:=public.member_role(e);
 if r is null then raise exception 'Forbidden';end if;
 if target not in('completed','cancelled') or length(trim(coalesce(reason,'')))=0 or length(reason)>3000 then raise exception 'Explain the requested engagement outcome';end if;
 if g.accepted_version_id is distinct from expected then raise exception 'Accepted agreement changed; refresh';end if;
 if g.status=target then return;end if;
 perform public.require_open_engagement(e);
 if target='completed' then
 if g.accepted_version_id is null then raise exception 'Completion requires an accepted agreement';end if;
 insert into public.completion_approvals(engagement_id,version_id,user_id,role) values(e,g.accepted_version_id,u,r) on conflict do nothing;
 finished:=(select count(*) from public.completion_approvals where engagement_id=e and version_id=g.accepted_version_id)=2;
 else finished:=true;end if;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(e,u,'engagement_'||target,e);
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(e,u,'shared','system',case when target='completed' then 'Completion confirmation recorded. Completion requires both parties.' else 'Engagement cancelled. Recorded payment obligations are unchanged.' end||' Reason: '||reason);
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,e,'message',e from public.memberships where engagement_id=e and user_id<>u;
 if finished then update public.engagements set status=target where id=e;end if;
end $$;

-- Avoid reserving new AI credits or publishing a result after closure. Existing
-- settlement/recovery stays available and platform failures remain uncharged.
do $$declare definition text;begin
 select pg_get_functiondef('public.finish_agent_run(uuid,jsonb,text,text,text)'::regprocedure) into definition;
 definition:=replace(definition,'select coalesce(sum(provider_nano),0) into actual',
 'if not exists(select 1 from public.engagements where id=run.engagement_id and status in(''discussion'',''active'')) then outcome:=''internal_error'';failure:=''engagement_closed'';end if; select coalesce(sum(provider_nano),0) into actual');
 execute definition;
end $$;

-- Freeze the engagement record itself; personal archiving remains separate.
create function public.guard_ended_status() returns trigger language plpgsql set search_path='' as $$begin
 if old.status not in('discussion','active') and new is distinct from old then raise exception 'This engagement has ended and is read-only';end if;
 return new;
end $$;
create trigger ended_status_guard before update on public.engagements for each row execute function public.guard_ended_status();

-- Queued reviews are skipped without reserving funds. In-flight assessment
-- results settle as platform errors rather than publishing into ended chats.
do $$declare definition text; signature text;begin
 foreach signature in array array['public.claim_message_assessment(uuid,uuid,bigint)','public.claim_message_assessment_legacy(uuid,uuid,bigint)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 definition:=replace(definition,'if job.status<>''queued'' then return null;end if;',
 'if job.status<>''queued'' then return null;end if; if not exists(select 1 from public.engagements where id=job.engagement_id and status in(''discussion'',''active'')) then perform public.fail_message_assessment(j,''engagement_closed'');return null;end if;');
 execute definition;
 end loop;
 foreach signature in array array['public.finish_message_assessment(uuid,jsonb)','public.finish_conversation_review(uuid,jsonb)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 definition:=replace(definition,'perform 1 from public.engagements where id=e for update;',
 'perform 1 from public.engagements where id=e for update; if not exists(select 1 from public.engagements where id=e and status in(''discussion'',''active'')) then perform public.fail_message_assessment(j,''engagement_closed'');return;end if;');
 execute definition;
 end loop;
end $$;

create policy closed_engagement_uploads on storage.objects as restrictive for insert to authenticated with check(
 bucket_id<>'engagement-files' or exists(select 1 from public.attachments a join public.engagements e on e.id=a.engagement_id where a.object_path=objects.name and e.status in('discussion','active'))
);
create policy closed_engagement_file_updates on storage.objects as restrictive for update to authenticated using(
 bucket_id<>'engagement-files' or exists(select 1 from public.attachments a join public.engagements e on e.id=a.engagement_id where a.object_path=objects.name and e.status in('discussion','active'))
);

create trigger closed_engagement_guard before insert or update or delete on public.milestone_versions for each row execute function public.guard_closed_engagement('milestone_record');

create trigger closed_engagement_guard before insert or update on public.credit_refunds for each row execute function public.guard_closed_engagement('purchase');
