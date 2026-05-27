# OTel Studio for VS Code

- **Duration:** 12 weeks
- **Team:** 1 engineer

🔭 **Make OpenTelemetry a first-class surface inside VS Code.** Today VS Code
stops at "configure your SDK." We will ship **OTel Studio**, a VS Code
extension that (a) receives OTLP locally with zero config, (b) renders a
trace / log / metric explorer in a webview, and (c) exposes that telemetry
to Copilot via Language-Model Tools and to external agents
(Codex / Claude / Cursor) via MCP — so the agent grounds its answers in
real spans instead of guessing. The scope is deliberately not
Copilot-only: the same pipeline ingests **VS Code's own multi-process
traces and audit signals**, so the workbench doubles as a perf-tracing
and DFIR surface (see [Why now](#why-now)).

## Why now

1. **Copilot agent mode already emits OTel-shaped spans** of its own work — tool calls, model requests, retries — with full `gen_ai.*` attributes. Sprint verification confirmed they land in our store and Copilot can self-debug from them. What's missing is the viewer and the join with the user's app traces.
2. **VS Code itself wants cross-process tracing.** [`microsoft/vscode#316090`](https://github.com/microsoft/vscode/issues/316090) asks for "a simple unified multi-process logging and tracing service that can correlate events across [renderer / ext host / AHP] boundaries" and explicitly calls out OTel trace / span IDs as the option to evaluate. Our receiver + store + waterfall is that service — we just need a thin emitter in core.
3. **General VS Code OTel unlocks IR and auditing.** Per Ross Wollman's DFIR note, VS Code logs are already a goldmine for investigating extension-supply-chain attacks (MaliciousCorgi, prettier-vscode-plus, TigerJack, recent Checkmarx OpenVSX compromises). Structured OTel signals for **extension installs, auth events, settings-sync, remote-dev sessions** turn that goldmine into queryable, exportable forensic data — collectible by enterprise IR pipelines, debuggable by the developer through Copilot Chat against the same store.
4. **Vendors are racing to own this surface.** Splunk shipped `observability-studio`; Harald shipped `vscode-otelme`. If we don't ship a first-party experience an ISV will define what "OTel in VS Code" looks like for us.

## References

- **[`otelux`](https://github.com/b1tank/otelux)** — prototype monorepo we are building on. Engine, receiver, webview UI, and MCP server already shipped in a desktop app; architecture was designed from day one to embed in a webview, with no remaining technical blockers.
- **[`microsoft/vscode#316090`](https://github.com/microsoft/vscode/issues/316090)** — the in-flight ask for unified multi-process logging / perf tracing in core; assigned to me + @roblourens + @sandy081.
- **[`vscode-otelme`](https://marketplace.visualstudio.com/items?itemName=digitarald.vscode-otelme)** — receives OTel from VS Code agents into local SQLite. No UI, no MCP. Reference only.
- **[`observability-studio`](https://marketplace.visualstudio.com/items?itemName=Splunk.observability-studio)** — traces / logs / metrics explorer + MCP but no Copilot integration and no agent-run correlation. Reference only.

## Expectation

- [ ] Zero-config OTLP/HTTP receiver activates with the extension; SDKs see traces in ≤ 1 s.
- [ ] Webview explorer renders traces, logs, and (minimum-viable) metrics in real time.
- [ ] Copilot Chat answers "what broke?", "what's slow?", "what was my app doing during this agent run?" with citations to local span IDs.
- [ ] VS Code's own renderer / ext-host / AHP emit correlated spans (resolves #316090); waterfall renders them like any other trace.
- [ ] Audit-grade signals — extension install / update, auth, settings-sync, remote-dev session start — emitted as structured OTel events suitable for IR collection.

## Work Streams

- **Stream A — Extension shell.** Wire `@otelux/receiver` + `@otelux/engine-node` into the extension host; mount `@otelux/ui` in a webview through `@otelux/adapter-vscode`; multi-window port handoff via `claimSingleInstance`; status bar + settings.
- **Stream B — Copilot integration.** Promote the 5 existing tool registrations to first-class LM Tools (`vscode.lm.registerTool`) with `traceLink` round-trip; flip the two stubs (`searchLogs`, `correlateAgentRun`) to real once their engine work lands.
- **Stream C — External-agent integration.** Mount `@otelux/mcp-server`'s HTTP transport on `localhost:4319`; one-click commands that write Codex / Claude / Cursor config files.
- **Stream D — Core VS Code instrumentation.** Add an `IOTelService` in core (renderer + ext host + AHP) that emits spans for cross-process perf (#316090) and structured events for the audit signals in expectation #5. Ships behind a setting, exports OTLP to the same `localhost:4318` the extension owns, so the developer and the SOC look at the same data.

## Timeline & Milestones

| Weeks | Deliverable |
|---|---|
| 1–2 | Light up the real workbench in the extension webview, bound to a live engine. Demo: instrument a Node app, see traces in VS Code. |
| 3–4 | Production-grade receiver lifecycle: `claimSingleInstance` integration tests, status bar, settings contributions. Demo: two VS Code windows + desktop coexist. |
| 5–6 | Logs path: OTLP/HTTP `/v1/logs`, FTS5-backed `searchLogs`, severity-aware table with trace pivot. |
| 7–8 | Copilot LM Tools end-to-end: `findRecentErrors`, `getTrace`, `searchLogs`, `getSlowestSpans`, `getServiceOverview` + `#otel` chat reference. |
| 9–10 | Agent-run correlation engine — the differentiator. Index `gen_ai.agent.run_id`, expose `correlateAgentRun(runId)`. UI rail "Agent runs". |
| 11 | External-agent integration (Codex / Claude / Cursor config writers) **and** Stream D landing in core: multi-process perf spans + first audit events (extension install / update, auth). |
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
| Stream D core changes block on review | Land behind an off-by-default setting; ship the extension independently and turn on core emission incrementally. |
| Audit signals leak PII | Allow-listed attribute schema reviewed with the security team before any event ships; off by default in stable. |
| Scope creep into a metrics dashboard | Hard stop at "table + simple chart"; full dashboard out of scope. |
| Splunk ships agent integration first | Our differentiator is **Copilot agent-run correlation** plus **first-party core instrumentation** — neither is reachable from outside the chat path or outside the editor. |

## Out of scope

Profiles · cloud sync · custom AI assistant inside the panel · backend export · auto-update / signing outside the VS Code marketplace.

## Asks

1. Sign-off on this scope.
2. Permission to publish `apps/vscode-extension` to the internal VS Code gallery at week 12.
3. ~30 min from Harald (multi-window collector sounding board, week 1).
4. ~30 min from Bhavya (cache-inspection angle, week 6).
