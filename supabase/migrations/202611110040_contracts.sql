create table public.engagement_contracts (
 engagement_id uuid primary key references public.engagements,
 initial_body text not null check(length(initial_body) between 20 and 20000),
 template_key text not null, latest_version_id uuid, accepted_version_id uuid
);
create table public.contract_versions (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagement_contracts(engagement_id),
 number integer not null, body text not null check(length(body) between 20 and 20000),
 author_id uuid not null references auth.users, operation_key uuid not null unique, created_at timestamptz not null default now(),
 unique(engagement_id,number)
);
alter table public.engagement_contracts add foreign key(latest_version_id) references public.contract_versions;
alter table public.engagement_contracts add foreign key(accepted_version_id) references public.contract_versions;
create table public.contract_approvals (
 version_id uuid not null references public.contract_versions, role public.party_role not null,
 user_id uuid not null references auth.users, created_at timestamptz not null default now(),primary key(version_id,role),unique(version_id,user_id)
);
do $$declare t text;begin foreach t in array array['engagement_contracts','contract_versions','contract_approvals'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;end $$;
create policy contract_member on public.engagement_contracts for select to authenticated using(public.member_role(engagement_id) is not null);
create policy contract_version_member on public.contract_versions for select to authenticated using(public.member_role(engagement_id) is not null);
create policy contract_approval_member on public.contract_approvals for select to authenticated using(exists(select 1 from public.contract_versions v where v.id=version_id));
create function public.freeze_contract_record() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Contract versions and approvals are immutable';end $$;
create trigger freeze_contract_version before update on public.contract_versions for each row execute function public.freeze_contract_record();
create trigger freeze_contract_approval before update on public.contract_approvals for each row execute function public.freeze_contract_record();
revoke update,delete,truncate on public.contract_versions,public.contract_approvals from service_role;
revoke all on function public.freeze_contract_record() from public,anon,authenticated;

create function public.create_engagement_with_contract(p_title text,body text,template text) returns uuid language plpgsql security definer set search_path='' as $$
declare e uuid;begin
 if body is null or length(btrim(body)) not between 20 and 20000 or template not in('general','support','custom') then raise exception 'Invalid contract draft';end if;
 e:=public.create_engagement(p_title);
 insert into public.engagement_contracts(engagement_id,initial_body,template_key) values(e,btrim(body),template);
 return e;end $$;
create function public.propose_contract(e uuid,body text,expected uuid,k uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();c public.engagement_contracts;v public.contract_versions;n integer;begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=e and status in('discussion','active') for update;if not found then raise exception 'Engagement is closed';end if;
 if body is null or length(btrim(body)) not between 20 and 20000 or k is null then raise exception 'Invalid contract draft';end if;
 select * into v from public.contract_versions where operation_key=k;
 if v.id is not null then if v.engagement_id<>e or v.author_id<>u or v.body<>btrim(body) then raise exception 'Idempotency conflict';end if;return v.id;end if;
 select * into c from public.engagement_contracts where engagement_id=e for update;
 if c.engagement_id is null then insert into public.engagement_contracts(engagement_id,initial_body,template_key) values(e,btrim(body),'custom') returning * into c;end if;
 if c.latest_version_id is distinct from expected then raise exception 'Stale contract version; refresh before submitting';end if;
 select coalesce(max(number),0)+1 into n from public.contract_versions where engagement_id=e;
 insert into public.contract_versions(engagement_id,number,body,author_id,operation_key) values(e,n,btrim(body),u,k) returning * into v;
 update public.engagement_contracts set latest_version_id=v.id where engagement_id=e;
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(e,u,'shared','system','Contract version '||n||' proposed. Review and approve it in the Contract tab.');
 return v.id;end $$;
create function public.approve_contract(v uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();ver public.contract_versions;c public.engagement_contracts;r public.party_role;begin
 select * into ver from public.contract_versions where id=v;r:=public.member_role(ver.engagement_id);
 if ver.id is null or r is null then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=ver.engagement_id and status in('discussion','active') for update;if not found then raise exception 'Engagement is closed';end if;
 select * into c from public.engagement_contracts where engagement_id=ver.engagement_id for update;
 if c.latest_version_id is distinct from v then raise exception 'Stale contract version; refresh before approving';end if;
 if(select count(distinct user_id) from public.memberships where engagement_id=ver.engagement_id)<>2 then raise exception 'Both parties must join before contract approval';end if;
 insert into public.contract_approvals(version_id,role,user_id) values(v,r,u) on conflict do nothing;
 if(select count(*) from public.contract_approvals where version_id=v)=2 and c.accepted_version_id is distinct from v then
 update public.engagement_contracts set accepted_version_id=v where engagement_id=ver.engagement_id;
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(ver.engagement_id,u,'shared','system','Contract version '||ver.number||' accepted by both parties.');
 end if;end $$;
revoke all on function public.create_engagement_with_contract(text,text,text),public.propose_contract(uuid,text,uuid,uuid),public.approve_contract(uuid) from public,anon;
grant execute on function public.create_engagement_with_contract(text,text,text),public.propose_contract(uuid,text,uuid,uuid),public.approve_contract(uuid) to authenticated;
