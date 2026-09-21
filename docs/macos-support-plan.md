# OTelux macOS Support Plan

Updated: 2026-09-21

Status: implementation in progress. The first build-input and packaged-CLI slices are implemented; native signing, lifecycle qualification, and support claims remain pending.

This plan turns the macOS findings from the September 15 local dogfood session into a release-quality workstream. macOS remains an unsigned preview target until the native gates below pass. Linux behavior and Linux release artifacts must not be inferred from macOS results, and macOS behavior must not be declared supported from a Linux CI runner.

## 1. What the dogfood session actually established

The junior-model session was useful as a diagnostic probe, but it mixed product fixes, checkout repair, local machine setup, and temporary experiments. Its evidence should be separated as follows.

### Valuable findings to retain

1. **The packaged macOS path can be exercised locally.** A locally built arm64 app opened far enough to render the workbench, and the packaged smoke eventually passed. This proves the codebase can be investigated on macOS; it does not prove release readiness.
2. **Generated icon assets are a packaging input.** `electron-builder.yml` copies `build/icon.png` and `build/icons/32x32.png` into `extraResources`, while the generated files are ignored. A clean checkout can therefore package without the assets unless an explicit generation step runs first. The missing tray icon caused startup failure in the session.
3. **The startup error is too broad for diagnosis.** A tray/resource failure surfaced as “could not connect to the local runtime.” The packaged app needs structured, actionable startup diagnostics and a regression test for each startup-failure class.
4. **The bundled CLI wrapper needs native-layout testing.** The session found that the macOS packaged layout differs from the Linux layout assumed by `apps/desktop/build/oteluxctl`. The wrapper must resolve paths from the actual macOS bundle and be tested from the packaged artifact, not only from the source tree.
5. **Runtime ownership and desktop adoption are testable separately.** The session demonstrated that the runtime can be started independently, that Desktop can adopt the existing instance, and that MCP can reach the shared runtime. This is an important acceptance scenario for the one-runtime architecture.
6. **A launchd service is a viable local experiment.** A per-user `LaunchAgent` can start the bundled runtime without opening the UI. This is evidence for a possible macOS runtime-service design, not a product implementation or release claim.
7. **The native environment exposed line-ending fragility.** A checkout contained CRLF worktree files while the committed blobs were LF; shell wrappers and scripts were affected. This must be reproduced and prevented with repository/CI checks rather than fixed ad hoc on a developer machine.

### Findings not to promote directly into product design

- A manually created `~/Library/LaunchAgents/com.otelux.runtime.plist` is not equivalent to supported app autostart. It bypasses installer ownership, upgrade/uninstall cleanup, permissions, version changes, and user settings.
- Running `ELECTRON_RUN_AS_NODE=1` against a bundled Electron binary is a useful diagnostic fallback, but should not become an undocumented second launcher. The shipped launcher must have one tested ownership and versioning contract.
- Installing an unsigned app into `/Applications` and opening it is not evidence of Gatekeeper, quarantine, signing, notarization, upgrade, or uninstall support.
- Building on one Apple Silicon machine is not evidence for Intel macOS, clean machines, or universal artifacts.
- A successful UI screenshot, a healthy local daemon, and a successful MCP request are separate checks. They must remain separate release-gate assertions.
- Broad line-ending normalization during an incident is risky. It can create noisy diffs, hide real edits, and alter executable-script behavior. The source of checkout conversion must be identified and guarded against.
- The session temporarily edited `apps/desktop/src/main/index.ts` for logging and later checked it out. That debugging change is not a retained product fix. Any useful logging must be reimplemented deliberately with tests and redaction review.

## 2. Scope and support levels

Use explicit support levels:

| Level | Meaning |
|---|---|
| Development preview | A developer can build and run the app on a named macOS version/architecture. No public installation promise. |
| Unsigned packaging preview | A `.app`, `.dmg`, or `.zip` can be built and locally smoke-tested; Gatekeeper may warn or require manual trust. |
| Release candidate | Native arm64/x64 install, lifecycle, security, persistence, upgrade, and uninstall evidence exists on clean machines. |
| Advertised support | Signed/notarized public artifacts, documented limitations, checksums/SBOM/provenance, and all applicable release gates pass. |

The first target is **macOS arm64 unsigned packaging preview**. Do not advertise macOS as supported until the release-candidate and signing gates pass. Intel/x64 is a separate qualification target.

