-- A broad drafting request must not depend on model-selected keyword matches.
-- Prior milestone requests/refusals cannot crowd out the actual human brief.
create function public.milestone_agent_context(e uuid)
returns table(ref text,kind text,record_id uuid,version text,body text,state text,source_visibility public.visibility,excerpt boolean)
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.require_verified();begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 return query with candidates as (
  select 'agreement:'||s.id::text as ref,'agreement'::text as kind,s.id as record_id,s.number::text as version,
   left(s.content::text,14000) as body,case when s.id=g.accepted_version_id then 'agreed' else 'proposed' end as state,
   'shared'::public.visibility as source_visibility,length(s.content::text)>14000 as excerpt,
   case when s.id=g.accepted_version_id then 100 else 90 end as priority,s.created_at
  from public.scope_versions s join public.engagements g on g.id=s.engagement_id
  where s.engagement_id=e and (s.id=g.accepted_version_id or s.number=(select max(number) from public.scope_versions where engagement_id=e))
  union all
  select 'message:'||m.id::text,'message',m.id,'1',left(m.body,5000),'discussed',m.visibility,length(m.body)>5000,80,m.created_at
  from public.messages m where m.engagement_id=e and m.visibility='shared' and m.channel='discussion' and m.kind in ('human','share')
  union all
  select 'attachment:'||a.id::text,'attachment',a.id,t.sha256,left(t.content,10000),
   case when t.complete then 'extracted_text' else 'partial_text' end,a.visibility,not t.complete or length(t.content)>10000,70,a.created_at
  from public.attachments a join public.attachment_texts t on t.attachment_id=a.id
  where a.engagement_id=e and a.visibility='shared' and a.upload_status='ready'
 ) select c.ref,c.kind,c.record_id,c.version,c.body,c.state,c.source_visibility,c.excerpt
 from candidates c order by c.priority desc,c.created_at desc,c.record_id desc limit 20;
end $$;
revoke all on function public.milestone_agent_context(uuid) from public,anon;
grant execute on function public.milestone_agent_context(uuid) to authenticated;
