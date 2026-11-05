create table public.attachment_texts (
 attachment_id uuid primary key references public.attachments, content text not null check(length(content)<=50000),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'), complete boolean not null, created_at timestamptz not null default now()
);
create table public.agent_runs (
 id uuid primary key references public.usage_operations, engagement_id uuid not null references public.engagements,
 visibility public.visibility not null, actor_id uuid not null references auth.users,
 pricing_id uuid not null references public.ai_pricing, prompt text not null check(length(prompt) between 1 and 8000),
 request_hash text not null, status text not null default 'running' check(status in('running','succeeded','partial_offered','failed','discarded')),
 result jsonb, output_body text, output_message_id uuid references public.messages,
 question_message_id uuid not null references public.messages,
 failure_code text, created_at timestamptz not null default now(), finished_at timestamptz
);
create index agent_runs_scope on public.agent_runs(engagement_id,visibility,created_at desc);
create function public.store_attachment_text(p text,actor uuid,body text,hash text,is_complete boolean) returns void
language plpgsql security definer set search_path='' as $$
declare a public.attachments;begin
 select * into a from public.attachments where object_path=p and owner_id=actor for update;
 if a.id is null or not exists(select 1 from public.memberships where engagement_id=a.engagement_id and user_id=actor and (a.visibility='shared' or role::text=a.visibility::text)) or a.upload_status<>'ready' or a.mime_type not in('text/plain','text/csv') then raise exception 'Forbidden';end if;
 insert into public.attachment_texts(attachment_id,content,sha256,complete) values(a.id,body,hash,is_complete) on conflict do nothing;
 update public.attachments set extraction_status=case when is_complete then 'ready' else 'partial' end where id=a.id;end $$;
create function public.search_agent_evidence(e uuid,v public.visibility,q text)
returns table(ref text,kind text,record_id uuid,version text,body text,state text,source_visibility public.visibility,excerpt boolean)
language plpgsql stable security definer set search_path='' as $$
declare r public.party_role;begin
 r:=public.member_role(e);if r is null or (v<>'shared' and v::text<>r::text) then raise exception 'Forbidden';end if;
 if length(q)>256 then raise exception 'Search query too long';end if;
 return query
 with terms as(select websearch_to_tsquery('simple',left(coalesce(q,''),256)) term),
 candidates as(
 select 'agreement:'||s.id::text as ref,'agreement'::text as kind,s.id as record_id,s.number::text as version,left(s.content::text,14000) as body,
 case when s.id=g.accepted_version_id then 'agreed' else 'proposed' end as state,
 'shared'::public.visibility as source_visibility,length(s.content::text)>14000 as excerpt,case when s.id=g.accepted_version_id then 100.0 else 50.0 end::real as rank,s.created_at
 from public.scope_versions s join public.engagements g on g.id=s.engagement_id where s.engagement_id=e and (s.id=g.accepted_version_id or s.number=(select max(number) from public.scope_versions where engagement_id=e))
 union all
 select 'message:'||m.id::text,'message',m.id,'1',left(m.body,5000),case when m.kind='agent' then 'agent_advice' else 'discussed' end,
 m.visibility,length(m.body)>5000,ts_rank(to_tsvector('simple',m.body),terms.term),m.created_at
 from public.messages m cross join terms where m.engagement_id=e and (m.visibility='shared' or (v<>'shared' and m.visibility=v)) and (numnode(terms.term)=0 or to_tsvector('simple',m.body)@@terms.term)
 union all
 select 'attachment:'||a.id::text,'attachment',a.id,t.sha256,left(t.content,10000),case when t.complete then 'extracted_text' else 'partial_text' end,
 a.visibility,(not t.complete or length(t.content)>10000),ts_rank(to_tsvector('simple',t.content),terms.term),a.created_at
 from public.attachments a join public.attachment_texts t on t.attachment_id=a.id cross join terms
 where a.engagement_id=e and a.upload_status='ready' and (a.visibility='shared' or (v<>'shared' and a.visibility=v)) and (numnode(terms.term)=0 or to_tsvector('simple',t.content)@@terms.term)
 )select c.ref,c.kind,c.record_id,c.version,c.body,c.state,c.source_visibility,c.excerpt from candidates c order by c.rank desc,c.created_at desc limit 10;
 end $$;
