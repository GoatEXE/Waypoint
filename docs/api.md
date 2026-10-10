# Backend API

Responses are JSON. Mutation requests must use `Content-Type: application/json`; requests with a foreign `Origin` header are rejected (defense in depth, not the boundary).

Security boundary: the full control API (missions, Skills, Settings/provider auth, lifecycle) listens only on a host-only channel — a Windows named pipe (`\\.\pipe\waypoint-control-<hash>`) or, on macOS/Linux, `service/runtime/control/control.sock` inside a `0700` directory. Docker Desktop containers can reach host loopback TCP but not that pipe/socket. The TCP port (`HOST`:`PORT`, default `127.0.0.1:3080`) serves only `POST /bridge/tools` with a constant-time bearer-token check; every other path returns `404` regardless of `Host`/`Origin`.

The browser reaches the control API through the app's Vite server at `/api/*`, which forwards to the pipe/socket only for requests carrying a valid `waypoint_session` cookie (`HttpOnly; SameSite=Strict`). A host process mints that cookie: `cd app && npm run open` writes a one-time, 2-minute sign-in code into `service/runtime/control/` and opens `/__waypoint/session?code=...`, which sets the cookie and redirects to `/`. For a browser the launcher can't open (for example an embedded/managed tab), pair it instead: open `http://127.0.0.1:5173/__waypoint/pair` in that browser. It gets an HttpOnly pairing cookie and the page shows only a non-secret fingerprint such as `ABCD-1234`. Then, on the host, run `cd app && npm run approve -- ABCD-1234`; the page signs in and redirects to `/` within a few seconds. Pairings expire after 5 minutes and work once; at most 10 can be pending. A container can create pairings, but only a host process can approve one, and approval is bound to the fingerprint the user sees. Only SHA-256 hashes of codes/sessions are stored; sessions last 30 days. `/api` without a valid session returns `403 session_required`. Override paths with `WAYPOINT_CONTROL_DIR` / `WAYPOINT_CONTROL_SOCKET` (both the service and the app read them).

Host-side manual calls: `curl --unix-socket service/runtime/control/control.sock http://waypoint/healthz` on macOS/Linux; on Windows use Node `http.request({ socketPath, path })` with the pipe name from `resolveControlChannel()` in `service/src/controlChannel.js`.

## `POST /bridge/tools` (bridge TCP port only)

The only route on the TCP listener, for the CEO. Body: `{ "tool": "...", "args": { ... } }`, with `Content-Type: application/json` and the CEO bearer token. Missing or wrong credentials return `403`. This route is not served on the control pipe.

- `health {}`
- `github_token { repo? }`: see GitHub below.
- `list_missions {}`, `create_mission { title, outcome?, target?, taskId? }`, `link_mission { missionId, taskId }`, `update_mission { missionId, status }`. Missions created here are recorded with `source: "ceo"`.
- `list_projects {}`, `create_project { name, missionId?, repo? }`.
- `list_tasks {}`: the board as `{ id, ref, title, status, assignee }`, so the CEO can map the refs the user sees to board ids.

Seats, tasks, and coordination are native Hermes: the CEO hires seats with `hermes profile create` and delegates with `hermes kanban create --assignee <seat>`.

## Task board

Tasks are Hermes kanban tasks on the CEO's board, run by the dispatcher inside the CEO's `hermes gateway`. Waypoint reads and writes the board with `hermes kanban ... --json` and gives each task a ref from the organization key (`SUN-12`); refs are stored in `kanban-refs.json` in the data directory. Every task route accepts a ref or a board id (`t_<hex>`).

Statuses are the board's: `triage`, `todo`, `ready`, `running`, `blocked`, `review`, `done`, `archived`.

