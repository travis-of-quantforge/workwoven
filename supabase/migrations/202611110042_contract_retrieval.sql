alter function public.search_agent_evidence(uuid,public.visibility,text) rename to search_agent_evidence_without_contract;
revoke execute on function public.search_agent_evidence_without_contract(uuid,public.visibility,text) from public,anon,authenticated;
create function public.search_agent_evidence(e uuid,v public.visibility,q text)
returns table(ref text,kind text,record_id uuid,version text,body text,state text,source_visibility public.visibility,excerpt boolean)
language plpgsql stable security definer set search_path='' as $$
declare r public.party_role;begin
 r:=public.member_role(e);if r is null or(v<>'shared' and v::text<>r::text) then raise exception 'Forbidden';end if;
 return query select 'contract:'||cv.id,'agreement'::text,cv.id,cv.number::text,left(cv.body,14000),
 case when cv.id=c.accepted_version_id then 'agreed' else 'proposed' end,'shared'::public.visibility,length(cv.body)>14000
 from public.engagement_contracts c join public.contract_versions cv on cv.id=c.accepted_version_id or cv.id=c.latest_version_id where c.engagement_id=e;
 return query select * from public.search_agent_evidence_without_contract(e,v,q);
end $$;
revoke all on function public.search_agent_evidence(uuid,public.visibility,text) from public,anon;
grant execute on function public.search_agent_evidence(uuid,public.visibility,text) to authenticated;
