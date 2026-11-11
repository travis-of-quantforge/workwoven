-- Limits apply when an operation starts, even if a message waited in a durable
-- queue overnight. Using message creation time would undercount old backlog.
alter table public.message_assessments add column claimed_at timestamptz;
update public.message_assessments j set claimed_at=o.created_at from public.usage_operations o where o.id=j.operation_id;
create index assessment_claim_time on public.message_assessments(engagement_id,claimed_at) where operation_id is not null;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.claim_message_assessment(uuid,uuid,bigint)'::regprocedure);
 definition:=replace(definition,'created_at>now()-interval','claimed_at>now()-interval');
 definition:=replace(definition,'status=''running'',operation_id=op,budget_nano=budget','status=''running'',operation_id=op,budget_nano=budget,claimed_at=now()');
 execute definition;
end $$;
