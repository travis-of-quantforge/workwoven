-- Discussion has one-level threads. A warning about a reply belongs alongside
-- that reply under the root; its assessment still cites the exact source ID.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.finish_message_assessment(uuid,jsonb)'::regprocedure);
 definition:=replace(definition,'source.id,''discussion'') returning id into msg;',
 'coalesce(source.reply_to,source.id),''discussion'') returning id into msg;');
 execute definition;
end $$;
-- Repair only thread metadata on any early notices; keep text/IDs/timestamps.
update public.messages notice set reply_to=coalesce(source.reply_to,source.id)
from public.message_assessments job join public.messages source on source.id=job.message_id
where notice.id=job.notice_message_id and notice.kind='agent' and notice.visibility='shared'
 and source.visibility='shared' and notice.engagement_id=source.engagement_id
 and notice.reply_to is distinct from coalesce(source.reply_to,source.id);
