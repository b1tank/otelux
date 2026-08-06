# Sprint — Compatibility-Aware Runtime Client Discovery

## Goal

Give Desktop and the future CLI one Node-side path to discover, authenticate, validate, and, when absent, start the per-user runtime before Desktop ownership moves out of Electron.

## Tasks

- [ ] Add a Node runtime discovery client over the existing HTTP/SSE adapter.
- [ ] Add bounded ensure/start polling with deterministic compatibility failures.
- [ ] Cover live, absent, malformed, authentication, identity, and startup races.
- [ ] Update runtime architecture and package documentation.
- [ ] Run full build and regression qualification.

## Hiccups & Notes

- Discovery derives the canonical runtime token path from the selected data directory; runtime state may describe endpoints but cannot redirect token reads to an arbitrary path.
- This sprint adds the reusable connection/start seam only. Daemon executable packaging and Desktop ownership transfer remain separate reviewable changes.
