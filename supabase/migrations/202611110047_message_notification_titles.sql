-- Shared identity and engagement title only: never message excerpts, private
-- activity, email addresses or private profile fields.
create function public.message_notification_title(e uuid, source_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(nullif(btrim(p.display_name),''),case member.role when 'client' then 'The client' else 'The professional' end)
 ||' sent a message in '||g.title
 from public.messages msg
 join public.engagements g on g.id=msg.engagement_id
 join public.memberships member on member.engagement_id=g.id and member.user_id=msg.author_id
 left join public.profiles p on p.id=msg.author_id
 where msg.id=source_id and msg.engagement_id=e and msg.visibility='shared'
 and msg.channel='discussion' and msg.kind in('human','share');
$$;
revoke all on function public.message_notification_title(uuid,uuid) from public,anon,authenticated;

create function public.set_message_notification_title() returns trigger
language plpgsql security definer set search_path='' as $$begin
 new.title:=coalesce(public.message_notification_title(new.engagement_id,new.record_id),
   new.title,'Update in '||(select title from public.engagements where id=new.engagement_id));
 return new;
end $$;
revoke all on function public.set_message_notification_title() from public,anon,authenticated;
create trigger message_notification_title before insert on public.notifications
for each row when(new.kind in('message','reply','mention')) execute function public.set_message_notification_title();

update public.notifications n set title=coalesce(
 public.message_notification_title(n.engagement_id,n.record_id),'Update in '||g.title)
from public.engagements g where g.id=n.engagement_id and n.kind in('message','reply','mention') and n.title is null;
