# OTelux — Linux-Native OpenTelemetry Viewer

A GPU-accelerated, native Linux OpenTelemetry viewer written in pure C.
Inspired by Ghostty's philosophy: native, minimal deps, fast, lightweight.

## Vision

Replace Electron/web-based OTEL viewers (Jaeger UI, SigNoz, Aspire Dashboard) with a
native Linux application that renders at 60fps, starts in milliseconds, and uses
single-digit MB of RAM. Receive OTLP data (gRPC/HTTP) and visualize traces,
metrics, and structured events with GPU-accelerated rendering.

---

## Technology Stack

### Core

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | **C17** (gcc/clang) | Maximum native performance, no runtime, direct OpenGL/GTK access |
| Build | **Meson + Ninja** | Fast, C-native build system; simpler than CMake for pure C |
| Windowing | **GTK 4** | Native Linux look-and-feel, Wayland+X11 support, widget toolkit |
| GPU Rendering | **OpenGL 3.3 Core** | Hardware-accelerated 2D rendering for timelines, charts, text |
| GL Loader | **GLAD** | Lightweight, generates only needed GL functions |

### Text & Fonts

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Font loading | **FreeType 2** | Industry standard glyph rasterization |
| Text shaping | **HarfBuzz** | Correct glyph positioning, ligatures, international text |
| Font discovery | **Fontconfig** | System font selection on Linux |
| Rendering technique | **Texture atlas + SDF** | Batch all glyphs into one texture; signed-distance-field for resolution-independent text at any zoom |

### Data & Protocol

| Component | Choice | Rationale |
|-----------|--------|-----------|
| OTLP ingest | **Custom C** (protobuf-c) | Receive OTLP/gRPC and OTLP/HTTP (protobuf + JSON) |
| Protobuf | **protobuf-c** | Pure C protobuf implementation, minimal |
| HTTP server | **libmicrohttpd** | Lightweight embedded HTTP for OTLP/HTTP endpoint |
| gRPC | **Custom over HTTP/2** (or start HTTP-only) | Phase 1: HTTP/JSON only; gRPC later |
| Storage | **SQLite** | Embedded, zero-config, fast queries for spans/metrics/events |
| JSON parsing | **cJSON** | Tiny, single-file C JSON parser for OTLP/HTTP JSON payloads |

### Minimal Dependency Summary

```
Runtime deps (linked):
  libgtk-4          — windowing, widgets, input
  libGL (Mesa)      — OpenGL implementation
  libfreetype       — font rasterization
  libharfbuzz       — text shaping
  libfontconfig     — font discovery
  libsqlite3        — data storage
  libprotobuf-c     — protobuf decoding
  libmicrohttpd     — HTTP server
  libcjson          — JSON parsing

Vendored (compiled into binary):
  GLAD              — OpenGL loader (single .c/.h)
  stb_image.h       — icon/image loading (header-only)

System (implicit):
  libc, libm, libpthread, libdl
```

