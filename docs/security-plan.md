# OTelux Local Runtime Security Plan

Updated: 2026-08-05

Status: Active pre-daemon hardening plan

This document records the security decisions and remaining work for OTelux's local listeners, storage, browser workbench, and future daemon. It complements the descriptive [security model](security-model.md), normative [security requirements](spec.md#security-requirements), communication contract in [protocol.md](protocol.md), and execution order in [plan.md](plan.md).

The central product constraint is:

> Keep local OTLP setup simple while authenticating every surface that can read telemetry or mutate OTelux state.

## Current Boundary

OTelux currently binds three IPv4 loopback listeners:

| Listener | Default | Capability | Current guard |
|---|---:|---|---|
| OTLP/HTTP | `127.0.0.1:4319` | Write traces, logs, and metrics | Loopback, browser-Origin rejection, content-type validation, request/queue limits; no credential |
| MCP HTTP | `127.0.0.1:4320` | Read sensitive telemetry through tools | Independent per-install bearer token, browser-Origin rejection, body limits |
| Runtime API | `127.0.0.1:4321` | Read telemetry and mutate settings/data | Independent per-install bearer token, exact Host validation, browser-Origin rejection, bounded requests/responses/batches/SSE clients |

All telemetry is untrusted input. Loopback prevents direct LAN access but is not an operating-system user boundary. A process running as the same user can read owner files and is outside OTelux's protection goal. Another local user or process that can reach loopback can currently submit OTLP data but cannot read stored telemetry without an MCP or Runtime credential.

## Decision: Keep Default OTLP Ingest Unauthenticated

OTLP ingest remains unauthenticated by default while it is bound exclusively to loopback.

Rationale:

- OTLP is a write-only surface; it does not disclose stored telemetry.
- Requiring headers would complicate every language SDK, Collector, agent, and manual setup guide.
- OTelux does not yet control all exporter configuration, unlike an orchestrator that can inject credentials automatically.
- Browser-origin rejection, content-type checks, body limits, bounded export concurrency, retention, and loopback binding constrain the practical attack surface.
- Jaeger, OpenTelemetry Collector, and self-hosted observability stacks commonly rely on trusted-local/private-network placement for ingest while protecting read/admin surfaces separately.

Accepted local-development risk:

- Another local process can inject misleading telemetry.
- A local sender can consume bounded CPU, queue, and retention capacity.
- Agent conclusions can be poisoned by data submitted to the local receiver.

This tradeoff must stay visible in Settings and documentation. OTelux must not describe unauthenticated ingest as authenticated or user-isolated.

## Aspire Comparison

The comparison was performed against `microsoft/aspire` main at commit `7c77e4e93` on 2026-08-05.

Aspire separates its surfaces:

- Dashboard frontend: browser-token authentication by default.
- Dashboard telemetry/query API: API key by default.
- OTLP: supports API key, client certificate, and unsecured modes.
- Anonymous operation: explicit opt-in through `--allow-anonymous` or `ASPIRE_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true`.

In normal AppHost execution Aspire avoids setup friction by owning both sides:

1. It generates an OTLP API key.
2. It stores the key in .NET user secrets.
3. It configures the Dashboard OTLP endpoint to require the key.
4. It injects `OTEL_EXPORTER_OTLP_HEADERS=x-otlp-api-key=<key>` into managed resources.

Relevant Aspire implementation:

- `src/Aspire.Hosting/DistributedApplicationBuilder.cs` generates the key for secured AppHost runs.
- `src/Aspire.Hosting/Dashboard/DashboardEventHandlers.cs` configures Dashboard OTLP `ApiKey` or `Unsecured` mode.
- `src/Aspire.Hosting/OtlpConfigurationExtensions.cs` injects exporter headers.
- `src/Aspire.Dashboard/Authentication/OtlpApiKey/OtlpApiKeyAuthenticationHandler.cs` validates `x-otlp-api-key`.
- `src/Aspire.Dashboard/Configuration/PostConfigureDashboardOptions.cs` defaults standalone OTLP to `Unsecured` unless a host supplies stronger configuration.

Conclusion for OTelux: adopt Aspire's separation of ingest, frontend, and control credentials, but do not require a default OTLP token until OTelux can configure supported exporters automatically without degrading first-run UX.

## Immediate Security Work

### 1. Owner-only database and sidecar permissions

Priority: high; no UX cost.

Observed Linux state:

```text
700 ~/.local/share/otelux
644 ~/.local/share/otelux/otelux.db
644 ~/.local/share/otelux/otelux.db-wal
600 ~/.local/share/otelux/mcp-token
600 ~/.local/share/otelux/runtime-token
```

