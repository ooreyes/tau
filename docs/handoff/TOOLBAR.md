# TOOLBAR lane handoff requests (P3-12, P3-13, P3-04B)

Every request below is in a file the TOOLBAR lane does not own. Nothing here
blocks the lane's own commit: the shipped code degrades sensibly without any of
them (each entry says how), so these are completion and consistency requests,
not build breaks. The two marked **BLOCKS** are the exceptions.

Measured fact that shaped all of the colour requests below, because it
contradicts the recon note that suggested `color-mix()`:

> Chromium serialises `color-mix(in srgb, …)` **and** relative colour syntax
> (`hsl(from var(--x) …)`) as `color(srgb 0.88 0.67 0.36)`, not as `rgb(…)`.
> `scripts/pdf3-verify.mjs:773` parses colours with `/[\d.]+/g` and divides by
> 255, so every derived colour reads back as saturation ~0.09-0.25 and the
> gate scores a correctly coloured strip as grey. Measured in the same
> headless chromium the gate uses (`chromium.launch({args:["--force-color-profile=srgb"]})`),
> both themes. Consequence: **every gate-visible accent must be a bare token
> whose declared value is a hex/rgba literal.** That is why the requests below
> ask for real `:root` tokens rather than for mixes.

---

## apps/desktop/src/App.tsx (DOCK) - second `<EmptyState>`, currently :3697-3704

Why: P3-04B. That call site renders the card *inside an open, empty schematic*,
and it reuses the "no schematic open" copy, so it tells a reader who is already
in a schematic to create or open one.

Exact change - add two props to the `<EmptyState>` inside
`{components.length === 0 && wires.length === 0 && toolMode === "select" && (`:

```tsx
              <EmptyState
                projectOpen
                schematicOpen                      // NEW: selects the "place your first component" copy
                onShowParts={() => {               // NEW: reveal + focus the Components rail
                  setPartsOpen(true);              // set-true, NOT the toggling onFocusComponents at :3556-3566
                  setComponentFocusSignal((value) => value + 1);
                }}
                onNewCircuit={() => void startNewCircuit()}
                onAskBode={openAssistant}
                offerFirstSuccess={shouldOfferLearningPath(learningPath)}
                onTryFirstSuccess={() => void startFirstSuccessExample()}
              />
```

`setPartsOpen(true)` and not `onFocusComponents`: that handler is
`setPartsOpen((open) => !open)`, and `screenshots/pdf3-verify/before/P3-04B-empty-dark-1280x800.png`
shows the rail already open at 1280x800, so reusing it would close the panel the
new copy just pointed at.

The **first** `<EmptyState>` (:3621, `mode === "schematic" && !activeProjectFile`)
must NOT get `schematicOpen`. "Create or open a schematic" is correct there.

Degrades without it: `schematicOpen` defaults to `false`, so the card keeps
today's copy and P3-04B stays FAIL. **BLOCKS P3-04B.**

Not needed: any `data-parts-flash` plumbing. The highlight pulse is now driven
from `EmptyState.tsx` itself (it stamps `data-parts-flash="1"` on the enclosing
`.stage` for one animation cycle and clears it), so App.tsx needs no extra
state. An earlier draft of this file asked for that attribute; it is withdrawn.

---

## apps/desktop/src/App.tsx (DOCK) - simulator Probe button, :3 and :3754

Why: P3-12 says the probe reads as a red multimeter probe *wherever it appears*.
The editor tool strip is fixed in this lane; the simulator's circuit-tools Probe
button still draws lucide's crosshair, so the two disagree.

Exact change:

```tsx
-                    <Crosshair size={13} strokeWidth={1.7} aria-hidden="true" />
+                    <ProbeIcon size={13} aria-hidden="true" />
```

plus `import { ProbeIcon } from "./components/editor/ToolIcons";` and drop
`Crosshair` from the line-3 lucide import (it has no other use in App.tsx).
`ProbeIcon` is exported for exactly this. It draws its red from
`var(--tool-probe-ink, var(--danger))` through `currentColor`, so it inherits
whatever colour that button already sets; add `color: var(--danger)` to the
button's rule if the simulator's tool row should carry the red too.

Degrades without it: the editor shows a red probe and the simulator shows a
crosshair. Completes P3-12.

---

## apps/desktop/src/components/SimulationPanel.tsx (NO LANE OWNS THIS FILE) - :7 and :2170

Why: same reason. `.scope-empty-state`'s "Nothing to plot yet" glyph is the
third crosshair.

Exact change:

```tsx
-          <Crosshair size={20} strokeWidth={1.5} aria-hidden="true" />
+          <ProbeIcon size={20} aria-hidden="true" />
```

plus `import { ProbeIcon } from "./editor/ToolIcons";`, and drop `Crosshair`
from the line-7 lucide import (`FileDown` stays).

Degrades without it: cosmetic inconsistency only. Completes P3-12.

---

## apps/desktop/src/components/Canvas.tsx (CANVAS) - :1790-1797

Why: P3-12's "canvas probe cursor affordance". `canvasCursor` is an inline
`style={{ cursor }}`, so no stylesheet can override it without `!important`,
and probe mode currently shares the plain `"crosshair"` literal with
placing/wiring/labeling.

Exact change - split the probe branch out:

```tsx
+import { probeCursor } from "./editor/ToolIcons";
   const canvasCursor =
-    (interactive && (placing || wiring)) || probing || labeling
+    probing
+      ? probeCursor()
+      : (interactive && (placing || wiring)) || labeling
       ? "crosshair"
       : …
```

