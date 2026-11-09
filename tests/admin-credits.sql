\set ON_ERROR_STOP on
reset role;
do $$begin
 if has_table_privilege('authenticated','public.admin_activity','select')
 or has_table_privilege('anon','public.admin_activity','select')
 or has_table_privilege('authenticated','public.admin_activity','insert')
 or has_table_privilege('service_role','public.admin_activity','update')
 or has_table_privilege('service_role','public.admin_activity','delete') then
  raise exception 'Admin activity permissions must be service-only and append-only';
 end if;
end $$;
select id as private_account from public.agent_accounts
 where engagement_id=(select id from public.engagements where title='Reporting dashboard')
 and visibility='client' \gset
select set_config('test.admin_private',:'private_account',false);
select set_config('test.admin_before',(select available_nano::text from public.agent_accounts where id=:'private_account'),false);
do $$begin
 if has_function_privilege('authenticated','public.admin_adjust_credits(uuid,uuid,uuid,bigint,text)','EXECUTE')
   then raise exception 'Admin adjustment exposed to authenticated users';end if;
end $$;
set role service_role;
select public.admin_adjust_credits(:'private_account','00000000-0000-0000-0000-000000000001',
 '40000000-0000-4000-8000-000000000001',6000000000,'Hackathon fixture') as added \gset
select public.admin_adjust_credits(:'private_account','00000000-0000-0000-0000-000000000001',
 '40000000-0000-4000-8000-000000000001',6000000000,'Hackathon fixture');
select public.admin_adjust_credits(:'private_account','00000000-0000-0000-0000-000000000001',
 '40000000-0000-4000-8000-000000000002',-2000000000,'Correct demo allocation');
reset role;
do $$begin
 if (select available_nano from public.agent_accounts where id=current_setting('test.admin_private')::uuid)<>current_setting('test.admin_before')::bigint+4000000000
   then raise exception 'Admin adjustment/replay incorrect';end if;
 if (select count(*) from public.admin_credit_adjustments where account_id=current_setting('test.admin_private')::uuid)<>2
   then raise exception 'Admin audit missing or duplicated';end if;
 if exists(select 1 from public.credit_lots where original_nano<>
    available_nano+reserved_nano+spent_nano+refunded_nano+admin_removed_nano)
   then raise exception 'Admin lot conservation failed';end if;
end $$;
set role service_role;
do $$begin
 begin perform public.admin_adjust_credits(current_setting('test.admin_private')::uuid,
 '00000000-0000-0000-0000-000000000001',gen_random_uuid(),-5000000000,'Overdraw demo');
 raise exception 'Overdraw allowed';
 exception when raise_exception then if sqlerrm='Overdraw allowed' then raise;end if;end;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.create_engagement('Admin-funded fixture','client') as pending_admin \gset
reset role;
select set_config('test.pending_admin',:'pending_admin',false);
do $$begin
 if (select funding from public.engagements where id=current_setting('test.pending_admin')::uuid)<>'pending'
   then raise exception 'Admin fixture unexpectedly funded';end if;
end $$;
select id as shared_account from public.agent_accounts
 where engagement_id=:'pending_admin' and visibility='shared' \gset
select set_config('test.shared_account',:'shared_account',false);
set role service_role;
select public.admin_adjust_credits(:'shared_account','00000000-0000-0000-0000-000000000001',
 '40000000-0000-4000-8000-000000000003',5000000000,'Fund hackathon fixture');
reset role;
do $$begin
 if (select funding from public.engagements where id=current_setting('test.pending_admin')::uuid)<>'funded'
   then raise exception 'Admin allocation did not activate pending project';end if;
 if exists(select 1 from public.credit_purchases where account_id=current_setting('test.shared_account')::uuid)
   then raise exception 'Admin allocation invented a purchase';end if;
end $$;
\echo 'Admin credit permissions, ledger and activation assertions passed'
