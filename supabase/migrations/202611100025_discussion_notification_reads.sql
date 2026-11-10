create or replace function public.mark_discussion_read(e uuid,last_message uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); cutoff timestamptz;begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 select created_at into cutoff from public.messages where id=last_message and engagement_id=e and visibility='shared';
 if cutoff is null then raise exception 'Shared message unavailable';end if;
 insert into public.discussion_reads values(e,u,cutoff)
 on conflict(engagement_id,user_id) do update
 set last_read_at=greatest(public.discussion_reads.last_read_at,excluded.last_read_at);
 update public.notifications n set seen_at=coalesce(n.seen_at,now())
 where n.recipient_id=u and n.engagement_id=e and n.kind in ('message','mention','reply')
 and exists(select 1 from public.messages m where m.id=n.record_id and m.engagement_id=e and m.visibility='shared' and m.created_at<=cutoff);
end $$;

-- Reconcile existing message notices with each recipient's recorded read cursor.
update public.notifications n set seen_at=coalesce(n.seen_at,r.last_read_at)
from public.discussion_reads r,public.messages m
where n.recipient_id=r.user_id and n.engagement_id=r.engagement_id
and n.kind in ('message','mention','reply') and n.record_id=m.id
and m.engagement_id=r.engagement_id and m.visibility='shared' and m.created_at<=r.last_read_at;
