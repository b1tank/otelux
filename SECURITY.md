# Security Policy

## Supported Versions

OTelux has not published its first supported release yet.

| Version | Supported |
|---|---|
| Current `main` branch | Yes |
| Older snapshots and local builds | No |

This table will be updated when `v0.1.0` is released. In general, only the latest supported release receives security fixes during the early project stages.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability.

This repository is currently private, and GitHub private vulnerability reporting cannot yet be enabled or exercised. Public launch is blocked until the repository is public, private vulnerability reporting is enabled and tested, and this section links to the working form. Until then, people who already have repository access should contact the repository owner through an existing trusted private channel without sending vulnerability details first.

Please include:

- Affected version, commit, platform, and installation method.
- Reproduction steps or a minimal proof of concept.
- Expected and observed security impact.
- Whether the issue exposes captured telemetry, escapes the Electron boundary, crosses the loopback trust boundary, or compromises release artifacts.
- Any mitigations you have already identified.

Do not include real credentials, customer telemetry, private prompts, or unrelated personal data. Use synthetic examples wherever possible.

The maintainer aims to acknowledge reports within three business days and provide an initial assessment within seven business days. Complex reports may take longer. We will coordinate disclosure and credit with the reporter, but may act sooner when users face active risk.

## Security Scope

Examples in scope include:

- Electron sandbox, preload, IPC, navigation, or permission boundary bypasses.
- Unauthorized access to the local OTLP or MCP listeners.
- Telemetry disclosure or unsolicited network egress.
- Malformed input causing code execution, persistent denial of service, or data corruption.
- Unsafe installer, update, signing, provenance, or dependency behavior.
- Secrets or private data committed to release artifacts or repository history.

Ordinary bugs, unsupported configurations, and feature requests belong in the issue tracker. OTelux does not currently operate a bug bounty program.