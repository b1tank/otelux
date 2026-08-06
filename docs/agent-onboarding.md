# CLI And Agent Onboarding Plan

## Goal

Make OTelux useful within five minutes of installation. Desktop and a terminal CLI must discover one per-user runtime and SQLite database, explain the exact local endpoints, and safely connect supported coding agents without requiring users to hand-edit JSON, JSONC, or TOML.

The design takes the useful idea from Absurd's `absurdctl install-skill`—a small, inspectable CLI installs a bundled agent playbook—but extends it for OTelux's multi-host needs: capability detection, MCP registration, telemetry configuration, native plugin/extension installation where officially supported, transactional changes, verification, and an equivalent Desktop UI.

## Current baseline

Persistence is already production behavior, not a future item:

- Desktop starts or reconnects to the packaged on-demand `@otelux/local-runtime` daemon through Runtime HTTP/SSE.
- `@otelux/engine-node` stores traces, logs, metrics, interned resources/scopes, rollups, and facets in Node's SQLite implementation.
- The canonical Linux database is `${XDG_DATA_HOME:-$HOME/.local/share}/otelux/otelux.db` unless the user configures another absolute path.
- SQLite uses WAL, forward-only migrations through schema v5, corruption/newer-version quarantine, bounded retention, and a dedicated bounded worker. The in-memory backend remains for tests and small embedded uses only.

The current Claude, Codex, and Pi plugin is a Desktop companion. It connects through the authenticated local MCP bridge and does not yet own a standalone runtime. Copilot CLI and OpenCode are not yet supported OTelux integration targets.

## Product decisions

1. **Extract the daemon before promising a standalone CLI.** Desktop, CLI, plugins, and direct MCP must never become competing receiver/database owners.
2. **One integration engine, two front ends.** `oteluxctl agents ...` and Settings → Agents call the same typed package; the UI never shells out to the CLI and neither front end forks configuration logic.
3. **Capabilities, not vendor assumptions.** Each adapter advertises what the detected host/version officially supports: MCP, skills, plugin, extension, telemetry environment/configuration, and verification. Unsupported controls stay absent rather than pretending every agent has the same model.
4. **Separate analysis integration from telemetry capture.** Installing OTelux MCP/skills is distinct from configuring an agent to export telemetry. Sensitive prompt/response/tool content remains opt-in and visibly explained.
5. **Preview before mutation.** Every configuration change has a dry-run plan showing paths, operations, values with secrets redacted, restart requirements, and rollback ownership.
6. **No privilege escalation by default.** User-agent configuration stays in user/project scope. System PATH/package installation uses the platform installer or a separately approved action.
7. **Idempotent and reversible.** Re-running install repairs only OTelux-owned state. Remove restores or deletes only entries OTelux created and preserves unrelated user configuration.
8. **No downloaded code during activation.** Desktop, CLI, daemon, launcher, schemas, skills, and host manifests ship prebuilt in immutable release artifacts.

## Runtime and package sequence

The implementation order is architectural, not cosmetic:

1. Finish runtime IPC/HTTP/MCP validation, checked-in wire schemas, and compatibility fixtures.
2. Run `@otelux/local-runtime` in one per-user `oteluxd` process with owner-only lock/state/token files.
3. Add authenticated loopback Runtime RPC plus SSE invalidations and the HTTP/SSE `DataSource` adapter.
4. Convert Desktop into a client of the daemon; closing Desktop must not stop ingest, while explicit runtime stop remains available through CLI.
5. Add `apps/cli` as a thin control/API client.
6. Add `@otelux/agent-integrations` as the shared detector/planner/applier/verifier package.
7. Add Settings → Agents and first-run onboarding over that package.
8. Make direct MCP and agent packages ensure/discover the daemon without requiring Desktop.

## CLI contract

The initial CLI is `oteluxctl`; the Desktop product/executable keeps the established `otelux` name. The implemented subset is `start`, `stop`, `restart`, `status`, `endpoints`, schema-defined `config get/set`, and permission/version/storage/listener `doctor`, with stable JSON and exit codes. The remaining commands below are the target contract, not current behavior.

