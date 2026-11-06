#!/usr/bin/env python3
"""Offline, opt-in price-drop candidate generator for verified Besrah Shop V2 snapshots.

No notifications, personal accounts, web requests, secrets or automatic orders.
Only reports grounded changes to the lowest *listed* comparable price.
"""
from __future__ import annotations
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def fail(text):
    raise ValueError(text)


def utc(value):
    if not isinstance(value, str):
        fail('missing_or_invalid_timestamp')
    try:
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        fail('invalid_timestamp')
    if date.tzinfo is None:
        fail('timestamp_requires_timezone')
    return date.astimezone(timezone.utc)


def validate_catalog(catalog):
    if not isinstance(catalog, dict) or catalog.get('schemaVersion') != 2 or not isinstance(catalog.get('products'), list):
        fail('unsupported_catalog_schema')
    return catalog


def validate_watchlist(obj):
    if not isinstance(obj, dict) or obj.get('schemaVersion') != 1 or obj.get('userOptIn') is not True:
        fail('missing_explicit_user_opt_in')
    watches = obj.get('watches')
    if not isinstance(watches, list) or len(watches) > 50:
        fail('invalid_watchlist')
    seen = set()
    for w in watches:
        if not isinstance(w, dict) or set(w) != {'canonicalId', 'minDropPercent', 'maxPriceToman'}:
            fail('invalid_watch')
        if not isinstance(w['canonicalId'], str) or not w['canonicalId'].startswith('besrah:'):
            fail('invalid_canonical_id')
        if w['canonicalId'] in seen:
            fail('duplicate_watch_id')
        seen.add(w['canonicalId'])
        if type(w['minDropPercent']) not in (int, float) or not 0 < w['minDropPercent'] <= 90:
            fail('invalid_minimum_drop')
        if w['maxPriceToman'] is not None and (type(w['maxPriceToman']) is not int or w['maxPriceToman'] <= 0):
            fail('invalid_price_threshold')
    return watches


def candidate_changes(previous, current, watchlist, now):
    previous, current = validate_catalog(previous), validate_catalog(current)
    watches = validate_watchlist(watchlist)
    t0, t1 = utc(previous['generatedAt']), utc(current['generatedAt'])
    if t1 <= t0:
        fail('catalog_not_forward_in_time')
    if t1 > now or (now - t1).total_seconds() > 48 * 3600:
        fail('current_snapshot_not_recent')
    p0 = {p['canonicalId']: p for p in previous['products']}
    p1 = {p['canonicalId']: p for p in current['products']}
    events=[]
    for w in watches:
        key=w['canonicalId']
        old,new=p0.get(key),p1.get(key)
        if not old or not new or old['identity'] != new['identity']:
            continue
        if not (old.get('priceComparisonAvailable') is True and new.get('priceComparisonAvailable') is True):
            continue
        before,after=old.get('lowestListedPriceToman'),new.get('lowestListedPriceToman')
        if type(before) is not int or type(after) is not int or not 0 < after < before:
            continue
        # The last snapshot must contain at least two current independent, valid
        # merchants; no single erroneous price can trigger an alert candidate.
        candidates=[o for o in new.get('offers',[]) if o.get('status')=='candidate' and
            type(o.get('priceToman')) is int and o['priceToman']>0 and utc(o['validUntil']) >= now]
        if len({o.get('merchantId') for o in candidates}) < 2:
            continue
        decline=round((before-after)*100/before,2)
        if decline < w['minDropPercent'] or (w['maxPriceToman'] is not None and after > w['maxPriceToman']):
            continue
        events.append({'canonicalId':key, 'previousLowestListedToman':before, 'currentLowestListedToman':after,
            'dropPercent':decline, 'observedAt':current['generatedAt'],
            'statement':'Candidate only: lower listed snapshot price in a curated same-variant group. Verify seller checkout before purchase.',
            'deliveryStatus':'not_sent'})
    return {'schemaVersion':1, 'evaluatedAt':now.isoformat(), 'events':events,
        'note':'No notifications were sent; this output does not authorize any payment/order or prove live stock or shipping.'}


def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--previous',required=True); ap.add_argument('--current',required=True)
    ap.add_argument('--watchlist',required=True); ap.add_argument('--at',required=True)
    ap.add_argument('--out',required=True)
    a=ap.parse_args(argv)
    try:
        old=json.loads(Path(a.previous).read_text(encoding='utf-8'))
        new=json.loads(Path(a.current).read_text(encoding='utf-8'))
        watches=json.loads(Path(a.watchlist).read_text(encoding='utf-8'))
        result=candidate_changes(old,new,watches,utc(a.at))
        target=Path(a.out)
        if target.exists():
            fail('output_already_exists')
        target.write_text(json.dumps(result,ensure_ascii=False,indent=2,sort_keys=True)+'\n',encoding='utf8')
        print(json.dumps({'events':len(result['events']), 'output':str(target)},ensure_ascii=False))
        return 0
    except (ValueError,OSError,KeyError,TypeError) as ex:
        print('price-watch validation failure: '+str(ex),file=sys.stderr)
        return 2


if __name__=='__main__':
    sys.exit(main())
