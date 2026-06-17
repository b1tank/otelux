# OTelux — Manual Test Plan

A human-friendly, exhaustive walk-through for verifying the desktop app end-to-end. Designed to be executed verbatim by a person clicking the UI, *and* mirrored by an agent doing self-verification through the repo's self-verify workflow.

Scope: the Electron app (`apps/desktop`) + the OTLP/HTTP receiver + `@otelux/ui` workbench rendered inside it. Not a unit/integration test plan — those live next to source.

> Throughout, **PASS** = behavior exactly matches the "Expected" line. Any deviation is a **FAIL** with a one-line note (what you saw vs. what was expected). Don't fix bugs while testing — log them.

---

## 0. Preflight

| Step | Action | Expected |
|------|--------|----------|
| 0.1 | `cd <repo-root>` | shell at repo root |
| 0.2 | `node --version` | `v22.x` (matches `.nvmrc`) |
| 0.3 | `npm run lint && npm run typecheck` | both exit 0, no errors |
| 0.4 | `npm run test` | all packages green (currently no `desktop` tests, fine) |
| 0.5 | `npm run build` | `apps/desktop/out/{main,preload,renderer}` exist; renderer `assets/index-*.js` >100 KB |
| 0.6 | `rm -rf /tmp/otelux-userdata && rm -f ~/.config/otelux/settings.json` *(only if you want a clean profile)* | no error |
| 0.7 | `ss -ltnp \| grep -E ':431[89]'` | no process listening — port is free |

---

## 1. Cold start (default port)

### 1.1 Launch
```bash
cd apps/desktop && npx electron out/main/index.js --user-data-dir=/tmp/otelux-userdata
```
- **Expected**:
  - main-process log line: `[otelux] OTLP/HTTP receiver listening on http://127.0.0.1:4319/v1/{traces,logs,metrics}`
  - Electron window opens within ~3 s
  - Window title: contains "OTelux" or "Electron"
  - `ss -ltnp | grep 4319` shows electron listening

### 1.2 Initial UI
- **Visible chrome (top → bottom, left → right)**
  1. Left **Rail** — narrow icon strip with the **Traces** tab active, enabled **Metrics** and **Logs** tabs below it, and a footer with the **Theme** switch above **GitHub** (external link) and the **Settings** cog (opens the settings modal).
  2. **Topbar** — `Traces` heading on the left, **EndpointBar** on the right (status dot, `OTLP/HTTP` label, URL `http://127.0.0.1:4319` as a click-to-copy pill). The copied URL is the receiver base URL; traces, logs, and metrics use the same host and port at `/v1/traces`, `/v1/logs`, and `/v1/metrics`. The settings cog lives on the rail, not in the topbar.
  3. **FilterBar** — hidden on cold start for Traces; it appears once at least one trace has been received and exposes a Service dropdown, an `Errors only` toggle chip, and a search field. Logs and Metrics expose their own filter controls when those tabs are active.
  4. **Workbench** body — right pane is collapsed (no waterfall yet); the left pane fills the width and shows the trace list with the `Traces` header, count `0`, and "Waiting for traces…" empty-state copy (or "No traces match. Point an OTel exporter at http://127.0.0.1:4319/v1/traces" once the first probe completes).
  5. No drawer / value-viewer modal is visible.
- **PASS** if the dot is green and the URL renders inside the topbar (no separate header strip above the workbench).

### 1.3 Persisted settings file
```bash
cat /tmp/otelux-userdata/settings.json 2>/dev/null
```
- **Expected**: file does NOT exist yet (settings only persist on user write). Defaults are in-memory.

---

## 2. EndpointBar — every interaction

### 2.1 Status dot tooltip
- Hover the dot.
- **Expected**: tooltip reads `listening on http://127.0.0.1:4319`.

### 2.2 URL copy
- Click the URL pill once.
- **Expected**:
  - The tooltip (button `title`) flips from `Click to copy` → `Copied` and the trailing icon morphs from the copy glyph to a green check for ~1.2 s, then both revert.
  - System clipboard now contains exactly `http://127.0.0.1:4319` — verify with `xclip -selection clipboard -o` or paste into a textbox.

### 2.3 URL copy spamming
- Click the URL 5 times rapidly.
- **Expected**: no crash, no JS error in DevTools console (Ctrl+Shift+I), the `Copied` tooltip + check icon reset cleanly each time without the row reflowing.

