#!/usr/bin/env python3
"""R2a-PB preflight: edge test through a REPLICA of the real besrah.arklyn.ir server block.

Prerequisite (done by the operator of the preflight, see docs/r2apb/RELEASE-RUNBOOK.md section 'rehearsal'):
a private Nginx on 127.0.0.1:18443 using the real TLS certificate files, the real http-level rate zone, the real
snippet text (only the upstream port changed) plus the candidate POST fragment, proxying to a candidate core on
127.0.0.1:18871. The real Nginx, its sites and its logs are never touched.
"""
import json
import subprocess
import uuid
import sys
import time
from pathlib import Path

N = Path("/var/lib/besrah-preflight/nginx")
HOST = "besrah.arklyn.ir"
BASE = f"https://{HOST}:18443"
RES = []
RUN = uuid.uuid4().hex[:8]  # unique report ids per run: a re-run must not collide with stored synthetic reports


def curl(method, path, data=None, headers=(), extra=()):
    time.sleep(0.25)  # stay under the real 5 r/s edge zone so the checks measure policy, not the zone
    cmd = ["curl", "-sS", "-o", "/tmp/.pf_body", "-w", "%{http_code}", "--max-time", "10", "--resolve", f"{HOST}:18443:127.0.0.1", "-X", method]
    for h in headers:
        cmd += ["-H", h]
    if data is not None:
        cmd += ["--data-binary", data]
    cmd += list(extra) + [BASE + path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    body = Path("/tmp/.pf_body").read_text(errors="replace") if Path("/tmp/.pf_body").exists() else ""
    return int(r.stdout or 0), body


def rec(name, ok, detail=""):
    RES.append({"check": name, "result": "PASS" if ok else "FAIL", "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  [{detail}]"))


def payload(model_version, report_id):
    today = subprocess.run(["date", "-d", "TZ=\"Asia/Tehran\" now", "+%F"], capture_output=True, text=True).stdout.strip()
    return json.dumps({"v": 1, "reportId": report_id, "kind": "timing_quality", "timingQuality": "close", "consent": {"storeForModelImprovement": True}, "modelVersion": model_version,
                       "context": {"line": 1, "originId": "METRO-107", "destinationId": "METRO-108", "serviceDate": today}})


FB = ["content-type: application/json", "x-besrah-beta: 1", f"origin: https://{HOST}"]


def main():
    out = sys.argv[1]
    # TLS validity of the real certificate for the real hostname
    r = subprocess.run(["curl", "-sS", "-o", "/dev/null", "-w", "%{ssl_verify_result} %{http_code} %{http_version}", "--resolve", f"{HOST}:18443:127.0.0.1", BASE + "/api/beta"], capture_output=True, text=True)
    rec("E0 TLS: real certificate validates for the real hostname, HTTP/1.1+ response", r.stdout.split()[0] == "0" and r.stdout.split()[1] == "200", r.stdout)
    st, body = curl("GET", "/api/journey?line=1&from=METRO-107&to=METRO-108", headers=["x-real-ip: 10.5.5.5"])
    mv = json.loads(body)["modelVersion"] if st == 200 else ""
    rec("E1 GET /api/journey through Nginx -> candidate core 200 (read path unchanged: GET/HEAD only)", st == 200 and mv.startswith("sha256:"), st)
    st, body = curl("POST", "/api/journey-feedback", payload(mv, RUN + "edge" + "a" * 12), FB)
    rec("E2 POST exact path with valid body, Origin, header -> 201 over TLS", st == 201, [st, body])
    st, _ = curl("POST", "/api/beta", "{}", FB)
    rec("E3 POST to any other API path is denied (403)", st == 403, st)
    st, _ = curl("POST", "/api/journey", "{}", FB)
    rec("E3b POST to the planner read path denied (403)", st == 403, st)
    st, _ = curl("POST", "/app.js", "{}", FB)
    rec("E4 POST to static root denied (403)", st == 403, st)
    st, _ = curl("POST", "/", "{}", FB)
    rec("E4b POST to / denied (403)", st == 403, st)
    st, _ = curl("POST", "/api/journey-feedback/extra", "{}", FB)
    rec("E5 POST to a sub-path of the feedback route denied (403, exact location only)", st == 403, st)
    st, _ = curl("GET", "/api/journey-feedback")
    rec("E6 GET on the feedback route denied (403)", st == 403, st)
    st, _ = curl("HEAD", "/api/journey-feedback", extra=["-I"])
    rec("E6b HEAD on the feedback route denied (403)", st == 403, st)
    st, _ = curl("PUT", "/api/journey-feedback", "{}", FB)
    rec("E6c PUT/DELETE style methods denied (403)", st == 403, st)
    st, _ = curl("POST", "/api/journey-feedback?token=probe", payload(mv, RUN + "edge" + "b" * 12), FB)
    rec("E7 any query string on the feedback route is refused (400) so a token can never reach logs/core", st == 400, st)
    st, _ = curl("POST", "/api/journey-feedback", "x" * 5000, FB)
    rec("E8 body > 4 KiB rejected at the edge (413)", st == 413, st)
    # The core counts EVERY feedback attempt (valid or not) against the per-client budget of 10/hour; behind Nginx all
    # test traffic is one client (127.0.0.1). Restart the candidate core so the remaining policy checks start fresh.
    subprocess.run(["systemctl", "restart", "besrah-pb-nginx-core"], check=True)
    for _ in range(40):
        if curl("GET", "/api/beta")[0] == 200:
            break
        time.sleep(0.25)
    st, _ = curl("POST", "/api/journey-feedback", payload(mv, RUN + "edge" + "c" * 12), ["content-type: application/json", "x-besrah-beta: 1", "origin: https://evil.example"])
    rec("E9 foreign Origin reaches the core and is rejected (403)", st == 403, st)
    st, _ = curl("POST", "/api/journey-feedback", payload(mv, RUN + "edge" + "d" * 12), ["content-type: application/json", f"origin: https://{HOST}"])
    rec("E10 missing X-Besrah-Beta rejected (403)", st == 403, st)
    st, _ = curl("POST", "/api/journey-feedback", "{bad", FB)
    rec("E11 malformed JSON -> 400, not a proxy error", st == 400, st)
    # forwarded-identity spoof: Nginx must overwrite X-Real-IP, so varying client-supplied values cannot dodge the per-client limit
    time.sleep(61)  # new minute window for the core's journey limiter
    codes = []
    for i in range(14):
        codes.append(curl("GET", "/api/journey?line=1&from=METRO-107&to=METRO-108", headers=[f"x-real-ip: 10.9.9.{i}", f"x-forwarded-for: 8.8.8.{i}"])[0])
        time.sleep(0.25)
    rec("E12 client-supplied X-Real-IP / X-Forwarded-For cannot dodge the per-client limit (429 appears)", 429 in codes and codes.count(200) <= 11, codes)
    time.sleep(2)
    burst = [curl("POST", "/api/journey-feedback", payload(mv, f"{RUN}burst{i:02d}" + "e" * 6), FB)[0] for i in range(14)]
    rec("E13 rapid POST burst: only 201/429 (edge zone + core limits), never 5xx", set(burst) <= {201, 429} and 429 in burst, burst)
    acc = (N / "access.log").read_text(errors="replace") if (N / "access.log").exists() else ""
    err = (N / "error.log").read_text(errors="replace") if (N / "error.log").exists() else ""
    rec("E14 access log has no entry for any /api route (the real /api/ and fragment locations are access_log off)", "/api/" not in acc, f"api lines={acc.count('/api/')}")
    rec("E15 no request body or token text in either Nginx log", "probe" not in acc + err and "storeForModelImprovement" not in acc + err, "")
    Path(out).write_text(json.dumps({"replica": str(N / 'nginx.conf'), "results": RES}, indent=2) + "\n")
    f = [r for r in RES if r["result"] == "FAIL"]
    print(f"\n{len(RES) - len(f)} PASS, {len(f)} FAIL")
    return 1 if f else 0


if __name__ == "__main__":
    sys.exit(main())
