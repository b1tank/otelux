# Sprint — Searchable span and log details

## Goal

Deliver the next pending workbench-polish task from `docs/plan.md`: let users search within span and log detail drawers without changing list selection, drawer behavior, or telemetry query semantics.

## Prioritized tasks

- [x] **P1 — Design the drawer search interaction.** Added one compact, keyboard-accessible search field beneath the drawer header in the HTML mockup and documented the decision.
- [x] **P1 — Add reusable detail-search UI.** Added a shared sticky search field, clear action, case-insensitive matching helper, visible focus treatment, and explicit no-match state.
- [x] **P1 — Search span details.** Span facts, attributes, resource, scope, events, and links now match visible key/value text while value-view actions and accordion state remain intact.
- [x] **P1 — Search log details.** Log facts, attributes, resource, and scope use the same matching and no-result contract.
- [x] **P2 — Update product and regression documentation.** Updated `docs/spec.md`, `docs/plan.md`, `docs/proposal.md`, and `docs/test.md` for shipped behavior.
- [x] **Verification.** Formatted edited files; focused SpanDetail (8/8) and LogsView (10/10) tests passed; full Turbo test/typecheck/build completed 30/30 tasks with 143 UI and 32 Desktop tests passing.

## Hiccups & Notes

- The first OpenCode smoke selected an unavailable Google image model; configuration was corrected before this sprint and is unrelated to the detail-search work.
- Deskpal isolated app launch failed closed because the current Deskpal server was started without `--allow-exec`. The sprint therefore used the required mockup source update plus focused DOM interaction tests and the full repository build. A packaged visual smoke remains a release-gate step.
- A focused test command from the repository root initially could not resolve the package-local Vitest binary; rerunning from `packages/ui` passed.

## Final outcome

Span and log drawers now keep a stable, keyboard-accessible search field at the top, filter sections and attribute rows case-insensitively, show an explicit no-match state, and restore all detail content through one clear action without changing the selected record. All automated checks pass.
