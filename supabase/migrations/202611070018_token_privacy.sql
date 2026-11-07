-- Keep provider economics server-only. Authenticated users retain scoped charge/status reads.
revoke select on public.ai_pricing, public.usage_metering, public.usage_operations from authenticated;
grant select (id, account_id, actor_id, status, charge_nano, usage_uncertain, created_at)
  on public.usage_operations to authenticated;
