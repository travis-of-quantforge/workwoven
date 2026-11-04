create extension if not exists pgcrypto;
create type public.party_role as enum ('client','professional');
create type public.visibility as enum ('shared','client','professional');
create table public.profiles (
 id uuid primary key references auth.users on delete cascade,
 display_name text not null default '', company text not null default '',
 public_bio text not null default '', is_public boolean not null default false
);
create table public.engagements (
 id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users,
 title text not null check(length(title) between 1 and 160),
 status text not null default 'discussion' check(status in ('discussion','active','completed','cancelled','archived')),
 funding text not null check(funding in ('pending','funded')),
 accepted_version_id uuid, created_at timestamptz not null default now()
);
create table public.memberships (
 engagement_id uuid references public.engagements on delete cascade,
 user_id uuid references auth.users, role public.party_role not null,
 primary key(engagement_id,role), unique(engagement_id,user_id)
);
create table public.agent_accounts (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 visibility public.visibility not null, available_nano bigint not null default 0 check(available_nano>=0),
 reserved_nano bigint not null default 0 check(reserved_nano>=0), unique(engagement_id,visibility)
);
create table public.credit_ledger (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.agent_accounts,
 kind text not null, amount_nano bigint not null, operation_key text not null unique,
 source text not null check(source in ('promotional','purchased','usage')), created_at timestamptz not null default now()
);
create table public.starter_grants (
 user_id uuid primary key references auth.users, engagement_id uuid not null unique references public.engagements,
 created_at timestamptz not null default now()
);
create table public.agent_configs (
 engagement_id uuid references public.engagements, visibility public.visibility,
 instructions_version integer not null default 1, primary key(engagement_id,visibility)
);
create table public.messages (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 author_id uuid not null references auth.users, visibility public.visibility not null,
 kind text not null default 'human' check(kind in ('human','agent','system','share')),
 body text not null check(length(body) between 1 and 30000),
 reply_to uuid references public.messages, created_at timestamptz not null default now()
);
create table public.attachments (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 owner_id uuid not null references auth.users, visibility public.visibility not null,
 name text not null, object_path text not null unique, mime_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 20971520),
 extraction_status text not null default 'not_processed', created_at timestamptz not null default now()
);
create table public.scope_versions (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 author_id uuid not null references auth.users, number integer not null, supersedes uuid references public.scope_versions,
 content jsonb not null, created_at timestamptz not null default now(), unique(engagement_id,number)
);
alter table public.engagements add constraint accepted_scope_fk foreign key(accepted_version_id) references public.scope_versions;
create table public.approvals (
 version_id uuid references public.scope_versions, user_id uuid references auth.users, role public.party_role not null,
 created_at timestamptz not null default now(), primary key(version_id,role), unique(version_id,user_id)
);
create table public.invitations (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 email text not null, role public.party_role not null, token_hash text not null unique,
 expires_at timestamptz not null default now()+interval '7 days', revoked_at timestamptz,
 accepted_by uuid references auth.users, accepted_at timestamptz
);
create table public.share_events (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 actor_id uuid not null references auth.users, shared_message_id uuid not null references public.messages,
 created_at timestamptz not null default now()
);
create table public.audit_events (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 actor_id uuid references auth.users, action text not null, record_id uuid, created_at timestamptz not null default now()
);
-- Permission predicates do not accept a caller-supplied identity.
create function public.member_role(e uuid) returns public.party_role
language sql stable security definer set search_path='' as $$
 select role from public.memberships where engagement_id=e and user_id=auth.uid()
$$;
create function public.can_read(e uuid,v public.visibility) returns boolean
language sql stable security definer set search_path='' as $$
 select public.member_role(e) is not null and (v='shared' or v::text=public.member_role(e)::text)
$$;
create function public.require_verified() returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); begin
 if u is null or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then
 raise exception 'Verified account required'; end if; return u; end $$;
