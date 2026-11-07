-- A ready discussion attachment belongs to the human message sent with it.
create function public.confirm_attachment_with_message(
 p text, b text, parent uuid default null, mentions uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); a public.attachments; m uuid; begin
 select * into a from public.attachments where object_path=p for update;
 if a.id is null or a.owner_id<>u or not coalesce(public.can_read(a.engagement_id,a.visibility),false)
   or not exists(select 1 from storage.objects where bucket_id='engagement-files' and name=p)
 then raise exception 'Uploaded object unavailable'; end if;
 if a.upload_status='ready' then return a.source_message_id; end if;
 if length(btrim(b))<1 or length(b)>30000 then raise exception 'Message required with attachment'; end if;
 m:=public.post_discussion_message(a.engagement_id,a.visibility,b,parent,mentions);
 update public.attachments set upload_status='ready',source_message_id=m where id=a.id;
 return m;
end $$;
revoke execute on function public.confirm_attachment(text) from authenticated;
revoke execute on function public.confirm_attachment_with_message(text,text,uuid,uuid[]) from public,anon;
grant execute on function public.confirm_attachment_with_message(text,text,uuid,uuid[]) to authenticated;
