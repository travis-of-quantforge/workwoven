-- Archiving is a personal workspace preference, not a shared status change.
create table public.engagement_archives(
 engagement_id uuid not null,user_id uuid not null,archived_at timestamptz not null default now(),primary key(user_id,engagement_id),
 foreign key(engagement_id,user_id) references public.memberships(engagement_id,user_id) on delete cascade
);
alter table public.engagement_archives enable row level security;
revoke all on public.engagement_archives from public,anon,authenticated;
grant select on public.engagement_archives to authenticated;
grant all on public.engagement_archives to service_role;
create policy personal_engagement_archive on public.engagement_archives for select to authenticated using(user_id=auth.uid() and public.member_role(engagement_id) is not null);
create function public.set_engagement_archived(e uuid,archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();state text;begin
 select status into state from public.engagements where id=e for update;
 if state is null or public.member_role(e) is null then raise exception 'Forbidden';end if;
 if archived is null then raise exception 'Choose archive or restore';end if;
 if archived then
 if state not in('completed','cancelled','archived') then raise exception 'Only completed or cancelled engagements can be archived';end if;
 insert into public.engagement_archives(engagement_id,user_id) values(e,u) on conflict do nothing;
 else delete from public.engagement_archives where engagement_id=e and user_id=u;end if;
end $$;
revoke all on function public.set_engagement_archived(uuid,boolean) from public,anon;
grant execute on function public.set_engagement_archived(uuid,boolean) to authenticated;
