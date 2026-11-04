# R2a-PB API and data contract

This is a model-only, single-line, platform-ready journey beta. It is not real-time, door-to-door, a fare calculation or a city-wide fastest-route claim. Existing R1/R2a engines and their strict calendar/declaration contracts remain unchanged.

## Flags and routing

- Default OFF: `BESRAH_JOURNEY_BETA=on` is required to enable. `BESRAH_FEEDBACK_DIR=/absolute/private/directory` is separately required for writes. No directory is created with beta OFF.
- `BESRAH_JOURNEY_CALENDAR=strict` fails closed for unresolved non-Friday calendars. Default beta `weekday_baseline` yields explicit estimated/partial results and a permanent holiday warning. No arbitrary public calendar assertion is trusted; validated calendar declarations remain an internal R2a contract, not a user-supplied authority.
- Optional `BESRAH_JOURNEY_SWITCH_FILE=/absolute/control.json` is read on every admission. Exact schema: `{ "schemaVersion":1, "enabled":true, "feedbackEnabled":true, "rolloutPercent":0 }`. Missing, unsafe, malformed, symlink or writable-by-others file disables the beta. Owner UID/root, regular file, <=1024 bytes. Atomic replacement is recommended. Existing board endpoints do not consult this flag.
- Share 0..100 controls UI exposure, not authorization. Anyone may voluntarily opt in; no Telegram identity or fixed tester allowlist is claimed. Disabled API returns 404. Default share is zero.
- Core routes below begin `/app/api/`. The existing edge maps `/api/` to them. All beta responses are `Cache-Control: no-store`; no cross-origin permission headers are emitted. Production Nginx is still GET-only. The exact POST exception is a separately tested candidate fragment, NOT installed by this phase.

## GET /app/api/beta

Always 200:

```json
{"journey":{"enabled":false,"rolloutPercent":0,"feedbackEnabled":false,"calendarMode":"weekday_baseline","horizonDays":7,"windowMinutes":120}}
```

Feedback availability is false after a known store fault. Store initialization is lazy; discovery is not a durability guarantee. UI must still handle write errors.

## GET /app/api/journey

Allowlisted query only: `line=1|2`, `from=METRO-nnn`, `to=METRO-nnn`. Both station IDs must belong to the chosen canonical registry line and differ. Optional `date=YYYY-MM-DD` AND `time=HH:MM` together; Asia/Tehran, today..today+7, no more than five minutes before server clock. Without them, readyAt is the server's current platform-ready time. Unknown keys, repeated/non-string keys, invalid calendar dates and `at` are rejected.

Response schema:

```text
{schemaVersion:1,beta:true,modelOnly:true,live:false,
 status:"ok"|"partial"|"insufficient_data"|"no_feasible_option",reason,message,
 request:{line,originId,destinationId,originName,destinationName,readyAt,source:"server_now"|"user_selected",windowMinutes:120},
 calendar:{state:"known"|"estimated"|"unknown",dayType:"normal"|"thursday"|"friday"|null,label,warning,serviceDate},
 modelVersion:"sha256:<64 lowercase hex>",
 options:[{id,service:"A"|"B"|null,toward,departAt:"HH:MM",arriveAt:"HH:MM",departDate,arriveDate,
           departEpoch,arriveEpoch,waitSeconds,inVehicleSeconds,earliestArrival,derivedExtension,confidence}],
 coverage:{complete,truncated,listed,matched,rejectedTrips,issueCodes},
 asOf:"ISO+03:30",validUntil:"ISO+03:30"}
```

Options are genuine R2a trips, departure-sorted, at most five. Earliest modeled arrival among examined candidates is retained when display truncates; truncation is partial, never complete. A/B remain internal service identifiers; UI labels actual destinations (Ghadir/Airport/Vakilabad), not service letters. Non-usable statuses carry no option numbers. Full Line 1 airport travel can exceed one hour; 120 minutes is deliberate, not a silent 60-minute UI assumption. Seconds in DTO are integer estimates; UI uses rounded whole-minute text, never fractional seconds.

`asOf` and `validUntil` describe response freshness, NOT timetable accuracy. Expiry is 30 seconds after generation; UI must mark stale and request refresh. A Friday calendar classification is not an operational guarantee. Always show the model-only/no entrance-walk/no transfer notice near usable results, plus the fixed non-Friday baseline warning.

Errors: 400 `{error:"bad_request",code}`, 404 disabled, 429 `{error:"rate_limited"|"busy"}` with Retry-After, 503 `{error:"journey_timeout"|"journey_unavailable"}`. Timeout does not release still-running engine capacity prematurely.

## POST /app/api/journey-feedback

Anonymous optional write boundary, no cookies or identity authority. Required headers `Content-Type: application/json`, `X-Besrah-Beta: 1`; browser Origin must match the configured explicit allowlist and cross-site Fetch Metadata is rejected. No-Origin non-browser clients are allowed under the same admission limits and unverified status; this is not authentication. Size <=4096 bytes including malformed JSON. No OPTIONS/CORS opt-in. Frontend fetch uses `credentials:"omit"`.

