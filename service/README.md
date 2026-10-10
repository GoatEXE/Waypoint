# Waypoint pod service

Small Node 22 backend/control service for Waypoint pods, pod seats, task runs, and the containerized Hermes CEO runtime.

## Run locally

```bash
cd service
npm install
npm run check
npm start
```

From the repository root, `npm start` runs this service together with the app.

Defaults are safe: `DRY_RUN=true` makes pod lifecycle, seat setup, and task runs return plans without touching containers. Pod start plans use a pinned Hermes image, one idle container per pod, Docker `bridge` networking, and a Waypoint-owned named Docker volume at `/opt/data`; they publish no ports and never bind-mount a host pod directory, `docker.sock`, or a Waypoint bridge token. `npm start` uses Node 22's `--env-file-if-exists=.env`; never put provider tokens in committed files. Provider secrets entered through the UI stay in private Docker volumes, not browser storage.

## Hermes CEO

The service can start a labeled CEO container named `waypoint-hermes-ceo` using the pinned image digest in `.env.example`. Durable Hermes state is in Docker volume `waypoint-hermes-ceo-home`. Settings model dropdowns are populated through a local-only `/hermes/model-catalog` endpoint that asks the pinned runtime for Hermes' native provider catalog, with verified curated fallback choices when account discovery is unavailable. The CEO home is seeded with:

- CEO identity guidance: delegate/provision/monitor; pods execute.
- A Waypoint bridge skill with payload examples.
- `/opt/data/waypoint/bridge.json`, containing the token-protected local bridge URL for this service.

The internal bridge endpoint is `POST /bridge/tools` and requires `Authorization: Bearer <runtime token>` (constant-time compare). The generated token is persisted under ignored `service/runtime/.../bridge-token` so service restarts do not strand the running CEO with a stale bridge token.

Security boundary: the full control API (missions, Skills, Settings/provider auth, pod lifecycle, seats, task runs) listens only on a host-only channel — a Windows named pipe (`\\.\pipe\waypoint-control-<hash>`) or, on macOS/Linux, `service/runtime/control/control.sock` inside a `0700` directory. Docker Desktop containers can reach host loopback TCP but not that pipe/socket. The TCP port (`HOST`:`PORT`, default `127.0.0.1:3080`) serves only `POST /bridge/tools` with a constant-time bearer-token check; every other path returns `404` regardless of `Host`/`Origin`. The browser app reaches the control API through its session-gated `/api` proxy; see `../docs/api.md`.

CEO skill availability controls are exposed through host-control endpoints:

- `GET /hermes/skills` returns all installed builtin/local/hub skills with `enabled` and `locked` flags plus counts.
- `GET /hermes/skills/:name` returns bounded redacted metadata and safe relative file names/sizes.
- `PUT /hermes/skills/:name` with `{ "enabled": boolean }` updates Hermes' native CEO disabled-skill list through Hermes config helpers, refuses locked disables for `waypoint-ceo-bridge` and `hermes-agent`, and returns the re-read actual state.

CEO chat is exposed through host-control endpoints:

- `GET /hermes/ceo/conversation` -> `{ sessionId: string|null, messages: [{ role: 'user'|'ceo', text, at, status? }] }`
- `POST /hermes/ceo/messages` with `{ "message": "..." }` -> `{ sessionId, reply, messages }`

`status` is optional for compatibility. New successful turns write user messages as `sent` and confirmed CEO replies as `confirmed`. If Hermes exits or times out after a turn starts, the service persists an `outcome_unknown` marker instead of making the turn look successful; clients should refresh and let the user decide whether to follow up, not automatically retry.

A turn requires the CEO container to already be running, a configured model, and fresh native Hermes auth for that model provider. The service prepares the CEO home with Hermes' native `approvals.single_query_mode: approve` setting so host-initiated one-shot CEO turns can use the Waypoint bridge skill unattended. This is the narrowest verified Hermes v0.21.5 unattended approval switch for single-query runs, but it is still broad for that surface: any recoverable approval gate in single-query mode can auto-approve, while Hermes hardline blocks, user deny rules, and normal auth/model readiness still apply. The service allows one active turn at a time, invokes Hermes with argv arrays plus stdin (`--query-file - --format stream-json`) inside an in-container `timeout` wrapper, stores the single durable CEO session under ignored `service/runtime/...`, and caps message/output sizes. Request logs intentionally omit message text, raw Hermes stderr, tool arguments/results, token material, and provider credentials.

## Pods, seats, and task runs

All of these are host-control routes; contracts are in `../docs/api.md`.

