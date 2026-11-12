-- Reuse the actual result as well as the shared context identity; no new model call or charge.
create or replace function public.claim_message_assessment(j uuid,price uuid,budget bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare job public.message_assessments;begin
 select * into job from public.message_assessments where id=j;
 perform 1 from public.engagements where id=job.engagement_id for update;
 if job.status<>'queued' then return null;end if;
 if job.review_version=1 then
 if exists(select 1 from public.message_assessments where engagement_id=job.engagement_id and status='running') then return null;end if;
 if job.context_hash is null or job.context_hash<>public.review_context_hash(job.engagement_id) then return null;end if;
 if exists(select 1 from public.message_assessments where engagement_id=job.engagement_id and status in('checked','flagged') and context_hash=job.context_hash) then
 update public.message_assessments set status='checked',reason='unchanged_context',result=(select prior.result from public.message_assessments prior where prior.engagement_id=job.engagement_id and prior.context_hash=job.context_hash and prior.id<>j and prior.status in('checked','flagged') and prior.result is not null order by prior.finished_at desc nulls last limit 1),finished_at=now() where id=j;return null;end if;
 -- Coalesce only older automatic queued jobs. Manual requests retain their trigger.
 update public.message_assessments set status='skipped',reason='coalesced',finished_at=now() where engagement_id=job.engagement_id and status='queued' and id<>j and not requested and created_at<=job.created_at;
 end if;
 return public.claim_message_assessment_legacy(j,price,budget);
end $$;
-- Existing quiet cache hits should display the prior assessment too.
update public.message_assessments current set result=(
 select prior.result from public.message_assessments prior
 where prior.engagement_id=current.engagement_id and prior.context_hash=current.context_hash
 and prior.id<>current.id and prior.status in('checked','flagged') and prior.result is not null
 order by prior.finished_at desc nulls last limit 1
) where current.status='checked' and current.reason='unchanged_context' and current.result is null;
