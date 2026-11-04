#!/usr/bin/env bash
# NET01-QG fresh regression at the working tree HEAD. Serial by design (earlier OOM history). Output: one line per suite.
cd "$(dirname "$0")/../.." || exit 2
LOG=${1:-/tmp/net01-regression.log}; : > "$LOG"
run() { name=$1; shift; "$@" > "$LOG.$name" 2>&1; rc=$?; echo "$name rc=$rc $(grep -E "Tests  |^# pass|^# fail|^Ran |^OK|^FAILED|passed|failed" "$LOG.$name" | tr '\n' ' ' | cut -c1-200)" | tee -a "$LOG"; }
run typecheck npm --prefix packages/core exec -- tsc --noEmit -p packages/core
run build npm --prefix packages/core run build
run core bash -c "cd packages/core && npx vitest run --maxWorkers=1 --no-file-parallelism"
run miniapp node --test --test-concurrency=1 apps/miniapp/*.test.mjs
run n8n node --test --test-concurrency=1 tests/n8n/*.test.mjs
run releasejs node --test --test-concurrency=1 tests/release/*.test.mjs
run pydata python3 -m unittest discover -s tests/data -p "test_*.py"
run pyrelease python3 -m unittest discover -s tests/release -p "test_*.py"
run pyshop python3 -m unittest discover -s tests/shop -p "test_*.py"
run bus python3 scripts/build_bus_app_data.py --check
run diffcheck git diff --check
run http env R3A_BASE_PORT=18911 R3A_ON_PORT=18901 R3A_OFF_PORT=18902 R3A_STRICT_PORT=18903 python3 -m unittest discover -s tests/r3a -p "test_*.py"
