\set ON_ERROR_STOP on
reset role;
select e.id as engagement,a.id as account from public.engagements e join public.agent_accounts a on a.engagement_id=e.id where e.title='Reporting dashboard' and e.creator_id='00000000-0000-0000-0000-000000000001' and a.visibility='shared' \gset
select id as price from public.ai_pricing where model='fixture' limit 1 \gset
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.create_credit_purchase(:'account',500,'60000000-0000-0000-0000-000000000001') as purchase \gset
reset role;
select public.verify_credit_purchase(:'purchase','fixture-mixed-source-purchase',500,'USD','{"fixture":true}');
select set_config('test.account',:'account',false);
select set_config('test.price',:'price',false);
do $$ declare i integer;op uuid;last_op uuid;begin
 for i in 1..5 loop
 op:=public.reserve_usage(current_setting('test.account')::uuid,'00000000-0000-0000-0000-000000000001',('61000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,1000000000);last_op:=op;
 end loop;
 if(select count(distinct l.source) from public.credit_allocations a join public.credit_lots l on l.id=a.lot_id where a.operation_id=last_op)<>2 then raise exception 'Mixed-source reservation failed';end if;
 perform public.record_usage(last_op,'fixture-mixed-source-cost',current_setting('test.price')::uuid,500000000,0,0);
 perform public.settle_usage(last_op,500000000,'success','{"fixture":true}');
 if exists(select 1 from public.credit_allocations where operation_id=last_op and charged_nano<>reserved_nano) then raise exception 'Mixed-source settlement failed';end if;
 perform public.reverse_usage_charge(last_op,'62000000-0000-0000-0000-000000000001','Fixture mixed-source correction');
 for op in select id from public.usage_operations where operation_key::text like '61000000-%' and status='reserved' loop
 perform public.settle_usage(op,null,'provider_error',null);end loop;
 if(select reserved_nano from public.agent_accounts where id=current_setting('test.account')::uuid)<>0 then raise exception 'Mixed-source reservations leaked';end if;
 if(select available_nano from public.agent_accounts where id=current_setting('test.account')::uuid)<>(select sum(amount_nano) from public.credit_ledger where account_id=current_setting('test.account')::uuid) then raise exception 'Ledger and projection diverged';end if;
 if(select available_nano from public.agent_accounts where id=current_setting('test.account')::uuid)<>(select sum(available_nano) from public.credit_lots where account_id=current_setting('test.account')::uuid) then raise exception 'Lot and projection diverged';end if;
end $$;
\echo 'Mixed-source conservation and correction assertions passed'
