# Besrah Telegram metro workflows

## Rebuild and test (no dependencies required)

From the repository root:

```sh
node --test tests/n8n/*.test.mjs
node scripts/build-n8n-workflow.mjs
```

Generated exports:

- `besrah-metro.workflow.json`: `BesrahMetro01`, **Besrah - Metro Telegram**, inactive and entirely credential-free.
- `besrah-metro-smoke.workflow.json`: `BesrahMetroSmoke01`, manual-only synthetic integration tests, no Telegram nodes or sends.

The generator reads `data/network.json` without modifying it. Only station metadata and the existing line-1 station order are embedded; observations and timetable data remain in the core service. IDs and output are deterministic. Edit `normalize.js`/`render.js` and regenerate rather than editing generated code.

## Activation handoff

1. Ensure the n8n process can reach `http://127.0.0.1:3080/v1/next`. If n8n is containerized, localhost is the container: deliberately update the trusted fixed URL rather than accepting a URL from a message.
2. Import the smoke export, then execute it manually or via n8n CLI. It uses nine **synthetic test messages**, not real Telegram updates, and makes two actual localhost core GET requests at `2026-10-16T14:00:00+03:30`. No core responses are fabricated in the smoke workflow.
3. The terminal `Smoke Assertions` node must return `ok: true`, `total: 9`, `core_queries: 2`, `telegram_calls: 0`. It throws `BESRAH_SMOKE_FAILED` on a bad/missing result. Cases: station, location, start, unknown, line2_name, line2_location, outside_service, malformed_coords, stations. Prediction cases must render the canonical station; other cases must render the expected local reply kind. All cases verify preserved chat ID, HTML safety and the request-location keyboard. A Merge append node waits for both branches; the local renderer is the identical production source.
4. Import the production export. Select the same dedicated Telegram API credential on **Telegram Trigger** and **Telegram Send**. Credentials and credential references are intentionally absent from the export. Do not put a token in a URL, source file, workflow JSON, or execution log.
5. Confirm HTTPS `WEBHOOK_URL` and explicitly activate. Trigger version 1.3 uses n8n's generated webhook secret-token authentication and drops pending updates on activation. Only one active Telegram Trigger can own a bot webhook.

## Behavior and bounds

- Initial release processes only human-origin private chat messages. Groups, supergroups, channels, bot users and malformed chat envelopes are dropped before any HTTP or Telegram action.
- `/start` and `/help` explain usage; `/stations` lists only the existing supported line-1 order. Persian/Arabic yeh/kaf, diacritics, whitespace and zero-width joining variations normalize to canonical names.
- Locations use Haversine distance across **all existing stations**, including line 2. If the closest station is line-2-only, the reply explicitly says that predictions are unsupported; it does not substitute a farther line-1 station. Interchange Shariati remains supported for line 1.
- `maxNearestKm: 10` in generated **Metro Data** is the configurable service guard. It is distance to the nearest known station, not distance to a city center or a walking-route distance. Change the generator's metadata configuration and regenerate to retain a change. Non-numeric/non-finite/out-of-range coordinates and points beyond this radius never query the core.
- Core URL is fixed, with `station` and `limit=4` only. Five-second timeout, redirects disabled, `neverError`, and continue-on-error ensure HTTP/transport failures reach a friendly renderer. Backend failures never become unsupported-line warnings. Only smoke adds a fixed `at` query; incoming message fields cannot control it.
- Renderer removes legacy Markdown `*`, HTML-escapes all emitted text, preserves approximation notes and identifies straight-line distances as approximate, not walking routes. The bot is a prediction interface, not live train tracking.

## Privacy

Both exports disable success/error/manual execution history saving and execution progress, with `Asia/Tehran` timezone. These settings were checked against the installed n8n implementation. Normalized output drops message/GPS fields; rendered output drops backend response bodies. **This is not zero-persistence:** n8n writes an initial trigger snapshot to its execution store. On completion with history saving disabled, n8n soft-deletes the execution and marks it eligible for hard pruning; payloads can remain in the backing SQLite database until that pruning runs. A soft-deleted row can still have `status: running`, so always filter `deletedAt IS NULL` when checking active execution metadata. This does not erase Telegram's records, database backups/WAL remnants or server/proxy logs. Do not pin real messages/GPS or enable verbose payload logging. Keep runtime credentials outside Git. Synthetic unit-test core envelopes in `tests/n8n` are explicitly labeled and are never used by the production or smoke workflows.

## Scope

The local build does not import, activate, restart n8n, change credentials/webhooks, or call Telegram. Actual n8n CLI smoke execution and production activation are operator handoff steps.
