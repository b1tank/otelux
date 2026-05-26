# OTel Studio for VS Code — Project Proposal

**Author:** Zhichao Li
**Team size:** 1 engineer (intern-sized scope; suitable as an intern project)
**Duration:** 12 weeks
**Status:** Draft for sign-off

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

**Code we own and consume directly:**

| Asset | Origin | Status |
|---|---|---|
| OTLP/HTTP receiver | `@otelux/receiver` | M1 |
| OTLP/gRPC receiver | `@otelux/receiver` | Phase 5 |
| In-memory + SQLite engine | `@otelux/engine` + `@otelux/engine-node` | M1 |
| Waterfall, trace list, span detail React components | `@otelux/ui` | M1 |
| `DataSource` protocol | `@otelux/protocol` | M1 |
| `@otelux/adapter-vscode` (postMessage bridge) | Designed in [otelux/docs/spec.md § 7](otelux/docs/spec.md) | M1 — built in this project, shared with the desktop |
| `@otelux/mcp-server` (JSON-RPC dispatcher + HTTP/stdio) | Designed in [otelux/docs/spec.md § 12](otelux/docs/spec.md) | M1 — built in this project, shared with the desktop |
| Agent-run correlation engine | `@otelux/engine` | M1 — lives in the engine, both apps benefit |
| OTLP fixtures | `otelux/fixtures/` | Done |

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

## 5. Twelve-week plan

Phases are effort budgets. Each ends with a demo-able artifact.

### Weeks 1–2 — Onboarding + Hello-OTel extension

- Set up dev env and walk the `otelux` monorepo end-to-end. Skim
  `vscode-otelme` and `obstudio` once for context; write a one-page
  "what each does and what we are *not* taking from them" note.
- Stand up `apps/vscode-extension` skeleton in the `otelux` monorepo
  using `esbuild` (standard VS Code extension pattern).
- Activate, register a command that opens a webview pointing at a
  hard-coded fixture. **Demo:** opens a panel, renders one waterfall.
- Deliverable: working `.vsix` install, CI green.

### Weeks 3–4 — Wire the receiver and store

- Run `@otelux/receiver` in the extension host (Node side), not the
  webview.
- Persist via `@otelux/engine-node`'s SQLite store.
- Single-instance handoff so two VS Code windows don't both bind 4318.
  Second window connects to the first via `@otelux/receiver`'s
  `claimSingleInstance` helper (see
  [otelux/docs/spec.md § 7.1](otelux/docs/spec.md)). The same helper
  governs simultaneous desktop + extension on one machine. Design
  constraint borrowed from `vscode-otelme`; code is ours and shared
  across both apps.
- Status bar entry: endpoint URL + span count.
- **Demo:** instrument a sample Node app, send traces, see them land.
- Deliverable: end-to-end ingest path, no UI changes required.

### Weeks 5–6 — Webview ↔ extension `DataSource` adapter

- Implement `@otelux/adapter-vscode` as designed in
  [otelux/docs/spec.md](otelux/docs/spec.md):
  `serveDataSource(webview, engine)` on the host side,
  `createPostMessageDataSource(vscodeApi)` on the webview side.
- Drop the existing `@otelux/ui` workbench into the webview.
- CSP-clean Vite build (already a frozen requirement in the spec).
- **Demo:** the existing trace/log/metric explorer running inside
  VS Code with VS Code theming.

### Weeks 7–8 — Copilot LM Tools

This is the headline week.

- Register tools through `vscode.lm.registerTool` with proper JSON
  schemas and confirmation messages.
- Minimum tool set:
  - `otel.findRecentErrors`
  - `otel.getTrace`
  - `otel.searchLogs`
  - `otel.getSlowestSpans`
  - `otel.getServiceOverview`
- Each tool reads from the same engine the webview reads from — no
  duplication.
- Author a `package.json` `languageModelTools` contribution so they
  appear in `#otel` references in Copilot Chat.
- **Demo:** ask Copilot "why is checkout slow today?" — it calls
  `otel.getSlowestSpans`, returns a real answer with span IDs.

### Weeks 9–10 — Agent-run correlation (the killer feature)

The differentiator. Copilot agent mode already emits OTel spans for its
own runs. When the user instruments their app with OTel and runs it under
Copilot's command, both span streams land in the same store. We can join
them by `trace.id` propagation or by timestamp + run-id.

- Detect Copilot agent runs in the store (look for known span attributes
  emitted by Copilot's agent host).
- Add `otel.correlateAgentRun(runId)` LM tool that returns the user-app
  spans that occurred during a given agent run.
- Add an "Agent runs" pane in the webview that lists each agent run with
  links to (1) the agent's own trace and (2) the user app spans during
  that run.
- **Demo:** "Copilot ran my failing test. Show me what my app was doing
  at the moment the test failed." One click to the correlated view, or
  one Copilot Chat question.

### Week 11 — MCP server endpoint

- Implement a TypeScript MCP dispatcher with HTTP and stdio transports,
  mounted at `/mcp` inside the extension host. Read-only, JSON-RPC.
  (Architecture shape — transport-agnostic dispatcher behind two
  transports — is the same idea `obstudio` uses; the implementation is
  fresh TypeScript, not a port.)
- One-click "Enable Codex / Claude Code / Cursor integration" commands
  that write the MCP config file for each agent home. (UX referenced
  from `obstudio`; the file paths and config schemas are public and the
  code is ours.)
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
   command; those agents now see the same telemetry over MCP.
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
