# Waypoint web app

React, TypeScript, and Vite interface for the local Waypoint service.

The mission, pod, task, message inbox, CEO conversation, Settings, Connectors, and Skills views use the service. Project, run, review, routines, and artifacts views still use sample data from `src/data.ts`.

## Run

From the repository root, `npm start` runs the service and this app together and signs the browser in. To run the app alone, start the host service from `service/`, then in this directory:

```sh
npm install
npm run check
npm run dev
npm run open
```

`npm run open` signs the default browser in to the local `/api` proxy. Other browsers can open `/__waypoint/pair` and be approved with `npm run approve -- <fingerprint>` on the host.

`npm run check` runs the source-comment lint rule across the app and service, the app tests, and a production build. The repository root `npm run check` also runs the service tests.

## Layout

- `src/api.ts` contains the service client and response types.
- `src/views/` contains both live service views and the remaining sample views.
- `src/data.ts` supplies sample records only to the prototype views.
- `server/controlProxy.js` gates `/api` behind the local browser session and forwards it to the service's host-only control channel.
