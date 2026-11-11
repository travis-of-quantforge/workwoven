alter table public.payment_requests drop constraint payment_requests_status_check;
alter table public.payment_requests add constraint payment_requests_status_check check(status in('requested','superseded','paid','cancelled'));
alter table public.payment_ledger drop constraint payment_ledger_kind_check;
alter table public.payment_ledger add constraint payment_ledger_kind_check check(kind in('request_created','request_superseded','request_cancelled','order_created','payment_processing','payment_completed','payment_failed','payment_cancelled','refund_requested','refund_completed','refund_failed'));

-- Keep both the request and checkout cancellation in immutable history.
create function public.cancelled_request_ledger() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.status='cancelled' and old.status<>new.status then
 insert into public.payment_ledger(engagement_id,request_id,kind,amount_cents,description,event_key)
 values(new.engagement_id,new.id,'request_cancelled',new.amount_cents,new.description,'cancelled-request:'||new.id) on conflict(event_key) do nothing;
 end if;return new;end $$;
create trigger cancelled_request_ledger after update of status on public.payment_requests for each row execute function public.cancelled_request_ledger();
revoke all on function public.cancelled_request_ledger() from public,anon,authenticated;

do $$declare definition text;begin
 definition:=pg_get_functiondef('public.cancel_paypal_checkout(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,
 'update public.payment_transactions set status=''cancelled'',updated_at=now() where id=p;',
 'update public.payment_transactions set status=''cancelled'',updated_at=now() where id=p;
 update public.payment_requests set status=''cancelled'' where id=payment.request_id and status=''requested'';');
 execute definition;
 -- Re-read the request after acquiring the engagement lock: a cancellation
 -- committed while checkout was waiting must not create a new transaction.
 definition:=pg_get_functiondef('public.begin_paypal_payment(uuid,uuid)'::regprocedure);
 definition:=replace(definition,
 'perform 1 from public.engagements where id=r.engagement_id for update;',
 'perform 1 from public.engagements where id=r.engagement_id for update;
 select * into r from public.payment_requests where id=q;');
 execute definition;
end $$;

-- Repair already-cancelled checkouts, without touching a request that was paid
-- or retried with a different active transaction before this migration.
update public.payment_requests r set status='cancelled'
where r.status='requested'
 and exists(select 1 from public.payment_transactions p where p.request_id=r.id and p.status='cancelled')
 and not exists(select 1 from public.payment_transactions p where p.request_id=r.id and (p.status not in('failed','cancelled') or p.capture_id is not null));
