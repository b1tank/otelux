# Security Policy

## Supported Versions

OTelux publishes Linux prereleases for early testing. During this stage, only the latest prerelease and current `main` receive security fixes.

| Version | Supported |
|---|---|
| Latest prerelease (`v0.1.9`) | Yes |
| Current `main` branch | Yes |
| Older prereleases, snapshots, and local builds | No |

This policy will be revisited for the first stable release.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability.

Report privately through **GitHub private vulnerability reporting**: open the repository's **Security** tab and choose **Report a vulnerability**. This opens a private security advisory visible only to you and the maintainer, and is the preferred channel.

> GitHub private vulnerability reporting is a public-repository feature, enabled for this project at the same time it is made public. While the repository is private, that button is not available; anyone who already has repository access should instead contact the maintainer through the private channel listed on their GitHub profile, and must not disclose vulnerability details in a public issue, discussion, or pull request.

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