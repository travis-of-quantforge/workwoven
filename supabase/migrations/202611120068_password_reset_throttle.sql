-- Service-only throttling. Store hashes, never email addresses or recovery tokens.
create table public.password_reset_attempts(email_hash text not null,ip_hash text not null,created_at timestamptz not null default now());
create index password_reset_email_time on public.password_reset_attempts(email_hash,created_at);
create index password_reset_ip_time on public.password_reset_attempts(ip_hash,created_at);
alter table public.password_reset_attempts enable row level security;
revoke all on public.password_reset_attempts from public,anon,authenticated;
create function public.claim_password_reset(email_hash text,ip_hash text) returns boolean language plpgsql security definer set search_path='' as $$begin
 if email_hash!~'^[a-f0-9]{64}$' or ip_hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid reset throttle key';end if;
 perform pg_advisory_xact_lock(hashtextextended('password-reset-ip:'||ip_hash,0));
 perform pg_advisory_xact_lock(hashtextextended('password-reset-email:'||email_hash,0));
 if exists(select 1 from public.password_reset_attempts a where a.email_hash=claim_password_reset.email_hash and a.created_at>now()-interval '60 seconds') or
 (select count(*) from public.password_reset_attempts a where a.ip_hash=claim_password_reset.ip_hash and a.created_at>now()-interval '1 hour')>=20 then return false;end if;
 delete from public.password_reset_attempts where created_at<now()-interval '1 day';
 insert into public.password_reset_attempts(email_hash,ip_hash) values(email_hash,ip_hash);
 return true;
end $$;
revoke all on function public.claim_password_reset(text,text) from public,anon,authenticated;
grant execute on function public.claim_password_reset(text,text) to service_role;
