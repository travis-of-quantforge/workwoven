\set ON_ERROR_STOP on
begin;
reset role;
insert into auth.users(id,email,email_confirmed_at) values
('91000000-0000-4000-8000-000000000001','wallet-client@example.test',now()),
('91000000-0000-4000-8000-000000000002','wallet-other@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',false);
do $$begin
 if (select available_nano from public.account_token_wallets where user_id=auth.uid())<>11000000000 then raise exception 'Signup allowance missing';end if;
 if exists(select 1 from public.account_token_wallets where user_id<>auth.uid()) then raise exception 'Other wallet leaked';end if;
 if exists(select 1 from public.account_token_ledger where user_id<>auth.uid()) then raise exception 'Other wallet ledger leaked';end if;
 begin update public.account_token_wallets set available_nano=999999999999 where user_id=auth.uid();raise exception 'Wallet edited';exception when insufficient_privilege then null;end;
 begin perform public.admin_set_signup_tokens(auth.uid(),gen_random_uuid(),999);raise exception 'Non-admin changed signup setting';exception when insufficient_privilege then null;end;
end $$;
select public.create_engagement_with_contract('First allocated engagement','A valid shared starting contract.','custom') as e \gset
select public.create_engagement('Second allocated engagement') as e2 \gset
select set_config('test.wallet_e',:'e',false);
do $$declare before_count integer;begin
 if (select available_nano from public.account_token_wallets where user_id=auth.uid())<>1000000000 then raise exception 'Wrong remaining balance';end if;
 if (select sum(amount_nano) from public.account_token_ledger where user_id=auth.uid())<>1000000000 then raise exception 'Wallet ledger does not reconcile';end if;
 if (select available_nano from public.agent_accounts where engagement_id=current_setting('test.wallet_e')::uuid and visibility='shared')<>5000000000 then raise exception 'Shared allocation missing';end if;
 if exists(select 1 from public.agent_accounts where engagement_id=current_setting('test.wallet_e')::uuid and visibility<>'shared' and available_nano<>0) then raise exception 'Private wallet funded';end if;
 select count(*) into before_count from public.engagements where creator_id=auth.uid();
 begin perform public.create_engagement('Insufficient balance');raise exception 'Created without 50 tokens';exception when raise_exception then if sqlerrm='Created without 50 tokens' then raise;end if;end;
 if (select count(*) from public.engagements where creator_id=auth.uid())<>before_count then raise exception 'Rejected creation left engagement';end if;
end $$;
reset role;
select public.admin_adjust_account_tokens('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',4000000000,'Exact boundary fixture');
select public.admin_adjust_account_tokens('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',4000000000,'Exact boundary fixture');
set role authenticated;
do $$begin
 begin perform public.create_engagement_with_contract('Bad contract','short','custom');raise exception 'Invalid contract accepted';exception when raise_exception then if sqlerrm='Invalid contract accepted' then raise;end if;end;
 if (select available_nano from public.account_token_wallets where user_id=auth.uid())<>5000000000 then raise exception 'Failed creation charged tokens';end if;
end $$;
select public.create_engagement('Exactly 50 available');
do $$begin if (select available_nano from public.account_token_wallets where user_id=auth.uid())<>0 then raise exception 'Exact allocation failed';end if;end $$;
reset role;
select public.admin_set_signup_tokens('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004',20000000000);
select public.admin_set_signup_tokens('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004',20000000000);
insert into auth.users(id,email,email_confirmed_at) values('91000000-0000-4000-8000-000000000005','wallet-future@example.test',null);
update auth.users set email_confirmed_at=now() where id='91000000-0000-4000-8000-000000000005';
do $$begin
 if (select available_nano from public.account_token_wallets where user_id='91000000-0000-4000-8000-000000000005')<>20000000000 then raise exception 'Future allowance ignored setting';end if;
 if (select count(*) from public.account_token_ledger where user_id='91000000-0000-4000-8000-000000000005' and kind='signup')<>1 then raise exception 'Verification duplicated signup grant';end if;
 if (select available_nano from public.account_token_wallets where user_id='91000000-0000-4000-8000-000000000002')<>11000000000 then raise exception 'Setting retroactively changed existing allowance';end if;
end $$;
select public.admin_set_signup_tokens('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000006',0);
insert into auth.users(id,email,email_confirmed_at) values('91000000-0000-4000-8000-000000000007','wallet-zero@example.test',now());
do $$begin if (select available_nano from public.account_token_wallets where user_id='91000000-0000-4000-8000-000000000007')<>0 then raise exception 'Zero allowance ignored';end if;end $$;
rollback;
