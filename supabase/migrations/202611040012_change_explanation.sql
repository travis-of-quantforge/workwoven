-- Enforce change explanations on direct authenticated RPC calls as well as forms.
create function public.require_change_explanation() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.engagements where id=new.engagement_id and accepted_version_id is not null) and not(new.content ? 'change') then raise exception 'Explain the change against the accepted agreement';end if;
 return new;end $$;
create trigger require_change_explanation before insert on public.scope_versions for each row execute function public.require_change_explanation();
revoke execute on function public.require_change_explanation from public,anon,authenticated;
