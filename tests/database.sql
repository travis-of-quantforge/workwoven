\set ON_ERROR_STOP on
insert into auth.users values
('00000000-0000-0000-0000-000000000001','client@example.test',now()),
('00000000-0000-0000-0000-000000000002','pro@example.test',now()),
('00000000-0000-0000-0000-000000000003','outsider@example.test',now());
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.create_engagement('Reporting dashboard','client') as engagement \gset
select public.create_engagement('Second project','professional') as pending \gset
select set_config('test.engagement',:'engagement',false);
select set_config('test.pending',:'pending',false);
do $$ begin
 if (select count(*) from public.starter_grants)<>1 then raise exception 'Duplicate grant'; end if;
 if (select funding from public.engagements where id=current_setting('test.pending')::uuid)<>'pending' then raise exception 'Unfunded activation'; end if;
 if (select available_nano from public.agent_accounts where engagement_id=current_setting('test.engagement')::uuid and visibility='shared')<>5000000000 then raise exception 'Missing grant'; end if;
end $$;
select public.send_message(:'engagement','client','PRIVATE SECRET');
select public.send_message(:'engagement','shared','Build a dashboard');
select public.share_content(:'engagement','Only selected content');
select public.register_attachment(:'engagement','client','secret.txt','text/plain',10) as private_path \gset
insert into storage.objects(bucket_id,name) values('engagement-files',:'private_path');
select public.create_invitation(:'engagement','pro@example.test') as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.accept_invitation(:'token');
do $$ begin
 if exists(select 1 from public.messages where body='PRIVATE SECRET') then raise exception 'Private message leak'; end if;
 if exists(select 1 from public.attachments) then raise exception 'Private file metadata leak'; end if;
 if exists(select 1 from storage.objects) then raise exception 'Private storage leak'; end if;
 if exists(select 1 from public.agent_accounts where visibility='client') then raise exception 'Private balance leak'; end if;
 if (select count(*) from public.messages)<>2 then raise exception 'Shared copy missing'; end if;
 if exists(select 1 from public.engagements where id=current_setting('test.pending')::uuid) then raise exception 'Cross engagement leak'; end if;
end $$;
select public.submit_scope(:'engagement','{"deliverables":"Dashboard","exclusions":"Email","assumptions":"CSV available","responsibilities":"Supply data","acceptanceCriteria":"Totals match","priceCents":10000,"currency":"USD","paymentTerms":"On acceptance","schedule":"Two weeks"}',null) as scope \gset
select public.approve_scope(:'scope');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.approve_scope(:'scope');
select set_config('test.scope',:'scope',false);
do $$ begin
 if (select accepted_version_id from public.engagements where id=current_setting('test.engagement')::uuid)<>current_setting('test.scope')::uuid then raise exception 'Dual approval failed'; end if;
end $$;
do $$begin
 begin perform public.submit_scope(current_setting('test.engagement')::uuid,(select content from public.scope_versions where id=current_setting('test.scope')::uuid),current_setting('test.scope')::uuid);raise exception 'Change without explanation allowed';exception when raise_exception then if sqlerrm='Change without explanation allowed' then raise;end if;end;
end $$;
select public.submit_scope(:'engagement','{"deliverables":"Dashboard and email","exclusions":"Hosting","assumptions":"CSV available","responsibilities":"Supply data","acceptanceCriteria":"Totals match","priceCents":12000,"currency":"USD","paymentTerms":"On acceptance","schedule":"Three weeks"}'::jsonb || jsonb_build_object('change',jsonb_build_object('baseVersion',:'scope','reason','Add scheduled email','affectedReferences','Deliverables, price and schedule','costImpact','Additional USD 20 proposed by the professional','scheduleImpact','One additional week')),:'scope');
do $$ begin
 begin perform public.approve_scope(current_setting('test.scope')::uuid); raise exception 'Stale approval allowed';
 exception when raise_exception then if sqlerrm='Stale approval allowed' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin
 if exists(select 1 from public.messages) or exists(select 1 from public.engagements) then raise exception 'Outsider access'; end if;
 begin perform public.send_message(current_setting('test.engagement')::uuid,'shared','attack'); raise exception 'Write bypass';
 exception when raise_exception then if sqlerrm='Write bypass' then raise; end if; end;
end $$;
\echo 'Database assertions passed'
