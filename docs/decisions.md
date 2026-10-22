# Waypoint decisions

Status: accepted by user direction.

## Native Hermes runtime (October 2026)

- The CEO and its seats run on Hermes installed on this computer, so Waypoint works the same from `npm start` and in the planned Electron app. Docker is reserved for future pods; Waypoint no longer runs Hermes in a container.
- Waypoint always uses its own `HERMES_HOME` and never touches the user's own Hermes profiles, memory, or gateway. The Hermes program is the one on PATH (or `HERMES_BIN`); the desktop app will later be able to manage its own pinned copy instead.
- Every Hermes command and helper script goes through one host layer (`service/src/hermesHost.js`) that passes `HERMES_HOME` explicitly.
- The service owns the home's `hermes gateway run`: it starts it on service start and stops it on request.
- Seats keep a scoped GitHub boundary: the Waypoint `gh` wrapper and git credential helper issue Waypoint GitHub App tokens, inherited github.com credential helpers are reset, and git uses Waypoint's own global gitconfig.
- The move to native started from a fresh Hermes home; nothing from the earlier container was migrated.

## Organization model

- Waypoint has one Hermes CEO / chief-of-staff role that delegates, provisions, and monitors work. Seats execute it.
- Seats are Hermes profiles in the CEO's install, hired natively with `hermes profile create`. Seat definitions are jobs/personalities, not secret bundles.
- Tasks are Hermes kanban tasks. The gateway dispatcher runs them; Waypoint adds refs and a GitHub-style thread view. Comments are how the user, the CEO, and seats talk about a task.
- Pods are separate kanban boards with cloned seats that can see and message each other, created and torn down by the CEO. Learning flows back to the original seats through a reviewed diff of skills and memories.
- Projects are GitHub repositories. Seats share the CEO's GitHub access.

## CEO home and bridge

- The CEO home is seeded with delegation identity only when missing, so user/learned CEO identity is not overwritten on ordinary settings or auth actions.
- The CEO receives a Waypoint bridge skill with payload schemas/examples for missions, projects, pods, and tasks.
- The bridge uses a persisted runtime bearer token under ignored `service/runtime/.../bridge-token`; a service restart must not strand the running CEO with a stale bridge token.
- Control endpoints are served only on a host-only named pipe / Unix socket; the TCP listener serves only token-authenticated `POST /bridge/tools`. The browser reaches control through the session-cookie-gated Vite `/api` proxy (cookie minted by host-only `npm run open`).

## Baselines, seats, and learning

- Pod seats are independent writable profiles cloned from the original seats.
- Review compares a pod seat's skills and memories against its baseline and promotes approved improvements to the original seat.
- Native Hermes profile clone modes copy `.env` material, so cloning must not be used to move secrets between seats deliberately; reviewed learning covers only skills and memory text.

## Secrets and provider auth

- Use native Hermes Bitwarden Secrets Manager integration for project secrets; do not implement a custom secret broker.
- Use native Hermes provider auth for account login. OpenAI Codex is exposed through native device-code OAuth. Anthropic OAuth is exposed through the native URL/code flow and requires Claude Max plus purchased extra/overage credits per Hermes docs; Claude Pro is not supported for that path.
- API-key fallback is explicit and distinct from subscription/OAuth login. Keys are stored through Hermes credential lifecycle helpers and never returned to the browser.
- Secrets, tokens, and credentials are never committed.

## Product and UI scope

- Eventual desktop packaging target is Electron.
- Real model calls are not performed until the user completes provider login in the UI.
- Dry-run is the default; dry-run responses must never claim work was done.
