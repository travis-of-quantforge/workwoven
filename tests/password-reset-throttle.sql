\set ON_ERROR_STOP on
begin;
set role anon;
do $$begin
 begin perform public.claim_password_reset(repeat('a',64),repeat('b',64));raise exception 'Public reset throttle allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set role service_role;
do $$begin
 if not public.claim_password_reset(repeat('a',64),repeat('b',64)) then raise exception 'Initial reset throttled';end if;
 if public.claim_password_reset(repeat('a',64),repeat('c',64)) then raise exception 'Email cooldown bypassed';end if;
end $$;
reset role;
update public.password_reset_attempts set created_at=now()-interval '61 seconds';
set role service_role;
do $$declare i integer;begin
 if not public.claim_password_reset(repeat('a',64),repeat('b',64)) then raise exception 'Email cooldown did not expire';end if;
 for i in 1..18 loop
 if not public.claim_password_reset(lpad(i::text,64,'0'),repeat('b',64)) then raise exception 'IP throttled early';end if;
 end loop;
 if public.claim_password_reset(repeat('d',64),repeat('b',64)) then raise exception 'IP cap bypassed';end if;
end $$;
reset role;
set role authenticated;
do $$begin
 begin perform 1 from public.password_reset_attempts;raise exception 'Reset hashes exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
