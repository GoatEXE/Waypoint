# Waypoint

Waypoint is an early foundation for a Hermes-based delegation system. The repository contains the web app under `app/` and a bounded backend/control service under `service/`.

## Current state

Implemented now:

- Accepted pod/seat decisions are documented in `docs/decisions.md`.
- `service/` is a Node 22 host control service that provides:
  - durable pod templates and independent pod instances;
  - missions and task records;
  - pod lifecycle: one idle pinned-Hermes container per pod with a Waypoint-owned named volume, no host bind mounts;
  - per-seat model, setup, and native auth status;
  - manual task runs with stored run history and evidence.
  - an organization directory and durable CEO-to-seat, seat-to-seat, and seat-to-CEO messages.
- A containerized Hermes CEO delegates, creates and starts pods on demand, provisions their seats, and monitors work through a token-protected bridge. The local shared-auth setup uses a small overlay built from the pinned official Hermes image.
- The `app/` UI:
  - Settings / Models at `http://127.0.0.1:5173/settings` for CEO provider login and model.
  - A Skills page with CEO skill enable/disable.
  - Real mission, pod (with seat setup), and task pages (with a manual Run action).
  - Project, run, review, and workspace views still show prototype sample data.

Current limits (details in `docs/status-and-limitations.md`):

- `DRY_RUN=true` is the default. Pods, seat setup, and task runs only plan until it is deliberately set to `false`.
- In the local shared-auth setup, the CEO and all pods use one provider credential store. Pod data volumes stay separate, but pods can read or alter those shared credentials.
- A live provider-authenticated pod run and a fresh pod's automatic auth readiness have been verified. Standalone per-pod sign-in has not been verified against a real account.
- Runs never retry automatically. A failed or unknown outcome needs review before a person can use the task page's explicit retry action.

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

- `docs/api.md` - service endpoints (pods, seats, task runs, CEO), error shape, and the control/bridge security boundary.
- `docs/hermes-findings.md` - official Hermes documentation findings and discrepancies.
- `docs/status-and-limitations.md` - implemented status and precise limits.
