# Hermes runtime findings

This document separates official documentation findings from runtime-tested behavior.

## Docs-verified primary sources

- Hermes Windows (Native) guide: <https://hermes-agent.nousresearch.com/docs/user-guide/windows-native>
- Hermes Quickstart: <https://hermes-agent.nousresearch.com/docs/getting-started/quickstart>
- Hermes providers guide: <https://hermes-agent.nousresearch.com/docs/integrations/providers>
- Hermes Profiles guide: <https://hermes-agent.nousresearch.com/docs/user-guide/profiles>
- Hermes Bitwarden guide: <https://hermes-agent.nousresearch.com/docs/user-guide/secrets/bitwarden>
- Hermes Multi-profile gateways guide: <https://hermes-agent.nousresearch.com/docs/user-guide/multi-profile-gateways>

Install and home findings:

- Hermes runs natively on Windows 10/11, macOS, and Linux. On Windows the PowerShell installer puts the program under `%LOCALAPPDATA%\hermes` and adds `hermes` to the user PATH; no admin rights are needed.
- `HERMES_HOME` selects where all Hermes data lives (config, `.env`, memory, sessions, skills, logs, state database). It also scopes the gateway PID file, so separate homes can run gateways at the same time. Named profiles live in `<HERMES_HOME>/profiles/<name>`.
- A child process that loses `HERMES_HOME` falls back to the default home (Hermes issue #18594), so every spawn must pass it explicitly.
- `HOME` is separate from `HERMES_HOME`: tools such as git, gh, and npm keep the real user home unless a profile sets `terminal.home_mode: profile`.

Official provider documentation findings:

- `hermes auth add openai-codex --type oauth` supports native OpenAI Codex device-code login by default; the user opens a provider URL and enters a displayed code.
- `hermes auth add openai-codex --browser` uses browser authorization-code/PKCE on fixed `localhost:1455`; Waypoint does not expose this path yet.
- Hermes stores its own provider auth in the Hermes home; Waypoint does not import Codex CLI or host account caches.
- Anthropic OAuth is documented as requiring Claude Max plus purchased extra/overage credits. Claude Pro is not supported for that OAuth path. `ANTHROPIC_API_KEY` remains a separate standard API-billing fallback.

Official Profiles documentation caveat:

- Native profile clone modes copy `.env` material, including config-only forms, and `--clone-all` copies API keys/secrets. Clones used for pods therefore share the original seat's credentials; reviewed learning covers only skills and memory text.

Official Bitwarden documentation findings:

- Hermes has native Bitwarden Secrets Manager integration using a machine-account token in `BWS_ACCESS_TOKEN` in the profile `.env`.
- Waypoint must not replace this with a bespoke secret broker.

## Docs discrepancy: gateways and profile supervision

The multi-profile gateways documentation describes a default multiplexed gateway that serves profiles, and warns that per-profile gateway start may refuse unless the profile is parked or explicitly opted out. Waypoint therefore runs one `hermes gateway run` for its home and does not start a gateway per seat.

## Runtime-tested in this repository

- Hermes v0.22.2 (stable) was installed natively on Windows 11 with the PowerShell installer. It uses a bundled Python 3.14 without a venv; `hermes --print-runtime-command` prints the interpreter and bootstrap Waypoint reuses for its helper scripts.
- The first command against a new `HERMES_HOME` installs that home's dependencies, which takes about a minute.
- With Waypoint's own `HERMES_HOME`: gateway start and stop, status, native auth status, skills inventory, kanban boards and tasks, seat hire (`hermes profile create`), and seat profile reads all worked.
- v0.22 ships no PyYAML; the `hermes_yaml` module is used instead. `hermes profile create` no longer writes `config.yaml`, so seats are detected by `config.yaml` or `profile.yaml`.
- git credential lookups for github.com reached only the Waypoint helper once inherited helpers were reset through `GIT_CONFIG_*` environment entries; Git Credential Manager was not consulted. The `gh` wrapper ran the real GitHub CLI.
- Hermes exposes native per-profile disabled skill state under `skills.disabled`. The service uses `hermes_cli.skills_config.get_disabled_skills` and `save_disabled_skills` with native `load_config`/`save_config` rather than raw YAML writes.
- Provider authentication readiness is derived from native `hermes auth status`, not browser-local toggles or raw `auth.json` substring checks.
- Service tests mock Hermes and make no model calls.

## Not yet verified

- A model turn on native Hermes (needs a provider login in the new home).
- macOS and Linux native installs.
- Native Bitwarden account setup.
