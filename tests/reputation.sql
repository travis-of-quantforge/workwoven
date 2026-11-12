\set ON_ERROR_STOP on
begin;
reset role;
select id as e from public.engagements where title='Reporting dashboard' and creator_id='00000000-0000-0000-0000-000000000001' \gset
select accepted_version_id as version from public.engagements where id=:'e' \gset
select set_config('test.review_e',:'e',false);
select set_config('test.review_version',:'version',false);
select public.admin_adjust_account_tokens('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',gen_random_uuid(),10000000000,'Reputation fixture project allocations');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.update_profile('Fixture client','Client company','Local test profile only','{Reporting}',true);
select public.create_engagement('Cancelled without accepted scope','client') as cancelled \gset
select public.close_engagement(:'cancelled','cancelled',null,'No agreement was reached.');
select set_config('test.cancelled',:'cancelled',false);
do $$ begin
 if exists(select 1 from public.review_windows where engagement_id=current_setting('test.cancelled')::uuid) then raise exception 'Discussion-only cancellation eligible';end if;
 begin perform public.submit_review(current_setting('test.cancelled')::uuid,'Unqualified reputation attack','{"communication":1,"delivery":1,"collaboration":1,"honouringAgreements":1}');raise exception 'Invitation-only review allowed';exception when raise_exception then if sqlerrm='Invitation-only review allowed' then raise;end if;end;
end $$;
select public.close_engagement(:'e','completed',:'version','The accepted dashboard delivery is complete.');
do $$ begin if exists(select 1 from public.review_windows where engagement_id=current_setting('test.review_e')::uuid) then raise exception 'One-sided completion';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.update_profile('Fixture professional','Consultancy','Local test profile only','{Dashboards}',true);
select public.propose_portfolio(:'e','Public example','A reporting dashboard using an approved public sample.','https://example.test/portfolio') as portfolio \gset
select public.set_portfolio_visibility(:'portfolio',true);
select set_config('test.portfolio',:'portfolio',false);
do $$begin
 if jsonb_array_length(public.public_profile('00000000-0000-0000-0000-000000000002')->'portfolio')<>0 then raise exception 'Portfolio without client permission';end if;
 begin perform public.approve_portfolio(current_setting('test.portfolio')::uuid,true);raise exception 'Professional approved client permission';exception when raise_exception then if sqlerrm='Professional approved client permission' then raise;end if;end;
end $$;
select public.close_engagement(:'e','completed',:'version','Handover is complete.');
-- All engagement interaction is now locked after mutual completion.
do $$declare e uuid:=current_setting('test.review_e')::uuid;begin
 if (select status from public.engagements where id=e)<>'completed' then raise exception 'Mutual completion missing';end if;
 if not exists(select 1 from public.review_windows where engagement_id=e) then raise exception 'Historic review window missing';end if;
 begin perform public.submit_review(e,'The client supplied clear examples and reviewed promptly.','{"communication":5,"clarity":5,"collaboration":4,"honouringAgreements":5}');raise exception 'Closed review allowed';exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
 begin perform public.send_message(e,'shared','A late message');raise exception 'Closed shared message allowed';exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
 begin perform public.send_message(e,'professional','A private late message');raise exception 'Closed private message allowed';exception when raise_exception then if sqlerrm not like '%read-only%' then raise;end if;end;
 begin perform public.approve_portfolio(current_setting('test.portfolio')::uuid,true);raise exception 'Closed portfolio change allowed';exception when raise_exception then if sqlerrm not like '%read-only%' and sqlerrm<>'Only the client can approve portfolio publication' then raise;end if;end;
 begin perform public.approve_scope(current_setting('test.review_version')::uuid);raise exception 'Closed project reactivated';exception when raise_exception then if sqlerrm='Closed project reactivated' then raise;end if;end;
 if not exists(select 1 from public.messages where engagement_id=e and body like 'Completion confirmation recorded.%') then raise exception 'Final closure entry missing';end if;
end $$;
reset role;
set role anon;
do $$declare p jsonb;begin
 p:=public.public_profile('00000000-0000-0000-0000-000000000001');
 if p::text like '%PRIVATE%' or p::text like '%priceCents%' or p::text like '%engagement_id%' then raise exception 'Public projection leakage';end if;
 begin perform 1 from public.reviews;raise exception 'Anonymous base review access';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
