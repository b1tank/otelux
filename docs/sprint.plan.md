# Sprint — Compatibility-Aware Runtime Client Discovery

## Goal

Give Desktop and the future CLI one Node-side path to discover, authenticate, validate, and, when absent, start the per-user runtime before Desktop ownership moves out of Electron.

## Tasks

- [x] Add a Node runtime discovery client over the existing HTTP/SSE adapter.
- [x] Add bounded ensure/start polling with deterministic compatibility failures.
- [x] Cover live, absent, malformed, authentication, identity, and startup races.
- [x] Update runtime architecture and package documentation.
- [ ] Run full build and regression qualification.

## Hiccups & Notes

- Discovery derives the canonical runtime token path from the selected data directory; runtime state may describe endpoints but cannot redirect token reads to an arbitrary path.
- This sprint adds the reusable connection/start seam only. Daemon executable packaging and Desktop ownership transfer remain separate reviewable changes.
- Discovery validates the state schema, running API, canonical owner-only token, protocol initialization, and live instance identity. Ensure starts only when state is absent, retries transient unavailability, and fails closed on malformed/authentication/identity errors.
- A targeted workspace test argument propagated into the package's trailing `node --test scripts/*.node-test.mjs` command and tried to execute a TypeScript source file directly. The normal full package test command is the supported gate and passes.
