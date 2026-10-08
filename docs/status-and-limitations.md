# Status and limitations

## Current status

Endpoint contracts are in [`api.md`](api.md). This page summarizes what works and its limits.

Implemented:

- **Host control service.** Node 22 service with health/config routes, structured errors, JSON-line logs, and graceful shutdown. Mutations require `application/json` and reject foreign `Origin` headers.
- **Durable records.** Pod templates, pod instances, missions, tasks, and task run history are stored as files under the host service data folder (`service/runtime/pod/` by default). None of it is stored in pod containers.
- **Missions UI.** The mission home page and sidebar read missions from the service. The New Mission dialog saves a real mission. Sidebar pod and seat entries open the real pod page.
- **Credential-free templates.** Pod templates copy only an allowlist of reviewed baseline files into one writable profile folder per seat. This is an allowlist, not a secret scanner: reviewed baseline text must not contain secrets.
- **Pod lifecycle** (`POST /pod-instances/:podId/lifecycle`). Start, stop, and status for one idle container per pod, using the pinned Hermes image on Docker `bridge` networking with no published ports. Each pod gets a Waypoint-owned named volume at `/opt/data`; there is no host bind mount, `docker.sock`, or CEO bridge token in the pod. Existing containers and volumes are reused only when they are Waypoint-owned and match the expected safe shape; anything else is refused, not removed. Seat baselines are copied into the volume and handed to the `hermes` user.
- **Per-seat setup** (Pod page → seat setup):
  - Choose a seat model. It comes only from stored records: a seat override, the instance model, or the template model.
  - Prepare seats. This applies the standard Hermes profile layout and model inside the running pod, is safe to repeat, and never runs `hermes profile create`.
  - Check seat status. This reports per-seat profile, model, native auth readiness, and blockers.
- **Per-seat provider connection.** Service routes start native Hermes OAuth (Anthropic code flow, Codex device code) or save an API key in one seat profile inside its pod. Shared-auth mode uses the CEO's provider credential store; standalone mode uses the pod's store. Neither mode imports host credential caches.
- **Task runs.** A task page shows the task, its seat, run history, and evidence, and has a manual Run action. The CEO can also start a run through the bridge `run_task` tool. A run is one bounded Hermes turn on the task's own seat, in a per-task workspace inside the pod. Task runs require an explicit user or CEO action; incoming messages can start separate short mailbox turns. Refusals before a model turn, such as pod stopped or seat not ready, release the task back to `delegated`.
- **CEO runtime.** A containerized Hermes CEO uses a small local shared-auth overlay built from the pinned official image `nousresearch/hermes-agent@sha256:d4da4a40cd7a28aba983775d9fd31d94cbf153eeb0cb9e844d6d0f612b7c24db`. Its home holds delegation identity and a token-protected Waypoint bridge skill. The CEO can create and start pods on demand; `pod_start` defaults an unconfigured pod to the CEO's current model, provisions its seats, and reports readiness. Pods execute tasks.
- **CEO Settings / Models UI.** Native Codex device-code login, Anthropic OAuth/code login, API-key fallback, model persistence, and provider model dropdowns backed by Hermes' native catalog with curated fallbacks.
- **Skills page.** Lists the CEO's installed Hermes skills (Waypoint, local, Skills Hub, built-in) with enable/disable through Hermes' native disabled-skill list. `waypoint-ceo-bridge` and `hermes-agent` are locked on.
- **CEO bridge.** Token-protected bridge tools: health, missions, templates, clone, pod lifecycle/status, tasks, `run_task`, and `task_status`.
- **Organization and messages.** CEO and stored pod seats have discoverable addresses. The CEO and provisioned seats can search by pod, seat, or role, send durable messages to any address, read their own inbox, and acknowledge processed messages. Seat credentials are scoped to messaging and cannot call CEO control tools.
- **Tests.** Service tests (`npm run check`) cover these paths with mocked Docker and Hermes. They make no model calls.

## Current limits

