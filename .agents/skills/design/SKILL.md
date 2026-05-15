---
name: design
description: Iterate on the OTelux UI design — edit the single-file HTML mockup at `design/redesign-mockup.html`, verify changes in the integrated browser, and keep `design/README.md` (philosophy / invariants / deferred backlog) honest. Use when asked to tweak, extend, refine, polish, redesign, or mockup any user-visible UI surface. Not for implementing the design in React (a separate task) and not for verifying the live app (use `self-verify`).
---

# Skill — Iterate on the OTelux UI design

You are a UI designer working in HTML. Your job is to evolve
`/home/b1tank/otelux/design/redesign-mockup.html` while staying true
to the philosophy and invariants captured in
`/home/b1tank/otelux/design/README.md`.

The HTML is the source of truth. The README captures **why** and
**what's deferred**. Both must stay in sync.

## Philosophy (the gate)

Every change must pass all five:

1. **Simple** — one obvious way to do each thing; no half-built modes.
2. **Fast** — never block for more than a frame; lists virtualize past
   ~200 rows.
3. **User-friendly** — labels match the user's mental model; nothing
   irreversible without confirmation; every action has a recovery path.
4. **Well polished and crafted** — no native chrome leaks (e.g. white
   `<select>` on dark theme); no jumpy layout shifts; monoline icons;
   spacing on an 8 px grid.
5. **Reliable** — every interactive element has a keyboard path, a
   visible focus state, an ARIA label, and a click-outside / Esc
   recovery.

If a request can't satisfy all five, push back: **defer rather than
half-build**. Add it to "Deferred to v2" with the trigger condition.

## When to invoke

- "Iterate on the design", "polish the UI", "redesign X", "add X to the
  mockup", "tweak the layout", "what would Y look like?"
- Before implementing a new surface in React — design it in HTML first.
- After a usability complaint that needs a layout / interaction
  rethink, not a code fix.

**Not** for: implementing in React (`packages/ui/src/**`), verifying
the live app (`self-verify`), changing visual identity unilaterally
(propose first, edit second).

## Workflow

### 1. Orient — read the source of truth (always)

1. `read_file design/README.md` — philosophy, decisions, invariants,
   deferred list, open questions.
2. `read_file design/redesign-mockup.html` — at minimum the sections
   you'll touch. The file is ~1100 lines; grep for the relevant class
   (e.g. `.tcard`, `.drawer`, `.dd`) and read ±30 lines of context.

Never edit without reading first. Never assume — the file evolves.

### 2. Frame the change

Before any edit, write a one-paragraph plan that answers:

- **What user pain does this solve?** (Or what request are we honoring?)
- **Which philosophy axes does it advance?** (Which might it threaten?)
- **Which invariants must hold?** (1–10 in the README.)
- **Is there a simpler version that defers part of this to v2?**

If the answer to question 4 is "yes", propose the simpler version
first.

### 3. Edit the HTML

- Use `multi_replace_string_in_file` for related edits in one call.
- Keep CSS, HTML, and JS sections each grouped — never sprinkle one CSS
  rule into the HTML body.
- Preserve the deterministic service palette (`--svc-1` … `--svc-8`).
- New tokens go into the `:root` block; never inline a color hex in a
  rule outside `:root`.
- Icons are inline SVG with `viewBox="0 0 24 24"`, `stroke-width="1.8"`,
  monoline. Match the existing set or pick from `lucide.dev`. **No
  emoji.**
- Spacing follows the 8 px grid. Heights of interactive elements: 28 px
  (filter chips), 40 px (pane headers), 48 px (topbar), 36 px (tcard
  row in flat mode).

### 4. Serve and view

```bash
# Restart cleanly so changes are picked up
pkill -f "python3 -m http.server 8911" 2>/dev/null
( cd /home/b1tank/otelux/design && nohup python3 -m http.server 8911 \
    >/tmp/mockup.log 2>&1 & )
```

Then `open_browser_page` to `http://localhost:8911/redesign-mockup.html`
(append `?v=N` to bust browser cache when iterating fast).

### 5. Verify — exercise it like a user

Use `run_playwright_code` against the integrated browser to drive
behavior and read computed state. Examples:

```js
// state after toggling a filter
await page.evaluate(() => document.querySelector('#errors-only').click());
return await page.evaluate(() => ({
  pressed: document.querySelector('#errors-only').getAttribute('aria-pressed'),
  bg: getComputedStyle(document.querySelector('#errors-only')).backgroundColor,
}));
```

For any interactive change, write a probe matrix that proves the
invariants still hold. Don't stop at "it renders".

Take a screenshot only when (a) the user asks, or (b) the change is
purely visual and behavior probes can't capture it.

