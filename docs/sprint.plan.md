# Sprint — Public OSS readiness

## Goal

Make the repository safe, accurate, and maintainable to expose publicly without waiting for unrelated product-roadmap work. Public visibility is not the same as declaring a stable cross-platform product release.

## Essential gates before visibility

- [ ] **P0 — Re-run full-history secret scans.** Run pinned Gitleaks and TruffleHog against every commit; record versions, commands, commit count, and zero-secret evidence.
- [ ] **P0 — Audit the current tree for private data.** Review fixtures, screenshots, generated artifacts, docs, examples, telemetry payloads, home paths, private endpoints, emails, and configuration files. Replace or remove anything sensitive.
- [ ] **P0 — Reconcile product claims and roadmap state.** Remove stale statements that mark shipped pagination, worker isolation, backpressure, service overview, or correlation as pending; clearly label unsupported or experimental behavior.
- [ ] **P0 — Verify public installation and release claims.** From a clean machine/profile, verify the published `.deb`, SHA256SUMS, SBOM, install, upgrade, launch, ingest, restart, and uninstall instructions. Ensure limitations and privacy boundaries are visible.
- [ ] **P0 — Configure GitHub security controls.** Enable private vulnerability reporting, secret scanning, push protection, Dependabot, and CodeQL; verify each control is active after visibility changes.
- [ ] **P0 — Protect `main`.** Require pull requests and green CI, block force pushes/deletion, and require branches to be current before merge. Decide whether signed commits and linear history are required.
- [ ] **P0 — Verify community and security documents.** Confirm LICENSE detection plus accurate README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, support guidance, issue forms, and PR template. Name an independent confidential conduct contact/channel.
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
- Several GitHub controls require repository-owner actions in the web settings and cannot be completed by source changes alone.

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
