# R0 release identification (no deployment)

`python3 scripts/release_inventory.py` uses only Python's standard library and the existing local `git` executable. Python 3.10+ is required. It inventories **existing files**; it never builds, installs packages, copies runtime files, starts/restarts services, accesses external providers, or commits anything.

## Commands

Run serially after all R0 agents have finished changing files. Source and production roots must be distinct; the source root must be the Git repository root. Keep the manifest outside both input trees, for example in the already-created checkpoint directory:

```sh
python3 scripts/release_inventory.py create \
  --source-root /root/projects/besrah \
  --production-root /srv/besrah \
  --output /var/backups/besrah/r0-20261102T071441Z/R0.manifest.json

python3 scripts/release_inventory.py validate \
  --source-root /root/projects/besrah \
  --production-root /srv/besrah \
  --manifest /var/backups/besrah/r0-20261102T071441Z/R0.manifest.json

PYTHONDONTWRITEBYTECODE=1 python3 -W error::ResourceWarning \
  -m unittest discover -s tests/release -v
```

Exit `0` means creation/validation succeeded; exit `1` is a rejected snapshot, stale inventory, invalid manifest, or I/O failure; malformed command arguments exit `2`. Errors go to stderr. Creation re-inventories and validates before writing. The manifest is mode `0600`, staged under `TMPDIR`, then replaced atomically; output must be on the same filesystem as `TMPDIR` (cross-filesystem replacement fails without partially writing a manifest). Both source and production are read-only inputs. Output beneath either root is rejected, preventing self-hashing, self-induced Git dirt, and overwriting source/deployment files. Do not redirect output into either input tree.

The parent R0 operator generates the final manifest **after** the whole suite and all agents finish. Tests create tiny, isolated Git repositories, JSON/CSV/SQLite files and fake deployments below `TMPDIR`; they do not touch `/srv/besrah` or the project's data. No fixture build, install, service, network request or production write is needed.

## What the identities mean

- `candidate` is the current allowlisted working source, public assets, data, package/config metadata, R0 tool/tests/documentation and **already-existing** `dist` artifacts. `git.head` is a separate reference, never the candidate's release identity.
- `dirty_worktree_snapshot` is mandatory when Git reports staged/unstaged/untracked changes, or any inventoried non-artifact bytes differ from the HEAD blob. This second check also catches ignored new source/data files and `assume-unchanged` modifications. Status names are not included: only flags and the number of porcelain untracked entries (which can be directories) are recorded.
- `committed_source_snapshot` means Git reports clean and inventoried non-artifact bytes match HEAD. It does **not** mean existing ignored `dist` was built from that commit. Neither kind is called a `committed_release`.
- `deployed` is independently read from the production root, labeled `deployed_snapshot`, with `git: null`. Its package version is read from its own installed `package.json`. It does not inherit candidate Git provenance.
- Candidate and deployed IDs are SHA-256 hashes of their entire canonical snapshot objects except `id`. Git's original blob hash algorithm is used only to check HEAD blob equality; all manifest/file identities use SHA-256.
- `comparison` reports runtime/package/asset/data path differences (`changed`, `candidate_only`, `deployed_only`, `equal_count`). Candidate-only source/tool/config files are intentionally not runtime differences.

These are file inventories, **not hermetic/reproducible-build claims**, artifact-to-source attestations, authenticity signatures, a process-memory identity, or permission to deploy. A checksum cannot protect against an attacker rewriting both the trusted files and a complete manifest. Files outside the policy are not attested. Freeze inputs while capturing: per-file stability checks and the second capture detect ordinary concurrent edits, but do not create an atomic filesystem snapshot. Runtime files can also differ from bytes an already-running process has loaded.

## Explicit inventory policy, version 2

The positive policy is in `scripts/release_inventory.py` (`REQUIRED`, `SOURCE_REQUIRED`, `DATA_FILES`, `TOOL_FILES`, and `selected_paths`). Do not substitute a whole-repository recursive hash or a production-directory dump.

1. Both roots: `packages/core/package.json`, `package-lock.json`, all safe `packages/core/dist/**/*.js`, `*.js.map`, `*.d.ts`, `*.d.ts.map`. Runtime `dist/index.js` and `dist/miniapp.js` must exist. Unknown non-private dist file types fail closed rather than silently leaving a partial runtime inventory.
2. Candidate only: safe `packages/core/src/**/*.ts`, both TypeScript configurations, the release-tool/test/documentation files, and `scripts/build_bus_app_data.py`. The bus generator is part of source identity; other tests/fixtures and unrelated docs are not candidate identity inputs.
3. Public Mini App files: the existing `MINIAPP_ASSETS` literal allowlist, parsed without evaluating code. Candidate uses its `src/miniapp.ts`; production uses its installed `dist/miniapp.js`. This includes vendored JS/CSS/fonts, icons, service SVGs, the shell, views, UI modules and the served JSON datasets. Unserved copied README/test files are not runtime assets. Unsupported allowlist syntax fails closed.
4. Data: exact `DATA_FILES` entries cover `network.json`, `anchors.json`, the three existing historical field CSV inputs, `field/corrections.json`, the two official structured input JSONs and reference image, plus the existing bus SQLite, six guide JSONs, `data/bus/corrections/ui-v1.json` and named export files when present. The field files are immutable timing inputs already in production: only hashes, sizes and row counts are recorded, never observation records. The `raw/` data tree, research snapshots and arbitrary future data files are never included. An absent optional dataset remains absent, not invented; removing or adding a previously recorded/allowed dataset invalidates validation. Both roots require `network.json` and `anchors.json`.
5. Hidden/private paths, `research`, `raw`, `session(s)`, `node_modules`, contact/secret/credential/env filename components and caches are excluded. An asset allowlist trying to expose one fails before reading it. Inventory inputs cannot be symlinks or traversal/absolute paths. Dependency installations, credentials, contacts, research and raw snapshots are neither hashed nor copied into the manifest. No original file contents or absolute input roots are embedded.