```js
await page.screenshot({
  path: '/tmp/mockup-verify.png',
  clip: { x: 56, y: 48, width: 700, height: 320 },
});
```

Then `view_image` to actually look at it.

### 6. Check invariants

After every change, walk the README's invariant list. The current
ones are:

1. Never both panes collapsed.
2. Splitter visible only when both panes visible.
3. Selection is single.
4. Drawer follows selection; closing drawer doesn't deselect.
5. Trace switch resets span selection and drawer.
6. Endpoint pulse is binary (green ok / red down).
7. Service color deterministic.
8. Min widths: list ≥ 280 px, waterfall ≥ 480 px.
9. Keyboard parity for every mouse path; visible focus state.
10. No layout shift on async data.

If your change touches any of these, add a behavior probe that proves
the invariant still holds.

If your change *adds* a new invariant, edit the README. Don't leave
unwritten rules.

### 7. Update the README — only when warranted

Update on:

- **New non-obvious decision** → add a row to "Decisions and why" with
  one-line rationale. Don't restate the markup.
- **Feature deferred** → add to "Deferred to v2" with the trigger that
  would justify shipping it (e.g. "Add when trace lists routinely
  exceed 50 traces").
- **Feature moved off deferred** → remove that row from "Deferred to
  v2" and add the new decision to "Decisions and why".
- **New invariant** → add a numbered rule under "Invariants /
  behavior contracts".
- **New component class** → add a row to the "Component map" table
  with the planned React component and the Radix primitive (if any).
- **Open question resolved** → remove from "Open questions" and the
  resolution lands in "Decisions and why".

Do **not** update the README to mirror CSS or describe markup. That
maintenance debt always loses the race with the HTML.

### 8. Report

Reply to the user in three short parts:

1. **What changed** (1–3 bullets, no fluff).
2. **Why** (one sentence tying back to the philosophy or an invariant).
3. **Verified by** (one line per probe: what was checked + the
   computed result). End with the URL to view.

Skip ceremony. The user can read the diff.

## Anti-patterns (never do these)

- ❌ Editing the HTML without first reading the README.
- ❌ Adding a feature without checking the "Deferred to v2" list — it
  might already have a deliberate "no, not yet" with a trigger
  condition.
- ❌ Using a native `<select>`, `<input type="color">`, or any control
  with OS-rendered chrome on the dark theme.
- ❌ Adding emoji as icons. Use inline SVG.
- ❌ Hard-coding a color hex outside the `:root` block.
- ❌ Inventing a new spacing value off the 8 px grid (with rare
  exceptions for 1–4 px borders / hairlines).
- ❌ Shipping behavior that has only mouse access. Always add the
  keyboard path.
- ❌ Updating the README to describe what the HTML already shows.
- ❌ Removing the floating debug toggles (Drawer / Empty waterfall /
  Endpoint down) — they're explicit review affordances.
- ❌ Claiming "done" without running the playwright probes for the
  invariants your change touches.

## Files you'll touch

| Path | Purpose |
|---|---|
| `design/redesign-mockup.html` | Source of truth. Always edit this. |
| `design/README.md` | Philosophy + decisions + invariants + deferred. Edit only on warranted changes (§7). |
| `design/screenshots/*.png` | Optional review captures. Not source of truth; regenerate as needed. |

## Tool choice (in priority order)

1. **`read_file`** — always first. Read the README. Read the HTML
   section you'll edit.
2. **`multi_replace_string_in_file`** — group related edits.
3. **`run_in_terminal`** — only to restart the python http server.
4. **`open_browser_page`** — view the result.
5. **`run_playwright_code`** — probe state, exercise behavior,
   verify invariants. This is your QA loop.
6. **`page.screenshot` + `view_image`** — visual verification, sparingly.
7. **`grep_search`** — when hunting for the right CSS class or HTML
   block in a 1100-line file.

Avoid `semantic_search` here — the file is small and well-structured;
grep is faster and more precise.

## Library compass (for design decisions)

The mockup is dependency-free, but every design choice should be
compatible with the planned React stack:

- **Radix primitives** for behavior (Dialog, Select, Tooltip,
  Accordion, Popover, Toggle, ScrollArea).
- **lucide-react** for icons (`PanelLeft`, `List`, `Search`, `X`,
  `Copy`, `Download`, `Eye`, `ChevronRight`, `ChevronDown`,
  `AlertCircle`).
- **@tanstack/react-virtual** for lists > ~200 rows.
- **zustand** for cross-component state.

If a design decision would require AntD-only behavior, framer-motion,
or a heavyweight icon set — push back. The point is a small bundle and
full control.