create function public.create_engagement(p_title text,p_role public.party_role) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); e uuid; a uuid; eligible boolean; begin
 perform 1 from auth.users where id=u for update;
 eligible:=not exists(select 1 from public.starter_grants where user_id=u);
 insert into public.engagements(creator_id,title,funding) values(u,trim(p_title),case when eligible then 'funded' else 'pending' end) returning id into e;
 insert into public.memberships values(e,u,p_role);
 insert into public.agent_accounts(engagement_id,visibility) select e,v from unnest(enum_range(null::public.visibility)) v;
 insert into public.agent_configs(engagement_id,visibility) select e,v from unnest(enum_range(null::public.visibility)) v;
 if eligible then
 insert into public.starter_grants(user_id,engagement_id) values(u,e);
 update public.agent_accounts set available_nano=5000000000 where engagement_id=e and visibility='shared' returning id into a;
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source) values(a,'grant',5000000000,'starter:'||u,'promotional');
 end if; return e; end $$;
create function public.send_message(e uuid,v public.visibility,b text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); m uuid; begin
 if not coalesce(public.can_read(e,v),false) then raise exception 'Forbidden'; end if;
 insert into public.messages(engagement_id,author_id,visibility,body) values(e,u,v,b) returning id into m; return m; end $$;
create function public.share_content(e uuid,b text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); m uuid; begin
 if public.member_role(e) is null then raise exception 'Forbidden'; end if;
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(e,u,'shared','share',b) returning id into m;
 insert into public.share_events(engagement_id,actor_id,shared_message_id) values(e,u,m); return m; end $$;
create function public.submit_scope(e uuid,c jsonb,expected uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); latest uuid; n integer; s uuid; begin
 if public.member_role(e) is null then raise exception 'Forbidden'; end if;
 perform 1 from public.engagements where id=e for update;
 select id,number into latest,n from public.scope_versions where engagement_id=e order by number desc limit 1;
 if latest is distinct from expected then raise exception 'Stale version; refresh before submitting'; end if;
 if jsonb_typeof(c)<>'object' or not(c ?& array['deliverables','exclusions','assumptions','responsibilities','acceptanceCriteria','priceCents','currency','paymentTerms','schedule']) or c->>'currency'<>'USD' or (c->>'priceCents')::bigint<0 then raise exception 'Invalid scope'; end if;
 insert into public.scope_versions(engagement_id,author_id,number,supersedes,content) values(e,u,coalesce(n,0)+1,latest,c) returning id into s;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(e,u,'scope_submitted',s); return s; end $$;
create function public.approve_scope(s uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); e uuid; r public.party_role; latest uuid; begin
 select engagement_id into e from public.scope_versions where id=s;
 perform 1 from public.engagements where id=e for update;
 r:=public.member_role(e); if r is null then raise exception 'Forbidden'; end if;
 select id into latest from public.scope_versions where engagement_id=e order by number desc limit 1;
 if latest is distinct from s then raise exception 'Cannot approve a superseded version'; end if;
 insert into public.approvals(version_id,user_id,role) values(s,u,r) on conflict do nothing;
 if (select count(*) from public.approvals where version_id=s)=2 then
 update public.engagements set accepted_version_id=s,status='active' where id=e;
 end if;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(e,u,'scope_approved',s); end $$;
create function public.create_invitation(e uuid,target_email text) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); r public.party_role; t text:=encode(extensions.gen_random_bytes(32),'hex'); begin
 perform 1 from public.engagements where id=e and funding='funded' for update;
 if not found then raise exception 'Funding required'; end if;
 r:=public.member_role(e); if r is null then raise exception 'Forbidden'; end if;
 r:=case when r='client' then 'professional'::public.party_role else 'client'::public.party_role end;
 if exists(select 1 from public.memberships where engagement_id=e and role=r) then raise exception 'Party already joined'; end if;
 update public.invitations set revoked_at=now() where engagement_id=e and accepted_at is null and revoked_at is null;
 insert into public.invitations(engagement_id,email,role,token_hash) values(e,lower(trim(target_email)),r,encode(extensions.digest(t,'sha256'),'hex'));
 return t; end $$;
