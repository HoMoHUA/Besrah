#!/usr/bin/env python3
"""Acceptance against isolated real-model previews, never Production."""
import datetime as dt
import hashlib,json,os,time,unittest,urllib.request,urllib.error,urllib.parse
from pathlib import Path
from zoneinfo import ZoneInfo
from typing import Any
ON=int(os.environ.get('R3A_ON_PORT','18881'));OFF=int(os.environ.get('R3A_OFF_PORT','18882'));STRICT=int(os.environ.get('R3A_STRICT_PORT','18883'));BEFORE=int(os.environ.get('R3A_BASE_PORT','18880'))
test_day=dt.datetime.now(ZoneInfo('Asia/Tehran')).date()+dt.timedelta(days=1)
if test_day.weekday()==4:
 test_day+=dt.timedelta(days=1)  # This scenario deliberately exercises the unverified weekday baseline.
TOMORROW=test_day.isoformat()
EVIDENCE=[]; count=0

def get(port: int, path: str, method: str = 'GET') -> tuple[int, Any, bytes]:
 global count
 assert port not in [3080,8045] and 1024<=port<=65535
 count+=1
 req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,method=method,headers={'X-Real-IP':f'127.0.1.{count%250+1}','Content-Type':'application/json'},data=b'{}' if method=='POST' else None)
 t=time.perf_counter()
 try:
  with urllib.request.urlopen(req,timeout=12) as r:status=r.status;raw=r.read()
 except urllib.error.HTTPError as e:status=e.code;raw=e.read()
 try: data=json.loads(raw)
 except ValueError:data={}
 if not isinstance(data,dict):data={}
 EVIDENCE.append({'port':port,'path':path,'http':status,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'ms':round((time.perf_counter()-t)*1000,3),'modelStatus':data.get('status')})
 return status,data,raw

def journey(line,origin,destination,**kwargs):
 q=dict(line=str(line),**{'from':origin,'to':destination},date=TOMORROW,time='10:00');q.update(kwargs)
 return '/app/api/journey?'+urllib.parse.urlencode(q)

