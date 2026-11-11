-- Receipt titles are server-generated snapshots of the verified payment amount
-- and the payer's shared display name, never their private email/profile data.
alter table public.notifications add column title text;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.record_paypal_payment(uuid,text,text,text,text,text)'::regprocedure);
 definition:=replace(definition,
 'insert into public.notifications(recipient_id,engagement_id,kind,record_id) values
 (payment.payee_id,payment.engagement_id,''payment_received'',payment.id),
 (payment.payer_id,payment.engagement_id,''payment_sent'',payment.id) on conflict do nothing;',
 'insert into public.notifications(recipient_id,engagement_id,kind,record_id,title) values
 (payment.payee_id,payment.engagement_id,''payment_received'',payment.id,
 ''Payment received: $''||(payment.amount_cents/100)::text||case when payment.amount_cents%100=0 then '''' else ''.''||lpad((payment.amount_cents%100)::text,2,''0'') end||'' from ''||
 coalesce((select nullif(btrim(display_name),'''') from public.profiles where id=payment.payer_id),''the client'')),
 (payment.payer_id,payment.engagement_id,''payment_sent'',payment.id,null) on conflict do nothing;');
 execute definition;
end $$;
update public.notifications n set title=
 'Payment received: $'||(p.amount_cents/100)::text||case when p.amount_cents%100=0 then '' else '.'||lpad((p.amount_cents%100)::text,2,'0') end||' from '||
 coalesce((select nullif(btrim(display_name),'') from public.profiles where id=p.payer_id),'the client')
from public.payment_transactions p where n.kind='payment_received' and n.record_id=p.id and n.recipient_id=p.payee_id and p.status='completed';
