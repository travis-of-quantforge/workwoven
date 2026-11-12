insert into auth.users(id,email,email_confirmed_at) values('92000000-0000-4000-8000-000000000001','existing-wallet@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',false);
select public.create_engagement('Existing funded engagement','client');
select public.create_engagement('Existing pending engagement','client');
