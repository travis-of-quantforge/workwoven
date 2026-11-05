-- Replies stay inside the source engagement and visibility; private activity never
-- generates counterparty notifications or shared unread indicators.
create index messages_engagement_visibility_created on public.messages(engagement_id,visibility,created_at);
create table public.message_mentions (
 message_id uuid not null references public.messages, user_id uuid not null references auth.users,
 primary key(message_id,user_id)
);
create table public.discussion_reads (
 engagement_id uuid not null references public.engagements, user_id uuid not null references auth.users,
 last_read_at timestamptz not null, primary key(engagement_id,user_id)
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references auth.users,
 engagement_id uuid not null references public.engagements,
 kind text not null check(kind in ('message','mention','reply','approval','agreement_accepted','invitation_accepted')),
 record_id uuid not null, created_at timestamptz not null default now(), seen_at timestamptz
);
create index notifications_recipient_created on public.notifications(recipient_id,created_at desc);
alter table public.message_mentions enable row level security;
alter table public.discussion_reads enable row level security;
alter table public.notifications enable row level security;
revoke all on public.message_mentions,public.discussion_reads,public.notifications from anon,authenticated;
grant select on public.message_mentions,public.discussion_reads,public.notifications to authenticated;
create policy mentions_visible on public.message_mentions for select to authenticated using(exists(select 1 from public.messages m where m.id=message_id and public.can_read(m.engagement_id,m.visibility)));
create policy reads_owner on public.discussion_reads for select to authenticated using(user_id=auth.uid() and public.member_role(engagement_id) is not null);
create policy notifications_owner on public.notifications for select to authenticated using(recipient_id=auth.uid() and public.member_role(engagement_id) is not null);
-- Preserve the original RPC signature for existing clients, delegating to one implementation.
create function public.post_discussion_message(e uuid,v public.visibility,b text,parent uuid default null,mentions uuid[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); m uuid; recipient uuid; begin
 if not coalesce(public.can_read(e,v),false) then raise exception 'Forbidden'; end if;
 if parent is not null and not exists(select 1 from public.messages where id=parent and engagement_id=e and visibility=v and reply_to is null) then raise exception 'Reply must reference a visible root message in this context'; end if;
 if exists(select 1 from unnest(mentions) target where target is null or not exists(select 1 from public.memberships where engagement_id=e and user_id=target and (v='shared' or user_id=u))) then raise exception 'Mention must reference an authorised party in this context'; end if;
 insert into public.messages(engagement_id,author_id,visibility,body,reply_to) values(e,u,v,b,parent) returning id into m;
 insert into public.message_mentions select m,target from (select distinct unnest(mentions) target) x;
 if v='shared' then
 for recipient in select user_id from public.memberships where engagement_id=e and user_id<>u loop
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(recipient,e,
 case when recipient=any(mentions) then 'mention' when parent is not null then 'reply' else 'message' end,m);
 end loop; end if;
 return m; end $$;
create or replace function public.send_message(e uuid,v public.visibility,b text) returns uuid
language sql security definer set search_path='' as $$ select public.post_discussion_message(e,v,b) $$;
create function public.mark_discussion_read(e uuid,last_message uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); cutoff timestamptz; begin
 if public.member_role(e) is null then raise exception 'Forbidden'; end if;
 select created_at into cutoff from public.messages where id=last_message and engagement_id=e and visibility='shared';
 if cutoff is null then raise exception 'Shared message unavailable'; end if;
 insert into public.discussion_reads values(e,u,cutoff) on conflict(engagement_id,user_id) do update set last_read_at=greatest(public.discussion_reads.last_read_at,excluded.last_read_at);
 end $$;
create function public.mark_notification_seen(n uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 update public.notifications set seen_at=coalesce(seen_at,now()) where id=n and recipient_id=public.require_verified() and public.member_role(engagement_id) is not null;
 end $$;
create function public.notify_approval() returns trigger
language plpgsql security definer set search_path='' as $$
declare e uuid; begin
 select engagement_id into e from public.scope_versions where id=new.version_id;
 insert into public.notifications(recipient_id,engagement_id,kind,record_id)
 select user_id,e,'approval',new.version_id from public.memberships where engagement_id=e and user_id<>new.user_id;
 return new; end $$;
create trigger approval_notification after insert on public.approvals for each row execute function public.notify_approval();
create function public.notify_engagement_event() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if new.accepted_version_id is distinct from old.accepted_version_id and new.accepted_version_id is not null then
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,new.id,'agreement_accepted',new.accepted_version_id from public.memberships where engagement_id=new.id;
 end if; return new; end $$;
create trigger accepted_notification after update on public.engagements for each row execute function public.notify_engagement_event();
create function public.notify_invitation_accepted() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if old.accepted_at is null and new.accepted_at is not null then
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,new.engagement_id,'invitation_accepted',new.id from public.memberships where engagement_id=new.engagement_id and user_id<>new.accepted_by;
 end if; return new; end $$;
create trigger invitation_notification after update on public.invitations for each row execute function public.notify_invitation_accepted();
revoke execute on function public.post_discussion_message,public.mark_discussion_read,public.mark_notification_seen,public.notify_approval,public.notify_engagement_event,public.notify_invitation_accepted from public,anon,authenticated;
grant execute on function public.post_discussion_message,public.mark_discussion_read,public.mark_notification_seen to authenticated;
