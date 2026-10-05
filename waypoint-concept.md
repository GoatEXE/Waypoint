# Waypoint — concept and requirements

**Status:** Working concept, not an implementation specification  
**Working name:** Waypoint (chosen as a placeholder)  
**Last discussed:** 2026-10-04

## Product idea

Waypoint is a local-first workspace for directing a team of AI agents toward a mission. A person gives work to a Hermes-based CEO agent. The CEO can break it down, delegate it, and use the platform's own tools to request or create agent seats. Seats work in on-demand pods against projects linked to local Git repositories. The interface should make it easy to start with the mission, follow its progress through projects and tasks, and inspect the actual work and evidence at the bottom.

The desired experience is a **globe-to-street-view zoom**: a clear overview with a continuous path to the details. The mission hierarchy is the primary way to navigate; pods and seats are the people and execution capacity attached to that work.

```text
Mission
  └─ Project(s)
       └─ Task(s)
            └─ Agent run(s), changes, tests, decisions, and other evidence
```

This is a navigation model, not necessarily a strict database tree. A project may contribute to more than one goal. Every task should have a clear project and a traceable reason it advances the mission.

## Inspirations and intended takeaways

| Inspiration | What appeals to us | How it informs Waypoint |
| --- | --- | --- |
| Forge | Agent coordination and a manager that can work with a team | Inspiration for human oversight and a CEO that can call platform tools to coordinate seats. Exact Forge features to emulate are not specified yet. |
| [Paperclip](https://paperclip.ing/) | Simple, polished UI and the company/CEO mental model | Preserve the approachable visual style, CEO delegation, hiring, and approvals where useful. Make mission → project → task → evidence a continuous drill-down experience. |
| [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) | Harness, persistent profiles, and learning over time | Run the CEO and other seats on Hermes. Preserve individual seat state and review lessons before promoting them into shared templates. |
| [OpenRig](https://openrig.dev/) | Addressable seats, pods, and on-demand cross-agent communication | Support direct questions between seats as well as durable task handoffs. Pods can be grown or replicated from templates. |
| [Herdr](https://herdr.dev/) | Persistent agent sessions and a practical way to see what agents are doing | Draw on its runtime/terminal visibility and continuity ideas. It is inspiration, not a required dependency. |

Paperclip already models goals, projects, and issues. The perceived gap is primarily the *experience* of navigating from the overall mission through those levels, rather than an assertion that Paperclip lacks the underlying data. Its current fit as a base or reference remains to be evaluated.

## Requirements expressed so far

### Direction established in discussion

- **CEO seat:** A Hermes-based CEO receives high-level assignments, plans and delegates work, and has scoped API/tool access to request or create seats in the platform.
- **Hermes seats:** The CEO and working agents use Hermes. Each durable seat needs its own identity, memory, skills, and session state.
- **Pods:** Define standardized seat compositions that can be started, stopped, and replicated on demand. Containerized pods are desired.
- **Seat communication:** An agent can contact another seat for a quick question. Work that must be owned and completed should be a durable task or handoff, separate from an informal message.
- **Projects:** Projects point to local Git repositories. Agents can use the project's existing containers and development services where appropriate.
- **Secrets:** Integrate Bitwarden Secrets Manager so authorized agent and project workloads can receive the secrets they need.
- **Interface:** Keep Paperclip's UI simplicity while showing the mission distributed across projects and tasks, with a path down to runs and evidence.
- **Clients:** Explore a cross-platform Electron desktop app and a web UI backed by the same control plane.
- **Learning review:** When taking down a pod, compare what its seats learned with their starting state, assess relevance, and ingest useful changes at the right scope.

### Proposed implementation direction, pending validation

- Use a local control-plane service as the source of truth for missions, projects, tasks, seats, pods, messages, runs, approvals, and audit history. Expose a narrow tool API to Hermes, potentially through MCP.
- Keep pod containers replaceable. Persist each seat's Hermes profile outside its container; do not run concurrent processes against the same profile directory.
- Replicate **templates**, not one live agent identity. Each new seat instance gets its own state. Promote reviewed lessons back to a versioned template or shared project knowledge.
- Give concurrent coding tasks separate Git worktrees or equivalent isolated workspaces. Connect them to project development containers as needed.
- Share one web frontend between the browser and Electron. A local host service handles filesystem and container operations; the UI calls it through an authenticated API.

## Pod lifecycle and learning

1. **Create:** Instantiate a pod from a versioned template of roles, instructions, skills, tools, and resource limits. Create separate Hermes profile state for each seat.
2. **Work:** Attach the pod to a project or task. Record messages, assignments, runs, code changes, tests, and decisions with stable identifiers.
3. **Review on shutdown:** Compare each seat's end state with its starting snapshot. Extract candidate changes to memory, skills, instructions, and project knowledge, keeping their source evidence.
4. **Classify:** Keep a lesson with the individual seat; add it to the project; propose it for a shared seat template; or discard it. Check for duplicates, contradictions, stale facts, and sensitive material.
5. **Promote:** Apply approved changes to the relevant durable store or versioned template. Preserve the original snapshot and decision trail so promotions can be reversed.
6. **Stop:** Release compute without losing outstanding tasks, evidence, or retained seat state.

[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) is a candidate for fast, structured decisions such as scoring or routing proposed lessons. It has **not** been chosen as a required dependency. An LLM may still be needed to summarize and reconcile text, and broad template changes should remain reviewable. Avoid automatically merging whole transcripts or profile exports into shared memory.

## Interface sketch

- **Mission view:** What outcome are we pursuing? Which projects advance it? What is progressing, blocked, over budget, or awaiting a decision?
- **Project view:** Goal links, repository and environment, task breakdown, assigned pods/seats, and progress grounded in completed work.
- **Task view:** Owner, status, dependencies, delegation trail, messages, approvals, and the reason the work matters.
- **Run/evidence view:** Agent output, changed files or Git diff, tests, artifacts, costs, and a clear completion or failure reason.
- **Pod/seat view:** Live status, conversations/terminals where useful, profile/template identity, and what will be reviewed when the pod stops.

The overview should stay visually simple. Detail appears as the user drills down rather than filling the main dashboard with every run and control.

## Feasibility and design constraints

The concept is technically feasible. The central integration work is preserving agent identity while pods are disposable, making work handoffs reliable, connecting local repositories to containers across operating systems, and controlling which secrets each workload can see.

- Hermes profiles have independent memory and state; two active processes should not write to the same profile. Its Docker guidance likewise warns against concurrent gateway containers sharing one data directory. [Profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles), [Docker setup](https://hermes-agent.nousresearch.com/docs/user-guide/docker)
- Hermes already supports Bitwarden Secrets Manager for fetching keys at process startup. Project containers still need their own deliberate secret delivery. Use machine accounts scoped to the required projects, with read access where sufficient. [Hermes Bitwarden integration](https://hermes-agent.nousresearch.com/docs/user-guide/secrets/bitwarden), [Bitwarden machine accounts](https://bitwarden.com/help/machine-accounts/)
- Local repository mounts depend on the machine running Docker. Remote web access therefore needs to connect to that machine's host service; it cannot assume that a remote container can mount a browser user's local path. [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)
- A direct message is useful for consultation, but durable delegated work needs its own owner and status. [OpenRig messaging](https://openrig.dev/docs/messaging)

## Suggested first proof

Build and evaluate one complete local loop: **mission → project → task → Hermes CEO → delegated seat → work in a local repository → evidence and review → pod shutdown learning diff**. Start with a small fixed set of seat templates and one project. This would test the distinctive product experience and the hardest state transitions before broad pod replication or desktop packaging.

## Open decisions

- Should a seat retain its identity across multiple pod runs, or should every pod instance start with a new seat identity? Both can work if only one process owns a profile at a time.
- What actions may the CEO take immediately when hiring a seat, and which require a human review?
- What is the smallest useful pod template, and when should the CEO choose a new pod rather than an existing seat?
- Which state belongs to a seat, a project, the mission, or a reusable template?
- Which project containers should agents be allowed to start, stop, or modify?
- Should the first release be local-only, with the web UI served locally, or should remote access be part of the first milestone?
- Is Paperclip a visual reference, an integration target, or a codebase worth adapting after an execution-model evaluation?
