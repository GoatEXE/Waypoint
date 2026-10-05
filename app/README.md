# Waypoint web (front-end)

React + TypeScript + Vite build of `project/Waypoint Prototype.dc.html`. Front-end only: every
screen runs on the sample data in `src/data.ts` (the "Launch v2 of the patient intake app" mission).
There is no host service yet.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
```

## Layout

| Path | What |
| --- | --- |
| `src/data.ts` | Sample data and its types: where the host-service API plugs in later |
| `src/model.ts` | Status styles and derived values (live task status after approvals, progress %, group-by-project) |
| `src/store.tsx` | App state (pane, approvals, review picks, toggles, chat, modal, toast); UI prefs persist to `localStorage` |
| `src/routes.ts` | URL ↔ view mapping, CEO chat context, active project |
| `src/components/` | Sidebar, header and breadcrumb, right pane, modals, shared bits |
| `src/views/` | Mission, Project, Task, Run, Pod, Learning review, and the Workspace pages |
| `src/styles.css` | Design tokens (`:root`) and component classes |

## Routes

`/` mission · `/projects/:id` · `/tasks/:id` · `/runs/:id` · `/pods/:name` · `/pods/web-squad-01/review` ·
`/inbox` · `/routines` · `/artifacts` · `/skills` · `/connectors`

Deep links need the server to fall back to `index.html` (`vite dev` and `vite preview` already do).
