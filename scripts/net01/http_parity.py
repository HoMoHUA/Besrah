#!/usr/bin/env python3
"""Baseline vs candidate HTTP parity against three REAL loopback servers (never Production).

  A = clean build of the deployed R2a-PB commit 587accb (identical dist to /srv/besrah)   port 18911
  C = NET01-QG candidate with the timetable overlay                                       port 18912
  F = the same candidate code with the overlay file absent (baseline generator)           port 18913

Rules, applied per request:
  A vs F  must be identical after stripping ID-ONLY fields           -> proves the code change is only identity fields
  A vs C  may differ only in line 1 / Sat-Wed responses of /next, /trains, /journey (declared timetable change)
Everything else (status, schema, ordering, Thursday, Friday, line 2, errors, static bytes) must be byte-equal or id-only.
"""
import hashlib, json, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
import os
PORTS = {'A': 18911, 'C': int(os.environ.get('PARITY_PORT_C', '18912')), 'F': 18913}
# Declared additive / identity-only fields: new keys that old clients ignore, and ids that change with the model.
ID_KEYS = {'event_id', 'eventId', 'modelVersion', 'dataVersion', 'timetable', 'timetableNotice'}
NOTICE = 'نسخهٔ اصلاح شدهٔ برنامهٔ روز عادی بارگذاری نشده است؛ برنامهٔ پایه نمایش داده می شود و ممکن است دو قطار را با یک ساعت حرکت نشان دهد. زمان ها تخمینی است.'  # TIMETABLE_DEGRADED_NOTICE (declared degraded-state text)
DAYS = {'sat': '2026-11-07', 'sun': '2026-11-08', 'mon': '2026-11-09', 'tue': '2026-11-10', 'wed': '2026-11-04', 'thu': '2026-11-05', 'fri': '2026-11-06'}
NORMAL = {'sat', 'sun', 'mon', 'tue', 'wed'}
TIMES = ['00:05:00', '05:55:00', '06:00:30', '06:29:30', '06:59:30', '08:15:00', '12:19:30', '14:05:00', '17:45:00', '19:31:00', '19:50:00', '20:03:30', '20:21:00', '21:30:00', '21:59:30', '23:30:00']
N = {'n': 0}

def get(port, path, ip):
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', headers={'X-Real-IP': ip})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.headers.get('content-type', ''), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('content-type', ''), e.read()

def strip(v):
    if isinstance(v, dict):
        return {k: strip_text(x) if isinstance(x, str) else strip(x) for k, x in v.items() if k not in ID_KEYS}
    if isinstance(v, list):
        return [strip(x) for x in v if not (isinstance(x, str) and x.startswith(NOTICE))]
    return v

def strip_text(x):
    """Remove the declared degraded-state notice from a prose field (journey `message` prefix, bot `text` line)."""
    if NOTICE not in x:
        return x
    if x.startswith(NOTICE):
        return x[len(NOTICE):].lstrip()
    return '\n'.join(line for line in x.split('\n') if NOTICE not in line)

def flat(d, pre=''):
    out = {}
    if isinstance(d, dict):
        for k, v in d.items(): out.update(flat(v, pre + '/' + k))
    elif isinstance(d, list):
        for i, v in enumerate(d): out.update(flat(v, pre + f'[{i}]'))
    else:
        out[pre] = d
    return out

def diff_keys(x, y, limit=6):
    try:
        fx, fy = flat(strip(json.loads(x[2]))), flat(strip(json.loads(y[2])))
    except ValueError:
        return ['non-json']
    return [f'{k}: {str(fx.get(k))[:40]} != {str(fy.get(k))[:40]}' for k in sorted(set(fx) | set(fy)) if fx.get(k) != fy.get(k)][:limit]

def norm(status, ctype, body):
    if 'json' in ctype:
        try:
            return (status, strip(json.loads(body)))
        except ValueError:
            pass
    return (status, hashlib.sha256(body).hexdigest())

def expects_notice(path, a):
    """True when this exact baseline answer is a normal-day line-1 answer, i.e. one a rejected overlay must label."""
    u = urllib.parse.urlparse(path); q = urllib.parse.parse_qs(u.query); ep = u.path.rsplit('/', 1)[-1]
    if a[0] != 200 or 'json' not in a[1]:
        return False
    try:
        body = json.loads(a[2])
    except ValueError:
        return False
    if ep == 'trains': return q.get('line', [''])[0] == '1' and body.get('day_type') == 'normal'
    if ep == 'next': return 1 in (body.get('lines') or []) and body.get('day_type') == 'normal'
    if ep == 'journey': return q.get('line', [''])[0] == '1' and (body.get('calendar') or {}).get('dayType') == 'normal'
    return False

