-- Preserve prior attempts and their financial receipts; a retry uses the same
-- bounded shared review queue with a fresh operation identity.
alter table public.message_assessments add column retry_message_id uuid references public.messages;
create index assessment_retry_message on public.message_assessments(retry_message_id,created_at desc);
create function public.retry_message_assessment(e uuid,m uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();latest public.message_assessments;marker uuid;j uuid;begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=e and status in('discussion','active') and funding='funded' for update;
 if not found then raise exception 'Engagement unavailable';end if;
 if not exists(select 1 from public.messages where id=m and engagement_id=e and visibility='shared' and channel='discussion' and kind in('human','share')) then raise exception 'Message unavailable';end if;
 select * into latest from public.message_assessments where engagement_id=e and (message_id=m or retry_message_id=m) order by created_at desc,id desc limit 1;
 if latest.id is null then raise exception 'Conversation check unavailable';end if;
 if latest.status in('queued','running','checked','flagged') then return latest.id;end if;
 if not coalesce((select enabled from public.scope_monitor_settings where engagement_id=e),true) then raise exception 'Automatic checks are paused';end if;
 insert into public.messages(engagement_id,author_id,visibility,kind,body,channel)
 values(e,u,'shared','human','Retry the conversation check for message '||m::text||' using current shared evidence.','agent') returning id into marker;
 insert into public.message_assessments(engagement_id,message_id,actor_id,terms,status,review_version,requested,review_prompt,retry_message_id,created_at)
 values(e,marker,u,public.accepted_monitor_terms(e),'queued',1,true,'Reassess message:'||m::text||' in the current shared discussion. Recognise later clarifications and do not repeat resolved issues.',m,clock_timestamp()) returning id into j;
 return j;
end $$;
revoke all on function public.retry_message_assessment(uuid,uuid) from public,anon;
grant execute on function public.retry_message_assessment(uuid,uuid) to authenticated;
