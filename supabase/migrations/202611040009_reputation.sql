-- Public reputation is a deliberately selected projection, never a public join
-- onto confidential engagement records. Demo activity is explicitly excluded.
alter table public.engagements add column is_demo boolean not null default false;
alter table public.profiles add column skills text[] not null default '{}';
alter table public.profiles add column updated_at timestamptz not null default now();
create table public.completion_approvals (
 engagement_id uuid references public.engagements, version_id uuid references public.scope_versions,
 user_id uuid not null references auth.users, role public.party_role not null, created_at timestamptz not null default now(),
 primary key(engagement_id,version_id,role)
);
create table public.review_windows (
 engagement_id uuid primary key references public.engagements, accepted_version_id uuid not null references public.scope_versions,
 closed_status text not null check(closed_status in('completed','cancelled')),
 opened_at timestamptz not null default now(), closes_at timestamptz not null default now()+interval '14 days', published_at timestamptz
);
create table public.reviews (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.review_windows,
 author_id uuid not null references auth.users, target_id uuid not null references auth.users,
 author_role public.party_role not null, reviewed_role public.party_role not null,
 dimensions jsonb not null, body text not null check(length(trim(body)) between 20 and 5000),
 created_at timestamptz not null default now(), check(author_id<>target_id), check(author_role<>reviewed_role),
 unique(engagement_id,author_id)
);
create table public.review_replies (
 review_id uuid primary key references public.reviews, author_id uuid not null references auth.users,
 body text not null check(length(trim(body)) between 1 and 3000),created_at timestamptz not null default now()
);
create table public.review_reports (
 id uuid primary key default gen_random_uuid(), review_id uuid not null references public.reviews,
 reporter_id uuid not null references auth.users, reason text not null check(length(trim(reason)) between 10 and 3000),
 created_at timestamptz not null default now(),unique(review_id,reporter_id)
);
create table public.review_moderations (
 id uuid primary key default gen_random_uuid(),review_id uuid not null references public.reviews,
 decision text not null check(decision in('visible','hidden')), reason text not null check(length(trim(reason)) between 10 and 3000),
 created_at timestamptz not null default now()
);
create table public.portfolio_items (
 id uuid primary key default gen_random_uuid(),engagement_id uuid not null references public.engagements,
 owner_id uuid not null references auth.users, title text not null check(length(title) between 1 and 160),
 description text not null check(length(description) between 1 and 3000), url text not null check(length(url)<=2000 and url~'^https://[^[:space:][:cntrl:]@]+$'),
 client_approved boolean not null default false,published boolean not null default false, created_at timestamptz not null default now()
);
create table public.badge_definitions (id text primary key,title text not null,criteria text not null);
insert into public.badge_definitions values('mutual_completion','First mutual completion','Both parties formally confirmed completion of at least one non-demo engagement with an accepted agreement. This records platform activity, not identity verification or work quality.');
create table public.badge_awards (user_id uuid references auth.users,badge_id text references public.badge_definitions,engagement_id uuid not null references public.engagements,created_at timestamptz not null default now(),primary key(user_id,badge_id));

create function public.on_engagement_closed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.status in('completed','cancelled') and old.status not in('completed','cancelled','archived') and new.accepted_version_id is not null then
 insert into public.review_windows(engagement_id,accepted_version_id,closed_status) values(new.id,new.accepted_version_id,new.status) on conflict do nothing;
 if new.status='completed' and not new.is_demo then
 insert into public.badge_awards(user_id,badge_id,engagement_id) select user_id,'mutual_completion',new.id from public.memberships where engagement_id=new.id on conflict do nothing;end if;
 end if;return new;end $$;
create trigger engagement_closed after update on public.engagements for each row execute function public.on_engagement_closed();
create function public.close_engagement(e uuid,target text,expected uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); g public.engagements; r public.party_role;begin
 select * into g from public.engagements where id=e for update;r:=public.member_role(e);
 if r is null then raise exception 'Forbidden';end if;
 if target not in('completed','cancelled') or length(trim(coalesce(reason,'')))=0 or length(reason)>3000 then raise exception 'Explain the requested engagement outcome';end if;
 if g.accepted_version_id is distinct from expected then raise exception 'Accepted agreement changed; refresh';end if;
 if g.status=target then return;end if;
 if g.status not in('discussion','active') then raise exception 'Engagement is closed';end if;
 if target='completed' then
 if g.accepted_version_id is null then raise exception 'Completion requires an accepted agreement';end if;
 insert into public.completion_approvals(engagement_id,version_id,user_id,role) values(e,g.accepted_version_id,u,r) on conflict do nothing;
 if(select count(*) from public.completion_approvals where engagement_id=e and version_id=g.accepted_version_id)=2 then update public.engagements set status='completed' where id=e;end if;
 else update public.engagements set status='cancelled' where id=e;end if;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(e,u,'engagement_'||target,e);
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(e,u,'shared','system',case when target='completed' then 'Completion confirmation recorded. Completion requires both parties.' else 'Engagement cancelled. This does not decide a settlement or change recorded payment obligations.' end||' Reason: '||reason);
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,e,'message',e from public.memberships where engagement_id=e and user_id<>u;
 end $$;