- `GET /tasks` returns `{ tasks: [{ id, number, ref, title, body, status, assignee, createdBy, createdAt, startedAt, completedAt, lastError }] }`, newest first.
- `POST /tasks` takes `{ title, body?, assignee?, parents? }` and returns the created task. `assignee` is a seat id; `parents` are tasks this one waits on.
- `GET /tasks/:ref` adds `latestSummary`, `parents`, `children` (`{ id, ref, title, status, assignee }`), `comments` (`{ author, body, at }`), and `events` (`{ kind, at, runId, detail }`).
- `POST /tasks/:ref/comments` takes `{ text }`. On a task in `review` it requests changes, which sends the task back to its seat. On a blocked task it adds the comment and unblocks it. Otherwise it adds a comment the seat sees on its next pass.
- `POST /tasks/:ref/actions` takes `{ action }`: `complete` (optional `summary`), `archive` (also archives follow-ups still waiting on the task, so archiving never starts them), `block` (optional `reason`), `unblock`, or `assign` (`assignee`, or `null` to unassign).

Review is the user's approval gate. Waypoint sets the CEO's `kanban.review_dispatch` to `false`, so no agent picks up a task in `review`. Every seat gets a `waypoint-seat` skill, synced into its profile and added to its `skills.auto_load` whenever seats are listed, so every session starts with it. It tells the seat to own the handoff: create the step that should follow approval as a child task assigned to the best seat, then hand in with `kanban_request_review` and a summary ending in "On approval: ...". The child stays in `todo` until its parent is done. For a peer check before the user sees it, the seat creates a review task for that peer, links its own task to wait on it, and blocks with kind `dependency`. That puts its task in `todo` (not the inbox) until the review is done, then the seat resumes with the review result and hands in.

The inbox lists tasks in `review` (with the handoff summary and the follow-ups that start on approval) and in `blocked` (with the block reason). Approve completes the task, which releases its follow-ups to the dispatcher. Request changes sends it back to the seat.

## `GET /organization` and `PUT /organization`

Host-only control routes for the organization profile created during first-run setup. `GET` returns `{ "configured": false, "organization": null }` until one is saved; the app shows its setup flow in that state. `PUT` accepts any of `name` (1–80 characters), `key` (task prefix, 2–6 uppercase letters or digits starting with a letter), `ceoName` (1–40 characters), and `logo` (a base64 PNG, JPEG, WebP, or GIF data URL up to 256 KB, or `null` to remove it). Creating the organization requires `name`; `key` defaults to the first three letters of the name and `ceoName` to `CEO`. Omitted fields keep their saved values. A changed name or CEO name is written into the running CEO's bridge skill as its identity.

## `GET /healthz`

Returns service health and dependency-neutral process status.

## `GET /config`

Returns sanitized runtime configuration such as dry-run status, data directory, and CEO runtime settings. It never returns secrets.


## `GET` and `POST /org/seats`

The organization's seats are Hermes profiles inside the CEO's Hermes install (`/opt/data/profiles`). `GET` returns `{ seats: [{ id, description, model, provider }] }`. `POST` hires a seat: `{ "id": "designer", "description": "UI and UX design", "cloneFrom": "builder" }`.
- `id`: 2-31 lowercase letters, digits, or dashes. `default`, `ceo`, and `hermes` are reserved.
- `description`: 1-200 characters, saved as the profile description.
- `cloneFrom` (optional): an existing seat to copy (config, skills, persona). Without it, the seat starts fresh with the CEO's model and a short persona built from the description.

Duplicates return `409`, and dry-run mode refuses. The CEO hires the same way, natively with `hermes profile create`.

## `GET`, `POST`, and `DELETE /hermes-portal`

Opens an agent's native Hermes web dashboard. `POST` takes `{ "target": "ceo" }` or `{ "target": "<seat-id>" }` and returns `{ open, target, url, openedAt }`. The CEO container must be running. Dry-run mode refuses with `409`.

