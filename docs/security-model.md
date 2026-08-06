# Security Model

Updated: 2026-08-06

OTelux receives and renders untrusted telemetry on a developer workstation. Its current network trust boundary is the local host, not an individual operating-system user: loopback listeners can be reachable by other local users or processes.

This document describes the current implementation and known gaps. Normative release requirements live in [spec.md](spec.md#security-requirements), the active local-runtime hardening decisions and execution gates live in [security-plan.md](security-plan.md), vulnerability reporting lives in [SECURITY.md](../SECURITY.md), and release work is tracked in [release-sprint.md](release-sprint.md).

## Assets

OTelux is designed to protect:

- Captured traces, logs, metrics, attributes, prompts, and identifiers.
- Local settings and future durable telemetry storage.
- The Electron main process and its filesystem and operating-system privileges.
- Release artifacts, signing credentials, dependency integrity, and update channels.
- Availability of the workbench under malformed or excessive local input.

## Trust Boundaries

### OTLP receiver

The desktop currently listens on `127.0.0.1:4319` by default. It accepts OTLP/HTTP JSON at `/v1/traces`, `/v1/logs`, and `/v1/metrics` without authentication.

Any local process or user that can reach the loopback interface can submit telemetry. Payloads must therefore be treated as untrusted input even when they originate from a local SDK.

### MCP server

The desktop starts an MCP HTTP listener on `127.0.0.1:4320` by default. MCP tools are read-only, but they can reveal sensitive telemetry to any client that connects, so HTTP access requires a per-install bearer token.

A random token is generated on first run and stored as `mcp-token` in the canonical OTelux data directory with owner-only permissions. Runtime ownership metadata (`runtime.json` and `runtime.lock`) is also owner-only and contains paths/endpoints but never the token value. Every JSON-RPC `POST` must send `Authorization: Bearer <token>`; a missing or wrong token is rejected with `401` before any tool runs. Configure your MCP client with the token from that file, or disable MCP in Settings when agent access is not needed. Because loopback is not user isolation, another process running as the same user can still read the token file — the token defends against unauthenticated local clients, not against a compromised local account.

### Runtime API

The on-demand daemon binds a separate control/query API on `127.0.0.1:4321` by default. It uses an independent random `runtime-token` stored owner-only in the canonical data directory; `runtime.json` publishes only the token path and API status. JSON-RPC and SSE require `Authorization: Bearer <token>`, reject browser `Origin`, validate `Host`, bound bodies/encoded responses/aggregate batch work/client counts, disconnect slow SSE clients, and expose generic internal errors. The HTTP adapter refuses non-loopback or decorated origins and disables redirects before sending credentials. Health is the only unauthenticated route. Loopback plus a token does not defend against a compromised process running as the same OS user.

### Electron renderer

Telemetry is rendered in a Chromium renderer. The current desktop enables:

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`
- A Content Security Policy that loads bundled content only
- A narrow context bridge instead of exposing raw `ipcRenderer`
- Denied top-frame navigation away from the app's own URL
- New windows denied; external links opened in the system browser only when they are explicit HTTPS destinations
- All renderer permission requests and checks denied, and `<webview>` attachment refused
- Development-only DevTools shortcuts

The renderer is still an untrusted boundary. Renderer invoke messages are decoded into a bounded sanitized union before dispatch, and runtime events are validated in Electron main before broadcast through the context bridge.

### External clients

MCP, LM, browser, clipboard, download, and future export clients operate outside OTelux. Once a user sends data to one of those clients, that client's security and privacy controls apply.

## Current Safeguards

- Desktop OTLP, MCP, and Runtime API listeners bind to loopback and validate the exact effective Host authority.
- OTLP, MCP, and Runtime API use distinct default ports.
- OTLP and MCP request bodies are bounded before parsing; oversized requests return `413`.
- `POST` listeners require an `application/json` content type (`415` otherwise) and reject requests from non-allowlisted browser origins (`403`).
- MCP and Runtime API HTTP use separate per-install bearer tokens; requests without the corresponding valid header return `401` before tool/query dispatch.
- Failed listener changes roll back to the previous healthy listener, including when the subsequent settings-file write fails; stale settings revisions fail before listener mutation.
- Runtime RPC and Electron IPC requests/results use method-specific bounded decoders, checked schemas, compatibility fixtures, and direct/HTTP/IPC parity coverage.
- Settings writes use an owner-only temporary file and rename to avoid partial JSON; POSIX SQLite database/WAL/SHM files are tightened to owner-only permissions for default and custom paths.
- The app uses a single-instance lock to avoid duplicate desktop listeners.
- The Electron renderer is sandboxed and isolated from Node.js.
- The renderer cannot navigate away from the app, open new windows, attach a `<webview>`, or obtain device permissions; external links open in the system browser only for HTTPS URLs.
- Packaged builds do not expose the development DevTools accelerator.
- Workflow tokens default to read-only.
- Repository workflows use immutable action SHAs, and repository policy permits only GitHub-owned actions with SHA pinning required.
- Gitleaks and TruffleHog full-history scans found no secrets as of 2026-07-14.

## Known Pre-Release Gaps

The current source build is not a supported security release. Known release blockers include:

- The daemon is packaged and started on demand but is not OS-service registered; explicit user-facing stop/restart, crash recovery, upgrade/rollback, and token-rotation lifecycle is not implemented.
- Browser session bootstrap, scoped read/control capabilities, CSRF protection, and session revocation are not shipped; browser origins therefore remain rejected by Runtime API.
- CodeQL is configured but intentionally skipped while this repository remains private on a plan without code-scanning support.
- Branch protection, required checks, secret scanning, push protection, and private vulnerability reporting cannot be fully enabled until repository visibility or account capabilities change.

The [release sprint](release-sprint.md#milestone-2---runtime-and-supply-chain-security) blocks supported artifacts on these issues.

## Threats In Scope

- Malformed or oversized OTLP and MCP requests causing crashes, hangs, memory exhaustion, or corruption.
- Telemetry content escaping into script, markup, file, URL, or shell execution contexts.
- A compromised renderer reaching Electron or Node.js privileges through preload or IPC.
- Unauthorized local MCP queries disclosing captured telemetry.
- Navigation, permission, or external-link handling that opens unintended resources.
- Dependency, workflow, build, signing, provenance, installer, or update compromise.
- Secrets or personal data entering source history, fixtures, logs, or artifacts.

## Security Non-Goals

OTelux cannot protect telemetry from:

- A fully compromised operating-system account running the app.
- A privileged administrator or malware that can read process memory or user files.
- An external MCP or LM client after the user grants it access.
- Sensitive values intentionally copied, downloaded, or exported by the user.

Loopback binding is defense in depth, not authentication against other local users or processes.

## Reporting

Do not report vulnerabilities in public issues. Follow [SECURITY.md](../SECURITY.md). Public launch remains blocked until GitHub private vulnerability reporting is enabled and exercised and the policy links to the working confidential form.
