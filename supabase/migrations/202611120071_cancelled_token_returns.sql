-- A token return is a ledger transfer, not AI spend or a cash refund.
alter table public.credit_lots add column returned_nano bigint not null default 0 check(returned_nano>=0);
alter table public.credit_lots drop constraint credit_lots_conservation;
alter table public.credit_lots add constraint credit_lots_conservation check(
 original_nano=available_nano+reserved_nano+spent_nano+refunded_nano+admin_removed_nano+returned_nano
);
alter table public.account_token_ledger drop constraint account_token_ledger_kind_check;
alter table public.account_token_ledger add constraint account_token_ledger_kind_check check(kind in('signup','engagement_allocation','admin_adjustment','engagement_return'));

create function public.return_cancelled_agent_tokens(a uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare acc public.agent_accounts;owner uuid;project public.engagements;lot public.credit_lots;balance bigint;amount bigint;returned bigint;total bigint:=0;key text;begin
 select * into acc from public.agent_accounts where id=a for update;
 select * into project from public.engagements where id=acc.engagement_id;
 if acc.id is null or project.status<>'cancelled' then return 0;end if;
 if acc.visibility='shared' then owner:=project.creator_id;
 else select user_id into owner from public.memberships where engagement_id=acc.engagement_id and role::text=acc.visibility::text;end if;
 -- Never invent ownership of an unfunded/unclaimed private account.
 if owner is null then return 0;end if;
 if not exists(select 1 from public.credit_lots where account_id=a and source='promotional' and available_nano>0) then return 0;end if;
 select available_nano into balance from public.account_token_wallets where user_id=owner for update;
 if balance is null then raise exception 'Token return wallet unavailable';end if;
 -- Purchased lots retain their purchaser/receipt/refund provenance. Token
 -- checkout is disabled; this transfer covers currently issued promo tokens.
 for lot in select * from public.credit_lots where account_id=a and source='promotional' and available_nano>0 order by id for update loop
 amount:=lot.available_nano;returned:=lot.returned_nano+amount;key:='cancel-return:'||lot.id||':'||returned;
 update public.credit_lots set available_nano=0,returned_nano=returned where id=lot.id;
 balance:=balance+amount;total:=total+amount;
 update public.account_token_wallets set available_nano=balance where user_id=owner;
 insert into public.account_token_ledger(user_id,actor_id,kind,amount_nano,balance_after_nano,operation_key,engagement_id,reason)
 values(owner,auth.uid(),'engagement_return',amount,balance,key,acc.engagement_id,'Unused '||acc.visibility::text||' tokens returned after cancellation');
 insert into public.credit_ledger(account_id,kind,amount_nano,operation_key,source)
 values(a,'cancellation_return',-amount,key,'promotional');
 end loop;
 update public.agent_accounts set available_nano=available_nano-total where id=a;
 return total;
end $$;
revoke all on function public.return_cancelled_agent_tokens(uuid) from public,anon,authenticated;
grant execute on function public.return_cancelled_agent_tokens(uuid) to service_role;

create function public.return_engagement_tokens_on_cancel() returns trigger language plpgsql security definer set search_path='' as $$
declare acc record;begin
 -- Lock every source account before any recipient wallet. A concurrent usage
 -- settlement holds one source account and can then finish without a cycle.
 perform 1 from public.agent_accounts where engagement_id=new.id order by id for update;
 perform 1 from public.account_token_wallets where user_id=new.creator_id or user_id in(select user_id from public.memberships where engagement_id=new.id) order by user_id for update;
 for acc in select id from public.agent_accounts where engagement_id=new.id order by id loop
 perform public.return_cancelled_agent_tokens(acc.id);
 end loop;
 return new;
end $$;
revoke all on function public.return_engagement_tokens_on_cancel() from public,anon,authenticated;
create trigger return_cancelled_tokens after update of status on public.engagements for each row when(new.status='cancelled' and old.status is distinct from new.status) execute function public.return_engagement_tokens_on_cancel();

-- Usage can finish after cancellation. Its released reservation (or a later
-- correction) must return too, without double-crediting an earlier transfer.
create function public.return_released_cancelled_tokens() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform public.return_cancelled_agent_tokens(new.id);return new;
end $$;
revoke all on function public.return_released_cancelled_tokens() from public,anon,authenticated;
create trigger return_released_cancelled_tokens after update of available_nano on public.agent_accounts for each row when(new.available_nano>old.available_nano) execute function public.return_released_cancelled_tokens();

-- Match the parent-before-account order used by cancellation; never reserve
-- funds by holding the account while waiting for the engagement row.
do $$declare definition text;signature text;begin
 foreach signature in array array['public.reserve_usage(uuid,uuid,uuid,bigint)','public.admin_adjust_credits(uuid,uuid,uuid,bigint,text)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 definition:=replace(definition,'select * into acc from public.agent_accounts where id=a for update;',
 'perform public.require_open_engagement((select engagement_id from public.agent_accounts where id=a)); select * into acc from public.agent_accounts where id=a for update;');
 execute definition;
 end loop;
end $$;

-- Repair existing cancelled engagements using the same idempotent transfer.
do $$declare acc record;begin
 perform 1 from public.agent_accounts a join public.engagements e on e.id=a.engagement_id where e.status='cancelled' order by a.id for update of a;
 perform 1 from public.account_token_wallets where user_id in(
 select creator_id from public.engagements where status='cancelled'
 union select m.user_id from public.memberships m join public.engagements e on e.id=m.engagement_id where e.status='cancelled'
 ) order by user_id for update;
 for acc in select a.id from public.agent_accounts a join public.engagements e on e.id=a.engagement_id where e.status='cancelled' order by a.id loop
 perform public.return_cancelled_agent_tokens(acc.id);
 end loop;
end $$;
