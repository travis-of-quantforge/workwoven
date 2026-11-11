\set ON_ERROR_STOP on
begin;
reset role;
insert into auth.users(id,email,email_confirmed_at) values
('97000000-0000-4000-8000-000000000001','ledger-client@example.test',now()),
('97000000-0000-4000-8000-000000000002','ledger-pro@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
select public.create_engagement('Isolated sandbox ledger fixture','client') as e \gset
select public.create_invitation(:'e','ledger-pro@example.test') as token \gset
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',false);
select public.accept_invitation(:'token');
select public.submit_individual_milestones(:'e','[{"description":"Reporting dashboard","amountCents":10000,"targetDate":"2026-12-20","acceptanceCriteria":"CSV totals reconcile","responsibilities":"Supply data"}]','97000000-0000-4000-8000-000000000010') as versions \gset
select id as m,latest_version_id as v from public.milestones where engagement_id=:'e' \gset
select task_id as task from public.milestone_versions where id=:'v' \gset
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
select public.accept_milestone(:'v');
select public.request_milestone_payment(:'e',:'task','97000000-0000-4000-8000-000000000011') as q \gset
select public.create_adhoc_payment_request(:'e','bonus','Thank you for handover support',1500,'97000000-0000-4000-8000-000000000012') as bonus \gset
select public.create_adhoc_payment_request(:'e','bonus','Thank you for handover support',1500,'97000000-0000-4000-8000-000000000012');
select set_config('test.ledger_e',:'e',false),set_config('test.ledger_q',:'q',false),set_config('test.ledger_m',:'m',false),set_config('test.ledger_v',:'v',false);
do $$begin
 if has_table_privilege('service_role','public.payment_ledger','UPDATE') or has_table_privilege('service_role','public.payment_ledger','DELETE') or has_table_privilege('service_role','public.payment_ledger','TRUNCATE') then raise exception 'Service can rewrite ledger history';end if;
 begin perform public.create_adhoc_payment_request(current_setting('test.ledger_e')::uuid,'hourly','Client invoice',100,gen_random_uuid());raise exception 'Client impersonated professional request';exception when raise_exception then if sqlerrm='Client impersonated professional request' then raise;end if;end;
 begin perform public.begin_paypal_payment(current_setting('test.ledger_q')::uuid,gen_random_uuid());raise exception 'Unverified seller paid';exception when raise_exception then if sqlerrm='Unverified seller paid' then raise;end if;end;
 if(public.payment_ledger_totals(current_setting('test.ledger_e')::uuid)->>'paidCents')<>'0' then raise exception 'Request counted as payment';end if;
 begin update public.payment_ledger set amount_cents=1;raise exception 'Ledger mutated';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.profiles set display_name='Travis Weedon' where id='97000000-0000-4000-8000-000000000001';
insert into public.paypal_sellers(user_id,merchant_id,payments_enabled,refunds_enabled,verified_at) values('97000000-0000-4000-8000-000000000002','ABCDEFGHIJKLM',true,true,now());
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
select public.begin_paypal_payment(:'q','97000000-0000-4000-8000-000000000013') as p \gset
select public.begin_paypal_payment(:'q','97000000-0000-4000-8000-000000000014');
select set_config('test.ledger_p',:'p',false);
do $$begin
 if(select count(*) from public.payment_transactions where request_id=current_setting('test.ledger_q')::uuid)<>1 then raise exception 'Duplicate checkout';end if;
 begin perform public.record_paypal_payment(current_setting('test.ledger_p')::uuid,'FORGED','FORGED','completed');raise exception 'Client forged receipt';exception when insufficient_privilege then null;end;
 begin perform public.begin_paypal_refund(current_setting('test.ledger_p')::uuid,100,'Client refund',gen_random_uuid());raise exception 'Client initiated refund';exception when raise_exception then if sqlerrm='Client initiated refund' then raise;end if;end;
end $$;
reset role;
select public.record_paypal_payment(:'p','ORDERLEDGER',null,'approval_pending','https://www.sandbox.paypal.com/checkoutnow?token=ORDERLEDGER');
do $$begin
 if exists(select 1 from public.notifications where recipient_id='97000000-0000-4000-8000-000000000002' and kind in('payment_request','payment_received')) then raise exception 'Professional notified before payment received';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',false);
select public.create_adhoc_payment_request(:'e','hourly','Five hours of November support',50000,'97000000-0000-4000-8000-000000000015');
select public.submit_individual_milestones(:'e','[{"description":"Dashboard and reports","amountCents":12500,"targetDate":"2026-12-22","acceptanceCriteria":"CSV and email reconcile","responsibilities":"Supply data"}]','97000000-0000-4000-8000-000000000016',:'m',:'v','Add email reports');
select latest_version_id as v2 from public.milestones where id=:'m' \gset
select set_config('test.ledger_v2',:'v2',false);
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
select public.authorize_paypal_capture(:'p');
do $$begin
 begin perform public.accept_milestone(current_setting('test.ledger_v2')::uuid);raise exception 'Revision raced capture';exception when raise_exception then if sqlerrm='Revision raced capture' then raise;end if;end;
end $$;
reset role;
select public.record_paypal_payment(:'p','ORDERLEDGER',null,'approval_pending'); -- Delayed event cannot undo processing reservation.
do $$begin if(select status from public.payment_transactions where id=current_setting('test.ledger_p')::uuid)<>'processing' then raise exception 'Processing downgraded';end if;end $$;
select public.record_paypal_payment(:'p','ORDERLEDGER','CAPTURELEDGER','completed');
select public.record_paypal_payment(:'p','ORDERLEDGER','CAPTURELEDGER','completed');
select public.record_paypal_payment(:'p','ORDERLEDGER','CAPTURELEDGER','failed'); -- Out-of-order event.
do $$begin
 if(select count(*) from public.notifications where recipient_id='97000000-0000-4000-8000-000000000002' and kind='payment_received' and record_id=current_setting('test.ledger_p')::uuid)<>1 then raise exception 'Received notification missing or duplicated';end if;
 if not exists(select 1 from public.notifications where record_id=current_setting('test.ledger_p')::uuid and kind='payment_received' and title='Payment received: $100 from Travis Weedon') then raise exception 'Payment receipt title incorrect';end if;
 if(select count(*) from public.notifications where recipient_id='97000000-0000-4000-8000-000000000001' and kind='payment_sent' and record_id=current_setting('test.ledger_p')::uuid)<>1 then raise exception 'Sent notification missing or duplicated';end if;
 if exists(select 1 from public.notifications where recipient_id='97000000-0000-4000-8000-000000000002' and kind='payment_request') then raise exception 'Professional received intermediate payment notice';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
select public.accept_milestone(:'v2');
select task_id as task2 from public.milestone_versions where id=:'v2' \gset
select public.request_milestone_payment(:'e',:'task2','97000000-0000-4000-8000-000000000017') as difference \gset
do $$begin
 if(public.payment_ledger_totals(current_setting('test.ledger_e')::uuid)->>'paidCents')<>'10000' then raise exception 'Duplicate or missing completed capture';end if;
 if(select status from public.payment_transactions where id=current_setting('test.ledger_p')::uuid)<>'completed' then raise exception 'Completed capture downgraded';end if;
 if(select count(*) from public.payment_ledger where payment_id=current_setting('test.ledger_p')::uuid and kind='payment_completed')<>1 then raise exception 'Duplicate paid event';end if;
 if(select amount_cents from public.payment_requests where operation_key='97000000-0000-4000-8000-000000000017')<>2500 then raise exception 'Earlier version payment not credited';end if;
end $$;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',false);
select public.begin_paypal_refund(:'p',4000,'Partial reporting refund','97000000-0000-4000-8000-000000000018') as r \gset
select public.begin_paypal_refund(:'p',4000,'Partial reporting refund','97000000-0000-4000-8000-000000000018');
do $$begin
 begin perform public.begin_paypal_refund(current_setting('test.ledger_p')::uuid,6001,'Excess refund',gen_random_uuid());raise exception 'Over-refund allowed';exception when raise_exception then if sqlerrm='Over-refund allowed' then raise;end if;end;
end $$;
reset role;
select public.record_paypal_refund(:'r','REFUNDLEDGER','completed');
select public.record_paypal_refund(:'r','REFUNDLEDGER','completed');
select public.record_paypal_refund(:'r','REFUNDLEDGER','failed');
do $$begin
 if(select count(*) from public.notifications where recipient_id='97000000-0000-4000-8000-000000000001' and kind='refund_received')<>1 then raise exception 'Refund notice missing or duplicated';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
do $$begin
 if(public.payment_ledger_totals(current_setting('test.ledger_e')::uuid)->>'refundedCents')<>'4000' then raise exception 'Refund total incorrect';end if;
 if not exists(select 1 from public.payment_ledger where kind='refund_completed' and payment_id=current_setting('test.ledger_p')::uuid and provider_reference='REFUNDLEDGER') then raise exception 'Refund linkage missing';end if;
end $$;
-- An uncaptured old checkout cannot lock out payment of an accepted revision.
select public.request_milestone_payment(:'e',:'task2','97000000-0000-4000-8000-000000000020') as old_q \gset
select public.begin_paypal_payment(:'old_q','97000000-0000-4000-8000-000000000021') as old_p \gset
select set_config('test.old_p',:'old_p',false);
reset role;
select public.record_paypal_payment(:'old_p','STALEORDER',null,'approval_pending');
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',false);
select public.submit_individual_milestones(:'e','[{"description":"Revised reporting service","amountCents":13000,"targetDate":"2026-12-23","acceptanceCriteria":"CSV and email reconcile","responsibilities":"Supply data"}]','97000000-0000-4000-8000-000000000022',:'m',:'v2','Change the reporting requirement');
select latest_version_id as v3 from public.milestones where id=:'m' \gset
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
select public.accept_milestone(:'v3');
do $$begin
 if(select status from public.payment_transactions where id=current_setting('test.old_p')::uuid)<>'cancelled' then raise exception 'Obsolete checkout still reserves balance';end if;
 begin perform public.authorize_paypal_capture(current_setting('test.old_p')::uuid);raise exception 'Superseded checkout captured';exception when raise_exception then if sqlerrm='Superseded checkout captured' then raise;end if;end;
end $$;
reset role;
select public.record_paypal_payment(:'old_p','STALEORDER',null,'approval_pending');
do $$begin if(select status from public.payment_transactions where id=current_setting('test.old_p')::uuid)<>'cancelled' then raise exception 'Delayed order event revived obsolete checkout';end if;end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
select task_id as task3 from public.milestone_versions where id=:'v3' \gset
select public.request_milestone_payment(:'e',:'task3','97000000-0000-4000-8000-000000000023') as current_q \gset
select public.begin_paypal_payment(:'current_q','97000000-0000-4000-8000-000000000024') as current_p \gset
select set_config('test.current_p',:'current_p',false);
-- An actual late provider capture is still recorded against its original
-- reference; it must reduce the amount authorized for the newer checkout.
reset role;
select public.record_paypal_payment(:'old_p','STALEORDER','LATECAPTURE','completed');
set role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',false);
do $$begin
 begin perform public.authorize_paypal_capture(current_setting('test.current_p')::uuid);raise exception 'Late receipt allowed overpayment';exception when raise_exception then if sqlerrm='Late receipt allowed overpayment' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$begin
 if exists(select 1 from public.payment_transactions) or exists(select 1 from public.payment_refunds) or exists(select 1 from public.payment_ledger) or exists(select 1 from public.paypal_sellers) then raise exception 'Outsider financial data leak';end if;
 begin perform public.payment_ledger_totals(current_setting('test.ledger_e')::uuid);raise exception 'Outsider totals';exception when raise_exception then if sqlerrm='Outsider totals' then raise;end if;end;
end $$;
rollback;