### 2.4 Settings cog opens settings
- Click the **Settings** cog at the bottom of the **rail** (not the topbar — the cog moved there in the redesign).
- **Expected**: backdrop dims, settings dialog appears centered, OTLP/HTTP port input focused with value selected (cursor highlights `4319`).

### 2.5 Theme switch
- Click the **Theme** button above **GitHub** in the left rail.
- **Expected**: the title cycles `Theme: Auto (...)` → `Theme: Light` → `Theme: Dark` → `Theme: Auto (...)`. Light mode uses a bright workbench surface, dark mode returns to the dark surface, and muted labels/timestamps stay readable in both themes.

---

## 3. SettingsModal — open/close interactions

For each of the close paths, reopen the modal via the rail's Settings cog before the next step.

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Click **✕** (header close button) | modal closes; receiver unchanged |
| 3.2 | Click **Cancel** | modal closes; receiver unchanged |
| 3.3 | Press **Escape** | modal closes; receiver unchanged |
| 3.4 | Click anywhere on dimmed area outside the modal | modal closes; receiver unchanged |
| 3.5 | Click on the modal body (e.g. on the heading) | modal stays open (no propagation to backdrop) |
| 3.6 | Tab from port input | focus reaches Cancel, then Save, then loops back |

---

## 4. SettingsModal — validation matrix

Open settings (rail → Settings cog) before each row. After each row hit Cancel unless the row saves successfully.

| Step | Input | Click | Expected |
|------|-------|-------|----------|
| 4.1 | empty | Save | inline error: `Port must be an integer between 1 and 65535.` |
| 4.2 | `0` | Save | same inline error |
| 4.3 | `-1` | Save | same inline error |
| 4.4 | `65536` | Save | same inline error |
| 4.5 | `abc` | Save | `<input type=number>` may reject; if value reaches submit, same inline error |
| 4.6 | `99999` | Save | same inline error |
| 4.7 | `12.5` | Save | parses as `12`, see 4.8 outcome (success) — confirm coercion is intentional |
| 4.8 | `14320` | Save | modal closes; receiver dot transitions starting→running; URL updates to `http://127.0.0.1:14320`; `cat /tmp/otelux-userdata/settings.json` shows `{"version":1,"otlp":{"port":14320}}` |
| 4.9 | `14320` again | Save | no-op rebind (still running on 14320), modal closes |
| 4.10 | `22` (privileged, on Linux not allowed for non-root) | Save | inline error like `failed to bind 127.0.0.1:22: EACCES` (or EADDRINUSE if something runs there); EndpointBar dot turns **red**; URL replaced by status text. Reopen settings from the rail, enter `14320`, Save → recovers to green. |
| 4.11 | While 4.10 is in error state, click URL area | no copy (URL is hidden in error state); status-text span is plain text |

### 4.12 Port already in use
Open a second listener:
```bash
python3 -c "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',14321)); s.listen(1); time.sleep(60)" &
```
Then settings → set `14321` → Save.
- **Expected**: inline error `failed to bind 127.0.0.1:14321: EADDRINUSE` (or similar), dot **red**.
- Recover: kill the python listener, retry Save with `14320`. Dot returns green.

---

## 5. Settings persistence

### 5.1 Survives restart
1. Quit Electron (window close).
2. Confirm port released: `ss -ltnp | grep 14320` → empty.
3. Relaunch without env override: `cd apps/desktop && npx electron out/main/index.js --user-data-dir=/tmp/otelux-userdata`
- **Expected**: log shows `listening on http://127.0.0.1:14320/v1/{traces,logs,metrics}` (loaded from settings.json), EndpointBar URL reflects 14320.

### 5.2 Env override is one-shot
1. Quit Electron.
2. Relaunch with `OTELUX_OTLP_PORT=14999 npx electron out/main/index.js --user-data-dir=/tmp/otelux-userdata`
- **Expected**:
  - log shows `listening on http://127.0.0.1:14999/v1/{traces,logs,metrics}`
  - `cat /tmp/otelux-userdata/settings.json` still shows `{"otlp":{"port":14320}}` — **env did NOT mutate file**
  - Open settings modal → input shows persisted `14320` (matches file, not the env port)
  - Quit + relaunch without env → returns to 14320

### 5.3 Corrupt settings tolerated
1. Quit.
2. `echo 'this is not json' > /tmp/otelux-userdata/settings.json`
3. Relaunch.
- **Expected**: no crash, log shows `listening on http://127.0.0.1:4319/v1/{traces,logs,metrics}` (default), settings modal shows `4319`.
4. Save `14320` from the modal — `settings.json` is rewritten as valid JSON.

