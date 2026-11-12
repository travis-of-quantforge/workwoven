\set ON_ERROR_STOP on
do $$begin
 if has_function_privilege('authenticated','public.invitation_has_account(text)','execute')
 or has_function_privilege('anon','public.invitation_has_account(text)','execute')
 or has_function_privilege('authenticated','public.unverified_invited_user(text)','execute')
 or has_function_privilege('anon','public.unverified_invited_user(text)','execute') then
  raise exception 'Invitation auth lookup must remain service-only';
 end if;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.set_active_role('professional');
select public.create_engagement('Concern and invitation fixture','professional') as engagement \gset
select set_config('test.invite_engagement',:'engagement',false);
select public.create_invitation(:'engagement','client@example.test') as revoked_token \gset
do $$begin
 begin
  perform public.create_invitation(current_setting('test.invite_engagement')::uuid,'another@example.test');
  raise exception 'Second active invitation allowed';
 exception when others then
  if sqlerrm<>'Revoke the pending invitation before creating another' then raise;end if;
 end;
 if (select count(*) from public.invitations where engagement_id=current_setting('test.invite_engagement')::uuid and revoked_at is null)<>1 then raise exception 'Pending invitation was changed';end if;
end $$;
reset role;
select set_config('test.revoked_token',:'revoked_token',false);
select id as invitation from public.invitations where engagement_id=:'engagement' \gset
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.revoke_invitation(:'invitation');
select public.revoke_invitation(:'invitation');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$begin
 begin perform public.accept_invitation(current_setting('test.revoked_token'));raise exception 'Revoked invitation accepted';
 exception when raise_exception then if sqlerrm='Revoked invitation accepted' then raise;end if;end;
end $$;
reset role;
do $$begin
 if public.invitation_has_account(current_setting('test.revoked_token')) then raise exception 'Revoked invitation disclosed account';end if;
 if public.invitation_has_account(repeat('a',64)) then raise exception 'Unknown invitation disclosed account';end if;
end $$;
set role authenticated;
-- A fresh invitation remains possible after revocation.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.create_invitation(:'engagement','client@example.test') as accepted_token \gset
do $$begin
 if exists(select 1 from public.received_invitations() where title='Concern and invitation fixture') then raise exception 'Inviter sees received invitation';end if;
 begin
  perform public.accept_received_invitation((select id from public.invitations where engagement_id=current_setting('test.invite_engagement')::uuid and revoked_at is null));
  raise exception 'Wrong account accepted invitation by ID';
 exception when others then if sqlerrm<>'Invitation unavailable for this account' then raise;end if;end;
end $$;
reset role;
select set_config('test.routing_token',:'accepted_token',false);
do $$begin if not public.invitation_has_account(current_setting('test.routing_token')) then raise exception 'Existing invitee not detected';end if;end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.set_active_role('professional');
do $$declare received uuid;begin
 select id into received from public.received_invitations() where title='Concern and invitation fixture';
 if received is null then raise exception 'Recipient cannot see invitation';end if;
 perform public.accept_received_invitation(received);
 if exists(select 1 from public.received_invitations() where id=received) then raise exception 'Accepted invitation remains pending';end if;
 begin perform public.accept_received_invitation(received);raise exception 'Invitation replay accepted';
 exception when others then if sqlerrm<>'Invitation unavailable for this account' then raise;end if;end;
end $$;
select public.open_concern(:'engagement','Acceptance evidence','The sample CSV totals do not match the proposed dashboard figures.','Compare the source and agree on the correction.',
 '50000000-0000-4000-8000-000000000001') as concern \gset
select public.open_concern(:'engagement','Acceptance evidence','The sample CSV totals do not match the proposed dashboard figures.','Compare the source and agree on the correction.',
 '50000000-0000-4000-8000-000000000001');
select set_config('test.concern',:'concern',false);
select set_config('test.concern_engagement',:'engagement',false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.add_concern_update(:'concern','I will reconcile the totals against the sample CSV before proposing a change.',
 '50000000-0000-4000-8000-000000000002');
select public.add_concern_update(:'concern','I will reconcile the totals against the sample CSV before proposing a change.',
 '50000000-0000-4000-8000-000000000002');
select public.acknowledge_concern(:'concern');
do $$begin
 if (select status from public.concern_cases where id=current_setting('test.concern')::uuid)<>'open'
   then raise exception 'One party resolved the concern';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.acknowledge_concern(:'concern');
do $$begin
 if (select status from public.concern_cases where id=current_setting('test.concern')::uuid)<>'resolved'
   then raise exception 'Mutual resolution missing';end if;
 if (select status from public.engagements where id=current_setting('test.concern_engagement')::uuid)<>'discussion'
   then raise exception 'Concern changed engagement status';end if;
 if (select count(*) from public.concern_updates where case_id=current_setting('test.concern')::uuid)<>1
   then raise exception 'Concern update replay duplicated';end if;
 if not exists(select 1 from public.messages where engagement_id=current_setting('test.concern_engagement')::uuid
   and visibility='shared' and body like '%sample CSV totals%') then raise exception 'Concern absent from shared evidence';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$begin
 if exists(select 1 from public.concern_cases) or exists(select 1 from public.concern_updates)
   then raise exception 'Outsider saw concern';end if;
 begin perform public.add_concern_update(current_setting('test.concern')::uuid,'Intrusion',gen_random_uuid());
   raise exception 'Outsider updated concern';
 exception when raise_exception then if sqlerrm='Outsider updated concern' then raise;end if;end;
end $$;
reset role;
\echo 'Invitation revocation and mutual concern assertions passed'