def scope_of(path):
    """'l1n' = a response that may legitimately change with the declared line-1 normal-day timetable; otherwise 'other'."""
    import datetime
    u = urllib.parse.urlparse(path); q = urllib.parse.parse_qs(u.query)
    endpoint = u.path.rsplit('/', 1)[-1]
    if endpoint not in ('next', 'trains', 'journey'):
        return 'other'
    if q.get('line', [''])[0] == '2':
        return 'other'
    raw = (q.get('at') or q.get('date') or [''])[0]
    try:
        day = datetime.date.fromisoformat(raw[:10]) if raw else datetime.date(2026, 11, 4)  # parity-server.mjs pins the server clock to 2026-11-04T00:10+03:30
    except ValueError:
        return 'other'
    return 'other' if day.weekday() in (3, 4) else 'l1n'  # Thursday / Friday keep their own schedules

def build_requests():
    st = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORTS['A']}/app/api/stations"))['stations']
    l1 = [s for s in st if 1 in s['lines']]; l2 = [s for s in st if 2 in s['lines']]
    pick1 = {s['id']: s['name'] for s in l1 if s['id'] in ('METRO-101', 'METRO-107', 'METRO-108', 'METRO-110', 'METRO-122', 'METRO-124')}
    pick2 = {s['id']: s['name'] for s in l2[:3] + l2[-2:]}
    reqs = []  # (label, path, scope) scope: l1n (line-1 normal-day candidate), other
    for d, date in DAYS.items():
        for t in TIMES:
            at = f'{date}T{t}+03:30'
            for sid, name in {**pick1}.items():
                reqs.append((f'next/{d}/{t}/{sid}', f'/app/api/next?station={urllib.parse.quote(name)}&limit=6&line=1&at={urllib.parse.quote(at)}', 'l1n' if d in NORMAL else 'other'))
            for sid, name in pick2.items():
                reqs.append((f'next2/{d}/{t}/{sid}', f'/app/api/next?station={urllib.parse.quote(name)}&limit=6&line=2&at={urllib.parse.quote(at)}', 'other'))
            reqs.append((f'trains1/{d}/{t}', f'/app/api/trains?line=1&at={urllib.parse.quote(at)}', 'l1n' if d in NORMAL else 'other'))
            reqs.append((f'trains2/{d}/{t}', f'/app/api/trains?line=2&at={urllib.parse.quote(at)}', 'other'))
    pairs1 = [('METRO-107', 'METRO-108'), ('METRO-108', 'METRO-107'), ('METRO-101', 'METRO-122'), ('METRO-101', 'METRO-124'), ('METRO-122', 'METRO-101'), ('METRO-124', 'METRO-101')]
    l2ids = list(pick2)
    pairs2 = [(l2ids[0], l2ids[-1]), (l2ids[-1], l2ids[0])]
    for d, date in DAYS.items():
        for t in ['06:25', '06:55', '12:00', '19:10', '20:15', '21:55']:
            for a, b in pairs1:
                reqs.append((f'journey1/{d}/{t}/{a}>{b}', '/app/api/journey?' + urllib.parse.urlencode({'line': '1', 'from': a, 'to': b, 'date': date, 'time': t}), 'l1n' if d in NORMAL else 'other'))
            for a, b in pairs2:
                reqs.append((f'journey2/{d}/{t}/{a}>{b}', '/app/api/journey?' + urllib.parse.urlencode({'line': '2', 'from': a, 'to': b, 'date': date, 'time': t}), 'other'))
    errors = ['/app/api/next', '/app/api/next?station=%D9%86%D8%A7%D9%85%D9%88%D8%AC%D9%88%D8%AF', '/app/api/next?station=x&line=3', '/app/api/trains', '/app/api/trains?line=9',
              '/app/api/next?station=%D9%87%D9%81%D8%AA%E2%80%8C%D8%AA%DB%8C%D8%B1&at=not-a-date', '/app/api/journey', '/app/api/journey?line=1&from=METRO-107&to=METRO-107',
              '/app/api/journey?line=1&from=NOPE&to=METRO-108', '/app/api/journey?line=2&from=METRO-107&to=METRO-108', '/app/api/journey?line=1&from=METRO-107&to=METRO-108&date=2026-13-45&time=99:99',
              '/app/api/beta', '/health', '/app/api/nonexistent', '/v1/next?station=%D9%87%D9%81%D8%AA%E2%80%8C%D8%AA%DB%8C%D8%B1&limit=3&line=1']
    reqs += [(f'error/{i}', p, scope_of(p)) for i, p in enumerate(errors)]
    # every legacy static/API path the existing regression generator knows (food-status excluded: it makes live outbound calls)
    sys.path.insert(0, str(ROOT / 'scripts'))
    import importlib.util
    spec = importlib.util.spec_from_file_location('legacy_paths', ROOT / 'scripts/preflight_api_regression.py')
    if spec is None or spec.loader is None:
        raise RuntimeError('cannot load the legacy API path generator')
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    legacy = [p for p in mod.paths(ROOT) if (p.startswith('/app/api/') or p == '/health') and not p.startswith('/app/api/food-status')]
    reqs += [(f'legacy/{i}', p, scope_of(p)) for i, p in enumerate(legacy)]
    return reqs

