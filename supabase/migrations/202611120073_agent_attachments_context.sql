-- Commit one message and all of its uploads atomically. Pending uploads remain
-- uploader-only until this transaction succeeds.
create function public.confirm_agent_attachments(paths text[],b text) returns uuid
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
 if not exists(select 1 from public.messages where id=existing and channel='agent') then raise exception 'Upload message conflict';end if;
 return existing;
 end if;
 caption:=case when length(btrim(b))>0 then b else 'Attached files: '||(select string_agg(name,', ' order by object_path) from public.attachments where object_path=any(paths)) end;
 perform public.require_open_engagement(first_file.engagement_id);
 insert into public.messages(engagement_id,author_id,visibility,body,channel) values(first_file.engagement_id,u,first_file.visibility,caption,'agent') returning id into m;
 update public.attachments set upload_status='ready',source_message_id=m where object_path=any(paths);
 return m;
end $$;
revoke all on function public.confirm_agent_attachments(text[],text) from public,anon;
grant execute on function public.confirm_agent_attachments(text[],text) to authenticated;

-- Broad chat questions must not rely solely on keyword matches. Visibility is
-- enforced here even when called through a privileged server path.
create function public.agent_chat_context(e uuid,v public.visibility,focus uuid default null)
returns table(ref text,kind text,record_id uuid,version text,body text,state text,source_visibility public.visibility,excerpt boolean)
language plpgsql stable security definer set search_path='' as $$
declare r public.party_role;begin
 perform public.require_verified();r:=public.member_role(e);
 if r is null or v is null or (v<>'shared' and v::text<>r::text) then raise exception 'Forbidden';end if;
 return query select x->>'ref',split_part(x->>'ref',':',1),split_part(x->>'ref',':',2)::uuid,x->>'version',left(x->>'body',14000),x->>'state','shared'::public.visibility,length(x->>'body')>14000
 from jsonb_array_elements(public.shared_review_sources(e)) x
 where split_part(x->>'ref',':',1) in('agreement','contract','milestone','payment','refund')
 order by case when x->>'state'='agreed' then 0 else 1 end,x->>'date' desc nulls last limit 30;
 return query select 'attachment:'||a.id,'attachment'::text,a.id,coalesce(t.sha256,'unavailable'),
 'File: '||a.name||E'\n'||case when t.attachment_id is not null and a.extraction_status in('ready','partial') then left(t.content,10000) else 'Contents unavailable: no readable extracted text. Do not infer contents from its filename.' end,
 case when t.attachment_id is null or a.extraction_status not in('ready','partial') then 'unavailable_text' when t.complete then 'extracted_text' else 'partial_text' end,
 a.visibility,t.attachment_id is null or not coalesce(t.complete,false) or length(t.content)>10000
 from public.attachments a left join public.attachment_texts t on t.attachment_id=a.id
 join public.messages m on m.id=a.source_message_id and m.engagement_id=e and m.visibility=a.visibility
 where a.engagement_id=e and (a.visibility='shared' or (v<>'shared' and a.visibility=v)) and a.upload_status='ready'
 order by (a.source_message_id=focus) desc nulls last,a.created_at desc,a.id desc limit 30;
 return query select 'message:'||m.id,'message'::text,m.id,'1'::text,'Sent: '||m.created_at||'; role: '||coalesce((select role::text from public.memberships where engagement_id=e and user_id=m.author_id),'system')||E'\n'||left(m.body,5000),
 case when m.kind='agent' then 'agent_advice' else 'discussed' end,m.visibility,length(m.body)>5000
 from public.discussion_messages m where m.id in (
 (select id from public.discussion_messages where engagement_id=e and channel='discussion' and (visibility='shared' or (v<>'shared' and visibility=v)) order by created_at desc,id desc limit 30)
 union all
 (select id from public.messages where engagement_id=e and channel='agent' and (visibility='shared' or (v<>'shared' and visibility=v)) order by created_at desc,id desc limit 10)
 ) order by m.created_at desc,m.id desc;
end $$;
revoke all on function public.agent_chat_context(uuid,public.visibility,uuid) from public,anon;
grant execute on function public.agent_chat_context(uuid,public.visibility,uuid) to authenticated;