`probeCursor()` lives in the TOOLBAR lane's `components/editor/ToolIcons.tsx`.
It reads `--danger` / `--comp` off the live document with `getComputedStyle` and
builds the data-URL at call time, so (a) no raw colour is added to Canvas.tsx,
(b) the cursor follows the theme, and (c) it returns the plain string
`"crosshair"` when there is no document or the tokens are unreadable, so jsdom
and any headless path keep exactly today's value.

Degrades without it: probe mode keeps a crosshair cursor. Completes P3-12's
cursor clause.

---

## apps/desktop/src/components/Canvas.tsx (CANVAS) - :1786-1789 - NEGATIVE request

Do **not** recolour `.probe-marker` red. P3-12's phrase "any probe marker" must
not be applied literally here. `Canvas.tsx` renders
`<g className="probe-marker" style={{ color: p.color }}>` and `p.color` comes
from `store/useSchematic.ts`'s `PROBE_COLORS` rotation, which is the *trace*
palette: the marker's colour is the identity of its waveform on the scope.
Painting every marker red would break marker-to-trace correspondence - a
correctness regression wearing a style fix's clothes - and would contradict
DESIGN_SYSTEM.md section 0 ("If a legend swatch needs the trace color, that
swatch IS data"). The first probe already resolves to `--trace-red`.

Recorded here so no other lane implements P3-12 literally.

---

## DESIGN_SYSTEM.md (orchestrator) - a scoped subsection under section 4

Why: the document is normative and its own header says a conflicting change "is
wrong unless this document is updated in the same commit". Section 0 says
saturated colour means a measured trace or a status lamp, and "a trace hue may
never appear in chrome". The editor tool strip is chrome, so P3-13 needs the
exception written down rather than merely implemented.

Exact change - append to section 4 (Component rules):

```markdown
**Tool-strip material accents.** One narrowly scoped exception to section 0:
inside `.editor-toolbar` only, a tool icon may carry a material accent that
identifies the real object it depicts - a red wire, a kraft tag, a rose
eraser, a grey trash can, a red multimeter probe. The exception exists
because these icons are pictures of objects, not status; a nine-glyph
monochrome strip was reported as unreadable (UI_UX_PDF3.md P3-13). It does
not extend to any other chrome, it may not use a `--trace-*` hue, and a tool
with no real-world counterpart (Select, Simulation setup) stays neutral.
Accents come from `--tool-*-ink` where those tokens exist and otherwise from
the semantic tokens named in `styles/editorToolbarIcons.css`.
```

Degrades without it: the code and the normative doc disagree. **BLOCKS P3-13's
legality, not its behaviour.**

---

## apps/desktop/src/App.css (orchestrator) - four optional `--tool-*-ink` tokens

Why: quality, not function. The shipped stylesheet already resolves every
accent, but two of the five borrow a token whose *name* is about something else,
because no better token exists in both themes:

| Alias | Ships as | Wanted instead | Why the borrow is imperfect |
| --- | --- | --- | --- |
| `--tool-wire-ink` | `--danger` | - | correct as-is |
| `--tool-tag-ink` | `--signal` | `--tool-tag-ink` | `--signal` is the *running lamp* amber; the kraft tag is not status |
| `--tool-probe-ink` | `--danger` | - | correct as-is |
| `--tool-eraser-ink` | `--led-red` | `--tool-eraser-ink` | dark `#ff6b6b` really is eraser-pink, but light `--led-red` is `#c02718`, i.e. the same red as the wire, so the light-theme eraser reads red rather than rose |
| `--tool-history-undo-ink` | `--success` | - | acceptable |
| `--tool-history-redo-ink` | `--led-blue` | `--tool-history-redo-ink` | `--led-blue` is LED emission blue, and on light it equals `--accent`, the selection colour |

If you want the upgrade, add these to **all four** token blocks (`:root` :3,
`@media (prefers-color-scheme: light)` :301, `:root[data-theme="light"]` :441,
`:root[data-theme="dark"]` :573 - all four, because `styles/palette.test.ts`
documents that patching only the media query is exactly how the palette drifted
last time), above the `TAU-TOKEN-ZONE-END` marker at :694:

```css
  /* Tool-strip material accents - see DESIGN_SYSTEM section 4. Measured
     against --panel-3 (dark #161617 / light #E8EDF3). */
  --tool-tag-ink:           #D9A860;   /* dark  - kraft card, 8.37:1  */
  --tool-eraser-ink:        #E39AA8;   /* dark  - rubber rose, 8.14:1 */
  --tool-history-redo-ink:  #7FB2D9;   /* dark  - history blue, 7.98:1 */
```
```css
  --tool-tag-ink:           #8A6320;   /* light - kraft card, 4.59:1  */
  --tool-eraser-ink:        #B04A62;   /* light - rubber rose, 4.46:1 */
  --tool-history-redo-ink:  #0E6FA8;   /* light - history blue, 4.62:1 */
```

`styles/editorToolbarIcons.css` already consumes them as
`var(--tool-tag-ink, var(--signal))` etc., so adding the tokens is the whole
change - no component or stylesheet edit follows, and no test asserts the
fallback value.

Do **not** add these to `styles/editorToolbarIcons.css`: DESIGN_SYSTEM 7.4 says
tokens are defined once in App.css, and `scripts/design-system-dod-grep.mjs:97`
exempts only `App.css` and `styles/tokens.css` from the hex scan, so a `:root`
block anywhere else hard-fails that gate.

Degrades without it: the light-theme eraser is red rather than rose, and the
redo arrow uses the selection blue on light. Everything still passes.
