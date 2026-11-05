alter table public.attachments add column source_message_id uuid references public.messages;
create or replace function public.confirm_attachment(p text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); a public.attachments; m uuid;begin
 select * into a from public.attachments where object_path=p for update;
 if a.id is null or a.owner_id<>u or not coalesce(public.can_read(a.engagement_id,a.visibility),false) or not exists(select 1 from storage.objects where bucket_id='engagement-files' and name=p) then raise exception 'Uploaded object unavailable';end if;
 if a.source_message_id is not null then return;end if;
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(a.engagement_id,u,a.visibility,'system','File attached: '||a.name||'. This is casual file sharing, not a formal delivery submission.') returning id into m;
 update public.attachments set upload_status='ready',source_message_id=m where id=a.id;
 if a.visibility='shared' then
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,a.engagement_id,'message',m from public.memberships where engagement_id=a.engagement_id and user_id<>u;end if;
 end $$;
