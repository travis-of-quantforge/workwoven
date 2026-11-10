-- A set snapshot references individually allocated milestones; its entire price
-- must never be offered again as an unallocated balance. Replays retain their
-- original accepted-set reference even if an unrelated milestone was accepted.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.create_payment_request(uuid,uuid,uuid,uuid)'::regprocedure);
 definition:=replace(definition,' or engagement.accepted_version_id is distinct from expected','');
 definition:=replace(definition,' select * into scope from public.scope_versions where id=expected and engagement_id=e;',
 ' if engagement.accepted_version_id is distinct from expected then raise exception ''Accepted agreement changed; refresh'';end if;
 select * into scope from public.scope_versions where id=expected and engagement_id=e;');
 definition:=replace(definition,' else
   cents:=(scope.content->>''priceCents'')::bigint-',
 ' else
   if scope.content ? ''acceptedMilestones'' then raise exception ''No unallocated agreement balance'';end if;
   cents:=(scope.content->>''priceCents'')::bigint-');
 execute definition;
end $$;
