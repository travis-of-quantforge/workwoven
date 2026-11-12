-- File upload provenance supplements shared evidence without changing its text,
-- source IDs or versions, and never imports private message/file records.
alter function public.shared_review_sources(uuid) rename to shared_review_sources_without_file_provenance;
revoke all on function public.shared_review_sources_without_file_provenance(uuid) from public,anon,authenticated,service_role;
create function public.shared_review_sources(e uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(s.source || case when a.id is not null then jsonb_build_object(
 'uploaderRole',member.role,
 'sourceMessageRef',case when message.id is not null then 'message:'||message.id else null end
 ) else '{}'::jsonb end order by s.source->>'ref'),'[]'::jsonb)
 from jsonb_array_elements(public.shared_review_sources_without_file_provenance(e)) s(source)
 left join public.attachments a on s.source->>'ref'='attachment:'||a.id and a.engagement_id=e and a.visibility='shared' and a.upload_status='ready'
 left join public.memberships member on member.engagement_id=e and member.user_id=a.owner_id
 left join public.messages message on message.id=a.source_message_id and message.engagement_id=e and message.visibility='shared';
$$;
revoke all on function public.shared_review_sources(uuid) from public,anon,authenticated;
grant execute on function public.shared_review_sources(uuid) to service_role;
-- Instruction semantics changed too: retries must not reuse an old review just
-- because the underlying messages have not changed. No reviews are auto-run.
create or replace function public.review_context_hash(e uuid) returns text language sql stable security definer set search_path='' as $$
 select md5('relationship-context-v1:'||public.shared_review_sources(e)::text||coalesce((select jsonb_agg(to_jsonb(f) order by id)::text from public.conversation_findings f where engagement_id=e),'[]'));
$$;