Total: ~10 runtime deps. No Python, no Node, no Electron, no JVM.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        OTelux                           │
├──────────┬──────────┬──────────┬────────────────────────┤
│  Ingest  │  Store   │  Query   │       UI / Render      │
│          │          │          │                        │
│ OTLP/HTTP│ SQLite   │ SQL      │  GTK4 Window           │
│ protobuf │ WAL mode │ queries  │  ├─ Nav sidebar        │
│ cJSON    │          │          │  ├─ GL viewport (main)  │
│          │          │          │  │  ├─ Trace waterfall  │
│          │          │          │  │  ├─ Metric charts    │
│          │          │          │  │  └─ Event table      │
│          │          │          │  └─ Detail panel        │
└──────────┴──────────┴──────────┴────────────────────────┘
```

### Key Design Decisions

1. **GTK for chrome, OpenGL for content**: GTK handles window, menubar, sidebar,
   toolbar, scrollbars, dialogs. The main content area is a `GtkGLArea` where all
   data visualization (waterfall, charts, tables) is rendered via OpenGL shaders.
   This gives native widget look with GPU-accelerated data rendering.

2. **Orthographic 2D projection**: All rendering uses a 2D orthographic projection
   matrix mapping pixel coordinates directly (like LearnOpenGL's sprite/text
   rendering). No perspective needed.

3. **Batch rendering**: Minimize draw calls. Text uses a glyph texture atlas.
   Rectangles (span bars, chart fills) use instanced rendering. Lines use a single
   VBO with all line segments.

4. **Immediate-mode data flow**: Data arrives via OTLP → stored in SQLite →
   queried on demand → rendered. No intermediate caches or complex state machines.

---

## UI Design (Inspired by Aspire Dashboard)

### Navigation (GTK sidebar)

```
┌──────────────────────────────┐
│ 🔭 OTelux                   │
├──────────────────────────────┤
│  📊 Traces                  │  ← Phase 1
│  📈 Metrics                 │  ← Phase 2
│  📋 Events                  │  ← Phase 3
├──────────────────────────────┤
│  ⚙  Settings                │
└──────────────────────────────┘
```

### Traces View — List (Phase 1a)

```
┌─ Toolbar ─────────────────────────────────────────────────────┐
│ [Service ▼]  [🔍 Search...]  [Span Type ▼]  [⏸ Pause] [🗑]  │
├───────────┬──────────────┬────────────┬───────────┬───────────┤
│ Timestamp │ Name         │ Spans      │ Duration  │ Status    │
├───────────┼──────────────┼────────────┼───────────┼───────────┤
│ 14:23:01  │ GET /api/usr │ svc-a(3)   │ ████ 45ms │ ✓         │
│ 14:23:00  │ POST /order  │ svc-b(7)   │ ██ 120ms  │ ✗         │
│ 14:22:58  │ GET /health  │ svc-a(1)   │ █ 2ms     │ ✓         │
│ ...       │              │            │           │           │
└───────────┴──────────────┴────────────┴───────────┴───────────┘
```

- Duration column: GPU-rendered proportional bar (OpenGL quad)
- Virtualized scrolling: only render visible rows
- Color-coded status: green/red left border per row

### Traces View — Waterfall Detail (Phase 1b)

```
┌─ Trace: GET /api/users  [abc123...]  ─────────────────────────┐
│ [🔍 Search spans]  [Span Type ▼]                              │
├───────────────────────────────────────────────────────────────┤
│ ◀─────────── 45ms ──────────────▶                             │
│                                                               │
│ ▼ gateway        ████████████████████████████████  0ms  45ms  │
│   ▼ auth-svc       ████████████                   2ms  15ms  │
│       token-check     ██████                      3ms   8ms  │
│   ▼ user-svc           ██████████████████         16ms 40ms  │
│       db-query             ████████████           18ms 35ms  │
│       cache-set                    ████           36ms 39ms  │
│                                                               │
├─── Span Detail ──────────────────────────────────────────────┤
│ Service: user-svc          Duration: 24ms                     │
│ Kind: Server               Status: OK                        │
│                                                               │
│ ▼ Attributes                                                  │
│   http.method = GET                                           │
│   http.url = /api/users                                       │
│   http.status_code = 200                                      │
│ ▼ Resource                                                    │
│   service.name = user-svc                                     │
│   service.version = 1.2.3                                     │
└───────────────────────────────────────────────────────────────┘
```

- Span bars: OpenGL-rendered colored rectangles, proportional to duration
- Indentation: depth * offset for parent-child hierarchy
- Selected span highlighted; detail panel on right/bottom
- Horizontal time ruler at top (OpenGL-rendered tick marks + text)
- Pan/zoom on timeline via mouse drag / scroll wheel

### Metrics View (Phase 2)

```
┌─ Metrics ─────────────────────────────────────────────────────┐
│ ┌─ Meters ────────┐ ┌─ Chart ───────────────────────────────┐ │
│ │ ▼ http.server   │ │         requests/sec                  │ │
│ │    duration      │ │  100 ┤    ╭──╮                        │ │
│ │    request_count │ │   80 ┤   ╭╯  ╰╮    ╭╮                │ │
│ │ ▼ db.client     │ │   60 ┤  ╭╯    ╰╮  ╭╯╰╮               │ │
│ │    query_time    │ │   40 ┤ ╭╯      ╰──╯  ╰╮              │ │
│ │    pool_size     │ │   20 ┤╭╯               ╰──           │ │
│ │ ▶ runtime.gc    │ │    0 ┤┴────┴────┴────┴────┴           │ │
│ │                  │ │      10:00 10:05 10:10 10:15          │ │
│ │                  │ ├─ [Graph] [Table] ─────────────────────┤ │
│ │                  │ │ Filters: service=api  endpoint=/usr   │ │
│ └──────────────────┘ └───────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

- Left: GTK TreeView for meter/instrument hierarchy
- Right: OpenGL-rendered line chart with anti-aliased lines
- Histogram support: P50/P90/P99 lines with distinct colors
- Time axis with auto-scaling tick marks
- Hover tooltip with exact values

### Events View (Phase 3)

```
┌─ Structured Events ───────────────────────────────────────────┐
│ [Service ▼]  [Level ▼]  [🔍 Search...]                       │
├───────┬───────────┬────────────────────────┬─────────┬────────┤
│ Level │ Timestamp │ Message                │ Scope   │ Source │
├───────┼───────────┼────────────────────────┼─────────┼────────┤
│ 🔴 ERR│ 14:23:01  │ Connection refused     │ db.pool │ svc-b  │
│ 🟡 WRN│ 14:23:00  │ Retry attempt 3/5     │ http    │ svc-a  │
│ 🔵 INF│ 14:22:58  │ Request completed     │ handler │ svc-a  │
│ ⚪ DBG│ 14:22:57  │ Cache miss key=usr:42  │ cache   │ svc-b  │
└───────┴───────────┴────────────────────────┴─────────┴────────┘
```

