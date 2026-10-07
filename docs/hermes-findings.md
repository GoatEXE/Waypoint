# Hermes pod runtime findings

This document separates official documentation findings from runtime-tested behavior.

## Docs-verified primary sources

Primary sources consulted/cited for runtime assumptions:

- Hermes Docker guide: <https://hermes-agent.nousresearch.com/docs/user-guide/docker>
- Hermes providers guide: <https://hermes-agent.nousresearch.com/docs/integrations/providers>
- Hermes Profiles guide: <https://hermes-agent.nousresearch.com/docs/user-guide/profiles>
- Hermes Bitwarden guide: <https://hermes-agent.nousresearch.com/docs/user-guide/secrets/bitwarden>
- Hermes Multi-profile gateways guide: <https://hermes-agent.nousresearch.com/docs/user-guide/multi-profile-gateways>

Official Docker documentation findings accepted for this slice:

- The official image uses an s6 supervision model where profiles can be treated as supervised services inside one container.
- The one-container/many-profile arrangement is supported and recommended for co-located profiles.
- Profile management examples include `docker exec <pod> hermes profile create coder` and `hermes -p coder gateway start`, `stop`, and `status`.
- If per-profile API servers are enabled, each profile needs a separate `API_SERVER_PORT` to avoid collisions.
- One dashboard can serve co-located profiles.
- `/opt/data` is the persisted data location for the container.
- Writable Hermes directories must not be shared between containers.

Official provider documentation findings accepted for this slice:

- `hermes auth add openai-codex --type oauth` supports native OpenAI Codex device-code login by default; the user opens a provider URL and enters a displayed code.
- `hermes auth add openai-codex --browser` exists in the CLI and uses browser authorization-code/PKCE on fixed `localhost:1455`, but Waypoint does not expose this path yet because no localhost:1455 bridge/tunnel is configured.
- Hermes stores its own provider auth in the Hermes home; Waypoint does not import Codex CLI or host account caches.
- Anthropic OAuth is documented as requiring Claude Max plus purchased extra/overage credits. Claude Pro is not supported for that OAuth path. `ANTHROPIC_API_KEY` remains a separate standard API-billing fallback.

Official Profiles documentation caveat accepted for this slice:

- Native profile clone modes are unsuitable as-is for credential-free baseline replication. The documented clone forms copy `.env` material, including config-only forms, and `--clone-all` copies API keys/secrets. Waypoint therefore uses an explicit reviewed-file allowlist and deliberately constructed config instead of native clone commands for pod template materialization. This does not prove baseline text is secret-free; review remains required.

Official Bitwarden documentation findings accepted for this slice:

- Hermes has native Bitwarden Secrets Manager integration.
- The intended pattern uses a machine-account token in `BWS_ACCESS_TOKEN` in the profile `.env`, with Bitwarden enabled and configured with project/server values.
- Startup resolves Bitwarden project secrets into runtime environment variables.
- Waypoint must not replace this with a bespoke secret broker.

## Docs discrepancy: gateways and profile supervision

The Docker guide examples describe profile-level gateway commands, but the current multi-profile gateways documentation describes a default multiplexed host gateway that can serve profiles. It also warns that per-profile gateway start behavior may refuse with an exit-78 style configuration error unless the profile is parked or explicitly opted out; standalone gateway modes are described as temporary shims or boundary escapes rather than the default target.

Waypoint therefore records seats as independent Hermes profiles but does not hard-code a separate gateway process per seat in this foundation. Prefer the native runtime supervision supplied by the official image.

## Runtime-tested in this repository

