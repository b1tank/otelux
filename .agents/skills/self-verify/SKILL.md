---
name: self-verify
description: Self-verify OTelux desktop app end-to-end by following test.md. Use when asked to test, verify, smoke-test, regress, or QA the app, OR after making changes to apps/desktop/** or packages/ui/** that could affect runtime behavior. Builds, launches Electron, probes UI + IPC + receiver via CDP and curl, reports per-step PASS/FAIL.
---

# Skill — Self-verify the OTelux desktop app

You are an agent acting as a QA tester. Your job is to mechanically follow
`test.md` at the repo root and produce a per-step PASS/FAIL report.

You do **not** click — you drive the renderer over the Chrome DevTools
Protocol (CDP) and the receiver over curl. The human-clickable plan lives
in `test.md`; this skill is its automatable mirror.

## When to invoke

- User says "verify", "test the app", "self-check", "smoke", "QA", "regress"
- Right after a non-trivial change under `apps/desktop/**`, `packages/ui/**`,
  `packages/engine-node/**`, or `packages/receiver-node/**`
- Before committing UX-visible changes

If the user gives a narrower scope ("just verify settings persistence"),
run only the relevant `test.md` sections.

## Workflow

Mark each step as PASS/FAIL with one-line evidence. Don't fix bugs while
testing — record them and continue. If a P1 (app won't launch, all traces
fail to ingest) hits, abort with the failure and request guidance.

### 1. Preflight (test.md §0)

```bash
cd /home/b1tank/otelux
node --version          # expect v22.x
npm run lint            # expect exit 0
npm run typecheck       # expect exit 0
npm run build           # expect 8/8 turbo tasks ok
```

### 2. Set up a clean profile + CDP probe

```bash
pkill -9 -f "out/main/index.js" 2>/dev/null
rm -rf /tmp/otelux-userdata
```

Drop the CDP helper (it's gitignored / temp — recreate every run):

```bash
cat > /tmp/otelux-cdp.mjs <<'JS'
import WebSocket from '/home/b1tank/otelux/node_modules/ws/wrapper.mjs';
const port = process.env.CDP_PORT ?? '19222';
const expr = process.argv[2];
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('file://'));
if (!page) { console.error('no page target'); process.exit(3); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (m, p) => new Promise((res, rej) => {
  const my = ++id;
  const h = (d) => { const msg = JSON.parse(d.toString()); if (msg.id === my) { ws.off('message', h); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
  ws.on('message', h); ws.send(JSON.stringify({ id: my, method: m, params: p }));
});
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { try { return JSON.stringify({ ok: true, value: await (${expr}) }); } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); } })()`,
      awaitPromise: true, returnByValue: true,
    });
    console.log(r.result.value);
  } finally { ws.close(); }
});
JS
```

Helper to launch the app with CDP open:

```bash
launch() {
  local env_port="$1"  # e.g. "" for none, or "14999"
  pkill -9 -f "out/main/index.js" 2>/dev/null; sleep 0.3
  local env_prefix=""
  [[ -n "$env_port" ]] && env_prefix="OTELUX_OTLP_PORT=$env_port"
  cd /home/b1tank/otelux/apps/desktop
  eval "$env_prefix nohup npx electron out/main/index.js --remote-debugging-port=19222 --user-data-dir=/tmp/otelux-userdata > /tmp/otelux-app.log 2>&1 &"
  cd /home/b1tank/otelux
  sleep 3
}

probe() {
  node /tmp/otelux-cdp.mjs "$1"
}

quit() {
  pkill -9 -f "out/main/index.js" 2>/dev/null
  sleep 0.5
}
```

### 3. Section-by-section probes

For **each section** of `test.md`, run the matching probe(s) below. Format
the report as a Markdown table (`Step | Result | Evidence`).

#### §1 Cold start

```bash
launch ""
grep "listening on http://127.0.0.1:4318" /tmp/otelux-app.log   # §1.1
ss -ltnp 2>/dev/null | grep ':4318 '                            # §1.1
probe '({ bar: !!document.querySelector(".endpoint-bar"), running: !!document.querySelector(".endpoint-bar__dot--running"), url: document.querySelector("code")?.textContent, count: document.querySelector(".otelux-trace-list__count")?.textContent })'  # §1.2
test ! -f /tmp/otelux-userdata/settings.json && echo "no file (PASS)"  # §1.3
```

Expected: bar=true, running=true, url=http://127.0.0.1:4318/v1/traces, count=0, no file.

#### §2 EndpointBar (skip click-spam, can't programmatically clipboard-check reliably)

```bash
probe 'document.querySelector(".endpoint-bar__url--copy")?.title'   # → "Click to copy"
probe '(document.querySelector(".endpoint-bar__cog")?.click(), !!document.querySelector(".modal"))'  # § cog opens settings
```

#### §3 Modal close paths

```bash
# §3.3 Escape
probe '(document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), !!document.querySelector(".modal"))'
# Reopen for the next one:
probe 'document.querySelector(".endpoint-bar__cog")?.click()'
# §3.1 ✕
probe '(document.querySelector(".modal__close")?.click(), !!document.querySelector(".modal"))'
```

#### §4 Validation

Reopen modal, then for each invalid value drive the input + submit:

```bash
probe 'document.querySelector(".endpoint-bar__cog")?.click()'
probe '(() => { const i = document.querySelector(".modal input[type=number]"); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(i, "99999"); i.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector(".modal form").requestSubmit(); return new Promise(r => setTimeout(() => r(document.querySelector(".modal__error")?.textContent), 200)); })()'
```

Then exercise the IPC path directly — much cleaner than driving the form:

```bash
probe 'window.otelux.invoke({kind:"updateSettings", patch:{otlp:{port:0}}})'
probe 'window.otelux.invoke({kind:"updateSettings", patch:{otlp:{port:65536}}})'
probe 'window.otelux.invoke({kind:"updateSettings", patch:{otlp:{port:99999}}})'
probe 'window.otelux.invoke({kind:"updateSettings", patch:{otlp:{port:22}}})'   # EACCES on Linux
probe 'window.otelux.invoke({kind:"updateSettings", patch:{otlp:{port:14320}}})'
```

Expected `{ ok: false, error: ... }` for the first four, `{ ok: true, status: { kind: "running", port: 14320 } }` for the last.

#### §5 Persistence

```bash
cat /tmp/otelux-userdata/settings.json    # should show port:14320
quit
launch ""                                  # no env override
probe 'window.otelux.invoke({kind:"getSettings"})'   # → port:14320
quit

launch 14999
grep '127.0.0.1:14999' /tmp/otelux-app.log
probe 'window.otelux.invoke({kind:"getSettings"})'   # still {otlp:{port:14320}} — env is one-shot
quit

# Corrupt
echo 'not json' > /tmp/otelux-userdata/settings.json
launch ""
grep '127.0.0.1:4318' /tmp/otelux-app.log            # fell back to default
quit

# Invalid shape
echo '{"version":99}' > /tmp/otelux-userdata/settings.json
launch ""
probe 'window.otelux.invoke({kind:"getSettings"})'   # → default
quit

# Bad env
OTELUX_OTLP_PORT=abc launch ""
grep -E '(invalid|listening on)' /tmp/otelux-app.log | tail -3
```

#### §6 Trace ingest

```bash
launch ""
PORT=4318 ./scripts/send-traces.sh
sleep 0.5
probe 'document.querySelector(".otelux-trace-list__count")?.textContent'   # → "1"
FIXTURE=fixtures/distributed_trace.json PORT=4318 ./scripts/send-traces.sh
FIXTURE=fixtures/sample_trace_error.json PORT=4318 ./scripts/send-traces.sh
sleep 0.5
probe 'document.querySelector(".otelux-trace-list__count")?.textContent'   # → "3"
probe 'document.querySelectorAll(".otelux-trace-row__errors").length'      # → >=1
probe 'document.querySelectorAll(".otelux-trace-row").length'              # → 3
```

#### §7 Selection + §8 Waterfall + §9 Inspector

```bash
probe '(document.querySelector(".otelux-trace-row__button")?.click(), { sel: !!document.querySelector(".otelux-trace-row--selected"), waterfall: !!document.querySelector(".otelux-waterfall") })'
probe '(document.querySelector("[role=button][aria-label^=Span]")?.click(), { selSpan: !!document.querySelector(".otelux-waterfall__row--selected") })'
probe 'document.body.innerText.slice(0, 400)'   # eyeball — inspector should now show key=value
```

#### §10 Malformed

```bash
curl -s -X POST -H 'Content-Type: application/json' --data-binary '@fixtures/malformed.json' http://127.0.0.1:4318/v1/traces -o /dev/null -w '%{http_code}\n'   # → 4xx
curl -s -X POST -H 'Content-Type: text/plain' --data 'x' http://127.0.0.1:4318/v1/traces -o /dev/null -w '%{http_code}\n'                                       # → 4xx
curl -s -X POST -H 'Content-Type: application/json' --data '' http://127.0.0.1:4318/v1/traces -o /dev/null -w '%{http_code}\n'                                  # → 4xx
curl -s http://127.0.0.1:4318/ -o /dev/null -w '%{http_code}\n'                                                                                                  # → 404
```

#### §11 Lifecycle

```bash
for p in 14320 14321 14322 14323 14324; do
  probe "window.otelux.invoke({kind:\"updateSettings\", patch:{otlp:{port:$p}}})" >/dev/null
done
ss -ltnp | grep -E ':1432[0-4] ' | wc -l   # → 1
probe 'window.otelux.invoke({kind:"getReceiverStatus"})'   # → {kind:"running", port:14324}
```

#### §12 Lifecycle

```bash
quit
sleep 1
ss -ltnp | grep -E ':4318|143[0-9][0-9]' || echo "all ports released"
```

### 4. Cleanup

```bash
pkill -9 -f "out/main/index.js" 2>/dev/null
pkill -9 -f electron 2>/dev/null
rm -rf /tmp/otelux-userdata
rm -f /tmp/otelux-cdp.mjs /tmp/otelux-app.log
```

### 5. Report

Output a single Markdown table summarizing every step from §1–§12 in
test.md plus any deviations. Suggested format:

```
| Section | Step | Result | Notes |
|---------|------|--------|-------|
| §1.1    | log line  | PASS | found at line 7 |
| §4.10   | port 22   | FAIL | got EADDRINUSE, expected EACCES — log it |
...
```

End the report with one of:
- `PASS — N/N steps passed`
- `FAIL — M of N steps failed (severity: P1/P2/P3)`

## Notes for the agent

- Always run preflight first; if lint or typecheck fails, abort with that
  message and don't try to launch.
- Use one CDP probe per assertion; don't bundle, or you'll mis-attribute
  failures.
- Don't run §10.5 (oversize payload) unless explicitly asked.
- Don't run §12.4 (release-build noise) unless a packaged build exists.
- If asked to "test what I just changed", scope to the relevant section(s)
  rather than the full suite.

## When NOT to use

- The user wants you to **change** code (not verify it).
- The user is doing a fresh init / "make a new app" — there's nothing to
  verify yet.
- You only ran a docs/config change with no runtime effect (no need to
  spin up Electron).
