# Sprint — Searchable span and log details

## Goal

Deliver the next pending workbench-polish task from `docs/plan.md`: let users search within span and log detail drawers without changing list selection, drawer behavior, or telemetry query semantics.

## Prioritized tasks

- [ ] **P1 — Design the drawer search interaction.** Add one compact, keyboard-accessible search field beneath the drawer header in the HTML mockup and document the decision.
- [ ] **P1 — Add reusable detail-search UI.** Implement a shared search field and matching helpers with stable layout, clear action, visible focus, and an explicit no-match state.
- [ ] **P1 — Search span details.** Filter Span facts, attributes, resource, scope, events, and links by visible key/value text while preserving value-view actions and accordion behavior.
- [ ] **P1 — Search log details.** Apply the same contract to log facts, attributes, resource, and scope.
- [ ] **P2 — Update product and regression documentation.** Keep `docs/spec.md`, `docs/plan.md`, `docs/proposal.md`, and `docs/test.md` aligned with shipped behavior.
- [ ] **Verification.** Format edited files; run focused UI tests followed by full Turbo test/typecheck/build; perform a scoped Deskpal smoke when the desktop automation backend is available.

## Hiccups & Notes

- None yet.

## Final outcome

Sprint in progress.
