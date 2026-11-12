-- Account existence is available only to the server and only for a valid invite.
create function public.invitation_has_account(t text) returns boolean
language sql security definer set search_path='' as $$
 select exists(
  select 1 from public.invitations i
  join public.engagements e on e.id=i.engagement_id
  join auth.users u on lower(u.email)=lower(i.email)
  where i.token_hash=encode(extensions.digest(t,'sha256'),'hex')
  and i.revoked_at is null and i.accepted_at is null and i.expires_at>now()
  and e.status in('discussion','active') and e.funding='funded'
 );
$$;
revoke all on function public.invitation_has_account(text) from public,anon,authenticated;
grant execute on function public.invitation_has_account(text) to service_role;
