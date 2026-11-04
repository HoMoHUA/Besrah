#!/usr/bin/env python3
"""Allowlisted, hash-guarded overlay of the R2a-PB candidate onto a Besrah runtime tree.

Python standard library only. This tool never restarts a service, edits Nginx/systemd or touches
anything outside the explicit plan. It is rehearsed against COPIES of /srv/besrah; running it on
the real /srv/besrah is allowed only after a separate PRODUCTION_DEPLOY_GO.

  plan      build plan.json: allowlist + candidate hashes + the current target pre-state
  apply     refuse unless every target is still in its recorded pre-state; snapshot; replace atomically
  verify    check a tree is in the recorded pre or post state
  rollback  restore the snapshot; refuse if a file is in neither recorded state (unless --force)

Plan groups are applied in order: `data` (runtime data files, e.g. the NET01 timetable overlay; they must exist before the new
code starts), `dist` (core code; needs a service restart), then `assets`
(Mini App files; views/metro.js is the entry import and is always last).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import sys
from pathlib import Path

ENTRY_LAST = "apps/miniapp/views/metro.js"
EXCLUDED_SUFFIXES = (".test.mjs", ".md")


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tree(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if p.is_file() and not p.is_symlink():
            out[str(p.relative_to(root))] = sha(p)
    return out


def state(root: Path, rel: str) -> str | None:
    p = root / rel
    if p.is_symlink():
        return "symlink"
    return sha(p) if p.is_file() else None


def build_plan(candidate: Path, production: Path, base_dist: Path, base_ref_assets: dict[str, str], note: str, data_rel: list[str] | None = None) -> dict:
    cand_dist = tree(candidate / "packages/core/dist")
    base = tree(base_dist)
    # Dist is planned against what Production actually runs, not against the Git base: R1/R2a modules were never deployed.
    dist_rel = sorted("packages/core/dist/" + k for k, v in cand_dist.items()
                      if state(production, "packages/core/dist/" + k) != v)
    assets_rel = sorted(k for k in base_ref_assets if not k.endswith(EXCLUDED_SUFFIXES) and "/test-support/" not in k)  # test fixtures never ship
    assets_rel = [a for a in assets_rel if a != ENTRY_LAST] + ([ENTRY_LAST] if ENTRY_LAST in assets_rel else [])
    files = []
    for group, names in (("data", sorted(data_rel or [])), ("dist", dist_rel), ("assets", assets_rel)):
        for rel in names:
            src = candidate / rel
            if not src.is_file() or src.is_symlink():
                raise SystemExit(f"candidate file missing or not regular: {rel}")
            pre = state(production, rel)
            if pre == "symlink":
                raise SystemExit(f"refusing symlink target: {rel}")
            entry = {"group": group, "path": rel, "candidateSha256": sha(src), "preSha256": pre}
            if group == "dist":
                key = rel.removeprefix("packages/core/dist/")
                # Honest provenance: is this exact file already in the approved base build (previous phases, never deployed)?
                entry["identicalToApprovedBaseBuild"] = base.get(key) == entry["candidateSha256"]
                # For replaced files: does Production already equal the base build? False means the replacement
                # also carries earlier-phase changes (not only PB), which the owner must know about.
                entry["productionEqualsApprovedBaseBuild"] = None if pre is None else base.get(key) == pre
            files.append(entry)
    planned = {f["path"] for f in files}
    # Runtime-scope files that differ from Production but are NOT part of this plan: deliberately excluded.
    drift = []
    for scope in ("apps/miniapp", "packages/core/dist", "data", "packages/core/package.json"):
        base_path = candidate / scope
        paths = [base_path] if base_path.is_file() else [p for p in base_path.rglob("*") if p.is_file() and not p.is_symlink()]
        for p in paths:
            rel = str(p.relative_to(candidate))
            if rel in planned or rel.endswith(EXCLUDED_SUFFIXES) or "/test-support/" in rel or rel.startswith(("data/bus/", "packages/core/node_modules")):
                continue
            prod = state(production, rel)
            if prod is not None and prod != sha(p):
                drift.append({"path": rel, "candidateSha256": sha(p), "productionSha256": prod})
    return {"schema": 1, "note": note, "files": files, "excludedDrift": drift}


def load(plan_path: str) -> dict:
    plan = json.loads(Path(plan_path).read_text())
    if plan.get("schema") != 1 or not isinstance(plan.get("files"), list) or not plan["files"]:
        raise SystemExit("invalid plan")
    seen = set()
    for f in plan["files"]:
        rel = f["path"]
        if rel.startswith("/") or ".." in Path(rel).parts or rel in seen:
            raise SystemExit(f"unsafe or duplicate plan path: {rel}")
        seen.add(rel)
    return plan


def check(plan: dict, root: Path, which: str) -> list[str]:
    bad = []
    for f in plan["files"]:
        want = f["preSha256"] if which == "pre" else f["candidateSha256"]
        got = state(root, f["path"])
        if got != want:
            bad.append(f"{f['path']}: expected {which} {want}, found {got}")
    return bad


def atomic_write(src: Path, dst: Path, mode: int) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f".{dst.name}.preflight-tmp")
    shutil.copyfile(src, tmp)
    os.chmod(tmp, mode)
    with tmp.open("rb") as f:
        os.fsync(f.fileno())
    os.replace(tmp, dst)
    fd = os.open(dst.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def cmd_apply(a) -> int:
    plan, root, snap = load(a.plan), Path(a.target), Path(a.snapshot)
    groups = a.group or ["data", "dist", "assets"]
    selected = [f for f in plan["files"] if f["group"] in groups]
    bad = [b for b in check({"files": selected}, root, "pre")]
    if bad:
        print("REFUSED: target is not in the recorded pre-state; nothing was changed", *bad, sep="\n  ")
        return 1
    if a.dry_run:
        print(f"dry-run ok: {len(selected)} files would change")
        return 0
    cand = Path(a.candidate)
    snap.mkdir(parents=True, exist_ok=True)
    for f in selected:  # snapshot first: no write happens until every original is safely copied
        cur = root / f["path"]
        if cur.is_file():
            dst = snap / f["path"]
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cur, dst)
            if sha(dst) != f["preSha256"]:
                print(f"snapshot copy mismatch: {f['path']}")
                return 1
    for f in selected:
        cur = root / f["path"]
        mode = stat.S_IMODE(cur.stat().st_mode) if cur.is_file() else 0o644
        atomic_write(cand / f["path"], cur, mode)
    bad = check({"files": selected}, root, "post")
    if bad:
        print("POST-VERIFY FAILED", *bad, sep="\n  ")
        return 1
    print(f"applied {len(selected)} files ({', '.join(groups)}); snapshot {snap}")
    return 0


def cmd_verify(a) -> int:
    plan = load(a.plan)
    selected = [f for f in plan["files"] if not a.group or f["group"] in a.group]
    bad = check({"files": selected}, Path(a.target), a.state)
    print("OK" if not bad else "MISMATCH", *bad, sep="\n  ")
    return 1 if bad else 0


def cmd_rollback(a) -> int:
    plan, root, snap = load(a.plan), Path(a.target), Path(a.snapshot)
    if a.group:  # roll back one unit only; the plan file of that unit is normally used on its own
        plan = {**plan, "files": [f for f in plan["files"] if f["group"] in a.group]}
        if not plan["files"]:
            raise SystemExit("no plan files in the selected group")
    for f in plan["files"]:
        cur = state(root, f["path"])
        if cur not in (f["preSha256"], f["candidateSha256"]) and not a.force:
            print(f"REFUSED: {f['path']} is in neither recorded state ({cur}); nothing was changed")
            return 1
    for f in reversed(plan["files"]):
        target = root / f["path"]
        if f["preSha256"] is None:
            if target.exists():
                target.unlink()
        else:
            saved = snap / f["path"]
            if not saved.is_file() or sha(saved) != f["preSha256"]:
                print(f"snapshot missing or altered for {f['path']}; stopped")
                return 1
            atomic_write(saved, target, stat.S_IMODE(saved.stat().st_mode))
    for f in plan["files"]:  # drop only directories that this overlay created and that are now empty
        d = (root / f["path"]).parent
        while d != root and d.is_dir() and not any(d.iterdir()):
            d.rmdir()
            d = d.parent
    bad = check(plan, root, "pre")
    print("rolled back; pre-state verified" if not bad else "ROLLBACK VERIFY FAILED", *bad, sep="\n  ")
    return 1 if bad else 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("plan")
    s.add_argument("--candidate", required=True)
    s.add_argument("--production", required=True)
    s.add_argument("--base-dist", required=True, help="dist directory built from the approved base revision")
    s.add_argument("--base-assets-json", required=True, help='JSON list of apps/miniapp paths changed since base (git diff --name-only)')
    s.add_argument("--data-json", default=None, help="JSON list of runtime data paths (relative to the repo) to ship in the `data` group")
    s.add_argument("--note", default="")
    s.add_argument("--out", required=True)
    s = sub.add_parser("apply")
    s.add_argument("--plan", required=True); s.add_argument("--candidate", required=True)
    s.add_argument("--target", required=True); s.add_argument("--snapshot", required=True)
    s.add_argument("--group", action="append", choices=["data", "dist", "assets"]); s.add_argument("--dry-run", action="store_true")
    s = sub.add_parser("verify")
    s.add_argument("--plan", required=True); s.add_argument("--target", required=True)
    s.add_argument("--state", choices=["pre", "post"], required=True); s.add_argument("--group", action="append", choices=["data", "dist", "assets"])
    s = sub.add_parser("rollback")
    s.add_argument("--plan", required=True); s.add_argument("--target", required=True)
    s.add_argument("--snapshot", required=True); s.add_argument("--force", action="store_true")
    s.add_argument("--group", action="append", choices=["data", "dist", "assets"])
    a = p.parse_args()
    if a.cmd == "plan":
        names = json.loads(Path(a.base_assets_json).read_text())
        plan = build_plan(Path(a.candidate), Path(a.production), Path(a.base_dist), {n: "" for n in names}, a.note,
                          json.loads(Path(a.data_json).read_text()) if a.data_json else None)
        Path(a.out).write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n")
        print(f"plan: {len(plan['files'])} files, {len(plan['excludedDrift'])} excluded drift")
        return 0
    return {"apply": cmd_apply, "verify": cmd_verify, "rollback": cmd_rollback}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
