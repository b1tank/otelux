# OTelux — Native OpenTelemetry Workbench

OTelux is a local-first desktop workbench for OpenTelemetry data. It receives
telemetry from applications, stores it locally, and presents traces, logs,
metrics, and profiles through native desktop experiences on each platform.

The product goal is to feel like a first-class operating-system application,
not a web dashboard wrapped for desktop. Each platform shell uses the UI stack
that best fits that operating system while sharing a small, fast observability
engine underneath.

## Product Principles

| Principle | Direction |
|---|---|
| Native first | Use each OS's strongest desktop UI framework instead of a cross-platform web shell. |
| Local first | Optimize for a single developer inspecting telemetry from local apps and distributed dev environments. |
| Fast feedback | Cold start, ingest, search, and trace navigation should feel immediate. |
| Focused custom rendering | Use custom drawing for dense timelines and charts; use platform widgets for application UI. |
| Portable core | Keep ingest, storage, queries, and layout independent from every UI shell. |
| Stable boundary | Expose the shared engine through a small C ABI so SwiftUI, WinUI, Qt, GTK, and tests can call it safely. |

## Technology Stack

### Shared Core

| Layer | Choice | Rationale |
|---|---|---|
| Language | C++20 baseline, C++23-friendly | Native performance, mature systems ecosystem, strong platform integration, and excellent C ABI interop. |
| Public ABI | C handles and plain structs | Keeps platform shells decoupled from C++ templates, STL layout, exceptions, and compiler ABI details. |
| Build | Meson + Ninja | Fast native builds with first-class C++ support and simple test orchestration. |
| Storage | SQLite | Embedded, reliable, queryable, and well suited to local telemetry stores. |
| OTLP HTTP | Embedded HTTP receiver | Receives traces, logs, and metrics from local apps without a separate service requirement. |
| OTLP encoding | Protobuf first, JSON compatibility where useful | Aligns with production OpenTelemetry exporters while preserving developer-friendly fixtures. |
| Concurrency | Core-owned worker threads and explicit UI notifications | Keeps ingestion responsive without leaking threading assumptions into UI shells. |
| Testing | Unit and integration tests against the core API | Protects ingest, storage, query, and layout behavior independent of platform UI. |

### Platform Shells

| Platform | UI Stack | Role |
|---|---|---|
| Linux | Qt Quick/QML for broad desktop reach, with GTK/libadwaita as a possible GNOME-focused shell | Native Linux desktop app, trace/log/metric navigation, custom visualization surfaces. |
| macOS | SwiftUI with AppKit escape hatches | macOS-native navigation, preferences, inspectors, menus, and document-style workflows. |
| Windows | WinUI 3 / Windows App SDK | Windows-native navigation, command surfaces, settings, and system integration. |

The platform shell owns windowing, menus, keyboard focus, accessibility,
dialogs, preferences, theming, and standard controls. The shared core owns data,
queries, and reusable visualization layout math.

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                    Platform Native Shells                    │
│  Linux Qt/QML        macOS SwiftUI        Windows WinUI 3    │
├──────────────────────────────────────────────────────────────┤
│                         C ABI Layer                          │
│  handles, query structs, result ownership, notifications      │
├──────────────────────────────────────────────────────────────┤
│                         OTelux Core                          │
│  ingest  │  storage  │  query  │  layout  │  live updates    │
│  OTLP    │  SQLite   │  SQL    │  traces  │  subscriptions   │
└──────────────────────────────────────────────────────────────┘
```

### Core Responsibilities

- Start and stop local OTLP receivers.
- Decode OpenTelemetry traces, logs, metrics, and profiles as milestones require.
- Store telemetry in SQLite with retention-ready schema boundaries.
- Query trace lists, span lists, log tables, metric series, and profile summaries.
- Compute platform-neutral layout data for waterfalls, timelines, and charts.
- Emit lightweight change notifications so shells can refresh visible views.
- Keep ownership explicit: every allocated result has a matching free function.

### UI Responsibilities

- Present native navigation, toolbars, filters, split views, details, and settings.
- Render standard tables and forms with platform controls.
- Render dense visualizations using platform drawing APIs or focused custom GPU surfaces.
- Implement accessibility, keyboard navigation, menus, and platform-specific preferences.
- Avoid duplicating ingest, storage, query, and layout logic.

## Core API Shape

The ABI stays intentionally small and boring.

```c
typedef struct otelux_engine otelux_engine_t;
typedef struct otelux_trace_query otelux_trace_query_t;
typedef struct otelux_trace_list otelux_trace_list_t;
typedef struct otelux_waterfall otelux_waterfall_t;

