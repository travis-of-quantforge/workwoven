\set ON_ERROR_STOP on
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
values('00000000-0000-0000-0000-000000000009','role-switch@example.test',now(),'{"profile_type":"professional"}');
do $$begin
 if (select default_role from public.profiles where id='00000000-0000-0000-0000-000000000009')<>'professional'
   or (select active_role from public.profiles where id='00000000-0000-0000-0000-000000000009')<>'professional'
   then raise exception 'Signup profile type not stored';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000009',false);
select public.create_engagement('Professional first project') as professional_project \gset
select set_config('test.professional_project',:'professional_project',false);
do $$begin
 if (select role from public.memberships where engagement_id=current_setting('test.professional_project')::uuid and user_id=auth.uid())<>'professional'
   then raise exception 'Creation ignored active professional context';end if;
end $$;
select public.set_active_role('client');
select public.create_engagement('Client second project') as client_project \gset
select set_config('test.client_project',:'client_project',false);
do $$begin
 if (select role from public.memberships where engagement_id=current_setting('test.client_project')::uuid and user_id=auth.uid())<>'client'
   then raise exception 'Creation ignored active client context';end if;
 if (select role from public.memberships where engagement_id=current_setting('test.professional_project')::uuid and user_id=auth.uid())<>'professional'
   then raise exception 'Switch rewrote historical engagement role';end if;
 if (select count(*) from public.starter_grants where user_id=auth.uid())<>1
   then raise exception 'Role switch duplicated starter grant';end if;
 begin perform public.create_engagement('Browser role override','professional');
   raise exception 'Browser-supplied role override accepted';
 exception when raise_exception then if sqlerrm='Browser-supplied role override accepted' then raise;end if;end;
end $$;
reset role;
\echo 'Account default, switching, and engagement authority assertions passed'
