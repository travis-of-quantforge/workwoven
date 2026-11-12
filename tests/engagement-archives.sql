\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values
('92000000-0000-4000-8000-000000000001','archive-owner@example.test',now()),
('92000000-0000-4000-8000-000000000002','archive-peer@example.test',now()),
('92000000-0000-4000-8000-000000000003','archive-outsider@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
select public.create_engagement('Archive fixture') as e \gset
select set_config('test.archive_e',:'e',true);
do $$begin
 begin perform public.set_engagement_archived(current_setting('test.archive_e')::uuid,true);raise exception 'Active archive allowed';exception when raise_exception then if sqlerrm<>'Only completed or cancelled engagements can be archived' then raise;end if;end;
end $$;
reset role;
insert into public.memberships(engagement_id,user_id,role) values(:'e','92000000-0000-4000-8000-000000000002','professional');
update public.engagements set status='cancelled' where id=:'e';
set role authenticated;
select public.set_engagement_archived(:'e',true);
select public.set_engagement_archived(:'e',true);
do $$begin if (select count(*) from public.engagement_archives)<>1 then raise exception 'Archive replay failed';end if;end $$;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000002',true);
do $$begin if exists(select 1 from public.engagement_archives) then raise exception 'Archive leaked to peer';end if;end $$;
select public.set_engagement_archived(:'e',false);
select public.set_engagement_archived(:'e',true);
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000003',true);
do $$begin
 begin perform public.set_engagement_archived(current_setting('test.archive_e')::uuid,true);raise exception 'Outsider archived';exception when raise_exception then if sqlerrm<>'Forbidden' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
select public.set_engagement_archived(:'e',false);
reset role;
do $$begin
 if (select count(*) from public.engagement_archives where engagement_id=current_setting('test.archive_e')::uuid)<>1 then raise exception 'Restore changed peer preference';end if;
 if (select status from public.engagements where id=current_setting('test.archive_e')::uuid)<>'cancelled' then raise exception 'Archive changed shared status';end if;
end $$;
set role authenticated;
select public.create_engagement('Completed archive fixture') as completed \gset
reset role;
update public.engagements set status='completed' where id=:'completed';
set role authenticated;
select public.set_engagement_archived(:'completed',true);
rollback;
