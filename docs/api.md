# Backend API

Responses are JSON. Mutation requests must use `Content-Type: application/json`; requests with a foreign `Origin` header are rejected (defense in depth, not the boundary).

Security boundary: the full control API (missions, Skills, Settings/provider auth, lifecycle) listens only on a host-only channel — a Windows named pipe (`\\.\pipe\waypoint-control-<hash>`) or, on macOS/Linux, `service/runtime/control/control.sock` inside a `0700` directory. Docker Desktop containers can reach host loopback TCP but not that pipe/socket. The TCP port (`HOST`:`PORT`, default `127.0.0.1:3080`) serves only `POST /bridge/tools` with a constant-time bearer-token check; every other path returns `404` regardless of `Host`/`Origin`.

The browser reaches the control API through the app's Vite server at `/api/*`, which forwards to the pipe/socket only for requests carrying a valid `waypoint_session` cookie (`HttpOnly; SameSite=Strict`). A host process mints that cookie: `cd app && npm run open` writes a one-time, 2-minute sign-in code into `service/runtime/control/` and opens `/__waypoint/session?code=...`, which sets the cookie and redirects to `/`. For a browser the launcher can't open (for example an embedded/managed tab), pair it instead: open `http://127.0.0.1:5173/__waypoint/pair` in that browser. It gets an HttpOnly pairing cookie and the page shows only a non-secret fingerprint such as `ABCD-1234`. Then, on the host, run `cd app && npm run approve -- ABCD-1234`; the page signs in and redirects to `/` within a few seconds. Pairings expire after 5 minutes and work once; at most 10 can be pending. A container can create pairings, but only a host process can approve one, and approval is bound to the fingerprint the user sees. Only SHA-256 hashes of codes/sessions are stored; sessions last 30 days. `/api` without a valid session returns `403 session_required`. Override paths with `WAYPOINT_CONTROL_DIR` / `WAYPOINT_CONTROL_SOCKET` (both the service and the app read them).

Host-side manual calls: `curl --unix-socket service/runtime/control/control.sock http://waypoint/healthz` on macOS/Linux; on Windows use Node `http.request({ socketPath, path })` with the pipe name from `resolveControlChannel()` in `service/src/controlChannel.js`.

## `POST /bridge/tools` (bridge TCP port only)

The only route on the TCP listener. Body: `{ "tool": "...", "args": { ... } }`, with `Content-Type: application/json`. The CEO bearer token permits the original control tools, the task queue tools (`create_task`, `update_task`, `list_tasks`, `list_projects`, `create_project`), and messaging. A seat-specific messaging credential permits only `org_chart`, `inbox`, `outbox`, `send_message`, and `ack_message`; it cannot invoke pod lifecycle, task runs, or other CEO controls. Missing/wrong credentials return `403`. This route is not served on the control pipe.

During an automatically started CEO mailbox turn, the bridge refuses control tools even with the CEO token. Peer mail can use only the four messaging tools in that turn; it cannot authorize a pod or task action.

## Organization and messages

Waypoint addresses are `ceo` and `pod_<uuid>/<seat-id>`. `org_chart` lists the CEO and all stored pods/seats, with an optional `{ "query": "builder" }` search over pod names, seat IDs, and roles. Stopped pods remain in the chart because the address refers to a stored seat.

`send_message` takes `{ "to": "ADDRESS", "text": "...", "taskId": "SUN-3" }` (text 1–4000 characters; `taskId` optional, a task id or ref). A linked message appears in that task's thread. CEO messages sent during a task-thread turn are linked to that task automatically, and the seat helper links messages sent from a task workspace to that task. The seat helper takes the body as an argument: `waypoint-message.py send ADDRESS --text "..." [--task SUN-3]`, because Hermes terminal safety blocks piping text into an interpreter. The sender comes from the bearer credential and cannot be supplied in the request. The result contains a durable message ID. `inbox` takes optional `{ "limit": 50 }` and returns the recipient's unread messages, newest first. `ack_message` takes `{ "messageId": "msg_<uuid>" }`; acknowledged messages can still be fetched with `inbox` `{ "includeRead": true }`. A message a recipient sends back to the original sender while handling a message is linked to it with `replyTo` and inherits its `taskId`. When a delivery turn finishes, the recipient's own final answer is stored as `wake.reply` (redacted, at most 2000 characters). `outbox` takes optional `{ "limit": 20, "taskId": "SUN-3" }` and returns the caller's sent messages, newest first, each with `delivery` (`queued`, `running`, `answered`, `failed`, `read`, or `not_delivered`), `reply`, and `replies` (linked reply messages). `GET /message-deliveries` and `GET /tasks/:taskId/messages` include `replyTo` and `wake.reply`; the app shows delivery state and replies in task threads, and untasked CEO messages in the General thread. A full mailbox refuses new messages rather than dropping unread ones; old acknowledged messages are pruned when needed.

