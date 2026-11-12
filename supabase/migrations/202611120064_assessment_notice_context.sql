-- A copied assessment notice ID carries the same source assessment as its original message.
create or replace function public.agent_message_context(e uuid,v public.visibility,ids uuid[])
returns table(ref text,kind text,record_id uuid,version text,body text,state text,source_visibility public.visibility,excerpt boolean)
language plpgsql stable security definer set search_path='' as $$
declare r public.party_role;begin
 r:=public.member_role(e);
 if r is null or v is null or (v<>'shared' and v::text<>r::text) then raise exception 'Forbidden';end if;
 if ids is null or cardinality(ids)>5 then raise exception 'Too many message references';end if;
 return query
 select 'message:'||m.id,'message'::text,m.id,'1'::text,
 left(m.body,5000)||case when a.id is null then '' else E'\n\nAssociated agent assessment (AI advice, not an agreed commitment):\n'||'Assessment ID: '||a.id::text||'; status: '||a.status||'; reason: '||coalesce(a.reason,'none')||'; completed: '||coalesce(a.finished_at::text,'not completed')||E'\nSummary: '||coalesce(a.result->>'summary','No completed result available.')||E'\nDetails: '||left(coalesce(a.result::text,'null'),8000) end,
 case when m.kind='agent' then 'agent_advice' else 'discussed' end,m.visibility,
 length(m.body)>5000 or coalesce(length(a.result::text)>8000,false)
 from public.messages m
 left join lateral (
  select j.id,j.status,j.reason,j.finished_at,j.result from public.message_assessments j
  where m.visibility='shared' and j.engagement_id=e and (j.message_id=m.id or j.retry_message_id=m.id or j.notice_message_id=m.id)
  order by j.created_at desc,j.id desc limit 1
 ) a on true
 where m.id=any(ids) and m.engagement_id=e and (m.visibility='shared' or (v<>'shared' and m.visibility=v));
end $$;
