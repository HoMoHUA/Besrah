#!/usr/bin/env python3
"""Operator probe for the R2a-PB beta: loopback only, no payload or identity is stored.

  once   one sample -> JSON on stdout, exit 0 (OK), 10 (WARN) or 20 (KILL)
  watch  repeat for --minutes at --interval seconds, append one JSON line per sample to --out (0600), same exit rule on the worst sample

Thresholds are fixed constants that mirror docs/r2a-pb/PERFORMANCE-BUDGET.md and are NOT parameters, so they cannot be
relaxed to make a run look green. A KILL verdict means: run the kill switch in docs/r2apb/RELEASE-RUNBOOK.md.
The probe uses a reserved X-Real-IP (127.0.0.2), so it only consumes the global journey budget (about 6 requests/min).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

MIB = 1024 * 1024
THRESHOLDS = {
    "journey_p95_ms": (80.0, 250.0),     # warn at warm budget, kill at cold budget
    "old_api_p95_ms": (50.0, 150.0),     # existing /app/api/next must stay fast
    "memory_mib": (150.0, 175.0),        # unit cap is 192 MiB
    "feedback_dir_mib": (6.0, 7.5),      # store quota is 8 MiB
    "disk_free_mib": (1024.0, 256.0),    # lower is worse for this one
}
PROBE_IP = "127.0.0.2"


def verdict(sample: dict) -> tuple[str, list[str]]:
    """Pure function: map one sample to OK/WARN/KILL with reasons."""
    level, reasons = 0, []

    def hit(sev: int, text: str):
        nonlocal level
        level = max(level, sev)
        reasons.append(("KILL: " if sev == 2 else "WARN: ") + text)

    for key in ("journey_p95_ms", "old_api_p95_ms", "memory_mib", "feedback_dir_mib"):
        v = sample.get(key)
        if v is None:
            continue
        warn, kill = THRESHOLDS[key]
        if v >= kill:
            hit(2, f"{key}={v:.1f} >= {kill}")
        elif v >= warn:
            hit(1, f"{key}={v:.1f} >= {warn}")
    free = sample.get("disk_free_mib")
    if free is not None:
        warn, kill = THRESHOLDS["disk_free_mib"]
        if free <= kill:
            hit(2, f"disk_free_mib={free:.0f} <= {kill}")
        elif free <= warn:
            hit(1, f"disk_free_mib={free:.0f} <= {warn}")
    if sample.get("server_errors", 0) >= 2:
        hit(2, f"{sample['server_errors']} HTTP 5xx in one sample")
    elif sample.get("server_errors", 0) == 1:
        hit(1, "one HTTP 5xx")
    if sample.get("journey_ok") == 0:
        hit(1, "no successful journey sample (rate-limited or disabled): the latency verdict is inconclusive, not healthy")
    if sample.get("unit_result") not in (None, "success"):
        hit(2, f"unit Result={sample['unit_result']}")
    if sample.get("restarts_since_baseline", 0) > 0:
        hit(2, f"{sample['restarts_since_baseline']} unit restart(s) since the probe started")
    if sample.get("oom_kill", 0) > 0:
        hit(2, "cgroup oom_kill > 0")
    if sample.get("stale_lock") is True:
        hit(1, "feedback lock belongs to a dead process: feedback writes fail closed until an operator removes it")
    return ("KILL" if level == 2 else "WARN" if level == 1 else "OK"), reasons


def timed_get(base: str, path: str) -> tuple[int, float]:
    req = urllib.request.Request(base + path, headers={"x-real-ip": PROBE_IP})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            r.read(65536)
            return r.status, (time.perf_counter() - t) * 1000
    except urllib.error.HTTPError as e:
        return e.code, (time.perf_counter() - t) * 1000
    except Exception:
        return 599, (time.perf_counter() - t) * 1000


def p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, int(len(ordered) * 0.95 + 0.9999) - 1)]


def systemd_props(unit: str) -> dict:
    out = subprocess.run(["systemctl", "show", unit, "-p", "MainPID", "-p", "MemoryCurrent", "-p", "NRestarts", "-p", "Result", "-p", "ActiveState"],
                         capture_output=True, text=True).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


def cgroup_oom(unit: str) -> int:
    try:
        cg = subprocess.run(["systemctl", "show", unit, "-p", "ControlGroup", "--value"], capture_output=True, text=True).stdout.strip()
        for line in Path(f"/sys/fs/cgroup{cg}/memory.events").read_text().splitlines():
            if line.startswith("oom_kill "):
                return int(line.split()[1])
    except OSError:
        pass
    return 0


def sample_once(args, baseline: dict) -> dict:
    base = f"http://127.0.0.1:{args.port}"
    j_ms, n_ms, errors, limited = [], [], 0, 0
    timed_get(base, "/app/api/journey?line=1&from=METRO-107&to=METRO-108")  # warm-up, discarded: a first request after a restart is a cold model build, not a regression
    for _ in range(args.requests):
        st, ms = timed_get(base, f"/app/api/journey?line=1&from=METRO-107&to=METRO-108")
        if st >= 500:
            errors += 1
        if st == 200:
            j_ms.append(ms)
        elif st == 429:
            limited += 1
        st, ms = timed_get(base, "/app/api/trains?line=1")
        if st >= 500:
            errors += 1
        elif st == 200:
            n_ms.append(ms)
        time.sleep(0.4)
    props = systemd_props(args.unit)
    mem = int(props["MemoryCurrent"]) / MIB if props.get("MemoryCurrent", "").isdigit() else None
    restarts = int(props.get("NRestarts", "0") or 0)
    baseline.setdefault("restarts", restarts)
    fb = Path(args.state_dir) / "feedback"
    size = sum(f.stat().st_size for f in fb.glob("*") if f.is_file() and not f.is_symlink()) / MIB if fb.is_dir() else 0.0
    lock = fb / ".feedback.lock"
    stale = None
    if lock.is_file():
        m = re.match(r"(\d+):", lock.read_text(errors="replace"))
        stale = bool(m) and str(m.group(1)) != props.get("MainPID", "")
    return {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "journey_p95_ms": p95(j_ms), "old_api_p95_ms": p95(n_ms), "samples": len(j_ms) + len(n_ms), "journey_ok": len(j_ms), "rate_limited": limited, "server_errors": errors,
        "memory_mib": mem, "unit_result": props.get("Result"), "active": props.get("ActiveState"),
        "restarts_since_baseline": restarts - baseline["restarts"], "oom_kill": cgroup_oom(args.unit),
        "feedback_dir_mib": round(size, 3), "stale_lock": stale,
        "disk_free_mib": shutil.disk_usage(args.state_dir if Path(args.state_dir).exists() else "/").free / MIB,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["once", "watch"])
    ap.add_argument("--unit", default="besrah-core.service")
    ap.add_argument("--port", type=int, default=3080)
    ap.add_argument("--state-dir", default="/var/lib/private/besrah-feedback", help="real directory behind StateDirectory (root can read it)")
    ap.add_argument("--requests", type=int, default=5, help="requests per endpoint per sample (keep small: global budget is 60/min)")
    ap.add_argument("--minutes", type=int, default=60)
    ap.add_argument("--interval", type=int, default=60, help="seconds; keep >= 60: 6 requests per sample against a 10/min per-client limit")
    ap.add_argument("--out")
    args = ap.parse_args()
    if not 1 <= args.requests <= 10:
        ap.error("--requests must be 1..10")
    baseline: dict = {}
    worst = 0
    deadline = time.time() + args.minutes * 60
    if args.mode == "watch":
        if not args.out:
            ap.error("--out is required for watch")
        fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        os.close(fd)
    while True:
        s = sample_once(args, baseline)
        v, why = verdict(s)
        s.update(verdict=v, reasons=why)
        worst = max(worst, {"OK": 0, "WARN": 1, "KILL": 2}[v])
        line = json.dumps(s, ensure_ascii=False)
        if args.mode == "once":
            print(line)
            break
        with open(args.out, "a") as f:
            f.write(line + "\n")
        print(v, why, flush=True)
        if worst == 2 or time.time() >= deadline:
            break
        time.sleep(max(1, args.interval))
    return {0: 0, 1: 10, 2: 20}[worst]


if __name__ == "__main__":
    sys.exit(main())
