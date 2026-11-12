-- Commit one message and all of its uploads atomically. Pending uploads remain
-- uploader-only until this transaction succeeds.
create function public.confirm_attachments_with_message(paths text[],b text,parent uuid default null,mentions uuid[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();a public.attachments;first_file public.attachments;m uuid;existing uuid;ready_count int:=0;file_count int:=0;total_bytes bigint:=0;caption text;begin
 if paths is null or cardinality(paths) not between 1 and 10 or exists(select 1 from unnest(paths)p where p is null)
 or (select count(distinct p) from unnest(paths)p)<>cardinality(paths) then raise exception 'Choose between 1 and 10 files';end if;
 if b is null or length(b)>30000 then raise exception 'Invalid message';end if;
 for a in select * from public.attachments where object_path=any(paths) order by object_path for update loop
 file_count:=file_count+1;
 if first_file.id is null then first_file:=a;end if;
 if a.owner_id<>u or a.engagement_id<>first_file.engagement_id or a.visibility<>first_file.visibility
 or a.delivery_task_id is not null or not coalesce(public.can_read(a.engagement_id,a.visibility),false)
 or not exists(select 1 from storage.objects where bucket_id='engagement-files' and name=a.object_path)
 then raise exception 'Uploaded object unavailable';end if;
 total_bytes:=total_bytes+a.size_bytes;
 if a.upload_status='ready' then
 ready_count:=ready_count+1;
 if a.source_message_id is null or (existing is not null and existing<>a.source_message_id) then raise exception 'Upload message conflict';end if;
 existing:=a.source_message_id;
 end if;
 end loop;
 if file_count<>cardinality(paths) then raise exception 'Uploaded object unavailable';end if;
 if total_bytes>20971520 then raise exception 'Files must total 20 MB or less';end if;
 if ready_count>0 then
 if ready_count<>file_count then raise exception 'Upload message conflict';end if;
 return existing;
 end if;
 caption:=case when length(btrim(b))>0 then b else 'Attached files: '||(select string_agg(name,', ' order by object_path) from public.attachments where object_path=any(paths)) end;
 m:=public.post_discussion_message(first_file.engagement_id,first_file.visibility,caption,parent,mentions);
 update public.attachments set upload_status='ready',source_message_id=m where object_path=any(paths);
 return m;
end $$;
revoke all on function public.confirm_attachments_with_message(text[],text,uuid,uuid[]) from public,anon;
grant execute on function public.confirm_attachments_with_message(text[],text,uuid,uuid[]) to authenticated;
