-- Keep previews bounded before they leave Postgres; RLS remains in force.
create function public.file_previews(e uuid,v public.visibility) returns table(attachment_id uuid,content text) language plpgsql stable set search_path='' as $$begin
 if not coalesce(public.can_read(e,v),false) then raise exception 'Forbidden';end if;
 return query select a.id,left(t.content,2000) from public.attachments a join public.attachment_texts t on t.attachment_id=a.id where a.engagement_id=e and a.visibility=v and a.upload_status='ready' order by a.created_at desc limit 1000;
 end $$;
revoke execute on function public.file_previews from public,anon;
grant execute on function public.file_previews to authenticated;
