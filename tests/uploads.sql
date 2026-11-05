\set ON_ERROR_STOP on
reset role;
select e.id as engagement from public.engagements e join public.memberships m on m.engagement_id=e.id where m.user_id='00000000-0000-0000-0000-000000000001' and m.role='client' and e.funding='funded' limit 1 \gset
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.register_attachment(:'engagement','shared','sample.csv','text/csv',10) as upload \gset
select set_config('test.upload',:'upload',false);
select public.abort_attachment(:'upload');
do $$ begin if exists(select 1 from public.attachments where object_path=current_setting('test.upload')) then raise exception 'Failed upload metadata retained'; end if; end $$;
select public.register_attachment(:'engagement','shared','sample.csv','text/csv',10) as uploaded \gset
select set_config('test.uploaded',:'uploaded',false);
insert into storage.objects(bucket_id,name) values('engagement-files',:'uploaded');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 begin perform public.confirm_attachment(current_setting('test.uploaded')); raise exception 'Other party confirmed upload';
 exception when raise_exception then if sqlerrm='Other party confirmed upload' then raise; end if; end;
end $$;
select public.abort_attachment(:'uploaded');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.confirm_attachment(:'uploaded');
select public.confirm_attachment(:'uploaded');
select public.abort_attachment(:'uploaded');
do $$ begin if not exists(select 1 from public.attachments where object_path=current_setting('test.uploaded') and upload_status='ready') then raise exception 'Confirmed upload missing'; end if; end $$;
do $$begin
 if(select source_message_id from public.attachments where object_path=current_setting('test.uploaded')) is null then raise exception 'Missing attachment source event';end if;
 if(select count(*) from public.messages where id=(select source_message_id from public.attachments where object_path=current_setting('test.uploaded')))<>1 then raise exception 'Duplicate confirmation event';end if;
end $$;
reset role;
\echo 'Upload lifecycle assertions passed'