- Docker Engine availability was checked locally: Docker Desktop reports engine version `29.7.2` with Linux containers.
- Node.js availability was checked locally: Node `v22.19.0` and npm `10.9.3`.
- The official image was pulled and pinned locally: `nousresearch/hermes-agent@sha256:d4da4a40cd7a28aba983775d9fd31d94cbf153eeb0cb9e844d6d0f612b7c24db`.
- The image reports `Hermes Agent v0.21.5 (2026.9.24) · upstream 749220ef`.
- A labeled CEO container `waypoint-hermes-ceo` was started from the pinned image with durable Docker volume `waypoint-hermes-ceo-home` mounted at `/opt/data`.
- `/hermes/status` reports the CEO container running, image pinned, config available, and native provider statuses logged out until the user authenticates.
- The Settings model dropdown is sourced from the pinned runtime's native Hermes model catalogue code: `/opt/hermes/hermes_cli/models.py` (`provider_model_ids`, `get_default_model_for_provider`) and `/opt/hermes/hermes_cli/models_catalog_static.py` (`_PROVIDER_MODELS`). Provider API-mode hints are sourced from `/opt/hermes/hermes_cli/providers.py` (`HERMES_OVERLAYS`, `TRANSPORT_TO_API_MODE`). The service falls back to the verified curated entries from that pinned source when the account catalog is unavailable.
- Model settings were saved through Hermes config helpers and persisted across CEO container restart without overwriting unrelated config roots.
- CEO home seeding created delegation identity and a Waypoint bridge skill. Seeding writes `SOUL.md` only when missing/empty so user or learned CEO identity is not overwritten by settings/auth actions.
- The CEO container successfully reached the host service through the authenticated bridge at `host.docker.internal:<port>/bridge/tools`.
- A bad bridge token was rejected with 403.
- A container request to regular `/hermes/status` through `host.docker.internal` was rejected with 403; only the authenticated bridge endpoint is exposed to containers when the service binds `0.0.0.0` for Docker Desktop reachability.
- OpenAI Codex native auth initiation was exercised with a very short in-container timeout and no user authorization. Output parsing verified presence of the expected device URL shape and code shape without printing the URL/code. No surviving `hermes auth add openai-codex` process remained in the container after timeout.
- `hermes auth add --help` in the pinned image was verified to expose `--type {oauth,api-key,api_key}`, `--api-key`, `--no-browser`, Codex-specific `--browser`, and OAuth/network flags. Anthropic support is through the same provider argument surface plus documented provider behavior; no Anthropic account authorization was attempted.
- Service tests exercise planning, persistence, clone independence, task ownership, bridge auth/token persistence, provider input validation, login state handling, skill availability inventory/toggle validation, and lifecycle error handling without model calls.
- Hermes v0.21.5 exposes native per-profile disabled skill state under `skills.disabled` in the profile config. The service uses `hermes_cli.skills_config.get_disabled_skills` and `save_disabled_skills` with native `load_config`/`save_config` behavior rather than raw YAML writes. `hermes skills config` is interactive-only and is not used by the service.
- `tools.skills_tool._find_all_skills(skip_disabled=True)` returns installed skills without filtering disabled names; this is the runtime-neutral inventory basis for Paperclip-like availability controls.
- Architecture review found the existing loopback plus `Host` route check is spoofable from containers on Docker Desktop when the service is reachable from containers. Treat regular control routes as host UI guardrails only until the coordinated boundary fix lands; do not rely on them as container authentication.

## Implementation implications

- A pod template is a versioned credential-free baseline, not a live Hermes profile copy.
- Seat materialization copies only allowlisted baseline files into independent writable profile directories under each pod instance: `profiles/<seatId>`.
- Runtime plans include container-level commands and labels only. Pod start plans use Docker `bridge`, a Waypoint-owned named volume at `/opt/data`, no published ports, no host pod instance bind mount, no `docker.sock`, and no Waypoint bridge token. Shared-auth mode adds one separately labeled auth volume at `/opt/waypoint-auth`. Dry-run plans are not evidence of active Hermes execution.
- The lifecycle adapter may invoke Docker only when dry-run is disabled and only for containers and named volumes carrying matching Waypoint ownership labels. Container/volume names and host seed paths are derived from validated ids plus service configuration. Existing labeled containers are reused only after inspect verifies the configured pinned image, exactly the expected data and optional auth mounts, unprivileged/no-published-port/no-added-capability host config, and bridge-only networking. Unsafe, malformed, or old containers are refused. Labeled volumes with non-local drivers or bind-style options are refused. Seeding copies derived host `profiles/<seatId>` trees and fixes ownership before writing the marker.
- Provider authentication readiness is derived from native `hermes auth status`, not browser-local toggles or raw `auth.json` substring checks.

## Not yet verified

- A live Codex-authenticated builder seat completed one bounded task turn through the shared auth volume on 2026-10-06. Both the CEO and builder reported native Codex auth ready afterward; the requested one-file workspace output was verified. Anthropic and OpenAI API-key task turns remain untested live.
- Native Bitwarden account setup was not exercised; future work should use Hermes' documented Bitwarden integration rather than custom secret brokerage.
