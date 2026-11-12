-- An exact message lookup carries its latest shared review alongside the text.
-- This projection intentionally omits billing, private chats and drafts.
create function public.agent_message_context(e uuid,v public.visibility,ids uuid[])
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
  where m.visibility='shared' and j.engagement_id=e and (j.message_id=m.id or j.retry_message_id=m.id)
  order by j.created_at desc,j.id desc limit 1
 ) a on true
 where m.id=any(ids) and m.engagement_id=e and (m.visibility='shared' or (v<>'shared' and m.visibility=v));
end $$;
revoke all on function public.agent_message_context(uuid,public.visibility,uuid[]) from public,anon;
grant execute on function public.agent_message_context(uuid,public.visibility,uuid[]) to authenticated;

alter function public.search_agent_evidence(uuid,public.visibility,text) rename to search_agent_evidence_without_assessment;
revoke all on function public.search_agent_evidence_without_assessment(uuid,public.visibility,text) from public,anon,authenticated;
create function public.search_agent_evidence(e uuid,v public.visibility,q text)
returns table(ref text,kind text,record_id uuid,version text,body text,state text,source_visibility public.visibility,excerpt boolean)
language plpgsql stable security definer set search_path='' as $$
declare row record;enriched record;ids uuid[];begin
 -- Also accept an exact copied UUID (with or without message: prefix).
 select array_agg(matches[1]::uuid) into ids from regexp_matches(left(coalesce(q,''),256),'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})','g') matches;
 if ids is not null then return query select * from public.agent_message_context(e,v,ids);end if;
 for row in select * from public.search_agent_evidence_without_assessment(e,v,q) loop
 if row.kind='message' then
 select * into enriched from public.agent_message_context(e,v,array[row.record_id]);
 if enriched.record_id is not null then
 ref:=enriched.ref;kind:=enriched.kind;record_id:=enriched.record_id;version:=enriched.version;body:=enriched.body;state:=enriched.state;source_visibility:=enriched.source_visibility;excerpt:=enriched.excerpt;
 return next;
 end if;
 else
 ref:=row.ref;kind:=row.kind;record_id:=row.record_id;version:=row.version;body:=row.body;state:=row.state;source_visibility:=row.source_visibility;excerpt:=row.excerpt;return next;
 end if;
 end loop;
end $$;
revoke all on function public.search_agent_evidence(uuid,public.visibility,text) from public,anon;
grant execute on function public.search_agent_evidence(uuid,public.visibility,text) to authenticated;
