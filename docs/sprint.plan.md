# Sprint — Public OSS readiness

## Goal

Make the repository safe, accurate, and maintainable to expose publicly without waiting for unrelated product-roadmap work. Public visibility is not the same as declaring a stable cross-platform product release.

## Essential gates before visibility

- [x] **P0 — Re-run full-history secret scans.** Gitleaks 8.30.1 scanned 254 commits / 4.75 MB with zero findings; TruffleHog 3.95.9 scanned 3,778 chunks / 4.95 MB with zero verified or unverified secrets. Tool archives were checksum-recorded in the run evidence.
- [x] **P0 — Audit the current tree for private data.** No credential-shaped matches, private/RFC1918 URLs, sensitive tracked filenames, binary telemetry databases, screenshots, or real home paths were found. `/home/user` appears only as a synthetic path fixture.
- [x] **P0 — Reconcile product claims and roadmap state.** Removed stale pending claims for pagination, worker isolation, backpressure, service overview, and correlation; updated protocol/package status and current release wording.
- [x] **P0 — Verify public installation and release claims.** Published `v0.1.9` release targets the tagged commit and contains `.deb`, SHA256SUMS, and SBOM; downloaded assets pass checksums, package metadata is `otelux 0.1.9 amd64`, and the installed package reports `0.1.9 install ok installed`. Packaged functional/performance smoke passed in release CI.
- [ ] **P0 — Configure GitHub security controls.** Enable private vulnerability reporting, secret scanning, push protection, Dependabot, and CodeQL; verify each control is active after visibility changes.
- [ ] **P0 — Protect `main`.** Require pull requests and green CI, block force pushes/deletion, and require branches to be current before merge. Decide whether signed commits and linear history are required.
- [x] **P0 — Verify community and security documents.** LICENSE is detected as MIT; README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT, issue form, and PR template exist. The Code of Conduct accurately discloses the sole-maintainer model and uses the maintainer's private profile contact rather than claiming an unavailable independent escalation path.
- [ ] **P0 — Final public flip verification.** Confirm CI and CodeQL run publicly, the vulnerability-reporting flow works, release links/checksums resolve, repository metadata is accurate, and no public-facing document still says “private repository.”

## Important after visibility, before stable-product claims

- [ ] Add SQL statement-count and `EXPLAIN QUERY PLAN` regression budgets.
- [ ] Add runtime validation, checked-in wire schemas/codecs, and compatibility fixtures for IPC/HTTP/MCP boundaries.
- [ ] Complete accessibility qualification, coverage thresholds, full packaged regression, and security-response/patch runbooks.
- [ ] Recruit external beta users and disposition every P0/P1 plus accepted P2 issues.

## Explicitly not OSS visibility blockers

- Standalone daemon, browser workbench, CLI, independent plugin packaging, OTLP/gRPC, Windows/macOS signing, service UI, time-window agent correlation, FTS5, profiles, and service maps remain normal public roadmap items.

## Hiccups & Notes

- Public repository readiness is narrower than stable-release readiness. Do not delay visibility for roadmap features, but do not overstate platform support or product maturity.
- Branch protection currently returns GitHub `403` because the private user-owned repository requires GitHub Pro or public visibility. Private vulnerability reporting returns `404` while private. Configure and verify both immediately after the visibility flip.
- The owner accepted the sole-maintainer conduct-reporting limitation. The repository documents it explicitly and will add independent escalation when more maintainers join.

## Exit criteria

```text
full-history scans clean
current-tree privacy audit clean
community/security docs accurate
GitHub security controls active
main protected
CI/CodeQL green
release and install claims independently verified
```

## Final outcome

Sprint ready for execution in a new session.
