create table public.meetings (
 id uuid primary key default gen_random_uuid(), engagement_id uuid not null references public.engagements,
 creator_id uuid not null references auth.users, accepted_version_id uuid,
 status text not null default 'open' check(status in('open','cancelled')), sequence integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.meeting_versions (
 id uuid primary key default gen_random_uuid(), meeting_id uuid not null references public.meetings,
 number integer not null, proposer_id uuid not null references auth.users,
 title text not null check(length(title) between 1 and 200), agenda text not null check(length(agenda) between 1 and 5000),
 starts_at timestamptz not null, ends_at timestamptz not null,
 timezone text not null, meeting_url text, milestone_id uuid references public.milestone_tasks,
 operation_key uuid not null unique, created_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '8 hours'),
 check(meeting_url is null or (length(meeting_url)<=2000 and meeting_url~'^https://[^[:space:][:cntrl:]@]+$')),
 unique(meeting_id,number),unique(meeting_id,id)
);
alter table public.meetings add foreign key(id,accepted_version_id) references public.meeting_versions(meeting_id,id);
create table public.meeting_responses (
 version_id uuid not null references public.meeting_versions, user_id uuid not null references auth.users,
 response text not null check(response in('accepted','declined')), reason text not null default '' check(length(reason)<=3000),
 created_at timestamptz not null default now(), primary key(version_id,user_id)
);
create table public.meeting_notes (
 id uuid primary key default gen_random_uuid(), version_id uuid not null references public.meeting_versions,
 author_id uuid not null references auth.users, body text not null check(length(body) between 1 and 10000),
 operation_key uuid not null unique,created_at timestamptz not null default now()
);
create function public.meeting_event(e uuid,u uuid,m uuid,kind text,b text) returns void language plpgsql security definer set search_path='' as $$begin
 insert into public.messages(engagement_id,author_id,visibility,kind,body) values(e,u,'shared','system',b);
 insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,e,kind,m from public.memberships where engagement_id=e and user_id<>u;
 end $$;
create function public.propose_meeting(e uuid,m uuid,expected uuid,title text,agenda text,starts timestamptz,ends timestamptz,zone text,url text,milestone uuid,k uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); meeting public.meetings; prior public.meeting_versions; latest uuid; n integer; v uuid;begin
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('meeting:'||k::text,0));
 select * into prior from public.meeting_versions where operation_key=k;
 if prior.id is not null then
 if prior.proposer_id<>u or (select engagement_id from public.meetings where id=prior.meeting_id)<>e or (m is not null and prior.meeting_id<>m) or prior.title<>title or prior.agenda<>agenda or prior.starts_at<>starts or prior.ends_at<>ends or prior.timezone<>zone or prior.meeting_url is distinct from nullif(url,'') or prior.milestone_id is distinct from milestone then raise exception 'Idempotency conflict';end if;
 return prior.meeting_id;end if;
 if (select count(*) from public.memberships where engagement_id=e)<>2 then raise exception 'Both parties must join before scheduling';end if;
 if not exists(select 1 from public.engagements where id=e and status in('discussion','active')) then raise exception 'Engagement is closed';end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Invalid IANA timezone';end if;
 if starts<now()-interval '1 minute' or starts>now()+interval '2 years' then raise exception 'Choose a future meeting within two years';end if;
 if milestone is not null and not exists(select 1 from public.milestone_tasks t join public.engagements g on g.id=t.engagement_id where t.id=milestone and t.engagement_id=e and t.version_id=g.accepted_version_id) then raise exception 'Select a current accepted milestone';end if;
 if m is null then
 if expected is not null then raise exception 'Stale meeting version';end if;
 insert into public.meetings(engagement_id,creator_id) values(e,u) returning * into meeting;
 else select * into meeting from public.meetings where id=m and engagement_id=e for update;
 if meeting.id is null or meeting.status<>'open' then raise exception 'Meeting unavailable';end if;end if;
 select id,number into latest,n from public.meeting_versions where meeting_id=meeting.id order by number desc limit 1;
 if latest is distinct from expected then raise exception 'Stale meeting version';end if;
 insert into public.meeting_versions(meeting_id,number,proposer_id,title,agenda,starts_at,ends_at,timezone,meeting_url,milestone_id,operation_key) values(meeting.id,coalesce(n,0)+1,u,title,agenda,starts,ends,zone,nullif(url,''),milestone,k) returning id into v;
 insert into public.meeting_responses(version_id,user_id,response) values(v,u,'accepted');
 update public.meetings set sequence=sequence+1,updated_at=now() where id=meeting.id;
 perform public.meeting_event(e,u,meeting.id,'meeting','Meeting proposed: '||title||'. Review the exact time and agenda in Calendar; it is tentative until both parties accept.');
 return meeting.id;end $$;