-- A closed engagement cannot be reactivated by approving an old pending proposal.
create or replace function public.approve_scope(s uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); e uuid; r public.party_role; latest uuid; g public.engagements;begin
 select engagement_id into e from public.scope_versions where id=s;
 select * into g from public.engagements where id=e for update;
 r:=public.member_role(e);if r is null then raise exception 'Forbidden';end if;
 if g.status not in('discussion','active') then raise exception 'Engagement is closed';end if;
 select id into latest from public.scope_versions where engagement_id=e order by number desc limit 1;
 if latest is distinct from s then raise exception 'Cannot approve a superseded version';end if;
 insert into public.approvals(version_id,user_id,role) values(s,u,r) on conflict do nothing;
 if(select count(*) from public.approvals where version_id=s)=2 then update public.engagements set accepted_version_id=s,status='active' where id=e;end if;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(e,u,'scope_approved',s);end $$;
create function public.review_is_published(e uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.review_windows where engagement_id=e and (published_at is not null or closes_at<=now())) $$;
create function public.submit_review(e uuid,b text,d jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); r public.party_role; other public.memberships; w public.review_windows; prior public.reviews; fields text[]; f text; id uuid;begin
 r:=public.member_role(e);if r is null then raise exception 'Forbidden';end if;
 select * into w from public.review_windows where engagement_id=e for update;
 if w.engagement_id is null then raise exception 'Reviews require a closed engagement with an accepted agreement';end if;
 select * into prior from public.reviews where engagement_id=e and author_id=u;
 if prior.id is not null then if prior.body is distinct from b or prior.dimensions is distinct from d then raise exception 'Submitted feedback is frozen';end if;return prior.id;end if;
 if w.closes_at<=now() then raise exception 'The review submission window has closed';end if;
 select * into other from public.memberships where engagement_id=e and user_id<>u;
 if other.user_id is null then raise exception 'No counterparty to review';end if;
 fields:=case when other.role='client' then array['communication','clarity','collaboration','honouringAgreements'] else array['communication','delivery','collaboration','honouringAgreements'] end;
 if d is null or jsonb_typeof(d)<>'object' or not(d ?& fields) or (select count(*) from jsonb_object_keys(d))<>4 then raise exception 'Invalid feedback dimensions';end if;
 foreach f in array fields loop if jsonb_typeof(d->f)<>'number' or d->>f !~ '^[1-5]$' then raise exception 'Ratings must be integers from 1 to 5';end if;end loop;
 insert into public.reviews(engagement_id,author_id,target_id,author_role,reviewed_role,dimensions,body) values(e,u,other.user_id,r,other.role,d,b) returning reviews.id into id;
 if(select count(*) from public.reviews where engagement_id=e)=2 then update public.review_windows set published_at=now() where engagement_id=e;
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,e,'review_published',e from public.memberships where engagement_id=e;
 end if;return id;end $$;
create function public.reply_review(r uuid,b text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); review public.reviews;begin
 select * into review from public.reviews where id=r;
 if review.target_id is distinct from u or not public.review_is_published(review.engagement_id) then raise exception 'Only the reviewed party can reply after publication';end if;
 insert into public.review_replies values(r,u,b,now()) on conflict do nothing;end $$;
create function public.report_review(r uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); review public.reviews;begin
 select * into review from public.reviews where id=r;
 if review.id is null or not public.review_is_published(review.engagement_id) then raise exception 'Review unavailable';end if;
 if public.member_role(review.engagement_id) is null and not exists(select 1 from public.profiles where id=review.target_id and is_public) then raise exception 'Review unavailable';end if;
 insert into public.review_reports(review_id,reporter_id,reason) values(r,u,reason) on conflict do nothing;end $$;
create function public.moderate_review(r uuid,decision text,reason text) returns void language plpgsql security definer set search_path='' as $$begin
 insert into public.review_moderations(review_id,decision,reason) values(r,decision,reason);end $$;
