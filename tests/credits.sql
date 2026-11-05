\set ON_ERROR_STOP on
reset role;
insert into public.ai_pricing(model,version,input_nano_per_token,cached_nano_per_token,output_nano_per_token,source_url) values('fixture','test',1,1,1,'fixture:test') returning id as pricing \gset

select id as account from public.agent_accounts where visibility='shared' and available_nano=5000000000 limit 1 \gset
select public.reserve_usage(:'account','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100000000) as operation \gset
select public.reserve_usage(:'account','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100000000);
select public.record_usage(:'operation','fixture-internal',:'pricing',1000,0,0);
select public.settle_usage(:'operation',1000,'internal_error','{}');
select public.settle_usage(:'operation',1000,'internal_error','{}');
select set_config('test.account',:'account',false);
do $$ begin if (select available_nano from public.agent_accounts where id=current_setting('test.account')::uuid)<>5000000000 then raise exception 'Internal error billed'; end if; end $$;
select public.reserve_usage(:'account','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',100000000) as success \gset
select public.record_usage(:'success','fixture-success',:'pricing',17,0,0);
select public.settle_usage(:'success',17,'success','{"ratesVersion":1}');
select public.settle_usage(:'success',17,'success','{"ratesVersion":1}');
do $$ begin if (select available_nano from public.agent_accounts where id=current_setting('test.account')::uuid)<>4999999966 then raise exception 'Incorrect 2x billing or duplicate charge'; end if; end $$;
select public.reserve_usage(:'account','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',100000000) as partial \gset
select public.record_usage(:'partial','fixture-partial',:'pricing',23,0,0);
select public.settle_usage(:'partial',23,'partial','{"ratesVersion":1}');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.resolve_partial(:'partial',false);
reset role;
do $$ begin if (select available_nano from public.agent_accounts where id=current_setting('test.account')::uuid)<>4999999966 then raise exception 'Discarded partial charged'; end if; end $$;
\echo 'Credit assertions passed'