create function public.respond_meeting(v uuid,answer text,reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); proposal public.meeting_versions; meeting public.meetings; prior public.meeting_responses; latest uuid;begin
 select * into proposal from public.meeting_versions where id=v;
 select * into meeting from public.meetings where id=proposal.meeting_id for update;
 if public.member_role(meeting.engagement_id) is null then raise exception 'Forbidden';end if;
 select * into prior from public.meeting_responses where version_id=v and user_id=u;
 if prior.version_id is not null then if prior.response<>answer or prior.reason<>reason then raise exception 'Response already recorded; propose another time to revise';end if;return;end if;
 select id into latest from public.meeting_versions where meeting_id=meeting.id order by number desc limit 1;
 if meeting.status<>'open' or latest<>v or proposal.ends_at<now() then raise exception 'Meeting proposal is stale or ended';end if;
 if answer='declined' and length(trim(coalesce(reason,'')))=0 then raise exception 'Explain why this meeting time does not work';end if;
 insert into public.meeting_responses(version_id,user_id,response,reason) values(v,u,answer,reason);
 if(select count(*) from public.meeting_responses where version_id=v and response='accepted')=2 then update public.meetings set accepted_version_id=v where id=meeting.id;end if;
 update public.meetings set sequence=sequence+1,updated_at=now() where id=meeting.id;
 perform public.meeting_event(meeting.engagement_id,u,meeting.id,'meeting_response','Meeting response: '||answer||' — '||proposal.title||'. '||reason);
 end $$;
create function public.cancel_meeting(m uuid,expected uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); meeting public.meetings;begin
 select * into meeting from public.meetings where id=m for update;
 if public.member_role(meeting.engagement_id) is null then raise exception 'Forbidden';end if;
 if meeting.status='cancelled' then return;end if;
 if (select id from public.meeting_versions where meeting_id=m order by number desc limit 1) is distinct from expected then raise exception 'Stale meeting version';end if;
 if length(trim(coalesce(reason,'')))=0 or length(reason)>3000 then raise exception 'Explain the meeting cancellation';end if;
 update public.meetings set status='cancelled',sequence=sequence+1,updated_at=now() where id=m;
 perform public.meeting_event(meeting.engagement_id,u,m,'meeting_response','Meeting cancelled. Reason: '||reason);end $$;
create function public.add_meeting_note(v uuid,b text,k uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); e uuid; n public.meeting_notes;begin
 select m.engagement_id into e from public.meetings m join public.meeting_versions p on p.meeting_id=m.id where p.id=v;
 if public.member_role(e) is null then raise exception 'Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('meeting-note:'||k::text,0));
 select * into n from public.meeting_notes where operation_key=k;
 if n.id is not null then if n.author_id<>u or n.version_id<>v or n.body<>b then raise exception 'Idempotency conflict';end if;return n.id;end if;
 insert into public.meeting_notes(version_id,author_id,body,operation_key) values(v,u,b,k) returning * into n;
 perform public.meeting_event(e,u,(select meeting_id from public.meeting_versions where id=v),'meeting','Meeting notes: '||b||'. Follow-up actions are discussion items; scope changes still require dual approval.');return n.id;end $$;

do $$ declare t text;begin foreach t in array array['meetings','meeting_versions','meeting_responses','meeting_notes'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy meetings_member on public.meetings for select to authenticated using(public.member_role(engagement_id) is not null);
create policy meeting_versions_member on public.meeting_versions for select to authenticated using(exists(select 1 from public.meetings m where m.id=meeting_id));
create policy meeting_responses_member on public.meeting_responses for select to authenticated using(exists(select 1 from public.meeting_versions v where v.id=version_id));
create policy meeting_notes_member on public.meeting_notes for select to authenticated using(exists(select 1 from public.meeting_versions v where v.id=version_id));
revoke execute on function public.meeting_event,public.propose_meeting,public.respond_meeting,public.cancel_meeting,public.add_meeting_note from public,anon,authenticated;
grant execute on function public.propose_meeting,public.respond_meeting,public.cancel_meeting,public.add_meeting_note to authenticated;
