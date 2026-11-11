\set ON_ERROR_STOP on
begin;
reset role;
insert into auth.users(id,email,email_confirmed_at) values
('96000000-0000-4000-8000-000000000001','cancel-client@example.test',now()),
('96000000-0000-4000-8000-000000000002','cancel-pro@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',false);
select public.create_engagement('Isolated cancellation fixture','client') as e \gset
select public.create_invitation(:'e','cancel-pro@example.test') as token \gset
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',false);
select public.accept_invitation(:'token');
reset role;
insert into public.paypal_sellers(user_id,merchant_id,payments_enabled,verified_at) values('96000000-0000-4000-8000-000000000002','ABCDEFGHIJKLM',true,now());
set role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',false);
select public.create_adhoc_payment_request(:'e','bonus','Cancellation fixture',500,gen_random_uuid()) as q \gset
select public.begin_paypal_payment(:'q',gen_random_uuid()) as p \gset
select set_config('test.cancel_p',:'p',false),set_config('test.cancel_q',:'q',false);
do $$begin
 if has_function_privilege('authenticated','public.cancel_paypal_checkout(uuid,uuid,text)','execute') or has_function_privilege('anon','public.cancel_paypal_checkout(uuid,uuid,text)','execute') then raise exception 'Provider verification bypass';end if;
end $$;
reset role;
select public.record_paypal_payment(:'p','CANCELORDER',null,'approval_pending');
do $$begin
 begin perform public.cancel_paypal_checkout(current_setting('test.cancel_p')::uuid,'96000000-0000-4000-8000-000000000002','CANCELORDER');raise exception 'Seller cancelled client payment';exception when raise_exception then if sqlerrm='Seller cancelled client payment' then raise;end if;end;
 begin perform public.cancel_paypal_checkout(current_setting('test.cancel_p')::uuid,'96000000-0000-4000-8000-000000000001','WRONGORDER');raise exception 'Wrong order cancelled';exception when raise_exception then if sqlerrm='Wrong order cancelled' then raise;end if;end;
end $$;
set role service_role;
select public.cancel_paypal_checkout(:'p','96000000-0000-4000-8000-000000000001','CANCELORDER');
select public.cancel_paypal_checkout(:'p','96000000-0000-4000-8000-000000000001','CANCELORDER');
reset role;
select public.record_paypal_payment(:'p','CANCELORDER',null,'approval_pending');
do $$begin
 if(select status from public.payment_transactions where id=current_setting('test.cancel_p')::uuid)<>'cancelled' then raise exception 'Cancelled order revived';end if;
 if(select count(*) from public.payment_ledger where payment_id=current_setting('test.cancel_p')::uuid and kind='payment_cancelled')<>1 then raise exception 'Duplicate cancellation ledger';end if;
 if(select status from public.payment_requests where id=current_setting('test.cancel_q')::uuid)<>'cancelled' then raise exception 'Cancelled request remains awaiting payment';end if;
 if(select count(*) from public.payment_ledger where request_id=current_setting('test.cancel_q')::uuid and kind='request_cancelled')<>1 then raise exception 'Request cancellation ledger missing';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',false);
do $$begin
 begin perform public.authorize_paypal_capture(current_setting('test.cancel_p')::uuid);raise exception 'Cancelled order captured';exception when raise_exception then if sqlerrm='Cancelled order captured' then raise;end if;end;
 begin perform public.begin_paypal_payment(current_setting('test.cancel_q')::uuid,gen_random_uuid());raise exception 'Cancelled request paid';exception when raise_exception then if sqlerrm='Cancelled request paid' then raise;end if;end;
end $$;
select public.create_adhoc_payment_request(:'e','bonus','Fresh payment after cancellation',500,gen_random_uuid()) as q \gset
select public.begin_paypal_payment(:'q',gen_random_uuid()) as retry \gset
reset role;
select public.record_paypal_payment(:'retry','RETRYORDER',null,'approval_pending');
set role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',false);
select public.authorize_paypal_capture(:'retry');
reset role;
select set_config('test.cancel_retry',:'retry',false);
do $$begin
 begin perform public.cancel_paypal_checkout(current_setting('test.cancel_retry')::uuid,'96000000-0000-4000-8000-000000000001','RETRYORDER');raise exception 'Processing capture cancelled';exception when raise_exception then if sqlerrm='Processing capture cancelled' then raise;end if;end;
end $$;
select public.record_paypal_payment(:'retry','RETRYORDER','RETRYCAPTURE','completed');
do $$begin
 begin perform public.cancel_paypal_checkout(current_setting('test.cancel_retry')::uuid,'96000000-0000-4000-8000-000000000001','RETRYORDER');raise exception 'Paid payment cancelled';exception when raise_exception then if sqlerrm='Paid payment cancelled' then raise;end if;end;
end $$;
rollback;
