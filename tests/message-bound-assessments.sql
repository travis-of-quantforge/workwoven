\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values
('93000000-0000-4000-8000-000000000001','bound-client@example.test',now()),
('93000000-0000-4000-8000-000000000002','bound-pro@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select public.create_engagement('Message-bound assessment fixture') as e \gset
select public.create_invitation(:'e','bound-pro@example.test') as token \gset
select public.post_discussion_message(:'e','client','PRIVATE SOURCE MUST NOT LEAK');
select public.post_discussion_message(:'e','shared','The button destination is unclear.') as m \gset
reset role;
select id as j from public.message_assessments where message_id=:'m' \gset
insert into public.messages(engagement_id,author_id,visibility,kind,body) values(:'e','93000000-0000-4000-8000-000000000001','shared','agent','Legacy duplicate assessment') returning id as duplicate \gset
update public.message_assessments set notice_message_id=:'duplicate',status='flagged' where id=:'j';
insert into public.messages(engagement_id,author_id,visibility,kind,body,channel) values(:'e','93000000-0000-4000-8000-000000000001','shared','human','Retry marker','agent') returning id as marker \gset
insert into public.message_assessments(engagement_id,message_id,retry_message_id,actor_id,terms,status,review_version,created_at)
values(:'e',:'marker',:'m','93000000-0000-4000-8000-000000000001','[]','checked',1,now()+interval '1 second') returning id as retry \gset
select set_config('test.bound_e',:'e',true),set_config('test.bound_source',:'m',true),set_config('test.bound_duplicate',:'duplicate',true),set_config('test.bound_retry',:'retry',true);
set role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
select public.accept_invitation(:'token');
do $$begin
 if exists(select 1 from public.discussion_messages where id=current_setting('test.bound_duplicate')::uuid) then raise exception 'Historical duplicate visible';end if;
 if not exists(select 1 from public.messages where id=current_setting('test.bound_duplicate')::uuid) then raise exception 'Historical audit message deleted';end if;
 if exists(select 1 from public.discussion_messages where body='PRIVATE SOURCE MUST NOT LEAK') then raise exception 'View bypasses private RLS';end if;
 if (select count(*) from public.latest_discussion_assessments where source_message_id=current_setting('test.bound_source')::uuid)<>1 then raise exception 'Duplicate source assessments';end if;
 if (select id from public.latest_discussion_assessments where source_message_id=current_setting('test.bound_source')::uuid)<>current_setting('test.bound_retry')::uuid then raise exception 'Latest retry not associated with original message';end if;
end $$;
rollback;
