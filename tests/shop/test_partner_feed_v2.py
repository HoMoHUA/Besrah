import importlib.util
import json
import tempfile
import unittest
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('besrah_partner_feed_v2', HERE/'scripts/shop/partner_feed_v2.py')
p = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)
AT = datetime.fromisoformat('2026-11-06T10:00:00+00:00')
IDENTITY = {'brand':'سونی','model':'WH-XB910N','variant':'black / 1 unit', 'warranty':'گارانتی ۱۸ ماهه شرکت الف','condition':'new'}


def feed(src, merchant, price=2000000, dt='2026-11-06T09:00:00Z', **item_changes):
    item = {'sourceProductId':'sku-xb910n-black','title':'هدفون سونی', 'identity':deepcopy(IDENTITY),
            'price':{'amount':price,'currency':'IRT'} if price is not None else None,
            'stock':'unknown','shippingToman':None, 'sourceUrl':f'https://{src}.example.com/products/1'}
    item.update(item_changes)
    return {'schemaVersion':2,'sourceId':src,'merchantId':merchant,'merchant':merchant,
      'licenseRef':'partner-contract-2026-check-required','allowedHosts':[f'{src}.example.com'],
      'observedAt':dt, 'offers':[item]}


def crosswalk(refs=None):
    return {'schemaVersion':2,'groups':[{'canonicalId':'besrah:sony-xb910n-black-warranty18',
            'identity':deepcopy(IDENTITY),
            'verification':{'type':'manual','observedAt':'2026-11-05T10:00:00Z',
            'note':'Matched exact model, color, warranty and condition from both partner records.'},
            'items': refs or [{'sourceId':src,'sourceProductId':'sku-xb910n-black'} for src in ('shopa','shopb')]}]}


