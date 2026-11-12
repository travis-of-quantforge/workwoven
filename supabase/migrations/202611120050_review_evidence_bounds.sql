-- Bound database retrieval as well as model input; preserve explicit coverage gaps.
create or replace function public.shared_review_sources(e uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(source order by source->>'ref'),'[]'::jsonb) from (
 select jsonb_build_object('ref','message:'||m.id,'version','1','body',m.body,'date',m.created_at,'state','discussed','role',(select role from public.memberships where engagement_id=m.engagement_id and user_id=m.author_id)) source
 from (select * from public.messages where engagement_id=e and visibility='shared' and channel='discussion' and kind in('human','share') order by created_at desc,id desc limit 2001) m
 union all select jsonb_build_object('ref',x->>'ref','version',x->>'version','body',x->>'body','state','agreed') from jsonb_array_elements(public.accepted_monitor_terms(e)) x
 union all select jsonb_build_object('ref','contract:'||v.id,'version',v.number::text,'body',v.body,'date',v.created_at,'state','proposed')
 from public.engagement_contracts c join public.contract_versions v on v.id=c.latest_version_id where c.engagement_id=e and v.id is distinct from c.accepted_version_id
 union all select jsonb_build_object('ref','milestone:'||v.id,'version',v.number::text,'body',jsonb_build_object('description',t.title,'acceptanceCriteria',t.acceptance_criteria,'responsibilities',v.responsibilities,'amountCents',t.amount_cents,'date',t.end_date)::text,'date',(select created_at from public.scope_versions where id=v.scope_version_id),'state','proposed')
 from public.milestones m join public.milestone_versions v on v.id=m.latest_version_id join public.milestone_tasks t on t.id=v.task_id where m.engagement_id=e and v.id is distinct from m.accepted_version_id
 union all select jsonb_build_object('ref','attachment:'||a.id,'version',t.sha256,'body',t.content,'date',a.created_at,'state',case when t.complete then 'extracted_text' else 'partial_text' end)
 from (select * from public.attachments where engagement_id=e and visibility='shared' and upload_status='ready' order by created_at desc,id desc limit 101) a join public.attachment_texts t on t.attachment_id=a.id where a.engagement_id=e and a.visibility='shared' and a.upload_status='ready' and a.extraction_status in('ready','partial')
 union all select jsonb_build_object('ref','payment:'||p.id,'version',p.updated_at::text,'body',jsonb_build_object('amountCents',p.amount_cents,'currency',p.currency,'status',p.status,'providerConfirmed',p.capture_id is not null and p.status='completed','environment',p.environment)::text,'date',p.updated_at,'state','payment_record') from (select * from public.payment_transactions where engagement_id=e order by updated_at desc,id desc limit 101) p
 union all select jsonb_build_object('ref','refund:'||r.id,'version',r.updated_at::text,'body',jsonb_build_object('amountCents',r.amount_cents,'status',r.status,'providerConfirmed',r.provider_refund_id is not null and r.status='completed')::text,'date',r.updated_at,'state','refund_record') from (select * from public.payment_refunds where engagement_id=e order by updated_at desc,id desc limit 101) r

 union all select jsonb_build_object('ref','meta:coverage','version','1','body','Some shared attachment content or older payment history is unavailable in this bounded review.','state','incomplete')
 where exists(select 1 from public.attachments where engagement_id=e and visibility='shared' and upload_status='ready' and extraction_status<>'ready')
 or (select count(*) from public.attachments where engagement_id=e and visibility='shared' and upload_status='ready')>100
 or (select count(*) from public.payment_transactions where engagement_id=e)>100
 or (select count(*) from public.payment_refunds where engagement_id=e)>100
 ) s;
