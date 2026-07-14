# OTelux - Public Release Sprint

Updated: 2026-07-14

Status: Active

This document is the finite execution plan for taking OTelux from a private pre-release repository to a public, installable, cross-platform product that is ready for a coordinated launch.

The canonical documents keep separate responsibilities:

- [spec.md](spec.md) defines the product and its behavioral requirements.
- [plan.md](plan.md) sequences ongoing product development.
- [proposal.md](proposal.md) explains the product bet and intended audience.
- [test.md](test.md) defines automated and manual release qualification.
- This document owns release-readiness work, launch gates, estimates, and validation evidence.

When release work changes product behavior, update the relevant canonical document in the same change. Completed release tasks remain recorded here; completed product work belongs in git history rather than [plan.md](plan.md).

## Goal

The sprint is complete when:

- The repository is safe and welcoming to publish as open source.
- Linux users can install a versioned, supported package from an official release.
- Windows and macOS users have signed, tested installers.
- Release artifacts have checksums, provenance, licenses, and documented verification steps.
- The shipped app satisfies the [supported release workflows](spec.md#supported-release-workflows), [release quality policy](spec.md#release-quality-policy), and [release qualification](test.md#release-qualification).
- The product has survived an external beta with no unresolved launch-blocking defects.
- The repository and product pages are ready for a coordinated Hacker News and social launch.

## Release Decisions

- The Electron desktop app is the first released product. The VS Code extension remains experimental and is not a `v0.1.0` launch gate.
- Reusable `@otelux/*` packages remain private during this sprint. Publishing npm packages is a separate decision.
- Linux x64 `.deb` is the first beta target. AppImage remains blocked until its launcher can fail closed when Chromium sandbox prerequisites are unavailable. Windows x64 and macOS arm64/x64 follow from the same release workflow.
- The first public binary is `v0.1.0-beta.1`. The cross-platform launch is `v0.1.0` unless beta evidence requires another prerelease.
- GitHub Releases is the canonical artifact source. A product website may provide friendly download links but must resolve to immutable versioned artifacts.
- The `v0.1.0` channels follow the [distribution requirements](spec.md#distribution-requirements): `.deb` installation uses the package manager after download and verification; a future portable Linux artifact must preserve Chromium's sandbox or refuse to start.
- Manual updates are acceptable for `v0.1.0`. Auto-update is reconsidered after the release process is stable.
- A Linux beta may disclose memory-only storage and JSON-only OTLP as preview limitations. Broad marketing requires durable storage and OTLP/HTTP protobuf support.
- OTLP/gRPC, npm publication, Marketplace publication, an apt repository, Flatpak, Snap, and crash reporting are not `v0.1.0` gates.
- `v0.1.0` makes no exception to the specification's no-unsolicited-egress principle and documents the explicit MCP/LM client boundary.

## Canonical Gates

This sprint does not redefine durable product or quality requirements:

- [spec.md](spec.md#supported-release-workflows) owns supported workflows and [defect severity](spec.md#release-quality-policy).
- [test.md](test.md#release-qualification) owns automated, packaged, accessibility, performance, coverage, and manual verification.
- [plan.md](plan.md) owns the product work needed to close gaps against those requirements.

This document adds only `v0.1.0` scope decisions, ordered launch work, completion evidence, and temporary risks.

## Audited Starting Baseline

This table preserves the state found before sprint work began. Current completion and validation evidence live in the milestone checklists and sprint log below.

Evidence collected locally on 2026-07-13:

| Check | Result | Release implication |
|---|---|---|
| `npm ci` | Pass | The lockfile restores successfully. |
| `npm run lint` | Fail: 16 diagnostics | CI is not currently green. |
| `npm run typecheck` | Fail: 2 UI test errors | Strict TypeScript gate is not currently green. |
| `npm test` | Pass: 175 tests | Package and UI behavior has a useful test baseline; desktop and extension apps still lack app-level tests. |
| `npm run build` | Pass | Source builds complete across all workspaces. |
| Desktop `package` script | Fail | AppImage is produced, but `.deb` generation stops on missing package metadata. |
| Packaged AppImage smoke | Pass with extract-and-run fallback | Packaged UI, health probe, trace ingest, and waterfall selection work. Direct FUSE mounting was unavailable in the audit environment. |
| Production dependency audit | Fail: 2 high-severity packages | Hono runtime dependencies must be updated. |
| Full dependency audit | Fail: high/critical findings, including Electron | Electron and build tooling are outside a responsible release baseline. |
| Current tracked-file credential pattern scan | No credential-shaped matches | A dedicated history-aware scanner is still required. |
| Privacy review | Needs work | Captured fixtures and git history contain machine/session metadata and absolute home paths. |
| Electron runtime boundary | Good baseline | Sandbox, context isolation, CSP, narrow IPC, and loopback binding are already present. |
| Artifact contents | Needs work | The AppImage includes source, tests, sourcemaps, and Turbo logs that are not needed at runtime. |

## Milestone 0 - Green Baseline

Estimate: 0.5-1 engineer-day

Status: Complete

- [x] Fix all current Biome diagnostics without unrelated reformatting.
- [x] Fix strict TypeScript errors in the UI tests.
- [x] Remove or resolve test-runner warnings that can hide real failures.
- [x] Verify `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` from a clean install.
- [x] Confirm CI uses the same commands and passes on `main`.

Done when every documented routine verification command exits zero and test output has no unexplained warnings.

## Milestone 1 - Public Repository

Estimate: 3.5-6 engineer-days; 4-7 cumulative

- [x] Add the root MIT `LICENSE` file.
- [x] Verify GitHub detects the root license as MIT after it is pushed.
- [x] Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and a concise support/maintainer policy.
- [ ] Before public visibility, enable and exercise GitHub private vulnerability reporting and name an independent conduct recipient with a verified confidential channel.
- [x] Add bug and feature issue forms plus a pull request template.
- [x] Include an explicit warning that telemetry attached to issues may contain prompts, headers, URLs, SQL, identifiers, or customer data.
- [x] Add user installation, privacy, security model, troubleshooting, uninstall, and known-limit documentation.
- [x] Replace captured fixture metadata with explicitly synthetic hosts, identifiers, providers, and timestamps while preserving test cases.
- [x] Run Gitleaks and TruffleHog against the complete git history.
- [x] Preserve existing commit history: author identity and historical development paths are non-secret provenance, and two full-history scanners found no secrets. Do not rewrite published commits without new evidence of sensitive data.
- [x] Add Dependabot and CodeQL with least-privilege workflow permissions and immutable action references.
- [ ] Configure branch protection, required checks, secret scanning, and push protection.
- [x] Perform a preliminary exact-name, trademark, package namespace, and domain availability screen before broad branding. Treat it as risk screening, not legal clearance or namespace reservation.

Done when a new contributor can understand, build, test, report a bug, propose a change, and privately report a vulnerability without maintainer guidance, and a history-aware scan finds no undisclosed secrets.

## Milestone 2 - Runtime And Supply-Chain Security

Estimate: 4-6 engineer-days; 8-13 cumulative

- [x] Upgrade Electron to a supported release line and review breaking security defaults between versions.
- [x] Upgrade Hono, `@hono/node-server`, electron-builder, and vulnerable build dependencies.
- [x] Enforce zero known high or critical production dependency advisories in CI.
- [x] Add bounded request bodies with configurable limits and `413` responses, defaulting to 10 MiB for OTLP and 1 MiB for MCP.
- [x] Enforce intentional content types and a browser-origin policy for loopback HTTP listeners.
- [x] Make MCP access explicitly opt-in or protect HTTP access with a per-install credential.
- [x] Document that enabled MCP clients can read sensitive local telemetry.
- [x] Deny unexpected renderer navigation and permission requests.
- [x] Restrict external links to intentional HTTPS destinations.
- [x] Make settings updates atomic across listener rebind and settings persistence, including rollback when the settings write fails.
- [x] Add focused tests for oversized payloads, hostile origins, malformed requests, and Electron navigation policy.

Done when the production audit is clean at the agreed severity threshold, local HTTP trust boundaries are documented and tested, and the Electron security checklist has no unexplained exceptions.

## Milestone 3 - Official Linux Beta

Estimate: 4-6 engineer-days; 12-19 cumulative

- [x] Establish one application version source and remove hard-coded `0.0.0` values.
- [x] Complete author, homepage, repository, executable, desktop-entry, and artifact metadata.
- [x] Produce a consistently named x64 `.deb` artifact from the current placeholder version; final release versioning remains a separate gate.
- [ ] Restore AppImage only with a fail-closed launcher that never adds `--no-sandbox` automatically; test both sandbox-capable and sandbox-incapable hosts.
- [x] Package only runtime code and required assets; exclude source, tests, caches, and production sourcemaps.
- [x] Include the project license and generated third-party notices in every artifact.
- [x] Add a tag-driven release workflow with explicit permissions and an approval-protected release environment.
- [x] Publish SHA-256 checksums, an SBOM, and GitHub artifact attestations with each release.
- [x] Add an automated packaged smoke test for startup, health, ingest, and clean shutdown.
- [x] Test `.deb` install, launch, ingest, restart, upgrade, and uninstall on clean supported Linux systems.
- [ ] If AppImage returns, document FUSE requirements and extraction fallback behavior and complete the same clean-system tests.
- [x] Surface session-only storage and JSON-only ingest as visible beta limitations rather than relying only on release notes.
- [x] Remove unimplemented tools and controls from the supported surface or mark them explicitly experimental.
- [ ] Run the complete manual regression against every enabled release artifact (`.deb` for the first beta) and resolve every P0/P1 defect.
- [x] Publish `v0.1.0-beta.1` as a GitHub prerelease with memory-only and JSON-only limitations stated plainly.

Done when a user can verify, install, run, and remove OTelux without Node.js or a repository checkout, the same immutable artifacts pass clean-machine tests, all three signal workflows work, and no P0/P1 defect is open.

## Milestone 4 - MVP Product And Quality Readiness

Estimate: 14-22 engineer-days; 26-41 cumulative

- [ ] Complete the release-blocking data-lifecycle work in [plan.md Phase 2](plan.md#phase-2--durable-local-storage).
- [ ] Complete OTLP/HTTP protobuf and overload handling required from [plan.md Phase 5](plan.md#phase-5--production-ingest-formats); OTLP/gRPC remains deferred.
- [ ] Complete pause/resume, clear data, and result-state work required from [plan.md Phase 1](plan.md#phase-1--workbench-polish); other Phase 1 polish remains risk-ranked rather than automatically blocking.
- [ ] Add first-run configuration recipes for .NET, Node.js, Python, Codex, and an OTel Collector.
- [ ] Add a synthetic demo-data path so a new user can evaluate the UI before configuring an SDK.
- [ ] Audit every control and advertised MCP tool; implement it, hide it, or mark it experimental.
- [ ] Add runtime validation at the IPC boundary and automated desktop main/preload integration tests.
- [ ] Satisfy every automated, packaged, coverage, accessibility, performance, and manual gate in [test.md](test.md#release-qualification).
- [ ] Verify every [supported workflow](spec.md#supported-release-workflows) and [release-quality gate](spec.md#release-quality-policy).

Done when the specification's supported workflows and quality policy are satisfied and the complete release qualification passes.

## Milestone 5 - Windows And macOS

Estimate: 9-14 engineer-days; 35-55 cumulative, excluding account and certificate lead time

- [ ] Add a Windows x64 NSIS installer with stable application identity and uninstall behavior.
- [ ] Acquire and configure Windows Authenticode signing.
- [ ] Add macOS arm64 and x64 artifacts with hardened runtime and required entitlements.
- [ ] Acquire an Apple Developer ID, sign, notarize, and staple macOS artifacts.
- [ ] Run source checks and packaging on Linux, Windows, and macOS CI runners.
- [ ] Run install, launch, ingest, restart, upgrade, and uninstall tests on clean machines for each supported platform.
- [ ] Verify settings, storage, ports, icons, menus, shortcuts, and external links on every platform.
- [ ] Decide whether Linux arm64 joins `v0.1.0` based on available test hardware or runners.

Done when every advertised platform receives a verified artifact from the same tag, Windows and macOS show a trusted publisher, and the support matrix names every tested OS and architecture.

## Milestone 6 - Public Launch

Estimate: 3-5 engineer-days plus a one-week external soak; 38-60 cumulative with parallel documentation work

- [ ] Recruit 5-10 external beta users across supported platforms.
- [ ] Resolve every P0/P1 beta issue and document accepted lower-severity limitations.
- [ ] Review every accepted P2 with an owner, workaround, rationale, and release-note entry.
- [ ] Prepare a product page, one strong screenshot or short demo, a two-minute quickstart, and release notes.
- [ ] Verify all download links, checksums, signatures, attestations, install commands, and uninstall instructions from clean machines.
- [ ] Prepare issue labels, triage expectations, a patch-release runbook, and security-response ownership.
- [ ] Publish `v0.1.0`, observe release health, then coordinate Hacker News and social posts.

Done when the released artifacts remain healthy through the soak period, support channels are ready for traffic, and launch material accurately represents the shipped product without hiding limitations.

## Installation Policy

The initial Linux documentation should offer:

1. A `.deb` downloaded from the versioned GitHub release, verified against `SHA256SUMS`, then installed with `sudo apt install ./<artifact>.deb`.
2. A portable artifact only after its launcher preserves Chromium's sandbox or fails closed on unsupported hosts.
3. Optionally, a convenience installer that installs into `~/.local`, selects or accepts an explicit version, verifies checksums before replacement, and supports uninstall. It must not require `sudo`.

A signed apt repository or store distribution can follow when release cadence justifies the ongoing operational burden.

## Sprint Retirement

After `v0.1.0` ships and its soak period closes:

1. Update [spec.md](spec.md#current-baseline) so the Current Baseline matches the released artifacts and marks newly shipped behavior Live.
2. Remove completed work from [plan.md](plan.md), leaving only future work; git history and release notes preserve completed detail.
3. Replace the README's pre-release status with the shipped version and ensure installation, upgrade, uninstall, supported-platform, and known-limitation guidance is reachable from the README and release notes.
4. Copy final validation evidence and accepted limitations into the GitHub release notes or another versioned release record.
5. Remove links to this file from the README and [plan.md](plan.md), delete this file, and verify no repository references to `release-sprint.md` remain.

No product requirement, defect policy, or verification gate needs migration at retirement because their canonical owners are already [spec.md](spec.md) and [test.md](test.md).

## Execution Rules

- Work milestones in order unless a later task is required to unblock an earlier gate.
- Keep each change independently reviewable and verifiable.
- Update tests and affected canonical docs in the same change as behavior.
- Do not mix unrelated product features into release-hardening changes.
- Record validation commands and notable evidence in the sprint log.
- Do not mark a checkbox complete when only configuration exists; the resulting behavior or artifact must be exercised.
- Treat packaging and installation as product behavior, not as a final administrative step.
- Keep release credentials only in protected CI environments; never place them in the repository or local fixtures.

## Risks And External Dependencies

| Risk | Mitigation |
|---|---|
| Electron major-version upgrade exposes compatibility work | Upgrade before packaging automation and keep the existing packaged smoke path running. |
| Apple or Windows signing enrollment delays launch | Start account and certificate procurement during Milestone 1. |
| Real telemetry leaks through fixtures or issue attachments | Use synthetic fixtures, contributor warnings, and history-aware scanners. |
| AppImage tooling silently adds `--no-sandbox` on some hosts | Do not publish AppImage until its launcher fails closed; ship the validated `.deb` first. |
| SQLite migrations or retention corrupt user data | Add migration, recovery, and bounded-growth tests before using it in release builds. |
| Cross-platform work expands the first release indefinitely | Keep VS Code Marketplace, npm, gRPC, auto-update, and store packaging outside `v0.1.0`. |

## Sprint Log

| Date | Milestone | Evidence |
|---|---|---|
| 2026-07-13 | Audit baseline | Tests and builds pass; lint, typecheck, dependency audit, `.deb` packaging, repository hygiene, and artifact pruning require work. Packaged AppImage health, ingest, rendering, and trace selection were exercised successfully. |
| 2026-07-13 | Milestone 0 local baseline | After `npm ci`, lint passed, all 20 typecheck tasks passed, all 175 tests passed without React or Turbo missing-output warnings, and all 11 build tasks passed. The remaining Vite CJS deprecation and tsup type re-export notices are assigned to the dependency/tooling upgrade in Milestone 2. Remote CI confirmation remains open. |
| 2026-07-13 | MVP quality scope | Added a bounded `v0.1.0` product contract, explicit beta limitations, P0-P3 defect policy, risk-based coverage strategy, packaged end-to-end requirements, accessibility checks, and measurable product-quality exit criteria. |
| 2026-07-13 | Documentation lifecycle audit | Moved durable workflows and defect policy to `spec.md`, moved release qualification to `test.md`, removed status snapshots from `proposal.md` and the README, corrected stale settings/MCP test behavior, and added an explicit sprint retirement procedure. |
| 2026-07-14 | Synthetic telemetry fixtures | Replaced machine-derived Codex log and metric metadata with deterministic synthetic hosts, identifiers, providers, models, timestamps, traces, and spans. Preserved prompt, metric, startup, and cross-record correlation behavior; all receiver tests passed. |
| 2026-07-14 | Privacy CI and history scan | CI run 29354893453 passed install, lint, typecheck, test, and build for `ef1fde5`. Gitleaks v8.30.1 (`sha256:c00b6bd0...`) scanned 134 commits / 3.54 MB with no leaks. TruffleHog v3.95.9 (`sha256:59b24424...`) scanned 1,717 chunks / 3.66 MB with zero verified or unverified secrets. The separate decision about rewriting non-secret author/path metadata remains open. |
| 2026-07-14 | User documentation | Added source-only setup, endpoint verification, synthetic first telemetry, troubleshooting, local removal, privacy/data handling, and a candid security model. Corrected the desktop README so locally generated packages are not presented as supported releases. |
| 2026-07-14 | Security automation | Added weekly Dependabot updates and public-only CodeQL, pinned all workflow actions to full SHAs, disabled persisted checkout credentials, kept workflow tokens read-only, and restricted repository Actions to GitHub-owned actions with SHA pinning required. CI run 29355799610 passed again under the hardened policy; CodeQL skipped as designed while private. Enabled Dependabot alerts and automated security fixes; 222 alerts include 24 critical and 38 high findings, assigned to Milestone 2 dependency upgrades. Branch protection, required checks, code scanning upload, secret scanning/push protection, and private vulnerability reporting remain public-visibility or account-tier gates. |
| 2026-07-14 | License, history, and name decisions | GitHub detects the root license as MIT. Retained 134-commit history because Gitleaks and TruffleHog found no secrets; known author/path metadata is ordinary provenance. Preliminary exact-name screening found no OTelux match in USPTO, GitHub, npm package names, PyPI, NuGet, VS Marketplace, or Open VSX; EUIPO returned only the different mark ROTELUX in classes 6/14. `otelux.com` is registered, `.dev` and `.io` returned no RDAP registration record, and `yummyjars.com` is live over HTTPS. The npm `@otelux` scope is not reserved by this check, and formal legal clearance remains advisable before material brand investment. |
| 2026-07-14 | User documentation CI | GitHub Actions run 29358229582 passed install, lint, typecheck, all 176 tests, and build for `c693157`; public-only CodeQL skipped as designed. |
| 2026-07-14 | Electron and Linux packaging | Upgraded Electron 33.2.1 to 43.1.0 and electron-builder 25.1.8 to 26.15.3; measured the packaged runtime as Chromium 150.0.7871.47, Node 24.18.0, and V8 15.0.245.13-electron.0. Raised the build-host floor to Node 22.12. Added explicit repository, homepage, author, executable, desktop identity, lowercase Debian package, and safe artifact names. Full lint, 20 typecheck/test tasks, all 176 tests, and all 11 builds pass; a clean `npm ci` succeeds and the production audit remains at zero. Debian packaging succeeds and its control/desktop metadata validate. AppImage functionality passed health and all three signal workflows, but builder-generated `AppRun` can silently add `--no-sandbox` when user namespaces are unavailable; AppImage publication is therefore blocked and the target is disabled until a fail-closed launcher exists. Artifact pruning and final versioning remain Milestone 3 gates. |
| 2026-07-14 | Build and test toolchain | Upgraded Vite 5.4.11 to 7.3.6, Vitest 2.1.8 to 4.1.10, electron-vite 2.3.0 to 5.0.0, the React Vite plugin 4.3.4 to 5.2.0, tsup 8.3.5 to 8.5.1, jsdom 25.0.1 to 28.1.0, Changesets 2.27.10 to 2.31.0, Turbo 2.3.3 to 2.10.5, and direct Node types to 22.20.1 without moving React 18. A clean `npm ci`, dependency-tree validation, lint, all workspace typecheck tasks, all 176 tests, and all 11 builds pass. Production and high/critical audits are zero. The full audit retains one low esbuild advisory in tsup 8.5.1; the latest tsup still requires esbuild `^0.27.0`, the affected development-server path is not used by tsup builds, and no unsupported override was added. |
| 2026-07-14 | CI supply-chain gate | Added an `npm audit --omit=dev --audit-level=high` step to the CI workflow after install so any high or critical production advisory fails the build. Scoped to the production graph on purpose: dev-only tooling advisories cannot reach shipped artifacts and change with advisory publication rather than code, so they are triaged through Dependabot instead of blocking every PR. The gate passes locally at zero production advisories. |
| 2026-07-14 | Request body limits | Bounded OTLP and MCP request bodies with configurable `maxBodyBytes` (10 MiB OTLP, 1 MiB MCP defaults) and `413` responses returned before decoding. Enforced from a declared `Content-Length` and while streaming, so a chunked body that omits or understates its length cannot exceed the cap; a body of exactly the limit is accepted. Added desktop `OTELUX_OTLP_MAX_BODY_BYTES` / `OTELUX_MCP_MAX_BODY_BYTES` overrides that fail closed to the defaults on invalid input. Receiver tests cover the `Content-Length` fast path (over-limit → 413 with no ingest; at-limit → normal validation) and MCP tests cover the streaming path (over-limit → 413, no dispatch). Lint, affected typecheck/test/build, receiver 28 tests, and MCP 12 tests pass. |
| 2026-07-14 | Content-type and origin policy | Both loopback listeners now require an `application/json` content type on `POST` (`415` before the body is read) and reject any request carrying an `Origin` outside an explicit allowlist (`403`, no CORS headers, no ingest). Non-browser senders omit `Origin` and are unaffected; an approved origin receives `Access-Control-Allow-Origin` + `Vary: Origin` and a `204` preflight, while a different scheme/host/port is still rejected. Allowlists are configurable via `ReceiverOptions.allowedOrigins` / `HttpRouterOptions.allowedOrigins` and default empty, so the desktop and extension — which never use a browser HTTP client — deny all browser origins by default. Receiver 33 tests and MCP 14 tests pass; full lint/typecheck/test/build green. |
| 2026-07-14 | Electron renderer hardening | Denied top-frame navigation away from the app URL, gated the window-open handler so only well-formed HTTPS links are opened externally (dropping `http:`, `file:`, `javascript:`, `data:`, and malformed URLs), denied every renderer permission request and check, and refused `<webview>` attachment. Extracted pure `isAllowedExternalUrl` / `isAllowedNavigation` predicates into `apps/desktop/src/main/security.ts` with unit tests; desktop suite 1 → 5 tests. Full lint/typecheck/test/build green. Runtime IPC validation remains the last renderer-boundary gap. |
| 2026-07-14 | Settings-write rollback | Extracted the two-phase settings update into `apps/desktop/src/main/updateSettings.ts` behind small controller interfaces so it is testable without Electron or real ports, and closed the gap where a failed `settings.json` write left listeners rebound to the new ports while disk kept the old values. All mutated listeners now roll back to their previous shape on commit failure (and on receiver/MCP bind failure), so the running state always matches persisted settings. Added four fake-driven unit tests (happy path, receiver rollback on write failure, MCP rollback on write failure, receiver rollback when MCP bind fails without persisting); desktop suite 5 → 9 tests. Full lint/typecheck/test/build green. |
| 2026-07-14 | MCP per-install credential | Chose a per-install bearer token over disabling MCP so the feature stays usable out of the box. Added optional `HttpRouterOptions.authToken` to `@otelux/mcp-server`: when set, every JSON-RPC `POST` must send `Authorization: Bearer <token>` (constant-time compared via `timingSafeEqual`) or receive `401` before any tool runs; the identity probe stays open. The desktop generates a 32-byte URL-safe token on first run, stores it in `<userData>/mcp-token` with owner-only permissions, reuses it across restarts, threads it through `McpHost`, and logs the token-file path on startup. Updated the security model, privacy, spec, and manual test plan; refreshed the security-model safeguards and gaps so only IPC runtime validation and the private-repo CI items remain. MCP package 14 → 18 tests, desktop 9 → 12 tests; full lint/typecheck/test/build green. |
| 2026-07-14 | Single app version source | Made `apps/desktop/package.json` `version` the sole application version, set it to `0.1.0`, and removed the duplicated hard-coded `0.0.0` literal in the preload. electron-vite now injects the package version at build time via a `define`, so the value exposed on the context bridge (and any future about/version UI) can never drift from the packaged version electron-builder uses for `app.getVersion()` and the artifact name. Verified the built preload carries `version: "0.1.0"`; full lint/typecheck/test/build green. Final per-release versioning still comes from the tag-driven release workflow. |
| 2026-07-14 | Packaging hygiene | Tightened the electron-builder `files` allowlist so artifacts ship only built runtime code. A `--linux dir` pack revealed the symlinked `@otelux/*` workspace deps were shipping their entire `src/` (including `.test.ts`) and `dist/*.map`; added excludes for all sourcemaps and the workspace packages' `src/`, tsconfig, tsup, and vitest config. Re-packing confirms zero `.map` files, zero workspace `src/`, and the runtime `dist/` retained (every `@otelux` package resolves its entry to `dist`). Smoke-launched the packed binary: `/healthz` returns 200, OTLP and MCP listeners bind, and the per-install MCP token is generated. |
| 2026-07-14 | License and third-party notices | Added `scripts/generate-notices.mjs`, which walks the desktop app's production dependency closure (`npm ls --omit=dev`) and emits `build/THIRD-PARTY-NOTICES.txt` with each third-party package's name, version, SPDX license, and bundled license text (7 packages: hono, @hono/node-server, react, react-dom, scheduler, loose-envify, js-tokens — all MIT). The desktop `package` script regenerates it before packing, and electron-builder `extraResources` bundles both the root `LICENSE` and the notices into every artifact. Verified a pack places `resources/LICENSE` and `resources/THIRD-PARTY-NOTICES.txt` in the app. The generated notices live under the gitignored `build/` tier alongside icons, produced at pack time rather than committed. |
| 2026-07-14 | Packaged smoke test | Added `scripts/smoke.mjs` (npm `smoke`), which launches the packed Linux binary and asserts the release-critical runtime path: the OTLP receiver answers `/healthz`, a valid OTLP/HTTP JSON trace ingests (`200`), the request hardening survives packaging (non-JSON `POST` → `415`), then the process shuts down cleanly. It runs Electron in its own process group and escalates SIGTERM→SIGKILL so it always terminates, uses a random OTLP port and a temp user-data dir, and exits non-zero on any failed assertion. Added `package:dir` to produce the unpacked app for the smoke. Verified locally: both assertions pass, exit 0, no lingering processes. The release workflow will invoke `package:dir` + `smoke` under `xvfb`. |
| 2026-07-14 | Clean-checkout icon source | Discovered the wildcard `build/` gitignore also excluded the desktop icon master, so a fresh checkout could not build a properly iconed artifact. Added targeted gitignore negation to track `apps/desktop/build/icon.svg` while keeping its generated PNGs ignored, committed the SVG, and confirmed `build-icons.sh` regenerates from it. |
| 2026-07-14 | Tag-driven release workflow | Added `.github/workflows/release.yml`: on a `v*` tag (or manual dispatch) it resolves the version from the tag, sets the desktop package version, installs `librsvg2-bin`/`xvfb`/Electron libs, builds icons, packages the `.deb`, runs the packaged smoke under `xvfb`, generates a CycloneDX SBOM via `npm sbom`, writes `SHA256SUMS`, attests build provenance with the GitHub-owned `actions/attest-build-provenance` (SHA-pinned), and publishes a GitHub prerelease with the `.deb`, checksums, and SBOM via the `gh` CLI. Top-level `contents: read` with a job scoped to `contents/id-token/attestations: write`; only GitHub-owned, SHA-pinned actions are used, satisfying the repository Actions policy. Locally verified the testable steps: icon build, `npm run package` producing `OTelux-0.1.0-amd64.deb` (matches the workflow globs), the smoke test, and `npm sbom` (CycloneDX 1.5). Two items need a one-time setup before the first real release: configure required reviewers on the `release` GitHub environment (repo settings) so the approval gate is enforced, and the end-to-end attest/publish path is exercised only when a tag is pushed. |
| 2026-07-14 | Experimental tool surface | Audited the advertised surface for unimplemented features. The only non-functional item is the MCP `otel_correlate_agent_run` tool (returns `supported: false` pending engine-side detection); added a machine-readable `experimental` flag to `ToolDefinition`, surfaced it in `tools/list`, reflected the count in the `initialize` instructions, prefixed the tool description with `[Experimental]`, and updated the mcp-server README. No non-functional UI controls exist (all clear/filter controls are wired). Also corrected the README's stale "MCP off by default" claim to "enabled by default with a per-install bearer token." MCP package 18 → 19 tests; full lint/typecheck/test/build green. |
| 2026-07-14 | Visible beta limitations | Added an always-visible `BETA` badge to the desktop EndpointBar whose tooltip states the two limitations a user most needs up front — session-only in-memory storage and OTLP/HTTP JSON-only ingest — so they are surfaced in the app itself, not only in release notes. Verified via deskpal that the badge renders in the topbar next to the OTLP and MCP pills. Updated the manual test plan's topbar description. Full lint/typecheck/test/build green. |
| 2026-07-14 | First prerelease published | Cut `v0.1.0-beta.1` and ran the release workflow end to end. The first real run surfaced two bugs the local environment had masked: (1) packaging failed resolving `@otelux/ui/workbench.css` because the workflow packaged the desktop without first building the `@otelux/*` workspace `dist/` — fixed by adding a `npm run build` step before packaging; (2) build-provenance attestation failed because it is unavailable for user-owned private repositories — made the attest step conditional on public visibility so it auto-enables when the repo goes public. The `.deb` build, the packaged smoke under `xvfb`, SBOM generation, and checksums all passed in CI. Published prerelease `v0.1.0-beta.1` (private repo) with three assets: `OTelux-0.1.0-beta.1-amd64.deb`, `otelux-0.1.0-beta.1-sbom.cdx.json`, and `SHA256SUMS`. Package-level `.deb` inspection confirmed fail-closed SUID `chrome-sandbox`, bundled LICENSE + third-party notices, desktop entry, and full icon set. Remaining before public launch: clean-machine `.deb` install/uninstall (needs `sudo`, handed to the maintainer), the full manual regression, and making the repository public (which enables attestation, CodeQL upload, and branch protection). |
| 2026-07-14 | Clean-machine .deb verified | Maintainer downloaded the published `v0.1.0-beta.1` assets and confirmed the full package lifecycle on a clean machine: `sha256sum -c SHA256SUMS` verified, `sudo apt install ./OTelux-0.1.0-beta.1-amd64.deb` installed, `otelux` launched, and `sudo apt remove otelux` uninstalled cleanly. Trace ingest is already covered by the CI packaged smoke; explicit restart/upgrade cycles will be exercised against the next beta. |
| 2026-07-13 | Milestone 0 CI | GitHub Actions run 29288054196 passed install, lint, typecheck, all tests, and build for commit `17c5882`. |
| 2026-07-13 | Milestone 1 community foundation | Drafted the MIT license, contribution and support guidance, conduct and security policies, CODEOWNERS, structured issue forms, a pull request template, and public telemetry-sanitization warnings. License detection, private vulnerability reporting, and an independent conduct channel remain publication gates. |
