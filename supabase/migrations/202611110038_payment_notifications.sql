alter table public.notifications add column superseded_at timestamptz;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in('message','mention','reply','approval','agreement_accepted','invitation_accepted','delivery','delivery_review','meeting','meeting_response','review_published','concern','payment_request','payment_received','payment_sent','refund_received'));
create unique index payment_notice_once on public.notifications(recipient_id,kind,record_id)
 where kind in('payment_received','payment_sent','refund_received');

do $$declare definition text;begin
 definition:=pg_get_functiondef('public.create_adhoc_payment_request(uuid,text,text,bigint,uuid)'::regprocedure);
 definition:=replace(definition,
 'insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(case when r=''client'' then payee else payer end,e,''payment_request'',result);',
 'if r=''professional'' then insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(payer,e,''payment_request'',result);end if;');
 execute definition;
 definition:=pg_get_functiondef('public.request_milestone_payment(uuid,uuid,uuid)'::regprocedure);
 definition:=replace(definition,
 'insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(case when u=payer then payee else payer end,e,''payment_request'',result);',
 'if u<>payer then insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(payer,e,''payment_request'',result);end if;');
 execute definition;
 definition:=pg_get_functiondef('public.record_paypal_payment(uuid,text,text,text,text,text)'::regprocedure);
 definition:=replace(definition,
 'insert into public.notifications(recipient_id,engagement_id,kind,record_id) select user_id,payment.engagement_id,''payment_request'',r.id from public.memberships where engagement_id=payment.engagement_id;',
 'insert into public.notifications(recipient_id,engagement_id,kind,record_id) values
 (payment.payee_id,payment.engagement_id,''payment_received'',payment.id),
 (payment.payer_id,payment.engagement_id,''payment_sent'',payment.id) on conflict do nothing;');
 execute definition;
 definition:=pg_get_functiondef('public.record_paypal_refund(uuid,text,text,text)'::regprocedure);
 definition:=replace(definition,
 'insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(payment.payer_id,payment.engagement_id,''payment_request'',payment.request_id);',
 'insert into public.notifications(recipient_id,engagement_id,kind,record_id) values(payment.payer_id,payment.engagement_id,''refund_received'',refund.id) on conflict do nothing;');
 execute definition;
end $$;

-- Preserve ambiguous historical notices, but replace their displayed version
-- with one actual receipt per verified payment. No notification is deleted.
insert into public.notifications(recipient_id,engagement_id,kind,record_id,created_at,seen_at)
select p.payee_id,p.engagement_id,'payment_received',p.id,l.created_at,
 (select case when bool_and(n.seen_at is not null) then max(n.seen_at) end from public.notifications n
  where n.recipient_id=p.payee_id and n.record_id=p.request_id and n.kind='payment_request')
from public.payment_transactions p join public.payment_ledger l on l.payment_id=p.id and l.kind='payment_completed'
where p.status='completed' on conflict do nothing;
update public.notifications n set superseded_at=now()
from public.memberships m where n.kind='payment_request' and m.engagement_id=n.engagement_id and m.user_id=n.recipient_id and m.role='professional';
