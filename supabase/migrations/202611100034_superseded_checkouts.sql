-- An approved revision must not leave an obsolete, uncaptured checkout holding
-- the milestone's outstanding balance. PayPal approval alone moves no money;
-- the authenticated capture guard rejects these superseded requests.
create function public.cancel_superseded_checkout() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.payment_transactions;begin
 if new.status='superseded' and old.status<>new.status then
 for p in select * from public.payment_transactions where request_id=new.id and status in('creating','approval_pending') for update loop
 update public.payment_transactions set status='cancelled',updated_at=now() where id=p.id;
 insert into public.payment_ledger(engagement_id,request_id,payment_id,kind,amount_cents,description,provider_reference,event_key)
 values(p.engagement_id,new.id,p.id,'payment_cancelled',p.amount_cents,'Uncaptured checkout superseded: '||new.description,p.order_id,p.id||':payment_cancelled') on conflict(event_key) do nothing;
 end loop;
 end if;return new;end $$;
create trigger cancel_superseded_checkout after update of status on public.payment_requests for each row execute function public.cancel_superseded_checkout();
revoke all on function public.cancel_superseded_checkout() from public,anon,authenticated;
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.record_paypal_payment(uuid,text,text,text,text,text)'::regprocedure);
 definition:=replace(definition,'if payment.status=''completed'' then return;end if;',
 'if payment.status=''completed'' then return;end if;
 if payment.status in(''failed'',''cancelled'') and state in(''approval_pending'',''processing'') then return;end if;');
 execute definition;
end $$;
