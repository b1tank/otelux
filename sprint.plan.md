# OTelux Sprint Plan

Date: 2026-05-12

## Goal

Pivot OTelux to a native-per-platform observability desktop architecture and carry the repository to the current foundation milestone with verified, atomic commits.

## Prioritized Tasks

1. [x] Rewrite `plan.md` around the new product architecture: C++ core, native UI shells, platform-specific rendering, and local-first observability workflows.
2. [x] Rewrite `spec.md` around the current milestone: a working native foundation with trace ingest, storage, query, and layout APIs ready for platform shells.
3. [x] Replace the build/source skeleton with a C++ core library, CLI smoke executable, and focused tests for the current milestone.
4. [x] Verify the build and tests locally.
5. [x] Commit each task atomically and push the branch.

## Hiccups & Notes

- The local Meson version cannot select `cpp_std=c++23`; it supports `c++20`, so the active build uses C++20 while keeping the architecture C++23-friendly.

## Final Status

- Completed the documentation pivot to a native-per-platform architecture.
- Added the C++ core foundation with C ABI, SQLite storage, OTLP-shaped JSON fixture ingest, trace query, waterfall layout, and smoke CLI.
- Verified with `meson setup build --wipe`, `ninja -C build`, and `ninja -C build test`.