Waypoint starts `hermes dashboard` inside the CEO container, bound to 127.0.0.1:9119 (a seat's profile is preselected with `-p`). It serves it on one host loopback port, `http://127.0.0.1:<HERMES_PORTAL_PORT>/` (default 3081). Each TCP connection is relayed into the container through `docker exec`, so no container port is published. Only one dashboard is open at a time: opening another target stops the previous dashboard and reuses the same port. `DELETE` (or `HERMES_PORTAL_IDLE_MINUTES` without connections, default 30) stops the dashboard and closes the port. `GET` returns the current state.

## `GET /hermes/status`

Returns sanitized CEO runtime status: pinned image, container/volume names, Docker running state, model settings, native Hermes auth status, and diagnostics. It never returns auth JSON, tokens, API keys, raw logs, or raw Docker inspect output.

## CEO conversation threads

The CEO home is seeded with a `waypoint-onboarding` skill alongside the bridge skill. It interviews the user on purpose, core principles, approval points, and workflow, saves the confirmed summary to Hermes memory, proposes and (after approval) hires seats, and puts the first task on the board, with approval at each step. The Organization page's Onboard button starts it in the General thread.

The CEO conversation is split into threads: `general` plus one thread per board task, keyed by the task's board id. Each thread is its own Hermes session. Only one CEO turn runs at a time across all threads.

- `GET /hermes/ceo/threads` returns `{ "threads": [...], "busyThreadId" }`, with each thread's `threadId`, `title`, task `ref` and `status`, `messageCount`, `updatedAt`, and `lastText`. `general` comes first, then one thread per non-archived task.
- `GET /hermes/ceo/conversation?threadId=general` returns `{ threadId, sessionId, messages, live, busyThreadId }`. `live` is present while a turn is running in that thread: `{ startedAt, message, items }`. The user's message is stored with status `sent` when the turn starts, so it survives a page reload. A trailing `sent` message with no running turn (for example after a service restart) is reported as `outcome_unknown`.
- `POST /hermes/ceo/messages` takes `{ "message": "...", "threadId": "t_<hex>" }` and waits for the turn to finish. The first message in a task thread is prefixed with the task's ref, title, body, status, and assignee.

`messages` contain `user` and `ceo` entries plus one `activity` entry per turn: `{ role: "activity", at, items: [{ kind: "tool"|"action", name, detail, status: "ok"|"error"|"unknown", durationMs? }] }`. Tool items come from the Hermes stream-json `tool_use`/`tool_result` events: the tool name and a redacted, 200-character summary of its main input. Tool output is never stored. Action items record the CEO's Waypoint bridge calls. Hermes stream-json does not emit model reasoning, so threads cannot show it.

## GitHub connector

Agents reach GitHub through a private Waypoint GitHub App. Projects are GitHub repositories; agents clone and work in them inside the CEO container.

- `GET /github` returns `{ connected, app, installUrl, installations: [{ id, account, selection, repos }] }`. The private key never leaves the service.
- `POST /github/manifest` with `{ "origin": "http://127.0.0.1:5173", "owner": "optional-org" }` returns `{ state, url, manifest }`. The app form-posts `manifest` to `url` (GitHub's app manifest flow). GitHub redirects to `/connectors/github/callback?code&state`, and the app calls `POST /github/complete` with `{ code, state }`; states expire after 30 minutes and work once. The app requests contents, pull requests, and issues write; metadata, checks, and actions read; and no webhook events. Installation returns to `/connectors/github/installed`.
- `DELETE /github` forgets the app locally; delete it on GitHub separately.

`github_token { repo? }` returns an installation token (at most one hour, scoped to that one repository, cached until five minutes before expiry) for any project's repository. The CEO and every seat share it, because seats are profiles in the CEO's container. `repo` can be omitted when exactly one repository is available. Other repositories get `403` with the available list. The Waypoint Hermes image includes the real GitHub CLI behind a `gh` shim and a system git credential helper for `https://github.com`. Both fetch this token on demand, so agents use `gh` and `git` normally and nothing is written to disk. What an agent can do is limited by the GitHub App's permissions (contents, pull requests, and issues; no administration).
## `POST /hermes/lifecycle`

Body field `action`: `start`, `stop`, or `status`. Starts/stops only the labeled Waypoint CEO container and seeds/synchronizes the CEO home. Runtime ports are not broadly published.

## `GET /hermes/model-catalog`

Returns a local-only, credential-safe model selection catalog for the Settings UI. The service asks the running pinned Hermes runtime for provider-specific model IDs through Hermes' native `provider_model_ids` helper and returns sanitized `{id,name}` choices, provider labels, defaults, and API mode hints. If the CEO container is stopped or the account-specific catalog is unavailable, the endpoint returns verified curated fallback choices copied from the pinned Hermes runtime source; it never returns credentials, raw auth files, raw logs, or model-call output. Optional query: `provider=openai-codex|anthropic|openai-api`.

## `GET /hermes/skills`

Host-control route. Returns all installed CEO Hermes skills (enabled and disabled) using native Hermes skill discovery plus native `hermes_cli.skills_config.get_disabled_skills`. Each skill is `{name, description, category, source: builtin|local|hub, enabled, locked, waypoint}`. `locked` is true for `waypoint-ceo-bridge` and `hermes-agent`; `waypoint` marks Waypoint-seeded skills. Names/categories are allowlist-validated, descriptions are single-line, capped, and redacted. `counts` includes total/enabled/disabled/locked plus source counts. If the CEO container is not running it returns `available: false` with an empty list and does not exec. It never reads credentials, auth files, or logs, and covers the CEO only, not seats.

## `GET /hermes/skills/:name`

Optional safe detail route for a known skill. Returns bounded metadata only: the normalized skill record, a redacted short overview, and safe relative file names/sizes. It excludes secret/auth/env/token/key-like file names and does not return file bodies.

## `PUT /hermes/skills/:name`

Body: `{ "enabled": boolean }`. Validates a known skill name, rejects disabling locked skills with `409`, serializes skill mutations in the service process, updates the CEO profile's native disabled skill list through Hermes `load_config`/`save_disabled_skills`, re-reads actual native state, and returns the updated skill plus current inventory/counts. The route does not raw-overwrite YAML and rejects invalid name shapes before invoking Hermes.

## `PUT /hermes/model`

Persists Hermes model settings under `model` while preserving unrelated Hermes `config.yaml` settings through Hermes' native config writer. Body fields: `provider`, `default`, optional `base_url`, optional `api_mode`. Provider `openai` is accepted as a legacy alias for the native OpenAI API provider `openai-api`.

## `PUT /hermes/providers/:provider/api-key`

Stores supported API-key fallback credentials through Hermes credential lifecycle helpers. Responses return only configured/presence flags and never echo key material.

## `POST /hermes/providers/:provider/login`

Starts a native Hermes OAuth/login flow. OpenAI Codex is exposed as device-code login; Anthropic is exposed as authorization URL plus code submission. Responses contain only login URL, user code when applicable, and status text.


## Missions

Missions have a workflow `status`: `backlog`, `todo`, `in_progress`, `in_review`, `done`, or `canceled`. A mission may link one board task (`taskId`, a `t_<hex>` id).

- `GET /missions` returns `{ "missions": [...] }`, newest first. `GET /missions/:missionId` reads one.
- `POST /missions` takes `title` (required, max 120 characters), optional `outcome` (max 1000), `target` (`YYYY-MM-DD`), and `taskId`. It is idempotent by title (case-insensitive): repeating a title with the same link returns the existing mission with `200`; a new mission returns `201`; the same title with a different link returns `409`.
- `PATCH /missions/:missionId` takes `{ "status": "in_review" }` and validates the transition.
- `POST /missions/:missionId/links` takes `{ taskId }`. Replacing a different existing link returns `409`.
- `DELETE /missions/:missionId` removes only the mission; its task stays on the board.

## Projects

`GET /projects` returns `{ "projects": [...] }` sorted by name. `POST /projects` takes `{ name, missionId?, repo? }` (name 1–80 characters, unique ignoring case; `missionId` must be a stored mission; `repo` is `owner/name` on GitHub) and returns the project with its `project_<uuid>` id. `GET`, `PATCH`, and `DELETE /projects/:id` read, update, and remove one project.

## Error shape

Errors are structured and omit stack traces and secrets:

```json
{
  "error": {
    "code": "bad_request",
    "message": "Human-readable safe message",
    "details": {}
  }
}
```
