\set ON_ERROR_STOP on
begin;
reset role;
select e.id as e from public.engagements e join public.memberships m on m.engagement_id=e.id where m.user_id='00000000-0000-0000-0000-000000000001' and m.role='client' and e.funding='funded' and exists(select 1 from public.memberships peer where peer.engagement_id=e.id and peer.user_id='00000000-0000-0000-0000-000000000002') limit 1 \gset
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.register_attachment(:'e','shared','first.txt','text/plain',10) as p1 \gset
select public.register_attachment(:'e','shared','second.txt','text/plain',10) as p2 \gset
select set_config('test.multiple_paths',array[:'p1',:'p2']::text,true);
insert into storage.objects(bucket_id,name) values('engagement-files',:'p1');
do $$begin
 begin perform public.confirm_attachments_with_message(current_setting('test.multiple_paths')::text[],'');raise exception 'Partial upload committed';exception when raise_exception then if sqlerrm<>'Uploaded object unavailable' then raise;end if;end;
 if exists(select 1 from public.attachments where object_path=any(current_setting('test.multiple_paths')::text[]) and upload_status='ready') then raise exception 'Partial confirmation exposed files';end if;
end $$;
insert into storage.objects(bucket_id,name) values('engagement-files',:'p2');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$begin
 begin perform public.confirm_attachments_with_message(current_setting('test.multiple_paths')::text[],'');raise exception 'Peer attached files';exception when raise_exception then if sqlerrm<>'Uploaded object unavailable' then raise;end if;end;
 if exists(select 1 from public.attachments where object_path=any(current_setting('test.multiple_paths')::text[])) then raise exception 'Pending uploads leaked';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.confirm_attachments_with_message(array[:'p1',:'p2'],'') as m \gset
select set_config('test.multiple_m',:'m',true);
select public.confirm_attachments_with_message(array[:'p2',:'p1'],'');
reset role;
do $$begin
 if (select count(*) from public.attachments where source_message_id=current_setting('test.multiple_m')::uuid and upload_status='ready')<>2 then raise exception 'Files not linked to one message';end if;
 if (select body from public.messages where id=current_setting('test.multiple_m')::uuid) not like 'Attached files:%' then raise exception 'Attachment-only message missing caption';end if;
 if (select count(*) from public.notifications where record_id=current_setting('test.multiple_m')::uuid)<>1 then raise exception 'Replay duplicated notifications';end if;
 begin perform public.confirm_attachments_with_message('{}','');raise exception 'Empty batch accepted';exception when raise_exception then if sqlerrm<>'Choose between 1 and 10 files' then raise;end if;end;
end $$;
rollback;
