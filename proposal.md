# OTel Studio for VS Code — Project Proposal

**Author:** Zhichao Li
**Team size:** 1 engineer (intern-sized scope; suitable as an intern project)
**Duration:** 12 weeks
**Status:** Phase 0 scaffold complete — ready for sign-off and Phase 1 kickoff

---

## 1. One-paragraph pitch

OpenTelemetry is the agreed-upon way to instrument apps, but inside VS Code
the developer story stops at "configure your SDK." There is no first-class
surface for **seeing** the telemetry your running app and Copilot agent are
producing, and no first-class way for **Copilot to use that telemetry** when
helping you debug. We will close that gap by shipping **OTel Studio**, a
VS Code extension that (a) receives OTLP locally with zero config, (b)
gives users a polished trace/log/metric explorer right inside the IDE, and
(c) exposes that telemetry to Copilot through tools and MCP so the agent
can ground its answers in real spans, errors, and timings instead of
guessing. The extension is built on top of **[`otelux`][otelux]**, my
existing TypeScript monorepo whose engine, receiver, and UI components were
designed from day one to embed in a VS Code webview. Harald's
[`vscode-otelme`][otelme] and Splunk's [`observability-studio`][obstudio]
are **reference only** — we study their lifecycle, multi-window, and MCP
patterns but neither codebase is a dependency or a fork point.

[otelme]: https://marketplace.visualstudio.com/items?itemName=digitarald.vscode-otelme
[obstudio]: https://marketplace.visualstudio.com/items?itemName=Splunk.observability-studio
[otelux]: https://github.com/b1tank/otelux

---

## 2. Why now

Three things converged in the last quarter:

1. **Copilot agent mode produces OTel-shaped traces of its own work** (tool
   calls, model requests, retries, timings). The Agent Debug Log panel
   already shows them as text. The next step is *structured* exploration
   and correlating those traces with the user's app traces — i.e. an
   OTel viewer wired into Copilot.
2. **Splunk shipped `observability-studio`** and Harald shipped
   `vscode-otelme`, proving the "local-collector-plus-webview" and
   "OTel-in-Copilot" patterns work in VS Code and that vendors are racing
   to own this surface. If we don't ship a first-party experience an ISV
   will define what "OTel in VS Code" looks like for us. Both extensions
   stay strictly reference material — Splunk is Apache-licensed third-party
   code we don't want to fork, and `vscode-otelme` is a minimal
   single-purpose collector whose design space we want to grow well past.
3. **`otelux` is already half of the deliverable.** It is a TypeScript
   monorepo with a working OTLP receiver, an in-process engine, a
   waterfall + trace list + span detail UI, and an explicit
   `@otelux/adapter-vscode` package boundary so the same UI runs in a
   webview. The original spec (`docs/spec.md`) calls out
   "embedding consumers" — VS Code is the named first embedder.

The leverage is high: the engineer is not starting from a blank repo, and
they are not blocked on inventing UI from scratch.

---

## 3. What we're building

**A single VS Code extension** built end-to-end on top of `otelux`, with
three integrated surfaces. Everything runs inside the extension host or
the webview — no Go binary, no separate sidecar process, no bundled
third-party collector.

### Surface A — Local OTLP collector (zero-config)

- Listens on `localhost:4318` (OTLP/HTTP) the moment the extension
  activates. OTLP/gRPC on `localhost:4317` arrives in a later phase
  (see [docs/plan.md](otelux/docs/plan.md) Phase 5) — not an M1 blocker,
  and removing it from the critical path is what makes 12 weeks honest.
- Stores spans/logs/metrics in a local SQLite file (already implemented
  in `@otelux/engine-node`).
- Multi-window aware: the first VS Code window owns the receiver, others
  connect in client-only mode against the same store via
  `@otelux/receiver`'s `claimSingleInstance` helper (see
  [otelux/docs/spec.md § 7.1](otelux/docs/spec.md)). Design pattern
  referenced from `vscode-otelme`; the helper is shared with the
  desktop app.