The host-only control API also exposes `GET /org-chart?query=...`, `GET /messages`, `POST /messages` (sends as CEO), and `POST /messages/ack` with `{ "messageId": "..." }`. The app's signed-in `/api` proxy can use these. Pod seats receive a scoped credential and a `waypoint-messaging` Hermes skill during seat provisioning; its Python helper calls only the messaging tools over the existing bridge endpoint. The CEO's bridge skill documents the same tools. New messages carry a durable `wake` state. A ready recipient gets one bounded Hermes turn; stopped or unready recipients retain queued mail. A completed recipient turn acknowledges its message even if the agent omitted the explicit acknowledgement. A service restart marks an in-flight wake `outcome_unknown` without retry. At most one automatic reply hop wakes another recipient, and each recipient is capped at 12 automatic turns per rolling day. Acknowledging queued mail suppresses its wake. Seats in one pod share the `hermes` Unix user and volume, so they can access each other's local seat credentials; pod boundaries remain separate.

## Message delivery review

The host-only `GET /message-deliveries?limit=100` lists recent messages across CEO and pod seat mailboxes with their durable wake state (`queued`, `running`, `completed`, `failed`, `outcome_unknown`, or `suppressed`). `POST /message-deliveries/review` with `{ "to": "ADDRESS", "messageId": "msg_<uuid>" }` marks only a failed or uncertain delivery reviewed. It does not replay that message. Later queued turns for the same recipient wait until the uncertain delivery is reviewed. Neither route is on the bridge port.

## `GET /organization` and `PUT /organization`

Host-only control routes for the organization profile created during first-run setup. `GET` returns `{ "configured": false, "organization": null }` until one is saved; the app shows its setup flow in that state. `PUT` accepts any of `name` (1–80 characters), `key` (task prefix, 2–6 uppercase letters or digits starting with a letter), `ceoName` (1–40 characters), and `logo` (a base64 PNG, JPEG, WebP, or GIF data URL up to 256 KB, or `null` to remove it). Creating the organization requires `name`; `key` defaults to the first three letters of the name and `ceoName` to `CEO`. Omitted fields keep their saved values. A changed name or CEO name is written into the running CEO's bridge skill as its identity, and `org_chart` lists the CEO under that name.

## `GET /healthz`

Returns service health and dependency-neutral process status.

## `GET /config`

Returns sanitized runtime configuration such as dry-run status, data directory, Docker image setting, and label namespace. It never returns secrets.

## `GET`, `POST`, and `DELETE /hermes-portal`

Opens an agent's native Hermes web dashboard. `POST` takes `{ "target": "ceo" }` or `{ "target": "pod_<uuid>/<seat-id>" }` and returns `{ open, target, url, openedAt }`. The target container must be running. Dry-run mode refuses with `409`.

