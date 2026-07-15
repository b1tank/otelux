# OTelux — Manual Test Plan

Updated: 2026-07-13

A human-friendly, exhaustive walk-through for verifying the desktop app end-to-end. Designed to be executed verbatim by a person clicking the UI, *and* mirrored by an agent doing self-verification through the repo's self-verify workflow.

Scope: the Electron app (`apps/desktop`) + the OTLP/HTTP receiver + `@otelux/ui` workbench rendered inside it. Not a unit/integration test plan — those live next to source.

> Throughout, **PASS** = behavior exactly matches the "Expected" line. Any deviation is a **FAIL** with a one-line note (what you saw vs. what was expected). Don't fix bugs while testing — log them.

## Release Qualification

This file is the durable verification source of truth. Release-specific execution and evidence may live in a temporary sprint document, but deleting that document must not remove these gates.

Test quality is measured by release-risk coverage rather than by pursuing 100% line coverage:

- Unit tests cover parsing, formatting, filtering, layout, state transitions, and failure branches in shared packages.
- Storage contract tests run unchanged against memory and durable implementations, including migration, retention, corruption recovery, and interrupted writes.
- Receiver integration tests cover every supported signal and encoding, malformed and oversized requests, partial and empty payloads, bursts, concurrent ingest, and shutdown.
- OTLP and MCP transport tests reject unlisted browser origins by default, verify exact allowed-origin matching and `Vary: Origin`, and prove rejected requests neither invoke tools nor ingest telemetry.
- Desktop main/preload integration tests cover settings validation and migration, port rebinding, rollback after bind or persistence failure, IPC runtime validation, lifecycle cleanup, and the exposed context-bridge surface.
- Electron security tests assert sandboxing, context isolation, disabled Node integration, the narrow preload surface, rejected malformed IPC, blocked navigation and window creation, denied non-allowlisted permissions, and HTTPS-only external-link handling.
- MCP transport tests assert explicit enablement or authentication and reject missing or invalid credentials without returning telemetry.
- Packaged end-to-end tests launch release artifacts, ingest traces, logs, and metrics, exercise one inspection path per signal, restart, verify persistence, clear data, and exit without orphaned listeners.
- Accessibility checks combine automated scans with keyboard-only testing, focus order and return, dialog trapping, accessible names, both themes, high contrast, and 200% zoom.
- Performance checks use a checked-in representative workload and enforce the budgets in [spec.md](spec.md); large result sets remain responsive through bounds, pagination, or virtualization.
- CI publishes coverage for release-critical packages. Stable releases require checked-in thresholds of at least 80% line coverage and 70% branch coverage for `engine`, `engine-node`, `receiver`, `protocol`, `mcp-server`, and desktop main/preload code unless a documented exception demonstrates equivalent behavioral coverage.
- Every bug fixed during release work receives a regression test at the lowest useful layer.

