"""IAM-only daily/hourly backend-action counts. No scan or customer identity."""
import argparse, datetime, json, re, subprocess, time
PRIMARY = {'recommendations', 'mixed_results', 'multi_city', 'generated_tour'}
AUXILIARY = {'date_adjustment', 'route_adjustment', 'fare_calendar', 'flex_windows', 'one_way_lookup'}

def command(day, hourly=False, event_id=None, now=None):
    if datetime.date.fromisoformat(day).isoformat() != day:
        raise ValueError('Use YYYY-MM-DD')
    if event_id and not re.fullmatch('[a-f0-9]{64}', event_id):
        raise ValueError('Invalid event ID')
    if hourly and event_id:
        raise ValueError('Choose an event or hourly report')
    prefix = 'EVENT#'+event_id if event_id else ('HOUR#' if hourly else 'COUNT#')
    values = {':day': {'S': 'DAY#'+day}, ':count': {'S': prefix}, ':now': {'N': str(int(time.time() if now is None else now))}}
    return ['aws', 'dynamodb', 'query', '--region', 'us-east-2', '--table-name', 'globevoy-production-activity-events',
            '--key-condition-expression', 'PK = :day AND SK = :count' if event_id else 'PK = :day AND begins_with(SK, :count)',
            '--expression-attribute-values', json.dumps(values), '--filter-expression', 'expiresAt > :now', '--consistent-read', '--output', 'json']

def summarize(items, day, hourly=False, scope='primary', now=None, category=None):
    if scope not in {'primary','auxiliary','all'}:
        raise ValueError('Invalid scope')
    allowed = PRIMARY if scope == 'primary' else AUXILIARY if scope == 'auxiliary' else PRIMARY | AUXILIARY
    if category is not None:
        if category not in allowed:
            raise ValueError('Category is outside the selected scope')
        allowed = {category}
    current = int(time.time() if now is None else now)
    rows=[]; hours=[0]*24
    for item in items:
        if int(item['expiresAt']['N']) <= current or item['PK']['S'] != 'DAY#'+day:
            continue
        parts=item['SK']['S'].split('#')
        if hourly:
            if len(parts)!=4 or parts[0]!='HOUR':
                continue
            hour=int(parts[1]); category,outcome=parts[2:]
            if not 0<=hour<=23:
                raise ValueError('Invalid stored UTC hour')
        else:
            if len(parts)!=3 or parts[0]!='COUNT':
                continue
            category,outcome=parts[1:]
        if category not in allowed:
            continue
        count=int(item['count']['N'])
        if count<0:
            raise ValueError('Invalid stored count')
        if hourly:
            hours[hour]+=count
        else:
            rows.append({'category':category,'outcome':outcome,'count':count})
    report={'utcDate':day,'scope':scope,'unit':'backend_actions'}
    if hourly:
        report['hours']=[{'utcHour':h,'count':n} for h,n in enumerate(hours)]
    else:
        report['counts']=sorted(rows,key=lambda r:(r['category'],r['outcome']))
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--day',required=True); p.add_argument('--event-id'); p.add_argument('--hourly',action='store_true')
    p.add_argument('--scope',choices=['primary','auxiliary','all'],default='primary')
    p.add_argument('--category',choices=sorted(PRIMARY|AUXILIARY))
    a=p.parse_args()
    try:
        args=command(a.day,a.hourly,a.event_id)
        if a.category and a.category not in (PRIMARY if a.scope=='primary' else AUXILIARY if a.scope=='auxiliary' else PRIMARY|AUXILIARY):
            raise ValueError('Category is outside the selected scope')
    except ValueError as error:
        p.error(str(error))
    r=subprocess.run(args,capture_output=True,text=True)
    if r.returncode:
        raise SystemExit('Read failed; verify operator IAM/session. No retry.')
    d=json.loads(r.stdout)
    if d.get('LastEvaluatedKey'):
        raise SystemExit('Unexpected unfinished pagination; do not publish partial counts')
    if a.event_id:
        current=int(time.time()); result=[x for x in d['Items'] if int(x['expiresAt']['N'])>current]
    else:
        result=summarize(d['Items'],a.day,a.hourly,a.scope,category=a.category)
    print(json.dumps(result,indent=2))

if __name__ == '__main__':
    main()
