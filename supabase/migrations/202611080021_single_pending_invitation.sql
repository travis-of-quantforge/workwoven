create or replace function public.create_invitation(e uuid,target_email text) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified(); r public.party_role; t text:=encode(extensions.gen_random_bytes(32),'hex'); begin
 perform 1 from public.engagements where id=e and funding='funded' for update;
 if not found then raise exception 'Funding required'; end if;
 r:=public.member_role(e); if r is null then raise exception 'Forbidden'; end if;
 r:=case when r='client' then 'professional'::public.party_role else 'client'::public.party_role end;
 if exists(select 1 from public.memberships where engagement_id=e and role=r) then raise exception 'Party already joined'; end if;
 if exists(select 1 from public.invitations where engagement_id=e and accepted_at is null and revoked_at is null and expires_at>now())
 then raise exception 'Revoke the pending invitation before creating another'; end if;
 update public.invitations set revoked_at=now() where engagement_id=e and accepted_at is null and revoked_at is null;
 insert into public.invitations(engagement_id,email,role,token_hash) values(e,lower(trim(target_email)),r,encode(extensions.digest(t,'sha256'),'hex'));
 return t;
end $$;
