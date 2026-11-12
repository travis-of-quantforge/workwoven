-- One consolidated notification per recipient/intervention, including retries.
alter function public.finish_conversation_review(uuid,jsonb) rename to finish_conversation_review_without_notices;
revoke all on function public.finish_conversation_review_without_notices(uuid,jsonb) from service_role;
create function public.finish_conversation_review(j uuid,payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare e uuid;msg uuid;begin
 select engagement_id into e from public.message_assessments where id=j;
 perform 1 from public.engagements where id=e for update;
 perform public.finish_conversation_review_without_notices(j,payload);
 select notice_message_id into msg from public.message_assessments where id=j and status='flagged';
 if msg is not null then
 insert into public.notifications(recipient_id,engagement_id,kind,record_id,title)
 select user_id,e,'message',msg,'Project agent review: '||(select title from public.engagements where id=e)
 from public.memberships m where m.engagement_id=e and not exists(select 1 from public.notifications n where n.recipient_id=m.user_id and n.engagement_id=e and n.kind='message' and n.record_id=msg);
 end if;
end $$;
revoke all on function public.finish_conversation_review(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_conversation_review(uuid,jsonb) to service_role;
-- Pausing automatic monitoring must not disable an explicitly requested review.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.claim_message_assessment_legacy(uuid,uuid,bigint)'::regprocedure);
 definition:=replace(definition,'elsif not coalesce((select enabled from public.scope_monitor_settings where engagement_id=e),true)', 'elsif not job.requested and not coalesce((select enabled from public.scope_monitor_settings where engagement_id=e),true)');
 execute definition;
end $$;
-- Accepted revisions/payment facts can settle a current issue without another
-- human message. Reuse the durable queue and existing recovery/maintenance path.
create function public.queue_changed_review_context() returns trigger language plpgsql security definer set search_path='' as $$
declare e uuid;actor uuid;m uuid;begin
 if tg_table_name='engagements' then e:=new.id;else e:=new.engagement_id;end if;
 if not coalesce((select enabled from public.scope_monitor_settings where engagement_id=e),true) then return new;end if;
 select g.creator_id into actor from public.engagements g where g.id=e and g.status in('discussion','active');
 if actor is null or not exists(select 1 from public.conversation_findings where engagement_id=e and status in('open','awaiting_clarification')) or exists(select 1 from public.message_assessments where engagement_id=e and status='queued') then return new;end if;
 insert into public.messages(engagement_id,author_id,visibility,kind,body,channel) values(e,actor,'shared','system','Review updated shared commitments or payment records.','agent') returning id into m;
 insert into public.message_assessments(engagement_id,message_id,actor_id,terms,status,review_version) values(e,m,actor,public.accepted_monitor_terms(e),'queued',1);
 return new;
end $$;
revoke all on function public.queue_changed_review_context() from public,anon,authenticated;
create trigger review_accepted_contract after update of accepted_version_id on public.engagement_contracts for each row when(old.accepted_version_id is distinct from new.accepted_version_id) execute function public.queue_changed_review_context();
create trigger review_accepted_milestone after update of accepted_version_id on public.milestones for each row when(old.accepted_version_id is distinct from new.accepted_version_id) execute function public.queue_changed_review_context();
create trigger review_accepted_scope after update of accepted_version_id on public.engagements for each row when(old.accepted_version_id is distinct from new.accepted_version_id) execute function public.queue_changed_review_context();
create trigger review_payment_fact after update of status on public.payment_transactions for each row when(old.status is distinct from new.status) execute function public.queue_changed_review_context();
create trigger review_refund_fact after update of status on public.payment_refunds for each row when(old.status is distinct from new.status) execute function public.queue_changed_review_context();
