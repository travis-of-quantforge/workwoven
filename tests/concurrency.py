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
    return require(f"set role authenticated; select set_config('request.jwt.claim.sub','{uid}',false); select public.create_engagement('Concurrent {i}','client');")
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    list(executor.map(create,range(4)))
assert require(f"select count(*) from public.starter_grants where user_id='{uid}'")=='1'
assert require(f"select count(*) from public.engagements where creator_id='{uid}' and funding='funded'")=='1'
account=require(f"select a.id from public.agent_accounts a join public.engagements e on e.id=a.engagement_id where e.creator_id='{uid}' and e.funding='funded' and a.visibility='shared'")
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
