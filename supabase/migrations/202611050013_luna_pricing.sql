-- Luna cache writes have distinct billing. Initial integration explicitly disables
-- all prompt caching for this model; only metered uncached input/output are used.
alter table public.ai_pricing add column cache_mode text not null default 'implicit' check(cache_mode in('implicit','disabled'));
insert into public.ai_pricing(model,version,input_nano_per_token,cached_nano_per_token,output_nano_per_token,source_url,cache_mode)
values('gpt-6-luna','2026-11-05-standard-no-cache',100,10,500,'https://developers.openai.com/api/docs/pricing','disabled');
