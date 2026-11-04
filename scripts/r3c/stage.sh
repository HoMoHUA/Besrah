#!/bin/bash
# R3-C rehearsal stage: clean export of the CURRENT git HEAD -> build -> two hash-guarded plans (U1 data+dist, U2 assets,
# U2 planned over a tree that already carries U1) -> apply both onto a COPY of /srv/besrah. /srv/besrah is only read.
set -euo pipefail
REPO=${REPO:-/root/projects/besrah-r3c}; BASE=${BASE:-587accb}
PF=${PF:-/root/.hermes/cache/scratch/r3c/stage}
ORIG=${ORIG:-/srv/besrah}
rm -rf "$PF"; mkdir -p "$PF/export-HEAD" "$PF/export-$BASE"
git -C "$REPO" archive HEAD | tar -x -C "$PF/export-HEAD"
git -C "$REPO" archive "$BASE" | tar -x -C "$PF/export-$BASE"
for d in HEAD "$BASE"; do ln -s "$REPO/packages/core/node_modules" "$PF/export-$d/packages/core/node_modules"; (cd "$PF/export-$d/packages/core" && npx tsc -p tsconfig.build.json); done
git -C "$REPO" diff --name-only --diff-filter=AMR "$BASE"..HEAD -- apps/miniapp | python3 -c "import sys,json;print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))" > "$PF/assets.json"
python3 - "$PF" <<'PY'
import json, sys
json.dump(["data/timetable/normal-day-overlay-v1.json", "data/official/kowsar_airport_poster_2026-11-03.json"], open(sys.argv[1] + "/data.json", "w"))
json.dump([], open(sys.argv[1] + "/none.json", "w"))
PY
T="$REPO/scripts/preflight_overlay.py"
cp -a "$ORIG" "$PF/srv"
python3 "$T" plan --candidate "$PF/export-HEAD" --production "$ORIG" --base-dist "$PF/export-$BASE/packages/core/dist" \
  --base-assets-json "$PF/none.json" --data-json "$PF/data.json" --note "R3C U1 (NET01 server+data), planned against live production" --out "$PF/plan-u1.json"
python3 "$T" apply --plan "$PF/plan-u1.json" --candidate "$PF/export-HEAD" --target "$PF/srv" --snapshot "$PF/snapshot-u1"
python3 "$T" plan --candidate "$PF/export-HEAD" --production "$PF/srv" --base-dist "$PF/export-$BASE/packages/core/dist" \
  --base-assets-json "$PF/assets.json" --note "R3C U2 (R3-A/R3-B Mini App), planned over U1" --out "$PF/plan-u2.json"
python3 "$T" apply --plan "$PF/plan-u2.json" --candidate "$PF/export-HEAD" --target "$PF/srv" --snapshot "$PF/snapshot-u2"
python3 "$T" verify --plan "$PF/plan-u1.json" --target "$PF/srv" --state post
python3 "$T" verify --plan "$PF/plan-u2.json" --target "$PF/srv" --state post
python3 - "$PF" <<'PY'
import json, sys
for u in ("u1", "u2"):
    p = json.load(open(f"{sys.argv[1]}/plan-{u}.json"))
    from collections import Counter
    print(u, dict(Counter(f["group"] for f in p["files"])), "excludedDrift", len(p["excludedDrift"]))
PY