The canonical `0700` directory protects the default database. A custom database under a permissive directory could expose telemetry because SQLite files and sidecars are currently `0644`.

Required changes:

- Set a restrictive `umask(0077)` before creating runtime-owned files on POSIX systems.
- Create or tighten database, WAL, SHM, settings, runtime state, lock, and token files to owner-only permissions.
- Re-apply safe permissions after opening SQLite and after sidecars appear.
- Tighten existing files during upgrade without changing contents.
- Inspect custom database parent permissions.
- Warn or reject when a custom path cannot provide the documented privacy boundary.
- Test Linux and macOS modes.
- Keep native Windows/macOS permission and signing work in [platform-security-plan.md](platform-security-plan.md); it is deferred until those platforms become supported.

Acceptance:

- Default and custom database files/sidecars are inaccessible to other users.
- Migration is idempotent and does not quarantine or replace a healthy database.
- Permission failure is visible and does not silently claim protection.

### 2. Exact Host validation for OTLP and MCP

Priority: high; no exporter configuration cost.

Runtime API already validates Host. Apply the same policy to OTLP and MCP:

- Accept the exact effective `127.0.0.1:<port>` authority.
- Accept `localhost:<port>` only when intentionally supported.
- Reject unrelated, malformed, missing, or decorated authorities.
- Ignore `X-Forwarded-Host`; these listeners are not behind trusted proxies.
- Keep browser Origin rejection and exact allowlists.
- Add DNS-rebinding, alternate-port, alternate-scheme, and hostile-host tests.

Acceptance:

- Host and Origin policies run before request bodies and dispatch.
- Rejected requests ingest nothing and invoke no MCP tool.
- Normal OTel SDKs, Collectors, CLI clients, and the MCP bridge continue working unchanged.

### 3. Make the trust posture visible

Priority: medium.

Settings → Connections should report:

```text
OTLP ingest
Access: local write-only
Authentication: none
Bound to: 127.0.0.1
Browser origins: blocked
```

Documentation should explain that local processes can inject telemetry and that captured data must not be treated as cryptographically authentic evidence.

## Optional Secure-Ingest Mode

Add later, without changing the local default:

```text
OTLP ingest authentication
- Local unsecured (default, loopback only)
- Require write token
```

Requirements:

- Use a dedicated ingest token, never the MCP or Runtime token.
- Support primary/secondary keys for rotation if long-lived integrations require it.
- Configure supported agents and SDKs automatically using `OTEL_EXPORTER_OTLP_HEADERS` or host-specific equivalents.
- Display exact proposed configuration changes and require approval.
- Never put the token in URLs, screenshots, logs, runtime state, model prompts, or repository files.
- Require authenticated or mutually authenticated ingest before any future non-loopback binding.
- Do not ship a LAN mode until its authentication, TLS, discovery, firewall, and threat model are separately reviewed.

Revisit the default only when OTelux can provide Aspire-like automatic credential injection for the supported exporter matrix.

## Read And Control Surfaces

### MCP

Keep MCP authenticated by default because tool results can disclose prompts, SQL, headers, URLs, identifiers, paths, and business data.

Remaining work:

- Add explicit token rotation/revocation.
- Show redacted token fingerprints in diagnostics.
- Preserve authentication-before-body-read behavior.
- Add bounded request concurrency/rate controls if dogfood demonstrates saturation risk.
- Keep direct model access read-only unless a future mutation tool has a separate approval and capability model.

### Runtime API

Keep the Runtime API on an independent control token. It can query telemetry, change settings, load sample data, and clear stored data.

Before daemon-client conversion:

- Complete method-specific response validation.
- Complete shared direct/HTTP/IPC parity.
- Add settings revision/CAS conflicts so stale clients cannot overwrite newer state.
- Separate read and control scopes before browser or third-party clients use the API.
- Add token rotation tied to runtime upgrade/repair without exposing values in runtime state.

## Browser Workbench

The long-lived Runtime token must never enter browser JavaScript, storage, query strings, fragments, screenshots, or model context.

Required design:

1. `otelux open` creates a short-lived, one-time bootstrap nonce.
2. The browser exchanges the nonce on the loopback origin.
3. The runtime sets an `HttpOnly`, `SameSite=Strict` session cookie (`Secure` when applicable).
4. The bootstrap immediately redirects to a clean URL.
5. Mutating requests require CSRF protection and control scope.
6. Sessions expire, are bound to one runtime instance, and become invalid after restart/rotation.
7. Browser Origin and Host remain exact.
8. Static workbench assets and API share one reviewed origin.

This is a hard blocker for the runtime-served browser workbench.