### 5.4 Invalid-shape settings tolerated
1. Quit.
2. `echo '{"version":99,"unknown":true}' > /tmp/otelux-userdata/settings.json`
3. Relaunch.
- **Expected**: same fallback to 4319. Save → file gets rewritten in the current shape.

### 5.5 Env validation
1. Quit.
2. `OTELUX_OTLP_PORT=abc npx electron out/main/index.js --user-data-dir=/tmp/otelux-userdata`
- **Expected**: log warns about invalid env, falls back to persisted port. App does **not** crash.

---

## 6. Trace ingest (happy paths)

App must be running (any port). Pick the matching `PORT` for each `send-traces.sh` call.

### 6.1 sample_trace.json
```bash
PORT=14320 ./scripts/send-traces.sh   # uses fixtures/sample_trace.json
```
- **Expected**:
  - curl response: `{"partialSuccess":{}}`
  - Trace list count goes from 0 → 1
  - New row at top shows wall-clock time, duration `45.0ms`, name `GET /api/users`, service chip `api-gateway`, `3 spans`

### 6.2 distributed_trace.json
```bash
FIXTURE=fixtures/distributed_trace.json PORT=14320 ./scripts/send-traces.sh
```
- **Expected**: count increments; row appears with multiple service chips (different colors).

### 6.3 sample_trace_error.json
```bash
FIXTURE=fixtures/sample_trace_error.json PORT=14320 ./scripts/send-traces.sh
```
- **Expected**: row shows red `N err` badge alongside span count.

### 6.4 empty_trace.json
```bash
FIXTURE=fixtures/empty_trace.json PORT=14320 ./scripts/send-traces.sh
```
- **Expected**: curl 200, partialSuccess; trace list count unchanged (engine drops empty payloads — verify by checking count before/after).

### 6.5 Burst
Run sample_trace 20 times in a loop:
```bash
for i in {1..20}; do PORT=14320 ./scripts/send-traces.sh >/dev/null; done
```
- **Expected**: no crashes, list shows 20+ rows in time-descending order, no duplicates flicker.

---

## 7. Trace list (selection + visuals)

### 7.1 Selection toggles highlight
- Click first row.
- **Expected**: row gains the `is-selected` modifier (the `<li>` is `otelux-trace-row is-selected`) and visibly changes background, main pane switches from placeholder to waterfall.

### 7.2 Select different row
- Click second row.
- **Expected**: previous row deselects, new row selects, waterfall updates, span detail drawer resets to "Select a span to inspect its attributes." or "No span selected." depending on data.