- **Dry-run by default.** `DRY_RUN=true` is the default (see `service/.env.example`). Pod lifecycle, seat setup, and task runs then return plans only and touch no containers. Live pods, seat setup, and runs require deliberately setting `DRY_RUN=false`.
- **Live pod setup check (2026-10-06).** A disposable pod was started live with the pinned image and its own named volume. Its seat profile and model were provisioned as the `hermes` user. Seat auth was correctly reported as missing. No provider sign-in or model turn was attempted, and the test container and volume were removed afterwards.
- **Live shared-auth task run (2026-10-06).** The CEO and the existing pod were rebuilt with the Waypoint Hermes image overlay and one shared auth volume. The builder seat reported native Codex auth ready without a pod login, completed a bounded model turn, and wrote exactly the requested `result.txt`. The CEO and builder both still reported logged in afterward. The original Finish Waypoint task remained delegated and unrun.
- **Shared auth requires trust between pods.** When `WAYPOINT_SHARED_AUTH=true`, the CEO and pods have read/write access to one Hermes auth store. Its file lock and OAuth refresh state are shared, avoiding duplicate refresh-token chains, but a process inside any pod can read or alter the CEO's provider credentials. Treat pods as part of the same credential trust domain.
- **Separate workspaces.** Each pod still has its own named `/opt/data` volume for seat profiles and task workspaces. The shared auth volume is the only added mount; pods have no CEO home mount, host bind mount, Docker socket, or published port.
- **Message wakes are bounded.** New messages start a short recipient turn when the CEO or pod seat is ready. The in-container mailbox wrapper stops its model process group if the host Docker exec client disconnects. Delivery state is durable; an interrupted or uncertain turn is never replayed automatically. Later queued turns for that recipient wait for explicit review of the uncertain delivery. A stopped pod keeps messages queued until it is ready. One automatic reply can wake its recipient, while later replies stay in the inbox to prevent a loop. Each recipient has a daily automatic-turn cap. Seats in the same pod run as one Unix user and can read each other's local messaging credentials; separate pods cannot.
- **Provider setup.** With shared auth enabled, connect OAuth providers once in CEO Settings. Per-seat API keys remain available as overrides. The old standalone pod OAuth UI has not been verified against a real provider account.
- **Review before retry.** A `failed` or `outcome_unknown` run locks the task until an operator explicitly reviews it and starts another run from the task page. There is no automatic retry. A run cut off by a service restart is recorded as `outcome_unknown`.
- **Not task scheduling.** Each task run is a single bounded turn started by hand: there is no queue or dispatcher, and only one run per seat at a time.
- **Hermes dashboards are unauthenticated while open.** "Hermes UI" on the organization chart or a pod page opens that agent's native Hermes dashboard on one host loopback port (`HERMES_PORTAL_PORT`, default 3081). The dashboard's loopback mode needs no login: any local process on this computer can use it, including its config and keys pages, while it is open. Hermes rejects foreign `Host` headers, so other websites cannot reach it through DNS rebinding. It opens only on request, one agent at a time, and closes after `HERMES_PORTAL_IDLE_MINUTES` (default 30) without connections.
- **Skills page is CEO-only.** There is no per-seat or per-pod skill view, no install action, and no usage stats.
- **Prototype views remain.** Project, run, review, routines, and artifacts views still show prototype sample data. The message delivery inbox reads service records.
- **Missions.** Only the newest mission is shown in full. Missions can be deleted without deleting linked pods or tasks; stored pods and tasks remain in the sidebar. Editing remains unavailable. The New Mission dialog does not attach pods or tasks; the CEO does that through the bridge.

## Deliberately not implemented

- Importing host credential caches. The shared store begins with Hermes-native CEO auth and is not a copy of the host Codex CLI cache.
- Broad native dashboard reverse proxy. The scoped Waypoint UI is the integration surface.
- Custom Bitwarden brokerage. Future secret access should use native Hermes Bitwarden integration.
- Promotion workflow for learned-state diffs beyond the existing UI prototype.

## Runtime notes

- The control API is served only on a host-only named pipe (Windows) or `0700`-directory Unix socket (macOS/Linux). The container-reachable TCP port serves only token-authenticated `POST /bridge/tools`; all other paths return `404`. The app's Vite `/api` proxy requires an HttpOnly `SameSite=Strict` session cookie minted by the host-only `npm run open` launcher, or by host approval (`npm run approve -- <fingerprint>`) of a browser paired at `/__waypoint/pair`. A container can flood pending pairings (cap 10, 5-minute expiry) and so delay pairing, but it cannot get one approved; `npm run open` still works if that happens.
- Limits: any process running as the host user can use the pipe/socket or mint a browser session (same trust as the user's files). `docker compose` runs the service in a container, so its control socket is only reachable inside that container; use host `npm start` for the UI. Vite still serves the app's static source to anything that can reach `127.0.0.1:5173` (no secrets are in client code).
- The CEO container is named `waypoint-hermes-ceo`, labeled `com.waypoint.hermes.*`, and uses Docker volume `waypoint-hermes-ceo-home`. Shared-auth mode adds the labeled `waypoint-hermes-shared-auth` volume to the CEO and every pod.
- Auth readiness, for the CEO and for each pod seat, is derived from native `hermes auth status`, not browser-local toggles or raw `auth.json` substring checks.
- API-key save responses expose only configured/presence flags; keys are not returned.

## Untested / user-action limits

- Anthropic and Codex reported ready in CEO Settings at the time of the live shared-auth check. Check current readiness in Settings. The separate pod OAuth login UI still needs a real-account check in standalone mode.
- Anthropic OAuth availability depends on Claude Max plus purchased extra/overage credits per Hermes docs; Claude Pro is not supported for that path. Anthropic API key fallback uses standard API billing.
- Codex OAuth is exposed through device-code login. Browser PKCE on localhost:1455 is not exposed until a safe localhost bridge/tunnel is added.
