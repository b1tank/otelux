# OTel Studio for VS Code

- **Duration:** 12 weeks
- **Team:** 1 engineer (intern-sized; reusable for any junior IC)
- **Status:** Phase 0 scaffold complete on `main`; ready for Phase 1 kickoff

🔭 **Make OpenTelemetry a first-class surface inside VS Code.** Today VS Code
stops at "configure your SDK." We will ship **OTel Studio**, a VS Code
extension that (a) receives OTLP locally with zero config, (b) renders a
polished trace/log/metric explorer in a webview, and (c) exposes that
telemetry to Copilot via Language-Model Tools and to external agents
(Codex / Claude / Cursor) via MCP — so the agent grounds its answers in
real spans instead of guessing. Built on top of **[`otelux`][otelux]**, my
existing TypeScript monorepo whose engine, receiver, UI, and MCP server
were designed from day one to embed in a webview. Splunk's
[`observability-studio`][obstudio] and Harald's
[`vscode-otelme`][otelme] are **reference only** — studied, not forked.

[otelme]: https://marketplace.visualstudio.com/items?itemName=digitarald.vscode-otelme
[obstudio]: https://marketplace.visualstudio.com/items?itemName=Splunk.observability-studio
[otelux]: https://github.com/b1tank/otelux

## Expectation

- [ ] Zero-config OTLP/HTTP receiver activates with the extension; SDKs see traces in ≤ 1 s.
- [ ] Webview explorer renders traces, logs, and (minimum-viable) metrics with VS Code theming.
- [ ] Copilot Chat answers "what broke?", "what's slow?", "what was my app doing during this agent run?" with citations to local span IDs.
- [ ] Codex / Claude / Cursor consume the same store over MCP via one-click setup.
- [ ] Multi-window safe: two VS Code windows + the desktop app coexist on one box, one owner per port.
- [ ] Performance budgets in [`otelux/docs/spec.md` § 8](docs/spec.md) met; internal preview published.

## Why now

1. **Copilot agent mode already emits OTel-shaped spans** of its own work — tool calls, model requests, retries. Sprint verification confirmed they land in our store with full `gen_ai.*` attributes. The data is sitting there; what's missing is the viewer and the join with the user's app traces.
2. **Vendors are racing to own this surface.** Splunk shipped `observability-studio` and Harald shipped `vscode-otelme`. If we don't ship a first-party experience an ISV will define what "OTel in VS Code" looks like for us.
3. **`otelux` is already half the deliverable** — the receiver, engine, SQLite store, waterfall UI, and MCP dispatcher all exist and ship today in a desktop app that is dogfooding live (see § Current State).

## Work Streams

- **Stream A — Extension shell.** Wire `@otelux/receiver` + `@otelux/engine-node` into the extension host; mount `@otelux/ui` in a webview through `@otelux/adapter-vscode`; multi-window port handoff via `claimSingleInstance`; status-bar + settings.
- **Stream B — Copilot integration.** Promote the 5 existing tool registrations to first-class LM Tools (`vscode.lm.registerTool`) with `traceLink` round-trip; flip the two stubs (`searchLogs`, `correlateAgentRun`) to real once their engine work lands.
- **Stream C — External-agent integration.** Mount `@otelux/mcp-server`'s HTTP transport on `localhost:4319`; one-click commands that write Codex / Claude / Cursor config files.

## Timeline & Milestones

| Weeks | Deliverable |
|---|---|
| 1–2 | Light up the real workbench in the extension webview, bound to a live engine. Demo: instrument a Node app, see traces in VS Code. |
| 3–4 | Production-grade receiver lifecycle: `claimSingleInstance` integration tests, status bar, settings contributions. Demo: two VS Code windows + desktop coexist. |
| 5–6 | Logs path: OTLP/HTTP `/v1/logs`, FTS5-backed `searchLogs`, severity-aware table with trace pivot. |
| 7–8 | Copilot LM Tools end-to-end: `findRecentErrors`, `getTrace`, `searchLogs`, `getSlowestSpans`, `getServiceOverview` + `#otel` chat reference. |
| 9–10 | Agent-run correlation engine — the differentiator. Index `gen_ai.agent.run_id`, expose `correlateAgentRun(runId)`. UI rail "Agent runs". |
| 11 | External-agent integration: one-click Codex / Claude / Cursor config writers. |
| 12 | Perf, a11y, README + GIFs, internal preview release. |

## Current State (Phase 0 sprint, week 0)

A one-week scaffolding sprint preceding the 12 weeks landed every package
boundary the plan depends on, so week 1 starts on feature work:

- **Desktop app is feature-complete for M1 and dogfooding live** on `127.0.0.1:4319` (OTLP) and `127.0.0.1:4320` (MCP), with toggleable MCP setting and copy-on-click status pills.
- **MCP server is wire-compatible.** A live GitHub Copilot Chat client called `otel_get_service_overview`, `otel_get_slowest_spans`, `otel_get_trace`, `otel_get_span_details`, and `otel_find_recent_errors` against the running app and got grounded answers citing real span IDs. The two scoped stubs (`otel_search_logs`, `otel_correlate_agent_run`) return `supported:false` with the planned phase marker.
- **VS Code extension scaffold builds and activates.** Host + webview bundles ship; `@otelux/adapter-vscode` postMessage bridge wired; 5 `languageModelTools` declared and registered against a dispatcher shared with the MCP server (one quality fix improves both surfaces).
- **Repo CI is green** on `main`: typecheck 20/20, tests 95+ passing, build 11/11. See [`docs/sprint.plan.md`](docs/sprint.plan.md) for the 8-task breakdown.

Reproduce in three commands:

```bash
git clone git@github.com:b1tank/otelux.git && cd otelux && npm install && ./otelux.sh
curl -sS http://127.0.0.1:4320/ -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Architecture

One shared store; the webview and every agent surface read from the same engine.

```
 User's app / Copilot agent ──OTLP──▶ @otelux/receiver
                                          │
                                          ▼
                                @otelux/engine-node
                                  SQLite store (WAL)
                                  │       │       │
                       Webview UI │   LM Tools    │ MCP HTTP/stdio
                       @otelux/ui │   (Copilot)   │ (Codex/Claude/Cursor)
```

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LM Tools API still proposed | Thin wrapper around the current shape; MCP path is the fallback and already works today. |
| Two windows fight for port 4318 | `claimSingleInstance` (spec § 7.1); already passing 5 tests, integration matrix scheduled for weeks 3–4. |
| Webview perf at 10k+ spans | `@otelux/ui` already virtualizes; perf budgets locked in spec § 8. |
| Scope creep into a metrics dashboard | Hard stop at "table + simple chart"; full dashboard out of scope. |
| Splunk ships agent integration first | Our differentiator is **Copilot agent-run correlation**, which they can't ship without being in the chat path. |

## Out of scope

Profiles · cloud sync · custom AI assistant inside the panel · backend export · auto-update / signing outside the VS Code marketplace.

## Asks

1. Sign-off on this scope.
2. Permission to publish `apps/vscode-extension` to the internal VS Code gallery at week 12.
3. ~30 min from Harald (multi-window collector sounding board, week 1).
4. ~30 min from Bhavya (cache-inspection angle, week 6).
