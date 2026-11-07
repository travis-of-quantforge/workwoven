-- A selected file is private to its uploader until the message is committed.
drop policy attachments_scope on public.attachments;
create policy attachments_scope on public.attachments for select to authenticated
using(public.can_read(engagement_id,visibility) and (upload_status='ready' or owner_id=auth.uid()));

drop policy files_read on storage.objects;
create policy files_read on storage.objects for select to authenticated
using(bucket_id='engagement-files' and exists(
 select 1 from public.attachments a where a.object_path=storage.objects.name
 and public.can_read(a.engagement_id,a.visibility)
 and (a.upload_status='ready' or a.owner_id=auth.uid())
));
create policy files_remove_pending on storage.objects for delete to authenticated
using(bucket_id='engagement-files' and exists(
 select 1 from public.attachments a where a.object_path=storage.objects.name
 and a.owner_id=auth.uid() and a.upload_status='pending'
 and public.can_read(a.engagement_id,a.visibility)
));