A release candidate passes only when automated gates are green, this manual plan passes against packaged artifacts on every supported platform and architecture, and defect disposition satisfies the [release quality policy](spec.md#release-quality-policy).

Qualification profiles:

- A **stable release** passes every applicable gate above and every supported workflow in [spec.md](spec.md#supported-release-workflows).
- A **prerelease** may mark a capability N/A only when the specification permits the narrower surface, the app makes the limitation visible, and the README and release notes disclose it. All behavior the prerelease does advertise must still pass, and no P0/P1 defect may remain.
- Platform-specific steps run once for every platform and architecture advertised by that artifact set. Unsupported platforms are not failures; claiming an untested platform is.

---

## 0. Preflight

| Step | Action | Expected |
|------|--------|----------|
| 0.1 | `cd <repo-root>` | shell at repo root |
| 0.2 | `node --version` | `v22.x` (matches `.nvmrc`) |
| 0.3 | `npm run lint && npm run typecheck` | both exit 0, no errors |
| 0.4 | `npm run test` | all configured test projects pass with no unexplained warnings |
| 0.5 | `npm run build` | `apps/desktop/out/{main,preload,renderer}` exist; renderer `assets/index-*.js` >100 KB |
| 0.6 | `rm -rf /tmp/otelux-userdata` *(only if you want a clean profile)* | no error |
| 0.7 | `if ss -ltn \| grep -q -e ':4319 ' -e ':4320 '; then exit 1; fi` | exits 0 because neither default port is listening |

---

## 1. Cold start (default port)

### 1.1 Launch
```bash
cd apps/desktop && npx electron out/main/index.js --user-data-dir=/tmp/otelux-userdata
```
- **Expected**:
  - main-process log line: `[otelux] OTLP/HTTP receiver listening on http://127.0.0.1:4319/v1/{traces,logs,metrics}`
  - main-process log line: `[otelux] MCP server listening on http://127.0.0.1:4320/`
  - Electron window opens within ~3 s
  - Window title: contains "OTelux" or "Electron"
  - `ss -ltnp | grep -e ':4319 ' -e ':4320 '` shows both Electron listeners

### 1.2 Initial UI
- **Visible chrome (top → bottom, left → right)**
  1. Left **Rail** — narrow icon strip with the **Traces** tab active, enabled **Metrics** and **Logs** tabs below it, and a footer with the **Theme** switch above **GitHub** (external link) and the **Settings** cog (opens the settings modal).
  2. **Topbar** — `Traces` heading on the left, **EndpointBar** on the right (status dot, `OTLP/HTTP` label, URL `http://127.0.0.1:4319` as a click-to-copy pill, plus a green `MCP :4320` copy pill while MCP is enabled, and a `BETA` badge at the far right). The OTLP pill copies the receiver base URL; traces, logs, and metrics use the same host and port at `/v1/traces`, `/v1/logs`, and `/v1/metrics`. The MCP pill copies `http://127.0.0.1:4320/`. Hovering the `BETA` badge shows the current limitations (local database storage pruned by the retention setting, OTLP/HTTP JSON-or-protobuf ingest with no gRPC). The settings cog lives on the rail, not in the topbar.
  3. **FilterBar** — hidden on cold start for Traces; it appears once at least one trace has been received and exposes a Service dropdown, an `Errors only` toggle chip, and a search field. Logs and Metrics expose their own filter controls when those tabs are active.
  4. **Workbench** body — right pane is collapsed (no waterfall yet); the left pane fills the width and shows the trace list with the `Traces` header, count `0`, and "Waiting for traces…" empty-state copy (or "No traces match. Point an OTel exporter at http://127.0.0.1:4319/v1/traces" once the first probe completes).
  5. No drawer / value-viewer modal is visible.
- **PASS** if the dot is green and the URL renders inside the topbar (no separate header strip above the workbench).

### 1.3 Persisted settings file
```bash
cat /tmp/otelux-userdata/settings.json 2>/dev/null
```
- **Expected**: file does NOT exist yet (settings only persist on user write). Until then the app runs on the default settings held in memory. (Telemetry, unlike settings, persists to `otelux.db` from first ingest.)

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
- **Expected**: no crash, no JS error in the DevTools console opened with the platform shortcut from step 12.3, and the `Copied` tooltip + check icon reset cleanly each time without the row reflowing.

### 2.4 MCP URL copy
- Click the `MCP :4320` pill.
- **Expected**: the clipboard contains exactly `http://127.0.0.1:4320/`, and the pill remains green and stable while its copied state is visible.

### 2.5 Settings cog opens settings
- Click the **Settings** cog at the bottom of the **rail** (not the topbar — the cog moved there in the redesign).
- **Expected**: backdrop dims, settings dialog appears centered, OTLP/HTTP port input focused with value selected (cursor highlights `4319`).

### 2.6 Theme switch
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
| 3.6 | Tab from OTLP port input | focus moves through MCP toggle, MCP port, Cancel, Save, Close, then returns to the OTLP input; Shift+Tab reverses the cycle |

---

## 4. SettingsModal — validation matrix

Open settings (rail → Settings cog) before each row. After each row hit Cancel unless the row saves successfully.

| Step | Input | Click | Expected |
|------|-------|-------|----------|
| 4.1 | empty | Save | inline error: `OTLP port must be an integer between 1 and 65535.` |
| 4.2 | `0` | Save | same inline error |
| 4.3 | `-1` | Save | same inline error |
| 4.4 | `65536` | Save | same inline error |
| 4.5 | `abc` | Save | `<input type=number>` may reject; if value reaches submit, same inline error |
| 4.6 | `99999` | Save | same inline error |
| 4.7 | `12.5` | Save | native number validation or the app rejects the non-integer; accepting or silently truncating it is a FAIL |
| 4.8 | `14320` | Save | modal closes; receiver dot transitions starting→running; URL updates to `http://127.0.0.1:14320`; `cat /tmp/otelux-userdata/settings.json` has `{"version":1,"otlp":{"port":14320},"mcp":{"enabled":true,"port":4320}}` |
| 4.9 | `14320` again | Save | no-op rebind (still running on 14320), modal closes |

### 4.10 Port already in use and rollback
Open a second listener:
```bash
python3 -c "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',14321)); s.listen(1); time.sleep(60)" &
```
Then settings → set `14321` → Save.
- **Expected**: an inline EADDRINUSE error; the receiver rolls back to `14320`, the EndpointBar remains green, and settings on disk remain unchanged.
- While the inline error is visible, click the OTLP URL. It remains copyable and copies exactly `http://127.0.0.1:14320`.
- Recover: kill the python listener, then Cancel or save another valid port.

### 4.11 MCP settings and lifecycle

Restore OTLP to `14320`, then exercise the MCP controls:

| Step | Action | Expected |
|------|--------|----------|
| 4.11.1 | Open Settings with defaults | MCP toggle is on, MCP port is `4320`, and the hint reports `http://127.0.0.1:4320/` as running |
| 4.11.2 | Set MCP port to `14320` while OTLP is `14320`, then Save | inline error: `MCP port must differ from OTLP port.`; both existing listeners remain healthy |
| 4.11.3 | Set MCP port to `0`, `65536`, or empty, then Save | inline error: `MCP port must be an integer between 1 and 65535.` |
| 4.11.4 | Turn MCP off, then Save | modal closes, MCP pill disappears, port `4320` is released, OTLP ingest remains healthy, and settings persist `"enabled": false` |
| 4.11.5 | Turn MCP on with port `14330`, then Save | modal closes, a green `MCP :14330` pill appears and copies `http://127.0.0.1:14330/` |
| 4.11.6 | Occupy port `14331`, set MCP to `14331`, then Save | inline EADDRINUSE error; MCP rolls back to healthy port `14330`, OTLP remains on `14320`, and settings stay unchanged |
| 4.11.7 | Restore MCP enabled on `4320` | both default MCP behavior and the persisted settings shape are restored for the remaining sections |

### 4.12 MCP bearer token

The MCP listener requires a per-install token stored in `<userData>/mcp-token`.

```bash
TOKEN=$(cat /tmp/otelux-userdata/mcp-token)
# Missing token is rejected before any tool runs.
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://127.0.0.1:4320/
# Valid token succeeds.
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://127.0.0.1:4320/
```

- **Expected**: the first request returns `401` and the second returns `200`. The identity probe `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4320/` returns `200` without a token. The main-process log points at the token file on startup.

For step 4.11.6, reuse the Python listener from step 4.10 with port `14331`, then stop it after verifying rollback.

---

## 5. Settings persistence

### 5.1 Survives restart
1. Quit the app: close the last window on Linux/Windows; use Command+Q or the application menu on macOS.
2. Confirm both listeners are released: `ss -ltnp | grep -e ':14320 ' -e ':4320 '` → empty.
3. Relaunch without env override: `cd apps/desktop && npx electron out/main/index.js --user-data-dir=/tmp/otelux-userdata`
- **Expected**: log shows OTLP listening on `http://127.0.0.1:14320/v1/{traces,logs,metrics}` and MCP listening on `http://127.0.0.1:4320/`; both EndpointBar pills reflect those persisted settings.

### 5.2 Env override is one-shot
1. Quit Electron.
2. Relaunch with `OTELUX_OTLP_PORT=14999 npx electron out/main/index.js --user-data-dir=/tmp/otelux-userdata`
- **Expected**:
  - log shows `listening on http://127.0.0.1:14999/v1/{traces,logs,metrics}`
  - `cat /tmp/otelux-userdata/settings.json` still has `{"version":1,"otlp":{"port":14320},"mcp":{"enabled":true,"port":4320},"retention":{"maxAgeHours":72,"maxSizeMb":512},"storage":{"dbPath":""}}` — **env did NOT mutate file**
  - Open settings modal → OTLP input shows the live override `14999`; closing without Save leaves the persisted port at `14320`
  - Quit + relaunch without env → returns to 14320

### 5.3 Corrupt settings tolerated
1. Quit.
2. `echo 'this is not json' > /tmp/otelux-userdata/settings.json`
3. Relaunch.
- **Expected**: no crash, log shows `listening on http://127.0.0.1:4319/v1/{traces,logs,metrics}` (default), settings modal shows `4319`.
4. MCP also returns to enabled on `4320`. Save `14320` from the modal — `settings.json` is rewritten as valid JSON with the current OTLP and MCP shape.

### 5.4 Invalid-shape settings tolerated
1. Quit.
2. `echo '{"version":99,"unknown":true}' > /tmp/otelux-userdata/settings.json`
3. Relaunch.
- **Expected**: same fallback to OTLP `4319` and MCP enabled on `4320`. Save → file gets rewritten in the current shape.

### 5.5 Env validation
1. Quit.
2. `OTELUX_OTLP_PORT=abc npx electron out/main/index.js --user-data-dir=/tmp/otelux-userdata`
- **Expected**: log warns about invalid env, falls back to persisted port. App does **not** crash.

### 5.6 Restore the test baseline
- Save OTLP port `14320` and MCP enabled on `4320` before continuing. All fixed URLs in the remaining sections assume this baseline unless a section says otherwise.

### 5.7 Telemetry persists across restart
1. With the app running, ingest at least one trace, one log, and one metric (see sections 6–8).
2. Quit the app and relaunch with the same `--user-data-dir=/tmp/otelux-userdata`.
- **Expected**: the previously ingested traces, logs, and metrics are still listed after restart (they are read back from `<user-data>/otelux.db`, not re-received). `ls /tmp/otelux-userdata/otelux.db*` shows the database file.

### 5.8 Data retention
1. Open Settings → **Data retention**. Confirm defaults: **Keep for (hours)** `72`, **Max database size (MB)** `512`.
2. Set **Keep for (hours)** to `0` and Save → accepted (no age limit).
3. Set **Max database size (MB)** to `0` and Save → accepted (no size limit).
4. Enter a negative or non-integer value → inline validation error, nothing persisted.
5. Restore defaults (`72` / `512`) before continuing.
- **Expected**: valid values persist to `settings.json` under `"retention"`; invalid values are rejected inline without mutating the file or the running store.

### 5.9 Database location
1. Open Settings → **Database location**. Confirm the **Active database file** shows the absolute path of the open DB (e.g. `<user-data>/otelux.db`, or `/tmp/otelux-userdata/otelux.db` under the test data-dir) and the **Copy** button copies that path to the clipboard.
2. In **Custom database path**, enter a relative path (e.g. `foo.db`) → inline validation error, nothing persisted.
3. Enter an absolute path in a writable directory (e.g. `/tmp/otelux-alt/otelux.db`) and Save → accepted; the hint shows "Restart required to switch to this path" and `settings.json` records `"storage":{"dbPath":"/tmp/otelux-alt/otelux.db"}`.
4. Quit and relaunch with the same `--user-data-dir` → the **Active database file** now shows `/tmp/otelux-alt/otelux.db` and `ls /tmp/otelux-alt/otelux.db*` exists.
5. Clear the custom path (blank) and Save, then restart → the active DB returns to the default location.
- **Expected**: path changes are validated inline, persisted under `"storage"`, applied on the next launch (not mid-session), and a bad/unwritable custom path falls back to the default without crashing (log shows the fallback).

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
curl -s -X POST -H 'Content-Type: text/plain' --data '{"resourceSpans":[]}' http://127.0.0.1:14320/v1/traces -o /tmp/r.txt -w '%{http_code}\n'
```
- **Expected**: `415 Unsupported Media Type`, no ingest, and no crash. Valid JSON with the wrong media type makes this check discriminate content-type enforcement from JSON parsing.

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

### 10.5 Oversize payload
- With the default 10 MiB OTLP limit, generate a valid JSON body of exactly 10 MiB plus one byte:

```bash
TARGET_BYTES=$((10 * 1024 * 1024 + 1)) node -e '
const fs = require("node:fs");
const target = Number(process.env.TARGET_BYTES);
const prefix = Buffer.from("{\"padding\":\"");
const suffix = Buffer.from("\"}");
const payload = Buffer.concat([prefix, Buffer.alloc(target - prefix.length - suffix.length, 0x61), suffix]);
fs.writeFileSync("/tmp/otelux-oversize.json", payload);
if (fs.statSync("/tmp/otelux-oversize.json").size !== target) process.exit(1);
'
curl -s -X POST -H 'Content-Type: application/json' \
  --data-binary '@/tmp/otelux-oversize.json' \
  http://127.0.0.1:14320/v1/traces -o /tmp/r.txt -w '%{http_code}\n'
```

- **Expected**: controlled `413 Payload Too Large`; the app remains responsive and subsequent valid ingest succeeds. A 2xx response, hang, crash, or unbounded memory growth is a FAIL.
- Quit and relaunch once with `OTELUX_OTLP_MAX_BODY_BYTES=1024`, generate the same JSON shape with `TARGET_BYTES=1025`, and repeat the request. Expect `413`; a 1024-byte body must pass the size gate and proceed to normal payload validation. Restore the default launch afterward.
- Exercise the MCP limit in its transport integration test with `HttpRouterOptions.maxBodyBytes = 1024`; a 1025-byte JSON-RPC request returns `413` without invoking a tool.

### 10.6 Hostile browser origin

```bash
curl -s -D /tmp/otelux-origin-headers.txt -X POST \
  -H 'Origin: https://evil.example' \
  -H 'Content-Type: application/json' \
  --data '{"resourceSpans":[]}' \
  http://127.0.0.1:14320/v1/traces -o /tmp/r.txt -w '%{http_code}\n'
```

- **Expected by default**: `403 Forbidden`, no ingest, and no `Access-Control-Allow-Origin` header.
- In receiver and MCP transport integration tests, configure one exact allowed origin. That origin succeeds according to normal request validation and returns `Vary: Origin`; a sibling domain, alternate scheme, or alternate port still returns `403`. If credentials are supported, `Access-Control-Allow-Origin: *` is never returned.

---

## 11. Receiver lifecycle stress

### 11.1 Rapid port flips
- In settings, change port to 14321, Save. Wait for green. Change to 14322, Save. Repeat 5 times.
- **Expected**: no zombie listeners. `ss -ltnp` shows only the final OTLP port plus the configured MCP port; none of the previous OTLP ports remain. Both EndpointBar URLs match those listeners.

### 11.2 Save same port twice
- Set port to currently-running value, Save.
- **Expected**: rebind is a no-op or quick, dot stays green, no error.

### 11.3 Save while saving
- Open settings, change port, hit Save. While Saving… is showing (very brief — may need DevTools throttling), try to click Save again.
- **Expected**: button disabled, no double-submit. (If you can't repro because save is too fast, mark N/A.)

### 11.4 Settings rollback after bind error
- Occupy a new test port and attempt to save it. Confirm the inline EADDRINUSE error remains in the open modal while the EndpointBar stays green on the previous healthy port. Cancel or save a valid port; no restart or file cleanup is required.

### 11.5 Restore the test baseline
- Save OTLP port `14320` and MCP enabled on `4320`; confirm no listener remains on any temporary port used by this section.

---

## 12. Window / app lifecycle

### 12.1 Minimize / restore
- **Expected**: receiver keeps running (verify with curl from another terminal).

### 12.2 Close window
- **Expected on Linux and Windows**: closing the last window quits the app, both OTLP and MCP ports are released within 1 s, and settings.json is preserved.
- **Expected on macOS**: closing the window leaves the app and both listeners running. Quit with Command+Q or the application menu; both ports are then released and settings.json is preserved.

### 12.3 DevTools open
- F12 or Ctrl+Shift+I on Linux/Windows; F12 or Command+Shift+I on macOS.
- **Expected in the development build used by this plan**: DevTools opens and the console has no unexplained red errors. Packaged builds intentionally disable this accelerator.

### 12.4 Packaged runtime diagnostics
- Run a packaged build and capture main-process stderr while exercising the core workflow.
- **Expected**: no OTelux uncaught exception, unhandled rejection, disposed-frame error, or crash. Platform Chromium/GPU diagnostics such as `GetVSyncParametersIfAvailable() failed` may be recorded as environmental noise when behavior is unaffected.

---

## 13. Negative receiver scenarios

### 13.1 No app running
```bash
curl -sf http://127.0.0.1:14320/v1/traces -X POST -H 'Content-Type: application/json' --data '{}'
```
- **Expected**: connection refused (curl exit 7). UI not testable here.

### 13.2 App crash recovery *(do not run unless you want to)*
- Kill the main process: `pkill -9 -f out/main/index.js`
- **Expected**: window closes immediately; relaunch works; settings are preserved, and telemetry behavior matches the release's documented storage contract.

---

## 14. Logs ingest

The receiver accepts OTLP/HTTP logs at `/v1/logs`. Send the synthetic Codex-shaped log fixture and open the **Logs** tab.

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

The receiver accepts OTLP/HTTP metrics at `/v1/metrics`. Send the synthetic Codex-shaped metrics fixture and open the **Metrics** tab.

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
# Stop any background Python listener left from the occupied-port tests.
```

---

## Failure log template

For each FAIL, capture in your test report:

```
Step: <section.step>
Action: <what you did>
Expected: <documented behavior>
Actual: <what happened>
Repro: 100% / intermittent
Severity: P0/P1/P2/P3 (see spec.md)
Notes: …
```

---

## Quick smoke (60 seconds)

When you only have a minute (e.g. post-commit gate):

1. Build: `npm run lint && npm run typecheck && npm run build`
2. Launch: `cd apps/desktop && npx electron out/main/index.js --user-data-dir=/tmp/otelux-smoke &`
3. `curl --retry 20 --retry-delay 0 --retry-connrefused -sf http://127.0.0.1:4319/healthz && PORT=4319 ./scripts/send-traces.sh`
4. Click the trace, click any span — confirm waterfall + span detail drawer populate.
5. Rail → Settings cog → change port to a different one (e.g. `4399`) → Save → confirm green dot + new URL, then change back to `4319`.
6. Close window. `pkill -9 -f out/main/index.js`. Done.

---

## Agent self-verification

Mirror the relevant manual steps through `.agents/skills/self-verify/SKILL.md`. Use deskpal for visible UI checks; reserve CDP for invisible state such as IPC results, settings JSON, or focused element assertions.
