-- Keep current source/finding freshness rules; prior assessments are advisory
-- continuity, not new evidence or a reason to charge for unchanged context.
alter function public.prepare_conversation_review(uuid) rename to prepare_conversation_review_without_history;
revoke all on function public.prepare_conversation_review_without_history(uuid) from public,anon,authenticated,service_role;
create function public.prepare_conversation_review(j uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;job public.message_assessments;history jsonb;begin
 snapshot:=public.prepare_conversation_review_without_history(j);
 if snapshot is null then return null;end if;
 select * into job from public.message_assessments where id=j;
 select coalesce(jsonb_agg(entry order by completed desc),'[]') into history from(
 select jsonb_build_object('id',prior.id,'messageId',coalesce(prior.retry_message_id,prior.message_id),'assessedAt',prior.finished_at,'status',prior.status,'summary',left(prior.result->>'summary',2000)) entry,prior.finished_at completed
 from public.message_assessments prior join public.messages source on source.id=prior.message_id
 where prior.engagement_id=job.engagement_id and prior.id<>j and source.engagement_id=job.engagement_id and source.visibility='shared'
 and prior.status in('checked','flagged') and prior.result->>'summary' is not null and prior.finished_at is not null
 order by prior.finished_at desc,prior.id desc limit 5
 ) recent;
 snapshot:=snapshot||jsonb_build_object('priorAssessments',history);
 update public.message_assessments set review_snapshot=snapshot where id=j and status='queued';
 return snapshot;
end $$;
revoke all on function public.prepare_conversation_review(uuid) from public,anon,authenticated;
grant execute on function public.prepare_conversation_review(uuid) to service_role;
