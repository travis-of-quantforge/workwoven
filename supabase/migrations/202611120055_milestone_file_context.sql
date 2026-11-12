-- Discussion volume must not crowd uploaded requirements out of milestone drafting.
alter function public.milestone_agent_context(uuid) rename to milestone_agent_context_before_files;
revoke all on function public.milestone_agent_context_before_files(uuid) from public,anon,authenticated;
create function public.milestone_agent_context(e uuid)
returns table(ref text,kind text,record_id uuid,version text,body text,state text,source_visibility public.visibility,excerpt boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_verified();if public.member_role(e) is null then raise exception 'Forbidden';end if;
 return query select c.* from public.milestone_agent_context_before_files(e) c where c.kind<>'attachment';
 return query select 'attachment:'||a.id,'attachment'::text,a.id,coalesce(t.sha256,'unavailable'),
 'File: '||a.name||E'\n'||case when t.attachment_id is not null and a.extraction_status in('ready','partial') then left(t.content,10000) else 'Contents unavailable: this file has no readable extracted text. Do not infer requirements from its filename.' end,
 case when t.attachment_id is null or a.extraction_status not in('ready','partial') then 'unavailable_text' when t.complete then 'extracted_text' else 'partial_text' end,
 a.visibility,t.attachment_id is null or not coalesce(t.complete,false) or length(t.content)>10000
 from public.attachments a left join public.attachment_texts t on t.attachment_id=a.id
 join public.messages m on m.id=a.source_message_id and m.engagement_id=e and m.visibility='shared' and m.channel='discussion'
 where a.engagement_id=e and a.visibility='shared' and a.upload_status='ready'
 order by a.created_at,a.id;
end $$;
revoke all on function public.milestone_agent_context(uuid) from public,anon;
grant execute on function public.milestone_agent_context(uuid) to authenticated;