### 7.3 Keyboard navigation
- Tab to a row's button, press Enter.
- **Expected**: same as click. (If keyboard doesn't work, log as P2 a11y bug; not a release blocker.)

### 7.4 Service chip colors
- Compare a `api-gateway` chip in two different rows.
- **Expected**: identical color across rows (deterministic from service name hash).

---

## 8. Waterfall

Select a distributed_trace.json row (multi-service, multiple spans).

### 8.1 Header
- **Expected**: top header shows root span name, total duration like `123.4ms`, span count like `7 spans`.

### 8.2 Bars
- **Expected**:
  - Bars stacked vertically, one per span.
  - X-axis represents time relative to root start.
  - Each bar's left offset reflects child's start delay from root; width reflects own duration.
  - Bar color matches service chip color.

### 8.3 Span selection
- Click a non-root bar.
- **Expected**: row gets `--selected` styling; span detail drawer fills with attribute key/value pairs.

### 8.4 Select root then leaf
- Click root, then a leaf.
- **Expected**: span detail drawer swaps content, no stale attributes from previous span.

### 8.5 Span label truncation
- If a span name is long, hover/inspect to confirm overflow handled (ellipsis or truncate, no horizontal scroll explosion).

### 8.6 Change trace
- Click a different trace row in the sidebar.
- **Expected**: waterfall replaces; span detail drawer resets (no leftover span from the previous trace).

---

## 9. Span detail drawer

### 9.1 Attribute rows
- Select a span with attributes (distributed_trace.json `frontend` root).
- **Expected**: rows like `http.method = GET`, `http.target = /api/...` — keys monospace, values readable.

### 9.2 Span without attributes
- If a fixture span has no attributes, the span detail drawer shows empty-state copy ("No attributes." or similar) — confirm no JS error.

### 9.3 Click-through
- Click the trace name in the waterfall header (if it's a button) — confirm it doesn't crash.

---

## 10. Malformed / hostile input

### 10.1 Bad JSON
```bash
curl -s -X POST -H 'Content-Type: application/json' --data-binary '@fixtures/malformed.json' http://127.0.0.1:14320/v1/traces -o /tmp/r.txt -w '%{http_code}\n'
```
- **Expected**: 4xx (e.g. 400). App stays running, list unaffected.

### 10.2 Wrong content-type
```bash
curl -s -X POST -H 'Content-Type: text/plain' --data 'hello' http://127.0.0.1:14320/v1/traces -o /tmp/r.txt -w '%{http_code}\n'
```
- **Expected**: 4xx, no crash.

### 10.3 Empty body
```bash
curl -s -X POST -H 'Content-Type: application/json' --data '' http://127.0.0.1:14320/v1/traces -o /tmp/r.txt -w '%{http_code}\n'
```
- **Expected**: 4xx, no crash.

### 10.4 Wrong path
```bash
curl -s http://127.0.0.1:14320/ -w '%{http_code}\n'
curl -s http://127.0.0.1:14320/v1/nope -X POST -H 'Content-Type: application/json' --data '{}' -w '%{http_code}\n'
```
- **Expected**: 404 for unknown paths. (`/v1/logs` and `/v1/metrics` are real ingest endpoints — exercised in §14 and §15.)

### 10.5 Oversize payload *(optional, will be slow)*
- Generate a 10 MB JSON body and POST. Confirm no OOM and either a 200 or controlled 4xx (depends on Hono limits).

---

## 11. Receiver lifecycle stress

### 11.1 Rapid port flips
- In settings, change port to 14321, Save. Wait for green. Change to 14322, Save. Repeat 5 times.
- **Expected**: no zombie listeners. After: `ss -ltnp | grep electron | wc -l` returns 1 (the final port). EndpointBar URL matches final port.

### 11.2 Save same port twice
- Set port to currently-running value, Save.
- **Expected**: rebind is a no-op or quick, dot stays green, no error.

### 11.3 Save while saving
- Open settings, change port, hit Save. While Saving… is showing (very brief — may need DevTools throttling), try to click Save again.
- **Expected**: button disabled, no double-submit. (If you can't repro because save is too fast, mark N/A.)

### 11.4 Settings while error
- Force an error (port 22), confirm dot red. Open settings — modal still opens, current input still shows the failed port. Fix to 14320 → recover.

---

## 12. Window / app lifecycle

### 12.1 Minimize / restore
- **Expected**: receiver keeps running (verify with curl from another terminal).

### 12.2 Close window
- **Expected**: app quits, port released within 1 s (`ss -ltnp | grep 14320` empty). settings.json preserved.

### 12.3 DevTools open
- Ctrl+Shift+I or Cmd+Alt+I.
- **Expected**: DevTools opens, console clean of red errors. Some warnings (e.g. React dev mode) may be acceptable; log anything from `otelux` namespace as a bug.

### 12.4 No GPU log noise in release build
- Run packaged build (when available) — `GetVSyncParametersIfAvailable() failed` messages are Chromium/Linux noise and acceptable in dev; in a packaged build they should be suppressed or reduced.

---

## 13. Negative receiver scenarios

### 13.1 No app running
```bash
curl -sf http://127.0.0.1:14320/v1/traces -X POST -H 'Content-Type: application/json' --data '{}'
```
- **Expected**: connection refused (curl exit 7). UI not testable here.

### 13.2 App crash recovery *(do not run unless you want to)*
- Kill the main process: `pkill -9 -f out/main/index.js`
- **Expected**: window closes immediately; relaunch works; settings preserved.

---

## 14. Logs ingest

The receiver accepts OTLP/HTTP logs at `/v1/logs`. Send the captured Codex log fixture and open the **Logs** tab.

### 14.1 Ingest the fixture
```bash
curl -s -X POST -H 'Content-Type: application/json' \
  --data-binary '@fixtures/sample_codex_logs.json' \
  http://127.0.0.1:14320/v1/logs -o /dev/null -w '%{http_code}\n'   # 2xx
```
- **Expected**: `{"partialSuccess":{}}`, HTTP 2xx. The **Logs** rail tab count increments from 0.

### 14.2 Rows render with a real timestamp
- Click the **Logs** tab.
- **Expected**: the table keeps visible headers for Level, Time, Service, Message, Trace, and Actions. Rows render with a **real wall-clock time**, not the Unix epoch. Codex emits `timeUnixNano: "0"` and carries the true emit time only in `observedTimeUnixNano`; the receiver must fall back to it. Each row shows a severity badge, the service chip (`codex_exec`), and the log body (or an attribute fallback like `event.name` when there is no body).

### 14.3 Detail drawer
- Click a row.
- **Expected**: the detail drawer opens showing the log body and the full attribute set (e.g. the user `prompt` content rides the logs pipeline in attributes, not traces).

### 14.4 Row actions and pivots
- On a correlated log row, click the action buttons.
- **Expected**: `Msg`, `Trace`, and `Span` copy actions copy the message and full IDs without opening the drawer. The waterfall pivot action switches to Traces and opens the matching span drawer when trace data for that ID is present. Rows without trace context omit trace/span copy and pivot actions so the Actions cell only shows controls that can work.

### 14.5 Filters
- Use the FilterBar service dropdown / severity / search.
- **Expected**: the row set narrows; the query is forwarded to the data source (count in the header reflects the filtered result).

---

## 15. Metrics ingest

The receiver accepts OTLP/HTTP metrics at `/v1/metrics`. Send the captured Codex metrics fixture and open the **Metrics** tab.

### 15.1 Ingest the fixture
```bash
curl -s -X POST -H 'Content-Type: application/json' \
  --data-binary '@fixtures/sample_codex_metrics.json' \
  http://127.0.0.1:14320/v1/metrics -o /dev/null -w '%{http_code}\n'  # 2xx
```
- **Expected**: `{"partialSuccess":{}}`, HTTP 2xx. The **Metrics** rail tab count increments.

### 15.2 Meter → instrument tree
- Click the **Metrics** tab.
- **Expected**: the view uses a split explorer. The left pane groups instruments by meter (scope) name and lists instruments below each meter. The right pane focuses the selected instrument. Codex emits monotonic Sums (`codex.api_request`, `codex.tool.call`, `codex.turn.token_usage`) and Histograms (`*_ms` durations like `codex.turn.e2e_duration_ms`, `codex.api_request.duration_ms`). The focused instrument shows name, type badge, unit, service, and a scan summary with Type, Service, Latest, Unit, Updated, and Points.

### 15.3 Instrument actions
- On the focused instrument, use the `Name`, `Data`, and details actions.
- **Expected**: `Name` copies the metric name, `Data` copies serialized metric data, and the details action opens a drawer with Instrument facts, Data points, Resource, and Scope sections.

### 15.4 Instrument chart + table toggle
- Select an instrument from the left pane.
- **Expected**: a chart renders its data points over time with visible time and value axes. Scalar charts aggregate raw attribute series that share the same export timestamp into one plotted total, avoiding vertical stacks of duplicate-time dots. A **graph / table** toggle switches between the chart and a raw data-point table (timestamp, value, attributes). Histograms render their bucket distribution.

### 15.5 Live update
- Re-send the fixture (or run a live Codex turn, see §E2E).
- **Expected**: the instrument list and selected chart update without a manual refresh (engine `metricsChanged` subscription).

---

## 16. Cleanup

After running the suite:
```bash
pkill -9 -f "out/main/index.js" 2>/dev/null
rm -rf /tmp/otelux-userdata
# Restore any background python listener you may have left from step 4.12.
```

---

## Failure log template

For each FAIL, capture in your test report:

```
Step: 4.10
Action: settings → port 22 → Save
Expected: inline error, red dot, URL hidden
Actual: <what happened>
Repro: 100% / intermittent
Severity: P1/P2/P3
Notes: …
```

---

## Quick smoke (60 seconds)

When you only have a minute (e.g. post-commit gate):

1. Build: `npm run lint && npm run typecheck && npm run build`
2. Launch: `cd apps/desktop && npx electron out/main/index.js --user-data-dir=/tmp/otelux-smoke &`
3. `sleep 3 && PORT=4319 ./scripts/send-traces.sh`
4. Click the trace, click any span — confirm waterfall + span detail drawer populate.
5. Rail → Settings cog → change port to a different one (e.g. `4399`) → Save → confirm green dot + new URL, then change back to `4319`.
6. Close window. `pkill -9 -f out/main/index.js`. Done.

---

## Agent self-verification

Mirror the relevant manual steps through `.agents/skills/self-verify/SKILL.md`. Use deskpal for visible UI checks; reserve CDP for invisible state such as IPC results, settings JSON, or focused element assertions.
