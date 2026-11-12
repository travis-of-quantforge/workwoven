"""Concurrent creation and reservation tests against an isolated fixture database."""
import concurrent.futures
import subprocess

def sql(query):
    return subprocess.run(['psql','-X','-At','-v','ON_ERROR_STOP=1','-c',query],capture_output=True,text=True)

def require(query):
    result=sql(query)
    assert result.returncode==0,result.stderr
    return result.stdout.strip()

uid='00000000-0000-0000-0000-000000000004'
require(f"insert into auth.users values ('{uid}','race@example.test',now())")
def create(i):
    return sql(f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false); select public.create_engagement('Concurrent {i}','client');")
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    creation_results=list(executor.map(create,range(4)))
assert sum(r.returncode==0 for r in creation_results)==2
assert all(r.returncode==0 or "50 available tokens" in r.stderr for r in creation_results)
assert require(f"select available_nano from public.account_token_wallets where user_id='{uid}'")=='1000000000'
assert require(f"select count(*) from public.starter_grants where user_id='{uid}'")=='1'
assert require(f"select count(*) from public.engagements where creator_id='{uid}' and funding='funded'")=='2'
account=require(f"select a.id from public.agent_accounts a join public.engagements e on e.id=a.engagement_id where e.creator_id='{uid}' and e.funding='funded' and a.visibility='shared' order by e.created_at,e.id limit 1")
def reserve(i):
    return sql(f"select public.reserve_usage('{account}','{uid}','20000000-0000-0000-0000-{i:012d}',1000000000)").returncode
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    outcomes=list(executor.map(reserve,range(8)))
assert outcomes.count(0)==5,outcomes
assert require(f"select available_nano||':'||reserved_nano from public.agent_accounts where id='{account}'")=='0:5000000000'

# The same row lock serialises competing scope submissions and party approvals.
import json
engagement=require(f"select engagement_id from public.agent_accounts where id='{account}'")
token=require(f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false); select public.create_invitation('{engagement}','pro@example.test')").splitlines()[-1]
pro='00000000-0000-0000-0000-000000000002'
require(f"set role authenticated; select set_config('request.jwt.claim.sub','{pro}',false); select public.accept_invitation('{token}')")
content=json.dumps(dict(deliverables='Dashboard',exclusions='Email',assumptions='CSV',responsibilities='Data',acceptanceCriteria='Totals match',priceCents=10000,currency='USD',paymentTerms='On acceptance',schedule='Two weeks'))
def submit(side):
    return sql(f"set role authenticated; select set_config('request.jwt.claim.sub','{side}',false); select public.submit_scope('{engagement}','{content}',null)").returncode
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    outcomes=list(executor.map(submit,[uid,pro]))
assert outcomes.count(0)==1,outcomes
version=require(f"select id from public.scope_versions where engagement_id='{engagement}'")
def approve(side):
    return require(f"set role authenticated; select set_config('request.jwt.claim.sub','{side}',false); select public.approve_scope('{version}')")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    list(executor.map(approve,[uid,pro]))
assert require(f"select accepted_version_id from public.engagements where id='{engagement}'")==version
assert require(f"select count(*) from public.approvals where version_id='{version}'")=='2'

