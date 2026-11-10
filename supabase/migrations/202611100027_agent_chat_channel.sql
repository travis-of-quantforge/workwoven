alter table public.messages add column channel text not null default 'discussion'
 check(channel in ('discussion','agent'));
create index messages_channel_history on public.messages(engagement_id,visibility,channel,created_at desc);

create function public.classify_agent_messages() returns trigger
language plpgsql security definer set search_path='' as $$begin
 update public.messages set channel='agent'
 where id in (new.question_message_id,new.output_message_id)
 and engagement_id=new.engagement_id and visibility=new.visibility;
 return new;
end $$;
revoke all on function public.classify_agent_messages() from public,anon,authenticated;
create trigger agent_chat_messages after insert or update of output_message_id on public.agent_runs
for each row execute function public.classify_agent_messages();

-- Preserve message bodies/IDs and their evidence links; classify existing history.
update public.messages m set channel='agent' where exists(
 select 1 from public.agent_runs r where m.id in (r.question_message_id,r.output_message_id)
 and m.engagement_id=r.engagement_id and m.visibility=r.visibility
);

create or replace function public.mark_discussion_read(e uuid,last_message uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); cutoff timestamptz;begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 select created_at into cutoff from public.messages where id=last_message and engagement_id=e and visibility='shared' and channel='discussion';
 if cutoff is null then raise exception 'Shared message unavailable';end if;
 insert into public.discussion_reads values(e,u,cutoff)
 on conflict(engagement_id,user_id) do update
 set last_read_at=greatest(public.discussion_reads.last_read_at,excluded.last_read_at);
 update public.notifications n set seen_at=coalesce(n.seen_at,now())
 where n.recipient_id=u and n.engagement_id=e and n.kind in ('message','mention','reply')
 and exists(select 1 from public.messages m where m.id=n.record_id and m.engagement_id=e and m.visibility='shared' and m.channel='discussion' and m.created_at<=cutoff);
end $$;