$$;
create or replace function public.prepare_conversation_review(j uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.message_assessments;s jsonb;item jsonb;selected jsonb:='[]';used integer:=0;messages integer:=0;complete boolean:=true;findings jsonb;begin
 select * into job from public.message_assessments where id=j;
 if job.id is null or job.status<>'queued' or job.review_version<>1 then return null;end if;
 perform 1 from public.engagements where id=job.engagement_id for update;
 select * into job from public.message_assessments where id=j for update;
 if job.status<>'queued' then return null;end if;
 s:=public.shared_review_sources(job.engagement_id);
 for item in select value from jsonb_array_elements(s) order by case when value->>'state'='agreed' then 0 when value->>'ref' like 'message:%' then 2 else 1 end,value->>'date' desc nulls last loop
 if item->>'state'='incomplete' or item->>'state'='partial_text' then complete:=false;end if;
 if item->>'ref' like 'message:%' then messages:=messages+1;end if;
 if used+octet_length(item::text)>256000 or messages>2000 then complete:=false;continue;end if;
 selected:=selected||jsonb_build_array(item);used:=used+octet_length(item::text);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(f) order by updated_at desc),'[]') into findings from public.conversation_findings f where engagement_id=job.engagement_id;
 if jsonb_array_length(findings)>100 then raise exception 'Review finding capacity reached';end if;
 update public.message_assessments set context_hash=public.review_context_hash(job.engagement_id),review_snapshot=jsonb_build_object('sources',selected,'findings',findings,'complete',complete,'requested',requested,'requestText',review_prompt),terms=public.accepted_monitor_terms(job.engagement_id) where id=j returning review_snapshot into s;
 return s;
end $$;

-- Current availability for stored evidence; never expose a deleted/private
-- source through a historical quotation simply because it was once shared.
create function public.conversation_evidence_availability(e uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare refs jsonb;result jsonb:='{}';c jsonb;available boolean;begin
 perform public.require_verified();if public.member_role(e) is null then raise exception 'Forbidden';end if;
 select coalesce(jsonb_agg(c),'[]') into refs from public.conversation_findings f cross join lateral jsonb_array_elements(f.evidence||f.resolution_evidence) c where f.engagement_id=e;
 for c in select value from jsonb_array_elements(refs) loop
 available:=false;
 if c->>'ref' like 'message:%' then select exists(select 1 from public.messages where engagement_id=e and visibility='shared' and 'message:'||id=c->>'ref' and c->>'version'='1' and strpos(body,c->>'quote')>0) into available;
 elsif c->>'ref' like 'attachment:%' then select exists(select 1 from public.attachments a join public.attachment_texts t on t.attachment_id=a.id where a.engagement_id=e and a.visibility='shared' and a.upload_status='ready' and 'attachment:'||a.id=c->>'ref' and t.sha256=c->>'version' and strpos(t.content,c->>'quote')>0) into available;
 elsif c->>'ref' like 'contract:%' then select exists(select 1 from public.contract_versions where engagement_id=e and 'contract:'||id=c->>'ref' and number::text=c->>'version') into available;
 elsif c->>'ref' like 'milestone:%' then select exists(select 1 from public.milestone_versions v join public.milestones m on m.id=v.milestone_id where m.engagement_id=e and 'milestone:'||v.id=c->>'ref' and v.number::text=c->>'version') into available;
 elsif c->>'ref' like 'agreement:%' then select exists(select 1 from public.scope_versions where engagement_id=e and 'agreement:'||id=c->>'ref' and number::text=c->>'version') into available;
 elsif c->>'ref' like 'payment:%' then select exists(select 1 from public.payment_transactions where engagement_id=e and 'payment:'||id=c->>'ref') into available;
 elsif c->>'ref' like 'refund:%' then select exists(select 1 from public.payment_refunds where engagement_id=e and 'refund:'||id=c->>'ref') into available;
 end if;
 result:=result||jsonb_build_object((c->>'ref')||'@'||(c->>'version'),available);
 end loop;return result;
end $$;
revoke all on function public.conversation_evidence_availability(uuid) from public,anon;
grant execute on function public.conversation_evidence_availability(uuid) to authenticated;
