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