- Status bar entry shows endpoint, count, and one-click "copy OTLP URL".
  Lifecycle UX referenced from `obstudio`; implementation is ours.

### Surface B — Telemetry Explorer (human users)

- Webview panel with three tabs: **Traces**, **Logs**, **Metrics**.
- Traces: virtualized list + per-service-colored waterfall + span detail
  drawer (already shipping in `@otelux/ui`; see
  [otelux/design/redesign-mockup.html](otelux/design/redesign-mockup.html)).
- Logs: severity-aware table with trace correlation.
- Metrics: simple chart per series (sum / gauge / histogram).
- "Live / Paused" toggle so users can freeze the view while inspecting,
  matching the pattern users already understand from `obstudio`.
- Theme via host CSS variables (`--vscode-*`) — already wired in
  `@otelux/ui`.

### Surface C — Copilot integration (agents)

This is the part neither `vscode-otelme` nor `obstudio` does *well*, and
it is the most differentiated piece of the proposal.

**Where the code lives.** Despite "Copilot integration" sounding
extension-only, only the thinnest layer actually is:

- The MCP server is `@otelux/mcp-server` — a shared package consumed by
  both `apps/vscode-extension` and `apps/desktop`.
- Agent-run correlation lives in `@otelux/engine` — the desktop benefits
  from it for free.
- Only the LM Tool registration via `vscode.lm.registerTool` and the
  one-click "Enable Codex / Claude Code / Cursor" config-writing
  commands are extension-only.

Two ways Copilot consumes the telemetry:

1. **Language-Model Tools** registered through the VS Code Chat API
   (`vscode.lm.registerTool`). Examples:
   - `otel.findRecentErrors(service?, since?)` — returns spans with
     `status=ERROR` so Copilot can answer "what just broke?"
   - `otel.getTrace(traceId)` — full trace tree for root-cause analysis.
   - `otel.searchLogs(query, severity?)` — structured log search.
   - `otel.getSlowestSpans(service?, n?)` — performance triage.
   - `otel.correlateAgentRun(runId)` — joins a Copilot agent run with
     the spans the user's app emitted *during* that run. **This is the
     killer integration.**
2. **MCP server endpoint** on the same store, so external agents (Codex,
   Claude Code, Cursor) running on the same machine can use the same
   data. We write a TypeScript MCP dispatcher from scratch (read-only,
   JSON-RPC over HTTP + stdio) as `@otelux/mcp-server`. `obstudio`'s
   Go dispatcher is studied as a shape reference; we don't link to it,
   embed it, or port it.

### What ties it together

A single shared store, queried by both the webview and the agent tools:

```
                ┌──────────────────────────────┐
                │  User's app / Copilot agent  │
                └───────────────┬──────────────┘
                                │ OTLP
                                ▼
                  ┌─────────────────────────┐
                  │  @otelux/receiver        │
                  │  (Hono / OTLP/HTTP in M1)│
                  └────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │  @otelux/engine + node   │
                  │  SQLite store (WAL)      │
                  └─┬─────────┬──────────┬───┘
                    │         │          │
        Webview UI  │         │          │  MCP /mcp
        @otelux/ui  │         │          │  (external agents)
                    │         │          │
                    ▼         ▼          ▼
                 Trace      VS Code     External
                 Explorer   Chat LM     MCP clients
                 (humans)   Tools       (Codex/Claude/
                            (Copilot)    Cursor)
```

---

## 4. Why this is realistic in 12 weeks

Because we are **not** starting from zero. The entire deliverable lives
in the `otelux` monorepo and reuses `@otelux/*` packages we already own.

**Code we own and consume directly:** (status as of Phase 0 sprint complete — see [docs/sprint.plan.md](docs/sprint.plan.md))