```text
oteluxctl serve                # foreground runtime for headless use/diagnostics
oteluxctl start [--background]
oteluxctl stop
oteluxctl restart
oteluxctl status [--json]
oteluxctl open                 # open/focus the browser workbench
oteluxctl desktop              # open/focus the native Desktop client
oteluxctl endpoints [--json]
oteluxctl doctor [--json]
oteluxctl config get <key>
oteluxctl config set <key> <value>

oteluxctl agents list [--json]
oteluxctl agents inspect <agent> [--json]
oteluxctl agents install <agent> [--scope user|project] [--capability <name>] [--dry-run]
oteluxctl agents remove <agent> [--scope user|project] [--dry-run]
oteluxctl agents repair <agent> [--dry-run]
oteluxctl agents verify <agent> [--json]
oteluxctl agents show-config <agent>
```

Implementations reject unknown commands with a useful suggestion rather than guessing.

Command requirements:

- `start` is idempotent and discovers an already compatible runtime.
- `status` reports daemon version/protocol, PID, data/database paths, migration state, OTLP/MCP/workbench endpoints, receiver drops, and storage/retention pressure without exposing bearer tokens.
- `open` uses the one-time browser bootstrap flow; tokens never appear in URLs.
- `doctor` checks ownership/permissions, database health, ports, runtime compatibility, package version, agent configuration, and actionable restart requirements.
- Mutating commands show a plan and prompt unless `--yes` is supplied in an interactive trusted context. `--dry-run` never writes.
- `config set` accepts only schema-defined keys and validates the complete candidate settings object before an atomic write/restart plan.
- `agents install` never silently enables sensitive content capture.
- Exit codes distinguish healthy, not running, invalid input, conflict, partial integration, verification failure, and internal failure.

## Desktop packaging and command names

The CLI should be installed with Desktop while remaining independently packageable later.

### Linux

- [x] Keep the desktop entry and GUI executable as `otelux`; bundle the version-matched CLI as private `resources/bin/oteluxctl` in unpacked, `.deb`, and AppImage layouts. PATH installation remains deferred until the command contract is stable.
- `.deb` may register a user service only after lifecycle/upgrade behavior is defined; AppImage exposes `--cli`/portable entry points but does not mutate PATH automatically.

### macOS

- Bundle the GUI as `OTelux.app`, with CLI under `Contents/Resources/bin/oteluxctl`.
- A signed Homebrew Cask can expose that bundled binary through its `binary` stanza.
- A Desktop “Install shell command” action must preview the symlink target and request authorization through a normal OS mechanism; it must never collect a password itself.

### Windows

- Keep the established GUI executable as `otelux.exe`; use `oteluxctl.exe` for the CLI so Windows case-insensitivity cannot create a name collision.
- Install `oteluxctl.exe` as the CLI and optionally add its directory to the current user's PATH through an explicit installer choice.
- Uninstall removes only OTelux's PATH entry and packaged files, not the retained telemetry directory unless the user separately confirms data deletion.

The daemon, Desktop, CLI, and integration payload carry one release version and negotiate a runtime protocol version before connecting.

## Shared agent integration model

`@otelux/agent-integrations` owns adapters and exposes no raw shell strings to the renderer.

```text
AgentAdapter
  id / displayName / documentation URL
  detect() -> installations and versions
  inspect() -> scopes, paths, owned state, capabilities, restart state
  planInstall(request) -> ordered typed file/process operations
  planRemove(request) -> owned rollback operations
  apply(plan) -> atomic result plus backup references
  verify() -> MCP, skill/plugin, and telemetry checks
```

Every adapter reports these capability states independently:

- host detected;
- MCP registration supported/configured/verified;
- skill installation supported/configured/verified;
- native plugin or extension supported/configured/verified;
- OTel traces/logs/metrics configuration supported/configured/verified;
- sensitive content capture available and current opt-in state;
- restart required;
- configuration conflict or unsupported host version.

Initial target adapters:

| Agent | Initial target | Notes |
| --- | --- | --- |
| Claude Code | MCP + shared skills/plugin + telemetry setup | Preserve unrelated settings and project/user scope. |
| Codex CLI | MCP + shared skills/plugin + telemetry setup | Preserve native multi-component service identity. |
| Pi | Native thin extension + shared skills + telemetry extension setup | Reuse the MCP implementation; do not fork analysis behavior. |
| GitHub Copilot CLI | MCP/skills/telemetry only where the detected official version supports them | This target is Copilot CLI, not automatic mutation of VS Code's extension internals. |
| OpenCode | MCP/skills/telemetry only where the official installed build supports them | Keep the official build; do not depend on the reference metrics fork. |

