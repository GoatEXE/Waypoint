# Waypoint service

Small Node 22 backend/control service for Waypoint. It runs the Hermes CEO on native Hermes installed on this computer.

## Run locally

Install [Hermes](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart) so `hermes` is on PATH (or set `HERMES_BIN`), then:

```bash
cd service
npm install
npm run check
npm start
```

From the repository root, `npm start` runs this service together with the app. `npm run reset -- --yes` stops Waypoint's Hermes gateway and deletes the data folder and Waypoint's Hermes home.

Defaults are safe: `DRY_RUN=true` makes hiring seats and opening dashboards refuse. `npm start` uses Node 22's `--env-file-if-exists=.env`; never put provider tokens in committed files.

## Hermes CEO

Waypoint keeps its own Hermes home (`WAYPOINT_HERMES_HOME`, default `DATA_DIR/hermes-home`), separate from any Hermes you use yourself. Every Hermes command and helper script gets that home as `HERMES_HOME` explicitly. Helper scripts run in the interpreter and bootstrap printed by `hermes --print-runtime-command`. The service starts that home's `hermes gateway run` when it starts, and the gateway's dispatcher runs assigned board tasks. The CEO home is seeded with:

- CEO identity guidance: delegate, provision, monitor; seats execute.
- A Waypoint bridge skill with payload examples.
- `waypoint/bridge.json`, containing the token-protected local bridge URL for this service.

The internal bridge endpoint is `POST /bridge/tools` and requires `Authorization: Bearer <runtime token>` (constant-time compare). The generated token is persisted under ignored `service/runtime/.../bridge-token` so service restarts do not strand the running CEO with a stale bridge token.

Security boundary: the full control API listens only on a host-only channel — a Windows named pipe (`\\.\pipe\waypoint-control-<hash>`) or, on macOS/Linux, `service/runtime/control/control.sock` inside a `0700` directory. The TCP port (`HOST`:`PORT`, default `127.0.0.1:3080`) serves only `POST /bridge/tools` with a constant-time bearer-token check; every other path returns `404` regardless of `Host`/`Origin`. The browser app reaches the control API through its session-gated `/api` proxy; see `../docs/api.md`.

The CEO and its seats run as your user account, without a sandbox. GitHub access stays scoped: `gh` resolves to a Waypoint wrapper first on PATH, and git's github.com credential helper is reset to the Waypoint helper (`src/waypoint_github.py`), so both use short-lived Waypoint GitHub App tokens. Git uses Waypoint's own global gitconfig in the Hermes home.

CEO skill availability controls are exposed through host-control endpoints:

- `GET /hermes/skills` returns all installed builtin/local/hub skills with `enabled` and `locked` flags plus counts.
- `GET /hermes/skills/:name` returns bounded redacted metadata and safe relative file names/sizes.
- `PUT /hermes/skills/:name` with `{ "enabled": boolean }` updates Hermes' native CEO disabled-skill list through Hermes config helpers, refuses locked disables for `waypoint-ceo-bridge` and `hermes-agent`, and returns the re-read actual state.

CEO chat is exposed through host-control endpoints:

- `GET /hermes/ceo/conversation` -> `{ sessionId: string|null, messages: [{ role: 'user'|'ceo', text, at, status? }] }`
- `POST /hermes/ceo/messages` with `{ "message": "..." }` -> `{ sessionId, reply, messages }`

New successful turns write user messages as `sent` and confirmed CEO replies as `confirmed`. If Hermes exits or times out after a turn starts, the service persists an `outcome_unknown` marker instead of making the turn look successful; clients should refresh and let the user decide whether to follow up, not automatically retry.

A turn requires the CEO's gateway to be running, a configured model, and fresh native Hermes auth for that model provider. The service sets Hermes' native `approvals.single_query_mode: approve` so host-initiated one-shot CEO turns can use the Waypoint bridge skill unattended. Any recoverable approval gate in single-query mode can auto-approve, while Hermes hardline blocks, user deny rules, and normal auth/model readiness still apply. The service allows one active turn at a time, invokes Hermes with argv arrays plus stdin (`--query-file - --format stream-json`), kills the whole process tree when a turn exceeds its timeout, and caps message/output sizes. Request logs omit message text, raw Hermes stderr, tool arguments/results, token material, and provider credentials.

## API

See `../docs/api.md`.
