-- A repeated old citation is not new resolution evidence. An approved proposal
-- may retain its source ID/version, so recognise a transition to agreed state.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.finish_conversation_review_without_notices(uuid,jsonb)'::regprocedure);
 definition:=replace(definition,' if row.id is null then'||chr(10)||' insert into public.conversation_findings',
 $patch$ if row.id is not null and issue->>'status'='resolved' then
 if not exists(
 select 1 from jsonb_array_elements(issue->'resolutionReferences') n
 where not exists(select 1 from jsonb_array_elements(row.evidence||row.resolution_evidence) old where old->>'ref'=n->>'ref' and old->>'version'=n->>'version')
 or (exists(select 1 from jsonb_array_elements(job.review_snapshot->'sources') current_source where current_source->>'ref'=n->>'ref' and current_source->>'version'=n->>'version' and current_source->>'state'='agreed')
 and exists(select 1 from public.message_assessments previous_job cross join lateral jsonb_array_elements(previous_job.review_snapshot->'sources') previous_source where previous_job.id=row.assessment_id and previous_source->>'ref'=n->>'ref' and previous_source->>'version'=n->>'version' and previous_source->>'state'='proposed'))
 ) then raise exception 'New resolution evidence required';end if;
 end if;
 if row.id is null then
 insert into public.conversation_findings$patch$);
 execute definition;
end $$;
