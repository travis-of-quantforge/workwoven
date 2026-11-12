\set ON_ERROR_STOP on
do $$begin
 if (select available_nano from public.account_token_wallets where user_id='94000000-0000-4000-8000-000000000001')<>7000000000 then raise exception 'Old cancelled tokens not restored';end if;
 if (select sum(a.available_nano) from public.agent_accounts a join public.engagements e on e.id=a.engagement_id where e.status='cancelled')<>0 then raise exception 'Upgrade left duplicate credits';end if;
 if (select sum(a.available_nano) from public.agent_accounts a join public.engagements e on e.id=a.engagement_id where e.status='discussion')<>5000000000 then raise exception 'Upgrade moved active tokens';end if;
end $$;
select public.return_cancelled_agent_tokens(a.id) from public.agent_accounts a join public.engagements e on e.id=a.engagement_id where e.status='cancelled';
do $$begin if (select available_nano from public.account_token_wallets where user_id='94000000-0000-4000-8000-000000000001')<>7000000000 then raise exception 'Upgrade repair duplicated returns';end if;end $$;
