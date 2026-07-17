# OTelux UI redesign

Companion notes for [`redesign-mockup.html`](./redesign-mockup.html). The HTML is the source of truth; this file captures **why** and **what's deferred**.

## Philosophy

> **Simple. Fast. User-friendly. Well polished and crafted. Reliable.**

Every decision in this folder should be defensible against that list.

- **Simple** — one obvious way to do each thing; no half-built modes; no settings for things we can default well.
- **Fast** — never block the UI for more than a frame; lists must virtualize past ~200 rows; no slow modal animations.
- **User-friendly** — labels match what the user is thinking (e.g. `Service`, not `Resource`); errors are diagnosable; nothing is irreversible without confirmation.
- **Well polished and crafted** — no native `<select>` chrome, no jumpy layout shifts, no white edges on dark theme, icons monoline and consistent, spacing on an 8 px grid.
- **Reliable** — every interactive element has a keyboard path, a focus state, an ARIA label, and a recovery path (Esc, click-outside, etc.).

If a feature can't satisfy all five, defer it.

## How to view

```bash
cd design
python3 -m http.server 8911
# open http://localhost:8911/redesign-mockup.html
```

Or open the file directly in any browser — no build, no deps.

The three floating buttons in the bottom-left flip mockup states (drawer / empty waterfall / endpoint down) and exist **only** for review. Remove them when porting to React.

---

## Layout at a glance

```
┌──┬──────────────────────────────────────────────────────────────┐
│  │ Traces                       OTLP/HTTP  http://…/v1/traces  │  topbar  (48 px)
│  ├──────────────────────────────────────────────────────────────┤
│  │ [ Service v ]  [ Errors only ]  [ 🔍 Search … ]   7 traces  │  filters (44 px)
│  ├────────────┬──────────────────────────────────────────────────┤
│ rail (56) │ trace list │ │ waterfall                            │
│            │ (360 px,  │█│ root span + meta · expand / collapse │
│            │  draggable│ │ ticks 0/25/50/75/100%                │
│            │  splitter)│ │ rows with indent + service color    │
│            │           │ │ → row click opens right drawer       │
│            │           │ │                                      │
└────────────┴───────────┴─┴──────────────────────────────────────┘
```

Min widths: list ≥ 280 px, waterfall ≥ 480 px. Splitter is 6 px wide with a generous hit area.

---

## Decisions and why

| Decision | Why |
|---|---|
| **Treat telemetry views as a workbench** | The product requirements are tracked in [`docs/spec.md`](../docs/spec.md), especially the Telemetry Workbench UX Requirements section. Table headers, details search, row actions, and trace/log correlation should feel native to OTelux's Service vocabulary and local-first visual tone. |
| **Service**, not Resource | Universal across Jaeger/SigNoz/Tempo. "Resource" is OTel spec jargon — only people who've read the SDK reference know it means `service.name`. |
| **Errors only** as a single chip toggle (not a Status dropdown) | One press, one of the top-three diagnostic actions. A 4-state dropdown would cost real estate for marginal benefit. Expand later only if needed. |
| **Search is one input** (not two) | The waterfall's "find-in-trace" overlapped with the global filter. One search is simpler and good enough until traces are very large. Find-in-trace returns in v2. |
| **Custom dropdown** (not `<select>`) | Native chrome leaks bright OS colors on dark theme. Same reason Jaeger and SigNoz ship their own. |
| **Drawer**, not modal, for span detail | Lets the user keep the waterfall in view while inspecting a span. Modal would force a context switch on every click. |
| **Accordion sections** in the drawer (not tabs) | We have few sections (Span / Attributes / Resource / Events) and they're all useful at once. Tabs hide content; accordions reveal-on-need. |
| **Value viewer is a modal** | A long JSON blob deserves a focused, big canvas with Copy / Download. The drawer is too narrow. |
| **Pane collapse buttons inside each pane's header**, not on the splitter | The splitter is a drag affordance, not a button-host. In-header chevrons are easier to hit and don't confuse the drag gesture. |
| **No vertical rail when a pane is collapsed** | Rotated text is hard to read. The remaining pane reclaims the full width; a restore button lives in the surviving pane's header. |
| **List flattens to single-row mode when waterfall is collapsed** | When the list owns the full width, three-line cards waste space. A 35 px row is ~2.3× denser and reads like a table. |
| **`[` and `]` toggle panes (no modifier)** | Discoverable when shown in titles, no Ctrl/Cmd guesswork, won't clash with browser shortcuts. |
| **Splitter min widths chosen from real content** | `280 px` keeps a 3-line card readable without truncating the timestamp; `480 px` keeps the waterfall name column + bar + duration legible. |
| **Compact 3-line trace cards** (vs a wider table) | The list pane is narrow on purpose. Cards trade horizontal density for vertical scannability and accommodate the variable-width service-chip set. |
| **Deterministic service color** (hash → 1 of 8) | Same service is always the same color across all rows, all traces, the drawer header dot, and the dropdown option dot. |
| **CSS variables for theme tokens** | Promote to `packages/ui/src/tokens.css` on port. One source of truth for colors, spacing, radii, type. |
| **Retention meter tracks SQLite pages, not WAL overhead** | The battery fill matches the exact page budget used by pruning. Real DB/WAL/SHM disk footprint stays visible beneath it without falsely implying temporary WAL growth should trigger retention. |

