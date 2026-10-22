# Status and limitations

## Current status

Endpoint contracts are in [`api.md`](api.md). This page summarizes what works and its limits.

Implemented:

- **Host control service.** Node 22 service with health/config routes, structured errors, JSON-line logs, and graceful shutdown. Mutations require `application/json` and reject foreign `Origin` headers.
- **Native Hermes organization.** One Hermes CEO, running on the Hermes installed on this computer (`hermes` on PATH, or `HERMES_BIN`), with Waypoint's own `HERMES_HOME` (`WAYPOINT_HERMES_HOME`, default `<DATA_DIR>/hermes-home`). The service starts and stops that home's `hermes gateway run`. Seats are Hermes profiles in the CEO's own install. The user or the CEO hires them (`hermes profile create`, optionally cloned from another seat).
- **Task board.** Tasks are Hermes kanban tasks. The dispatcher inside the CEO's `hermes gateway` starts assigned tasks on their seats. Waypoint shows the board as a list or columns, with SUN-style refs. The task page is a thread: description, comments, board events, and the latest summary. Comments reach the seat; on a task in review they request changes. The inbox lists tasks in review or blocked.
- **CEO conversation.** A General thread plus one CEO thread per board task, each its own Hermes session, with live tool activity.
- **Durable records.** Missions, projects, the organization profile, and task refs are files under the service data folder (`service/runtime/pod/` by default). Tasks, comments, and seats live in the CEO's Hermes home.
- **Projects** are GitHub repositories, linked to a mission.
- **GitHub.** A private Waypoint GitHub App. The CEO and seats use `gh` and `git` normally through a shim that fetches a short-lived, single-repository token for any project's repository.
- **Settings / Models.** Native Codex device-code login, Anthropic OAuth/code login, API-key fallback, model persistence, and provider model dropdowns backed by Hermes' native catalog with curated fallbacks.
- **Skills page.** Lists the CEO's installed Hermes skills with enable/disable through Hermes' native disabled-skill list. `waypoint-ceo-bridge` and `hermes-agent` are locked on.
- **Tests.** `npm run check` runs lint, service and app tests with mocked Hermes, and the app build. They make no model calls. The runtime was also exercised against Hermes v0.22.2 on Windows: gateway start/stop, status, skills, board, seat hire, and GitHub credential routing.

## Current limits

- **Dry-run by default.** `DRY_RUN=true` is the default (see `service/.env.example`). Hiring seats and opening dashboards then refuse; live use requires `DRY_RUN=false`.
- **One trust domain.** Seats are profiles in the CEO's install. They share its provider credentials and GitHub access, so any seat can reach anything the CEO can. That install runs as your user account with no sandbox, so seats can read and change your files.
- **GitHub access is scoped, not isolated.** `gh` resolves to a Waypoint wrapper first on PATH, and git's github.com credential helper is reset to the Waypoint helper, so both use short-lived Waypoint GitHub App tokens. Git uses Waypoint's own global gitconfig (`<hermes-home>/home/.gitconfig`). A seat can still reach your other credentials on disk, because it runs as you.
- **Pods are new.** A pod is a separate board with cloned seats that know their podmates and talk through tasks and comments. Closing a pod archives its board and opens a learning review: each new memory entry or new or changed skill in a clone can be added to the original seat or dropped. A temporary pod's clones are deleted once every item is decided. The review covers skills and memories, not session history.
- **Hermes dashboards are unauthenticated while open.** "Hermes UI" opens the CEO's or a seat's native Hermes dashboard on one host loopback port (`HERMES_PORTAL_PORT`, default 3081). The dashboard's loopback mode needs no login: any local process on this computer can use it, including its config and keys pages, while it is open. Hermes rejects foreign `Host` headers, so other websites cannot reach it through DNS rebinding. It opens only on request, one agent at a time, and closes after `HERMES_PORTAL_IDLE_MINUTES` (default 30) without connections.
- **Skills page is CEO-only.** There is no per-seat skill view, no install action, and no usage stats.
- **Prototype views remain.** Routines and artifacts views still show prototype sample data.
- **Missions.** Only the newest mission is shown in full. Deleting a mission leaves its task on the board. Editing remains unavailable.

## Deliberately not implemented

- Importing host credential caches. The CEO's store begins with Hermes-native auth and is not a copy of the host Codex CLI cache.
- Broad native dashboard reverse proxy. The scoped Waypoint UI is the integration surface.
- Custom Bitwarden brokerage. Future secret access should use native Hermes Bitwarden integration.
- Local-folder projects.

## Runtime notes

- The control API is served only on a host-only named pipe (Windows) or `0700`-directory Unix socket (macOS/Linux). The TCP port serves only token-authenticated `POST /bridge/tools`; all other paths return `404`. The app's Vite `/api` proxy requires an HttpOnly `SameSite=Strict` session cookie minted by the host-only `npm run open` launcher, or by host approval (`npm run approve -- <fingerprint>`) of a browser paired at `/__waypoint/pair`. A local process can flood pending pairings (cap 10, 5-minute expiry) and so delay pairing, but it cannot get one approved; `npm run open` still works if that happens.
- Limits: any process running as the host user can use the pipe/socket or mint a browser session (same trust as the user's files). Vite still serves the app's static source to anything that can reach `127.0.0.1:5173` (no secrets are in client code).
- Every Hermes command and helper script gets `HERMES_HOME` explicitly (Hermes issue #18594). Helper scripts run in the interpreter and bootstrap printed by `hermes --print-runtime-command`, or `HERMES_PYTHON` if set. The first start in a new home takes about a minute while Hermes installs that home's dependencies.
- Auth readiness is derived from native `hermes auth status`, not browser-local toggles or raw `auth.json` substring checks.
- API-key save responses expose only configured/presence flags; keys are not returned.

## Untested / user-action limits

- Anthropic OAuth availability depends on Claude Max plus purchased extra/overage credits per Hermes docs; Claude Pro is not supported for that path. Anthropic API key fallback uses standard API billing.
- Codex OAuth is exposed through device-code login. Browser PKCE on localhost:1455 is not exposed until a safe localhost bridge/tunnel is added.
