# TOOLBAR lane handoff requests (P3-12, P3-13, P3-04B)

Rewritten after the session-limit abort. The earlier draft of this file was
written before the code existed and described a stylesheet that borrowed
`--danger` / `--signal` / `--led-red`; that is obsolete. The orchestrator added
the real `--tool-*-ink` set in `539e07e` and `styles/editorToolbarIcons.css`
now consumes those tokens directly, so the whole "four optional tokens" section
of the old draft is withdrawn. Two requests below are new or changed; the rest
carry over unchanged.

Status of the two items that used to block this lane: **both cleared.**
`DESIGN_SYSTEM.md` §0.1 grants the tool-object-ink exception, and the seven
`--tool-*-ink` pairs exist in all four theme blocks. Nothing further is needed
from either file except the one measured value correction below.

---

## apps/desktop/src/App.css (orchestrator) — `--tool-undo-ink` is half a point below the accent bar in light

Why: `scripts/pdf3-verify.mjs:889` now judges an accent in **HSL saturation**
(`SAT = 0.3`), not by channel spread. Measured with that script's own `hsl()`
function on the shipped token values:

| Token | Dark | s | Light | s |
| --- | --- | --- | --- | --- |
| `--tool-wire-ink` | `#e4574b` | 0.739 | `#c0392b` | 0.634 |
| `--tool-probe-ink` | `#ea4f42` | 0.800 | `#b32b22` | 0.681 |
| `--tool-tag-ink` | `#c4a24e` | 0.500 | `#7a601b` | 0.638 |
| `--tool-eraser-ink` | `#d9829a` | 0.534 | `#9f4463` | 0.401 |
| `--tool-steel-ink` | `#9aa3ae` | 0.110 | `#5b6572` | 0.112 | (neutral by design — correct) |
| **`--tool-undo-ink`** | `#8e8fc4` | **0.314** | `#5a5c99` | **0.259** |
| `--tool-redo-ink` | `#5fb3a6` | 0.356 | `#286d62` | 0.463 |

In the gate's state (a resistor placed) Redo is the one disabled tool, so the
accented-and-enabled set is exactly {wire, tag, probe, eraser, undo} = 5
against a floor of `need = 5`. Light-theme undo at 0.259 drops that to **4 and
the check fails**; dark at 0.314 passes with 0.014 to spare.

Exact change — same violet, more chroma, in **all four** token blocks:

```css
  --tool-undo-ink:       #9b9ce0;   /* dark  - h239 s0.527, 7.08:1 on #161617 */
```
```css
  --tool-undo-ink:       #4a4ea6;   /* light - h237 s0.383, 6.09:1 on #E8EDF3 */
```

Both were measured against their own theme's `--panel-3` with the WCAG 2.x
relative-luminance formula, and both improve on the current contrast (5.92 dark
/ 5.21 light). Hue is unchanged to within 2deg, so nothing about the design
moves; only the chroma does.

Blocks: **P3-13's light-theme gate result.** The code needs no edit — the
stylesheet already reads `var(--tool-undo-ink)`.

---

## apps/desktop/src/App.tsx (DOCK) — second `<EmptyState>`, currently :3813-3820

Why: P3-04B. That call site renders the card *inside an open, empty schematic*
and reuses the "no schematic open" copy, so it tells a reader who is already in
a schematic to create or open one.

Exact change — two props on the `<EmptyState>` inside
`{components.length === 0 && wires.length === 0 && toolMode === "select" && (`:

```tsx
              <EmptyState
                projectOpen
                schematicOpen                      // NEW: selects the "place your first component" copy
                onShowParts={() => {               // NEW: reveal + focus the Components rail
                  setPartsOpen(true);              // set-true, NOT the toggling onFocusComponents
                  setComponentFocusSignal((value) => value + 1);
                }}
                onNewCircuit={() => void startNewCircuit()}
                onAskBode={openAssistant}
                offerFirstSuccess={shouldOfferLearningPath(learningPath)}
                onTryFirstSuccess={() => void startFirstSuccessExample()}
              />
```

`setPartsOpen(true)` and not `onFocusComponents`: that handler is
`setPartsOpen((open) => !open)`, and
`screenshots/pdf3-verify/before/P3-04B-empty-dark-1280x800.png` shows the rail
already open at 1280x800, so reusing it would close the panel the new copy just
pointed at.

The **first** `<EmptyState>` (:3737, `mode === "schematic" && !activeProjectFile`)
must NOT get `schematicOpen`. "Create or open a schematic" is correct there.

No `data-parts-flash` plumbing is needed: `EmptyState` stamps the attribute on
the enclosing `.stage` itself and clears it on `animationend` (with a 900 ms
timeout fallback, because `prefers-reduced-motion` suppresses the animation and
therefore the event). An earlier draft asked App.tsx for that attribute; that
request is withdrawn.

Degrades without it: `schematicOpen` defaults to `false`, so the card keeps
today's copy. **Blocks P3-04B.**

---

## apps/desktop/src/App.tsx (DOCK) — simulator Probe button, :30 and :3873 — ALREADY APPLIED

Recorded as done so nobody re-applies it: the import at :30 and
`<ProbeIcon size={13} aria-hidden="true" />` at :3873 are already in the tree.
`ProbeIcon` now exists and accepts arbitrary svg props, so that call typechecks.
Nothing further needed.

---

