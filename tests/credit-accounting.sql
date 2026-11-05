\set ON_ERROR_STOP on
reset role;
select set_config('test.engagement',(select id::text from public.engagements where title='Reporting dashboard' and creator_id='00000000-0000-0000-0000-000000000001'),false);
select set_config('test.pending',(select id::text from public.engagements where title='Second project' and creator_id='00000000-0000-0000-0000-000000000001'),false);
select id as pricing from public.ai_pricing where model='gpt-5-mini-2025-08-07' limit 1 \gset
select id as private_account from public.agent_accounts where visibility='client' and engagement_id=current_setting('test.engagement')::uuid \gset
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.create_credit_purchase(:'private_account',500,'30000000-0000-0000-0000-000000000001') as purchase \gset
select public.create_credit_purchase(:'private_account',500,'30000000-0000-0000-0000-000000000001');
reset role;
select public.verify_credit_purchase(:'purchase','fixture-credit-capture',500,'USD','{"fixture":true}');
select public.verify_credit_purchase(:'purchase','fixture-credit-capture',500,'USD','{"fixture":true}');
select set_config('test.private_account',:'private_account',false);
do $$ begin
 if(select available_nano from public.agent_accounts where id=current_setting('test.private_account')::uuid)<>5000000000 then raise exception 'Purchase replay credited twice';end if;
end $$;
select public.reserve_usage(:'private_account','00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',100000000) as op \gset
select public.record_usage(:'op','fixture-cached-usage',:'pricing',100,80,50);
select public.record_usage(:'op','fixture-cached-usage',:'pricing',100,80,50);
select public.settle_usage(:'op',107000,'success','{"fixture":true}');
select set_config('test.op',:'op',false);
do $$ begin
 if(select charge_nano from public.usage_operations where id=current_setting('test.op')::uuid)<>214000 then raise exception 'Cached pricing or markup incorrect';end if;
 if(select available_nano from public.agent_accounts where id=current_setting('test.private_account')::uuid)<>4999786000 then raise exception 'Incorrect private charge';end if;
end $$;
set role authenticated;
select public.request_credit_refund(:'purchase',100,'30000000-0000-0000-0000-000000000003') as refund \gset
reset role;
select public.resolve_credit_refund(:'refund','fixture-credit-refund',true);
select public.resolve_credit_refund(:'refund','fixture-credit-refund',true);
do $$ begin
 if(select available_nano from public.agent_accounts where id=current_setting('test.private_account')::uuid)<>3999786000 then raise exception 'Refund replay changed balance';end if;
 if(select reserved_nano from public.agent_accounts where id=current_setting('test.private_account')::uuid)<>0 then raise exception 'Refund hold leaked';end if;
end $$;
select public.reserve_usage(:'private_account','00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004',100000000) as abandoned \gset
update public.usage_operations set expires_at=now()-interval '1 minute' where id=:'abandoned';
select public.recover_usage(100);
do $$ begin
 if(select available_nano from public.agent_accounts where id=current_setting('test.private_account')::uuid)<>3999786000 then raise exception 'Abandoned reservation not released';end if;
 if exists(select 1 from public.credit_lots where original_nano<>available_nano+reserved_nano+spent_nano+refunded_nano) then raise exception 'Lot conservation failed';end if;
end $$;
-- Funding only activates after provider-verified platform credit purchase.
select id as pending_account from public.agent_accounts where engagement_id=current_setting('test.pending')::uuid and visibility='shared' \gset
set role authenticated;
select public.create_credit_purchase(:'pending_account',500,'30000000-0000-0000-0000-000000000005') as activation_purchase \gset
reset role;
select set_config('test.activation_purchase',:'activation_purchase',false);
do $$ begin
 if(select funding from public.engagements where id=current_setting('test.pending')::uuid)<>'pending' then raise exception 'Unverified purchase activated project';end if;
 begin perform public.verify_credit_purchase(current_setting('test.activation_purchase')::uuid,'fixture-bad-capture',1000,'USD','{}');raise exception 'Amount mismatch allowed';exception when raise_exception then if sqlerrm='Amount mismatch allowed' then raise;end if;end;
end $$;
select public.verify_credit_purchase(:'activation_purchase','fixture-activation',500,'USD','{"fixture":true}');
do $$ begin if(select funding from public.engagements where id=current_setting('test.pending')::uuid)<>'funded' then raise exception 'Verified funding not activated';end if;end $$;
-- Private data and financial mutations are enforced below the UI.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if exists(select 1 from public.credit_lots where account_id=current_setting('test.private_account')::uuid) then raise exception 'Private lot leak';end if;
 if exists(select 1 from public.usage_metering where operation_id=current_setting('test.op')::uuid) then raise exception 'Private usage leak';end if;
 begin perform public.reserve_usage(current_setting('test.private_account')::uuid,auth.uid(),gen_random_uuid(),100);raise exception 'Reservation RPC exposed';exception when insufficient_privilege then null;end;
 begin update public.credit_ledger set amount_nano=999;raise exception 'Ledger mutable';exception when insufficient_privilege then null;end;
end $$;
reset role;
\echo 'Source-aware credit, refund, activation and recovery assertions passed'

select public.reverse_usage_charge(current_setting('test.op')::uuid,'30000000-0000-0000-0000-000000000006','Fixture billing correction');
select public.reverse_usage_charge(current_setting('test.op')::uuid,'30000000-0000-0000-0000-000000000006','Fixture billing correction');
do $$ begin
 if(select available_nano from public.agent_accounts where id=current_setting('test.private_account')::uuid)<>4000000000 then raise exception 'Correction replay or allocation failed';end if;
 if(select charge_nano from public.usage_operations where id=current_setting('test.op')::uuid)<>214000 then raise exception 'Correction rewrote historical charge';end if;
end $$;
