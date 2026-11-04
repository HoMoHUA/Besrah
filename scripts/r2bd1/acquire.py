#!/usr/bin/env python3
"""Bounded, append-only public-source acquisition; not product runtime code."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.parse

MAX_BYTES = 5 * 1024 * 1024


def fetch(package, source_id, url, query=None, license_name="unknown", license_url=None):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise ValueError("Only public credential-free HTTPS URLs are permitted")
    if not source_id.replace("-", "").isalnum():
        raise ValueError("Use an alphanumeric/hyphen source ID")
    raw = Path(package) / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    record_path = raw / (source_id + ".request.json")
    body = raw / (source_id + ".body")
    headers = raw / (source_id + ".headers")
    if any(p.exists() for p in (record_path, body, headers)):
        raise FileExistsError("Snapshots are immutable: use a new source ID")
    cmd = ["curl", "--silent", "--show-error", "--location", "--max-redirs", "3",
           "--proto", "=https", "--proto-redir", "=https", "--connect-timeout", "10",
           "--max-time", "45", "--max-filesize", str(MAX_BYTES), "--retry", "0",
           "--user-agent", "BesrahResearch/1.0 (targeted personal geospatial validation)",
           "--dump-header", str(headers), "--output", str(body), "--write-out", "%{json}"]
    query_path = None
    if query:
        query_path = Path(query).resolve()
        cmd += ["--data-urlencode", "data@" + str(query_path)]
    cmd += [url]
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=55)
    try:
        metrics = json.loads(proc.stdout)
    except json.JSONDecodeError:
        metrics = {"http_code": 0}
    content = body.read_bytes() if body.exists() else b""
    if len(content) > MAX_BYTES:
        raise ValueError("Response exceeded explicit body limit")
    payload = None
    try:
        payload = json.loads(content)
    except (ValueError, UnicodeDecodeError):
        pass
    record = {"sourceId": source_id, "url": url, "effectiveUrl": metrics.get("url_effective", url),
              "method": "POST" if query else "GET", "startedAt": started,
              "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "httpStatus": metrics.get("http_code", 0), "curlExit": proc.returncode,
              "error": proc.stderr.strip() or None,
              "bodyPath": str(body.relative_to(Path(package))) if body.exists() else None,
              "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest() if body.exists() else None,
              "headersPath": str(headers.relative_to(Path(package))),
              "responseHeaders": headers.read_text(errors="replace") if headers.exists() else "",
              "contentType": metrics.get("content_type"), "totalSeconds": metrics.get("time_total"),
              "license": license_name, "licenseUrl": license_url,
              "crs": "EPSG:4326" if isinstance(payload, dict) and "osm3s" in payload else None,
              "queryPath": str(query_path.relative_to(Path(package).resolve())) if query_path else None,
              "querySha256": hashlib.sha256(query_path.read_bytes()).hexdigest() if query_path else None,
              "snapshotAt": payload.get("osm3s", {}).get("timestamp_osm_base") if isinstance(payload, dict) else None,
              "overpassRemark": payload.get("remark") if isinstance(payload, dict) else None,
              "fetchSucceeded": proc.returncode == 0 and 200 <= metrics.get("http_code", 0) < 300,
              "useAsGeometryEvidence": isinstance(payload, dict) and "elements" in payload and not payload.get("remark") and proc.returncode == 0 and metrics.get("http_code") == 200,
              "limitBytes": MAX_BYTES, "timeoutSeconds": 45, "automaticRetries": 0}
    record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("package")
    parser.add_argument("source_id")
    parser.add_argument("url")
    parser.add_argument("--query")
    parser.add_argument("--license", default="unknown")
    parser.add_argument("--license-url")
    args = parser.parse_args()
    print(json.dumps(fetch(args.package, args.source_id, args.url, args.query, args.license, args.license_url), ensure_ascii=False, indent=2))
