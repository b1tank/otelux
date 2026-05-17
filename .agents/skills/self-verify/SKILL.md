---
name: self-verify
description: Self-verify OTelux desktop app end-to-end by following test.md. Use when asked to test, verify, smoke-test, regress, or QA the app, OR after making changes to apps/desktop/** or packages/ui/** that could affect runtime behavior. Drives the app like a real user via deskpal (OCR + virtual input), with a CDP escape hatch only for invisible-to-the-eye state, and reports per-step PASS/FAIL.
---

# Skill — Self-verify the OTelux desktop app

You are an agent acting as a QA tester. Your job is to mechanically follow
`test.md` at the repo root and produce a per-step PASS/FAIL report.

**Mimic a real user as closely as possible.** The primary automation
surface is **deskpal** (the MCP server at `/home/b1tank/deskpal`): it
clicks via virtual mouse, types via `/dev/uinput`, screenshots, and reads
the screen with OCR — exactly what a person does. CDP is only the
escape hatch for properties OCR fundamentally cannot see.

## Tool choice (in priority order)

1. **deskpal** (default) — `launch_app`, `find_window`, `wait_for_window`,
   `click_text`, `type_text`, `key_press`, `read_screen_text`, `screenshot`,
   `mouse_move`, `scroll`, `drag`. This is what the user does. Use it first.
2. **CDP probe** (`/tmp/otelux-cdp.mjs`, see below) — narrow escape hatch
   for state that's *not visible on the screen*: the JSON content of
   `window.otelux.invoke({kind:"updateSettings", …})` results, the
   contents of `settings.json` after a write, port-listen state from
   `ss`. **Never use CDP for "did the user see X" assertions.**
3. **Shell** (`bash`, `curl`, `ss`, `cat`) — for OS-level probes that
   neither deskpal nor CDP exposes (port listening, file inspection,
   sending hostile HTTP payloads).

If a test.md step *can* be done via deskpal, **do it via deskpal**, even
if CDP would be faster — the point is to verify what a real user sees.

## Known deskpal gaps for this skill

The full list of proposed enhancements lives at
[/home/b1tank/deskpal/docs/proposed-tools.md](/home/b1tank/deskpal/docs/proposed-tools.md).
When the agent hits one, use the workaround inline and log it in the run
report under "deskpal gaps encountered".

| Gap | What we want | Workaround today |
|-----|--------------|------------------|
| **clipboard** | `get_clipboard` / `set_clipboard` to verify URL copy | shell `xclip -selection clipboard -o` (X11) or `wl-paste` (Wayland) |
| **icon click** | `click_image` / `click_aria_label` / `click_at_window_coords` for icon-only buttons like ⚙ and ✕ that OCR misreads | `get_window_geometry` + manual offset, then `click x y`; or fall back to keyboard shortcut |
| **filesystem read** | `read_file` to inspect `settings.json` | shell `cat` |
| **shell exec** | `exec` for `curl`/`ss`/`pkill` from inside deskpal | shell calls outside deskpal |
| **hover for tooltip** | `hover_text(text, ms)` that moves over an OCR'd element and waits for the tooltip | `mouse_move` then `sleep 1` then `screenshot` + `read_screen_text` |
| **focused-element** | `get_focused_element` for keyboard-focus tests | CDP probe of `document.activeElement` |

## When to invoke

- User says "verify", "test the app", "self-check", "smoke", "QA", "regress"
- Right after a non-trivial change under `apps/desktop/**`, `packages/ui/**`,
  `packages/engine-node/**`, or `packages/receiver-node/**`
- Before committing UX-visible changes

If the user gives a narrower scope ("just verify settings persistence"),
run only the relevant `test.md` sections.

## Workflow

Mark each step as PASS/FAIL with one-line evidence. Don't fix bugs while
testing — record them and continue. If a P1 (app won't launch, all
traces fail to ingest) hits, abort with the failure and request guidance.

### 1. Preflight (test.md §0)

```bash
cd /home/b1tank/otelux
node --version          # expect v22.x
npm run lint            # expect exit 0
npm run typecheck       # expect exit 0
npm run build           # expect 8/8 turbo tasks ok
```

### 2. Drop the CDP escape-hatch probe

Only used for invisible-to-the-eye state (see gaps table). Recreate every
run since it lives in `/tmp`.

```bash
pkill -9 -f "out/main/index.js" 2>/dev/null
rm -rf /tmp/otelux-userdata

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

`probe '<js-expr>'` is the only CDP entry point. Reach for it only for:

- IPC result JSON content (`window.otelux.invoke({kind:"updateSettings",…})`
  → `{ ok:false, error:"…" }`).
- `document.activeElement` for focus tests.
- Receiver status when it's hidden behind an error overlay OCR can't
  parse cleanly.

### 3. Launch the app via deskpal

```text
deskpal.launch_app({
  command: "/home/b1tank/otelux/node_modules/.bin/electron",
  args: ["/home/b1tank/otelux/apps/desktop/out/main/index.js",
         "--remote-debugging-port=19222",
         "--user-data-dir=/tmp/otelux-userdata"],
  env: { OTELUX_OTLP_PORT: "" },          // empty = use persisted
  waitForWindow: "OTelux",                 // or "Electron" if title not set
  timeout: 10
})
```

For env-override scenarios in §5, set `env.OTELUX_OTLP_PORT = "14999"`.
For a clean profile, `rm -rf /tmp/otelux-userdata` between launches via
shell.

### 4. Section-by-section, deskpal-first

Format the final report as a `Section | Step | Tool | Result | Evidence`
table.

#### §1 Cold start
- §1.1 — receiver bound. **shell.** `grep "listening on http://127.0.0.1:4319" /tmp/otelux-app.log` and `ss -ltnp | grep ':4319 '`.
- §1.2 — visible chrome. **deskpal.**
  ```text
  deskpal.read_screen_text({ window: "OTelux" })
    → assert text contains: "OTelux", "Local OpenTelemetry workbench",
      "OTLP/HTTP", "http://127.0.0.1:4319/v1/traces", "Traces", "0".
  deskpal.screenshot({ window: "OTelux", path: "/tmp/otelux-cold.png" })
  ```
- §1.3 — no settings file yet. **shell.** `test ! -f /tmp/otelux-userdata/settings.json`.

#### §2 EndpointBar
- §2.1 hover tooltip. **deskpal.** Hover-for-tooltip gap:
  ```text
  read_screen_text returns positions; use mouse_move to the dot's center,
  sleep 1s, then read_screen_text again → expect
  "listening on http://127.0.0.1:4319/v1/traces" appears as tooltip.
  ```
- §2.2 URL copy. **deskpal + shell (clipboard gap).**
  ```text
  deskpal.click_text({ text: "http://127.0.0.1" })   // OCR finds URL pill
  read_screen_text → expect "copied" briefly
  shell: xclip -selection clipboard -o
    → assert exactly "http://127.0.0.1:4319/v1/traces"
  ```
- §2.3 spam-click. **deskpal.** Loop `click_text` 5×, `screenshot`,
  re-read — UI must still be responsive.
- §2.4 cog opens settings. **deskpal, with icon-click gap.**
  OCR often misses ⚙. Try `click_text("⚙")` first; if it fails:
  ```text
  read_screen_text → find position of "http://127.0.0.1"
  click at (URL.x_end + 40, URL.y)   // cog is ~40px right of the URL
  ```
  `read_screen_text` should then include "Settings" and "OTLP/HTTP port".

#### §3 Modal close paths
- §3.1 ✕. **deskpal, icon-click gap.** Same coord fallback as cog.
- §3.2 Cancel. **deskpal.** `click_text("Cancel")`.
- §3.3 Escape. **deskpal.** `key_press("Escape")`.
- §3.4 backdrop click. **deskpal.** `get_window_geometry`; click at
  `(width - 20, height/2)` (outside the modal).
- §3.5 body click no-propagate. **deskpal.** `click_text("Settings")`
  on the header; modal should stay open.
- §3.6 Tab cycle. **deskpal + CDP (focus gap).** `key_press("Tab")` ×N
  and `probe 'document.activeElement?.className'` — focus must move
  port→Cancel→Save→port.

#### §4 Validation matrix
Real-user flow via deskpal is verbose but more representative:

```text
For each invalid V in [empty, 0, -1, 65536, "abc", 99999]:
  open settings cog (or it's already open)
  ctrl+a then Backspace to clear input
  type_text(V)
  click_text("Save")
  read_screen_text → expect "Port must be an integer between 1 and 65535"
  click_text("Cancel")
For port 22:
  same, read_screen_text → expect "failed to bind" and "EACCES"
  screenshot to confirm dot is red
For port 14320:
  modal should close; read_screen_text → URL contains "14320"
```

If OCR of the inline error is unreliable, escape-hatch:
`probe 'document.querySelector(".modal__error")?.textContent'`.

§4.12 (EADDRINUSE) requires a second listener (shell):
`python3 -c "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',14321)); s.listen(1); time.sleep(60)" &`.

#### §5 Persistence
Mostly shell + relaunch; deskpal confirms what the user sees.

```text
shell: cat /tmp/otelux-userdata/settings.json     # read_file gap
deskpal.launch_app(env={OTELUX_OTLP_PORT:""})     # no override
deskpal.read_screen_text → URL contains "14320"   (loaded from file)

deskpal.launch_app(env={OTELUX_OTLP_PORT:"14999"})
deskpal.read_screen_text → URL contains "14999"
shell: cat /tmp/otelux-userdata/settings.json → still 14320
                                                (env did NOT mutate file)

shell: echo 'not json' > /tmp/otelux-userdata/settings.json
deskpal.launch_app(env={})
deskpal.read_screen_text → URL contains "4319"   (fallback)

shell: echo '{"version":99}' > /tmp/otelux-userdata/settings.json
deskpal.launch_app(env={})
deskpal.read_screen_text → URL contains "4319"

deskpal.launch_app(env={OTELUX_OTLP_PORT:"abc"})
shell: tail -5 /tmp/otelux-app.log
```

#### §6 Trace ingest
```text
shell: PORT=4319 ./scripts/send-traces.sh
deskpal.read_screen_text → "Traces" count increments to 1; row shows
  "GET /api/users", "45.0ms", "api-gateway", "3 spans"
shell: FIXTURE=fixtures/distributed_trace.json PORT=4319 ./scripts/send-traces.sh
shell: FIXTURE=fixtures/sample_trace_error.json PORT=4319 ./scripts/send-traces.sh
deskpal.read_screen_text → count is 3; one row has "err" badge
deskpal.screenshot for evidence
```

#### §7 Selection + §8 Waterfall + §9 Inspector
```text
deskpal.click_text("GET /api/users")       // click the trace row by name
deskpal.read_screen_text → span names visible in main pane
deskpal.click_text("<span-name>")          // click a span in the waterfall
deskpal.read_screen_text → inspector shows "http.method" / "http.target"
deskpal.screenshot for visual evidence
```

Selection styling is a CSS class — if OCR proves the text is correct
but you want to assert "selected" styling, escape-hatch to:
`probe '!!document.querySelector(".otelux-trace-row.is-selected")'`.

#### §10 Malformed (shell only — hostile HTTP)
```bash
curl -s -X POST -H 'Content-Type: application/json' \
  --data-binary '@fixtures/malformed.json' \
  http://127.0.0.1:4319/v1/traces -o /dev/null -w '%{http_code}\n'   # 4xx
curl -s -X POST -H 'Content-Type: text/plain' --data 'x' \
  http://127.0.0.1:4319/v1/traces -o /dev/null -w '%{http_code}\n'   # 4xx
curl -s http://127.0.0.1:4319/ -o /dev/null -w '%{http_code}\n'      # 404
```
Then `deskpal.read_screen_text` to confirm trace count unchanged.

#### §11 Lifecycle stress
Drive five port flips via the real UI:
```text
for p in 14320 14321 14322 14323 14324:
  open cog → ctrl+a/Backspace → type_text(p) → click_text("Save")
  read_screen_text → URL shows the new port
shell: ss -ltnp | grep electron | wc -l    # → 1 (no zombies)
```

#### §12 Window lifecycle
```text
deskpal.key_press("ctrl+shift+i")    # DevTools opens (real key event)
deskpal.read_screen_text → "Elements" / "Console" tabs visible
deskpal.key_press("ctrl+shift+i")    # closes
deskpal.key_press("alt+F4")          # closes window
shell: sleep 1; ss -ltnp | grep -E ':4319|143[0-9][0-9]' → empty
```

### 5. Cleanup

```bash
pkill -9 -f "out/main/index.js" 2>/dev/null
pkill -9 -f electron 2>/dev/null
rm -rf /tmp/otelux-userdata
rm -f /tmp/otelux-cdp.mjs /tmp/otelux-app.log
# kill the EADDRINUSE helper if you spawned one in §4.12
pkill -9 -f "socket.*14321" 2>/dev/null
```

### 6. Report format

```
## Run summary
launched via: deskpal.launch_app
deskpal gaps encountered:
  - get_clipboard      (used xclip in §2.2)
  - click_image / icon (cog & ✕ via coord fallback in §2.4, §3.1)
  - read_file          (used shell cat in §5)
  - hover_text         (used mouse_move + sleep in §2.1)
  - get_focused_element(used CDP activeElement in §3.6)

## Per-step results
| Section | Step | Tool | Result | Evidence |
|---------|------|------|--------|----------|
| §1.1    | receiver bound on 4319 | shell | PASS | log line at /tmp/otelux-app.log:7 |
| §1.2    | initial chrome via OCR | deskpal | PASS | /tmp/otelux-cold.png |
| §2.2    | URL copy → clipboard   | deskpal+shell | PASS | xclip returned exact URL |
| §2.4    | cog opens settings     | deskpal (coord fallback) | PASS | OCR found "Settings" after click |
| §4.10   | port 22 → EACCES       | deskpal | FAIL | OCR found "EADDRINUSE" not "EACCES" — investigate |
…

PASS — N/N steps passed
```

End with either `PASS — N/N steps passed` or
`FAIL — M of N steps failed (severity: P1/P2/P3)`.

## Notes for the agent

- Run preflight first; if lint/typecheck fails, abort.
- One deskpal/CDP call per assertion. Don't bundle.
- If OCR returns garbage, take a `screenshot` and run `tesseract` on
  the file as a sanity check before declaring FAIL. If OCR is genuinely
  unable to read the rendered text, escape-hatch to CDP for that one
  step.
- After each port change, give the receiver ~500 ms to rebind before
  asserting on the new URL.
- Don't run §10.5 (oversize payload) or §12.4 (release noise) unless
  explicitly asked.
- If asked to "test what I just changed", scope to relevant sections.
- **When blocked by a deskpal gap, log it in the report. If
  `/home/b1tank/deskpal/docs/proposed-tools.md` doesn't already list
  it, mention adding it.**

## When NOT to use

- The user wants you to **change** code (not verify it).
- The user is doing a fresh init / "make a new app" — nothing to verify.
- A docs/config change with no runtime effect — no Electron needed.