Before implementing an adapter, pin supported host versions and verify current official configuration schemas/documentation. Paths in the UI come from adapter inspection, not marketing assumptions.

## Safe configuration mutation

- Parse the host's real format, including JSONC or TOML where applicable; do not round-trip through plain JSON and destroy comments.
- Reject symlinks, unexpected ownership, world-writable parents, and paths outside the selected user/project scope unless explicitly supported.
- Acquire a scoped lock, re-read before commit, write a same-directory temporary file with restrictive permissions, fsync where available, and atomically rename.
- Create a bounded timestamped backup before the first OTelux mutation and record an ownership manifest containing hashes of OTelux-created entries—not secrets or whole private configurations.
- Detect concurrent edits and abort with a new diff rather than overwriting them.
- Spawn official host commands with argument arrays, never interpolated shell text.
- Redact tokens, prompts, API keys, headers, and captured telemetry from plans, diagnostics, logs, and UI.
- `show-config` displays OTelux-owned effective values and exact paths, with secret values replaced by their source/path and permission status.
- Removal uses ownership markers and structural matching. It never restores a stale full-file backup over newer unrelated edits.

## Settings → Agents

Add a first-class **Agents** category to Settings. It is a client of `@otelux/agent-integrations` through runtime-validated IPC/RPC.

Each agent card shows:

- name and legally usable icon/mark;
- detected/not detected and version;
- user/project installations;
- MCP, skills, plugin/extension, and telemetry capability chips;
- configured, verification failed, conflict, update available, or restart required state;
- primary Install/Verify/Repair/Remove action;
- secondary View plan, Open containing folder, Copy redacted config, and Documentation actions.

Opening a card shows:

- every inspected configuration path;
- effective OTelux endpoint/service identity and content-capture policy;
- exact proposed diff/operation list before Apply;
- backup/rollback information;
- a verification timeline: host discovered → integration loaded → MCP handshake → telemetry received;
- restart instructions with a “Verify after restart” continuation.

Do not copy third-party logos without checking their trademark and asset licenses. A neutral agent glyph plus name is acceptable until an approved mark is available; accessibility names never depend on the image.

## First-run onboarding

The onboarding flow is resumable, skippable, and available later from Help/Settings.

1. **Local-first promise** — database path, loopback listeners, retention defaults, and sensitive telemetry warning.
2. **Runtime health** — show effective OTLP/MCP/workbench endpoints and resolve port conflicts.
3. **Try sample data** — optional deterministic seed so value is visible before configuration.
4. **Detect agents** — show only found hosts first, with “show all” for planned setup.
5. **Choose integration** — analysis tools/skills, telemetry export, and sensitive-content choices are separate checkboxes.
6. **Preview changes** — paths, exact non-secret values, backups, restart requirements, and rollback.
7. **Apply** — transactional progress with no success claim until verification.
8. **Restart and verify** — host-specific instructions, then confirm MCP and at least one expected telemetry signal.
9. **Finish** — open the workbench on received telemetry and link to Doctor/troubleshooting.

A failed or skipped agent setup never blocks use of Desktop or sample data.

## Essential launch features around this work

### Required for the first supported public Desktop release

- Signed/notarized macOS and signed Windows installers plus the qualified Linux matrix.
- One per-user daemon and versioned authenticated Runtime API before standalone CLI/plugin claims.
- CLI lifecycle/status/open/doctor and safe agent inspect/install/remove/verify commands.
- Desktop Agents settings and onboarding over the same engine.
- At least Claude, Codex, and Pi end-to-end; Copilot CLI/OpenCode may ship as capability-limited beta adapters if clearly labelled and verified against pinned versions.
- Runtime IPC/HTTP/MCP schemas and validation, SQL statement/query-plan budgets, migration/upgrade tests, accessibility gates, and external beta evidence.
- Exportable redacted diagnostics, explicit data location/removal, database quick-check, and recovery guidance.
- Install/upgrade/uninstall/rollback and security-patch runbooks.

### Important but not launch blockers

