\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values('93000000-0000-4000-8000-000000000001','public-profile-fixture@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select public.update_profile('Public participant','Company','Professional description',array['Testing'],false);
do $$begin
 if not(select is_public from public.profiles where id=auth.uid()) then raise exception 'Legacy visibility control hid profile';end if;
end $$;
set role anon;
do $$declare p jsonb;begin
 p:=public.public_profile('93000000-0000-4000-8000-000000000001');
 if p->>'displayName'<>'Public participant' then raise exception 'Profile not public';end if;
 if p ? 'email' or p ? 'hourly_rate_cents' or p ? 'messages' then raise exception 'Private profile data leaked';end if;
 if jsonb_array_length(p->'reviews')<>0 then raise exception 'Invented reputation';end if;
end $$;
rollback;
