-- Provider workers can append/read receipts, never rewrite or truncate history.
revoke all on public.payment_ledger from service_role;
grant select,insert on public.payment_ledger to service_role;