Installed node_modules contents, host Node binary/version, external APIs, service/nginx/n8n/Telegram state and installed `/etc` configuration are deliberately outside this local-file identity. The package/lock hashes and separately installed package version are included; they do not assert that an installed dependency tree matches its lockfile.

Any scope/parser change requires a `policy_version` bump; a wire-format/schema change requires a `schema_version` bump. Unknown versions are rejected, not coerced or migrated silently.

## Strict manifest contract, schema version 1

No extra or missing fields are accepted at any object level:

- Top level: `schema_version`, `policy_version`, `kind` (`besrah-r0-release-inventory`), `candidate`, `deployed`, `comparison`, `manifest_sha256`.
- Each snapshot: `kind`, `git`, `package`, `files`, `id`.
- Candidate Git: `head`, `dirty`, `inventory_differs_from_head`, `index_dirty`, `worktree_dirty`, `untracked_entries`. Deployment Git must be JSON null.
- Package: nonempty strings `name` and `version`.
- Each file: `path` (safe root-relative POSIX path), `category` (`source`, `artifact`, `asset`, `data`), `bytes` (nonnegative integer), `sha256` (64 lowercase hex characters), and **only for data** `stats`.
- JSON/GeoJSON stats: `format: json`, `root_type` (`object`, `array`, `scalar`), measured `records`, and `collections` (immediate array/object member lengths). Scalar values and row contents are not retained.
- CSV stats: `format: csv`, `columns`, `records` (nonempty data rows, excluding the header).
- SQLite stats: `format: sqlite`, `tables` (user-table row counts). SQLite is opened `mode=ro&immutable=1`, query-only, explicitly closed. WAL/SHM/journal sidecars fail closed; the tool will not checkpoint or mutate a live database.
- Other allowed binary data stats: `format: binary`.
- Comparison: sorted unique path arrays `candidate_only`, `deployed_only`, `changed`, and nonnegative `equal_count`.

Manifest file arrays must be sorted and unique. Integers cannot be booleans. JSON duplicate keys and non-finite constants are rejected. Canonical checksum encoding uses UTF-8 JSON with sorted keys, ASCII escapes, compact separators, no NaN, and no timestamp or absolute input path. `manifest_sha256` covers the top-level object except itself. It is not a hash input of any inventoried file.

Validation checks the schema, versions, snapshot and manifest checksums, derived comparison, and then fresh source/deployment inventories. It rejects missing or unexpected allowed files, changed package/Git metadata, content hashes, byte lengths and stale/resealed statistics. Adding excluded/private files does not broaden the manifest scope; Git dirt may still change. Data statistics are measured facts about the inventoried bytes, not authoritative external facts or a replacement for domain-specific integrity tests.

## Tests-first evidence

Development exercised vertical RED→GREEN cycles with `python3 -m unittest discover -s tests/release -v`:

- RED: initial assertion `R0 release inventory tool is not implemented`; GREEN: deterministic identities and separate dirty candidate/deployment.
- RED: missing `dist/index.js.map` inventory and private-source exclusion; GREEN: positive file/data policy and installed-dist asset selection.
- RED: data entries lacked measured `stats`; GREEN: JSON/CSV/SQLite statistics and fresh validation.
- RED: `schema_version: true` incorrectly compared equal to `1`; GREEN: strict types/versions/checksums and duplicate-key rejection.
- RED: traversal/private assets reached filesystem reads and symlinks were accepted; GREEN: fail-closed safe paths and symlink rejection.
- RED: CLI produced no manifest artifact; GREEN: actual create/validate roundtrip, deterministic output and no fake-runtime writes.
- RED: ignored source falsely produced a clean committed-source label; GREEN: direct HEAD blob equality, including `assume-unchanged` cases.
- RED: unrecognized dist file silently disappeared; GREEN: unknown runtime artifacts fail closed.
- Parent integration RED: bus corrections and their generator were absent from candidate identity; GREEN: policy version 2 explicitly inventories both. Their modification now invalidates a captured manifest even when no Git status flag changes.

Additional negative cases cover resealed missing/extra/changed/private inventory entries, installed-byte changes, stale statistics/hash and SQLite sidecars. Run the test command above for current test count and timings; project-wide regression verification belongs to the parent R0 run.
