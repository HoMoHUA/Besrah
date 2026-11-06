import importlib.util
import unittest
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from pathlib import Path
HERE=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('price_watch_v2',HERE/'scripts/shop/price_watch_v2.py')
p=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(p)
NOW=datetime.fromisoformat('2026-11-06T10:00:00+00:00')
V={'brand':'سونی','model':'a1','variant':'black','warranty':'18-month','condition':'new'}

def catalog(time,price,merchants=('a','b')):
    return {'schemaVersion':2,'generatedAt':time,'products':[{'canonicalId':'besrah:sony-a1','identity':dict(V),
        'priceComparisonAvailable':True,'lowestListedPriceToman':price,'offers':[
        {'merchantId':m,'status':'candidate','priceToman':price+i*1000,'validUntil':'2026-11-08T09:00:00Z'} for i,m in enumerate(merchants)]}]}

def watches():
    return {'schemaVersion':1,'userOptIn':True,'watches':[{'canonicalId':'besrah:sony-a1','minDropPercent':5,'maxPriceToman':None}]}

class SafePriceWatch(unittest.TestCase):
    def setUp(self):
        self.old=catalog('2026-11-05T10:00:00Z',2000000)
        self.new=catalog('2026-11-06T09:00:00Z',1700000)
    def evaluate(self,w=None):
        return p.candidate_changes(self.old,self.new,w or watches(),NOW)
    def test_optin_drop_detected_but_no_notification_sent(self):
        d=self.evaluate()
        self.assertEqual(d['events'][0]['dropPercent'],15.0)
        self.assertEqual(d['events'][0]['deliveryStatus'],'not_sent')
    def test_requires_explicit_optin(self):
        w=watches();w['userOptIn']=False
        with self.assertRaisesRegex(ValueError,'missing_explicit_user_opt_in'):
            self.evaluate(w)
    def test_warranty_or_identity_change_suppresses_alert(self):
        self.new['products'][0]['identity']['warranty']='بدون گارانتی'
        self.assertEqual(self.evaluate()['events'],[])
    def test_stale_current_snapshot_rejected(self):
        with self.assertRaisesRegex(ValueError,'current_snapshot_not_recent'):
            p.candidate_changes(self.old,self.new,watches(),NOW+timedelta(days=4))
    def test_unknown_or_uncomparable_prices_suppressed(self):
        self.new['products'][0]['priceComparisonAvailable']=False
        self.assertEqual(self.evaluate()['events'],[])
        self.new['products'][0]['priceComparisonAvailable']=True
        self.new['products'][0]['lowestListedPriceToman']=None
        self.assertEqual(self.evaluate()['events'],[])
    def test_two_independent_merchants_required(self):
        self.new=catalog('2026-11-06T09:00:00Z',1500000,('a','a'))
        self.assertEqual(self.evaluate()['events'],[])
    def test_user_budget_threshold_respected(self):
        w=watches();w['watches'][0]['maxPriceToman']=1000000
        self.assertEqual(self.evaluate(w)['events'],[])
    def test_small_price_change_not_alerted(self):
        self.new['products'][0]['lowestListedPriceToman']=1960000
        self.assertEqual(self.evaluate()['events'],[])
    def test_old_and_new_must_be_ordered(self):
        self.new['generatedAt']=self.old['generatedAt']
        with self.assertRaisesRegex(ValueError,'catalog_not_forward_in_time'):
            self.evaluate()

if __name__=='__main__':unittest.main()