- Automatic update; signed manual/package-manager updates are acceptable initially.
- OTLP/gRPC if supported agents can be configured for OTLP/HTTP.
- Windows arm64, RPM/Flatpak/Snap, service maps, profiles, and a hosted marketing site.
- Native plugin support for a host that already works safely through MCP + skills.

## Milestones

### M0 — contracts and daemon foundation

- [x] Runtime validation/schema snapshots and compatibility fixtures.
- [x] Authenticated Runtime RPC/SSE host, browser-safe HTTP adapter, direct/HTTP parity, and foreground `oteluxd` ownership/process lifecycle.
- [x] Compatibility-aware Node discovery/ensure, Desktop daemon-client conversion, explicit stop/restart, reconnect, stale-crash recovery, and port-conflict qualification.
- [x] Desktop passes its legacy source to the daemon, which claims exclusive ownership before migration; a competing starter performs no migration writes.
- Installed upgrade/rollback and uninstall-with-data-preserved are release qualification; optional OS-service registration remains later.

### M1 — CLI foundation (current)

- [x] Source-build lifecycle (`start`/`stop`/`restart`), status, endpoints, permission/version/storage/listener doctor, stable JSON, and distinct exit codes over the shared runtime client.
- [x] Desktop artifacts bundle a private CLI/daemon launcher; read-only `status`, `endpoints`, and `doctor` pass in unpacked, extracted `.deb`, and extracted AppImage layouts.
- [x] Release resolution and packaging metadata require Desktop/CLI/lockfile version parity.
- [ ] Prove the packaged CLI owns start/restart/stop in every qualified Linux layout.
- [x] Add schema-validated config get/preview/apply, complete-candidate validation, revision CAS, `--dry-run`, and explicit `--yes` mutation policy.
- [x] Expand doctor to owner-file permission, version compatibility, storage path/usage, and listener checks without exposing tokens. Database quick-check waits for a bounded Runtime RPC method.
- `open` waits for scoped browser-session bootstrap; `desktop`, public PATH installation, clean install/upgrade/uninstall, and standalone release packaging follow the control gate.

**M1 acceptance gate:** no M2 implementation starts until packaged CLI-owned lifecycle passes on Linux artifacts. Config conflict/dry-run/no-write behavior, owner-locked legacy migration, release-version parity enforcement, and the high-severity dev-tool `js-yaml` update are complete. GitHub-hosted CI/release publication is temporarily unavailable under the account's included-usage/$0 budget; local gates continue, with no paid-usage change assumed.

### M2 — integration engine

- Typed plans, atomic mutation, backups/ownership manifests, redaction, verification.
- Claude/Codex/Pi adapters and CLI commands.
- Adversarial path/concurrent-edit/partial-failure tests.

### M3 — Desktop onboarding

- Agents settings category and resumable onboarding.
- Shared plan/apply/verify results with CLI parity.
- Keyboard, focus, screen-reader, contrast, and error-recovery qualification.

### M4 — broader agent beta and public beta

- Pin and implement verified Copilot CLI and OpenCode capabilities.
- Publish signed `v0.2.0-beta.1`; recruit external testers across OS/agent combinations.
- Generate Homebrew Cask and Winget manifests from immutable signed release metadata.

### M5 — supported `v0.2.0`

- Resolve all P0/P1 issues and explicitly disposition P2s.
- Pass upgrade from current public releases, rollback rehearsal, security/release runbooks, and external beta gate.
- Publish as GitHub non-prerelease; update Homebrew/Winget and support matrix.

## Acceptance matrix

At minimum, CI plus manual release reports cover:

- Desktop-first, CLI-first, and plugin-first installation order;
- all supported agents installed individually and concurrently;
- user and project scopes without cross-scope overwrite;
- existing unrelated MCP servers/plugins/comments preserved;
- dry-run equality with applied operations;
- repeated install/repair/remove idempotency;
- concurrent config edit rejection and rollback after injected failure;
- sensitive capture off by default and exact opt-in behavior;
- restart-required continuation and post-restart MCP/telemetry verification;
- one daemon/database under simultaneous Desktop, CLI, and five agent sessions;
- package upgrade with existing SQLite schema/data/settings and agent ownership manifests;
- uninstall preserving data by default and separately confirmed complete data removal.