# Native milestone submissions/acceptances serialize independently and retries
# cannot multiply immutable versions, snapshots, or discussion events.
rows=json.dumps([dict(description='Concurrent dashboard',amountCents=10000,targetDate='2026-12-20',acceptanceCriteria='CSV totals match',responsibilities='Supply CSV')])
operation='99000000-0000-4000-8000-000000000099'
def native_submit(_):
    return require(f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false); select public.submit_individual_milestones('{engagement}','{rows}','{operation}')")
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    results=list(executor.map(native_submit,range(3)))
assert len(set(results))==1,results
milestone=require(f"select id from public.milestones where engagement_id='{engagement}'")
native_version=require(f"select latest_version_id from public.milestones where id='{milestone}'")
def native_accept(_):
    return require(f"set role authenticated; select set_config('request.jwt.claim.sub','{pro}',false); select public.accept_milestone('{native_version}')")
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    list(executor.map(native_accept,range(3)))
assert require(f"select count(*) from public.milestone_versions where milestone_id='{milestone}'")=='1'
assert require(f"select count(*) from public.milestone_events where version_id='{native_version}' and event='accepted'")=='1'
def amend(side):
    import uuid
    return sql(f"set role authenticated; select set_config('request.jwt.claim.sub','{side}',false); select public.submit_individual_milestones('{engagement}','{rows}','{uuid.uuid4()}','{milestone}','{native_version}','Concurrent deadline review')").returncode
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    outcomes=list(executor.map(amend,[uid,pro]))
assert outcomes.count(0)==1,outcomes
assert require(f"select count(*) from public.milestone_versions where milestone_id='{milestone}'")=='2'
assert require(f"select accepted_version_id from public.milestones where id='{milestone}'")==native_version

# Concurrent sandbox checkout/refund reservations use deterministic local SQL
# receipts only. No provider request or real payment is made by this suite.
import uuid
require(f"insert into public.paypal_sellers(user_id,merchant_id,payments_enabled,refunds_enabled,verified_at) values('{pro}','ABCDEFGHIJKLM',true,true,now()) on conflict(user_id) do update set payments_enabled=true,refunds_enabled=true,verified_at=now()")
bonus=require(f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false); select public.create_adhoc_payment_request('{engagement}','bonus','Isolated concurrency fixture',10000,'{uuid.uuid4()}')").splitlines()[-1]
def checkout(_):
    return require(f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false); select public.begin_paypal_payment('{bonus}','{uuid.uuid4()}')").splitlines()[-1]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    checkout_results=list(executor.map(checkout,range(4)))
assert len(set(checkout_results))==1,checkout_results
payment=checkout_results[0]
require(f"select public.record_paypal_payment('{payment}','CONCURRENTORDER','CONCURRENTCAPTURE','completed')")
def refund(_):
    return sql(f"set role authenticated; select set_config('request.jwt.claim.sub','{pro}',false); select public.begin_paypal_refund('{payment}',4000,'Isolated partial refund','{uuid.uuid4()}')").returncode
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    refund_results=list(executor.map(refund,range(3)))
assert refund_results.count(0)==2,refund_results
assert require(f"select sum(amount_cents) from public.payment_refunds where payment_id='{payment}' and status='processing'")=='8000'
refund_key=str(uuid.uuid4())
def refund_replay(_):
    return require(f"set role authenticated; select set_config('request.jwt.claim.sub','{pro}',false); select public.begin_paypal_refund('{payment}',1000,'Concurrent replay','{refund_key}')").splitlines()[-1]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    refund_replays=list(executor.map(refund_replay,range(3)))
assert len(set(refund_replays))==1,refund_replays
assert require(f"select sum(amount_cents) from public.payment_refunds where payment_id='{payment}' and status='processing'")=='9000'

# Cancellation and capture must never both win the same pending checkout.
for attempt in range(4):
    request=require(f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false); select public.create_adhoc_payment_request('{engagement}','bonus','Cancellation race',500,'{uuid.uuid4()}')").splitlines()[-1]
    checkout_id=require(f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false); select public.begin_paypal_payment('{request}','{uuid.uuid4()}')").splitlines()[-1]
    order_id=f'CANCELRACE{attempt}'
    require(f"select public.record_paypal_payment('{checkout_id}','{order_id}',null,'approval_pending')")
    queries=[f"select public.cancel_paypal_checkout('{checkout_id}','{uid}','{order_id}')",
             f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false); select public.authorize_paypal_capture('{checkout_id}')"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results=list(executor.map(sql,queries))
    assert sum(result.returncode==0 for result in results)==1,[(result.returncode,result.stderr) for result in results]
    assert require(f"select status from public.payment_transactions where id='{checkout_id}'") in ('cancelled','processing')

