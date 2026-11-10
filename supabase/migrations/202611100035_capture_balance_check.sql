-- Re-read the outstanding amount immediately before the provider POST, including
-- any independently reconciled capture that arrived after checkout creation.
create or replace function public.authorize_paypal_capture(p uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified();payment public.payment_transactions;r public.payment_requests;due bigint;begin
 select * into payment from public.payment_transactions where id=p;
 if payment.id is null or payment.payer_id<>u or public.member_role(payment.engagement_id) is distinct from 'client'::public.party_role then raise exception 'Forbidden';end if;
 perform 1 from public.engagements where id=payment.engagement_id for update;
 select * into payment from public.payment_transactions where id=p for update;
 if payment.status='completed' then return;end if;
 select * into r from public.payment_requests where id=payment.request_id;
 if r.status<>'requested' or payment.status in('failed','cancelled') or (r.task_id is not null and not public.is_current_milestone_task(r.task_id)) then raise exception 'Payment request is no longer payable';end if;
 if payment.milestone_id is not null then
 select amount_cents into due from public.milestone_tasks where id=r.task_id;
 due:=due-public.milestone_net_paid(payment.milestone_id)-(select coalesce(sum(amount_cents),0) from public.payment_transactions where milestone_id=payment.milestone_id and id<>p and status in('creating','approval_pending','processing'));
 if payment.amount_cents>due then raise exception 'Outstanding balance changed; request a new payment';end if;
 end if;
 update public.payment_transactions set status='processing',updated_at=now() where id=p;
end $$;