create function public.begin_agent_run(e uuid,v public.visibility,actor uuid,question text,k uuid,budget bigint,price uuid,hash text,per_minute integer default 6,per_day integer default 200) returns uuid
language plpgsql security definer set search_path='' as $$
declare a uuid; op uuid; previous public.agent_runs; m uuid;begin
 if not exists(select 1 from public.memberships where engagement_id=e and user_id=actor and (v='shared' or role::text=v::text)) then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('agent:'||actor::text,0));
 select r.* into previous from public.agent_runs r join public.usage_operations o on o.id=r.id where o.operation_key=k;
 if previous.id is not null then if previous.actor_id<>actor or previous.engagement_id<>e or previous.visibility<>v or previous.request_hash<>hash then raise exception 'Idempotency conflict';end if;return previous.id;end if;
 if (select count(*) from public.agent_runs where actor_id=actor and created_at>now()-interval '1 minute')>=least(greatest(per_minute,1),60) or (select count(*) from public.agent_runs where actor_id=actor and created_at>now()-interval '1 day')>=least(greatest(per_day,1),1000) then raise exception 'AI rate limit reached';end if;
 if not exists(select 1 from public.ai_pricing where id=price and enabled) then raise exception 'Pricing unavailable';end if;
 select id into a from public.agent_accounts where engagement_id=e and visibility=v;
 op:=public.reserve_usage(a,actor,k,budget);
 insert into public.messages(engagement_id,author_id,visibility,body) values(e,actor,v,question) returning id into m;
 insert into public.agent_runs(id,engagement_id,visibility,actor_id,pricing_id,prompt,request_hash,question_message_id) values(op,e,v,actor,price,question,hash,m);
 update public.usage_operations set pricing_snapshot=(select to_jsonb(p)-'enabled' from public.ai_pricing p where id=price) where id=op;
 return op;end $$;
create function public.publish_agent_result(op uuid) returns void
language plpgsql security definer set search_path='' as $$
declare run public.agent_runs; m uuid;begin
 select * into run from public.agent_runs where id=op for update;
 if run.output_message_id is not null then return;end if;
 if run.output_body is null then raise exception 'Agent result unavailable';end if;
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(run.engagement_id,run.actor_id,run.visibility,'agent',left(run.output_body,30000)) returning id into m;
 update public.agent_runs set output_message_id=m,status='succeeded',finished_at=now() where id=op;end $$;
create function public.finish_agent_run(op uuid,payload jsonb,body text,outcome text,failure text default null) returns void
language plpgsql security definer set search_path='' as $$
declare run public.agent_runs; operation public.usage_operations; actual bigint;begin
 select * into operation from public.usage_operations where id=op for update;
 select * into run from public.agent_runs where id=op for update;
 if run.id is null then raise exception 'Agent run unavailable';end if;
 if run.status<>'running' then return;end if;
 if operation.status<>'reserved' then update public.agent_runs set status='failed',failure_code='reservation_expired',finished_at=now() where id=op;return;end if;
 if not exists(select 1 from public.memberships where engagement_id=run.engagement_id and user_id=run.actor_id and (run.visibility='shared' or role::text=run.visibility::text)) then outcome:='internal_error';end if;
 select coalesce(sum(provider_nano),0) into actual from public.usage_metering where operation_id=op;
 if outcome in('success','partial') and (payload is null or jsonb_typeof(payload)<>'object' or body is null or length(body)=0) then raise exception 'Validated agent result required';end if;
 perform public.settle_usage(op,actual,outcome,operation.pricing_snapshot);
 if outcome in('success','partial') then update public.usage_operations set usage_uncertain=false where id=op;end if;
 if outcome='partial' and (select status from public.usage_operations where id=op)='partial_offered' then
 update public.agent_runs set result=payload,output_body=body,status='partial_offered' where id=op;
 elsif outcome='success' and (select final_outcome from public.usage_operations where id=op)='success' then
 update public.agent_runs set result=payload,output_body=body where id=op;perform public.publish_agent_result(op);
 else update public.agent_runs set status='failed',failure_code=coalesce(failure,'operation_failed'),finished_at=now() where id=op;end if;end $$;