## 3. Workstreams

### A. Reproducible source and build inputs

- Establish the supported macOS versions and Node/npm toolchain.
- Make icon generation an explicit, deterministic prerequisite of build/package; fail early when required generated assets are absent.
- Decide whether generated assets remain ignored. If they do, package scripts and CI must always generate and verify them; if not, commit only the reviewed canonical assets.
- Add a checkout hygiene check for executable scripts and line endings. Verify shell scripts, launchers, and generated wrappers have the expected LF/permission state on macOS.
- Ensure package scripts use portable shell behavior and do not assume GNU-only commands.
- Record exact artifact inputs, build commit, Node/Electron versions, architecture, and signing state in local evidence.

**Exit evidence:** a clean checkout can produce the same arm64 artifact twice, with required icons/notices/wrapper assets present and no unrelated worktree diff.

### B. macOS bundle and launcher correctness

- Define the bundle layout contract for `OTelux.app`, `Contents/MacOS`, `Contents/Resources`, `app.asar`, external workspace packages, daemon code, and `oteluxctl`.
- Fix and test path resolution for the packaged macOS wrapper; do not infer paths from Linux or unpacked layouts.
- Verify the bundled CLI starts, discovers, adopts, reports, and stops the exact matching runtime instance.
- Verify version parity between the Desktop bundle, CLI, daemon, protocol, and runtime state.
- Test source, unpacked, `.app`, `.dmg`-installed, and `.zip`-extracted forms separately.
- Test a second Desktop launch while a CLI-owned daemon is already healthy; preserve an incompatible owner rather than killing or replacing it.

**Exit evidence:** packaged CLI and Desktop lifecycle tests pass without relying on a developer checkout, fnm, global PATH entries, or an already-running unrelated daemon.

### C. Startup diagnostics and failure handling

- Split startup failures into actionable categories: missing generated resource, bundle/resource path failure, runtime ownership/port conflict, migration/storage failure, listener bind failure, and renderer/preload failure.
- Log a concise machine-readable cause in the main process and show a user-facing remediation message that does not mislabel every failure as a runtime connection problem.
- Keep sensitive paths/tokens out of dialogs and logs where possible; review logs under the local-first/privacy model.
- Add main-process tests for each category and a packaged smoke fixture for the missing-tray-resource case.
- Make tray failure behavior intentional: either fail before window creation with a precise error or run without a tray only if the lifecycle contract remains safe.

**Exit evidence:** each injected failure produces the correct diagnostic category and a deterministic exit/cleanup result.

### D. Runtime lifecycle, autostart, and shutdown

- Decide the product ownership model before implementing autostart: Desktop-owned on-demand runtime, a per-user launchd runtime, or a carefully defined hybrid. Do not maintain two competing daemon owners.
- If launchd is selected, define installation, update, disable/remove, per-user permissions, logs, crash behavior, version matching, and uninstall cleanup. Prefer an app-managed or installer-managed registration over a hand-written plist.
- Specify whether autostart starts the headless runtime, the UI, or both. The default should not unexpectedly open a window.
- Define behavior for logout, sleep/wake, reboot, app quit, runtime crash, port conflict, and stale `runtime.lock`/`runtime.json` state.
- Decide whether launchd `KeepAlive` is appropriate. It must not fight the app's explicit stop semantics or create restart loops.
- Test runtime persistence across Desktop close and clean relaunch; test exact-instance stop so another user's or another version's process is never killed.

**Exit evidence:** a clean macOS user profile can install/enable, reboot or log in, observe one healthy runtime, use MCP and OTLP, disable/remove autostart, and leave no orphan process.

### E. Security, trust, and distribution

- Choose Developer ID Application signing identity and secure CI handling for signing secrets.
- Enable hardened runtime and define only the entitlements actually required. Review sandbox status, Electron child processes, native modules, filesystem access, and any future Keychain use.
- Produce signed arm64 and x64 artifacts as applicable; decide whether universal binaries are required or whether separate artifacts are clearer.
- Validate quarantine and Gatekeeper behavior on a clean macOS machine: download, verify, open, first launch, blocked/allowed prompts, and removal of quarantine only through documented user actions.
- Notarize and staple the `.app`/`.dmg`; verify with `codesign`, `spctl`, and `stapler` checks in CI/release qualification.
- Verify checksums, SBOM, provenance, release metadata, and artifact-to-commit/version parity.
- Define retained-data behavior on upgrade, uninstall, and reinstall. Make data deletion explicit and separate from app removal.
- Defer Homebrew cask/public macOS support claims until signed/notarized artifacts and upgrade/uninstall evidence are stable.