- Row background tinted by severity level
- Click to expand detail panel with attributes, exception info, trace correlation
- Link to trace view when TraceId is present

---

## OpenGL Rendering Strategy

### Technique Reference (from LearnOpenGL)

| Technique | Application in OTelux |
|-----------|----------------------|
| **Orthographic projection** | All 2D rendering, pixel-coordinate mapping |
| **Sprite/quad rendering** | Span bars, chart fills, table cells, icons |
| **FreeType text rendering** | All text labels, values, timestamps |
| **Texture atlas** | Batch all ASCII glyphs into one texture, single draw call |
| **SDF text** | Resolution-independent text for zoom on waterfall |
| **Instanced rendering** | Hundreds of span bars in waterfall, chart data points |
| **Line rendering** | Chart lines, grid lines, timeline rulers |
| **Framebuffer objects** | Off-screen render for smooth scrolling / caching |
| **Blending** | Text transparency, semi-transparent overlays |
| **Scissor test** | Clip rendering to panels/regions |

### Shader Programs

```
shaders/
  quad.vert / quad.frag         — colored rectangles (span bars, backgrounds)
  text.vert / text.frag         — glyph texture rendering (FreeType atlas)
  line.vert / line.frag         — anti-aliased lines (charts, grid)
  rounded_rect.vert / .frag    — rounded rectangles (badges, buttons)
```

### Rendering Pipeline per Frame

```
1. Clear framebuffer
2. Set orthographic projection = window size
3. For each visible panel:
   a. Set scissor rect to panel bounds
   b. Render background quad
   c. Render data:
      - Trace list: row quads + text batch
      - Waterfall: span bar quads (instanced) + text + ruler lines
      - Chart: line strip + fill quad + axis text
   d. Render overlays (selection highlight, hover tooltip)
4. Swap buffers (GTK handles via GtkGLArea)
```

---

## Data Model (SQLite Schema)

```sql
-- Traces
CREATE TABLE traces (
    trace_id     TEXT PRIMARY KEY,
    root_name    TEXT,
    service_name TEXT,
    start_time   INTEGER,  -- unix nanos
    duration     INTEGER,  -- nanos
    span_count   INTEGER,
    has_error    INTEGER
);

-- Spans
CREATE TABLE spans (
    span_id       TEXT PRIMARY KEY,
    trace_id      TEXT NOT NULL,
    parent_span_id TEXT,
    name          TEXT,
    service_name  TEXT,
    kind          INTEGER,  -- 0=internal,1=server,2=client,3=producer,4=consumer
    start_time    INTEGER,
    duration      INTEGER,
    status        INTEGER,  -- 0=unset,1=ok,2=error
    attributes    TEXT,     -- JSON
    events        TEXT,     -- JSON array
    FOREIGN KEY (trace_id) REFERENCES traces(trace_id)
);
CREATE INDEX idx_spans_trace ON spans(trace_id);
CREATE INDEX idx_spans_time ON spans(start_time);

-- Metrics
CREATE TABLE metric_points (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT,
    unit          TEXT,
    type          INTEGER,  -- gauge, counter, histogram
    service_name  TEXT,
    timestamp     INTEGER,
    value         REAL,
    attributes    TEXT,     -- JSON
    exemplar_trace_id TEXT
);
CREATE INDEX idx_metrics_name ON metric_points(name, timestamp);

-- Structured events (logs)
CREATE TABLE events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id      TEXT,
    span_id       TEXT,
    severity      INTEGER,
    timestamp     INTEGER,
    message       TEXT,
    scope         TEXT,
    service_name  TEXT,
    attributes    TEXT     -- JSON
);
CREATE INDEX idx_events_time ON events(timestamp);
CREATE INDEX idx_events_trace ON events(trace_id);
```

---

## Source Layout