create or replace function public.resolve_partial(op_id uuid,keep boolean) returns void
language plpgsql security definer set search_path='' as $$
declare op public.usage_operations;begin
 select * into op from public.usage_operations where id=op_id for update;
 if op.actor_id is distinct from auth.uid() or not coalesce(public.can_read((select engagement_id from public.agent_accounts where id=op.account_id),(select visibility from public.agent_accounts where id=op.account_id)),false) then raise exception 'Forbidden';end if;
 if op.status in('settled','released') then return;end if;
 if op.status<>'partial_offered' then raise exception 'No partial result to resolve';end if;
 if op.expires_at<=now() then keep:=false;end if;
 perform public.settle_usage(op_id,op.provider_nano,case when keep then 'success' else 'provider_error' end,op.pricing_snapshot);
 if exists(select 1 from public.agent_runs where id=op_id) then
 if keep then perform public.publish_agent_result(op_id);else update public.agent_runs set status='discarded',result=null,output_body=null,finished_at=now() where id=op_id;end if;end if;end $$;
create function public.recover_agent_runs() returns integer
language plpgsql security definer set search_path='' as $$
declare count integer;begin
 update public.usage_operations o set usage_uncertain=true from public.agent_runs r where r.id=o.id and r.claimed_at is not null and r.status in('running','partial_offered') and o.expires_at<now() and o.status in('reserved','partial_offered');
 count:=public.recover_usage(100);
 update public.agent_runs r set status=case when r.status='partial_offered' then 'discarded' else 'failed' end,result=null,output_body=null,failure_code='reservation_expired',finished_at=now() from public.usage_operations o where o.id=r.id and r.status in('running','partial_offered') and o.status='released';
 return count;end $$;
alter table public.attachment_texts enable row level security;
alter table public.agent_runs enable row level security;
revoke all on public.attachment_texts,public.agent_runs from anon,authenticated;
grant select on public.attachment_texts,public.agent_runs to authenticated;
create policy attachment_text_read on public.attachment_texts for select to authenticated using(exists(select 1 from public.attachments a where a.id=attachment_id and public.can_read(a.engagement_id,a.visibility)));
create policy agent_run_read on public.agent_runs for select to authenticated using(public.can_read(engagement_id,visibility));
revoke execute on function public.store_attachment_text,public.search_agent_evidence,public.begin_agent_run,public.publish_agent_result,public.finish_agent_run,public.recover_agent_runs from public,anon,authenticated;
grant execute on function public.search_agent_evidence to authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.store_attachment_text,public.begin_agent_run,public.finish_agent_run,public.recover_agent_runs to service_role;end if;end $$;
alter table public.agent_runs add column claimed_at timestamptz;
create function public.claim_agent_run(op uuid) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 update public.agent_runs set claimed_at=now() where id=op and status='running' and claimed_at is null;
 return found;end $$;
revoke execute on function public.claim_agent_run from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.claim_agent_run to service_role;end if;end $$;

create function public.agent_metering_price_check() returns trigger language plpgsql set search_path='' as $$ begin
 if exists(select 1 from public.agent_runs where id=new.operation_id and pricing_id<>new.pricing_id) then raise exception 'Agent pricing snapshot mismatch';end if;return new;end $$;
create trigger agent_metering_price_check before insert on public.usage_metering for each row execute function public.agent_metering_price_check();
revoke execute on function public.agent_metering_price_check from public,anon,authenticated;

create function public.mark_usage_uncertain(op uuid,response_id text default null) returns void
language plpgsql security definer set search_path='' as $$ begin
 update public.usage_operations o set usage_uncertain=true,unconfirmed_response_ids=case when response_id is not null and length(response_id)<=200 and not(response_id=any(unconfirmed_response_ids)) then array_append(unconfirmed_response_ids,response_id) else unconfirmed_response_ids end where o.id=op and exists(select 1 from public.agent_runs r where r.id=op and r.status='running');end $$;
revoke execute on function public.mark_usage_uncertain from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.mark_usage_uncertain to service_role;end if;end $$;
