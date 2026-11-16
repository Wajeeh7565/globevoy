"""Read only; IAM-authenticated operator query, never a public analytics API."""
import argparse,datetime,subprocess,json,re,time
p=argparse.ArgumentParser();p.add_argument('--day',required=True);p.add_argument('--event-id');a=p.parse_args();
if a.event_id:assert re.fullmatch('[a-f0-9]{64}',a.event_id)
assert datetime.date.fromisoformat(a.day).isoformat()==a.day
r=subprocess.run(['aws','dynamodb','query','--region','us-east-2','--table-name','globevoy-production-activity-events','--key-condition-expression','PK = :day AND SK = :count' if a.event_id else 'PK = :day AND begins_with(SK, :count)','--expression-attribute-values',json.dumps({':day':{'S':'DAY#'+a.day},':count':{'S':'EVENT#'+a.event_id if a.event_id else 'COUNT#'},':now':{'N':str(int(time.time()))}}),'--filter-expression','expiresAt > :now','--consistent-read','--output','json'],capture_output=True,text=True)
if r.returncode:raise SystemExit('Read failed; verify operator read policy and AWS session. No retry.')
d=json.loads(r.stdout);assert not d.get('LastEvaluatedKey'),'Unexpected count pagination; stop'
if a.event_id:print(json.dumps(d['Items'],indent=2));raise SystemExit(0)
print(json.dumps([{'categoryOutcome':x['SK']['S'][6:],'count':int(x['count']['N'])} for x in d['Items']],indent=2))