def main():
    out = Path(sys.argv[1])
    reqs = build_requests()
    rows, t0 = [], time.time()
    for i, (label, path, scope) in enumerate(reqs):
        ip = f'127.{(i // 250) % 250}.{(i % 250) + 1}.9'
        res = {k: get(p, path, ip) for k, p in PORTS.items()}
        a, c, f = res['A'], res['C'], res['F']
        same_bytes_ac = (a[0], a[2]) == (c[0], c[2])
        a_f = 'identical_bytes' if (a[0], a[2]) == (f[0], f[2]) else ('id_only' if norm(*a) == norm(*f) else 'CODE_REGRESSION')
        if same_bytes_ac:
            a_c = 'identical_bytes'
        elif norm(*a) == norm(*c):
            a_c = 'id_only'
        else:
            a_c = 'declared_timetable_change' if scope == 'l1n' else 'UNEXPECTED_DIFF'
        extra = {}
        needs = expects_notice(path, a)
        has = {k: NOTICE.encode() in v[2] for k, v in res.items()}
        notice = 'ok'
        if needs and not has['F']: notice = 'MISSING_IN_FALLBACK'
        elif has['A'] or has['C']: notice = 'LEAKED_INTO_BASELINE_OR_CORRECTED'
        elif has['F'] and not needs: notice = 'FALSE_POSITIVE_IN_FALLBACK'
        extra['notice'] = notice
        if a_f == 'CODE_REGRESSION': extra['A_vs_F_diff'] = diff_keys(a, f)
        if a_c == 'UNEXPECTED_DIFF': extra['A_vs_C_diff'] = diff_keys(a, c)
        rows.append({**extra, 'label': label, 'path': path, 'scope': scope, 'status': {k: v[0] for k, v in res.items()}, 'A_vs_F': a_f, 'A_vs_C': a_c, 'notice': notice,
                     'sha256': {k: hashlib.sha256(v[2]).hexdigest()[:16] for k, v in res.items()}})
    counts = {}
    for r in rows:
        for k in ('A_vs_F', 'A_vs_C'):
            counts.setdefault(k, {}); counts[k][r[k]] = counts[k].get(r[k], 0) + 1
    bad = [r for r in rows if r['A_vs_F'] == 'CODE_REGRESSION' or r['A_vs_C'] == 'UNEXPECTED_DIFF' or r['notice'] != 'ok']
    # A 429 anywhere makes a comparison vacuous; the harness refuses to call that parity.
    bad += [dict(r, A_vs_C='VACUOUS_429') for r in rows if 429 in r['status'].values() and not r['label'].startswith('error/')]
    notice_stats = {}
    for r in rows: notice_stats[r['notice']] = notice_stats.get(r['notice'], 0) + 1
    families = {}
    for r in rows:
        fam = r['label'].split('/')[0]
        families.setdefault(fam, {'requests': 0, 'status': {}})
        families[fam]['requests'] += 1
        s = str(r['status']['A']); families[fam]['status'][s] = families[fam]['status'].get(s, 0) + 1
    allowlist = {
        'identity_only_fields_dropped_before_comparison': sorted(ID_KEYS),
        'degraded_notice_text_dropped_before_comparison': NOTICE,
        'declared_timetable_change': 'responses of /next, /trains, /journey for line 1 (or a station served by line 1) on Sat-Wed only; scope_of() decides per request',
        'never_allowed': ['status codes', 'JSON schema other than the dropped keys', 'ordering', 'Thursday', 'Friday', 'line 2', 'error payloads', 'static legacy API bytes'],
        'excluded_requests': ['/app/api/food-status (live outbound call, not deterministic)'],
        'server_clock': '2026-11-04T00:10:00+03:30 (fixed in parity-server.mjs); limiter clock stepped so the rate limiter never produces 429',
    }
    out.write_text(json.dumps({'allowlist': allowlist, 'servers': {'A': 'clean build of 587accb (dist identical to /srv/besrah)', 'C': 'NET01-QG candidate with overlay', 'F': 'NET01-QG candidate, overlay file absent'},
                               'requests': len(rows), 'degraded_notice_check': notice_stats, 'seconds': round(time.time() - t0, 1), 'summary': counts, 'families': families, 'violations': bad, 'rows': rows}, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps({'requests': len(rows), 'summary': counts, 'notice': notice_stats, 'violations': len(bad)}, ensure_ascii=False))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
