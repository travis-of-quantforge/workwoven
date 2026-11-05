\set ON_ERROR_STOP on
reset role;
select id as e from public.engagements where title='Reporting dashboard' and creator_id='00000000-0000-0000-0000-000000000001' \gset
select accepted_version_id as version from public.engagements where id=:'e' \gset
select set_config('test.review_e',:'e',false);
select set_config('test.review_version',:'version',false);
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
select public.submit_review(:'e','The client supplied clear examples and reviewed promptly.','{"communication":5,"clarity":5,"collaboration":4,"honouringAgreements":5}') as review \gset
select set_config('test.pro_review',:'review',false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 if exists(select 1 from public.reviews where id=current_setting('test.pro_review')::uuid) then raise exception 'Unpublished review leaked to subject';end if;
 if jsonb_array_length(public.public_profile('00000000-0000-0000-0000-000000000001')->'reviews')<>0 then raise exception 'Unpublished public projection leak';end if;
 begin perform public.approve_scope(current_setting('test.review_version')::uuid);raise exception 'Closed project reactivated';exception when raise_exception then if sqlerrm='Closed project reactivated' then raise;end if;end;
end $$;
select public.approve_portfolio(:'portfolio',true);
select public.submit_review(:'e','The professional communicated well and met the agreed criteria.','{"communication":5,"delivery":5,"collaboration":4,"honouringAgreements":5}') as client_review \gset
select set_config('test.client_review',:'client_review',false);
do $$ begin
 if(select count(*) from public.reviews where engagement_id=current_setting('test.review_e')::uuid)<>2 then raise exception 'Mutual publication failed';end if;
 if jsonb_array_length(public.public_profile('00000000-0000-0000-0000-000000000001')->'reviews')<>1 then raise exception 'Professional written client feedback missing';end if;
 if(public.public_profile('00000000-0000-0000-0000-000000000001')->>'completionCount')::int<>1 then raise exception 'Completion facts incorrect';end if;
 if jsonb_array_length(public.public_profile('00000000-0000-0000-0000-000000000002')->'portfolio')<>1 then raise exception 'Approved portfolio missing';end if;
 begin perform public.submit_review(current_setting('test.review_e')::uuid,'Replace criticism after publication','{"communication":1,"delivery":1,"collaboration":1,"honouringAgreements":1}');raise exception 'Frozen review changed';exception when raise_exception then if sqlerrm='Frozen review changed' then raise;end if;end;
 begin delete from public.reviews where id=current_setting('test.pro_review')::uuid;raise exception 'Subject deleted criticism';exception when insufficient_privilege then null;end;
end $$;
select public.reply_review(:'review','Thanks for the collaboration and detailed review.');
select public.report_review(:'review','Test moderation report for a policy check.');
select public.approve_portfolio(:'portfolio',false);
do $$begin if jsonb_array_length(public.public_profile('00000000-0000-0000-0000-000000000002')->'portfolio')<>0 then raise exception 'Revoked portfolio still public';end if;end $$;
reset role;
set role anon;
do $$declare p jsonb;begin
 p:=public.public_profile('00000000-0000-0000-0000-000000000001');
 if jsonb_array_length(p->'reviews')<>1 or p::text like '%PRIVATE%' or p::text like '%priceCents%' or p::text like '%engagement_id%' then raise exception 'Public projection leakage or missing review';end if;
 if p->'reviews'->0->>'reply' is null then raise exception 'Public right of reply missing';end if;
 begin perform 1 from public.reviews;raise exception 'Anonymous base review access';exception when insufficient_privilege then null;end;
end $$;
reset role;
select public.moderate_review(:'review','hidden','A trusted moderator reviewed this test policy report.');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$begin
 if exists(select 1 from public.reviews) or exists(select 1 from public.review_windows) or exists(select 1 from public.review_reports) then raise exception 'Outsider raw feedback leakage';end if;
 if jsonb_array_length(public.public_profile('00000000-0000-0000-0000-000000000001')->'reviews')<>0 then raise exception 'Moderated review public';end if;
 begin perform public.moderate_review(current_setting('test.pro_review')::uuid,'visible','Unauthorised subject action');raise exception 'User moderation authority';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Deadline publication is enforced in the policy/projection, without requiring a job.
update public.review_moderations set decision='visible' where review_id=:'review';
update public.review_windows set published_at=null,closes_at=now()-interval '1 second' where engagement_id=:'e';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$begin if(select count(*) from public.reviews where engagement_id=current_setting('test.review_e')::uuid)<>2 then raise exception 'Deadline publication invisible';end if;end $$;
reset role;
update public.engagements set is_demo=true where id=:'e';
set role anon;
do $$declare p jsonb;begin p:=public.public_profile('00000000-0000-0000-0000-000000000001');if jsonb_array_length(p->'reviews')<>0 or (p->>'completionCount')::int<>0 or jsonb_array_length(p->'badges')<>0 then raise exception 'Demo activity entered real reputation';end if;end $$;
reset role;
-- Accepted cancelled engagements qualify, and a single review becomes readable
-- when the window closes even if the other party never submits.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select public.create_engagement('Accepted cancelled engagement','client') as eligible \gset
select public.create_invitation(:'eligible','pro@example.test') as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.accept_invitation(:'token');
select public.submit_scope(:'eligible','{"deliverables":"Dashboard","exclusions":"Email","assumptions":"CSV","responsibilities":"Data","acceptanceCriteria":"Totals match","priceCents":10000,"currency":"USD","paymentTerms":"On acceptance","schedule":"Two weeks"}',null) as cancelled_scope \gset
select public.approve_scope(:'cancelled_scope');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select public.approve_scope(:'cancelled_scope');
select public.close_engagement(:'eligible','cancelled',:'cancelled_scope','Business priorities changed after agreement.');
select public.submit_review(:'eligible','The professional helped clarify the work before our cancellation.','{"communication":4,"delivery":3,"collaboration":4,"honouringAgreements":4}') as single_review \gset
select set_config('test.single_review',:'single_review',false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$begin if exists(select 1 from public.reviews where id=current_setting('test.single_review')::uuid) then raise exception 'Single review published prematurely';end if;end $$;
reset role;
update public.review_windows set closes_at=now()-interval '1 second' where engagement_id=:'eligible';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$begin
 if not exists(select 1 from public.reviews where id=current_setting('test.single_review')::uuid) then raise exception 'Expired single review invisible';end if;
 if not exists(select 1 from jsonb_array_elements(public.public_profile('00000000-0000-0000-0000-000000000002')->'reviews') r where r->>'context'='cancelled') then raise exception 'Cancelled review context missing';end if;
 begin perform public.submit_review((select engagement_id from public.reviews where id=current_setting('test.single_review')::uuid),'Late retaliatory feedback after deadline','{"communication":1,"clarity":1,"collaboration":1,"honouringAgreements":1}');raise exception 'Late review allowed';exception when raise_exception then if sqlerrm='Late review allowed' then raise;end if;end;
end $$;
reset role;
