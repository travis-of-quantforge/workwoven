\set ON_ERROR_STOP on
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.set_active_role('professional');
select public.create_engagement('Concern and invitation fixture','professional') as engagement \gset
select public.create_invitation(:'engagement','client@example.test') as revoked_token \gset
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
-- A fresh invitation remains possible after revocation.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.create_invitation(:'engagement','client@example.test') as accepted_token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.accept_invitation(:'accepted_token');
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
