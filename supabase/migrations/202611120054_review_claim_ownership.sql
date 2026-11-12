-- A worker that read a queued job must not fail another worker's reservation
-- if that worker claims the job before the first worker's setup check returns.
create function public.fail_unclaimed_message_assessment(j uuid,why text) returns void language plpgsql security definer set search_path='' as $$
declare e uuid;state text;begin
 select engagement_id into e from public.message_assessments where id=j;
 perform 1 from public.engagements where id=e for update;
 select status into state from public.message_assessments where id=j for update;
 if state='queued' then perform public.fail_message_assessment(j,why);end if;
end $$;
revoke all on function public.fail_unclaimed_message_assessment(uuid,text) from public,anon,authenticated;
grant execute on function public.fail_unclaimed_message_assessment(uuid,text) to service_role;