| Asset | Origin | Status |
|---|---|---|
| OTLP/HTTP receiver | `@otelux/receiver` | ✅ Shipping (desktop on `:4319`) |
| OTLP/gRPC receiver | `@otelux/receiver` | Phase 5 |
| In-memory + SQLite engine | `@otelux/engine` + `@otelux/engine-node` | ✅ Shipping |
| Waterfall, trace list, span detail React components | `@otelux/ui` | ✅ Shipping (95 unit tests passing) |
| `DataSource` protocol | `@otelux/protocol` | ✅ Shipping |
| `@otelux/adapter-vscode` (postMessage bridge) | [otelux/docs/spec.md § 7](docs/spec.md) | ✅ Scaffolded (4 tests passing) — shared with the desktop |
| `@otelux/mcp-server` (JSON-RPC dispatcher + HTTP/stdio) | [otelux/docs/spec.md § 12](docs/spec.md) | ✅ Scaffolded — 7 tools (5 functional, 2 stub) — shared with desktop & extension |
| `claimSingleInstance` (multi-window port handoff) | `@otelux/receiver` | ✅ Scaffolded (lockfile + healthz + atomic O_EXCL, 5 tests) |
| `--vscode-*` token fallbacks in workbench CSS | `@otelux/ui` | ✅ Shipping |
| Agent-run correlation engine | `@otelux/engine` | 🚧 Stub returns `supported:false` — engine work in Phase 1 Track B |
| Log full-text search | `@otelux/engine-node` | 🚧 Stub returns `supported:false` — Phase 2 |
| OTLP fixtures | `otelux/fixtures/` | ✅ Shipping |

**Code we look at but do not consume:**

| Reference | What we learn from it | How we use it |
|---|---|---|
| `vscode-otelme` | Multi-window single-owner receiver; status-bar UX; LM Tool registration shape | Read, take notes, reimplement in our codebase |
| `obstudio` | Extension lifecycle / startup-error UX; MCP dispatcher transport split; one-click agent integration pattern | Read, take notes, reimplement in our codebase |

Neither reference is forked, vendored, or imported. Both are MIT /
Apache-licensed open source, so we are free to learn from them, but the
shipping code is 100% `otelux` plus net-new TypeScript.

The net-new work is the **`apps/vscode-extension`** assembly,
the **`@otelux/adapter-vscode`** implementation, the **LM tool layer**,
and the **MCP TypeScript server** — all small, well-scoped pieces of glue
between packages we already own.

---

## 4.5 Current state (Phase 0 sprint, week 0)

A one-week scaffolding sprint preceding the 12 weeks landed every
package boundary the plan depends on, so the intern starts on Phase 1
feature work — not on monorepo plumbing. Concretely, on `main`:

- **Desktop app is feature-complete for M1 and dogfooding live.** It
  receives OTLP at `127.0.0.1:4319/v1/traces`, persists to SQLite,
  renders the trace list + per-service-colored waterfall + span detail
  drawer, and exposes its MCP server at `127.0.0.1:4320/`. Settings
  modal toggles the MCP server on/off; status pills in the top bar
  show both endpoints with copy-on-click.
- **MCP server is wire-compatible.** A GitHub Copilot Chat client
  configured against the desktop's `:4320` successfully called
  `otel_get_service_overview`, `otel_get_slowest_spans`,
  `otel_get_trace`, `otel_get_span_details`, and
  `otel_find_recent_errors` end-to-end during sprint verification —
  the proposal author asked Copilot "what was slow in the last 2
  hours?" and got a grounded answer citing real span IDs from this
  conversation. `otel_search_logs` and `otel_correlate_agent_run`
  return `supported:false` with the planned phase marker.
- **VS Code extension scaffold builds and activates.** `npm run -w
  apps/vscode-extension build` produces a host bundle (`out/host/`)
  and a webview bundle (`out/webview/`); `openExplorer` opens an
  empty webview that the `@otelux/adapter-vscode` postMessage bridge
  is already wired into. The five `languageModelTools` are declared
  in `package.json` and registered via `vscode.lm.registerTool` —
  they share a single dispatcher with the MCP server so a change
  to either surface lands in both.
- **Repo CI is green.** Repo-wide `typecheck` (20/20), `test` (95+
  passing), and `build` (11/11) all pass at `7cd8438` on `main`.

