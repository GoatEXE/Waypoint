# Waypoint

Waypoint is an early foundation for a Hermes-based delegation system. The repository contains the web app under `app/` and a bounded backend/control service under `service/`.

## Current state

- A Hermes CEO runs the organization. It runs on Hermes installed on this computer, with its own Hermes home (`service/runtime/pod/hermes-home`), separate from any Hermes you use yourself. Seats are Hermes profiles in the same install; the user or the CEO hires them.
- Work is a Hermes kanban board. The gateway dispatcher starts assigned tasks on their seats. Waypoint shows the board, a GitHub-style thread per task, and an inbox of tasks waiting on you.
- You talk to the CEO directly, in a General thread or a thread per task.
- Missions and projects (GitHub repositories) are stored by the service and reachable by the CEO through a token-protected bridge.
- Settings / Models handles CEO provider login and model; the Skills page enables or disables CEO skills.

Current limits (details in `docs/status-and-limitations.md`):

- `DRY_RUN=true` is the default; set it to `false` for live use.
- Seats share the CEO's Hermes install and credentials and run as your user account; GitHub access goes through the Waypoint GitHub App.
- Pods are boards inside the same install, not separate containers yet.
- Pods and their learning review are new.

## Validate

Install [Hermes](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart) (on Windows: `iex (irm https://hermes-agent.nousresearch.com/install.ps1)`) so `hermes` is on PATH, or set `HERMES_BIN`. Install dependencies in `service/` and `app/`, then run `npm run check` from the repository root. It checks source comments, service and app behavior, and the app build.

```bash
npm install --prefix service
npm install --prefix app
npm run check  # comment lint, service tests, app tests, and production build
npm start      # service + app, then signs this browser in and opens http://127.0.0.1:5173
```

`npm start` runs the service (bridge on 127.0.0.1:3080, control API on a host-only pipe/socket) and the app together, prefixes their logs with `[service]` / `[app]`, and stops both on Ctrl+C or when either one exits. `npm start -- --no-open` skips opening the browser. To sign in another browser or tab, open http://127.0.0.1:5173/__waypoint/pair there and run `npm --prefix app run approve -- <fingerprint shown>`.

With Developer mode on (Settings), Waypoint can update itself in place from `main` and preview a pull request from an approval on port 5174. See `docs/api.md`.

The pieces still run on their own: `npm start` in `service/`, `npm run dev` in `app/`, and `npm run open` in `app/` to sign in.

## Important docs

- `docs/api.md` - service endpoints (seats, task board, CEO, missions, projects), error shape, and the control/bridge security boundary.
- `docs/hermes-findings.md` - official Hermes documentation findings and discrepancies.
- `docs/status-and-limitations.md` - implemented status and precise limits.
