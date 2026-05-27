# OTel Studio for VS Code

- **Duration:** 12 weeks
- **Team:** 1 engineer

🔭 **Make OpenTelemetry a first-class surface inside VS Code so humans and
agents can troubleshoot and monitor together.** Two parts, one closed loop:

1. **OTel Studio** — a zero-config OTLP collector + trace / log / metric
   explorer inside VS Code, with Copilot wired in via Language-Model
   Tools and external agents (Codex / Claude / Cursor) via MCP. Humans
   read the waterfall; agents query the same store and ground their
   answers in real spans.
2. **VS Code internal instrumentation** — emit OTel from VS Code itself:
   agent-mode spans (Copilot tool calls, model requests), non-agent perf
   spans across renderer / ext host / AHP boundaries, and security-audit
   events (extension installs, auth, settings-sync, remote-dev). This is
   the *content* that makes Part 1 demonstrably useful via internal
   dogfooding.

The demo at week 12 is the loop closing on itself: a VS Code Insiders
build emits its own multi-process traces and audit events; OTel Studio
inside the same window renders them; the developer asks Copilot "why
did that command feel slow?" or "did anything weird install in the last
hour?" and gets a grounded answer from the local store.

## Why now

1. **Copilot agent mode already emits OTel-shaped spans** of its own work with full `gen_ai.*` attributes. Sprint verification confirmed they land in our store and Copilot can self-debug from them. What's missing is the viewer and the join with the user's app traces.
2. **VS Code core wants cross-process tracing.** [`microsoft/vscode#316090`](https://github.com/microsoft/vscode/issues/316090) asks for "a simple unified multi-process logging and tracing service that can correlate events across [renderer / ext host / AHP] boundaries" and explicitly nominates OTel trace / span IDs. Our receiver + store + waterfall is that service.
3. **Audit signals unlock IR.** VS Code logs are already a goldmine for investigating extension-supply-chain attacks (MaliciousCorgi, prettier-vscode-plus, TigerJack, Checkmarx OpenVSX). Structured OTel events for extension installs, auth, settings-sync, and remote-dev sessions turn that goldmine into queryable, exportable forensic data — collectible by enterprise IR pipelines, debuggable by the developer through Copilot.
4. **Vendors are racing to own this surface.** Splunk shipped `observability-studio`; Harald shipped `vscode-otelme`. If we don't ship a first-party experience an ISV will define what "OTel in VS Code" looks like for us.

## References

- **[`otelux`](https://github.com/b1tank/otelux)** — prototype monorepo we are building on. Engine, receiver, webview UI, and MCP server already shipped in a desktop app; architecture was designed from day one to embed in a VS Code webview.
- **[`microsoft/vscode#316090`](https://github.com/microsoft/vscode/issues/316090)** — in-flight ask for unified multi-process logging / perf tracing in core; assigned to me + @roblourens + @sandy081.
- **[`vscode-otelme`](https://marketplace.visualstudio.com/items?itemName=digitarald.vscode-otelme)** — receives OTel from VS Code agents into local SQLite. No UI, no MCP. Reference only.
- **[`observability-studio`](https://marketplace.visualstudio.com/items?itemName=Splunk.observability-studio)** — traces / logs / metrics explorer + MCP but no Copilot integration and no agent-run correlation. Reference only.

## Expectation

**Part 1 — OTel Studio (viewer + Copilot/MCP integration)**

- [ ] Zero-config OTLP/HTTP receiver activates with the extension; SDKs see traces in ≤ 1 s.
- [ ] Webview explorer renders traces, logs, and (minimum-viable) metrics in real time.
- [ ] Copilot Chat answers "what broke?", "what's slow?", "what was my app doing during this agent run?" with citations to local span IDs.
- [ ] Codex / Claude / Cursor read the same store over MCP via one-click setup.

**Part 2 — VS Code internal instrumentation (content)**

- [ ] Agent-mode spans (Copilot tool calls, model requests, retries) flow through `IOTelService`.
- [ ] Non-agent perf spans correlate renderer / ext host / AHP work (resolves #316090) and render in the waterfall like any other trace.
- [ ] Security-audit events — extension install / update, auth, settings-sync, remote-dev session — emit as structured OTel events suitable for IR collection. PII-reviewed allow-list; off by default in Stable.

**Loop closed**

- [ ] Internal VS Code dogfooding demo: an Insiders build shows its own perf and audit traces in OTel Studio; Copilot answers a perf or security question from them.

## Work Streams

**Part 1 — OTel Studio**

- **Stream A — Extension shell.** Wire `@otelux/receiver` + `@otelux/engine-node` into the extension host; mount `@otelux/ui` in a webview through `@otelux/adapter-vscode`; multi-window port handoff via `claimSingleInstance`; status bar + settings.
- **Stream B — Copilot integration.** Promote the 5 existing tool registrations to first-class LM Tools (`vscode.lm.registerTool`) with `traceLink` round-trip; flip the two stubs (`searchLogs`, `correlateAgentRun`) to real once their engine work lands.
- **Stream C — External-agent integration.** Mount `@otelux/mcp-server`'s HTTP transport on `localhost:4319`; one-click commands that write Codex / Claude / Cursor config files.

**Part 2 — Core instrumentation**

- **Stream D — `IOTelService` in core.** Renderer + ext host + AHP. Emits spans for cross-process perf (#316090) and structured events for the audit signals above. Ships behind an off-by-default setting and exports OTLP to the same `localhost:4318` Part 1 owns, so the developer and the SOC look at the same data.
- **Stream E — Signal catalog.** Per-area instrumentation passes: command execution, file watcher, extension lifecycle, auth, settings-sync, remote tunnel. Each pass is its own small PR with a span/event spec reviewed by the area owner and (for audit events) the security team.

## Timeline & Milestones

| Weeks | Part 1 — OTel Studio | Part 2 — Core instrumentation |
|---|---|---|
| 1–2 | Light up the real workbench in the extension webview, bound to a live engine. | RFC for `IOTelService` API + audit-event allow-list, posted on #316090. |
| 3–4 | Production-grade receiver lifecycle: `claimSingleInstance` integration tests, status bar, settings. | Land `IOTelService` skeleton in core behind a setting; first spans from one cross-process command for end-to-end shape proof. |
| 5–6 | Logs path: OTLP/HTTP `/v1/logs`, FTS5-backed `searchLogs`, severity-aware table with trace pivot. | Perf instrumentation pass A: command execution + file watcher spans. |
| 7–8 | Copilot LM Tools end-to-end: `findRecentErrors`, `getTrace`, `searchLogs`, `getSlowestSpans`, `getServiceOverview` + `#otel` chat reference. | Perf instrumentation pass B: extension lifecycle + ext host RPC. |
| 9–10 | Agent-run correlation engine — the differentiator. Index `gen_ai.agent.run_id`, expose `correlateAgentRun(runId)`. UI rail "Agent runs". | Security-audit events: extension install/update, auth, settings-sync, remote-dev session start. |
| 11 | External-agent integration: one-click Codex / Claude / Cursor config writers. | Internal dogfood week — Insiders build emits, OTel Studio collects, the team uses it on their own VS Code for a week. |
| 12 | Perf, a11y, README + GIFs, internal preview release. | Write up the dogfood findings; produce the closing-the-loop demo video. |

## Current State (Phase 0 sprint, week 0)

A one-week scaffolding sprint preceding the 12 weeks landed every package
boundary Part 1 depends on, so week 1 starts on feature work:

- **Desktop app is feature-complete for M1 and dogfooding live** on `127.0.0.1:4319` (OTLP) and `127.0.0.1:4320` (MCP), with toggleable MCP setting and copy-on-click status pills.
- **MCP server is wire-compatible.** A live GitHub Copilot Chat client called `otel_get_service_overview`, `otel_get_slowest_spans`, `otel_get_trace`, `otel_get_span_details`, and `otel_find_recent_errors` against the running app and got grounded answers citing real span IDs. The two scoped stubs (`otel_search_logs`, `otel_correlate_agent_run`) return `supported:false` with the planned phase marker.
- **VS Code extension scaffold builds and activates.** Host + webview bundles ship; `@otelux/adapter-vscode` postMessage bridge wired; 5 `languageModelTools` declared and registered against a dispatcher shared with the MCP server.
- **Repo CI is green** on `main`: typecheck 20/20, tests 95+ passing, build 11/11. See [`docs/sprint.plan.md`](docs/sprint.plan.md) for the 8-task breakdown.

Reproduce in three commands:

```bash
git clone git@github.com:b1tank/otelux.git && cd otelux && npm install && ./otelux.sh
curl -sS http://127.0.0.1:4320/ -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Architecture

The two parts share one store. Part 2 emits; Part 1 reads.

```
                   ┌─── Part 2: VS Code internals ───┐
                   │  renderer · ext host · AHP      │
                   │  IOTelService → OTLP            │
                   └─────────────┬───────────────────┘
                                 │ (also: user's app, Copilot agent runs)
                                 ▼
                       @otelux/receiver  ──── Part 1
                                 │
                                 ▼
                       @otelux/engine-node
                         SQLite store (WAL)
                         │       │       │
              Webview UI │  LM Tools     │  MCP HTTP/stdio
              @otelux/ui │  (Copilot)    │  (Codex/Claude/Cursor)
                   ▲                          ▲
                   └── humans                 └── agents
```

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LM Tools API still proposed | Thin wrapper around the current shape; MCP path is the fallback and already works today. |
| Two windows fight for port 4318 | `claimSingleInstance` (spec § 7.1); already passing 5 tests, integration matrix scheduled for weeks 3–4. |
| Webview perf at 10k+ spans | `@otelux/ui` already virtualizes; perf budgets locked in spec § 8. |
| Part 2 core changes block on review | Land behind an off-by-default setting; ship Part 1 independently; turn on core emission incrementally per area pass. |
| Audit signals leak PII | Allow-listed attribute schema reviewed with the security team before any event ships; off by default in Stable; clear opt-in for IR collection. |
| Scope creep into a metrics dashboard | Hard stop at "table + simple chart"; full dashboard out of scope. |
| Splunk ships agent integration first | Our differentiator is **agent-run correlation** plus **first-party core instrumentation** — neither is reachable from outside the chat path or outside the editor. |

## Out of scope

Profiles · cloud sync · custom AI assistant inside the panel · backend export · auto-update / signing outside the VS Code marketplace · public-preview turn-on of audit signals (internal dogfood only at week 12).

## Asks

1. Sign-off on this scope, including Part 2 landing changes in `microsoft/vscode`.
2. Permission to publish `apps/vscode-extension` to the internal VS Code gallery at week 12.
3. ~30 min from Harald (multi-window collector + agent telemetry sounding board, week 1).
4. ~30 min from Sandy + Rob on the `IOTelService` RFC (#316090, week 2).
5. ~30 min from the security team on the audit-event allow-list (week 9).