create function public.accept_invitation(t text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); i public.invitations; mail text; begin
 select * into i from public.invitations where token_hash=encode(extensions.digest(t,'sha256'),'hex') for update;
 select lower(email) into mail from auth.users where id=u;
 if i.id is null or i.revoked_at is not null or i.accepted_at is not null or i.expires_at<=now() or i.email<>mail then raise exception 'Invitation unavailable for this account'; end if;
 insert into public.memberships values(i.engagement_id,u,i.role);
 update public.invitations set accepted_by=u,accepted_at=now() where id=i.id;
 return i.engagement_id; end $$;
-- No direct mutation grants: commands above are the only write interface.
do $$ declare t text; begin
 foreach t in array array['profiles','engagements','memberships','agent_accounts','credit_ledger','starter_grants','agent_configs','messages','attachments','scope_versions','approvals','invitations','share_events','audit_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop; end $$;
create policy profiles_own on public.profiles for select to authenticated using(id=auth.uid());
create policy engagements_member on public.engagements for select to authenticated using(public.member_role(id) is not null);
create policy memberships_member on public.memberships for select to authenticated using(public.member_role(engagement_id) is not null);
create policy accounts_scope on public.agent_accounts for select to authenticated using(public.can_read(engagement_id,visibility));
create policy ledger_scope on public.credit_ledger for select to authenticated using(exists(select 1 from public.agent_accounts a where a.id=account_id and public.can_read(a.engagement_id,a.visibility)));
create policy grant_owner on public.starter_grants for select to authenticated using(user_id=auth.uid());
create policy configs_scope on public.agent_configs for select to authenticated using(public.can_read(engagement_id,visibility));
create policy messages_scope on public.messages for select to authenticated using(public.can_read(engagement_id,visibility));
create policy attachments_scope on public.attachments for select to authenticated using(public.can_read(engagement_id,visibility));
create policy scopes_member on public.scope_versions for select to authenticated using(public.member_role(engagement_id) is not null);
create policy approvals_member on public.approvals for select to authenticated using(exists(select 1 from public.scope_versions s where s.id=version_id and public.member_role(s.engagement_id) is not null));
create policy invitations_member on public.invitations for select to authenticated using(public.member_role(engagement_id) is not null);
create policy shares_member on public.share_events for select to authenticated using(public.member_role(engagement_id) is not null);
create policy audit_member on public.audit_events for select to authenticated using(public.member_role(engagement_id) is not null);
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('engagement-files','engagement-files',false,20971520,array['text/plain','text/csv','application/pdf','image/png','image/jpeg']);
create policy files_read on storage.objects for select to authenticated using(bucket_id='engagement-files' and exists(select 1 from public.attachments a where a.object_path=name and public.can_read(a.engagement_id,a.visibility)));
create policy files_upload on storage.objects for insert to authenticated with check(bucket_id='engagement-files' and exists(select 1 from public.attachments a where a.object_path=name and a.owner_id=auth.uid() and public.can_read(a.engagement_id,a.visibility)));
create function public.register_attachment(e uuid,v public.visibility,n text,mime text,bytes bigint) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); p text:=e::text||'/'||gen_random_uuid()::text; begin
 if not coalesce(public.can_read(e,v),false) then raise exception 'Forbidden'; end if;
 if mime not in ('text/plain','text/csv','application/pdf','image/png','image/jpeg') then raise exception 'Unsupported file type'; end if;
 insert into public.attachments(engagement_id,owner_id,visibility,name,object_path,mime_type,size_bytes) values(e,u,v,left(n,200),p,mime,bytes); return p; end $$;
revoke execute on function public.register_attachment from public,anon;
grant execute on function public.register_attachment to authenticated;
alter publication supabase_realtime add table public.messages;