---

## Invariants / behavior contracts

These should be enforced in code, not in CSS.

1. **Never both panes collapsed.** Collapsing one auto-restores the other if it was hidden.
2. **Splitter is only visible when both panes are visible.**
3. **Selection is single.** A trace is selected → its waterfall renders. A span is selected → the drawer is open with that span.
4. **Drawer follows selection.** Clicking another span replaces drawer contents; closing the drawer does not deselect the span (so re-clicking the same row reopens).
5. **Trace switch resets span selection and drawer.**
6. **Endpoint pulse is binary.** Either healthy (green, slow pulse) or down (red, fast pulse). Never a third state.
7. **Service color is deterministic.** Same `service.name` → same `--svc-N` everywhere in the app. Never randomize.
8. **Min widths enforced.** Splitter clamps to `list ≥ 280 px` and `waterfall ≥ 480 px` regardless of window size.
9. **Keyboard parity.** Every interactive control reachable by mouse must also be reachable by keyboard, with a visible focus state.
10. **No layout shift on async data.** Skeleton or reserved height for rows that haven't loaded.
11. **Storage pressure matches pruning.** The retention meter fill uses SQLite page bytes; physical DB/WAL/SHM bytes are a separate breakdown.

---

## Brand mark

The name **OTelux** = OTel + flux. The brand mark is three horizontal arrows pointing right, with tails indenting from the left and tips cascading slightly down-right. The shape reads as both:

- **flux** — smooth right-pointing flow (the data the app receives), and
- **a trace waterfall** — root span on top, child spans indenting and getting shorter top-to-bottom (the same visual contract the workbench waterfall uses).

