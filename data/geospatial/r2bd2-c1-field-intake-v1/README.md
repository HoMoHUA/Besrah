# R2b-D2 C1 field-intake layer, version 1

**Gate: BLOCKED.** This layer holds the collection plan and, later, exact collaborator submissions. It contains no field observation yet, no routing edges and no ETA.

## Layers

- `missions.json`: the eight C1 missions and the non-gating Danesh Amuz coordinate check, regenerated from the immutable D1 topology and the unchanged `data/network.json` by `scripts/r2bd2/build_missions.py`. Entrance and point IDs are never typed by hand.
- `templates/field-observation.v2.json`: schema 2 template; a strict superset of the D1 v1 template. It is a template, never an observation.
- `observations/<observationId>/observation.json`: exact submitted bytes, written once by `intake.py ingest`. Corrections use a new observationId.
- `observations/<observationId>/validation.json`: verdict, submission hash and verified media hashes.
- `verifications/<verificationId>.json`: independent verification records by a different person. They reference the exact submission hash and never edit it.
- `derived/gate-status.json`: recomputed Gate.

Photos and sketches stay in the private archive (`/var/backups/besrah/field-evidence/` by default), referenced by SHA-256. They are never committed.

## Evidence states

1. `rejected`: actionable errors; nothing is stored.
2. `incomplete`: valid, but a required item is unknown. Unknown is never zero.
3. `requires_review`: a different entrance, a closed path, a recorded contradiction or a platform claim with no sign photo, sketch or operator document.
4. `technically_complete_unverified`: complete, consistent data from one person, self-reported or documented.
5. A leg passes only when a technically complete submission has an accepted independent verification record: a second observer's complete walk of the same mission and entrance, a hashed operator document, or an operator confirmation.

Each direction needs every role of the D1 chain, continuous exact entrance IDs at each station and the D1 metro replay. Even READY only allows an owner decision about the R2b-B design.

## Commands, from the repository root

```bash
python3 -B scripts/r2bd2/intake.py validate SUBMISSION.json
python3 -B scripts/r2bd2/intake.py ingest SUBMISSION.json --evidence-dir RECEIVED_MEDIA_DIR
python3 -B scripts/r2bd2/intake.py verify VERIFICATION.json
python3 -B scripts/r2bd2/intake.py gate --write
python3 -B -m unittest discover -s tests/data -p 'test_r2bd2_*.py' -v
```

`validate` stores nothing. `ingest` refuses rejected, synthetic, duplicate or hash-mismatched input. Synthetic fixtures live only under `tests/fixtures/r2bd2/` with `synthetic: true`.

## Rights and privacy

OSM-derived IDs and coordinates: © OpenStreetMap contributors, ODbL-1.0. Collaborator media: rights stated per file, kept private. Submissions carry pseudonymous codes only; consent, public-area-only and no-people/tickets confirmations are mandatory.
