-- Legacy whole-set scope approvals cover every task in that scope. Preserve
-- those facts with provenance, but all future decisions are milestone-local.
create table public.milestone_approvals (
 version_id uuid not null references public.milestone_versions,
 user_id uuid not null references auth.users, role public.party_role not null,
 created_at timestamptz not null default now(), source_scope_version_id uuid references public.scope_versions,
 primary key(version_id,role), unique(version_id,user_id)
);
alter table public.milestone_approvals enable row level security;
revoke all on public.milestone_approvals from anon,authenticated;
grant select on public.milestone_approvals to authenticated;
create policy milestone_approval_member on public.milestone_approvals for select to authenticated
using(exists(select 1 from public.milestone_versions v where v.id=version_id));
insert into public.milestone_approvals(version_id,user_id,role,created_at,source_scope_version_id)
select v.id,a.user_id,a.role,a.created_at,v.scope_version_id
from public.milestone_versions v join public.approvals a on a.version_id=v.scope_version_id;

do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.submit_individual_milestones(uuid,jsonb,uuid,uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,'insert into public.approvals(version_id,user_id,role) values(v,u,r);',
 'insert into public.milestone_approvals(version_id,user_id,role) values(v,u,r);');
 execute definition;
 definition:=pg_get_functiondef('public.accept_milestone(uuid)'::regprocedure);
 definition:=replace(definition,'insert into public.approvals(version_id,user_id,role) values(scope_id,u,r)',
 'insert into public.milestone_approvals(version_id,user_id,role) values(v,u,r)');
 definition:=replace(definition,'from public.approvals where version_id=scope_id','from public.milestone_approvals where version_id=v');
 execute definition;
end $$;
