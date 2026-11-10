create function public.received_invitations()
returns table(id uuid,title text,role public.party_role,expires_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.require_verified();begin
 return query select i.id,e.title,i.role,i.expires_at
 from public.invitations i join public.engagements e on e.id=i.engagement_id
 join auth.users a on a.id=u and lower(a.email)=i.email
 where i.revoked_at is null and i.accepted_at is null and i.expires_at>now()
 and e.status in ('discussion','active') and e.funding='funded'
 and not exists(select 1 from public.memberships m where m.engagement_id=e.id and m.user_id=u)
 order by i.expires_at desc;
end $$;

create function public.accept_received_invitation(invitation_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); i public.invitations; mail text;begin
 select * into i from public.invitations where id=invitation_id;
 perform 1 from public.engagements where id=i.engagement_id and status in ('discussion','active') and funding='funded' for update;
 if not found then raise exception 'Invitation unavailable for this account';end if;
 select * into i from public.invitations inv where inv.id=invitation_id for update;
 select lower(email) into mail from auth.users where id=u;
 if i.id is null or i.revoked_at is not null or i.accepted_at is not null or i.expires_at<=now() or i.email<>mail then
  raise exception 'Invitation unavailable for this account';
 end if;
 insert into public.memberships values(i.engagement_id,u,i.role);
 update public.invitations set accepted_by=u,accepted_at=now() where id=i.id;
 return i.engagement_id;
end $$;

-- Email-link and dashboard acceptance share the same locked checks.
create or replace function public.accept_invitation(t text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invitation_id uuid;begin
 select id into invitation_id from public.invitations where token_hash=encode(extensions.digest(t,'sha256'),'hex');
 return public.accept_received_invitation(invitation_id);
end $$;
revoke all on function public.received_invitations() from public,anon;
revoke all on function public.accept_received_invitation(uuid) from public,anon;
grant execute on function public.received_invitations() to authenticated;
grant execute on function public.accept_received_invitation(uuid) to authenticated;
