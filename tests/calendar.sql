\set ON_ERROR_STOP on
reset role;
select id as e from public.engagements where title='Reporting dashboard' and creator_id='00000000-0000-0000-0000-000000000001' \gset
select id as task from public.milestone_tasks where version_id=(select accepted_version_id from public.engagements where id=:'e') and position=1 \gset
select set_config('test.calendar_e',:'e',false);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.propose_meeting(:'e',null,null,'Dashboard review','Review the agreed CSV totals',now()+interval '5 days',now()+interval '5 days 30 minutes','Africa/Johannesburg','https://example.test/meeting',:'task','80000000-0000-4000-8000-000000000001') as meeting \gset
select id as version from public.meeting_versions where meeting_id=:'meeting' \gset
select set_config('test.meeting',:'meeting',false);
select set_config('test.meeting_version',:'version',false);
do $$ begin
 if(select accepted_version_id from public.meetings where id=current_setting('test.meeting')::uuid) is not null then raise exception 'Tentative time confirmed early';end if;
 if(select count(*) from public.meeting_responses where version_id=current_setting('test.meeting_version')::uuid)<>1 then raise exception 'Proposer response missing';end if;
 begin perform public.propose_meeting(current_setting('test.calendar_e')::uuid,null,null,'Bad zone','Agenda',now()+interval '1 day',now()+interval '1 day 1 hour','Invented/Timezone',null,null,gen_random_uuid());raise exception 'Invalid timezone allowed';exception when raise_exception then if sqlerrm='Invalid timezone allowed' then raise;end if;end;
 begin update public.meeting_versions set title='Mutated' where id=current_setting('test.meeting_version')::uuid;raise exception 'Meeting mutation';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.respond_meeting(:'version','accepted','This time works.');
select public.respond_meeting(:'version','accepted','This time works.');
do $$ begin
 if(select accepted_version_id from public.meetings where id=current_setting('test.meeting')::uuid)<>current_setting('test.meeting_version')::uuid then raise exception 'Accepted time not confirmed';end if;
 if(select sequence from public.meetings where id=current_setting('test.meeting')::uuid)<>2 then raise exception 'Response replay changed sequence';end if;
end $$;
select public.propose_meeting(:'e',:'meeting',:'version','Dashboard review','Move the review by one hour',now()+interval '5 days 1 hour',now()+interval '5 days 90 minutes','UTC',null,null,'80000000-0000-4000-8000-000000000002');
select id as revised from public.meeting_versions where meeting_id=:'meeting' order by number desc limit 1 \gset
select set_config('test.meeting_revised',:'revised',false);
do $$ begin
 if(select accepted_version_id from public.meetings where id=current_setting('test.meeting')::uuid)<>current_setting('test.meeting_version')::uuid then raise exception 'Unapproved time overwrote confirmation';end if;
 begin perform public.propose_meeting(current_setting('test.calendar_e')::uuid,current_setting('test.meeting')::uuid,current_setting('test.meeting_version')::uuid,'Stale proposal','Agenda',now()+interval '2 days',now()+interval '2 days 30 minutes','UTC',null,null,gen_random_uuid());raise exception 'Stale proposal accepted';exception when raise_exception then if sqlerrm='Stale proposal accepted' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.respond_meeting(:'revised','declined','Keep the originally confirmed time.');
select public.add_meeting_note(:'version','Confirmed totals reconcile. Follow up on presentation polish.','81000000-0000-4000-8000-000000000001') as note \gset
select public.add_meeting_note(:'version','Confirmed totals reconcile. Follow up on presentation polish.','81000000-0000-4000-8000-000000000001');
do $$ begin
 if(select count(*) from public.meeting_notes where version_id=current_setting('test.meeting_version')::uuid)<>1 then raise exception 'Duplicate note';end if;
 if not exists(select 1 from public.messages where engagement_id=current_setting('test.calendar_e')::uuid and visibility='shared' and body like 'Meeting notes: Confirmed totals%') then raise exception 'Meeting notes unavailable to project agent';end if;
 begin perform public.cancel_meeting(current_setting('test.meeting')::uuid,current_setting('test.meeting_version')::uuid,'Stale cancellation');raise exception 'Stale cancellation allowed';exception when raise_exception then if sqlerrm='Stale cancellation allowed' then raise;end if;end;
end $$;
select public.cancel_meeting(:'meeting',:'revised','The review will be rescheduled in a new meeting.');
select public.cancel_meeting(:'meeting',:'revised','The review will be rescheduled in a new meeting.');
do $$ begin
 if(select sequence from public.meetings where id=current_setting('test.meeting')::uuid)<>5 then raise exception 'Calendar event revisions incorrect';end if;
 if(select status from public.meetings where id=current_setting('test.meeting')::uuid)<>'cancelled' then raise exception 'Cancellation not recorded';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin
 if exists(select 1 from public.meetings) or exists(select 1 from public.meeting_versions) or exists(select 1 from public.meeting_responses) or exists(select 1 from public.meeting_notes) then raise exception 'Outsider calendar leak';end if;
 begin perform public.respond_meeting(current_setting('test.meeting_version')::uuid,'accepted','Attack');raise exception 'Outsider response';exception when raise_exception then if sqlerrm='Outsider response' then raise;end if;end;
end $$;
