# OTelux — manual regression test plan

Canonical, human-readable checklist for verifying the OTelux desktop app.
The **self-verify** skill (`.agents/skills/self-verify/SKILL.md`) automates
this document section-by-section through **deskpal**; keep the two in sync —
if you add or renumber a section here, mirror it there.

Run from the repo root. Mark each step PASS/FAIL with one-line evidence.
Don't fix bugs while testing — record them and continue.

Conventions used below:

- **Receiver** binds `127.0.0.1:$OTELUX_OTLP_PORT` (default **4319** — one above
  the OTLP/HTTP standard 4318 to avoid colliding with a local Collector).
- **MCP server** defaults to **4320** (one above the OTLP default).
- Port resolution order: `OTELUX_OTLP_PORT` env (one-shot, does **not** persist) →
  `settings.json` → default 4319.
- Fixtures live in `fixtures/`; send them with `scripts/send-traces.sh`.

---

## §0 Preflight

```bash
node --version          # expect v22.x
npm run lint            # expect exit 0
npm run typecheck       # expect exit 0
npm run build           # expect all turbo tasks ok
```

PASS when all four succeed.

## §1 Cold start

- §1.1 — receiver bound. `grep "listening on http://127.0.0.1:4319"` in the app
  log and `ss -ltnp | grep ':4319 '` shows the electron process.
- §1.2 — visible chrome. The window shows: `OTelux`,
  `Local OpenTelemetry workbench`, `OTLP/HTTP`,
  `http://127.0.0.1:4319/v1/traces`, the `Traces` tab, and a `0` count.
- §1.3 — no settings file yet (`settings.json` absent on a clean profile).

## §2 EndpointBar

- §2.1 — hovering the status dot shows the tooltip
  `listening on http://127.0.0.1:4319/v1/traces`.
- §2.2 — clicking the URL pill copies it; clipboard equals exactly
  `http://127.0.0.1:4319/v1/traces` and a brief `copied` hint appears.
- §2.3 — spam-clicking the URL 5× leaves the UI responsive.
- §2.4 — the cog (⚙) opens Settings; the modal shows `Settings` and
  `OTLP/HTTP port`.

## §3 Modal close paths

The Settings modal must close via each of: §3.1 the ✕ button, §3.2 the
`Cancel` button, §3.3 the `Escape` key, §3.4 a backdrop click (outside the
modal). §3.5 — clicking inside the modal body must **not** close it.
§3.6 — Tab cycles focus port → Cancel → Save → port.

## §4 Port validation matrix

For each invalid value, open Settings, clear the input, type the value, and
press `Save`; the inline error
`Port must be an integer between 1 and 65535` must appear and nothing binds:

| Input | Expected |
|-------|----------|
| empty | validation error |
| `0` | validation error |
| `-1` | validation error |
| `65536` | validation error |
| `abc` | validation error |
| `99999` | validation error |
| `22` | bind failure: `failed to bind` / `EACCES`, dot turns red |
| `14320` | accepted; modal closes; URL shows `14320` |
| `14321` (with §4.12 listener) | bind failure `EADDRINUSE` |

§4.12 — to exercise `EADDRINUSE`, hold a second listener on the target port
(e.g. a short Python `socket.bind` script) before saving that port.

## §5 Persistence

- Saving `14320` writes it to `settings.json`; relaunching with no env
  override loads `14320`.
- `OTELUX_OTLP_PORT=14999` overrides to `14999` at runtime but does **not**
  mutate `settings.json` (still `14320`).
- A corrupt (`not json`) or unknown-version (`{"version":99}`) settings file
  falls back to the default `4319`.
- `OTELUX_OTLP_PORT=abc` (invalid) logs an "ignoring invalid" warning and
  falls back to the persisted value.

## §6 Trace ingest

```bash
PORT=4319 ./scripts/send-traces.sh                                   # sample_trace.json
FIXTURE=fixtures/distributed_trace.json PORT=4319 ./scripts/send-traces.sh
FIXTURE=fixtures/sample_trace_error.json PORT=4319 ./scripts/send-traces.sh
```

- After the first send, the `Traces` count is `1` and the row shows
  `GET /api/users`, `45.0ms`, `api-gateway`, `3 spans`.
- After all three, the count is `3` and one row carries an `err` badge.

## §7 Selection

Clicking a trace row (`GET /api/users`) selects it and renders its span
names in the main pane; the row gains the `is-selected` styling.

## §8 Waterfall

The selected trace renders a span waterfall in the main pane with one bar
per span, ordered by start time.

## §9 Inspector

Clicking a span in the waterfall opens the inspector showing its attributes
(e.g. `http.method`, `http.target`).

## §10 Malformed input (hostile HTTP)

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  --data-binary '@fixtures/malformed.json' \
  http://127.0.0.1:4319/v1/traces -o /dev/null -w '%{http_code}\n'   # 4xx
curl -s -X POST -H 'Content-Type: text/plain' --data 'x' \
  http://127.0.0.1:4319/v1/traces -o /dev/null -w '%{http_code}\n'   # 4xx
curl -s http://127.0.0.1:4319/ -o /dev/null -w '%{http_code}\n'      # 404
```

Each is rejected without crashing the receiver and the trace count is
unchanged.

## §11 Lifecycle stress

Flip the port five times through the UI (`14320 14321 14322 14323 14324`).
After each save the URL reflects the new port, and `ss -ltnp | grep electron`
shows exactly one listener (no zombie binds).

## §12 Window lifecycle

- `Ctrl+Shift+I` toggles DevTools (`Elements` / `Console` tabs appear).
- `Alt+F4` closes the window; afterward no listener remains on `4319` or the
  `143xx` test ports.

## §13 Log ingest

The receiver also accepts OTLP/HTTP logs at `/v1/logs`. Send the codex log
fixture and open the `Logs` tab:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  --data-binary '@fixtures/sample_codex_logs.json' \
  http://127.0.0.1:4319/v1/logs -o /dev/null -w '%{http_code}\n'     # 2xx
```

- The `Logs` tab is clickable and its count increments.
- Rows render with a **real timestamp** (not the Unix epoch — codex emits
  `timeUnixNano: "0"` and the true time only in `observedTimeUnixNano`, which
  the receiver must fall back to).
- Clicking a row opens the detail drawer showing the log body and attributes.
