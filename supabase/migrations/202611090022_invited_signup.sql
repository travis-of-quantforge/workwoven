-- Server-only lookup for finishing an unverified signup using its emailed invite.
create function public.unverified_invited_user(t text) returns uuid
language sql security definer set search_path='' as $$
 select u.id from auth.users u
 join public.invitations i on lower(u.email)=i.email
 join public.engagements e on e.id=i.engagement_id
 where i.token_hash=encode(extensions.digest(t,'sha256'),'hex')
 and i.revoked_at is null and i.accepted_at is null and i.expires_at>now()
 and e.status in ('discussion','active') and e.funding='funded'
 and u.email_confirmed_at is null
 limit 1;
$$;
revoke all on function public.unverified_invited_user(text) from public,anon,authenticated;
grant execute on function public.unverified_invited_user(text) to service_role;