A violet → blue gradient anchored to `--accent-2` (#bb9af7) → `--accent` (#7aa2f7) ties the mark to the rest of the UI.

- **Master SVG:** [`apps/desktop/build/icon.svg`](../apps/desktop/build/icon.svg) — single source of truth for the geometry.
- **In-app component:** [`OTeluxLogo`](../packages/ui/src/primitives/OTeluxLogo.tsx) — same paths inlined as React, no `<rect>` background (the rail provides the surface).
- **Desktop app icon:** rasterized by [`scripts/build-icons.sh`](../scripts/build-icons.sh) to PNGs under `apps/desktop/build/icon.png` and `apps/desktop/build/icons/{16,32,48,64,128,256,512}x*.png`. electron-builder picks them up via the `linux.icon: build/icons` directory in [`apps/desktop/electron-builder.yml`](../apps/desktop/electron-builder.yml).
- **Favicon:** inlined as a data URL in [`apps/desktop/src/renderer/index.html`](../apps/desktop/src/renderer/index.html), so it survives the renderer CSP (`img-src 'self' data:`) without a separate served asset.

If you edit the geometry, edit `icon.svg`, mirror the change in `OTeluxLogo.tsx` and the mockup's `.rail__brand`, then run `./scripts/build-icons.sh` to refresh the PNGs.

---

## Component map (mockup → React)

| Mockup class | Planned React component | Suggested primitive |
|---|---|---|
| `.rail` + `.rail__item` | `<Rail>` + `<RailItem>` | none (hand-rolled, 50 lines) |
| `.topbar`, `.endpoint`, `.pulse` | `<TopBar>` + `<EndpointPill>` | none |
| `.dd` (Service dropdown) | `<ServiceSelect>` | [`@radix-ui/react-select`](https://www.radix-ui.com/primitives/docs/components/select) |
| `.filter-toggle` (Errors only) | `<FilterToggle>` | [`@radix-ui/react-toggle`](https://www.radix-ui.com/primitives/docs/components/toggle) |
| `.field--search` | `<SearchInput>` | none |
| `.workbench`, `.splitter`, `.pane--list`, `.pane--waterfall` | `<Workbench>` + `<Splitter>` | hand-rolled splitter or [`react-resizable-panels`](https://github.com/bvaughn/react-resizable-panels) |
| `.tlist` + `.tcard` (+ flat mode) | `<TraceList>` + `<TraceRow>` | [`@tanstack/react-virtual`](https://tanstack.com/virtual) above ~200 traces |
| `.wf__head`, `.ruler`, `.wf__rows`, `.row` | `<Waterfall>` + `<WaterfallRow>` | `@tanstack/react-virtual` above ~200 spans |
| `.drawer` + `.acc` | `<SpanDrawer>` + `<DrawerSection>` | [`@radix-ui/react-dialog`](https://www.radix-ui.com/primitives/docs/components/dialog) with `side="right"` styling, [`@radix-ui/react-accordion`](https://www.radix-ui.com/primitives/docs/components/accordion) |
| `.kv` + `.view-btn` | `<AttrRow>` + `<ViewValueButton>` | none |
| `.overlay` + `.viewer` | `<ValueViewer>` | `@radix-ui/react-dialog` (full modal) |
| `.empty` | `<EmptyState>` | none |
| `.storage-meter` + `.storage-battery` | `<StorageBudgetMeter>` | native meter semantics with custom presentation |
| All icons | `lucide-react` (`PanelLeft`, `PanelRight`, `List`, `Search`, `X`, `Copy`, `Download`, `Eye`, `ChevronRight`, `ChevronDown`, `AlertCircle`) | [`lucide-react`](https://lucide.dev) |

---

## Library recommendation (short version)

Total add: **~80–120 KB gzip**. Match SigNoz's strategy minus AntD.

```jsonc
{
  "@radix-ui/react-dialog":     "^1.x",  // value viewer modal + drawer
  "@radix-ui/react-select":     "^2.x",  // Service dropdown
  "@radix-ui/react-tooltip":    "^1.x",  // chip / icon tips
  "@radix-ui/react-accordion":  "^1.x",  // drawer sections
  "@radix-ui/react-popover":    "^1.x",  // span hover preview (v2)
  "@radix-ui/react-toggle":     "^1.x",  // Errors-only chip
  "@radix-ui/react-scroll-area":"^1.x",  // consistent scrollbars
  "lucide-react":               "^0.500",
  "@tanstack/react-virtual":    "^3.x",  // when rows > ~200
  "zustand":                    "^5.x",  // selection / filters / drawer state
  "clsx":                       "^2.x",
  "dayjs":                      "^1.11",
  "react-json-view-lite":       "^2.x",  // value viewer body when JSON
  "copy-to-clipboard":          "^3.x",
  "match-sorter":               "^8.x",  // when v2 find-in-trace lands
  "react-hotkeys-hook":         "^4.x"   // `[` `]` Esc / `?`
}
```

Skip: AntD, Material UI, Chakra, Fluent UI Web Components, framer-motion, Tailwind.

See the previous chat or the original recommendation for the full pros/cons.

---

## Deferred to v2

Not because they're bad — because shipping fewer well-built features beats shipping more half-built ones.

- **Resizable summary/details pane**. The fixed drawer remains simpler until logs/traces have richer table interactions that need more horizontal room.
- **Waterfall log markers**. Add when `DataSource` can efficiently fetch logs by trace/span and the UI can open log details from a span timeline marker.
- **Resizable/sortable columns for all dense tables**. Logs need headers immediately; full column management can wait until logs routinely exceed a few hundred rows or users need to compare wide services/messages.
- **Duration filter** (min / max or quick chips `>1s`, `>10s`). Add when the list regularly exceeds 50 traces.
- **Time range / lookback**. Live tail + pause is sufficient for now.
- **Find-in-trace** inside the waterfall (with `quoted phrases` and `-negation`, Jaeger-style). Add when single traces routinely have >50 spans.
- **Status dropdown** (instead of just `Errors only`). Add only if we hear users want OK / Warning / Error distinctions.
- **Span hover preview card** (SigNoz-style mini card on row hover). Nice but expensive — wait for user demand.
- **Service flame chart** / multi-service grouped view. Defer until we have multi-service traces in common workflows.
- **Virtualization** in the trace list and waterfall. Add as a swap-in once we hit ~200 rows; not before.
- **URL state** (sharable view via querystring). Wait for the second user.

---

## Open questions

1. **Floating debug toggles** (Drawer / Empty waterfall / Endpoint down) — port to a hidden dev panel (`?debug=1`) or just remove?
2. **Endpoint pulse** when paused — keep green, switch to yellow, or stop pulsing entirely?
3. **Trace card row 3 overflow** — when a trace has 5+ services, do we ellipsize chips (`api-gateway · order-svc · +3`) or wrap to a second line?
4. **Drawer width** — fixed 460 px, percent of viewport, or user-resizable like the main splitter?
5. **What does Settings open?** Still a modal? A dedicated route? A drawer from the right rail?