What this means for the 12-week plan below: weeks 1–2 collapse from
"stand up a Hello-OTel extension" to "replace the extension's empty
webview with the real workbench bound to a live engine," and the
intern's first PR can be a feature, not a build script. The schedule
below is rewritten accordingly.

---

## 5. Twelve-week plan

Phases are effort budgets. Each ends with a demo-able artifact.

### Weeks 1–2 — Onboarding + light up the real workbench

- Set up dev env and walk the `otelux` monorepo end-to-end. Skim
  `vscode-otelme` and `obstudio` once for context; write a one-page
  "what each does and what we are *not* taking from them" note.
- Replace the scaffold's empty webview with the real `OTeluxWorkbench`
  bound to a `DataSource` served from the extension host's in-process
  engine + `@otelux/receiver`. The postMessage adapter, the
  `--vscode-*` token bindings, and the `esbuild` + Vite builds are
  already in place — this week is purely composition.
- **Demo:** instrument a sample Node app, send traces to
  `localhost:4318`, see them appear in the live VS Code webview with
  VS Code theming.
- Deliverable: F5 / `.vsix` install opens an explorer that actually
  shows the user's own traces, not fixtures.

### Weeks 3–4 — Production-grade receiver lifecycle

- Wire `claimSingleInstance` into the extension host so two VS Code
  windows on the same box share one receiver — the second window
  connects to the first's HTTP store via the same engine adapter
  used in M0. The helper is built; this week is the integration
  test matrix (cold start, hot restart, owner crash, port conflict,
  desktop + extension on one machine).
- Surface receiver state in the VS Code status bar: endpoint URL,
  rolling span count, and a click-through to the explorer. Mirror
  the desktop's `EndpointBar` semantics so users see the same
  vocabulary on both apps.
- Add a `Settings` contribution (`otelux.receiver.port`,
  `otelux.mcp.enabled`, `otelux.mcp.port`) — the manifest entries
  exist; wire them to the runtime via the extension's settings
  watcher.
- **Demo:** start two VS Code windows + the desktop app at once;
  ingest traces from a single instrumented service; confirm only
  one process binds the port and the other two are clients.
- Deliverable: zero-config receiver that survives multi-window and
  multi-app coexistence on a developer's laptop.

### Weeks 5–6 — Logs path + harden the explorer

- Light up log ingest in `@otelux/receiver` (OTLP/HTTP `/v1/logs`)
  and storage in `@otelux/engine-node` (a new `logs` table with an
  FTS5 index for `otel.searchLogs`). The MCP `otel_search_logs`
  tool flips from stub to real once this lands.
- Logs tab in the workbench: severity-aware table, trace-link
  column, click-to-pivot into the waterfall for that trace.
- Metrics tab stays at the minimum-viable bar set out in the spec
  (one simple chart per series type) — this is *not* a full metrics
  dashboard, and the proposal explicitly scopes it out.
- **Demo:** instrument the sample app with `@opentelemetry/api-logs`;
  open the explorer, filter by severity, click a log line, land on
  its trace.

### Weeks 7–8 — Copilot LM Tools, end-to-end

This is the headline phase. The tools are *registered* (manifest
entries shipped in Phase 0) but currently share the MCP dispatcher's
stub semantics for two of them.

- Promote the five existing tools to first-class LM Tools with
  hand-written confirmation messages, JSON schemas, and human-grade
  Markdown output. The dispatcher is shared with the MCP server, so
  any quality work here also improves external agent consumption.
  - `otel.findRecentErrors`
  - `otel.getTrace`
  - `otel.searchLogs` (real once weeks 5–6 logs work lands)
  - `otel.getSlowestSpans`
  - `otel.getServiceOverview`
- Add the `#otel` chat reference in the `package.json`
  `languageModelTools` contribution so users get `@otel` completions
  in Copilot Chat without having to invoke a tool by name.
- Add `traceLink` to every tool response so a `Cmd+click` in Copilot
  Chat opens the trace inside the webview.
- **Demo:** ask Copilot "why is checkout slow today?" inside the
  sample-app workspace — it calls `otel.getSlowestSpans`, returns a
  real answer with linkable span IDs.

