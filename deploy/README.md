# Besrah runtime and n8n deployment

## Metro timing core

Source workspace: `/root/projects/besrah`.
Runtime: `/srv/besrah`, compiled JavaScript and production dependencies only.
Service: `besrah-core.service`, running as a systemd dynamic user, not root.
Listener: `127.0.0.1:3080` only; no public port or reverse proxy is required for the local n8n integration.

Build and test before deployment:

```sh
cd /root/projects/besrah/packages/core
npm ci
npm test
npm run typecheck
npm run build
```

Preserve the runtime layout: `packages/core/dist/network.js` resolves `../../../data/network.json`. Copy `data/` to the runtime root, not beside `dist/`.

For an initial deployment, copy `dist/`, `package.json`, and `package-lock.json` into `/srv/besrah/packages/core/`, and copy `data/` into `/srv/besrah/data/`. Install production dependencies with `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in the runtime package. Do not copy `session/`, credentials, source history, or development dependencies.

Install the unit from this directory and start it:

```sh
install -m 0644 /root/projects/besrah/deploy/besrah-core.service /etc/systemd/system/besrah-core.service
systemd-analyze verify /etc/systemd/system/besrah-core.service
systemctl daemon-reload
systemctl enable --now besrah-core.service
curl --fail http://127.0.0.1:3080/health
systemctl show besrah-core -p ActiveState -p SubState -p NRestarts
```

For updates, gate replacement and restart on passing tests. Stage new runtime files first and preserve the previous release for rollback. Never modify raw field CSVs or replace observations with estimates.

## n8n isolation and backups

The local n8n process runs directly on the host and can reach the loopback timing API. Do not use Docker bridge addresses for this deployment.

Before importing Besrah, create a consistent SQLite backup using the SQLite backup API. Operational backups containing credentials live outside Git under `/var/backups/besrah/`, with directory mode 0700 and file mode 0600. Verify `PRAGMA integrity_check` on the backup. Record hashes of existing workflow nodes/connections and active flags to prove unrelated workflows did not change.

Import only the explicitly named Besrah workflow JSON files, never a directory containing unrelated workflows. Keep the production Telegram workflow inactive until a dedicated Telegram credential is configured on both its trigger and send nodes. Do not reuse another project's bot token, publish with a dummy credential, or restart the shared n8n service just to import an inactive workflow.

Manual smoke tests must stop before Telegram delivery and use clearly labeled synthetic update fixtures, not a real user's location. They exercise the real local core, not a simulated timing response. Running a one-off n8n CLI execution beside the existing server requires a separate task-runner broker port; do not steal the running instance's broker socket.

## Verified installation

- Product name: **بِسراه** / **Besrah**; Telegram handle `@Besrahbot`, bot ID `9195157620`.
- Core: `besrah-core.service`, enabled, `127.0.0.1:3080`, compiled runtime under `/srv/besrah`.
- Production workflow: `BesrahMetro01`, published with dedicated credential `BesrahTelegram01` on both Telegram nodes.
- Smoke workflow: `BesrahMetroSmoke01`, inactive/manual-only, nine synthetic cases, two real core queries, no Telegram sends.
- Acceptance: 27 core tests, 15 workflow unit tests, actual n8n smoke assertions, and five real Telegram round trips (start, station, station list, station-coordinate test fixture, unsupported line 2). The request-location keyboard was read back from Telegram.
- Source exports stay inactive and credential-free even when the installed runtime is published. Re-importing them is a deployment action and must be followed by explicitly binding the dedicated credential and publishing.

The bot token is stored outside Git in `/etc/besrah/telegram.env` (directory 0700, file 0600) and as an encrypted n8n credential. It was provided through a group conversation; rotate it in BotFather and update both protected locations. Never include a replacement token in source, workflow exports, a shell command line, or group chat.

## Activation boundary

A healthy core and passing local/n8n tests do not prove Telegram delivery. Activation additionally requires:

1. A dedicated Besrah Telegram bot and its real token, entered directly into n8n credentials rather than committed or pasted into a group chat.
2. Read-only verification of the bot identity and existing webhook before changing it.
3. The same credential selected on the Besrah Telegram Trigger and Send nodes.
4. Publishing the production workflow, followed by a real private-chat test for `/start`, a station name, and a shared location.
5. Readback of webhook status and the actual delivered Telegram messages.

Keep Telegram group ingestion disabled for the initial release. Do not activate or overwrite a webhook belonging to an unrelated bot.
