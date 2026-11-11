\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values
('97000000-0000-4000-8000-000000000001','upload-client@example.test',now()),
('97000000-0000-4000-8000-000000000002','upload-professional@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
select public.create_engagement('Delivery upload fixture','client') as e \gset
select public.create_invitation(:'e','upload-professional@example.test') as invite \gset
select public.submit_individual_milestones(:'e','[{"description":"Deliver dashboard files","amountCents":2000,"targetDate":"2026-12-20","acceptanceCriteria":"CSV totals reconcile","responsibilities":"Provide sample data"}]',gen_random_uuid()) as proposed \gset
select latest_version_id as v from public.milestones where engagement_id=:'e' \gset
select task_id as t from public.milestone_versions where id=:'v' \gset
select set_config('test.upload_t',:'t',false);
do $$begin
 begin perform public.register_delivery_upload(current_setting('test.upload_t')::uuid,gen_random_uuid(),'report.txt','text/plain',10,repeat('a',64));raise exception 'Client uploaded delivery';exception when raise_exception then if sqlerrm='Client uploaded delivery' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',false);
select public.accept_invitation(:'invite');
select public.accept_milestone(:'v');
select gen_random_uuid() as k \gset
select public.register_delivery_upload(:'t',:'k','report.txt','text/plain',10,repeat('a',64)) as p \gset
select public.register_delivery_upload(:'t',:'k','report.txt','text/plain',10,repeat('a',64));
select set_config('test.upload_k',:'k',false);
reset role;
insert into storage.objects(bucket_id,name) values('engagement-files',:'p');
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
do $$begin if exists(select 1 from public.attachments where id=current_setting('test.upload_k')::uuid) then raise exception 'Pending filename leaked';end if;end $$;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',false);
do $$begin
 begin perform public.submit_delivery_with_upload(current_setting('test.upload_t')::uuid,'Review the dashboard','{}',array[gen_random_uuid()],current_setting('test.upload_k')::uuid);raise exception 'Invalid files accepted';exception when raise_exception then if sqlerrm='Invalid files accepted' then raise;end if;end;
 if not exists(select 1 from public.attachments where id=current_setting('test.upload_k')::uuid and upload_status='pending' and source_message_id is null) then raise exception 'Failed delivery published upload';end if;
 if exists(select 1 from public.delivery_submissions where operation_key=current_setting('test.upload_k')::uuid) then raise exception 'Failed delivery persisted';end if;
end $$;
select public.submit_delivery_with_upload(:'t','Review the dashboard','{}','{}',:'k') as s \gset
select public.submit_delivery_with_upload(:'t','Review the dashboard','{}','{}',:'k');
do $$begin
 if(select count(*) from public.delivery_files where attachment_id=current_setting('test.upload_k')::uuid)<>1 then raise exception 'Missing or duplicate delivery attachment';end if;
 if not exists(select 1 from public.attachments a join public.messages m on m.id=a.source_message_id where a.id=current_setting('test.upload_k')::uuid and a.upload_status='ready' and m.visibility='shared' and m.kind='system') then raise exception 'Missing shared delivery source';end if;
 begin perform public.register_delivery_upload(current_setting('test.upload_t')::uuid,current_setting('test.upload_k')::uuid,'report.txt','text/plain',10,repeat('b',64));raise exception 'Changed retry bytes allowed';exception when raise_exception then if sqlerrm='Changed retry bytes allowed' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
do $$begin if not exists(select 1 from public.attachments where id=current_setting('test.upload_k')::uuid and upload_status='ready') then raise exception 'Submitted file hidden from client';end if;end $$;
select public.review_delivery(:'s','accepted','The CSV totals meet the accepted criteria.');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',false);
select public.submit_delivery_with_upload(:'t','Review the dashboard','{}','{}',:'k'); -- Safe historical replay.
do $$begin
 begin perform public.register_delivery_upload(current_setting('test.upload_t')::uuid,gen_random_uuid(),'later.txt','text/plain',10,repeat('a',64));raise exception 'Upload accepted after completion';exception when raise_exception then if sqlerrm='Upload accepted after completion' then raise;end if;end;
end $$;
rollback;
