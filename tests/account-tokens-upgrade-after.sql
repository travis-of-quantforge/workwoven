do $$begin
 if (select available_nano from public.account_token_wallets where user_id='92000000-0000-4000-8000-000000000001')<>11000000000 then raise exception 'Existing signup did not receive 110 tokens';end if;
 if (select a.available_nano from public.agent_accounts a join public.engagements e on e.id=a.engagement_id where e.title='Existing funded engagement' and a.visibility='shared')<>5000000000 then raise exception 'Existing engagement credits changed';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',false);
select id as pending from public.engagements where title='Existing pending engagement' \gset
select public.allocate_existing_engagement_tokens(:'pending');
select public.allocate_existing_engagement_tokens(:'pending');
do $$begin
 if (select available_nano from public.account_token_wallets where user_id=auth.uid())<>6000000000 then raise exception 'Legacy allocation replay charged twice';end if;
 if exists(select 1 from public.engagements where creator_id=auth.uid() and funding<>'funded') then raise exception 'Legacy engagement did not activate';end if;
end $$;
