-- Prompt semantics are part of review freshness. A requested review must not
-- reuse a quiet result from before independent cross-document briefing checks.
create or replace function public.review_context_hash(e uuid) returns text language sql stable security definer set search_path='' as $$
 select md5('relationship-context-v2-independent-brief:'||public.shared_review_sources(e)::text||coalesce((select jsonb_agg(to_jsonb(f) order by id)::text from public.conversation_findings f where engagement_id=e),'[]'));
$$;