**Exit evidence:** a clean machine can download and install the advertised artifact without undocumented trust workarounds, and release evidence is reproducible.

### F. Native test matrix and documentation

- Add a macOS native runner or documented manual-machine evidence for every advertised architecture. Linux simulation is not sufficient.
- Extend packaged smoke to cover: bundle launch, visible workbench/preload bridge, sample data, OTLP JSON/protobuf ingest, MCP query, Desktop close with runtime alive, restart/persistence, clear data, quit cleanup, and second-client adoption.
- Add platform checks for app identity, bundle paths, executable permissions, data-home permissions, SQLite/WAL/SHM behavior, and launchd state where supported.
- Add install/upgrade/uninstall tests with data retained and with explicit data removal.
- Keep `docs/spec.md`, `docs/getting-started.md`, `docs/test.md`, `docs/platform-security-plan.md`, `README.md`, `SUPPORT.md`, and release notes aligned with the actual support level.
- Include a short “macOS preview limitations” section until signing and native qualification are complete.

**Exit evidence:** documentation names the exact supported artifact/platform matrix and every advertised workflow has a corresponding PASS record.

## 4. Suggested implementation sequence

Implemented in the first slice:

- Packaging scripts now generate icons, generate notices, and verify required assets, executable bits, and LF line endings before electron-builder runs.
- The bundled CLI resolves both macOS `Contents/MacOS` and Linux application-root layouts, with fixture coverage for both.
- Startup failures now use a bounded diagnostic vocabulary for missing resources, bundle paths, storage/migrations, listener conflicts, runtime discovery, and renderer/preload failures; dialogs remain remediation-focused and logs emit only the category plus safe diagnostic fields.

Remaining sequence:

1. **Reproduce and isolate:** start from a clean checkout; capture line-ending, executable-bit, generated-asset, and bundle-layout facts without modifying source.
2. **Build-input gate:** make icon/notices/wrapper prerequisites deterministic and fail-fast; add tests before changing runtime behavior.
3. **Packaged launcher slice:** correct macOS bundle path resolution and qualify exact-instance CLI/Desktop lifecycle in unpacked and packaged forms.
4. **Startup diagnostics slice:** replace the broad error classification with typed causes, safe logs, and regression tests.
5. **Arm64 unsigned preview gate:** run the full packaged smoke on a clean macOS arm64 machine and document limitations.
6. **Runtime-service decision:** choose Desktop-only, launchd, or hybrid ownership; implement installation/removal only after the decision and lifecycle tests are written.
7. **Security/distribution slice:** signing, hardened runtime/entitlements, notarization, Gatekeeper, checksums, SBOM, upgrade, uninstall, and retained-data qualification.
8. **Architecture expansion:** qualify Intel/x64 or universal artifacts separately; do not inherit arm64 results.
9. **Advertise only after evidence:** update support claims and release channels only when all applicable gates pass.

## 5. Definition of done for advertised macOS support

- [ ] Supported macOS versions and architectures are explicit.
- [ ] Clean checkout builds reproducibly with verified generated assets and portable scripts.
- [ ] Signed and notarized artifacts install and launch on clean machines.
- [ ] Bundle, CLI, daemon, protocol, and runtime versions are matched.
- [ ] One-runtime ownership, Desktop adoption, MCP, OTLP ingest, persistence, restart, and exact-instance shutdown pass.
- [ ] Startup failures are correctly categorized and actionable.
- [ ] Autostart behavior is specified, tested, reversible, and does not create competing owners.
- [ ] Data retention/removal behavior is documented and tested across upgrade/uninstall.
- [ ] Hardened runtime, entitlements, quarantine, Gatekeeper, and notarization checks pass.
- [ ] Native arm64/x64 evidence exists for every advertised artifact.
- [ ] Checksums, SBOM, provenance, README, support matrix, and release notes match the evidence.

Until every applicable box is checked, describe macOS as an unsigned preview/development target rather than a supported release platform.