### Weeks 9–10 — Agent-run correlation (the killer feature)

The differentiator. Copilot agent mode already emits OTel spans for its
own runs — we have empirical proof from sprint verification, where
Copilot Chat in this very repo emitted spans like
`chat claude-opus-4.7-high` and `execute_tool manage_todo_list` that
landed in our SQLite store with full `gen_ai.*` attributes. The data
is sitting right there; the engine work is the indexing path.

- Engine: detect Copilot agent runs by indexing on `gen_ai.agent.run_id`
  / `service.name=copilot-chat` / equivalent attributes and exposing a
  `correlateAgentRun(runId)` query primitive.
- MCP / LM Tool: flip `otel.correlateAgentRun` from stub to real. Both
  surfaces get it for free because they share the same dispatcher.
- UI: add an "Agent runs" entry to the rail in `@otelux/ui` that lists
  each agent run with links to (1) the agent's own trace and (2) the
  user-app spans during that run. The desktop benefits for free.
- **Demo:** "Copilot ran my failing test. Show me what my app was doing
  at the moment the test failed." One click to the correlated view, or
  one Copilot Chat question.

### Week 11 — External-agent integration (Codex / Claude / Cursor)

- The MCP TypeScript dispatcher already ships in `@otelux/mcp-server`
  with HTTP and stdio transports — mount the HTTP server in the
  extension host at `localhost:4319` (the manifest default), behind
  the same on/off setting the desktop uses.
- One-click "Enable Codex / Claude Code / Cursor integration" commands
  that write the MCP config file for each agent home. The commands are
  scaffolded in `apps/vscode-extension/src/host/enableAgentIntegration.ts`
  as toast-only stubs; this week wires them to the real config-writing
  logic. File paths and config schemas are public.
- **Demo:** Codex CLI in a terminal calls our MCP server and lists
  traces against the same store the webview is reading.

### Week 12 — Polish, perf, publish

- Hit the performance budgets already written in
  [otelux/docs/spec.md § 8](otelux/docs/spec.md) — query latency, ingest
  throughput, gzipped bundle size.
- Accessibility pass (the spec already mandates keyboard + ARIA +
  contrast — verify).
- README, GIFs, and marketplace listing copy.
- Internal preview release.
- Write a short project report covering measured impact and open
  questions.

---

## 6. Definition of done

A user installs the extension and, with zero configuration:

1. Sees `http://localhost:4318` advertised as a live OTLP/HTTP endpoint
   in the status bar. (OTLP/gRPC on `4317` arrives in Phase 5.)
2. Points an OpenTelemetry SDK at those endpoints; traces, logs, and
   metrics land within one second.
3. Opens the Telemetry Explorer panel; traces, logs, and metrics each
   render with virtualized lists and detail views meeting the
   `otelux` performance budgets.
4. Asks Copilot "what failed in the last 5 minutes?" or "what was my app
   doing during this agent run?" and gets a grounded answer that cites
   span IDs.
5. Optionally enables Codex / Claude / Cursor integration with one
   command; those agents now see the same telemetry over MCP at
   `localhost:4319` (the desktop counterpart uses `:4320` so the two
   coexist on one box without contention).
6. The extension passes VS Code marketplace publishing prerequisites
   (manifest, license, screenshots, baseline a11y).

---

## 7. Out of scope

To keep 12 weeks honest, the project will *not* deliver:

- Profiles (deferred in `otelux` spec already).
- Cloud sync or multi-user.
- A new instrumentation SDK; we consume whatever the user's SDK emits.
- A custom AI assistant inside the panel; Copilot is the assistant.
- macOS-/Windows-specific polish beyond what works out of the box.
- Auto-update, code signing for non-VS-Code distributions.
- Splunk / SigNoz / Jaeger backend export. The extension is a *local*
  surface.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| LM Tools API still proposed / shifting | Implement against current API; isolate behind a thin wrapper; keep MCP path as fallback. |
