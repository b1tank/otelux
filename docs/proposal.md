# OTel Studio for VS Code

- **Duration:** 12 weeks
- **Team:** 1–2 engineers

🔭 **OpenTelemetry has become the de-facto data layer for agent observability — Copilot agent mode, Codex, Claude, and every credible competing agent product all emit it.** The data layer is solved. What is missing is the *post-configuration* story: once a user wires OTel up, where do they *see* the data, and how do humans and agents *use* it? This proposal closes that gap in two streams.

1. **A local-first, VS Code-native OTel experience** — an extension that lets humans and agents inside VS Code consume the OTel a user's apps and agent runs already emit.
2. **Cross-process OTel inside VS Code as the dogfood demo** — extend OTel emission into the rest of the VS Code stack so the team can use Stream 1 on its own perf and security telemetry and extrapolate the same story to customers.

The week-12 demo is the loop closing on itself, on two surfaces: (1) a Microsoft sample app like Contoso emits OTel and an agent inside VS Code uses the extension to diagnose a customer-shaped perf issue; (2) an Insiders VS Code build emits its own OTel and an agent in that same window uses the extension to diagnose a VS Code-internal perf or agent-session issue. Both fixes are proposed by the agent.

## Why now

1. **OTel is the agent-observability standard.** The data layer is solved; the viewer + agent-grounding layer is not.
2. **Vendors are racing to own the viewer.** Splunk shipped [`observability-studio`](https://marketplace.visualstudio.com/items?itemName=Splunk.observability-studio) and [`vscode-otelme`](https://marketplace.visualstudio.com/items?itemName=digitarald.vscode-otelme) shipped as a community extension. Both prove demand; neither closes the loop between humans, agents, and VS Code's own internals.
3. **VS Code core already wants this.** [`microsoft/vscode#316090`](https://github.com/microsoft/vscode/issues/316090) asks for a unified multi-process tracing service across renderer / ext host / AHP and explicitly nominates OTel trace / span IDs. Stream 2 lands that service.
4. **We have a runnable head start.** [`otelux`](https://github.com/b1tank/otelux) is a desktop prototype with a working OTLP receiver, local store, trace explorer UI, and MCP server already factored into reusable packages, with the VS Code adapter scoped in from day one. The 12 weeks fill the remaining gaps, not greenfield.

## Expectation

- [ ] A developer can investigate any agent run or app trace from inside VS Code without leaving the editor.
- [ ] Copilot Chat can answer "why did this fail?", "why was it slow?", "summarize my recent agent sessions", and "how could I have prompted this better?" grounded in the user's own OTel data.
- [ ] VS Code itself nudges users to install the extension at the four moments it pays off, off by default in Stable.
- [ ] An Insiders VS Code build emits its own cross-process perf and security-audit OTel behind an off-by-default setting, rendered by the same extension.
- [ ] The VS Code team has dogfooded both streams together for a week and the findings are written up.
- [ ] The extension is published to the VS Code Marketplace and the week-12 demo recording ships with it.

## Work Streams & Deliverables

### Stream 1 — Local-first VS Code experience

- Embed the existing receiver, engine, and webview UI into a VS Code extension shell via the existing adapter.
- Port the trace explorer; build the events and metrics explorers that the desktop prototype is missing.
- Stabilize and document an MCP tool surface covering trace, log / event, and metric queries plus agent-run correlation and session summary.
- Register the MCP tools as VS Code LM Tools and bundle four extension-provided skills wiring them into the normal agent flow.
- Add a small opt-in hook in VS Code core that surfaces an install tip at four trigger points: a failed agent session, a slow or token-heavy run, a session-summary request, and prompting-quality help.
- Publish to the VS Code Marketplace (internal preview channel first).

### Stream 2 — Cross-process OTel inside VS Code

- Land an `IOTelService` skeleton in core across renderer / ext host / AHP behind an off-by-default setting, exporting OTLP to the local endpoint Stream 1 owns.
- Instrument the cross-process perf signals called out in [#316090](https://github.com/microsoft/vscode/issues/316090): command execution, file watcher, extension lifecycle, ext-host RPC. Each area lands as its own small PR with an area-owner-reviewed spec.
- Optionally extend the same path to agent-mode spans for richer first-party data.
- Emit structured security-audit events for extension install / update, auth, settings-sync, and remote-dev session, behind a PII-reviewed allow-list with security sign-off.
- Run an internal dogfood week on an Insiders build with both streams on, then write up findings.

## Timeline & Milestones

### Weeks 1–4 — Foundations
- Stream 1: extension shell live, trace explorer rendering real spans; events and metrics explorers in flight.
- Stream 2: `IOTelService` RFC on [#316090](https://github.com/microsoft/vscode/issues/316090); skeleton in core behind a setting; first perf instrumentation lands.

### Weeks 5–8 — Depth
- Stream 1: events and metrics explorers at parity with traces; MCP tool surface stabilized and wired into the in-VS Code agent flow as LM Tool skills.
- Stream 2: cross-process perf passes land ([#316090](https://github.com/microsoft/vscode/issues/316090) signals); cross-process ↔ agent-run correlation working in the explorer.

### Weeks 9–11 — Dogfood + nudges
- Stream 1: in-core install nudges land at the four trigger points.
- Stream 2: security-audit events land behind a PII-reviewed allow-list; team dogfoods an Insiders build with both streams on for a week and writes up findings.

### Week 12 — Release + demo
- Marketplace publish (internal preview channel first).
- Record and ship the closing-the-loop demo on two surfaces: a Microsoft sample app like Contoso (customer-shaped perf issue) and an Insiders VS Code build (one VS Code-internal perf or agent-session issue), both diagnosed and fixed by an agent inside VS Code.

## Architecture

```
   ┌── Stream 2: VS Code internals ──┐
   │  renderer · ext host · AHP      │
   │  IOTelService ──► OTLP          │
   └────────────────┬────────────────┘
                    │  (also: user's app + agent runs)
                    ▼
              Local receiver + store  ◄──── Stream 1
                    │ (traces · events · metrics)
              ┌─────┴─────┐
              ▼           ▼
         Webview UI   LM Tools + skills
         (humans)     (in-VS Code agent flow)
                    ▲
                    │
            In-core UX tips
   (failed run · slow run · summary · prompting)
```

## Out of scope

Cloud sync · backend export · a custom AI assistant inside the panel · public-preview turn-on of security-audit events · non-OTel telemetry formats.

## References

- [`otelux`](https://github.com/b1tank/otelux) — prototype monorepo we build on. Receiver, engine, webview UI, and MCP server already shipped as reusable packages.
- [`microsoft/vscode#316090`](https://github.com/microsoft/vscode/issues/316090) — in-flight ask for unified multi-process tracing in core; Stream 2 lands the service it asks for.
- [`vscode-otelme`](https://marketplace.visualstudio.com/items?itemName=digitarald.vscode-otelme) — receiver + single SQL tool for Copilot Chat. No explorer UI, no agent skills, no in-core nudges, no cross-process emission.
- [`observability-studio`](https://marketplace.visualstudio.com/items?itemName=Splunk.observability-studio) — bundled Go observer with Metrics / Traces / Logs tabs and MCP config writers. No first-party Copilot integration, no in-core nudges, no VS Code internal instrumentation.