```
otelux/
├── meson.build                  # top-level build definition
├── plan.md
├── README.md
├── src/
│   ├── main.c                   # entry point, GTK app init
│   ├── app.h / app.c            # application state, window lifecycle
│   │
│   ├── ingest/                  # OTLP data ingestion
│   │   ├── otlp_http.c          # HTTP endpoint (libmicrohttpd)
│   │   ├── otlp_proto.c         # protobuf decoding (protobuf-c)
│   │   └── otlp_json.c          # JSON decoding (cJSON)
│   │
│   ├── store/                   # data storage
│   │   ├── db.c                 # SQLite init, migrations, WAL
│   │   ├── traces.c             # trace/span CRUD
│   │   ├── metrics.c            # metric point CRUD
│   │   └── events.c             # event/log CRUD
│   │
│   ├── render/                  # OpenGL rendering engine
│   │   ├── gl_core.c            # GL context, shader compilation, projection
│   │   ├── quad.c               # quad/rectangle batch renderer
│   │   ├── text.c               # FreeType atlas, glyph rendering
│   │   ├── line.c               # line/polyline renderer
│   │   └── chart.c              # line chart renderer (metrics)
│   │
│   ├── ui/                      # GTK UI shell + GL viewports
│   │   ├── window.c             # main window, layout
│   │   ├── sidebar.c            # navigation sidebar (GTK)
│   │   ├── toolbar.c            # filter bar, search, controls (GTK)
│   │   ├── trace_list.c         # trace list view (GtkGLArea)
│   │   ├── trace_waterfall.c    # span waterfall (GtkGLArea)
│   │   ├── trace_detail.c       # span detail panel (GTK)
│   │   ├── metric_view.c        # metric chart + table (GtkGLArea)
│   │   └── event_list.c         # event log view (GtkGLArea)
│   │
│   └── util/                    # shared utilities
│       ├── color.c              # color palette, theme
│       ├── time_fmt.c           # timestamp formatting
│       └── arena.c              # arena allocator for per-frame allocs
│
├── shaders/                     # GLSL shader source files
│   ├── quad.vert / quad.frag
│   ├── text.vert / text.frag
│   ├── line.vert / line.frag
│   └── rounded_rect.vert / .frag
│
├── vendor/                      # vendored single-file deps
│   ├── glad/                    # GLAD OpenGL loader
│   ├── stb_image.h
│   └── cJSON.h / cJSON.c
│
├── proto/                       # OTLP protobuf definitions
│   ├── trace.proto
│   ├── metrics.proto
│   ├── logs.proto
│   └── common.proto
│
├── res/                         # resources
│   ├── fonts/                   # bundled font (e.g., JetBrains Mono)
│   └── icons/                   # app icon, status icons
│
├── test/
│   ├── testlib.h                # minimal test macros (ASSERT_*, RUN_TEST, etc.)
│   ├── unit/                    # L1 — unit tests (no I/O, no GPU, no network)
│   │   ├── test_otlp_json.c     # OTLP JSON parsing
│   │   ├── test_otlp_proto.c    # protobuf decoding
│   │   ├── test_store.c         # SQLite CRUD (in-memory DB)
│   │   ├── test_time_fmt.c      # timestamp formatting
│   │   ├── test_color.c         # color palette / theme helpers
│   │   ├── test_arena.c         # arena allocator
│   │   └── test_waterfall.c     # span tree → layout computation (no GL)
│   │
│   ├── integration/             # L2 — component integration tests
│   │   ├── test_ingest_store.c  # HTTP POST → ingest → query back from DB
│   │   ├── test_otlp_roundtrip.c # JSON encode → decode → verify lossless
│   │   ├── test_store_query.c   # complex queries: filter, sort, paginate
│   │   └── test_data_gen.c      # helpers: generate realistic trace/metric data
│   │
│   ├── render/                  # L3 — headless GPU render tests
│   │   ├── test_gl_quad.c       # render quad → read pixels → verify color
│   │   ├── test_gl_text.c       # render text → read pixels → verify glyph presence
│   │   ├── test_gl_waterfall.c  # render waterfall → screenshot → compare
│   │   └── ref/                 # reference screenshots for pixel comparison
│   │       ├── quad_basic.png
│   │       ├── text_hello.png
│   │       └── waterfall_5spans.png
│   │
│   ├── scripts/                 # L4 — manual / scripted verification
│   │   ├── smoke.sh             # build + start + send data + check HTTP 200
│   │   ├── send_traces.sh       # send sample traces via curl, verify in DB
│   │   ├── send_metrics.sh      # send sample metrics via curl
│   │   ├── send_events.sh       # send sample events via curl
│   │   ├── load_test.sh         # send 10k spans, measure ingest rate
│   │   ├── perf_render.sh       # start app, measure frame time with perf/strace
│   │   ├── screenshot.sh        # launch app, send data, take screenshot via xdotool
│   │   └── valgrind_check.sh    # run under valgrind, assert zero leaks
│   │
│   └── fixtures/                # shared test data
│       ├── sample_trace.json    # minimal valid OTLP trace (3 spans)
│       ├── sample_trace_deep.json  # deep nested trace (20 spans, 5 levels)
│       ├── sample_trace_error.json # trace with error spans
│       ├── sample_metrics.json  # gauge + counter + histogram
│       ├── sample_events.json   # structured logs at various severities
│       ├── malformed.json       # intentionally broken JSON
│       ├── empty_trace.json     # valid OTLP with zero spans
│       └── large_trace.json     # 500-span trace for perf testing
```

---

## Testing Strategy

Testing is a first-class concern from day one. Every task produces tests alongside
code. An agent (or human) can verify any iteration by running `ninja -C build test`
(L1+L2), `ninja -C build test-render` (L3), or `./test/scripts/smoke.sh` (L4+L5).

### Test Pyramid (5 layers)