| Two VS Code windows fighting for port 4318 | `@otelux/receiver`'s `claimSingleInstance` (spec § 7.1); second window detects the first via a lockfile + ping and connects as a client. Same helper covers desktop + extension on one box. The design pattern is well understood from `vscode-otelme` and `obstudio`; the code we ship is ours. |
| Webview perf at 10k+ spans | `@otelux/ui` already virtualizes; perf budgets already in spec. |
| Engineer blocked on TypeScript / VS Code API ramp-up | Onboard against the existing `otelux` codebase first; first deliverable is a trivial extension that opens a webview. |
| Scope creep into a metrics dashboard | Hard stop at "table + simple chart"; full metrics dashboard explicitly deferred. |
| Splunk releases agent integration first | Our differentiator is **Copilot agent-run correlation**, which they don't have because they're not in the VS Code chat path. |

---

## 9. Cost, ownership, success metrics

**Cost:** one engineer for 12 weeks, plus ~2 hrs/week mentoring from me
and async input from Bhavya (caching inspection angle) and Harald
(existing `vscode-otelme` author, hopefully a reviewer).

**Ownership:** the work lands as a new app inside the `otelux` monorepo
(`apps/vscode-extension`) plus one new published package
(`@otelux/adapter-vscode`). MIT-licensed, same as the rest of `otelux`.

**Success metrics (measurable at week 12):**

- The extension installs cleanly on a fresh VS Code, no manual config.
- An OTel-instrumented sample app produces visible telemetry in ≤ 1 s.
- Copilot Chat can answer at least three of the four canonical
  troubleshooting questions ("what broke?", "what's slow?", "what was
  my app doing during this agent run?", "why did this log fire?") with
  citations into the local store.
- Performance budgets from `otelux/docs/spec.md` § 8 are met.
- An internal preview release is published, with at least five Microsoft
  internal users dogfooding it.

**Beyond the 12 weeks:** the work feeds directly into the Copilot
troubleshooting story Rob and Kai sketched out; everything shipped here
is reusable in any future first-party OTel surface (web, server, or
otherwise) because it's package-first.

---

## 10. Why this is a good fit for one engineer

- The work is **bounded** (12 weeks, well-scoped phases, reuse-heavy)
  while still **shipping a real artifact** to real users.
- It exposes the engineer to four real ecosystems they will not get
  elsewhere together: OpenTelemetry, VS Code extension APIs, Copilot
  LM Tools, and MCP.
- The deliverable is **demoable end-to-end** at every phase boundary,
  which is rare for 12-week projects and makes mid-stream feedback
  cheap.
- It has an obvious **outcome bigger than one project**: a foundation
  for the Copilot agent troubleshooting story the team is already
  invested in.
- Scope is **intern-sized but not intern-only** — a junior engineer or
  intern can complete it solo with the existing `otelux` packages doing
  the heavy lifting.

---

## 11. Asks

1. Sign-off on this scope.
2. Permission to publish `apps/vscode-extension` to the internal VS Code
   gallery at the end of the project.
3. ~30 minutes of Harald Kirschner's time in week 1 as a sounding board
   on the multi-window collector design (his code is reference, not
   dependency — we just want lessons learned).
4. ~30 minutes of Bhavya's time in week 6 to validate the cache-inspection
   angle is reachable from the same data model.

---

## 12. Verifying the current state

A reviewer can reproduce the Phase 0 demo today:

```bash
git clone git@github.com:b1tank/otelux.git && cd otelux
npm install
./otelux.sh                       # builds + launches the desktop app
# In a separate shell, point an OTel SDK at http://127.0.0.1:4319/v1/traces
# or use any of the spans Copilot itself emits in the IDE.
curl -sS http://127.0.0.1:4320/ -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The desktop window shows live OTLP and MCP status pills; the MCP
`tools/list` call returns 7 tool definitions; `tools/call` against
`otel_get_service_overview` returns real data once any span has been
ingested. The same monorepo also produces a `.vsix` for the VS Code
extension via `npm run -w apps/vscode-extension build`, which is the
scaffold that the 12 weeks above will harden into a shipping product.