# Contract proposals serialize on the engagement; both parties approve the
# exact winning version, with no approval inferred from submission.
contract_text='Only CSV dashboards are included. Email reports require an approved revision.'
def propose_contract(actor):
    return sql(f"set role authenticated; select set_config('request.jwt.claim.sub','{actor}',false); select public.propose_contract('{engagement}','{contract_text}',null,'{uuid.uuid4()}')")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    contract_results=list(executor.map(propose_contract,[uid,pro]))
assert sum(result.returncode==0 for result in contract_results)==1
contract_version=require(f"select latest_version_id from public.engagement_contracts where engagement_id='{engagement}'")
assert require(f"select count(*) from public.contract_approvals where version_id='{contract_version}'")=='0'
def approve_contract(actor):
    return require(f"set role authenticated; select set_config('request.jwt.claim.sub','{actor}',false); select public.approve_contract('{contract_version}')")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    list(executor.map(approve_contract,[uid,pro]))
assert require(f"select accepted_version_id from public.engagement_contracts where engagement_id='{engagement}'")==contract_version
assert require(f"select count(*) from public.contract_approvals where version_id='{contract_version}'")=='2'

# A stale message waits on the parent lock and is rejected after cancellation.
import time
accepted=require(f"select accepted_version_id from public.engagements where id='{engagement}'")
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
    closing=executor.submit(sql,f"/* closed-lock-race */ begin; select set_config('request.jwt.claim.sub','{uid}',false); select id from public.engagements where id='{engagement}' for update; select pg_sleep(1); set role authenticated; select public.close_engagement('{engagement}','cancelled','{accepted}','Concurrency lock fixture ending.'); commit;")
    for _ in range(100):
        if require("select exists(select 1 from pg_stat_activity where query like '/* closed-lock-race */%' and wait_event='PgSleep')")=='t':
            break
        time.sleep(0.02)
    else:
        raise AssertionError('Closure fixture did not acquire its parent lock')
    late=sql(f"set role authenticated; select set_config('request.jwt.claim.sub','{pro}',false); select public.send_message('{engagement}','shared','This must not arrive after closure')")
    assert late.returncode!=0 and 'read-only' in late.stderr,late.stderr
    result=closing.result()
    assert result.returncode==0,result.stderr
assert require(f"select count(*) from public.messages where engagement_id='{engagement}' and body='This must not arrive after closure'")=='0'

# Released reservations after cancellation are credited once, even on replays.
operations=require(f"select id from public.usage_operations where account_id='{account}' and status='reserved'").splitlines()
def release_cancelled(op):
    return require(f"select public.settle_usage('{op}',0,'internal_error','{{}}')")
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    list(executor.map(release_cancelled,operations+operations))
assert require(f"select available_nano from public.account_token_wallets where user_id='{uid}'")=='6000000000'
assert require(f"select available_nano||':'||reserved_nano from public.agent_accounts where id='{account}'")=='0:0'

# A reservation cannot hold the source account while cancellation waits on it.
other=require(f"select id from public.engagements where creator_id='{uid}' and id<>'{engagement}'")
other_account=require(f"select id from public.agent_accounts where engagement_id='{other}' and visibility='shared'")
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
    closing=executor.submit(sql,f"/* cancelled-reserve-race */ begin; select set_config('request.jwt.claim.sub','{uid}',false); select id from public.engagements where id='{other}' for update; select pg_sleep(1); set role authenticated; select public.close_engagement('{other}','cancelled',null,'Reservation race fixture.'); commit;")
    for _ in range(100):
        if require("select exists(select 1 from pg_stat_activity where query like '/* cancelled-reserve-race */%' and wait_event='PgSleep')")=='t':break
        time.sleep(0.02)
    else:raise AssertionError('Cancellation did not acquire parent lock')
    late=sql(f"select public.reserve_usage('{other_account}','{uid}','{uuid.uuid4()}',100000000)")
    assert late.returncode!=0 and 'read-only' in late.stderr,late.stderr
    result=closing.result();assert result.returncode==0,result.stderr
assert require(f"select available_nano from public.account_token_wallets where user_id='{uid}'")=='11000000000'
