# Waypoint pod foundation decisions

Status: accepted by user direction and partially runtime-verified in this backend/UI slice.

## Operating model

- Waypoint has one Hermes CEO / chief-of-staff role that delegates, provisions, and monitors work.
- Actual task execution belongs to pods, not the CEO.
- The CEO runs in its own labeled Docker container with an independent durable Hermes home volume. The CEO may provision many pods, but it is scoped to delegation/provisioning/monitoring. The CEO does not execute tasks itself. It may start an explicit, bounded pod task run through the bridge (`run_task`). Automatic scheduling/dispatch and automatic retry remain out of scope.
- Each pod maps to exactly one Docker container.
- Each pod container may host one or more separate Hermes seat profiles/processes.
- Containers are not nested. Seats are already isolated profiles inside their pod container, and the host service reaches any seat with `docker exec ... hermes -p <seat>`, including for direct user chat. Docker-in-Docker would need a privileged container or a mounted Docker socket, which breaks the owned-container, no-host-mount boundary. If a seat ever needs its own container, it becomes a sibling container managed by the host service.
- Seat definitions are jobs/personalities, not secret bundles.

## CEO runtime and bridge

- The accepted CEO runtime is containerized: `waypoint-hermes-ceo` using the pinned official image digest recorded in `.env.example` and `docs/hermes-findings.md`.
- The CEO home is seeded with delegation identity only when missing, so user/learned CEO identity is not overwritten on ordinary settings or auth actions.
- The CEO receives a Waypoint bridge skill with payload schemas/examples for template creation, pod cloning, pod lifecycle/status, and task delegation.
- The bridge uses a persisted runtime bearer token under ignored `service/runtime/.../bridge-token`; a service restart must not strand the running CEO with a stale bridge token.
- Docker Desktop forwards container traffic to host loopback, so loopback/Host/Origin checks are not a boundary. Control endpoints are served only on a host-only named pipe / Unix socket; the TCP listener serves only token-authenticated `POST /bridge/tools`. The browser reaches control through the session-cookie-gated Vite `/api` proxy (cookie minted by host-only `npm run open`).

## Baselines, seats, and learning

- A versioned pod baseline can include reviewed, approved learned state.
- New pod seats are independent writable profiles materialized from that baseline.
- Later review can compare writable seat state against the baseline and promote approved improvements.
- Baseline replication must be credential-free. Native Hermes profile clone modes are not used blindly because official profile docs note clone modes copy `.env` material.
- The allowed baseline material is limited to reviewed `SOUL.md`, `memories/MEMORY.md`, `memories/USER.md`, and skills text. Each seat receives its own writable profile copy under the pod instance. Any configuration must be deliberately constructed/sanitized rather than copied from a live profile directory. The allowlist does not scan text content for secrets; reviewed baselines must be kept secret-free.

## Secrets and provider auth

- Use native Hermes Bitwarden Secrets Manager integration for project secrets; do not implement a custom secret broker.
- Use native Hermes provider auth for account login. OpenAI Codex is exposed through native device-code OAuth. Anthropic OAuth is exposed through the native URL/code flow and requires Claude Max plus purchased extra/overage credits per Hermes docs; Claude Pro is not supported for that path.
- API-key fallback is explicit and distinct from subscription/OAuth login. Keys are stored through Hermes credential lifecycle helpers and never returned to the browser.
- Secrets, tokens, and credentials are never cloned from baselines and never committed.
- When enabled, a separately labeled shared Docker auth volume gives the CEO and pods one native Hermes auth store and refresh lock. This avoids reauthorizing each new pod and prevents copied single-use OAuth refresh tokens from diverging. It deliberately puts all pods in the same provider-credential trust domain; pod profiles and workspaces remain separate.

## Product and UI scope

- The existing sample views are preserved. A scoped real Settings / Models view is added for local CEO runtime, provider auth, and model settings.
- Eventual desktop packaging target is Electron.
- This slice intentionally avoids approval-board workflows, custom secret handling, large orchestration logic, and scheduler/model mission execution.

## Runtime scope

- Default pod mode is safe planning/dry-run.
- Dry-run responses must never claim a pod task executed.
- Real model calls are not performed until the user completes provider login in the UI.
- Docker lifecycle integration is constrained to owned containers by generated names and labels.