create function public.update_profile(n text,company text,bio text,skills text[],is_public boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();begin
 if length(trim(coalesce(n,''))) not between 1 and 100 or length(coalesce(company,''))>160 or length(coalesce(bio,''))>3000 or skills is null or cardinality(skills)>20 or exists(select 1 from unnest(skills)s where s is null or length(trim(s)) not between 1 and 80) or is_public is null then raise exception 'Invalid profile';end if;
 insert into public.profiles(id,display_name,company,public_bio,skills,is_public) values(u,trim(n),coalesce(company,''),coalesce(bio,''),skills,is_public) on conflict(id) do update set display_name=excluded.display_name,company=excluded.company,public_bio=excluded.public_bio,skills=excluded.skills,is_public=excluded.is_public,updated_at=now();end $$;
create function public.propose_portfolio(e uuid,t text,b text,url text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); id uuid;begin
 if public.member_role(e) is distinct from 'professional'::public.party_role then raise exception 'Only the professional can propose portfolio publication';end if;
 if not exists(select 1 from public.engagements where engagements.id=e and accepted_version_id is not null) then raise exception 'Portfolio requires an accepted engagement';end if;
 insert into public.portfolio_items(engagement_id,owner_id,title,description,url) values(e,u,t,b,url) returning portfolio_items.id into id;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(e,u,'portfolio_requested',id);return id;end $$;
create function public.set_portfolio_visibility(p uuid,publish boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); item public.portfolio_items;begin
 select * into item from public.portfolio_items where id=p for update;
 if item.owner_id is distinct from u or public.member_role(item.engagement_id) is distinct from 'professional'::public.party_role then raise exception 'Forbidden';end if;
 update public.portfolio_items set published=publish where id=p;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(item.engagement_id,u,'portfolio_visibility',p);end $$;
create function public.approve_portfolio(p uuid,approve boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); item public.portfolio_items;begin
 select * into item from public.portfolio_items where id=p for update;
 if public.member_role(item.engagement_id) is distinct from 'client'::public.party_role then raise exception 'Only the client can approve portfolio publication';end if;
 update public.portfolio_items set client_approved=approve where id=p;
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(item.engagement_id,u,case when approve then 'portfolio_approved' else 'portfolio_revoked' end,p);end $$;

-- Do not grant anonymous access to base profile/review tables.
create function public.public_profile(p uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p,'displayName',pr.display_name,'company',pr.company,'bio',pr.public_bio,'skills',pr.skills,
 'completionCount',(select count(*) from public.memberships m join public.engagements g on g.id=m.engagement_id where m.user_id=p and g.status='completed' and not g.is_demo and g.accepted_version_id is not null),
 'reviews',coalesce((select jsonb_agg(item order by published_at desc) from (select jsonb_build_object('id',r.id,'body',r.body,'dimensions',r.dimensions,'reviewedRole',r.reviewed_role,'authorRole',r.author_role,'authorName',case when ap.is_public then ap.display_name else 'Engagement participant' end,'authorProfileId',case when ap.is_public then ap.id else null end,'context',w.closed_status,'publishedAt',coalesce(w.published_at,w.closes_at),'reply',(select body from public.review_replies where review_id=r.id)) item,coalesce(w.published_at,w.closes_at) published_at
 from public.reviews r join public.review_windows w on w.engagement_id=r.engagement_id join public.engagements g on g.id=r.engagement_id left join public.profiles ap on ap.id=r.author_id where r.target_id=p and not g.is_demo and public.review_is_published(r.engagement_id) and coalesce((select decision from public.review_moderations where review_id=r.id order by created_at desc,id desc limit 1),'visible')='visible' order by coalesce(w.published_at,w.closes_at) desc limit 50) q),'[]'::jsonb),
 'reviewCounts',jsonb_build_object('client',(select count(*) from public.reviews r join public.engagements g on g.id=r.engagement_id where r.target_id=p and r.reviewed_role='client' and not g.is_demo and public.review_is_published(r.engagement_id) and coalesce((select decision from public.review_moderations where review_id=r.id order by created_at desc,id desc limit 1),'visible')='visible'),'professional',(select count(*) from public.reviews r join public.engagements g on g.id=r.engagement_id where r.target_id=p and r.reviewed_role='professional' and not g.is_demo and public.review_is_published(r.engagement_id) and coalesce((select decision from public.review_moderations where review_id=r.id order by created_at desc,id desc limit 1),'visible')='visible')),
 'portfolio',coalesce((select jsonb_agg(jsonb_build_object('title',i.title,'description',i.description,'url',i.url)) from public.portfolio_items i join public.engagements g on g.id=i.engagement_id where i.owner_id=p and i.client_approved and i.published and not g.is_demo),'[]'::jsonb),
 'badges',coalesce((select jsonb_agg(jsonb_build_object('title',d.title,'criteria',d.criteria,'awardedAt',a.created_at)) from public.badge_awards a join public.badge_definitions d on d.id=a.badge_id join public.engagements g on g.id=a.engagement_id where a.user_id=p and not g.is_demo),'[]'::jsonb))
 from public.profiles pr where pr.id=p and pr.is_public $$;

do $$ declare t text;begin foreach t in array array['completion_approvals','review_windows','reviews','review_replies','review_reports','review_moderations','portfolio_items','badge_awards','badge_definitions'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy completion_member on public.completion_approvals for select to authenticated using(public.member_role(engagement_id) is not null);
create policy windows_member on public.review_windows for select to authenticated using(public.member_role(engagement_id) is not null);
create policy reviews_visible on public.reviews for select to authenticated using(author_id=auth.uid() or (public.member_role(engagement_id) is not null and exists(select 1 from public.review_windows w where w.engagement_id=reviews.engagement_id and (w.published_at is not null or w.closes_at<=now()))));
create policy replies_visible on public.review_replies for select to authenticated using(exists(select 1 from public.reviews where id=review_id));
create policy reports_owner on public.review_reports for select to authenticated using(reporter_id=auth.uid());
create policy moderations_member on public.review_moderations for select to authenticated using(exists(select 1 from public.reviews where id=review_id));
create policy portfolio_member on public.portfolio_items for select to authenticated using(public.member_role(engagement_id) is not null);
create policy awards_owner on public.badge_awards for select to authenticated using(user_id=auth.uid());
create policy definitions_read on public.badge_definitions for select to authenticated using(true);
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in('message','mention','reply','approval','agreement_accepted','invitation_accepted','delivery','delivery_review','meeting','meeting_response','review_published'));
revoke execute on function public.on_engagement_closed,public.close_engagement,public.review_is_published,public.submit_review,public.reply_review,public.report_review,public.moderate_review,public.update_profile,public.propose_portfolio,public.set_portfolio_visibility,public.approve_portfolio,public.public_profile from public,anon,authenticated;
grant execute on function public.close_engagement,public.submit_review,public.reply_review,public.report_review,public.update_profile,public.propose_portfolio,public.set_portfolio_visibility,public.approve_portfolio to authenticated;
grant execute on function public.public_profile to anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.moderate_review to service_role;end if;end $$;

revoke execute on function public.review_is_published from public,anon,authenticated;
create function public.party_identities(e uuid) returns table(role public.party_role,display_name text,company text) language plpgsql stable security definer set search_path='' as $$begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 return query select m.role,coalesce(nullif(p.display_name,''),initcap(m.role::text)),coalesce(p.company,'') from public.memberships m left join public.profiles p on p.id=m.user_id where m.engagement_id=e;end $$;
revoke execute on function public.party_identities from public,anon;
grant execute on function public.party_identities to authenticated;
create function public.invitation_open_guard() returns trigger language plpgsql set search_path='' as $$begin
 if not exists(select 1 from public.engagements where id=new.engagement_id and status in('discussion','active') and funding='funded') then raise exception 'Engagement is closed or funding is pending';end if;return new;end $$;
create trigger invitation_open before insert on public.invitations for each row execute function public.invitation_open_guard();
revoke execute on function public.invitation_open_guard from public,anon,authenticated;
create or replace function public.accept_invitation(t text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); i public.invitations; mail text;begin
 select * into i from public.invitations where token_hash=encode(extensions.digest(t,'sha256'),'hex');
 -- Lock engagements before invitations, matching creation/replacement lock order.
 perform 1 from public.engagements where id=i.engagement_id and status in('discussion','active') and funding='funded' for update;
 if not found then raise exception 'Invitation unavailable for this account';end if;
 select * into i from public.invitations inv where inv.id=i.id for update;
 select lower(email) into mail from auth.users where id=u;
 if i.id is null or i.revoked_at is not null or i.accepted_at is not null or i.expires_at<=now() or i.email<>mail then raise exception 'Invitation unavailable for this account';end if;
 insert into public.memberships values(i.engagement_id,u,i.role);
 update public.invitations set accepted_by=u,accepted_at=now() where id=i.id;
 return i.engagement_id;end $$;
