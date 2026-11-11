-- Notify the counterparty only after an approval is actually recorded. Approval
-- and milestone-event uniqueness make retries no-ops, in the same transaction.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in(
 'message','mention','reply','approval','agreement_accepted','invitation_accepted',
 'delivery','delivery_review','meeting','meeting_response','review_published','concern',
 'payment_request','payment_received','payment_sent','refund_received','contract_approval','milestone_approval'));

create function public.notify_contract_approval() returns trigger
language plpgsql security definer set search_path='' as $$
declare ver public.contract_versions;begin
 select * into ver from public.contract_versions where id=new.version_id;
 insert into public.notifications(recipient_id,engagement_id,kind,record_id,title)
 select user_id,ver.engagement_id,'contract_approval',new.version_id,
 initcap(new.role::text)||' approved contract version '||ver.number
 from public.memberships where engagement_id=ver.engagement_id and user_id<>new.user_id;
 return new;
end $$;
revoke all on function public.notify_contract_approval() from public,anon,authenticated;
create trigger contract_approval_notification after insert on public.contract_approvals
for each row execute function public.notify_contract_approval();

-- Reuse the existing milestone event rather than sending a second notification
-- for the approval implicitly recorded when an author submits their proposal.
create or replace function public.milestone_event(v uuid,action text) returns void
language plpgsql security definer set search_path='' as $$
declare m public.milestones;msg uuid;n integer;label text;begin
 select x.* into m from public.milestones x join public.milestone_versions mv on mv.milestone_id=x.id where mv.id=v;
 select number into n from public.milestone_versions where id=v;
 if exists(select 1 from public.milestone_events where version_id=v and event=action) then return;end if;
 select title into label from public.milestone_tasks where id=(select task_id from public.milestone_versions where id=v);
 insert into public.messages(engagement_id,author_id,visibility,kind,body)
 values(m.engagement_id,auth.uid(),'shared','system','Milestone '||action||' · version '||n||': '||label) returning id into msg;
 insert into public.milestone_events values(msg,m.id,v,action);
 insert into public.notifications(recipient_id,engagement_id,kind,record_id,title)
 select user_id,m.engagement_id,case when action='accepted' then 'milestone_approval' else 'approval' end,v,
 initcap(public.member_role(m.engagement_id)::text)||case when action='accepted' then ' approved milestone version ' else ' proposed and approved milestone version ' end||n||': '||label
 from public.memberships where engagement_id=m.engagement_id and user_id<>auth.uid();
 insert into public.audit_events(engagement_id,actor_id,action,record_id) values(m.engagement_id,auth.uid(),'milestone_'||action,v);
end $$;

-- Native milestone acceptance already notifies the other party above. Keep
-- legacy agreement notifications, but do not also notify both people about
-- the internal aggregate snapshot created by native milestone acceptance.
create or replace function public.notify_engagement_event() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if new.accepted_version_id is distinct from old.accepted_version_id and new.accepted_version_id is not null
 and not exists(select 1 from public.scope_versions where id=new.accepted_version_id and content ? 'acceptedMilestones') then
 insert into public.notifications(recipient_id,engagement_id,kind,record_id)
 select user_id,new.id,'agreement_accepted',new.accepted_version_id from public.memberships where engagement_id=new.id;
 end if;return new;end $$;
