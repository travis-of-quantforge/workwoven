-- Qualify the JSON element: the PL/pgSQL loop variable c otherwise shadows
-- the source alias and can aggregate nulls instead of stored references.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.conversation_evidence_availability(uuid)'::regprocedure);
 definition:=replace(definition,'jsonb_agg(c)','jsonb_agg(evidence_ref.value)');
 definition:=replace(definition,'jsonb_array_elements(f.evidence||f.resolution_evidence) c where','jsonb_array_elements(f.evidence||f.resolution_evidence) evidence_ref(value) where');
 execute definition;
end $$;
