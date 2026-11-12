\set ON_ERROR_STOP on
insert into auth.users(id,email,email_confirmed_at) values('94000000-0000-4000-8000-000000000001','cancel-upgrade@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',false);
select public.create_engagement('Pre-upgrade cancelled tokens') as e \gset
select public.create_engagement('Pre-upgrade active tokens');
reset role;
select public.admin_adjust_credits((select id from public.agent_accounts where engagement_id=:'e' and visibility='client'),'94000000-0000-4000-8000-000000000001',gen_random_uuid(),1000000000,'Legacy private upgrade fixture');
set role authenticated;
select public.close_engagement(:'e','cancelled',null,'Legacy cancellation before return support.');
reset role;
do $$begin if (select available_nano from public.account_token_wallets where user_id='94000000-0000-4000-8000-000000000001')<>1000000000 then raise exception 'Upgrade starting wallet incorrect';end if;end $$;
