-- A delivery can upload one new file alongside its existing shared selections.
-- Its operation UUID also identifies the upload, making interrupted retries safe.
alter table public.attachments add column delivery_task_id uuid references public.milestone_tasks;
alter table public.attachments add column upload_sha256 text check(upload_sha256 is null or upload_sha256~'^[a-f0-9]{64}$');

create function public.register_delivery_upload(t uuid,k uuid,n text,mime text,bytes bigint,hash text) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();task public.milestone_tasks;a public.attachments;p text;begin
 select * into task from public.milestone_tasks where id=t for update;
 if task.id is null or public.member_role(task.engagement_id) is distinct from 'professional'::public.party_role then raise exception 'Only the professional can submit delivery';end if;
 if k is null or n is null or length(n) not between 1 and 200 or mime is null or mime not in('text/plain','text/csv','application/pdf','image/png','image/jpeg')
 or bytes is null or bytes not between 1 and 20971520 or hash is null or hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid delivery upload';end if;
 select * into a from public.attachments where id=k for update;
 if a.id is not null then
 if a.owner_id<>u or a.engagement_id<>task.engagement_id or a.visibility<>'shared' or a.delivery_task_id is distinct from t
 or a.name<>n or a.mime_type<>mime or a.size_bytes<>bytes or a.upload_sha256 is distinct from hash then raise exception 'Idempotency conflict';end if;
 return a.object_path;end if;
 perform 1 from public.engagements where id=task.engagement_id and status='active' for update;
 if not found or not public.is_current_milestone_task(t) then raise exception 'Delivery requires the current accepted milestone';end if;
 if exists(select 1 from public.delivery_submissions s join public.delivery_reviews r on r.submission_id=s.id where s.task_id=t and r.decision='accepted') then raise exception 'This milestone delivery is already accepted';end if;
 p:=task.engagement_id::text||'/'||k::text;
 insert into public.attachments(id,engagement_id,owner_id,visibility,name,object_path,mime_type,size_bytes,delivery_task_id,upload_sha256)
 values(k,task.engagement_id,u,'shared',n,p,mime,bytes,t,hash);
 return p;
end $$;

create function public.submit_delivery_with_upload(t uuid,b text,links text[],files uuid[],k uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();task public.milestone_tasks;a public.attachments;s uuid;msg uuid;all_files uuid[];begin
 select * into task from public.milestone_tasks where id=t for update;
 if task.id is null or public.member_role(task.engagement_id) is distinct from 'professional'::public.party_role then raise exception 'Only the professional can submit delivery';end if;
 if files is null or cardinality(files)>10 then raise exception 'Invalid delivery links or files';end if;
 select * into a from public.attachments where id=k for update;
 if a.id is null or a.owner_id<>u or a.engagement_id<>task.engagement_id or a.delivery_task_id is distinct from t or a.visibility<>'shared' then raise exception 'Uploaded object unavailable';end if;
 all_files:=array(select distinct unnest(files||array[a.id]));
 if exists(select 1 from public.delivery_submissions where operation_key=k) then
 return public.submit_delivery(t,b,links,all_files,k);end if;
 if not exists(select 1 from storage.objects where bucket_id='engagement-files' and name=a.object_path) then raise exception 'Uploaded object unavailable';end if;
 -- No other party can see this state unless the whole submission commits.
 update public.attachments set upload_status='ready' where id=a.id;
 s:=public.submit_delivery(t,b,links,all_files,k);
 insert into public.messages(engagement_id,author_id,visibility,kind,body)
 values(task.engagement_id,u,'shared','system','File attached to delivery: '||a.name) returning id into msg;
 update public.attachments set source_message_id=msg where id=a.id;
 return s;
end $$;
revoke all on function public.register_delivery_upload(uuid,uuid,text,text,bigint,text),public.submit_delivery_with_upload(uuid,text,text[],uuid[],uuid) from public,anon;
grant execute on function public.register_delivery_upload(uuid,uuid,text,text,bigint,text),public.submit_delivery_with_upload(uuid,text,text[],uuid[],uuid) to authenticated;
