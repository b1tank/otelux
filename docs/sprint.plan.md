# Sprint — OSS branding, demo, and cross-platform distribution

## Goal

Make the public repository explain and demonstrate OTelux within seconds, show a trustworthy current version and build status, and provide safe installation paths for every supported platform. Use synthetic telemetry in public media and never overstate platform support.

## Reference audit

### Pi

- Centered 128 px logo and concise badge row.
- Clear project explanation plus links to a separate demo/docs site.
- Stable GitHub Release, so the sidebar displays an explicit latest version.
- Linux, macOS, and Windows assets for x64/arm64 plus checksums.

### herdr

- Strong conversion flow: centered logo, navigation, badges, short video, pitch, feature bullets, then install.
- Release/download/license/Homebrew badges make status visible without reading prose.
- Project installer, Homebrew, mise, Windows PowerShell beta, and direct binaries.

### Ghostty

- Restrained centered logo/title/tagline/navigation hero.
- Delegates installation and documentation detail to a polished website.
- Favors signed releases and downstream package maintainers over making a privileged shell script the default.

## OTelux gaps

- README starts with architecture instead of a centered brand hero and immediate user outcome.
- The existing app icon is not used as the repository logo.
- No badge row exposes release, CI, CodeQL, downloads, or license status.
- No screenshot, animation, or video demonstrates the workbench.
- All OTelux releases are marked prerelease. GitHub therefore returns no `/releases/latest` release and shows Tags rather than an explicit latest release in the repository sidebar. The README does name v0.1.9, but the main-page release presentation remains weak.
- Installation covers only Linux x64 `.deb`; there are no macOS, Windows, arm64, package-manager, upgrade, or uninstall paths.
- No GitHub social-preview image provides a branded link card.

## Principles

- Prefer package-manager or signed native installers for a desktop GUI.
- Do not use mutable `curl | sudo` or PowerShell-as-administrator pipelines.
- An optional user-local bootstrap script may come later only with pinned version resolution, checksum/signature verification, and no privilege escalation.
- A badge or platform name must link to a tested, currently supported artifact.
- “Latest” must remain truthful: do not relabel v0.1.9 stable merely to change GitHub's sidebar.

## Workstream 1 — brand and repository landing page (P0)

Current groundwork: the README brand hero, navigation, truthful prerelease/download/CI/CodeQL/license badges, support matrix, deterministic social-preview generator, generated preview asset, privacy-reviewed synthetic product screenshot, and GitHub-compatible animated demo are implemented. The repository-settings social-preview upload remains.

1. Establish an asset contract under `docs/assets/`:
   - logo derived from `apps/desktop/build/icon.svg`;
   - 1280×640 social preview;
   - 1440×900 product screenshot;
   - short, optimized demo animation/video and a static fallback.
2. Capture only deterministic synthetic data. Show traces, logs, and metrics, Source → Service grouping, a waterfall, and local receiver health. Audit pixels and metadata for names, paths, tokens, and live telemetry.
3. Restructure README above the fold:
   - centered 128 px logo and OTelux title;
   - one sentence: local-first OpenTelemetry workbench for developers and coding agents;
   - links to Install, Demo, Docs, Security, and Contributing;
   - badges for latest prerelease, release downloads, Linux build/CI, CodeQL, and MIT license;
   - demo directly before installation.
4. Follow with three benefit bullets, a five-minute quick start, current support matrix, then architecture/development detail.
5. Upload the social preview in repository settings and verify desktop/mobile rendering, dark/light GitHub themes, links, alt text, and asset size.

**Acceptance:** a new visitor can identify the product, see it, determine current version/support, and start installation without scrolling through architecture prose.

## Workstream 2 — release semantics and presentation (P0)

1. Add a prerelease-aware version badge now (for example Shields `github/v/release` with prereleases included) linked to v0.1.9 or the current release.
2. Keep prereleases visibly labeled until the stable-release gate is met.
3. Publish the first stable, non-prerelease GitHub Release only after its supported platform matrix passes release tests. This is what makes GitHub's sidebar and `/releases/latest` show an explicit version.
4. Generate release notes with install, upgrade, uninstall, support matrix, checksums, SBOM, provenance/signature, known limitations, and changes.
5. Add a release manifest consumed by docs/package-manager automation so README versions do not drift.

