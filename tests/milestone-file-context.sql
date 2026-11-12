\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values('96000000-0000-4000-8000-000000000001','milestone-files@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',false);
select public.create_engagement('Milestone files fixture','client') as e \gset
select public.create_engagement('Other files fixture','client') as other \gset
select set_config('test.files_e',:'e',false);
reset role;
insert into public.messages(id,engagement_id,author_id,visibility,body) values('96000000-0000-4000-8000-000000000002',:'e','96000000-0000-4000-8000-000000000001','shared','Attached requirements');
insert into public.messages(engagement_id,author_id,visibility,body) select :'e','96000000-0000-4000-8000-000000000001','shared','Later discussion '||n from generate_series(1,30) n;
insert into public.attachments(id,engagement_id,owner_id,visibility,name,object_path,mime_type,size_bytes,upload_status,extraction_status,source_message_id) values
('96000000-0000-4000-8000-000000000003',:'e','96000000-0000-4000-8000-000000000001','shared','requirements.txt',:'e'||'/requirements','text/plain',100,'ready','ready','96000000-0000-4000-8000-000000000002'),
('96000000-0000-4000-8000-000000000004',:'e','96000000-0000-4000-8000-000000000001','client','private.txt',:'e'||'/private','text/plain',100,'ready','ready',null),
('96000000-0000-4000-8000-000000000005',:'e','96000000-0000-4000-8000-000000000001','shared','pending.txt',:'e'||'/pending','text/plain',100,'pending','ready',null),
('96000000-0000-4000-8000-000000000006',:'e','96000000-0000-4000-8000-000000000001','shared','design.pdf',:'e'||'/design','application/pdf',100,'ready','unsupported','96000000-0000-4000-8000-000000000002');
insert into public.attachment_texts(attachment_id,content,sha256,complete) values
('96000000-0000-4000-8000-000000000003','FILE REQUIREMENT: build a reporting dashboard with CSV export.',repeat('a',64),true),
('96000000-0000-4000-8000-000000000004','PRIVATE REQUIREMENT',repeat('b',64),true),
('96000000-0000-4000-8000-000000000005','PENDING REQUIREMENT',repeat('c',64),true);
set role authenticated;
do $$declare e uuid:=current_setting('test.files_e')::uuid;begin
 if not exists(select 1 from public.milestone_agent_context(e) where ref='attachment:96000000-0000-4000-8000-000000000003' and body like '%FILE REQUIREMENT%' and version=repeat('a',64)) then raise exception 'Discussion crowded out file contents';end if;
 if exists(select 1 from public.milestone_agent_context(e) where body like '%PRIVATE REQUIREMENT%' or body like '%PENDING REQUIREMENT%') then raise exception 'Private/pending content leaked';end if;
 if not exists(select 1 from public.milestone_agent_context(e) where ref='attachment:96000000-0000-4000-8000-000000000006' and state='unavailable_text' and body like '%design.pdf%' and excerpt) then raise exception 'Unreadable file silently omitted';end if;
end $$;
rollback;
