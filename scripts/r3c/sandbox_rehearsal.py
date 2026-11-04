#!/usr/bin/env python3
"""R3-C sandbox rehearsal: run the staged U1+U2 tree in a transient unit with Production's hardening (copy of besrah-core.service),
on loopback 18870, flag OFF, feedback OFF. Never touches /srv/besrah, besrah-core, Nginx or any real feedback data.
Checks: start, model identity, event_id, degraded visibility when the overlay file is missing, restart behaviour/memory, and
that rolling U2 then U1 back reproduces Production's tree hash for hash."""
import hashlib, json, os, shutil, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

STAGE = Path(os.environ.get("STAGE", "/root/.hermes/cache/scratch/r3c/stage"))
ST = Path("/var/lib/besrah-r3c-stage")
UNIT, PORT = "besrah-r3c-rehearsal", 18870
OUT = Path(sys.argv[1])
TOOL = Path(__file__).resolve().parents[1] / "preflight_overlay.py"
RES = []

def rec(name, ok, detail=""):
    RES.append({"check": name, "result": "PASS" if ok else "FAIL", "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if not ok else ""))

def sh(*a, **k):
    return subprocess.run(a, capture_output=True, text=True, **k)

def get(path):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001
        return 0, str(e).encode()

def jget(path):
    s, b = get(path)
    try:
        return s, json.loads(b)
    except Exception:  # noqa: BLE001
        return s, None

def tree(root: Path):
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file() and not p.is_symlink() and "node_modules" not in p.parts:
            out[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out

def start():
    sh("systemctl", "stop", UNIT); sh("systemctl", "reset-failed", UNIT)
    props = ["DynamicUser=yes", f"WorkingDirectory={ST}/srv/packages/core", "Environment=NODE_ENV=production", "Environment=HOST=127.0.0.1",
             f"Environment=PORT={PORT}", "Environment=TZ=Asia/Tehran", "Restart=on-failure", "RestartSec=3", "TimeoutStopSec=15", "MemoryMax=192M", "TasksMax=64",
             "UMask=0077", "NoNewPrivileges=yes", "PrivateTmp=yes", "PrivateDevices=yes", "ProtectSystem=strict", "ProtectHome=yes", "ProtectKernelTunables=yes",
             "ProtectKernelModules=yes", "ProtectControlGroups=yes", "RestrictSUIDSGID=yes", "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6", "LockPersonality=yes",
             "CapabilityBoundingSet=", "StateDirectory=besrah-r3c-rehearsal", "StateDirectoryMode=0700", "Environment=BESRAH_JOURNEY_BETA=on",
             f"Environment=BESRAH_JOURNEY_SWITCH_FILE={ST}/ctl/control.json", "Environment=BESRAH_FEEDBACK_DIR=/var/lib/besrah-r3c-rehearsal/feedback",
             "Environment=BESRAH_ALLOWED_ORIGINS=https://besrah.arklyn.ir", "Environment=BESRAH_JOURNEY_CALENDAR=weekday_baseline"]
    cmd = ["systemd-run", f"--unit={UNIT}", "-q", *[x for p in props for x in ("-p", p)], "/usr/bin/node", f"{ST}/srv/packages/core/dist/index.js"]
    r = sh(*cmd)
    if r.returncode:
        raise SystemExit("systemd-run failed: " + r.stderr)
    for _ in range(40):
        if get("/health")[0] == 200:
            return True
        time.sleep(0.5)
    return False

def prop(p):
    return sh("systemctl", "show", UNIT, "-p", p, "--value").stdout.strip()

def main():
    shutil.rmtree(ST, ignore_errors=True); (ST / "ctl").mkdir(parents=True)
    shutil.copytree(STAGE / "srv", ST / "srv", symlinks=True)
    (ST / "ctl" / "control.json").write_text('{"schemaVersion": 1, "enabled": false, "feedbackEnabled": false, "rolloutPercent": 0}\n')
    os.chmod(ST, 0o755); os.chmod(ST / "ctl", 0o755); os.chmod(ST / "ctl" / "control.json", 0o644)
    ok = start()
    rec("unit starts under Production hardening with U1+U2", ok)
    s, beta = jget("/app/api/beta")
    tt = (beta or {}).get("timetable") or {}
    rec("flag OFF is reported and the NET01 overlay is applied", s == 200 and (beta or {}).get("journey", {}).get("enabled") is False and tt.get("state") == "applied", json.dumps(beta)[:200])
    nxt_path = "/app/api/next?" + urllib.parse.urlencode({"station": "هفت‌تیر", "limit": 3, "line": 1})
    s, n = jget(nxt_path)
    rec("/app/api/next answers 200 and carries event_id", s == 200 and n is not None and "event_id" in json.dumps(n), str(s))
    # flag is OFF: the journey endpoint must stay dark for visitors
    s, _ = jget("/app/api/journey?" + urllib.parse.urlencode({"line": 1, "from": "METRO-107", "to": "METRO-108"}))
    rec("journey endpoint is closed while the switch is OFF", s in (403, 404, 503), str(s))
    ev = [get(f"/app/api/next?station={urllib.parse.quote('وکیل‌آباد')}&limit=5&line=1")[0] for _ in range(20)]
    rec("20 repeated reads stay 200 (rate limiter is not tripped by normal use)", set(ev) == {200}, str(set(ev)))
    mem = int(prop("MemoryCurrent") or 0) / 1048576
    rec("memory after warm-up within the 192 MiB cap", 0 < mem < 150, f"{mem:.1f} MiB")
    # degraded visibility: overlay file missing
    ov = ST / "srv/data/timetable/normal-day-overlay-v1.json"; keep = ov.read_bytes(); ov.unlink()
    sh("systemctl", "restart", UNIT); time.sleep(2)
    for _ in range(30):
        if get("/health")[0] == 200: break
        time.sleep(0.5)
    s, beta2 = jget("/app/api/beta")
    st2 = ((beta2 or {}).get("timetable") or {}).get("state")
    s2, n2 = jget(nxt_path)
    txt = json.dumps(n2, ensure_ascii=False)
    rec("missing overlay file: service stays up, state is baseline_missing and the notice is visible", s == 200 and st2 == "baseline_missing" and "اصلاح شده" in txt, f"{st2}")
    ov.write_bytes(keep); os.chmod(ov, 0o644)
    sh("systemctl", "restart", UNIT); time.sleep(2)
    for _ in range(30):
        if get("/health")[0] == 200: break
        time.sleep(0.5)
    rec("overlay restored: state is applied again", ((jget("/app/api/beta")[1] or {}).get("timetable") or {}).get("state") == "applied")
    rec("NRestarts counter is 0 (manual restarts do not count as failures)", prop("NRestarts") == "0", prop("NRestarts"))
    sh("systemctl", "stop", UNIT)
    # independent rollback of U2 then U1 reproduces Production
    for u in ("u2", "u1"):
        r = sh(sys.executable, str(TOOL), "rollback", "--plan", str(STAGE / f"plan-{u}.json"), "--target", str(ST / "srv"), "--snapshot", str(STAGE / f"snapshot-{u}"))
        rec(f"rollback {u} verified by the tool", r.returncode == 0, (r.stdout + r.stderr)[-200:])
        if u == "u2":
            mid = tree(ST / "srv")
            rec("after rolling U2 back alone, the U1 data and code are still in place", (ST / "srv/data/timetable/normal-day-overlay-v1.json").is_file() and (ST / "srv/packages/core/dist/timetable-overlay.js").is_file())
    prod, copy = tree(Path("/srv/besrah")), tree(ST / "srv")
    diff = sorted(set(prod) ^ set(copy)) + [k for k in prod if k in copy and prod[k] != copy[k]]
    rec("after both rollbacks the tree equals live Production, hash for hash", not diff, ", ".join(diff[:6]))
    OUT.write_text(json.dumps({"stage": str(STAGE), "results": RES}, ensure_ascii=False, indent=1) + "\n")
    shutil.rmtree(ST, ignore_errors=True)
    shutil.rmtree("/var/lib/private/besrah-r3c-rehearsal", ignore_errors=True)
    Path("/var/lib/besrah-r3c-rehearsal").unlink(missing_ok=True)
    sys.exit(1 if any(r["result"] == "FAIL" for r in RES) else 0)

main()