- **Pod lifecycle**: `POST /pod-instances/:podId/lifecycle` starts, stops, or checks one idle pinned-Hermes container per pod, with a Waypoint-owned named volume at `/opt/data`.
- **Seat setup**:
  - `GET /pod-instances/:podId/seats/status` reports per-seat profile, model, native auth readiness, and blockers.
  - `PUT /pod-instances/:podId/seats/:seatId/model` stores a non-secret seat model.
  - `POST /pod-instances/:podId/seats/provision` applies the Hermes profile layout and model inside an already running pod. Every command runs as `--user hermes`, and none of these routes starts a pod.
- **Seat provider connection**: native OAuth and API-key routes remain available under `/pod-instances/:podId/seats/:seatId/providers/...`. In shared-auth mode, OAuth writes to the shared store; API keys in a seat's `.env` remain seat-specific overrides.
- **Shared provider auth (optional)**: with `WAYPOINT_SHARED_AUTH=true`, the CEO and every pod mount one labeled Hermes auth volume. A small overlay on the pinned Hermes image points native auth reads, atomic writes, and refresh locks at that volume. New pods inherit the CEO's OAuth connection without another device login. A pod process can read or change that shared credential store; use this mode only when pods are in the same credential trust domain. Pod workspaces and profiles remain in their own volumes.
- **CEO pod creation**: the CEO bridge can create a template, clone it, and start the pod on this Docker host. `pod_start` captures the CEO's current model as the pod default when none was chosen, prepares all seats, and returns readiness. Explicit seat and template models take priority; shared provider auth supplies the connection.
- **Task runs**: `POST /tasks/:taskId/run` (and the CEO bridge `run_task` tool) runs one bounded Hermes turn on the task's seat. Run records and sanitized evidence are stored host-side and read with `GET /tasks/:taskId`.
- **Organization and messages**: the CEO and every stored pod seat have stable addresses. Both can search the org chart and exchange durable messages through scoped tools on `POST /bridge/tools`. Provisioning installs each seat's messaging client and credential in its own profile. A new message starts one bounded recipient turn when ready; stopped seats keep queued mail. Replies are capped to prevent automatic loops. See `../docs/api.md`.
  - Mailbox turns keep their Docker exec input open while Hermes runs. If the host client disconnects, an in-container wrapper stops the model process group. An interrupted delivery remains uncertain and is never replayed automatically.
  - Runs start only by explicit action, and only one run per seat at a time.
  - A `failed` or `outcome_unknown` run requires manual review. There is no automatic retry.

A live Codex-authenticated builder seat run completed on 2026-10-06 using the shared volume. Its one-file output was checked in the pod workspace; see `../docs/status-and-limitations.md`.

## API

See `../docs/api.md`.

## Docker/Compose

### Shared provider login

Build the small Hermes overlay from the pinned upstream image, then set both `HERMES_DOCKER_IMAGE` and `POD_DOCKER_IMAGE` in the ignored `service/.env` to the immutable image ID returned by `docker image inspect`:

```powershell
docker build -t waypoint-hermes-shared-auth:local service/docker/auth-image
docker image inspect waypoint-hermes-shared-auth:local --format '{{.Id}}'
```

Set `WAYPOINT_SHARED_AUTH=true` and `WAYPOINT_AUTH_VOLUME=waypoint-hermes-shared-auth`. The overlay changes Hermes's auth-store path and adds the GitHub CLI (pinned release, checksum-verified) with a Waypoint token shim and git credential helper, so agents use `gh` and `git` normally. All other Hermes code comes from the pinned upstream image. After updating the overlay, rebuild it and recreate the CEO and pods. For an existing CEO login, run `npm run migrate-shared-auth` once while no model turn or login is active. It transfers the CEO's native `auth.json` through Docker stdin/stdout without writing it to the host or printing it. Then recreate the CEO and any old pod containers with the overlay image while retaining their named data volumes. New pods mount the shared auth volume automatically. Authenticated pods and the CEO use the same file lock for rotating OAuth grants.

This gives every pod process access to the shared provider credentials. Pod agents should therefore be trusted with the CEO's provider account. The shared volume is never mounted from a host path and is never exposed through the Waypoint bridge or app API.

Compose builds only this API service, binds the bridge port to `127.0.0.1`, and leaves Hermes containers untouched. In Compose the control socket lives inside the service container, so the host UI cannot use it; run `npm start` on the host for the app:

```bash
cd service
docker compose config
```

Do not set `DRY_RUN=false` unless you intend to run live pod lifecycle, seat setup, and task runs. Live pod start refuses unpinned images, unowned or bind-backed volumes, unsafe mounts, privileged containers, published ports, added capabilities, and non-bridge networks. It copies the derived host `profiles/<seatId>` baseline into a pod's named `/opt/data` volume without a bind mount. Shared-auth mode requires the Waypoint image overlay and verifies the second labeled auth volume. After copying, it `chown -R hermes:hermes /opt/data/profiles` only, then writes a seed marker.
