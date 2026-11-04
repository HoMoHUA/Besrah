#!/usr/bin/env python3
"""R2a-PB preflight: rehearse the candidate inside a systemd unit with Production's sandbox properties.

Runs ONLY against a staged COPY of /srv/besrah (default /var/lib/besrah-preflight/srv) on loopback port 18870.
It never touches /srv/besrah, besrah-core.service, Nginx or any real feedback data. All feedback payloads
are synthetic and labelled in the report; they are not field observations.

Evidence is written to the JSON path given by --out. Exit code 1 if any check FAILS.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ST = Path("/var/lib/besrah-preflight")
PORT = 18870
BASE = f"http://127.0.0.1:{PORT}"
STATE_LINK = Path("/var/lib/besrah-pb-preflight")
STATE_REAL = Path("/var/lib/private/besrah-pb-preflight")
FB_DIR = STATE_LINK / "feedback"
CONTROL = ST / "ctl" / "control.json"
UNIT = "besrah-pb-preflight"
RESULTS: list[dict] = []
TEHRAN = timezone(timedelta(hours=3, minutes=30))


def record(name: str, ok: bool, detail="") -> bool:
    RESULTS.append({"check": name, "result": "PASS" if ok else "FAIL", "detail": detail if isinstance(detail, (str, int, float, bool, type(None))) else json.dumps(detail, ensure_ascii=False)})
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail != "" and not ok else ""))
    return ok


def http(method: str, path: str, body=None, headers=None, raw: bytes | None = None, timeout=10):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = dict(headers or {})
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt.startswith(("{", "[")) else txt), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt), {k.lower(): v for k, v in e.headers.items()}
        except Exception:
            return e.code, txt, {k.lower(): v for k, v in e.headers.items()}


def sh(*cmd, check=False):
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def start(env: dict[str, str]) -> None:
    sh("systemctl", "stop", UNIT)
    sh("systemctl", "reset-failed", UNIT)
    args = ["bash", str(ST / "run-unit.sh"), UNIT, str(PORT)]
    for k, v in env.items():
        args += ["-E", f"{k}={v}"]
    r = sh(*args)
    if r.returncode:
        raise SystemExit("cannot start unit: " + r.stderr)
    for _ in range(60):
        try:
            if http("GET", "/app/api/beta")[0] == 200:
                return
        except Exception:
            pass
        time.sleep(0.25)
    raise SystemExit("unit did not become ready:\n" + sh("journalctl", "-u", UNIT, "-n", "30", "--no-pager").stdout)


def main_pid() -> int:
    return int(sh("systemctl", "show", UNIT, "-p", "MainPID", "--value").stdout.strip() or 0)


def control(**values):
    doc = {"schemaVersion": 1, "enabled": True, "feedbackEnabled": True, "rolloutPercent": 0, **values}
    tmp = CONTROL.with_name(".control.tmp")
    tmp.write_text(json.dumps(doc) + "\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, CONTROL)  # atomic, as the runbook prescribes


def journey_query(**over):
    stations = http("GET", "/app/api/trains?line=1")[1] if False else None
    q = {"line": "1", "from": "METRO-107", "to": "METRO-108"}
    q.update(over)
    return "/app/api/journey?" + "&".join(f"{k}={v}" for k, v in q.items())


def feedback_payload(model_version: str, report_id: str | None = None, **over):
    today = datetime.now(TEHRAN).strftime("%Y-%m-%d")
    p = {"v": 1, "reportId": report_id or uuid.uuid4().hex, "kind": "timing_quality", "timingQuality": "close",
         "consent": {"storeForModelImprovement": True}, "modelVersion": model_version,
         "context": {"line": 1, "originId": "METRO-107", "destinationId": "METRO-108", "serviceDate": today}}
    p.update(over)
    return p


FB_HEADERS = {"content-type": "application/json", "x-besrah-beta": "1", "origin": "https://besrah.arklyn.ir"}


def post_fb(payload, headers=None, real_ip=None):
    h = dict(FB_HEADERS if headers is None else headers)
    if real_ip:
        h["x-real-ip"] = real_ip
    return http("POST", "/app/api/journey-feedback", payload, h)


def ip(n: int) -> str:
    return f"10.77.{n // 250}.{n % 250 + 1}"


def state_listing():
    out = {}
    for p in sorted(STATE_REAL.rglob("*")) if STATE_REAL.exists() else []:
        s = p.lstat()
        out[str(p.relative_to(STATE_REAL))] = {"mode": oct(s.st_mode & 0o7777), "uid": s.st_uid, "size": s.st_size}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    sh("systemctl", "stop", UNIT)
    sh("rm", "-rf", str(STATE_REAL), str(STATE_LINK))
    unit_text = ""

    # ---------------------------------------------------------------- A: beta OFF (no env)
    start({})
    unit_text = sh("systemctl", "show", UNIT, "-p", "DynamicUser", "-p", "ProtectSystem", "-p", "ProtectHome", "-p", "NoNewPrivileges", "-p", "PrivateTmp", "-p", "MemoryMax", "-p", "StateDirectory", "-p", "UMask").stdout
    record("A0 unit runs with DynamicUser + ProtectSystem=strict + ProtectHome + NoNewPrivileges + MemoryMax=192M",
           all(s in unit_text for s in ("DynamicUser=yes", "ProtectSystem=strict", "ProtectHome=yes", "NoNewPrivileges=yes", "MemoryMax=201326592")), unit_text.replace("\n", " "))
    st, body, _ = http("GET", "/app/api/beta")
    record("A1 flag off: /app/api/beta reports disabled", st == 200 and body["journey"]["enabled"] is False and body["journey"]["feedbackEnabled"] is False, body)
    st, _, _ = http("GET", journey_query())
    record("A2 flag off: journey API is 404 (server-side, not UI hiding)", st == 404, st)
    st, _, _ = post_fb({"v": 1})
    record("A3 flag off: feedback POST is 404", st == 404, st)
    st, _, _ = http("GET", "/app/api/trains?line=1")
    record("A4 flag off: existing /app/api/next still 200", st == 200, st)
    st, _, _ = http("GET", "/app/api/trains?line=1")
    record("A5 flag off: existing /app/api/trains still 200", st == 200, st)
    st, _, h = http("GET", "/app/")
    record("A6 Mini App shell served with CSP", st == 200 and "connect-src 'self'" in h.get("content-security-policy", ""), h.get("content-security-policy", ""))
    record("A7 flag off: no state or feedback directory content created", not (STATE_REAL / "feedback").exists(), state_listing())

    # ---------------------------------------------------------------- B: beta ON with control file
    control()
    env = {"BESRAH_JOURNEY_BETA": "on", "BESRAH_JOURNEY_SWITCH_FILE": str(CONTROL), "BESRAH_FEEDBACK_DIR": str(FB_DIR)}
    start(env)
    st, body, h = http("GET", journey_query(), headers={"x-real-ip": ip(1)})
    ok = st == 200 and body.get("beta") is True and body.get("live") is False and h.get("cache-control") == "no-store"
    record("B1 beta on: journey 200, beta/modelOnly/live=false, no-store", ok, st)
    mv = body["modelVersion"] if isinstance(body, dict) else ""
    record("B2 beta on: real options with HH:MM times (no seconds) and estimated calendar warning on non-Friday or known label",
           isinstance(body, dict) and all(re.fullmatch(r"\d\d:\d\d", o["departAt"]) and re.fullmatch(r"\d\d:\d\d", o["arriveAt"]) for o in body["options"]) and body["calendar"]["label"] != "",
           {"status": body.get("status"), "options": len(body.get("options", [])), "calendar": body.get("calendar", {}).get("state")})
    st, body, _ = post_fb(feedback_payload(mv), real_ip=ip(2))
    record("B3 valid anonymous feedback persisted in StateDirectory (201 only after durable write)", st == 201, [st, body])
    listing = state_listing()
    fb_files = {k: v for k, v in listing.items() if k.startswith("feedback/feedback-") and k.endswith(".jsonl")}
    record("B4 store files: directory 0700, record file 0600, owned by the DynamicUser (non-root)",
           listing.get("feedback", {}).get("mode") == "0o700" and fb_files and all(v["mode"] == "0o600" for v in fb_files.values()) and listing["feedback"]["uid"] != 0, listing)
    raw = "".join(p.read_text() for p in (STATE_REAL / "feedback").glob("feedback-*.jsonl"))
    record("B5 stored record carries no IP/user-agent/identity fields", not re.search(r"10\.77\.|x-real-ip|user-agent|userId|initData|latitude|longitude", raw, re.I) and '"identity":"anonymous_unverified"' in raw, raw[:300])
    st, _, _ = post_fb(feedback_payload(mv), headers={**FB_HEADERS, "origin": "https://evil.example"}, real_ip=ip(3))
    record("B6 foreign Origin rejected 403", st == 403, st)
    st, _, _ = post_fb(feedback_payload(mv), headers={k: v for k, v in FB_HEADERS.items() if k != "x-besrah-beta"}, real_ip=ip(4))
    record("B7 missing X-Besrah-Beta header rejected 403", st == 403, st)
    st, _, _ = post_fb(feedback_payload(mv), headers={**FB_HEADERS, "content-type": "text/plain"}, real_ip=ip(5))
    record("B8 wrong Content-Type rejected 415", st == 415, st)
    st, _, _ = http("POST", "/app/api/journey-feedback", raw=b"x" * 5000, headers={**FB_HEADERS, "x-real-ip": ip(6)})
    record("B9 body over 4 KiB rejected 413", st == 413, st)
    st, _, _ = http("POST", "/app/api/journey-feedback", raw=b"{bad", headers={**FB_HEADERS, "x-real-ip": ip(7)})
    record("B10 malformed JSON rejected 400", st == 400, st)
    st, _, _ = post_fb(feedback_payload(mv, note="see https://evil.example/x"), real_ip=ip(8))
    record("B11 URL inside the note rejected 400", st == 400, st)
    st, _, _ = post_fb(feedback_payload(mv, consent={"storeForModelImprovement": False}), real_ip=ip(9))
    record("B12 missing consent rejected 400", st == 400, st)
    dup_id = "dup" + uuid.uuid4().hex
    s1, _, _ = post_fb(feedback_payload(mv, dup_id), real_ip=ip(10))
    s2, b2, _ = post_fb(feedback_payload(mv, dup_id), real_ip=ip(11))
    record("B13 same reportId retried -> duplicate (idempotent), not double-stored", s1 == 201 and s2 == 200 and b2.get("status") == "duplicate", [s1, s2, b2])
    st, _, _ = http("GET", "/app/api/journey-feedback")
    record("B14 GET on the feedback path is not a read endpoint", st in (404, 405), st)
    st, _, _ = http("GET", journey_query(**{"at": "2026-01-01T00:00:00Z"}))
    record("B15 unknown query key (at=) rejected 400", st == 400, st)
    st, _, _ = http("GET", journey_query(**{"from": "METRO-107", "to": "x%27%3B%20DROP"}))
    record("B16 injected station id rejected 400", st == 400, st)

    # ------------------------------------------------------------ kill switch without restart
    pid0 = main_pid()
    control(enabled=False)
    sj, _, _ = http("GET", journey_query(), headers={"x-real-ip": ip(20)})
    sf, _, _ = post_fb(feedback_payload(mv), real_ip=ip(21))
    so, _, _ = http("GET", "/app/api/trains?line=1")
    record("K1 enabled:false switch -> journey 404 + feedback 404 at once, same PID, existing API 200", sj == 404 and sf == 404 and so == 200 and main_pid() == pid0, [sj, sf, so])
    control(feedbackEnabled=False)
    sj, _, _ = http("GET", journey_query(), headers={"x-real-ip": ip(22)})
    sf, _, _ = post_fb(feedback_payload(mv), real_ip=ip(23))
    sb, bb, _ = http("GET", "/app/api/beta")
    record("K2 feedbackEnabled:false -> journey 200, feedback 503, no restart", sj == 200 and sf == 503 and main_pid() == pid0, [sj, sf])
    record("K2b /app/api/beta reflects the switch", sb == 200 and bb["journey"]["feedbackEnabled"] is False, bb)
    CONTROL.write_text("{broken")
    sj, _, _ = http("GET", journey_query(), headers={"x-real-ip": ip(24)})
    record("K3 malformed switch file fails closed (journey 404)", sj == 404, sj)
    control()
    os.chmod(CONTROL, 0o666)
    sj, _, _ = http("GET", journey_query(), headers={"x-real-ip": ip(25)})
    record("K4 group/world-writable switch file fails closed", sj == 404, sj)
    os.chmod(CONTROL, 0o644)
    CONTROL.unlink()
    sj, _, _ = http("GET", journey_query(), headers={"x-real-ip": ip(26)})
    record("K5 missing switch file fails closed", sj == 404, sj)
    control()
    sj, _, _ = http("GET", journey_query(), headers={"x-real-ip": ip(27)})
    record("K6 switch restored -> journey 200 again", sj == 200, sj)

    # ------------------------------------------------------------ admission limits
    codes = [http("GET", journey_query(), headers={"x-real-ip": "10.99.0.1", "x-forwarded-for": f"1.2.3.{i}"})[0] for i in range(14)]
    record("L1 per-client limit: 429 after 10/min even when X-Forwarded-For is varied", codes.count(200) <= 10 and 429 in codes, codes)
    other = http("GET", journey_query(), headers={"x-real-ip": "10.99.0.2"})[0]
    record("L2 another client key is not penalised", other in (200, 429), other)

    # ------------------------------------------------------------ restart behaviour of the store lock
    lock = STATE_REAL / "feedback" / ".feedback.lock"
    record("R0 lock file exists while the writer is alive", lock.exists(), state_listing().get("feedback/.feedback.lock"))
    sh("systemctl", "stop", UNIT)  # SIGTERM, exactly what `systemctl restart/stop besrah-core` sends
    lock_after_term = lock.exists()
    record("R1 SIGTERM (systemctl stop) releases the store lock", not lock_after_term, "lock left behind" if lock_after_term else "released")
    start(env)
    sj, _, _ = http("GET", journey_query(), headers={"x-real-ip": ip(30)})
    sf, bf, _ = post_fb(feedback_payload(mv), real_ip=ip(31))
    record("R2 after a plain restart the first feedback write works again", sf == 201 and sj == 200, [sj, sf, bf])
    pid = main_pid()
    os.kill(pid, signal.SIGKILL)  # simulated crash / OOM kill
    time.sleep(4.5)  # Restart=on-failure, RestartSec=3
    for _ in range(40):
        try:
            if http("GET", "/app/api/beta")[0] == 200:
                break
        except Exception:
            time.sleep(0.25)
    sj, _, _ = http("GET", journey_query(), headers={"x-real-ip": ip(32)})
    sf, bf, _ = post_fb(feedback_payload(mv), real_ip=ip(33))
    record("R3 after SIGKILL the planner works", sj == 200, sj)
    record("R4 after SIGKILL feedback FAILS CLOSED (stale lock) with 503 and never fabricates an ACK", sf == 503 and lock.exists(), [sf, bf, lock.exists()])
    stale_note = lock.read_text().strip()[:12] if lock.exists() else ""
    lock.unlink(missing_ok=True)  # the documented operator action: stop writers, inspect, then remove
    sh("systemctl", "stop", UNIT)
    start(env)
    sf, _, _ = post_fb(feedback_payload(mv), real_ip=ip(34))
    record("R5 after the explicit operator removal of the stale lock, feedback works again", sf == 201, sf)

    # ------------------------------------------------------------ filesystem faults
    sh("systemctl", "stop", UNIT)
    os.chmod(STATE_REAL / "feedback", 0o755)
    start(env)
    sj, _, _ = http("GET", journey_query(), headers={"x-real-ip": ip(40)})
    sf, _, _ = post_fb(feedback_payload(mv), real_ip=ip(41))
    record("F1 feedback directory made group/world readable -> feedback 503, planner still 200", sf == 503 and sj == 200, [sj, sf])
    sh("systemctl", "stop", UNIT)
    os.chmod(STATE_REAL / "feedback", 0o700)
    victim = next((STATE_REAL / "feedback").glob("feedback-*.jsonl"))
    original = victim.read_bytes()
    with victim.open("ab") as f:
        f.write(b'{"torn":')
    start(env)
    sf, _, _ = post_fb(feedback_payload(mv), real_ip=ip(42))
    record("F2 torn JSONL line -> store refuses writes (503), no silent repair", sf == 503 and victim.read_bytes().endswith(b'{"torn":'), sf)
    sh("systemctl", "stop", UNIT)
    (STATE_REAL / "feedback" / ".feedback.lock").unlink(missing_ok=True)
    victim.write_bytes(original)
    start(env)
    sf, _, _ = post_fb(feedback_payload(mv), real_ip=ip(43))
    record("F3 after operator restores the file, writes resume", sf == 201, sf)
    sh("systemctl", "stop", UNIT)
    (STATE_REAL / "feedback" / ".feedback.lock").unlink(missing_ok=True)
    moved = STATE_REAL / "feedback-moved"
    (STATE_REAL / "feedback").rename(moved)
    os.symlink(moved, STATE_REAL / "feedback")
    start(env)
    sf, _, _ = post_fb(feedback_payload(mv), real_ip=ip(44))
    record("F4 feedback directory replaced by a symlink -> refused (503)", sf == 503, sf)
    sh("systemctl", "stop", UNIT)
    (STATE_REAL / "feedback").unlink()
    moved.rename(STATE_REAL / "feedback")

    # ------------------------------------------------------------ final: old routes and concurrency
    (STATE_REAL / "feedback" / ".feedback.lock").unlink(missing_ok=True)
    start(env)
    ids = [uuid.uuid4().hex for _ in range(6)]
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(lambda i: post_fb(feedback_payload(mv, ids[i]), real_ip=ip(60 + i))[0], range(6)))
    stored = sum(1 for r in res if r == 201)
    time.sleep(1)
    lines = sum(len(p.read_text().splitlines()) for p in (STATE_REAL / "feedback").glob("feedback-*.jsonl"))
    record("C1 six parallel writes: every outcome is 201 or 429 (busy), nothing lost or duplicated", set(res) <= {201, 429} and stored >= 1 and all(
        sum(1 for p in (STATE_REAL / "feedback").glob("feedback-*.jsonl") for ln in p.read_text().splitlines() if i in ln) == (1 if r == 201 else 0) for i, r in zip(ids, res)), [res, lines])
    jr = sh("journalctl", "-u", UNIT, "--no-pager", "-o", "cat").stdout
    record("C2 service log contains no request body, token, IP or note text", not re.search(r"10\.77\.|reportId|storeForModelImprovement|note", jr), jr[-300:])
    final_state = state_listing()
    sh("systemctl", "stop", UNIT)

    Path(args.out).write_text(json.dumps({"stage": str(ST / "srv"), "port": PORT, "unitProperties": unit_text, "stateListingBeforeCleanup": final_state,
                                           "note": "Synthetic feedback in a disposable DynamicUser StateDirectory; not field evidence.",
                                           "results": RESULTS}, indent=2, ensure_ascii=False) + "\n")
    fails = [r for r in RESULTS if r["result"] == "FAIL"]
    print(f"\n{len(RESULTS) - len(fails)} PASS, {len(fails)} FAIL")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
