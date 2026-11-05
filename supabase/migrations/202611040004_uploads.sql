alter table public.attachments add column upload_status text not null default 'pending' check(upload_status in ('pending','ready'));
update public.attachments a set upload_status='ready' where exists(select 1 from storage.objects o where o.bucket_id='engagement-files' and o.name=a.object_path);
create function public.confirm_attachment(p text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); begin
 update public.attachments a set upload_status='ready' where a.object_path=p and a.owner_id=u and public.can_read(a.engagement_id,a.visibility) and exists(select 1 from storage.objects o where o.bucket_id='engagement-files' and o.name=p);
 if not found then raise exception 'Uploaded object unavailable'; end if; end $$;
create function public.abort_attachment(p text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); begin
 delete from public.attachments a where a.object_path=p and a.owner_id=u and a.upload_status='pending' and not exists(select 1 from storage.objects o where o.bucket_id='engagement-files' and o.name=p);
 end $$;
revoke execute on function public.confirm_attachment,public.abort_attachment from public,anon,authenticated;
grant execute on function public.confirm_attachment,public.abort_attachment to authenticated;