Waypoint starts `hermes dashboard` inside the target container, bound to 127.0.0.1:9119 (the seat's profile is preselected). It serves it on one host loopback port, `http://127.0.0.1:<HERMES_PORTAL_PORT>/` (default 3081). Each TCP connection is relayed into the container through `docker exec`, so no container port is published. Only one dashboard is open at a time: opening another target stops the previous dashboard and reuses the same port. Opening the current target again reuses it. `DELETE` (or `HERMES_PORTAL_IDLE_MINUTES` without connections, default 30) stops the dashboard and closes the port. `GET` returns the current state.

## `GET /hermes/status`

Returns sanitized CEO runtime status: pinned image, container/volume names, Docker running state, model settings, native Hermes auth status, and diagnostics. It never returns auth JSON, tokens, API keys, raw logs, or raw Docker inspect output.

## CEO conversation threads

The CEO home is seeded with a `waypoint-onboarding` skill alongside the bridge skill. It interviews the user on purpose, core principles, approval points, and workflow, saves the confirmed summary to Hermes memory, proposes and (after approval) builds pods and seats, and creates and runs the first task with approval at each step. The Organization page's Onboard button starts it in the General thread.

The CEO conversation is split into threads: `general` plus one thread per task, keyed by the task id. Each thread is its own Hermes session. Only one CEO turn runs at a time across all threads.

- `GET /hermes/ceo/threads` returns `{ "threads": [...], "busyThreadId" }`, with each thread's `threadId`, `title`, task `ref` and `status`, `messageCount`, `updatedAt`, and `lastText`.
- `GET /hermes/ceo/conversation?threadId=general` returns `{ threadId, sessionId, messages, live, busyThreadId }`. `live` is present while a turn is running in that thread: `{ startedAt, message, items }`. The user's message is stored with status `sent` when the turn starts, so it survives a page reload; the app follows a running turn's `live` state after a reload. A trailing `sent` message with no running turn (for example after a service restart) is reported as `outcome_unknown`. Seat chat threads behave the same way.
- `POST /hermes/ceo/messages` takes `{ "message": "...", "threadId": "task_<uuid>" }` and waits for the turn to finish. The first message in a task thread is prefixed with the task's ref, title, description, status, and assignee.

`messages` contain `user` and `ceo` entries plus one `activity` entry per turn: `{ role: "activity", at, items: [{ kind: "tool"|"action", name, detail, status: "ok"|"error"|"unknown", durationMs? }] }`. Tool items come from the Hermes stream-json `tool_use`/`tool_result` events: the tool name and a redacted, 200-character summary of its main input. Tool output is never stored. Seat task runs record the same tool items: while a run is active, `GET /tasks/:taskId` includes `liveActivity: { runId, items }`, and each finished run keeps `activity` in `runs[]`. `GET /tasks/:taskId/messages` lists messages linked to the task, newest first. In a task thread, the app merges the CEO conversation, the task's seat runs, and its linked messages by time. Action items record the CEO's Waypoint bridge calls (for example `create_task` → `SUN-5 Plan the site`). Hermes stream-json does not emit model reasoning, so threads cannot show it.

## GitHub connector

Seats reach GitHub through a private Waypoint GitHub App. Repository code is cloned into the seat's pod volume; the user's local folder is never mounted.

- `GET /github` returns `{ connected, app, installUrl, installations: [{ id, account, selection, repos }] }`. The private key never leaves the service.
- `POST /github/manifest` with `{ "origin": "http://127.0.0.1:5173", "owner": "optional-org" }` returns `{ state, url, manifest }`. The app form-posts `manifest` to `url` (GitHub's app manifest flow). GitHub redirects to `/connectors/github/callback?code&state`, and the app calls `POST /github/complete` with `{ code, state }`; states expire after 30 minutes and work once. The app requests contents, pull requests, and issues write; metadata, checks, and actions read; and no webhook events. Installation returns to `/connectors/github/installed`.
- `DELETE /github` forgets the app locally; delete it on GitHub separately.
- Projects take `localPath`, `repo` (`owner/name`), and `githubSeats` (`pod_<uuid>/<seat-id>` addresses) on `POST /projects` and `PATCH /projects/:id`. `POST /folders/pick` with an optional `{ "start": "E:\Repositories" }` opens the operating system's folder picker on the host desktop (the Explorer-style dialog on Windows through PowerShell, `osascript` on macOS, `zenity` on Linux) and returns `{ path, cancelled }` after the user chooses or cancels; only one picker can be open at a time. Browsers cannot give a page a folder's full path, so the host service opens it. `POST /projects/inspect` with `{ localPath }` runs `git` on the host folder and returns `{ exists, isGit, root, remote, repo, branch }`. When `localPath` is set without `repo`, the GitHub remote is detected automatically.

GitHub credentials: `github_token` `{ repo? }` returns an installation token (at most one hour, scoped to that one repository, cached until five minutes before expiry). A seat may use the repositories of projects that list it in GitHub seats; the CEO may use any project's repository. `repo` can be omitted when exactly one repository is available. Other repositories get `403` with the available list. The Waypoint Hermes image includes the real GitHub CLI behind a `gh` shim and a system git credential helper for `https://github.com`. Both fetch this token on demand, so agents use `gh` and `git` normally and nothing is written to disk. What an agent can do with a token is limited by the Waypoint GitHub App's permissions (contents, pull requests, and issues; no administration). Seats and the CEO get a commit identity (`<seat> (Waypoint)`) in their Hermes subprocess home. Seat setup removes the old `waypoint-github.py` wrapper and `waypoint-github` skill.

## Direct seat chat

`GET /pod-instances/:podId/seats/:seatId/conversation` and `POST /pod-instances/:podId/seats/:seatId/messages` (body `{ "message": "..." }`) let the user talk with one seat directly. Each turn runs `hermes -p <seat> chat` inside the seat's own pod container through the task executor, so it has the same readiness checks, turn limits, and live tool activity as a task run. It uses one stable per-seat chat session and workspace. A seat that is running a task or answering a message is refused with `409`, as is dry-run mode. Responses use the CEO conversation shape, with seat replies as `role: "seat"`. Thread id in the app: `seat:<podId>/<seatId>`.

## `POST /hermes/lifecycle`

Body field `action`: `start`, `stop`, or `status`. Starts/stops only the labeled Waypoint CEO container and seeds/synchronizes the CEO home. Runtime ports are not broadly published.

## `GET /hermes/model-catalog`

Returns a local-only, credential-safe model selection catalog for the Settings UI. The service asks the running pinned Hermes runtime for provider-specific model IDs through Hermes' native `provider_model_ids` helper and returns sanitized `{id,name}` choices, provider labels, defaults, and API mode hints. If the CEO container is stopped or the account-specific catalog is unavailable, the endpoint returns verified curated fallback choices copied from the pinned Hermes runtime source; it never returns credentials, raw auth files, raw logs, or model-call output. Optional query: `provider=openai-codex|anthropic|openai-api`.

## `GET /hermes/skills`

Host-control route. Returns all installed CEO Hermes skills (enabled and disabled) using native Hermes skill discovery plus native `hermes_cli.skills_config.get_disabled_skills`. Each skill is `{name, description, category, source: builtin|local|hub, enabled, locked, waypoint}`. `locked` is true for `waypoint-ceo-bridge` and `hermes-agent`; `waypoint` marks Waypoint-seeded skills. Names/categories are allowlist-validated, descriptions are single-line, capped, and redacted. `counts` includes total/enabled/disabled/locked plus source counts. If the CEO container is not running it returns `available: false` with an empty list and does not exec. It never reads credentials, auth files, or logs, and covers the CEO only, not pod seats.

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

## `POST /bridge/tools`

Internal CEO bridge. The CEO runtime token supports `health`, `list_missions`, `create_mission`, `link_mission`, `create_template`, `list_templates`, `clone_template`, `add_seat`, `pod_status`, `pod_start`, `pod_stop`, `create_task`, `run_task`, `task_status`, and the five messaging tools above. Missions created through the bridge are recorded with `source: "ceo"`. Anonymous requests are rejected.

For a new pod, the CEO can create a template, clone it, and call `pod_start`. If the pod and template have no model, a live start captures the CEO's current model as the pod default; explicit seat models take priority. It then provisions every seat, installs messaging tools, and returns readiness. When shared auth is enabled, those seats use the CEO's provider connection without another login. A dry-run start writes nothing. If the CEO has no configured model and the pod has no model, start is refused before launching the pod.

- `run_task` takes args `{ "taskId" }` only; any other arg returns `400`. It uses the same service path as `POST /tasks/:taskId/run` with no fixture files. It returns promptly with `{ taskId, runId, state: "running", message }`, or the dry-run summary without the Docker `plan`. It has the same `404`/`409` refusals, never starts a pod, and never retries.
- `task_status` takes args `{ "taskId" }` only. It returns a compact, already-sanitized view: `{ taskId, podId, seatId, summary, state, activeRunId, manualReviewRequired, lastRun: { id, state, startedAt, finishedAt, durationMs, reason, sessionId, reply (max 4000 chars), replyTruncated } | null, runCount, evidence: [last 8 { type, message, at, runId?, retry? }], updatedAt }`.

## `POST /pod-templates`

Creates a durable versioned pod template.

Required body fields:

- `name`: stable human-readable name.
- `version`: template version string.
- `seats`: array of seat definitions. Each seat requires `id` and `role`.

Optional body fields:

- `baselineFiles`: object keyed by relative allowlisted file path. Allowed paths are `SOUL.md`, `memories/MEMORY.md`, `memories/USER.md`, `skills/<name>.md`, and Hermes-style `skills/<name>/SKILL.md`.
- `config`: deliberately constructed non-secret configuration metadata. The service rejects secret-like keys, but baseline text still must be reviewed before use; this is not a content secret scanner.

## `POST /pod-templates/:templateId/clone`

Materializes an independent pod instance from a stored template.

Required body fields:

- `podName`: stable name for the pod instance.

Response includes instance id, a pod instance directory, per-seat writable profile directories under `profiles/<seatId>`, copied allowlisted files per seat, and a Docker start plan. `podName` is unique; a duplicate name is rejected to avoid container-name collisions. In dry-run mode this is only a plan.

## `GET /pod-instances/:podId`

Reads a persisted pod instance manifest.

## `POST /tasks`

Creates a task in the organization queue. Only `summary` (the title, 1–200 characters) is required. Optional fields:

- `description` (up to 8000 characters; sent with the title as the run prompt)
- `status`: `backlog`, `todo` (default), `in_progress`, `in_review`, `done`, or `canceled`
- `podId`, or `podId` and `seatId`: the owning pod or seat. A task needs a seat before it can run.
- `projectId`: a stored project
- `labels`: up to 10 labels, lowercased with spaces turned into dashes
- `parentId`: a task id or ref; cycles are rejected
- `blockedBy`: up to 20 task ids or refs

Unknown fields are rejected. Each task gets a sequential `number` and a `ref` such as `ORT-12` built from the organization task prefix; tasks created before numbering existed are numbered by creation time at service start. Response `state` begins as `delegated`. This endpoint records ownership only; it does not execute Hermes work. Use `POST /tasks/:taskId/run` to run it.

Workflow `status` is separate from run `state`. Starting a run moves `backlog`/`todo` to `in_progress`; a completed run moves it to `in_review`; a run released before any model turn restores the prior status. Older tasks without a status report one derived from their run state.

Status changes follow one transition table for the app and the CEO bridge (`400` otherwise), and are refused with `409` while a run is active:

| From | Allowed to |
| --- | --- |
| `backlog` | `todo`, `in_progress`, `in_review`, `done`, `canceled` |
| `todo` | `backlog`, `in_progress`, `in_review`, `done`, `canceled` |
| `in_progress` | `todo`, `in_review`, `done`, `canceled` |
| `in_review` | `todo`, `in_progress`, `done`, `canceled` |
| `done` | `todo`, `in_review` |
| `canceled` | `backlog`, `todo` |

Moving a task whose run `completed` back to `todo` or `backlog` re-opens it: `state` returns to `delegated` (with a `reopened` evidence note) so a new run can start. Failed and `outcome_unknown` runs are not re-opened by a status change; they still need the explicit manual retry after review.

`GET /tasks/:taskId` includes `statusHistory`: `[{ from, to, by, at, reason? }]`, oldest first (last 100). `by` is `user` (app), `ceo` (bridge), or `system` (automatic, with `reason` `run_started`, `run_completed`, `run_failed`, `run_outcome_unknown`, or `run_aborted`). Creation records `from: null` with `reason: "created"`.

## `PATCH /tasks/:taskId`

Updates only the given fields (the same fields as `POST /tasks`; `null` clears a link). A running task cannot change its pod or seat. Wherever a route takes `:taskId`, a ref such as `ORT-12` also works.

## `GET /projects` and `POST /projects`

`GET` returns `{ "projects": [...] }` sorted by name. `POST` takes `{ "name": "Website", "missionId": "mission_<uuid>" }` (name 1–80 characters, unique ignoring case; `missionId` optional and must be a stored mission) plus the optional repository fields below, and returns the project with its `project_<uuid>` id. Projects belong to a mission; the app lists them under their mission and creates them there. `GET`, `PATCH`, and `DELETE /projects/:id` read, update, and remove one project. Deleting is refused with `409` while tasks still use the project. Saving `githubSeats` installs the seat GitHub tools on newly designated seats whose pod is running and returns their addresses as `toolsInstalled`.

## `GET /missions`

Returns `{ "missions": [...] }`, newest first. Each mission includes a short summary of its linked pod (`podName`, `state`, seat ids/roles) and task (`seatId`, `summary`, `state`, evidence), plus `missing: ["pod"|"task"]` if a linked record no longer exists. Local file paths are not returned.

## `POST /missions`

Records a mission. Body fields: `title` (required, max 120 chars), optional `outcome` (max 1000), optional `target` (`YYYY-MM-DD`), optional `podId` and `taskId`. Linked ids must match stored records, and a task must belong to the given pod; a `taskId` alone implies its pod.

`state` is `delegated` when a task is linked, otherwise `planned`. It records hand-off only; it never means work has run.

Idempotent by title (case-insensitive): repeating a title with the same links returns the existing mission with `200`; a new mission returns `201`; the same title with different links returns `409`.

## `GET /missions/:missionId`

Reads one mission with the same linked summaries.

## `DELETE /missions/:missionId`

Removes only the mission record. Its linked pod and task remain stored. This is a host-control route and is unavailable on the bridge port.

## `POST /missions/:missionId/links`

Body fields: `podId` and/or `taskId`. Adds links to a mission that does not have them yet. Replacing an existing, different link returns `409`.

## `GET /tasks`

Returns `{ "tasks": [...] }` with each task's `id`, `number`, `ref`, `summary`, `description`, `status`, `state`, `podId`, `seatId`, `projectId`, `labels`, `parentId`, `blockedBy`, `createdAt`, and `updatedAt`, independent of mission links. Subtasks and blocking tasks are derived from `parentId` and `blockedBy`. The organization chart similarly lists stored pods and seats after a mission is deleted.

## `GET /tasks/:taskId`

Reads a persisted task record, including run state. Fields:

- `id`, `podId`, `seatId`, `summary`, `createdAt`, `updatedAt`
- `state`: `delegated` (no run, or the last run was released before any model turn), `running`, `completed`, `failed`, or `outcome_unknown`
- `activeRunId`: present only while `state` is `running`
- `lastRunId`: the most recent closed run
- `runs` (last 10, absent until the first run): `{ id, state: running|completed|failed|outcome_unknown|aborted, startedAt, fromState, finishedAt?, durationMs?, sessionId?, reply?, replyTruncated?, reason? }`. `reply` is the seat's sanitized final assistant text (max 8000 chars). `reason` is set on `aborted` runs (for example `pod_not_running`, `seat_auth_not_ready`, `seat_model_unconfigured`, `seat_not_ready`, `seat_busy`, `pod_safety_refused`, `workspace_fixture_conflict`, `workspace_unavailable`, `preflight_<code>`) and on runs interrupted by a restart (`service_restarted`).
- `evidence`: the original delegation record plus the most recent run evidence (each tagged with `runId`): `readiness`, `workspace`, `hermes_turn`, `run_aborted`, `run_interrupted`, `run_error`. Only allowlisted fields are kept: `type`, `message`, `at`, `runId`, `exitCode`, `resultExitCode`, `timedOut`, `toolCalls`, `tokens`, `partialTextChars`, `partialTextTruncated`, `fixturesCreated`, `fixturesUnchanged`, `modelTurnStarted`, `retry`, `automaticRetry`, `error`. Tool inputs/outputs, stderr, prompts, and Docker argv are never stored.

`failed` and `outcome_unknown` carry `retry: "manual_review_required"` evidence. They stay locked: Waypoint never retries automatically.

## `POST /tasks/:taskId/manual-retry`

This host-only action requires exactly `{ "reviewed": true }`. It explicitly starts a new run only for tasks in `failed` or `outcome_unknown`. The previous workspace and Hermes session may be reused, so review the prior reply and evidence first. There is no automatic retry and no retry tool on the CEO bridge.

## `POST /tasks/:taskId/run`

Host-control route (not on the bridge TCP port). Runs one bounded Hermes turn for the task on its own pod seat, using the saved `summary` (plus `description`, when set) as the prompt. A task without an assigned seat is refused with `409`. Nothing is ever run automatically; this is an explicit user or CEO action.

Body: `{}` or `{ "files": [{ "path": "fixtures/input.txt", "content": "..." }] }`. `files` are optional tiny text fixtures for the task workspace: at most 16 files, each up to 64 KiB, 256 KiB in total, with relative paths of up to 4 simple segments. Any other field (including `prompt` or a retry flag) returns `400`.

Requirements: the pod must already be running, its seat provisioned with a model, and native provider auth ready for that seat. The endpoint never starts the pod, provisions seats, or copies CEO credentials.

- **Live mode** returns `202 { "taskId", "runId", "state": "running", "message" }` as soon as the run is durably claimed. The turn continues in the background; poll `GET /tasks/:taskId`.
  - The background run checks pod ownership and seat readiness, prepares `/opt/data/workspaces/<taskId>` inside the pod volume, then runs `hermes -p <seat> chat` with in-container and host timeouts and a run budget.
  - A refusal before any model turn (pod stopped, auth or model not ready, unsafe container, fixture conflict) releases the run as `aborted` with a `reason`, and the task returns to `delegated`.
  - A model turn ends as `completed`, `failed`, or `outcome_unknown`. An unexpected error after the claim is recorded as `outcome_unknown`.
- **Dry run** (`DRY_RUN=true`) returns `200 { "taskId", "state", "dryRun": true, "executed": false, "plan": [...], "message" }`. Nothing is claimed or executed, and the task is unchanged.

Errors:

- `400` invalid body or fixtures.
- `404` unknown task.
- `409` in these cases:
  - The task is already `running`.
  - The task already ended `completed`, `failed`, or `outcome_unknown` (manual review is required; there is no retry through this route).
  - Another task is running on the same pod seat.
  - The pod template is missing.

Fixture files are never overwritten. An existing file with identical bytes is left alone; a different one aborts the run with `workspace_fixture_conflict`.

On startup, runs left `running` by a previous service process are closed as `outcome_unknown` (`reason: service_restarted`) before requests are served.

## `POST /pod-instances/:podId/lifecycle`

Plans or performs a Docker lifecycle action for a Waypoint-owned pod container.

Body fields:

- `action`: `start`, `stop`, or `status`.

In dry-run mode the response contains the command plan and `executed: false`. Start plans use one idle container per pod, Docker `bridge` networking, a Waypoint-owned named Docker volume mounted to `/opt/data`, no published ports, and no host pod directory, `docker.sock`, or Waypoint bridge token mount/injection. With `WAYPOINT_SHARED_AUTH=true`, a second labeled named volume is mounted at `/opt/waypoint-auth`; the configured image must carry the Waypoint shared-auth overlay label. The CEO and pods use that one Hermes auth store, including its atomic writes and refresh lock. Container and volume names are derived from validated configuration, not stored manifests. Live starts and reuses verify ownership labels, the exact expected mounts and image, non-privileged host config, no port bindings or added capabilities, and bridge-only networking. Unsafe or older containers are refused and may require manual recreation while keeping their data volumes. Seeding copies the derived host `profiles/<seatId>` baseline with `docker cp` and fixes ownership before writing its marker.

## `POST /pod-instances/:podId/seats`

Hires a seat into an existing pod. Body: `{ "id": "builder", "role": "Builder", "instructions": "..." }` (`instructions` optional; `id` follows seat id rules and must be new in the pod, otherwise `409`). The seat's profile is materialized from the pod's template baseline files. If the pod is running (and not in dry-run mode), its profile is copied into the pod volume, prepared, and given its tools right away, and the response includes `seats` readiness; otherwise that happens on the next start. The CEO bridge equivalent is `add_seat` `{ podId, seatId, role, instructions? }`, and `list_templates` lists stored templates with their seats. The New Assignment dialog adds a line telling the CEO whether it must ask before hiring.

## `GET /pod-instances/:podId/seats/status`

Read-only check of each seat's Hermes profile, model, and native provider auth inside the pod container.

Query parameters (optional):

- `seatIds`: comma-separated seat ids. Defaults to every seat in the pod.
- `auth=skip`: skip `hermes -p <seat> auth status` probes. Each auth provider is then reported as `not_checked`.

## `PUT /pod-instances/:podId/seats/:seatId/model`

Host-control route (not on the bridge TCP port). Records the non-secret model choice for one seat in the stored pod instance. It runs no container command and makes no model call. Use it when the pod's template has no model (for example the existing Finish Waypoint pod), then run seat provisioning to apply it inside the pod.

Body: exactly `{ "model": { "provider", "default", "api_mode"?, "base_url"? } }`, or `{ "model": null }` to clear the seat override. A missing `model`, any extra field, an unsupported provider, secret-like fields, or a `base_url` with credentials, a query string, or a fragment return `400`. An unknown pod or seat returns `404`.

Response: `{ podId, podName, seat: { id, role, model } }`, where `model` is the normalized object or `null`.

## `POST /pod-instances/:podId/seats/provision`

Prepares the seat profiles that pod start copied into `/opt/data/profiles/<seatId>`. This is safe to repeat. It adds the standard Hermes profile folders (mode `0700`) and a placeholder `.env` (mode `0600`) when one is missing. It writes the seat model only if it differs from the profile's `config.yaml`, using Hermes' own config writer. It never runs `hermes profile create` or reads `.env` or `auth.json` contents. In shared-auth mode, Hermes itself reads the separately mounted shared auth store. Concurrent requests for the same pod run one at a time.

Body: `{}` or `{ "seatIds": ["lead"] }`. Any other field returns `400`. In particular, requests cannot supply models or keys.

Seat models come only from stored records, never from the request. Precedence is the seat override set by `PUT /pod-instances/:podId/seats/:seatId/model`, then the instance model, then the pod template's `config.model`. Each has the shape `{ provider, default, api_mode?, base_url? }`. `provider` must be `openai-codex`, `anthropic`, or `openai-api` (`openai` is accepted as an alias). Other fields, secret-like fields, and a `base_url` with credentials, a query string, or a fragment return `400`. If the template is missing, the request returns `409`.

All seat endpoints are control-only and are not exposed as bridge tools.

**Dry-run (`DRY_RUN=true`, the default).** No Docker commands run. The response has `dryRun: true` and `executed: false`. Each seat has `profile: null`, `auth: null`, a `blockers` list starting with `dry_run`, and its planned model. `plan.steps` lists the Docker commands a live run would use.

**Live mode.** The pod must already be running. Before any seat exec, the service verifies Waypoint ownership labels, running state, configured pinned image, exactly the expected data mount plus the shared auth mount when enabled, non-privileged host config, no port bindings or added capabilities, bridge-only networking, and matching labeled default local volumes without bind-style options. Failures return `409` (missing or stopped pod) or `422` (ownership/safety mismatch). The seat endpoints never start a pod. Every in-container command runs as `--user hermes` with time and output limits. Raw command output is never returned.

Response:

```json
{
  "podId": "pod_…",
  "action": "provision",
  "dryRun": false,
  "executed": true,
  "changed": true,
  "ready": false,
  "seats": [{
    "seatId": "lead",
    "ready": false,
    "blockers": ["auth_not_ready"],
    "profile": { "state": "ready", "identity": true, "writable": true, "envPrivate": true, "missingSubdirs": [], "changed": [".env", "config.yaml:model"] },
    "model": { "state": "configured", "source": "template", "requested": { "provider": "anthropic", "default": "claude-sonnet-5" }, "current": { "provider": "anthropic", "default": "claude-sonnet-5", "apiMode": "", "baseUrlSet": false } },
    "auth": { "providers": { "anthropic": { "checked": true, "authenticated": false, "state": "logged_out", "message": "Not authenticated with native Hermes auth." } }, "seatAuthFile": false, "podAuthFile": false }
  }],
  "notes": ["…"]
}
```

Field values:

- `profile.state`: `ready`, `needs_provision`, `not_seeded`, `not_writable`, `foreign` (no matching `WAYPOINT_SEAT.json`, or a path is not a regular file or folder), `invalid`, or `error`.
- `model.state`: `configured`, `pending` (requested but not yet written), `profile_only` (the template has no model, but the profile does), `unconfigured`, or `planned` (dry-run only).
- `auth.providers.*.state`: `authenticated`, `logged_out`, `unknown`, `skipped` (profile not ready), or `not_checked`. Auth is checked for the seat's model provider, or for all three providers when no model is set.
- `seatAuthFile` and `podAuthFile` only report whether the seat's own `auth.json` and the pod-root `/opt/data/auth.json` exist; their contents are not read. In profile mode, Hermes falls back to the pod-root store, which lives on the pod's own volume and never in the CEO home.
- `blockers` can contain `dry_run`, `profile_<state>`, `model_unconfigured`, `model_not_applied`, and `auth_not_ready`. A seat is `ready` only when `blockers` is empty.

## Per-seat provider connection routes

Control-only routes for connecting one validated pod seat to a provider. They are not exposed on the bridge TCP listener and never start pods or run model calls. All require `DRY_RUN=false`; dry-run requests return `409`. Before any provider command, the service validates the stored pod id, seat membership, Waypoint-owned running pod container, expected Waypoint-owned volume mounted at `/opt/data`, and a ready/private seat profile.

### `POST /pod-instances/:podId/seats/:seatId/providers/:provider/login`

Starts native Hermes OAuth in the target seat profile using the pod container only:

```text
docker exec -i --user hermes <verified-pod-container> hermes -p <seatId> auth add <provider> --type oauth --no-browser --timeout <seconds>
```

Supported OAuth providers:

- `anthropic`: authorization-code flow. Body may omit `flow` or set `{ "flow": "authorization-code" }`.
- `openai-codex`: device-code flow. Body may omit `flow` or set `{ "flow": "device" }`.

Returns `202` with only safe pending information:

```json
{
  "id": "seat_login_…",
  "podId": "pod_…",
  "seatId": "lead",
  "provider": "anthropic",
  "flow": "authorization-code",
  "state": "pending",
  "authUrl": "https://claude.ai/…",
  "userCode": "",
  "requiresCode": true,
  "startedAt": "…",
  "updatedAt": "…",
  "message": "Open the provider URL, authorize Hermes, then paste the returned authorization code."
}
```

If a login for the same pod/seat/provider is already `pending` or `cancelling`, the route returns that existing login instead of spawning a duplicate. OAuth URLs/device codes appear only in these login responses while pending; they are not logged and are cleared on terminal states. Output is bounded and parsed for terminal provider rejection/expiry. The normal Hermes prompt text such as “Ctrl-C to cancel” is not treated as failure.

### `GET /pod-instances/:podId/seats/:seatId/providers/:provider/login/:loginId`

Reads one in-memory login. Unknown, mismatched, or stale ids return `404`. Terminal states (`authorized`, `failed`, `cancelled`) are retained only briefly/for a final read; pending URL/code fields are blank once terminal.

### `POST /pod-instances/:podId/seats/:seatId/providers/:provider/login/:loginId/code`

Submits an Anthropic authorization code to the pending Hermes process on stdin. Body: `{ "code": "…" }`. Codes must be 4-2048 characters and contain no control characters. The code is never placed in argv, logs, or the response. Device-code flows reject this route with `400`.

### `DELETE /pod-instances/:podId/seats/:seatId/providers/:provider/login/:loginId`

Requests cancellation of a pending native login by terminating the bounded `docker exec` client. The returned state is `cancelling` until Hermes exits, then `cancelled`; refresh seat auth status before starting work.

### `PUT /pod-instances/:podId/seats/:seatId/providers/:provider/api-key`

Write-only API-key fallback for a single seat profile. Supported providers are `anthropic`, `openai-api`, and legacy alias `openai`; Codex subscription OAuth (`openai-codex`) does not accept API keys here. Body: `{ "apiKey": "…" }`; keys must be 8-4096 characters and contain no control characters.

The key is supplied only on stdin to an in-container Python script running as `hermes`. That script sets `HERMES_HOME=/opt/data/profiles/<seatId>` and calls Hermes' native `save_provider_env_credential`, preserving other `.env` entries and reconciling that seat profile's credential pool/config mirrors. The seat `.env` remains mode `0600`. Responses return only configured/presence flags and never echo key material:

```json
{
  "podId": "pod_…",
  "seatId": "lead",
  "provider": "anthropic",
  "configured": true,
  "credentialPresent": true,
  "authMode": "api-key",
  "message": "API key saved to the seat profile .env. Readiness is verified by Hermes when a provider request is made."
}
```

Hermes v0.21.5 reports API-key providers such as `anthropic` and `openai-api` as `<provider>: logged in` from the seat profile `.env`/credential pool; the normal seat status endpoint is the safe readiness check after saving a key.

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