class PartnerFeeds(unittest.TestCase):
    def good(self):
        return p.build([feed('shopa','seller-a',2000000), feed('shopb','seller-b',2100000)], crosswalk(), AT)

    def test_two_verified_merchants_lowest_is_scoped_and_provenance_is_retained(self):
        data=self.good()
        self.assertEqual(data['summary']['priceComparableGroups'],1)
        self.assertEqual(data['summary']['sourceCount'],2)
        prod=data['products'][0]
        self.assertTrue(prod['priceComparisonAvailable'])
        self.assertEqual(prod['lowestListedPriceToman'],2000000)
        self.assertFalse(prod['checkoutTotalKnown'])
        self.assertTrue(prod['offers'][0]['cheapestWithinVerifiedGroup'])
        self.assertFalse(prod['offers'][1]['cheapestWithinVerifiedGroup'])
        self.assertEqual(prod['offers'][0]['stock'],'unknown')
        self.assertEqual(prod['offers'][0]['evidence'],'merchant_supplied_snapshot')

    def test_unknown_price_never_counts_as_zero(self):
        data=p.build([feed('shopa','seller-a',None),feed('shopb','seller-b',2100000)],crosswalk(),AT)
        self.assertEqual(data['summary']['priceComparableGroups'],0)
        self.assertIsNone(data['products'][0]['lowestListedPriceToman'])
        self.assertEqual(data['products'][0]['offers'][0]['status'],'price_unknown')

    def test_stale_snapshot_never_gets_cheapest_badge(self):
        data=p.build([feed('shopa','seller-a',2000000,'2026-11-02T10:00:00Z'),feed('shopb','seller-b',2100000)],crosswalk(),AT)
        self.assertEqual(data['summary']['staleOffers'],1)
        self.assertFalse(data['products'][0]['priceComparisonAvailable'])

    def test_different_colour_prevents_false_variant_merges(self):
        f1,f2=feed('shopa','seller-a'),feed('shopb','seller-b')
        f2['offers'][0]['identity']['variant']='white / 1 unit'
        with self.assertRaisesRegex(p.FeedError,'variant_identity_mismatch'):
            p.build([f1,f2],crosswalk(),AT)

    def test_different_warranty_prevents_false_comparison(self):
        f1,f2=feed('shopa','seller-a'),feed('shopb','seller-b')
        f2['offers'][0]['identity']['warranty']='بدون گارانتی'
        with self.assertRaisesRegex(p.FeedError,'variant_identity_mismatch'):
            p.build([f1,f2],crosswalk(),AT)

    def test_unmatched_stays_visible_without_fictitious_mapping(self):
        cw={'schemaVersion':2,'groups':[]}
        data=p.build([feed('shopa','seller-a'),feed('shopb','seller-b')],cw,AT)
        self.assertEqual(data['summary']['unmatchedOffers'],2)
        self.assertEqual(data['products'],[])
        self.assertEqual(data['summary']['priceComparableGroups'],0)

    def test_same_merchant_two_sources_do_not_count_as_competition(self):
        data=p.build([feed('shopa','seller-a'),feed('shopb','seller-a')],crosswalk(),AT)
        self.assertFalse(data['products'][0]['priceComparisonAvailable'])

    def test_rial_conversion_exact_and_no_silent_rounding(self):
        x=feed('shopa','seller-a',price=None)
        x['offers'][0]['price']={'amount':10500000,'currency':'IRR'}
        rows,_=p.normalize_feed(x,AT)
        self.assertEqual(rows[0]['priceToman'],1050000)
        x['offers'][0]['price']['amount']=10500001
        with self.assertRaisesRegex(p.FeedError,'nonintegral_rial'):
            p.normalize_feed(x,AT)

    def test_unsafe_or_unlicensed_provider_link_rejected(self):
        for bad in ('http://shopa.example.com/products/1','https://evil.example.net/foo',
                    'https://user:pass@shopa.example.com/foo','https://shopa.example.com:8443/foo'):
            x=feed('shopa','seller-a',sourceUrl=bad)
            with self.subTest(url=bad), self.assertRaises(p.FeedError):
                p.normalize_feed(x,AT)

    def test_bad_or_missing_manual_proof_is_rejected(self):
        cw=crosswalk();cw['groups'][0]['verification']['type']='automatic'
        with self.assertRaisesRegex(p.FeedError,'identity_not_manually_verified'):
            p.build([feed('shopa','a'),feed('shopb','b')],cw,AT)

    def test_future_observations_rejected(self):
        with self.assertRaisesRegex(p.FeedError,'future_observation'):
            p.normalize_feed(feed('shopa','a',dt='2026-11-07T11:00:00Z'),AT)

    def test_duplicate_item_or_ref_rejected(self):
        f1=feed('shopa','seller-a');f1['offers'].append(deepcopy(f1['offers'][0]))
        with self.assertRaisesRegex(p.FeedError,'duplicate_source_product_id'):
            p.build([f1,feed('shopb','seller-b')],crosswalk(),AT)
        cw=crosswalk();cw['groups'][0]['items'].append(deepcopy(cw['groups'][0]['items'][0]))
        with self.assertRaisesRegex(p.FeedError,'crosswalk_ref_reused'):
            p.build([feed('shopa','seller-a'),feed('shopb','seller-b')],cw,AT)

    def test_deterministic_output_given_fixed_evidence_and_clock(self):
        a=self.good();b=self.good()
        self.assertEqual(json.dumps(a,sort_keys=True),json.dumps(b,sort_keys=True))
        self.assertEqual(a['generatedAt'],'2026-11-06T10:00:00Z')

    def test_cli_does_not_overwrite_a_preexisting_file(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/'a.json').write_text(json.dumps(feed('shopa','seller-a')),encoding='utf-8')
            (root/'b.json').write_text(json.dumps(feed('shopb','seller-b')),encoding='utf-8')
            (root/'crosswalk.json').write_text(json.dumps(crosswalk()),encoding='utf-8')
            output=root/'staging.json'
            args=['--feed',str(root/'a.json'),'--feed',str(root/'b.json'),
                '--crosswalk',str(root/'crosswalk.json'),'--at','2026-11-06T10:00:00Z','--out',str(output)]
            self.assertEqual(p.main(args),0)
            data=json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(data['summary']['priceComparableGroups'],1)
            self.assertEqual(p.main(args),2)
            self.assertEqual(json.loads(output.read_text(encoding='utf-8')),data)

if __name__ == '__main__':
    unittest.main()
