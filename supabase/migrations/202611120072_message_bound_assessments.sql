-- Assessments belong to their source message. Keep historical notice records
-- for audit/old IDs, but omit them from the readable discussion and pagination.
create view public.discussion_messages with(security_invoker=true) as
 select m.* from public.messages m where not exists(
 select 1 from public.message_assessments a where a.engagement_id=m.engagement_id and a.notice_message_id=m.id
 );
create view public.latest_discussion_assessments with(security_invoker=true) as
 select distinct on(a.engagement_id,coalesce(a.retry_message_id,a.message_id)) a.*,coalesce(a.retry_message_id,a.message_id) as source_message_id
 from public.message_assessments a order by a.engagement_id,coalesce(a.retry_message_id,a.message_id),a.created_at desc,a.id desc;
revoke all on public.discussion_messages,public.latest_discussion_assessments from public,anon;
grant select on public.discussion_messages,public.latest_discussion_assessments to authenticated,service_role;

-- Preserve flagging, grounded findings, lifecycle and billing, without inserting
-- a second conversation message containing the same assessment.
do $$declare definition text;old_block text;start_pos integer;end_pos integer;begin
 definition:=pg_get_functiondef('public.finish_conversation_review_without_notices(uuid,jsonb)'::regprocedure);
 old_block:='if body<>'''' then insert into public.messages(engagement_id,author_id,visibility,kind,body,channel) values(job.engagement_id,job.actor_id,''shared'',''agent'',body,''discussion'') returning id into msg;end if;';
 if strpos(definition,old_block)=0 then raise exception 'Review publication block changed';end if;
 definition:=replace(definition,old_block,'/* Details are attached to the source assessment, not posted again. */');
 definition:=replace(definition,'case when msg is null then ''checked'' else ''flagged'' end','case when body='''' then ''checked'' else ''flagged'' end');
 execute definition;
 definition:=pg_get_functiondef('public.finish_message_assessment(uuid,jsonb)'::regprocedure);
 start_pos:=strpos(definition,'if verdict=''potential_conflict'' then');
 end_pos:=strpos(substr(definition,start_pos),'update public.message_assessments set status=case');
 if start_pos=0 or end_pos=0 then raise exception 'Legacy assessment publication block changed';end if;
 old_block:=substr(definition,start_pos,end_pos-1);
 if strpos(definition,old_block)=0 then raise exception 'Legacy assessment publication block changed';end if;
 definition:=replace(definition,old_block,'/* Details are attached to the source assessment, not posted again. */');
 definition:=replace(definition,'case when msg is null then ''checked'' else ''flagged'' end','case when verdict=''potential_conflict'' then ''flagged'' else ''checked'' end');
 execute definition;
end $$;

-- Notifications point to the original message and are idempotent per assessment,
-- including a retry of the same source message, without creating a notice post.
alter table public.notifications add column assessment_id uuid references public.message_assessments;
update public.notifications n set assessment_id=a.id,record_id=coalesce(a.retry_message_id,a.message_id)
 from public.message_assessments a where a.engagement_id=n.engagement_id and a.notice_message_id=n.record_id and n.kind='message';
create unique index one_assessment_notification on public.notifications(recipient_id,assessment_id) where assessment_id is not null;
create or replace function public.finish_conversation_review(j uuid,payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare e uuid;source uuid;begin
 select engagement_id into e from public.message_assessments where id=j;
 perform 1 from public.engagements where id=e for update;
 if not exists(select 1 from public.engagements where id=e and status in('discussion','active')) then perform public.fail_message_assessment(j,'engagement_closed');return;end if;
 perform public.finish_conversation_review_without_notices(j,payload);
 select coalesce(retry_message_id,message_id) into source from public.message_assessments where id=j and status='flagged';
 if source is not null then
 insert into public.notifications(recipient_id,engagement_id,kind,record_id,title,assessment_id)
 select user_id,e,'message',source,'Project agent review: '||(select title from public.engagements where id=e),j from public.memberships where engagement_id=e
 on conflict(recipient_id,assessment_id) where assessment_id is not null do nothing;
 end if;
end $$;

-- An explicitly requested project-agent review answers that question in the
-- project-agent chat, including an unchanged-context cache hit. It never posts
-- the same assessment as a new primary-discussion message.
create function public.reply_to_requested_review() returns trigger language plpgsql security definer set search_path='' as $$
declare source public.messages;reply uuid;body text;issue jsonb;begin
 if new.notice_message_id is not null or new.retry_message_id is not null or not new.requested then return new;end if;
 select * into source from public.messages where id=new.message_id and engagement_id=new.engagement_id and visibility='shared' and channel='agent' and kind='human';
 if source.id is null then return new;end if;
 body:=coalesce(new.result->>'summary','The discussion review is complete.');
 for issue in select value from jsonb_array_elements(coalesce(new.result->'review'->'findings','[]')) loop
 body:=body||E'\n\n'||(issue->>'explanation')||E'\n'||(issue->>'nextStep');
 end loop;
 insert into public.messages(engagement_id,author_id,visibility,kind,body,reply_to,channel) values(new.engagement_id,new.actor_id,'shared','agent',left(body,30000),source.id,'agent') returning id into reply;
 update public.message_assessments set notice_message_id=reply where id=new.id;
 return new;
end $$;
revoke all on function public.reply_to_requested_review() from public,anon,authenticated;
create trigger requested_review_reply after update of status on public.message_assessments for each row when(new.status in('checked','flagged') and old.status not in('checked','flagged')) execute function public.reply_to_requested_review();

create or replace function public.set_message_notification_title() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.assessment_id is not null then return new;end if;
 new.title:=coalesce(public.message_notification_title(new.engagement_id,new.record_id),new.title,'Update in '||(select title from public.engagements where id=new.engagement_id));
 return new;
end $$;
