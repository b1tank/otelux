# OTelux — Milestone Specification

Version: 1.0 | Updated: 2026-05-09

## Milestone Overview

| # | Milestone | Priority | Goal |
|---|-----------|----------|------|
| **M1** | Trace Feature-Complete | **Critical** | Feature-parity with Aspire Dashboard trace views |
| **M2** | Structured Events (Logs) | Medium | Receive, store, and view OTLP log records |
| **M3** | Metrics | Low | Receive, store, and chart OTLP metrics |
| **M4** | Production Hardening | Low | gRPC, retention, packaging, a11y |

---

## M1 — Trace Feature-Complete

**Goal**: Emit OTLP traces from any app → receive them in OTelux → view them with
full context. Feature-parity with Aspire Dashboard trace views (minus AI features
and Fluent UI-specific widgets).

### M1.1 — Sharp HiDPI Text Rendering

**Problem**: FreeType rasterizes glyphs at logical pixel size (e.g. 16px). On a 2×
HiDPI display the glyph texture is stretched to 32 physical pixels via bilinear
interpolation → blurry text.

**Fix**: Rasterize glyphs at `font_size × scale_factor` physical pixels. Render
quad geometry at logical coordinates (unchanged projection). This gives pixel-perfect
text at any DPI.

| Item | Detail |
|------|--------|
| Rasterize at physical px | `FT_Set_Pixel_Sizes(face, 0, font_size * scale)` |
| Store physical glyph metrics | width/height/bearing in physical px |
| Render at logical size | Divide glyph metrics by scale for quad vertices |
| Scale-change handling | Re-init font atlas when scale factor changes |

**Test**: `test_text_hidpi` — render "Hello" at scale 1 and 2, verify glyph texture
dimensions differ by 2×.

### M1.2 — Trace List Polish

Feature-parity with Aspire `Traces.razor`:

| Feature | Aspire Behavior | OTelux Implementation |
|---------|-----------------|----------------------|
| **Columns** | Timestamp, Name, Spans (per-service), Duration, Status | Same 5 columns |
| **Duration bar** | Circular progress indicator + text | Horizontal bar + text (GPU) |
| **Error row styling** | Left red border + row tint | Red left bar (4px) + row tint overlay |
| **Service color coding** | Per-resource color from ColorGenerator | Per-service consistent hashing to palette |
| **Span count per service** | Color-coded tags per resource | Colored text badges per service |
| **Truncation** | Ellipsis on overflow | Truncate name to fit column width |
| **Virtualized scroll** | Virtual scrolling (46px row, 100 overscan) | GPU-rendered visible rows + scroll offset |
| **Row click → detail** | Navigate to TraceDetail page | GtkStack switch to waterfall view |
| **Sort by column** | Click column header to sort | Click header to toggle sort (time desc default) |
| **Total count footer** | "Showing X traces" | Bottom bar with count |

**Toolbar filters** (GTK widgets above the GtkGLArea):

| Filter | Type | Behavior |
|--------|------|----------|
| Service selector | GtkDropDown | Filter traces by service name |
| Name search | GtkSearchEntry | Filter by trace name substring |
| Span kind filter | GtkDropDown | All / Server / Client / Internal / Producer / Consumer |
| Status filter | GtkDropDown | All / OK / Error |
| Refresh button | GtkButton | Re-query DB and redraw |
| Clear button | GtkButton | Purge all traces from DB |

**Tests**:
- `test_store_filters` — verify service/kind/status SQL filters return correct subsets
- `test_store_sort` — verify sort by time, duration, name
- `test_store_pagination` — offset/limit returns correct page

### M1.3 — Trace Waterfall Polish

Feature-parity with Aspire `TraceDetail.razor`:

| Feature | Aspire Behavior | OTelux Implementation |
|---------|-----------------|----------------------|
| **Header** | Resource name + trace ID + start time + duration + resource count + depth + span count | Title bar: trace ID, duration, span count, max depth |
| **Time ruler** | 4-column grid: 0%, 25%, 50%, 75%, 100% tick marks | OpenGL tick marks + time labels at 5 evenly-spaced positions |
| **Span bars** | Colored by resource, positioned by start/duration relative to trace | Colored by span kind, proportional bar in bar area |
| **Span kind icons** | Server/Consumer get icon; others get colored left border | Colored bar + kind initial letter badge (S/C/I/P) |
| **Depth indent** | `(depth-1) * 15px` left margin | `depth * 20px` indent in label area |
| **Expand/collapse** | Chevron button; children hidden when collapsed | Chevron toggle; skip rendering collapsed children |
| **Error indicator** | Red error circle icon on span | Red semi-transparent overlay on bar + error icon |
| **Span events on bar** | Colored circular buttons at event time positions | Small diamond markers at event positions on bar |
| **Duration label** | Positioned left or right of bar based on space | Same: inside bar if overflow, else right of bar |
| **Selected span** | Highlighted row with different text color | Accent-tinted row highlight |
| **Click → detail** | Opens side panel with span details | Updates right-side detail panel |
| **Search filter** | Text input to filter span names | GTK search entry above GtkGLArea |
| **Expand/Collapse All** | Menu actions to toggle all | Toolbar buttons |
| **Back navigation** | Browser back / breadcrumb | "← Back" button + sidebar "Traces" click |
| **Scroll** | Virtual scrolling with overscan | Mouse wheel scrolling (scroll_offset) |
| **Resource column** | Shows resource name per span | Show service name right-aligned in label area |
| **Uninstrumented peers** | Sub-text for db/messaging/http peers | Sub-text with peer.service attribute |