otelux_engine_t* otelux_engine_create(const char* database_path);
void otelux_engine_destroy(otelux_engine_t* engine);

int otelux_engine_ingest_trace_json(otelux_engine_t* engine, const char* json, size_t length);

otelux_trace_list_t* otelux_query_traces(otelux_engine_t* engine, const otelux_trace_query_t* query);
otelux_waterfall_t* otelux_get_trace_waterfall(otelux_engine_t* engine, const char* trace_id);

void otelux_trace_list_destroy(otelux_trace_list_t* list);
void otelux_waterfall_destroy(otelux_waterfall_t* waterfall);
```

Platform shells can wrap this in idiomatic Swift, C++, Objective-C, C, or Rust
bindings without exposing internal core types.

## Current Milestone

The current milestone is the native core foundation for traces.

| Area | Target |
|---|---|
| Build | C++20 Meson project with a reusable `otelux_core` library. |
| Storage | SQLite schema for traces, spans, span attributes, span events, and resources. |
| Ingest | Minimal OTLP trace ingestion path suitable for fixtures and local smoke tests. |
| Query | Trace list filtering, sorting, pagination, and span retrieval. |
| Layout | Platform-neutral waterfall row and bar geometry. |
| Verification | Core tests for ingest, storage, query, and layout. |

## Repository Layout

```text
otelux/
├── meson.build
├── plan.md
├── spec.md
├── sprint.plan.md
├── src/
│   ├── core/
│   │   ├── api.h
│   │   ├── engine.cpp
│   │   ├── engine.hpp
│   │   ├── ingest/
│   │   ├── layout/
│   │   ├── model/
│   │   └── store/
│   ├── cli/
│   │   └── main.cpp
│   └── shells/
│       ├── linux/
│       ├── macos/
│       └── windows/
└── test/
    ├── unit/
    ├── integration/
    └── fixtures/
```

## Verification Loop

Every implementation change should pass:

```sh
meson setup build --wipe
ninja -C build
ninja -C build test
```

Platform shells add their own UI verification loops once they exist. Core tests
remain the first line of defense because all shells depend on the same engine.

## Product Roadmap

| Milestone | Goal |
|---|---|
| M1 | Trace workbench foundation: ingest, store, query, layout, and native-shell API. |
| M2 | Linux trace UI: trace list, waterfall, details, filters, and live refresh. |
| M3 | Structured logs: ingest, storage, query, detail inspection, and trace correlation. |
| M4 | Metrics: time-series storage, chart layout, exemplars, and metric browser. |
| M5 | Profiles: profile ingest, storage, flame graph layout, and trace/profile correlation. |
| M6 | Production hardening: retention, packaging, accessibility, import/export, and performance budgets. |

## Performance Budgets

| Interaction | Budget |
|---|---|
| Cold start to first window | Under 300 ms for warm filesystem cache. |
| Trace query for first page | Under 50 ms for 100k stored spans. |
| Waterfall layout | Under 16 ms for 10k visible span rows after query. |
| Native shell frame rate | 60 fps while scrolling common traces. |
| Memory baseline | Keep the core small enough that platform UI dominates idle memory. |

## Design Notes

- The app should open directly into the workbench, not a marketing-style landing page.
- Filters, search, details, and navigation should use native controls.
- Trace and metric visualization surfaces should be dense, readable, and fast.
- Layout data should be deterministic and testable without launching a UI.
- Cross-platform consistency means shared concepts and behavior, not identical pixels.