## Future Daemon Transport

Preferred target:

```text
Desktop/CLI privileged control -> owner-only Unix socket or Windows named pipe
Browser workbench             -> scoped loopback HTTP session
MCP                            -> separate read token / stdio bridge
OTLP                           -> loopback write-only endpoint; optional write token
```

OS IPC gives real per-user access control that TCP loopback cannot provide:

- Linux/macOS: Unix domain socket with owner-only permissions.
- Windows: named pipe with a DACL restricted to the current user.

Loopback HTTP remains appropriate where browser compatibility is required. Do not introduce OS IPC as a second runtime implementation; it is a transport over the same method registry and owner.

## Resource And Parsing Limits

Retain and expand current limits:

- OTLP body limit and content-type enforcement.
- Per-signal pending-export limits with visible overload counters.
- Runtime body, response, batch, concurrency, deadline, and SSE client/frame limits.
- MCP body and result limits.
- Durable age/size retention.
- Cursor-paged metric history and bounded chart projection.
- Method-specific result validation and SQL statement/query-plan budgets.

Add production-shaped security tests for:

- Sustained unauthorized/local ingest.
- Queue exhaustion and recovery.
- Large compressed/protobuf payload expansion.
- Large telemetry attributes and deeply nested wire values.
- Retention during active queries.
- Slow clients and aborted requests.
- Repeated authentication failures without secret-dependent timing or unbounded logs.

## Data At Rest

OTelux does not currently encrypt its SQLite database. This is acceptable for a local developer tool when files are owner-only and the operating system account/disk encryption is trusted.

Database encryption is not an immediate goal because it would introduce key storage, recovery, migration, performance, and cross-platform packaging complexity without protecting against a compromised logged-in account.

Document that OTelux cannot protect telemetry from:

- A compromised current user account.
- Administrator/root access.
- Malware reading process memory.
- Explicit MCP/LM clients after authorization.
- User-driven copy/export actions.

## Prioritized Execution

### Security patch before further daemon work

- [x] Enforce owner-only database, WAL/SHM sidecar, and settings permissions on POSIX default/custom paths.
- [x] Add exact Host validation to OTLP and MCP runtime listeners.
- [x] Add focused POSIX permission and hostile-Host/DNS-rebinding tests.
- [ ] Reconcile `security-model.md`, `privacy.md`, `spec.md`, and `test.md` with the verified behavior.
- [x] Add visible local-write trust wording in Settings without adding default OTLP credential configuration.

### Existing bounded-RPC sprint

- [x] Lightweight log list and selected details.
- [x] Metric metadata/history split and hardening.
- [ ] Method-specific response validation and direct/HTTP/IPC parity.
- [ ] Settings revision/CAS.
- [ ] Production-shaped final gates.

### Before browser workbench

- [ ] One-time browser bootstrap.
- [ ] Scoped, expiring HttpOnly sessions.
- [ ] CSRF protection for mutations.
- [ ] Separate read and control capabilities.
- [ ] Session/token rotation and revocation.

### Before non-loopback or multi-user support

- [ ] Dedicated OTLP write authentication or mTLS.
- [ ] TLS and certificate lifecycle.
- [ ] Explicit listen-address configuration and strong warning UX.
- [ ] Firewall/discovery guidance.
- [ ] Multi-user ownership and data-directory semantics.
- [ ] Cross-platform OS credential/ACL verification.

## Go/No-Go Rules

- Default loopback-only OTLP without a credential: **GO**, with documented local-injection risk and enforced limits.
- MCP or Runtime read/control without authentication: **NO-GO**.
- Browser receiving the long-lived Runtime token: **NO-GO**.
- Custom database path without owner-only privacy enforcement or an explicit warning: **NO-GO for stable release**.
- Any non-loopback listener without reviewed authentication and TLS: **NO-GO**.
- Daemon-client conversion without method-result validation, settings CAS, compatibility handling, and rollback: **NO-GO**.

## Verification Checklist

For every security-boundary change:

- [ ] Routine lint, typecheck, test, and build pass.
- [ ] Hostile Host and Origin requests fail before body parsing/dispatch.
- [ ] Missing/wrong credentials reveal no telemetry or control result.
- [ ] Token files and runtime state never expose token values.
- [ ] Default and custom data files have verified owner-only permissions.
- [ ] Packaged Linux x64/arm64 smoke passes.
- [ ] Native platform requirements are completed when a platform enters supported-release scope; see [platform-security-plan.md](platform-security-plan.md).
- [ ] Deskpal verifies visible trust/status and recovery UX.
- [ ] Documentation describes observed behavior rather than intended configuration.