**Tests**:
- `test_waterfall_layout` — given N spans with parent/child, verify computed
  depth, y-position, bar x/width calculations (pure math, no GL)
- `test_waterfall_collapse` — verify collapsed spans skip children in layout

### M1.4 — Span Detail Panel

Feature-parity with Aspire `SpanDetails.razor`:

| Section | Content |
|---------|---------|
| **Header** | Span name, resource/service name, duration, start offset from trace root |
| **Properties** | All span attributes as key=value list, searchable |
| **Context** | Source (instrumentation library), version, trace ID, span ID, parent ID |
| **Resource** | Resource attributes (service.name, service.version, etc.) |
| **Events** | Time-ordered span events with expandable attributes |
| **Links** | Cross-trace span links (trace_id + span_id → clickable) |

Implementation: GTK widget panel (not GL) to the right of the waterfall, scrollable.
Each section is a collapsible GtkExpander with a badge showing item count.

**Not implementing** (too complex / Aspire-specific):
- AI explain/GenAI features
- Backlinks (reverse link index)
- Fluent UI grid column manager
- Mobile responsive breakpoints

**Tests**:
- `test_span_attributes_parse` — verify JSON attributes parsed to key-value pairs
- `test_span_events_store` — verify span events stored and retrieved with attributes

### M1.5 — Scroll & Keyboard Navigation

| Feature | Detail |
|---------|--------|
| Mouse wheel scroll | Trace list and waterfall respond to scroll events |
| Page Up/Down | Scroll by visible-rows count |
| Arrow keys | Move selection up/down in trace list and waterfall |
| Enter | Trace list: open selected trace; Waterfall: open selected span detail |
| Escape | Waterfall: back to trace list |
| Home/End | Jump to first/last item |

**Test**: `test_scroll_bounds` — verify scroll_offset clamped to [0, total_rows - visible_rows]

### M1.6 — Live Streaming & Refresh

| Feature | Detail |
|---------|--------|
| Auto-refresh | Timer-based re-query (every 2s when not paused) |
| Pause/Resume | Toggle button to stop auto-refresh |
| Manual refresh | Button to force re-query |
| New trace indicator | Brief highlight on newly-arrived rows |

**Test**: `test_ingest_live` — POST trace, wait 3s, verify trace appears in store
(integration test with HTTP server running)

### M1.7 — Error Trace Styling

| Feature | Detail |
|---------|--------|
| Trace list | Red left border (4px) on error rows; row background tint |
| Waterfall | Red semi-transparent overlay on error span bars |
| Status column | ✓ (green) or ✗ (red) icon |
| Status filter | Toolbar dropdown: All / OK / Error |

**Test**: `test_error_trace_ingest` — ingest trace with status=ERROR spans, query
with status filter, verify correct filtering

---

## M2 — Structured Events (Logs)

**Goal**: Receive OTLP log records, store them, display in a filterable table
with severity coloring and trace correlation.

### M2.1 — Log Ingest & Storage

| Item | Detail |
|------|--------|
| Endpoint | POST `/v1/logs` (OTLP/HTTP JSON) |
| Schema | `events` table: id, timestamp, severity, body, scope, trace_id, span_id, attributes (JSON) |
| Parsing | cJSON parse of LogRecord: timeUnixNano, severityNumber, body.stringValue, attributes |

**Tests**:
- `test_events_store` — insert/query events by severity, time range, trace_id
- `test_otlp_logs_parse` — parse sample_events.json fixture, verify field extraction

### M2.2 — Event List View

| Feature | Detail |
|---------|--------|
| Columns | Severity icon, Timestamp, Message (body), Scope, Service |
| Severity colors | Red (ERROR), Yellow (WARN), Blue (INFO), Gray (DEBUG/TRACE) |
| Row background | Tinted by severity level |
| Click to expand | Show attributes, exception info below row |
| Trace correlation | Click TraceId link → navigate to waterfall |
| Filters | Severity dropdown, Service dropdown, Search text |
| Scroll | Virtualized like trace list |

