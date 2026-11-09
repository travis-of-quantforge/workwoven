create table public.admin_activity (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users,
 subject_id uuid not null references auth.users,
 engagement_id uuid references public.engagements,
 action text not null check(action in ('verify_email_requested','verify_email_completed','view_shared_conversation','view_private_conversation')),
 created_at timestamptz not null default now()
);
alter table public.admin_activity enable row level security;
revoke all on public.admin_activity from public,anon,authenticated;
grant select,insert on public.admin_activity to service_role;
revoke update,delete on public.admin_activity from service_role;