```
            ┌─────────────┐
         L5 │  Perf/Chaos │  load_test.sh, valgrind_check.sh
            ├─────────────┤
         L4 │ Manual/Shell │  smoke.sh, send_traces.sh, screenshot.sh
            ├─────────────┤
         L3 │ Render Tests │  headless GL → framebuffer readback → pixel compare
            ├─────────────┤
         L2 │ Integration  │  multi-component: ingest→store→query, HTTP round-trip
            ├─────────────┤
         L1 │  Unit Tests  │  pure functions, no I/O, no GPU, no network
            └─────────────┘
```

### L1 — Unit Tests

**Scope**: Pure C functions. No file I/O (except in-memory SQLite), no GPU, no
network. Each test file is a standalone executable that returns 0 on success.

**What to test**:
- OTLP JSON parsing: valid payloads → correct struct fields
- OTLP JSON parsing: malformed input → graceful error, no crash
- SQLite store: insert/query/delete with `:memory:` database
- Time formatting: nanosecond timestamps → human-readable strings
- Color helpers: hex→rgba, theme lookups
- Arena allocator: alloc, reset, overflow behavior
- Waterfall layout: span tree → (x, y, width, depth) computation (pure math, no GL)

**Framework**: Custom minimal `testlib.h` — just macros:
```c
#define ASSERT_EQ(a, b)    do { if ((a) != (b)) { \
    fprintf(stderr, "FAIL %s:%d: %s != %s\n", __FILE__, __LINE__, #a, #b); \
    return 1; } } while(0)
#define ASSERT_STR_EQ(a, b) do { if (strcmp((a),(b)) != 0) { \
    fprintf(stderr, "FAIL %s:%d: \"%s\" != \"%s\"\n", __FILE__, __LINE__, a, b); \
    return 1; } } while(0)
#define ASSERT_TRUE(x)     ASSERT_EQ(!!(x), 1)
#define ASSERT_NULL(x)     ASSERT_EQ((void*)(x), NULL)
#define ASSERT_NOT_NULL(x) ASSERT_TRUE((x) != NULL)
#define RUN_TEST(fn)       do { printf("  %-40s", #fn); \
    if (fn() == 0) { printf("PASS\n"); pass++; } \
    else { printf("FAIL\n"); fail++; } } while(0)
```

No external test framework dep. Each `test_*.c` has its own `main()`.

