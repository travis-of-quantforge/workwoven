\set ON_ERROR_STOP on
begin;
reset role;
select e.id as e from public.engagements e join public.memberships m on m.engagement_id=e.id where m.user_id='00000000-0000-0000-0000-000000000001' and m.role='client' and e.funding='funded' and exists(select 1 from public.memberships peer where peer.engagement_id=e.id and peer.user_id='00000000-0000-0000-0000-000000000002') limit 1 \gset
select set_config('test.agent_e',:'e',true);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.register_attachment(:'e','shared','shared-agent.txt','text/plain',10) as shared \gset
select public.register_attachment(:'e','client','private-agent.txt','text/plain',10) as private \gset
insert into storage.objects(bucket_id,name) values('engagement-files',:'shared'),('engagement-files',:'private');
select public.confirm_agent_attachments(array[:'shared'],'') as sm \gset
select public.confirm_agent_attachments(array[:'private'],'') as pm \gset
select set_config('test.agent_sm',:'sm',true),set_config('test.agent_pm',:'pm',true);
select public.confirm_agent_attachments(array[:'shared'],'');
reset role;
select public.store_attachment_text(:'shared','00000000-0000-0000-0000-000000000001','SHARED AGENT FILE: explicit deliverables',repeat('a',64),true);
select public.store_attachment_text(:'private','00000000-0000-0000-0000-000000000001','PRIVATE AGENT FILE: confidential estimate',repeat('b',64),true);
insert into public.messages(engagement_id,author_id,visibility,body,channel) values(:'e','00000000-0000-0000-0000-000000000001','shared','SHARED DISCUSSION: build the website','discussion');
do $$begin
 if (select channel from public.messages where id=current_setting('test.agent_sm')::uuid)<>'agent' then raise exception 'Upload posted into primary discussion';end if;
 if exists(select 1 from public.message_assessments where message_id in(current_setting('test.agent_sm')::uuid,current_setting('test.agent_pm')::uuid)) then raise exception 'Agent attachment self-triggered analysis';end if;
 if (select count(*) from public.attachments where source_message_id=current_setting('test.agent_sm')::uuid)<>1 then raise exception 'Upload replay duplicated attachment';end if;
end $$;
set role authenticated;
do $$declare e uuid:=current_setting('test.agent_e')::uuid;begin
 if not exists(select 1 from public.agent_chat_context(e,'shared') where body like '%SHARED DISCUSSION%') then raise exception 'Broad chat omitted discussion';end if;
 if not exists(select 1 from public.agent_chat_context(e,'shared') where body like '%SHARED AGENT FILE%') then raise exception 'Broad chat omitted agent file';end if;
 if exists(select 1 from public.agent_chat_context(e,'shared') where body like '%PRIVATE AGENT FILE%') then raise exception 'Project agent received private file';end if;
 if not exists(select 1 from public.agent_chat_context(e,'client') where body like '%PRIVATE AGENT FILE%') then raise exception 'Own private file unavailable';end if;
 begin perform public.agent_chat_context(e,'professional');raise exception 'Other private context accepted';exception when raise_exception then if sqlerrm<>'Forbidden' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$declare e uuid:=current_setting('test.agent_e')::uuid;begin
 if exists(select 1 from public.agent_chat_context(e,'professional') where body like '%PRIVATE AGENT FILE%') then raise exception 'Counterparty received private file';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
do $$begin
 begin perform public.agent_chat_context(current_setting('test.agent_e')::uuid,'shared');raise exception 'Cross-engagement context accepted';exception when raise_exception then if sqlerrm<>'Forbidden' then raise;end if;end;
end $$;
rollback;
