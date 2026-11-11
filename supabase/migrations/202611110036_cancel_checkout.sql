-- Called only after the server independently checks the provider order.
-- Match the capture guard's lock order so cancellation and capture serialize.
create function public.cancel_paypal_checkout(p uuid, actor uuid, provider_order text) returns void
language plpgsql security definer set search_path='' as $$
declare payment public.payment_transactions; r public.payment_requests; begin
 select * into payment from public.payment_transactions where id=p;
 if payment.id is null or payment.payer_id<>actor or not exists(
  select 1 from public.memberships where engagement_id=payment.engagement_id and user_id=actor and role='client'
 ) then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=payment.engagement_id for update;
 select * into payment from public.payment_transactions where id=p for update;
 if payment.order_id is distinct from provider_order or provider_order is null then raise exception 'Provider reference mismatch';end if;
 if payment.status='cancelled' then return;end if;
 if payment.status<>'approval_pending' or payment.capture_id is not null then raise exception 'Only an uncaptured checkout awaiting approval can be cancelled';end if;
 update public.payment_transactions set status='cancelled',updated_at=now() where id=p;
 select * into r from public.payment_requests where id=payment.request_id;
 insert into public.payment_ledger(engagement_id,request_id,payment_id,kind,amount_cents,description,provider_reference,event_key)
 values(payment.engagement_id,payment.request_id,p,'payment_cancelled',payment.amount_cents,r.description,provider_order,p||':payment_cancelled') on conflict(event_key) do nothing;
end $$;
revoke all on function public.cancel_paypal_checkout(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_paypal_checkout(uuid,uuid,text) to service_role;