**Run**: `ninja -C build test` (runs all L1+L2 via Meson's test runner)

**Convention**: Only write tests for **critical paths** — data integrity (parsing,
storage, queries), layout math, and system boundaries (HTTP, CORS, malformed input).
Do NOT write trivial getter/setter tests, color constant tests, or tests for pure
wrappers. See `spec.md` §Critical Test Matrix for the full list. Agent must run
`ninja -C build test` after every code change and see 0 failures before proceeding.

### L2 — Integration Tests

**Scope**: Multiple components wired together. May use real SQLite files, real
HTTP (localhost), real OTLP payloads. Still no GPU.

**What to test**:
- **Ingest → Store pipeline**: Start HTTP server on random port → POST OTLP JSON
  → query spans from SQLite → verify fields match
- **OTLP round-trip**: Generate spans → encode to JSON → decode → compare
  original vs decoded (lossless)
- **Store queries**: Insert 1000 spans across 50 traces → test filter by service,
  by duration range, by error status, with pagination
- **Edge cases**: empty traces, duplicate span IDs, traces arriving out of order,
  very long attribute values, Unicode in span names

**Run**: Same `ninja -C build test` — Meson runs these alongside L1. Integration
tests are marked with longer timeouts in `meson.build`.

**Convention**: Integration tests use a `test_data_gen.c` helper that produces
realistic OTLP data programmatically (random trace IDs, realistic service names,
nested span trees). This avoids brittle fixture coupling.

### L3 — Headless Render Tests

**Scope**: OpenGL rendering correctness without a visible window. Uses EGL +
offscreen framebuffer (or `GDK_BACKEND=x11` with Xvfb) to render to a
framebuffer, read pixels back with `glReadPixels`, and compare against reference
images.

**What to test**:
- Quad renderer: render a colored rect → verify pixel color at known coordinates
- Text renderer: render "Hello" → verify non-zero pixels in expected glyph region
- Waterfall: render 5 spans → screenshot → pixel-diff against reference PNG
- Chart lines: render known data → verify line pixels at expected positions

**Reference images**: Stored in `test/render/ref/`. Updated manually when
rendering intentionally changes. Comparison uses a tolerance threshold (allow
<1% pixel diff for anti-aliasing variance).

**Run**: `ninja -C build test-render` (separate Meson test suite, requires GL)
In CI: runs under `xvfb-run` for headless GPU context.

**Convention**: Render tests are opt-in (not blocking for pure logic changes).
Agent should run them after any change to `src/render/` or `shaders/`.

### L4 — Manual/Scripted Verification

**Scope**: End-to-end shell scripts that build, launch the app, send data, and
verify observable behavior. Designed for both humans and agents.

**Scripts**:

| Script | What it verifies | Exit code |
|--------|-----------------|-----------|
| `smoke.sh` | Build succeeds, app starts, HTTP 200 on health endpoint, send 1 trace, query it back | 0 = pass |
| `send_traces.sh` | Send 5 sample traces, verify each appears in `sqlite3` query | 0 = pass |
| `send_metrics.sh` | Send sample metrics, verify stored in DB | 0 = pass |
| `send_events.sh` | Send sample events, verify stored in DB | 0 = pass |
| `screenshot.sh` | Launch app, send data, wait 2s, take screenshot via `import` (ImageMagick) or `grim` (Wayland) | saves PNG for visual review |
| `valgrind_check.sh` | Run app under Valgrind, send data, shut down, assert "0 errors" | 0 = no leaks |
| `load_test.sh` | Send 10k spans in parallel, measure wall time, assert < 5s | 0 = pass |
| `perf_render.sh` | Measure frame time for 500-span waterfall, assert < 4ms avg | 0 = pass |

**Run**: `./test/scripts/smoke.sh` — each script is self-contained.

**Convention**: `smoke.sh` is the go-to "did I break anything?" check. Agent
should run it after completing any phase task. All scripts use `set -euo pipefail`
and print clear PASS/FAIL output.

### L5 — Performance & Chaos Tests

**Scope**: Stress testing, leak detection, and boundary conditions that go beyond
normal integration tests.

**What to test**:
- **Memory leaks**: Valgrind memcheck on full ingest+render cycle
- **Load capacity**: 100k spans sustained ingest rate measurement
- **Large traces**: Single trace with 1000 spans, verify waterfall doesn't crash
- **Malformed input**: Send garbage, truncated JSON, wrong content-type, oversized
  payloads → verify app stays alive and returns proper HTTP errors
- **Long-running stability**: Run for 10 minutes, continuously ingest, check RSS
  stays bounded (no slow leak)

**Run**: `./test/scripts/load_test.sh`, `./test/scripts/valgrind_check.sh`

### Test Infrastructure in Meson

```meson
# test/meson.build

# --- L1: Unit tests ---
test('otlp_json',   executable('test_otlp_json',   'unit/test_otlp_json.c',   ...))
test('otlp_proto',  executable('test_otlp_proto',  'unit/test_otlp_proto.c',  ...))
test('store',       executable('test_store',       'unit/test_store.c',       ...))
test('time_fmt',    executable('test_time_fmt',    'unit/test_time_fmt.c',    ...))
test('color',       executable('test_color',       'unit/test_color.c',       ...))
test('arena',       executable('test_arena',       'unit/test_arena.c',       ...))
test('waterfall',   executable('test_waterfall',   'unit/test_waterfall.c',   ...))

# --- L2: Integration tests ---
test('ingest_store', executable('test_ingest_store', 'integration/test_ingest_store.c', ...),
     timeout: 30)
test('otlp_roundtrip', executable('test_otlp_roundtrip', 'integration/test_otlp_roundtrip.c', ...),
     timeout: 30)
test('store_query', executable('test_store_query', 'integration/test_store_query.c', ...),
     timeout: 30)

# --- L3: Render tests (separate suite, opt-in) ---
test('gl_quad',      executable('test_gl_quad',      'render/test_gl_quad.c',      ...),
     suite: 'render', timeout: 10)
test('gl_text',      executable('test_gl_text',      'render/test_gl_text.c',      ...),
     suite: 'render', timeout: 10)
test('gl_waterfall', executable('test_gl_waterfall', 'render/test_gl_waterfall.c', ...),
     suite: 'render', timeout: 10)
```

```bash
ninja -C build test                    # L1 + L2 (fast, no GPU needed)
ninja -C build test-render             # L3 (needs GL context)
./test/scripts/smoke.sh                # L4 (end-to-end)
./test/scripts/valgrind_check.sh       # L5 (leak check)
```

### Agent Verification Protocol

After every code change, the agent MUST run this sequence:

```
1. ninja -C build                      # compile — must succeed, 0 warnings
2. ninja -C build test                 # L1+L2 — must be 0 failures
3. (if render/ or shaders/ changed)
   xvfb-run ninja -C build test-render # L3 — must be 0 failures
4. ./test/scripts/smoke.sh             # L4 — must exit 0
```

If any step fails, fix before proceeding. Never skip tests to move forward.

### Autonomous UI Verification Loop (deskpal)

**`~/deskpal`** is a co-developed MCP server (TypeScript, `@modelcontextprotocol/sdk`)
that provides desktop automation tools: `screenshot`, `click`, `type_text`,
`key_press`, `list_windows`, `find_window`, `get_window_geometry`, etc. It runs
as an MCP server configured in `.vscode/mcp.json`.

The agent uses deskpal to **self-verify every visual change** without human
intervention:

```
1. ninja -C build && ./build/otelux --port 24318 &   # rebuild + launch
2. curl POST fixtures to /v1/traces                    # ingest test data
3. deskpal: list_windows → find OTelux window ID
4. deskpal: click (sidebar / trace row / span bar)     # navigate UI
5. deskpal: screenshot → visually verify render output
6. If wrong: fix code → goto 1
7. If correct: commit
```

**deskpal is co-owned** — when the verification loop needs new capabilities
(e.g., drag, pixel-color sampling, OCR, multi-monitor), update `~/deskpal`
alongside OTelux changes. Commit and push both repos to keep them in sync.

Key deskpal quirks to remember:
- HiDPI: window geometry reports physical pixels (2560×1600 at 2× = 1280×800 logical).
  Click coordinates are physical-pixel relative to window origin.
- `find_window("OTelux")` may match a hidden 2×2 window. Use full title
  `"OTelux — OpenTelemetry Viewer"` or `list_windows` to get the correct ID.
- GTK gesture handlers receive coordinates in logical (CSS) pixels, not physical.

### UI/UX Reference: Aspire Dashboard (`~/aspire`)

The Aspire Dashboard (`~/aspire/src/Aspire.Dashboard/`) is the primary UI/UX
reference for OTelux. Cross-reference it for:

| OTelux View | Aspire Reference |
|-------------|-----------------|
| Trace list | `Components/Pages/Traces.razor` — columns, sorting, filtering patterns |
| Waterfall | `Components/Pages/TraceDetail.razor` — span tree layout, depth indent, time ruler |
| Span detail | `Components/Dialogs/SpanDetailsDialog.razor` — attribute display, key-value layout |
| Metrics | `Components/Pages/Metrics.razor` — meter tree, chart types, time range |
| Events | `Components/Pages/StructuredLogs.razor` — severity colors, filtering, detail expand |
| Toolbar | `Components/Layout/MainLayout.razor` — filter bar, search, resource selector |

Also reference **Jaeger UI** (`~/jaeger-ui/packages/jaeger-ui/src/components/`)
for trace visualization patterns (especially `TracePage/TraceTimelineViewer/`)
and **SigNoz** (`~/signoz/frontend/src/`) for dashboard layout patterns.

When implementing a new view or refining an existing one:
1. Read the corresponding Aspire/Jaeger/SigNoz component to understand UX decisions
2. Adapt for native rendering (GTK chrome + OpenGL content)
3. Verify with deskpal screenshot loop
4. Commit both OTelux code and any deskpal enhancements needed

### Test Fixture Convention

All test fixtures live in `test/fixtures/`. Named by signal type + scenario:

```
sample_trace.json         — happy path, 3 spans, 2 services
sample_trace_deep.json    — 20 spans, 5 depth levels
sample_trace_error.json   — spans with status=ERROR, exception events
sample_metrics.json       — gauge + counter + histogram points
sample_events.json        — INFO/WARN/ERR log entries
malformed.json            — broken JSON (truncated, bad encoding)
empty_trace.json          — valid OTLP envelope, zero spans
large_trace.json          — 500 spans for perf testing
```

Fixtures follow the OTLP/HTTP JSON specification. Agent can generate additional
fixtures using `test/integration/test_data_gen.c` which outputs valid OTLP JSON
to stdout.

---

## Phased Plan

> **Priority order**: Traces (M1) ≫ Events (M2) > Metrics (M3) > Hardening (M4).
> Detailed specifications for each milestone are in `spec.md`.
> Traces must be feature-complete before starting Events or Metrics.

### Phase 1: Traces — Feature-Complete (M1)

| # | Task | Scope | Success Criteria | Test Verification |
|---|------|-------|-----------------|-------------------|
| 1.1 | **Project scaffold** | Build system, main.c, GTK window, testlib.h | `meson build && ninja -C build && ./build/otelux` shows a GTK window | `ninja -C build test` runs (even if 0 tests yet) |
| 1.2 | **Test fixtures + smoke script** | Create fixture JSONs, `smoke.sh` skeleton | `smoke.sh` builds binary and asserts it starts | L4: `smoke.sh` exits 0 |
| 1.3 | **OpenGL bootstrap** | GtkGLArea, GLAD, basic quad | Colored rectangle renders in GL viewport | L3: `test_gl_quad` reads pixels, verifies color |
| 1.4 | **Text rendering** | FreeType + texture atlas + shaders | "Hello OTelux" renders in GL viewport | L3: `test_gl_text` verifies glyph pixels; L1: `test_time_fmt` |
| 1.5 | **SQLite store** | Schema, init, span insert/query | Insert 1000 spans, query by trace_id < 1ms | L1: `test_store`; L2: `test_store_query` |
| 1.6 | **OTLP/HTTP ingest** | libmicrohttpd + cJSON, receive trace JSON | `curl` OTLP JSON to localhost:4318, spans appear in DB | L1: `test_otlp_json`; L2: `test_ingest_store`; L4: `send_traces.sh` |
| 1.7 | **Trace list view** | Scrollable list, columns, duration bars | Receive traces → see them in list, scroll through 10k+ | L4: `smoke.sh` (send + verify); L5: `load_test.sh` |
| 1.8 | **Trace waterfall** | Click trace → waterfall with span bars | Hierarchical spans, proportional bars, time ruler | L1: `test_waterfall` (layout math); L3: `test_gl_waterfall` |
| 1.9 | **Span detail panel** | Click span → attributes/resource panel | GTK panel shows all span metadata | L4: `smoke.sh` (visual); L2: round-trip attribute fidelity |
| 1.10 | **Filtering & search** | Service dropdown, text search, span type | Filter narrows displayed traces | L2: `test_store_query` filter paths; L4: `send_traces.sh` |
| 1.11 | **Leak & perf baseline** | Valgrind clean, frame time measured | Zero leaks, waterfall < 4ms | L5: `valgrind_check.sh`, `perf_render.sh` |

### Phase 2: Structured Events (M2)

| # | Task | Test Verification |
|---|------|-------------------|
| 2.1 | Event storage + OTLP log ingest | L1: `test_events_store`; L2: `test_ingest_events`; L4: `send_events.sh` |
| 2.2 | Event list view with severity coloring | L3: render verify severity colors |
| 2.3 | Event detail panel with attributes | L4: `smoke.sh` |
| 2.4 | Trace correlation (click TraceId → waterfall) | L2: verify event.trace_id → trace lookup |
| 2.5 | Log level filtering + full-text search | L2: `test_store_query` event filters |

### Phase 3: Metrics (M3)

| # | Task | Test Verification |
|---|------|-------------------|
| 3.1 | Metric point storage + OTLP metrics ingest | L1: `test_metrics_store`; L2: `test_ingest_metrics`; L4: `send_metrics.sh` |
| 3.2 | Meter/instrument tree sidebar (GTK TreeView) | L4: `smoke.sh` |
| 3.3 | Line chart renderer (OpenGL line strip + fill) | L3: `test_gl_chart` |
| 3.4 | Time axis with auto-scaling + pan/zoom | L1: `test_axis_ticks` (tick computation math) |
| 3.5 | Histogram percentile lines (P50/P90/P99) | L1: `test_percentile_calc`; L3: render verify |
| 3.6 | Table view toggle (GTK or GL-rendered table) | L4: `smoke.sh` |
| 3.7 | Dimension filters | L2: `test_store_query` filter by attributes |
| 3.8 | Exemplar → trace linking | L2: verify exemplar trace_id resolves to span |

### Phase 4: Production Hardening (M4)

| # | Task | Test Verification |
|---|------|-------------------|
| 4.1 | OTLP/gRPC ingest (HTTP/2 + protobuf binary) | L1: `test_otlp_proto`; L2: gRPC round-trip |
| 4.2 | Data retention / auto-purge | L2: insert old data → trigger purge → verify gone |
| 4.3 | Performance: 100k spans, 1M metric points smooth | L5: `load_test.sh` extended |
| 4.4 | Keyboard navigation + accessibility | L4: manual keyboard walkthrough script |
| 4.5 | Dark/light theme from system preference | L3: render both themes, compare screenshots |
| 4.6 | `.desktop` file, icon, Flatpak manifest | L4: `desktop-file-validate`, Flatpak build smoke |
| 4.7 | Man page, `--help`, CLI flags (port, db path) | L4: `./build/otelux --help` exits 0 with expected text |

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Cold start | < 100ms to first paint |
| Memory (idle) | < 20 MB RSS |
| Memory (10k traces) | < 100 MB RSS |
| Waterfall render (500 spans) | < 2ms frame time (500+ fps) |
| Trace list scroll (10k rows) | 60 fps, no jank |
| Binary size | < 5 MB (stripped) |
| OTLP ingest | > 10k spans/sec sustained |

---

## Build & Run (Target)

```bash
# Dependencies (Fedora/Ubuntu)
sudo dnf install gtk4-devel libGL-devel freetype-devel harfbuzz-devel \
                 fontconfig-devel sqlite-devel protobuf-c-devel \
                 libmicrohttpd-devel meson ninja-build

# Build
meson setup build
ninja -C build

# Run
./build/otelux                        # default: listen on :4318
./build/otelux --port 4318 --db /tmp/otelux.db

# Send test data
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @test/fixtures/sample_trace.json

# Run tests
ninja -C build test                    # L1 + L2 (fast, no GPU)
xvfb-run ninja -C build test-render    # L3 (headless GL)
./test/scripts/smoke.sh                # L4 (end-to-end)
./test/scripts/valgrind_check.sh       # L5 (leak detection)
```

---

## Next Action

**Current**: M1 trace feature-complete. Immediate priorities:
1. Fix HiDPI text blurriness (rasterize glyphs at physical pixel size) — see `spec.md` §M1.1
2. Add scroll + keyboard navigation (M1.5)
3. Polish trace list (sort, filters, error styling) (M1.2)
4. Polish waterfall (time ruler, expand/collapse, back-nav) (M1.3)
5. Add critical tests along the way: `test_store_filters`, `test_waterfall_layout`
