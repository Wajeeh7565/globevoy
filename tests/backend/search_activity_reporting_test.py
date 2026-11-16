import importlib.util, pathlib, unittest, json
spec=importlib.util.spec_from_file_location('reporting',pathlib.Path('ops/analytics/daily-counts.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
DAY='2026-11-16';NOW=1000

def row(key,count=1,ttl=2000,day=DAY):
    return {'PK':{'S':'DAY#'+day},'SK':{'S':key},'count':{'N':str(count)},'expiresAt':{'N':str(ttl)}}

class Reporting(unittest.TestCase):
    def test_query_prefixes_and_expiry_filter(self):
        for hourly,prefix in [(False,'COUNT#'),(True,'HOUR#')]:
            cmd=m.command(DAY,hourly,now=NOW);values=json.loads(cmd[cmd.index('--expression-attribute-values')+1]);self.assertEqual(values[':count']['S'],prefix);self.assertEqual(values[':now']['N'],'1000');self.assertEqual(cmd[cmd.index('--filter-expression')+1],'expiresAt > :now');self.assertNotIn('scan',cmd)
    def test_daily_categories_exclude_auxiliary_by_default(self):
        items=[row('COUNT#generated_tour#results',3),row('COUNT#multi_city#empty',2),row('COUNT#fare_calendar#results',8)]
        r=m.summarize(items,DAY,now=NOW);self.assertEqual(sum(x['count']for x in r['counts']),5);self.assertEqual(r['unit'],'backend_actions');self.assertEqual(m.summarize(items,DAY,scope='auxiliary',now=NOW)['counts'][0]['count'],8)
    def test_hourly_aggregation_and_expiry(self):
        items=[row('HOUR#00#recommendations#results',2),row('HOUR#00#multi_city#error',1),row('HOUR#23#generated_tour#empty',4),row('HOUR#00#fare_calendar#results',10),row('HOUR#01#recommendations#results',99,ttl=1000),row('HOUR#02#recommendations#results',99,day='2026-11-15')]
        r=m.summarize(items,DAY,hourly=True,now=NOW);self.assertEqual(len(r['hours']),24);self.assertEqual(r['hours'][0]['count'],3);self.assertEqual(r['hours'][23]['count'],4);self.assertEqual(sum(x['count']for x in r['hours']),7);self.assertEqual(m.summarize(items,DAY,True,'all',NOW)['hours'][0]['count'],13)
    def test_category_hourly_filter(self):
        items=[row('HOUR#10#multi_city#results',3),row('HOUR#10#recommendations#results',8)]
        self.assertEqual(m.summarize(items,DAY,True,now=NOW,category='multi_city')['hours'][10]['count'],3)
        with self.assertRaises(ValueError):m.summarize(items,DAY,True,now=NOW,category='fare_calendar')
    def test_validation(self):
        for day in ['2026-02-30','bad']:
            with self.assertRaises(ValueError):m.command(day)
        with self.assertRaises(ValueError):m.command(DAY,event_id='private')
        with self.assertRaises(ValueError):m.command(DAY,True,'a'*64)
    def test_daily_hourly_reconciliation(self):
        daily=[row('COUNT#generated_tour#results',5)];hourly=[row('HOUR#02#generated_tour#results',2),row('HOUR#03#generated_tour#results',3)]
        self.assertEqual(sum(r['count']for r in m.summarize(daily,DAY,now=NOW)['counts']),sum(r['count']for r in m.summarize(hourly,DAY,True,now=NOW)['hours']))

if __name__=='__main__':unittest.main()
