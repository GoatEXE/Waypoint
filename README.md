# Waypoint

Waypoint is an early foundation for a Hermes-based delegation system. The repository contains the web app under `app/` and a bounded backend/control service under `service/`.

## Current state

- A containerized Hermes CEO runs the organization. Seats are Hermes profiles in the same install; the user or the CEO hires them.
- Work is a Hermes kanban board. The gateway dispatcher starts assigned tasks on their seats. Waypoint shows the board, a GitHub-style thread per task, and an inbox of tasks waiting on you.
- You talk to the CEO directly, in a General thread or a thread per task.
- Missions and projects (GitHub repositories) are stored by the service and reachable by the CEO through a token-protected bridge.
- Settings / Models handles CEO provider login and model; the Skills page enables or disables CEO skills.

Current limits (details in `docs/status-and-limitations.md`):

- `DRY_RUN=true` is the default; set it to `false` for live use.
- Seats share the CEO's container, credentials, and GitHub access.
- Pods and their learning review are new.

## Validate

Install dependencies in `service/` and `app/`, then run `npm run check` from the repository root. It checks source comments, service and app behavior, and the app build.

```bash
cd service
npm install
npm run check
npm start   # bridge on 127.0.0.1:3080, control API on a host-only pipe/socket

cd ../app
npm install
npm run check  # comment lint, app tests, and production build
npm run dev     # http://127.0.0.1:5173
npm run open    # in another shell: signs this browser in (one-time link) and opens the app
# other browsers/tabs: open http://127.0.0.1:5173/__waypoint/pair, then npm run approve -- <fingerprint shown>
docker compose config
```

## Important docs

- `docs/api.md` - service endpoints (seats, task board, CEO, missions, projects), error shape, and the control/bridge security boundary.
- `docs/hermes-findings.md` - official Hermes documentation findings and discrepancies.
- `docs/status-and-limitations.md` - implemented status and precise limits.
