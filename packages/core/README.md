# @mashhad-waze/core (Phase 0)

Timing engine for Line 1. Reads `../../data/network.json` and the official tables.

- `src/time.ts`    Tehran clock, day type (friday / thursday / normal)
- `src/network.ts` stations, run times, dwell, layovers from network.json
- `src/engine.ts`  headway schedules, out/back trips, `nextPasses(station, at)`

Assumptions (see `derived.day_assumptions` in network.json):
- Friday: A and B both 24 min, phases from field anchors (A 13:59:51, B 14:12 at Vakilabad). Golden-tested against field data and the printed sheet.
- Normal days: site headways, phase not measured (low confidence).
- Extension run times and airport layover (687 s) are derived, not measured.

Run: `npm install && npm test`

## HTTP API (what n8n calls)

Start: `PORT=3080 npm start` (binds 127.0.0.1 by default; set `HOST` only behind a proxy).

`GET /v1/next?station=<نام ایستگاه>&limit=4[&at=<ISO time>]`

- Response: `station`, `as_of`, `day_type`, `passes[]` (toward, service, eta_min, arrive, confidence), `text` (Persian Telegram message, Markdown), `notes[]`.
- `404 {"error":"unknown_station"}` for anything not on line 1 (line 2 is not in the engine yet).
- `400` if `station` is missing.
- `text` is ready to send; n8n only has to send it.

## n8n wiring (replaces Time-AI, Time-Cal, Metro-Text)

1. Keep `Telegram Trigger` and `Metro-Data` (its output field `name` is the station).
2. Delete `Time-AI`, `Time-Cal`, `Metro-Text`.
3. Add **HTTP Request**: `GET http://127.0.0.1:3080/v1/next?station={{ encodeURIComponent($json.name) }}&limit=4`, timeout 5 s, "ignore response code" on.
4. Add **IF**: `{{ $json.error }}` empty → Telegram send; otherwise send "فعلاً فقط خط ۱ پشتیبانی می‌شود."
5. **Telegram Send Message**: Chat ID `{{ $('Telegram Trigger').item.json.message.chat.id }}`, Text `{{ $json.text }}`, parse mode Markdown.

If n8n runs in Docker, `127.0.0.1` inside the container is not the host; use the docker bridge address and bind the API to that address.

## Thursday (1405/07/30)

- Source: `data/field/2026-10-22_line1_thursday_kowsar-vakilabad-ghadir.csv` (one train, Kowsar→Vakilabad→Seyed Razi). The file also repeats the Friday Line 2 rows, which duplicate the existing Line 2 file.
- Measured: run times and dwells (Vakilabad→Seyed Razi and Kowsar→Vakilabad), Vakilabad turnaround 119 s.
- B phase `:05:17` mod 30 (sheet + board 14:35). First train 06:00:17 from the sheet.
- Other segments use Friday × 1.073 (ratio measured on 8 segments).
- Airport layover 687 s also fits Thursday sheet departures (within about 1 min on most of them).