### M2.3 — Event Detail Panel

| Section | Content |
|---------|---------|
| Header | Severity + timestamp + body |
| Attributes | Key-value list |
| Exception | If exception.type/message/stacktrace attributes present, show formatted |
| Trace link | Clickable trace_id → opens waterfall for that trace |

---

## M3 — Metrics

**Goal**: Receive OTLP metrics, store time-series data, display line/bar charts.

### M3.1 — Metrics Ingest & Storage

| Item | Detail |
|------|--------|
| Endpoint | POST `/v1/metrics` (OTLP/HTTP JSON) |
| Schema | `metric_points` table: name, type, value, timestamp, attributes, exemplar_trace_id |
| Types | Gauge, Sum (counter), Histogram (bucket counts + sum + count) |

### M3.2 — Meter Browser (left panel)

| Feature | Detail |
|---------|--------|
| Tree view | GTK TreeView: Meter → Instrument hierarchy |
| Click to chart | Select instrument → render chart on right |
| Instrument metadata | Name, description, unit shown on hover |

### M3.3 — Chart Rendering

| Feature | Detail |
|---------|--------|
| Line chart | OpenGL line renderer for gauge/counter time series |
| Histogram | Bar chart for histogram buckets |
| Time axis | Auto-scaling tick marks with formatted labels |
| Value axis | Auto-range with grid lines |
| Hover tooltip | Show exact value + timestamp at cursor position |
| Exemplar links | Click exemplar marker → navigate to trace waterfall |

---

## M4 — Production Hardening

| Feature | Detail |
|---------|--------|
| OTLP/gRPC | HTTP/2 + protobuf binary ingest |
| Data retention | Auto-purge by age or count (configurable) |
| Perf: 100k spans | Smooth scroll at 60fps |
| Dark/light theme | Follow system preference via GtkSettings |
| Keyboard a11y | Full keyboard navigation for all views |
| Packaging | .desktop file, icon, Flatpak manifest |
| CLI flags | --port, --db, --help, --version |

---

## Critical Test Matrix

Tests are organized by what they protect. Only critical paths — no trivial
getter/setter tests.

### Data Integrity (must never break)

| Test | What It Protects |
|------|-----------------|
| `test_otlp_json` | OTLP JSON parsing: spans, attributes, status, timestamps |
| `test_store` | SQLite CRUD: insert/query traces and spans, FK constraints |
| `test_ingest_store` | End-to-end: HTTP POST → parse → store → query back |
| `test_store_filters` | SQL filter correctness: service, kind, status, search |
| `test_store_sort` | Sort by time/duration/name returns correct order |
| `test_store_pagination` | Offset/limit pagination returns correct pages |
| `test_error_trace_ingest` | Error status propagates through ingest → store → query |
| `test_span_events_store` | Span events with attributes stored and retrieved |

### Layout Correctness (visual bugs)

| Test | What It Protects |
|------|-----------------|
| `test_waterfall_layout` | Span tree → depth/position/bar-width math (no GL) |
| `test_waterfall_collapse` | Collapsed spans correctly skip children |
| `test_scroll_bounds` | Scroll offset clamped to valid range |
| `test_text_hidpi` | Glyph textures rasterized at physical pixel size |

### Integration (system boundaries)

| Test | What It Protects |
|------|-----------------|
| `test_otlp_http_health` | HTTP server starts, /health returns 200 |
| `test_otlp_http_cors` | CORS headers present on OPTIONS and POST |
| `test_ingest_malformed` | Malformed JSON returns 400, doesn't crash |
| `test_ingest_live` | Trace ingested via HTTP appears in store within timeout |

### NOT testing (intentionally omitted)

- Individual getter/setter functions
- Color constant values
- Arena allocator internals (only test alloc+reset cycle)
- Shader compilation (tested implicitly by render tests)
- GTK widget creation (tested by app launch)

---

## Verification Loop

Every code change goes through:

```
1. ninja -C build                        # compile (0 warnings)
2. ninja -C build test                   # all tests pass
3. GDK_BACKEND=x11 ./build/otelux &     # launch app
4. curl POST test fixtures               # ingest data
5. deskpal: click → screenshot → verify  # visual check
6. Fix → repeat from 1
7. git commit + push
```

deskpal (`~/deskpal`) is co-maintained. If the verification loop needs new
capabilities, update deskpal first, commit+push, then continue OTelux work.

Cross-reference Aspire Dashboard (`~/aspire/src/Aspire.Dashboard/`) for UI/UX
decisions. See `plan.md` §UI/UX Reference for file mappings.