```text
{v:1,reportId:"[A-Za-z0-9-]{16,64}",kind:"timing_quality"|"train_observation"|"boarding_outcome"|"problem",
 consent:{storeForModelImprovement:true},modelVersion:"sha256:...",
 context:{line:1|2,originId,destinationId,serviceDate,tripId?,readyAt?,calendarState?},
 // EXACTLY one corresponding block:
 timingQuality:"close"|"earlier"|"later"|"unknown",
 observation:{event:"train_arrival"|"train_departure",stationId,direction:"out"|"back"|"unknown",observedAt,
              precision?:"minute"|"approximate",timePrecision?:"minute"|"second"|"unknown"},
 outcome:{result:"made_it"|"missed"|"unknown",platformReadyAt?},
 problem:{category:"cancelled"|"different_schedule"|"wrong_station"|"wrong_direction"|"other"|"unknown"},
 note?:"short optional plain text"}
```

`reportId` is an idempotency/report receipt, never a person. Retry the same content with the same ID after an uncertain network ACK. Consent is explicit, purpose model improvement, unselected by default. Declining feedback must not block planning. Timing quality is qualitative, not seconds. Train arrival/departure differs from personal platform arrival; boarding outcome never measures train-model error. Client-supplied precision is an unverified claim; omitted precision defaults approximate/unknown.

Only actual valid timestamps with UTC `Z` or Tehran `+03:30` are accepted; impossible dates and 24:00 normalization are rejected. Observation no older than 36 hours, maximum 120 seconds future clock tolerance. Qualitative/observation/outcome serviceDate today or two days back; problem reports may concern today+7. Direction unknown prevents time-error matching. Context, line, event, ordered origin/destination and genuine trip ID are checked before a model comparison; no nearest-trip guessing. A provider lookup failure preserves an unverified claim without inventing a delta. Model version mismatch is explicit.

Unknown fields are rejected without echoing attacker keys. Notes <=200 characters; conservative filters reject URLs/markup/commands/contact-like numbers, email and coordinate-like data. This minimizes accidental PII but cannot prove all names or personal data absent. UI explicitly asks not to enter them. No text is interpreted as an instruction, fetched as a URL, or sent to a model/provider.

Responses: 201 `{status:"stored",reportId,receivedDate}` only after durable write; 200 `{status:"duplicate",reportId}`; 400 invalid issues (fixed schema paths), 403 forbidden, 413 too large, 415 unsupported media, 429 limited/busy, 503 full/unavailable/timeout. A request timeout during filesystem work can leave a durable record without a received ACK; same-ID retry resolves this safely. No successful ACK is fabricated after a known write error.

## Storage, provenance, trust

Monthly private `feedback-YYYY-MM.jsonl`, schema 1, directory0700/file0600, one cooperating writer via exclusive `.feedback.lock`. JSONL is append-only except explicit operator maintenance. Raw record includes normalized payload, server `receivedAt` and `reportedAt` (same UTC timestamp), `sourceId=anonymous_feedback:<reportId>`, explicit consent version/purpose/provenance, class, `identity=anonymous_unverified`, `review=unreviewed`, `modelVersionMatches`, and `{tripMatch,modelEventAt,deltaSeconds}` comparison. Provenance always says independentlyVerified=false and modelTimetableUpdated=false. A matching trip is not independent evidence or authenticated identity.

No IP/hash, user agent, account, Telegram initData, location, address, GPS or automatic travel-history database. Rate keys are salted, temporary in-memory pseudonyms only. Loopback edge X-Real-IP is trusted solely for rate limiting; Nginx must overwrite it. Arbitrary forwarded identity is never authority. Logger is disabled and feedback edge access/body logging stays off.

Limits: two in-flight computations total, one writer; 60 journey/min globally and10/client/min;30 feedback attempts/min globally and10/client/hour. Key table bounded, no HTTP work queue. Store total8MiB including metadata, at most2000 daily accepted intake, bounded report-ID index. Deleted daily-intake offsets in `quota.json` prevent quota reset on maintenance/restart. Corruption, symlinks, unsafe ownership, torn line and stale lock fail closed. No automatic repair or TTL lock stealing.

Rejections persist fixed aggregate reason codes only; no rejected body. `flush()` is terminal drain/close, not periodic checkpoint. Backup/export requires a quiescent private snapshot; stale lock inspection is explicit. Retention policy30days; no unauthorized Production cron is installed. Operator snapshot publication, QC, deletion/backup retirement and limitations are in FEEDBACK-OPERATIONS.md. Actual deletion is not complete merely because a pruned copy exists.

Reviews are separate versioned QC records, never edits to anonymous submissions. The full review schema and minimum30 independently checked held-out observations for MAE/P90 are in FEEDBACK-OPERATIONS.md. No real user observations exist from this implementation or benchmark. Calibration, held-out evaluation, owner approval and later release are separate gates; feedback cannot mutate timetable or reopen R2b.
