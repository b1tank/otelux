# OTel Studio for VS Code

- **Duration:** 12 weeks
- **Team:** 1 engineer + 1 PM (Harald Kirschner)

🔭 **Make OpenTelemetry a first-class surface inside VS Code so humans and
agents can troubleshoot and monitor together.** Two parts, one closed loop:

1. **OTel Studio** — a zero-config OTLP collector + trace / log / metric
   explorer inside VS Code, with Copilot wired in via Language-Model
   Tools and external agents (Copilot CLI / Codex / Claude) via MCP.
   Humans read the waterfall; agents query the same store and ground
   their answers in real spans.
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

1. **Copilot agent mode already emits OTel-shaped spans** of its own work with full `gen_ai.*` attributes. What's missing is the viewer and the join with the user's app traces.
2. **VS Code core wants cross-process tracing.** [`microsoft/vscode#316090`](https://github.com/microsoft/vscode/issues/316090) asks for "a simple unified multi-process logging and tracing service that can correlate events across [renderer / ext host / AHP] boundaries" and explicitly nominates OTel trace / span IDs. Our receiver + store + waterfall is that service.
3. **Audit signals unlock IR.** VS Code logs are already a goldmine for investigating extension-supply-chain attacks (MaliciousCorgi, prettier-vscode-plus, TigerJack, Checkmarx OpenVSX). Structured OTel events for extension installs, auth, settings-sync, and remote-dev sessions turn that goldmine into queryable, exportable forensic data — collectible by enterprise IR pipelines, debuggable by the developer through Copilot.
4. **Vendors are racing to own this surface.** Splunk shipped `observability-studio`; Harald shipped `vscode-otelme`. If we don't ship a first-party experience an ISV will define what "OTel in VS Code" looks like for us.

## Expectation

**Part 1 — OTel Studio (viewer + Copilot/MCP integration)**

- [ ] Zero-config OTLP/HTTP receiver activates with the extension; SDKs see traces in ≤ 1 s.
- [ ] Webview explorer renders traces, logs, and (minimum-viable) metrics in real time.
- [ ] Copilot Chat answers "what broke?", "what's slow?", "what was my app doing during this agent run?" with citations to local span IDs.
- [ ] Copilot CLI / Codex / Claude read the same store over MCP via one-click setup.

**Part 2 — VS Code internal instrumentation (content)**

- [ ] Agent-mode spans (Copilot tool calls, model requests, retries) flow through `IOTelService`.
- [ ] Non-agent perf spans correlate renderer / ext host / AHP work (resolves #316090) and render in the waterfall like any other trace.
- [ ] Security-audit events — extension install / update, auth, settings-sync, remote-dev session — emit as structured OTel events suitable for IR collection. PII-reviewed allow-list; off by default in Stable.

**Loop closed**

- [ ] Internal VS Code dogfooding demo: an Insiders build shows its own perf and audit traces in OTel Studio; Copilot answers a perf or security question from them.

## Work Streams

**Part 1 — OTel Studio**

- **Stream A — Extension shell.** Wire `@otelux/receiver` + `@otelux/engine-node` into the extension host; mount `@otelux/ui` in a webview through `@otelux/adapter-vscode`; multi-window port handoff via `claimSingleInstance`; status bar + settings.
- **Stream B — Copilot integration.** Promote tool registrations to first-class LM Tools (`vscode.lm.registerTool`) with `traceLink` round-trip; ship `findRecentErrors`, `getTrace`, `searchLogs`, `getSlowestSpans`, `getServiceOverview`, and the differentiator `correlateAgentRun`.
- **Stream C — External-agent integration.** Mount `@otelux/mcp-server`'s HTTP transport on `localhost:4319`; one-click commands that write Copilot CLI / Codex / Claude config files.

**Part 2 — Core instrumentation**

- **Stream D — `IOTelService` in core.** Renderer + ext host + AHP. Emits spans for cross-process perf (#316090) and structured events for the audit signals above. Ships behind an off-by-default setting and exports OTLP to the same `localhost:4318` Part 1 owns, so the developer and the SOC look at the same data.
- **Stream E — Signal catalog.** Per-area instrumentation passes: command execution, file watcher, extension lifecycle, auth, settings-sync, remote tunnel. Each pass is its own small PR with a span/event spec reviewed by the area owner and (for audit events) the security team.

## Timeline

- **Weeks 1–4 — Foundations.** Part 1: real workbench in the extension webview, bound to a live engine; multi-window receiver lifecycle. Part 2: `IOTelService` RFC on #316090 and skeleton landed in core behind a setting.
- **Weeks 5–8 — Depth.** Part 1: logs path (OTLP `/v1/logs`, FTS5 search) and Copilot LM Tools end-to-end. Part 2: perf instrumentation passes (command execution, file watcher, extension lifecycle, ext host RPC).
- **Weeks 9–11 — Differentiator + dogfood.** Part 1: agent-run correlation engine + external-agent config writers (Copilot CLI / Codex / Claude). Part 2: security-audit events landed; team uses an Insiders build with both halves on for a week.
- **Week 12 — Polish + release.** Perf, a11y, README + GIFs, internal preview release, dogfood findings write-up, closing-the-loop demo video.

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
              @otelux/ui │  (Copilot)    │  (Copilot CLI/Codex/Claude)
                   ▲                          ▲
                   └── humans                 └── agents
```

## Out of scope

Profiles · cloud sync · custom AI assistant inside the panel · backend export · auto-update / signing outside the VS Code marketplace · public-preview turn-on of audit signals (internal dogfood only at week 12).

## References

- **[`otelux`](https://github.com/b1tank/otelux)** — prototype monorepo we are building on. Engine, receiver, webview UI, and MCP server already shipped in a desktop app; architecture was designed from day one to embed in a VS Code webview.
- **[`microsoft/vscode#316090`](https://github.com/microsoft/vscode/issues/316090)** — in-flight ask for unified multi-process logging / perf tracing in core; assigned to me + @roblourens + @sandy081.
- **[`vscode-otelme`](https://marketplace.visualstudio.com/items?itemName=digitarald.vscode-otelme)** — lightweight OTLP/HTTP receiver inside VS Code that stores traces / metrics / logs in local SQLite, queryable from Copilot Chat via a single `#otelme` SQL tool. No explorer UI, no waterfall, no agent-run correlation, no first-party MCP for external agents.
- **[`observability-studio`](https://marketplace.visualstudio.com/items?itemName=Splunk.observability-studio)** — bundles a prebuilt Go observer binary, exposes OTLP on 4318/4317, shows Metrics / Traces / Logs / Validation tabs in a webview iframe, and writes MCP config for Codex / Claude Code / Cursor. No first-party Copilot LM Tools, no agent-run correlation, no VS Code internal instrumentation.
