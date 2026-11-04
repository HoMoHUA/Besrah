#!/bin/bash
# Rebuild the preflight stage from the CURRENT git HEAD: clean export -> build -> plan -> apply onto a COPY of /srv/besrah.
# Never touches /srv/besrah itself (read-only source of the copy and of the plan's pre-state).
set -euo pipefail
REPO=${REPO:-/root/projects/besrah-r2apb}; BASE=${BASE:-8e8e278}
PF=${PF:-/root/.hermes/cache/scratch/pb/preflight}; ST=${ST:-/var/lib/besrah-preflight}
systemctl stop besrah-pb-preflight besrah-pb-nginx-core besrah-pb-browser besrah-pb-browser-off besrah-pb-mem 2>/dev/null || true
rm -rf "$PF/export-HEAD" "$ST/srv" "$ST/snapshot"; mkdir -p "$PF/export-HEAD"
git -C "$REPO" archive HEAD | tar -x -C "$PF/export-HEAD"
ln -s "$REPO/packages/core/node_modules" "$PF/export-HEAD/packages/core/node_modules"
(cd "$PF/export-HEAD/packages/core" && npx tsc -p tsconfig.build.json)
if [ ! -d "$PF/export-$BASE" ]; then mkdir -p "$PF/export-$BASE"; git -C "$REPO" archive "$BASE" | tar -x -C "$PF/export-$BASE"; ln -s "$REPO/packages/core/node_modules" "$PF/export-$BASE/packages/core/node_modules"; (cd "$PF/export-$BASE/packages/core" && npx tsc -p tsconfig.build.json); fi
git -C "$REPO" diff --name-only --diff-filter=AMR "$BASE"..HEAD -- apps/miniapp | python3 -c "import sys,json;print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))" > "$PF/assets.json"
python3 "$REPO/scripts/preflight_overlay.py" plan --candidate "$PF/export-HEAD" --production /srv/besrah --base-dist "$PF/export-$BASE/packages/core/dist" --base-assets-json "$PF/assets.json" --note "R2a-PB candidate over $BASE, HEAD $(git -C "$REPO" rev-parse --short HEAD)" --out "$PF/plan.json"
cp -a /srv/besrah "$ST/srv"
python3 "$REPO/scripts/preflight_overlay.py" apply --plan "$PF/plan.json" --candidate "$PF/export-HEAD" --target "$ST/srv" --snapshot "$ST/snapshot" --group dist
python3 "$REPO/scripts/preflight_overlay.py" apply --plan "$PF/plan.json" --candidate "$PF/export-HEAD" --target "$ST/srv" --snapshot "$ST/snapshot" --group assets
python3 "$REPO/scripts/preflight_overlay.py" verify --plan "$PF/plan.json" --target "$ST/srv" --state post