## apps/desktop/src/components/SimulationPanel.tsx (NO LANE OWNS THIS FILE — orchestrator) — :7 and :2170

Why: P3-12 says the probe reads as a red multimeter probe wherever it appears.
`.scope-empty-state`'s "Nothing to plot yet" glyph is the last crosshair left.

```tsx
-          <Crosshair size={20} strokeWidth={1.5} aria-hidden="true" />
+          <ProbeIcon size={20} aria-hidden="true" />
```

plus `import { ProbeIcon } from "./editor/ToolIcons";` and drop `Crosshair`
from the line-7 lucide import (`FileDown` stays — it has other uses).

Outside `.editor-toolbar` the glyph's `--ti-1` / `--ti-2` are unset, so it
falls back to `currentColor` and stays monochrome: DESIGN_SYSTEM §0.1's
"editor tool strip only" clause holds without a special case.

Degrades without it: cosmetic inconsistency only. Completes P3-12.

---

## apps/desktop/src/components/Canvas.tsx (CANVAS) — :1790-1797

Why: P3-12's "canvas probe cursor affordance". `canvasCursor` is an inline
`style={{ cursor }}` (:1818), so no stylesheet can override it without
`!important`, and probe mode currently shares the plain `"crosshair"` literal
with placing/wiring/labeling.

```tsx
+import { probeCursor } from "./editor/ToolIcons";
   const canvasCursor =
-    (interactive && (placing || wiring)) || probing || labeling
-      ? "crosshair"
+    probing
+      ? probeCursor()
+      : (interactive && (placing || wiring)) || labeling
+        ? "crosshair"
       : …
```

`probeCursor()` reads `--tool-probe-ink` / `--tool-steel-ink` off the live
document with `getComputedStyle` and builds the data URL at call time, so
(a) no raw colour is added to Canvas.tsx, (b) the cursor follows the theme, and
(c) it returns the bare string `"crosshair"` when there is no document or the
tokens are unreadable — so jsdom and any headless path keep exactly today's
value and no existing cursor test moves.

Degrades without it: probe mode keeps a crosshair cursor. Completes P3-12's
cursor clause.

---

## apps/desktop/src/components/Canvas.tsx (CANVAS) — :1786-1789 — NEGATIVE request

Do **not** recolour `.probe-marker` red. P3-12's phrase "any probe marker" must
not be applied literally here. `Canvas.tsx` renders
`<g className="probe-marker" style={{ color: p.color }}>` and `p.color` comes
from `store/useSchematic.ts`'s `PROBE_COLORS` rotation, which is the *trace*
palette: the marker's colour is the identity of its waveform on the scope.
Painting every marker red would break marker-to-trace correspondence — a
correctness regression wearing a style fix's clothes — and would contradict
DESIGN_SYSTEM §0 ("If a legend swatch needs the trace color, that swatch IS
data") and §0.1's disjoint-palette clause. The first probe already resolves to
`--trace-red`, so a single-probe schematic reads red anyway.

Recorded here so no other lane implements P3-12 literally.

---

## THIRD_PARTY_NOTICES — no change required

Stated explicitly so a reviewer need not re-derive it. The seven new glyphs in
`components/editor/ToolIcons.tsx` are fresh geometry: no lucide path data was
copied or edited, and nothing was traced from the photographic references in
the report PDF. Select and Simulation setup still render lucide components,
which are covered by the existing lucide-react ISC entry (THIRD_PARTY_NOTICES
:153 and the §5 licence text). No new attribution section is owed.

---

## VERIFY pass (independent) — what is confirmed still open

Re-measured from the tree, not from the build agent's notes.

1. **`--tool-undo-ink` really does fail the light-theme gate. Confirmed, and
   the escape hatch does not exist.** `scripts/pdf3-verify.mjs:197` presses
   Escape at the end of `place()`, so `hasSelection` is false when the strip is
   sampled and **Delete selection is disabled** — it is excluded from `enabled`
   and cannot make up the fifth accent. Redo is disabled too (empty future).
   The enabled toned set is therefore exactly {wire, tag, probe, eraser, undo}:
   dark `0.739 / 0.500 / 0.800 / 0.534 / 0.314` = 5/5 **PASS**;
   light `0.634 / 0.638 / 0.681 / 0.401 / 0.259` = 4/5 **FAIL**.
   Hue distinctness is not the problem (4 distinct in dark, 3 in light, floor 3).
   The `#4a4ea6` correction above was recomputed independently: s 0.383,
   6.088:1 on `#E8EDF3`. Both numbers check out. **Still blocking P3-13 in light.**

2. **P3-12's cursor clause is still open.** `Canvas.tsx:1791` is still the bare
   `"crosshair"` literal and nothing imports `probeCursor`. The function exists
   and is tested; the one-line call site has not landed.

3. **`SimulationPanel.tsx:7,2170` still renders `Crosshair`.** Unchanged.

4. Not a blocker, recorded so nobody chases it: in **light** theme the bin's
   flutes (`var(--panel-3)` = `#E8EDF3`) measure s 0.314 h 213 in the gate's own
   HSL, so the "grey trash can" would register as an *accent* if that button were
   ever enabled when the strip is sampled. It never is (Escape clears the
   selection first), so today it neither helps nor hurts — but a future gate that
   samples with a selection live would score the strip 5/5 in light for the wrong
   reason.
