# OTelux Platform-Specific Security Plan

Updated: 2026-08-05

Status: Deferred until native Windows/macOS release work resumes

This document owns security work that cannot be honestly validated on the current Linux development host. The cross-platform local-runtime security plan remains in [security-plan.md](security-plan.md).

## Windows

- Enforce owner-only DACLs for the canonical data directory, SQLite database/WAL/SHM, settings, runtime state/lock, and token files.
- Restrict access to the current user SID and required system principals; do not rely on POSIX mode arguments.
- Define safe behavior for custom database paths and inherited ACLs.
- Avoid locale-dependent parsing and avoid invoking ACL tools on every telemetry write.
- Verify named-pipe DACLs before moving privileged daemon control from loopback HTTP.
- Validate NSIS install/uninstall ownership, inherited permissions, and data retention/removal behavior.
- Run native tests that inspect effective ACLs plus packaged install/smoke/uninstall checks.
- Configure and verify Authenticode signing and timestamping before advertising Windows support.

## macOS

- Verify owner-only modes and custom-path behavior on APFS, including SQLite WAL/SHM sidecars.
- Review application sandbox, hardened-runtime, entitlements, Keychain token storage, and Unix-domain-socket permissions for the daemon design.
- Validate quarantine, Gatekeeper, notarization, stapling, install/upgrade/uninstall, and retained-data behavior.
- Run native packaged tests on arm64 and x64.
- Configure Developer ID signing before advertising macOS support.

## Re-entry Gate

Resume this plan only when Windows or macOS moves from unsigned preview to an advertised supported platform. Native runner evidence is mandatory; Linux simulation is not sufficient.
