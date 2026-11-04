#!/usr/bin/env python3
"""Byte-level regression check of the EXISTING read APIs and static assets across a deployment.

  record  --base URL --out FILE    GET a fixed, deterministic set of paths and store status + sha256 of each body
  compare --base URL --file FILE   re-GET and report every path whose status or body changed

Deterministic because /app/api/next and /app/api/trains accept an explicit `at` on the private loopback core.
Read-only: GET requests to a loopback URL only. Static assets that the plan changes are expected to differ; the caller
passes them with --expect-changed (a path list file) so that an unexpected change is the only thing reported as a failure.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ATS = ["2026-10-16T14:00:00+03:30", "2026-10-22T09:30:00+03:30", "2026-11-03T18:10:00+03:30", "2026-11-04T07:05:00+03:30", "2026-11-06T22:40:00+03:30"]


def get(base: str, path: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(base + path, timeout=15) as r:
            return r.status, hashlib.sha256(r.read()).hexdigest()
    except urllib.error.HTTPError as e:
        return e.code, hashlib.sha256(e.read()).hexdigest()


def paths(root: Path) -> list[str]:
    net = json.loads((root / "data/network.json").read_text())
    names = [s["name"] for s in net.get("stations", [])]
    out = ["/health"]
    for at in ATS:
        q = urllib.parse.quote(at)
        out += [f"/app/api/trains?line={line}&at={q}" for line in (1, 2)]
        out += [f"/app/api/next?station={urllib.parse.quote(n)}&at={q}&limit=4" for n in names[:6] + names[20:24]]
    src = (root / "packages/core/src/miniapp.ts").read_text()
    out += [route for route, _ in re.findall(r"\['(/app/[^']+)', '([^']+)'\]", src)]
    out += ["/app/", "/app/api/food-status?vendor=nonexistent"]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    r.add_argument("--base", required=True); r.add_argument("--out", required=True)
    r.add_argument("--repo", default=str(Path(__file__).resolve().parents[1]), help="tree that defines the asset allowlist and station names")
    c = sub.add_parser("compare")
    c.add_argument("--base", required=True); c.add_argument("--file", required=True)
    c.add_argument("--expect-changed", help="JSON list of URL paths allowed to differ (planned assets)")
    a = ap.parse_args()
    if not re.fullmatch(r"http://127\.0\.0\.1:\d+", a.base):
        ap.error("--base must be a loopback core URL such as http://127.0.0.1:3080")
    if a.cmd == "record":
        data = {p: get(a.base, p) for p in paths(Path(a.repo))}
        Path(a.out).write_text(json.dumps({"base": a.base, "responses": data}, indent=1) + "\n")
        print(f"recorded {len(data)} paths")
        return 0
    rec = json.loads(Path(a.file).read_text())["responses"]
    allowed = set(json.loads(Path(a.expect_changed).read_text())) if a.expect_changed else set()
    bad, expected = [], []
    for p, (st, digest) in rec.items():
        now = get(a.base, p)
        if now != (st, digest):
            (expected if p in allowed else bad).append([p, st, now[0]])
    print(f"{len(rec) - len(bad) - len(expected)}/{len(rec)} identical; expected changes {len(expected)}; UNEXPECTED {len(bad)}")
    for b in bad:
        print("  UNEXPECTED", b)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