**Acceptance:** version surfaces agree across package metadata, tag, release title, About dialog, badges, and install docs; the GitHub sidebar shows “Latest” only for a genuinely stable release.

## Workstream 3 — cross-platform artifact pipeline (P0)

Current groundwork: electron-builder targets and explicit package scripts exist for Linux x64, macOS x64/arm64, and Windows x64. A path-scoped CI workflow builds short-lived **unsigned preview artifacts** on native runners and runs the native unpacked application through OTLP, MCP, renderer, window-close/tray, and explicit-quit smoke coverage. Those previews are not releases and do not qualify signed installer support.

Build native artifacts on native GitHub runners; do not cross-sign from Linux.

| Platform | First official artifacts | Trust requirements | CI verification |
| --- | --- | --- | --- |
| Linux | x64 `.deb` (existing), then arm64 `.deb`; evaluate AppImage/RPM by demand | checksums, SBOM, provenance | clean install, upgrade, uninstall, smoke, performance |
| macOS | signed/notarized universal or separate arm64/x64 `.dmg` plus `.zip` | Apple Developer ID, hardened runtime, notarization/stapling | Gatekeeper clean install, launch, OTLP/MCP, quit, upgrade/uninstall |
| Windows | signed x64 installer first (NSIS `.exe` or MSIX); arm64 after Electron/runtime validation | Authenticode certificate and timestamping | clean VM install, SmartScreen/signature, launch, OTLP/MCP, quit, upgrade/uninstall |

Implementation order:

1. Generalize `electron-builder.yml`, release scripts, artifact naming, checksums, SBOM generation, and release publishing for a matrix.
2. Split release jobs by OS/architecture; upload immutable per-job artifacts, then assemble one GitHub Release after every required job passes.
3. Add macOS signing/notarization secrets in the protected release environment and document credential rotation.
4. Add Windows signing secrets/service integration and choose NSIS versus MSIX based on update/uninstall and Winget compatibility.
5. Extend packaged smoke tests and manual release reports per platform; add platform-specific tray, lifecycle, port-conflict, filesystem, and accessibility checks.
6. Verify all release assets by downloading them from GitHub—not CI staging—before announcing support.

## Workstream 4 — easy installation (P1 after signed artifacts)

1. **Direct downloads:** always available from GitHub Releases with concise per-platform commands and GUI instructions.
2. **macOS:** create a maintained `b1tank/homebrew-tap` cask after notarized artifacts exist; later submit to `homebrew-cask` once release cadence and adoption meet its policies. Target: `brew install --cask b1tank/tap/otelux`, then `brew upgrade --cask otelux`.
3. **Windows:** generate and test Winget manifests from signed stable installer metadata, then submit versioned PRs to `microsoft/winget-pkgs`. Target: `winget install OTelux.OTelux` and `winget upgrade OTelux.OTelux`.
4. **Linux:** retain `.deb` first. Add a signed APT repository only when operational ownership for repository metadata, key rotation, and rollback exists. Do not present Homebrew as the primary Linux GUI path.
5. Consider Scoop or a user-local verified installer only as secondary channels. Every channel must support documented upgrade and uninstall and must verify immutable release assets.

## Workstream 5 — documentation and launch (P1)

- Keep README, `docs/getting-started.md`, `docs/spec.md`, `docs/plan.md`, `docs/test.md`, release notes, and package-manager metadata synchronized.
- Add troubleshooting for Gatekeeper, SmartScreen, tray behavior, ports, data location, and complete removal.
- Add platform issue templates and support labels.
- Announce a platform only after the exact public artifact passes the release report.
- Track download/install failures and support load before widening channels.

## Recommended sequence

1. README hero, truthful badges, static screenshot, demo, and social preview.
2. Version/release metadata automation while retaining prerelease status.
3. macOS arm64/x64 signed/notarized artifacts and Homebrew tap.
4. Windows x64 signed installer and Winget.
5. Linux arm64 and optional AppImage/RPM based on demand.
6. First stable non-prerelease release after all advertised-platform gates pass; then enable the GitHub “Latest” presentation.

## Explicit non-goals for this sprint

- Rebranding the in-app UI.
- A dedicated marketing website before README conversion is validated.
- Silent auto-update.
- Unverified or privileged remote install scripts.
- Claiming stable cross-platform support before signing and clean-machine tests exist.
