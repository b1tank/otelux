# Security Model

Updated: 2026-07-14

OTelux receives and renders untrusted telemetry on a developer workstation. Its current network trust boundary is the local host, not an individual operating-system user: loopback listeners can be reachable by other local users or processes.

This document describes the current implementation and known gaps. Normative release requirements live in [spec.md](spec.md#security-requirements), vulnerability reporting lives in [SECURITY.md](../SECURITY.md), and implementation work is tracked in [release-sprint.md](release-sprint.md).

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

The desktop currently starts an unauthenticated MCP HTTP listener on `127.0.0.1:4320` by default. MCP tools are read-only, but they can reveal sensitive telemetry to any local client that can connect.

Disable MCP in Settings when it is not needed, especially on a shared or multi-user host. A supported stable release requires explicit enablement or a per-install credential before returning tool results.

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

The renderer is still an untrusted boundary. The remaining stable-release gap is runtime validation of IPC messages crossing the context bridge.

### External clients

MCP, LM, browser, clipboard, download, and future export clients operate outside OTelux. Once a user sends data to one of those clients, that client's security and privacy controls apply.

## Current Safeguards

- Desktop OTLP and MCP listeners bind to loopback.
- OTLP and MCP must use different ports.
- Failed listener changes roll back to the previous healthy listener before settings are committed.
- Settings writes use a temporary file and rename to avoid partial JSON.
- The app uses a single-instance lock to avoid duplicate desktop listeners.
- The Electron renderer is sandboxed and isolated from Node.js.
- The renderer cannot navigate away from the app, open new windows, attach a `<webview>`, or obtain device permissions; external links open in the system browser only for HTTPS URLs.
- Packaged builds do not expose the development DevTools accelerator.
- Workflow tokens default to read-only.
- Repository workflows use immutable action SHAs, and repository policy permits only GitHub-owned actions with SHA pinning required.
- Gitleaks and TruffleHog full-history scans found no secrets as of 2026-07-14.

## Known Pre-Release Gaps

The current source build is not a supported security release. Known release blockers include:

- Electron, Hono, and build dependencies have known advisories and require coordinated upgrades.
- OTLP and MCP request bodies are not yet bounded before parsing.
- Content types and browser origins are not yet enforced according to the stable security requirements.
- MCP is enabled by default and has no credential.
- IPC relies on TypeScript shapes rather than complete runtime validation.
- External URL and permission policies need explicit allowlists.
- A successful listener rebind is not fully rolled back if the subsequent settings-file write fails.
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
