\set ON_ERROR_STOP on
begin;
reset role;
insert into auth.users(id,email,email_confirmed_at) values
('95000000-0000-4000-8000-000000000001','return-client@example.test',now()),
('95000000-0000-4000-8000-000000000002','return-pro@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
select public.create_engagement('Cancelled token return fixture') as e \gset
select public.create_invitation(:'e','return-pro@example.test') as token \gset
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',true);
select public.accept_invitation(:'token');
reset role;
select id as shared from public.agent_accounts where engagement_id=:'e' and visibility='shared' \gset
select id as client_private from public.agent_accounts where engagement_id=:'e' and visibility='client' \gset
select id as pro_private from public.agent_accounts where engagement_id=:'e' and visibility='professional' \gset
select public.admin_adjust_credits(:'client_private','95000000-0000-4000-8000-000000000001',gen_random_uuid(),2000000000,'Private cancellation fixture');
select public.admin_adjust_credits(:'pro_private','95000000-0000-4000-8000-000000000001',gen_random_uuid(),3000000000,'Professional cancellation fixture');
insert into public.ai_pricing(model,version,input_nano_per_token,cached_nano_per_token,output_nano_per_token,source_url)
values('cancellation-fixture','fixture',1000000,0,0,'https://example.test/pricing') returning id as price \gset
select set_config('request.jwt.claim.sub','',true);
select public.reserve_usage(:'shared','95000000-0000-4000-8000-000000000001',gen_random_uuid(),300000000) as used_op \gset
select public.record_usage(:'used_op','cancellation-fixture-receipt',:'price',100,0,0);
select public.settle_usage(:'used_op',100000000,'success','{"fixture":true}');
select public.reserve_usage(:'pro_private','95000000-0000-4000-8000-000000000002',gen_random_uuid(),400000000) as pending_op \gset
select set_config('test.return_e',:'e',true),set_config('test.return_used',:'used_op',true),set_config('test.return_pending',:'pending_op',true);
set role authenticated;
-- The party cancelling does not become the owner of the other party's tokens.
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',true);
select public.close_engagement(:'e','cancelled',null,'End the cancellation return fixture.');
do $$begin
 if (select available_nano from public.account_token_wallets where user_id=auth.uid())<>13600000000 then raise exception 'Private unused tokens not returned to professional';end if;
 if exists(select 1 from public.account_token_ledger where user_id<>auth.uid()) then raise exception 'Return ledger leaks other wallet';end if;
 begin perform public.return_cancelled_agent_tokens((select id from public.agent_accounts where engagement_id=current_setting('test.return_e')::uuid and visibility='shared'));raise exception 'Participant invoked service return';exception when insufficient_privilege then null;end;
end $$;
select public.close_engagement(:'e','cancelled',null,'Replay cancellation.');
reset role;
do $$begin
 if (select available_nano from public.account_token_wallets where user_id='95000000-0000-4000-8000-000000000001')<>12800000000 then raise exception 'Shared/client-private return owner or amount incorrect';end if;
 if (select sum(available_nano) from public.agent_accounts where engagement_id=current_setting('test.return_e')::uuid)<>0 then raise exception 'Cancelled available balance stranded';end if;
 if (select sum(reserved_nano) from public.agent_accounts where engagement_id=current_setting('test.return_e')::uuid)<>400000000 then raise exception 'Pending reservation prematurely returned';end if;
 if (select sum(spent_nano) from public.credit_lots l join public.agent_accounts a on a.id=l.account_id where a.engagement_id=current_setting('test.return_e')::uuid)<>200000000 then raise exception 'Spent credits refunded';end if;
end $$;
select set_config('request.jwt.claim.sub','',true);
select public.settle_usage(:'pending_op',0,'internal_error','{"fixture":"cancelled"}');
select public.settle_usage(:'pending_op',0,'internal_error','{"fixture":"replay"}');
select public.return_cancelled_agent_tokens(:'shared');
select public.return_cancelled_agent_tokens(:'pro_private');
do $$begin
 if (select available_nano from public.account_token_wallets where user_id='95000000-0000-4000-8000-000000000002')<>14000000000 then raise exception 'Late reservation release not returned exactly once';end if;
 if (select sum(available_nano+reserved_nano) from public.agent_accounts where engagement_id=current_setting('test.return_e')::uuid)<>0 then raise exception 'Cancelled reservation remains stranded';end if;
 if (select sum(returned_nano) from public.credit_lots l join public.agent_accounts a on a.id=l.account_id where a.engagement_id=current_setting('test.return_e')::uuid)<>9800000000 then raise exception 'Token return conservation failed';end if;
 if exists(select 1 from public.account_token_wallets w where w.user_id in('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002') and w.available_nano<>(select sum(amount_nano) from public.account_token_ledger where user_id=w.user_id)) then raise exception 'Wallet ledger does not reconcile';end if;
end $$;
-- A later verified billing correction also returns to the original owner.
select public.reverse_usage_charge(:'used_op',gen_random_uuid(),'Synthetic correction after cancellation');
do $$begin
 if (select available_nano from public.account_token_wallets where user_id='95000000-0000-4000-8000-000000000001')<>13000000000 then raise exception 'Late correction not returned';end if;
end $$;
rollback;