class PreviewHTTP(unittest.TestCase):
 def test_01_config_and_no_feedback_writes(self):
  for p,enabled in [(ON,True),(OFF,False),(STRICT,True)]:
   status,data,_=get(p,'/app/api/beta');self.assertEqual(status,200);self.assertEqual(data['journey']['enabled'],enabled);self.assertFalse(data['journey']['feedbackEnabled']);self.assertEqual(data['journey']['rolloutPercent'],0)
   status,_,_=get(p,'/app/api/journey-feedback','POST');self.assertEqual(status,503 if enabled else 404)
 def test_02_real_model_both_lines_both_directions(self):
  for line,a,b,toward in [(1,'METRO-107','METRO-108',{'غدیر','فرودگاه'}),(1,'METRO-108','METRO-107',{'وکیل آباد'}),(2,'METRO-201','METRO-203',{'شهید فکوری'}),(2,'METRO-203','METRO-201',{'طبرسی'})]:
   with self.subTest(line=line,a=a,b=b):
    status,d,_=get(ON,journey(line,a,b));self.assertEqual(status,200);self.assertIn(d['status'],['ok','partial']);self.assertGreater(len(d['options']),1)
    self.assertEqual({o['toward'] for o in d['options']},toward);self.assertTrue(d['modelOnly']);self.assertFalse(d['live'])
    self.assertEqual(d['calendar']['state'],'estimated');self.assertTrue(d['calendar']['warning'])
    ready=dt.datetime.fromisoformat(d['request']['readyAt']).timestamp()
    for o in d['options']:
     self.assertGreaterEqual(o['departEpoch'],ready);self.assertGreater(o['arriveEpoch'],o['departEpoch']);self.assertLessEqual(abs(o['waitSeconds']-(o['departEpoch']-ready)),1);self.assertLessEqual(abs(o['inVehicleSeconds']-(o['arriveEpoch']-o['departEpoch'])),1)
     self.assertRegex(o['departAt'],r'^\d\d:\d\d$');self.assertRegex(o['arriveAt'],r'^\d\d:\d\d$')
    minimum=min(o['arriveEpoch'] for o in d['options']);self.assertTrue(all(o['arriveEpoch']==minimum for o in d['options'] if o['earliestArrival']))
 def test_03_airport_extension_not_ghadir_ride(self):
  status,d,_=get(ON,journey(1,'METRO-107','METRO-124'));self.assertEqual(status,200);self.assertTrue(d['options']);self.assertEqual({o['toward'] for o in d['options']},{'فرودگاه'})
 def test_04_strict_unknown_calendar_is_empty(self):
  status,d,_=get(STRICT,journey(1,'METRO-107','METRO-108'));self.assertEqual(status,200);self.assertEqual(d['status'],'insufficient_data');self.assertEqual(d['calendar']['state'],'unknown');self.assertEqual(d['options'],[])
 def test_05_night_empty_with_incomplete_calendar_stays_unknown(self):
  # The real baseline calendar is incomplete, so absence cannot honestly be declared no-service.
  # no_feasible_option rendering is separately tested with an explicitly labelled edge fixture.
  status,d,_=get(ON,journey(1,'METRO-107','METRO-108',time='00:05'));self.assertEqual(status,200);self.assertEqual(d['status'],'insufficient_data');self.assertEqual(d['reason'],'incomplete_calendar_source_or_candidate_coverage');self.assertEqual(d['options'],[]);self.assertFalse(d['coverage']['complete'])
 def test_06_invalid_and_off(self):
  for path in [journey(1,'METRO-107','METRO-107'),journey(1,'METRO-107','METRO-201'),journey(3,'METRO-107','METRO-108')]:self.assertEqual(get(ON,path)[0],400)
  self.assertEqual(get(OFF,journey(1,'METRO-107','METRO-108'))[0],404)
 def test_07_missed_departure_is_not_returned(self):
  _,d,_=get(ON,journey(1,'METRO-107','METRO-108'));first=d['options'][0]
  later=dt.datetime.fromtimestamp(first['departEpoch'],ZoneInfo('Asia/Tehran'))+dt.timedelta(minutes=1)
  status,n,_=get(ON,journey(1,'METRO-107','METRO-108',time=later.strftime('%H:%M')));self.assertEqual(status,200);self.assertNotIn(first['id'],[o['id'] for o in n['options']]);self.assertTrue(all(o['departEpoch']>=later.replace(second=0,microsecond=0).timestamp() for o in n['options']))
 def test_08_legacy_api_byte_parity(self):
  """Baseline (deployed R2a-PB build) vs candidate over every legacy path.
  Contract (NET01-QG): bytes equal, OR equal after dropping the declared identity-only fields, OR a declared line-1
  Sat-Wed timetable change. Without a reachable baseline server the test FAILS as BLOCKED; it never passes vacuously."""
  import importlib.util
  root=Path(__file__).resolve().parents[2]
  def load(name,rel):
   spec=importlib.util.spec_from_file_location(name,root/rel)
   if spec is None or spec.loader is None:raise RuntimeError('Cannot load '+rel)
   mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
  legacy=load('legacy_paths','scripts/preflight_api_regression.py');parity=load('http_parity','scripts/net01/http_parity.py')
  try:
   urllib.request.urlopen(f'http://127.0.0.1:{BEFORE}/health',timeout=3).read()
  except OSError as e:
   self.fail(f'BLOCKED: baseline server on port {BEFORE} is not reachable ({e}); start a clean build of the deployed commit first')
  paths=[p for p in legacy.paths(root) if (p.startswith('/app/api/') or p=='/health') and not p.startswith('/app/api/food-status')]
  self.assertGreater(len(paths),40)
  for path in paths:
   a=parity.get(BEFORE,path,'127.0.1.1');b=parity.get(ON,path,'127.0.1.2')
   self.assertNotIn(429,(a[0],b[0]),path)
   if (a[0],a[2])==(b[0],b[2]) or parity.norm(*a)==parity.norm(*b):continue
   self.assertEqual(parity.scope_of(path),'l1n','undeclared difference: '+path)

if __name__=='__main__':
 suite=unittest.defaultTestLoader.loadTestsFromTestCase(PreviewHTTP);r=unittest.TextTestRunner(verbosity=2).run(suite)
 out=Path(os.environ.get('R3A_HTTP_EVIDENCE','/root/.hermes/cache/scratch/r3a-http.json'));out.write_text(json.dumps({'realModel':True,'fixture':False,'date':TOMORROW,'testsRun':r.testsRun,'failures':len(r.failures),'errors':len(r.errors),'requests':EVIDENCE},indent=2))
 raise SystemExit(not r.wasSuccessful())
