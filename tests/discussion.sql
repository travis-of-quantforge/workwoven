\set ON_ERROR_STOP on
reset role;
select e.id as engagement from public.engagements e join public.memberships m on m.engagement_id=e.id where m.user_id='00000000-0000-0000-0000-000000000001' and m.role='client' and e.funding='funded' limit 1 \gset
select set_config('test.engagement',:'engagement',false);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.post_discussion_message(:'engagement','shared','Can you confirm the data format?',null,array['00000000-0000-0000-0000-000000000002'::uuid]) as root \gset
select public.post_discussion_message(:'engagement','client','Private threaded note') as private_root \gset
select set_config('test.private_root',:'private_root',false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if (select count(*) from public.notifications where kind='mention')<>1 then raise exception 'Mention notification missing'; end if;
 if exists(select 1 from public.notifications where record_id=current_setting('test.private_root')::uuid) then raise exception 'Private activity leak'; end if;
 begin perform public.post_discussion_message(current_setting('test.engagement')::uuid,'shared','Leak',current_setting('test.private_root')::uuid);raise exception 'Cross-context reply allowed';
 exception when raise_exception then if sqlerrm='Cross-context reply allowed' then raise;end if;end;
end $$;
select public.post_discussion_message(:'engagement','shared','Yes, a UTF-8 CSV is fine.',:'root') as reply \gset
select public.mark_discussion_read(:'engagement',:'reply');
do $$ begin
 if not exists(select 1 from public.discussion_reads where engagement_id=current_setting('test.engagement')::uuid) then raise exception 'Read marker missing'; end if;
 if exists(select 1 from public.notifications where engagement_id=current_setting('test.engagement')::uuid and kind in ('message','mention','reply') and seen_at is null) then raise exception 'Read messages retain unread notifications';end if;
 begin perform public.post_discussion_message(current_setting('test.engagement')::uuid,'professional','private',null,array['00000000-0000-0000-0000-000000000001'::uuid]); raise exception 'Private mention allowed';
 exception when raise_exception then if sqlerrm='Private mention allowed' then raise;end if;end;
end $$;
select public.mark_notification_seen(id) from public.notifications where seen_at is null;
do $$ begin if exists(select 1 from public.notifications where seen_at is null) then raise exception 'Mark seen failed';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 if exists(select 1 from public.discussion_reads) then raise exception 'Private read receipt exposed'; end if;
 if not exists(select 1 from public.notifications where kind='reply') then raise exception 'Reply notification missing'; end if;
end $$;
reset role;
\echo 'Discussion assertions passed'
