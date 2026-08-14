# Handoff — LANE BLOCK (Item 14 geometry, symbol rendering, on-drawing gesture, navigation)

Branch base `cdecde0`. Files touched, and nothing else:

- `apps/desktop/src/schematic/subcircuitGeometry.ts` (+ `.test.ts`)
- `apps/desktop/src/components/Canvas.tsx`
- `apps/desktop/src/components/Canvas.geometry.test.ts`
- `apps/desktop/src/components/Canvas.shapes.test.tsx`

`schematic/symbols.tsx` and `components/Canvas.geometry.ts` were **not** modified.
The generic 48×40 two-lead `subckt` fallback in `symbols.tsx:1770-1781` is untouched — it
is still exactly what an unlinked / imported / file-backed X device draws, and a
project-linked instance never reaches it. `Canvas.geometry.ts` needed no edit because
`nativeSubcircuitBody` stayed a pure function of the persisted bank, so the four call
sites at `:59, :100, :372, :1278` follow the widened body for free.

## projectHierarchy.ts needs NO change from this lane

Stated explicitly so nobody refactors the fail-closed core on BLOCK's behalf. The
direction-aware side rule is admissible precisely because it cannot change the emitted
netlist: `buildSubcircuitPinOverride` keeps pin `id` at `p{i+1}` and `label` at
`ports[i]` in ports order whichever column the pin lands in, and
`exactLinkForComponent` (projectHierarchy.ts:162-173) sorts by the numeric part of the
id and asserts only `id` and `label`. Neither it nor `documentValidation` reads `x`/`y`.
The `X` card is byte-identical either way. All nine `projectHierarchy.test.ts` cases and
the `ascExport.test.ts` / `spiceNetlist.test.ts` baselines pass unmodified.

## Frozen geometry exports (Deliverable 1) — already consumed by PARENT

```ts
subcircuitPortSlots(ports, directions?): readonly { side: "left"|"right"; index: number }[]
subcircuitBankSides(component): readonly ("left"|"right"|null)[]
buildSubcircuitPinOverride(component, ports, directions?): PinOverride[]
```

Also exported and used by the renderer, available to anyone:
`SUBCIRCUIT_BODY_MAX_HALF_WIDTH` (40), `SUBCIRCUIT_CAPTION_INSET` (4),
`SUBCIRCUIT_CAPTION_ADVANCE` (4.2), `SUBCIRCUIT_MODEL_GUTTER` (8),
`subcircuitCaptionWidth`, `subcircuitCaptionBudget`, `middleEllipsisCaption`.

PARENT is already calling `subcircuitBankSides` / `subcircuitPortSlots` from
`ShellPanels.tsx:1475, :1476, :2139, :2167, :2169`.

## App.css — every new class, and the token intended for each

`App.css` is orchestrator-owned. Nothing in this lane styled itself; these classes are
referenced by the markup and currently render unstyled.

| class | what it is | intended token(s) |
| --- | --- | --- |
| `.net-candidate-layer` | wrapper for the label-tool candidate marks | none (layer only; `pointer-events: none`) |
| `.net-candidate-mark` | r=3 hairline ring on every electrical net point, label tool only | `stroke: var(--accent)`, `fill: none`, hairline `stroke-width`, `opacity` at emphasis |
| `.net-pick-puck` | r=12 (24 unit) hover puck at the snapped pick point — this is the SC 2.5.8 target | `stroke: var(--accent-hover)`, `fill: color-mix(in srgb, var(--accent) 10%, transparent)`, `pointer-events: none` |
| `.net-port-direction` | absolutely-positioned popover row under the net-label draft input | panel surface tokens, same family as `.net-label-input-error` |
| `.net-port-direction-reason` | the `.asc` refusal sentence above the segments | `color: var(--diagnostic-warning-text)` |
| `.net-port-direction-segments` | the four-way segmented control | segmented-control tokens |
| `.net-port-direction-segment` | one segment — **must be `min-height: var(--control-hit)` (28px)** and `min-width` ≥ 28px | `--control-hit`, `var(--text)` / `var(--muted)`; `.active` uses `var(--accent)`; `:disabled` uses `var(--muted)` + `cursor: not-allowed` |
| `.net-port-tag` / `.dir-in` `.dir-out` `.dir-bidir` | the marked-net tag group | — |
| `.net-port-tag-body` | the tag outline (apex into the net for In, away for Out, blunt hexagon for BiDir) | **stroke only**: `stroke: var(--muted)`, `fill: none`. NEVER a trace hue — a port is a statement about the sheet, not a signal reading |
| `.net-port-ordinal` | 1-based terminal number in the tag's blunt end | `font: 500 6px var(--font-mono)`, `fill: var(--muted)` |
| `.subckt-model-label` | the block's own name across the top inside the body | `font: 500 7px var(--font-mono)` (same size as `.subckt-pin-label`), `fill: var(--text)`; `.component.selected` variant like the pin caption |
| `.subckt-pin-label.drifted` | dotted underline on the captions the drift is about | `text-decoration: underline dotted var(--diagnostic-warning-line)` (or an equivalent underline that is not colour-only against the undrifted caption) |
| `.subckt-body-drift` | annotation outline over the body, fill left alone, **no wash** | `stroke: var(--diagnostic-warning-line)`, `fill: none`, hairline |
| `.subckt-body-drift.transient` | the drifted (recoverable) case | add `stroke-dasharray: 4 3`. Without `.transient` (missing / unreadable sheet) it stays **solid** |
| `.subckt-drift-lamp` | lamp group at the body's top-right, `role="button"`, `tabIndex=0` | `cursor: pointer`; needs a visible `:focus-visible` ring using `var(--focus-ring)` |
| `.subckt-drift-lamp-hit` | the 28×28 transparent target (already sized in markup) | `fill: transparent` |
| `.subckt-drift-lamp-dot` | the r=3.5 painted lamp | `fill: var(--diagnostic-warning)`; `.transient` may drop to `var(--diagnostic-warning-line)` stroke + no fill |

`node scripts/design-system-dod-grep.mjs` → `hex-outside-tokens=0 native-select=0 … ok`.

## App.tsx — what must be threaded in

New optional `Canvas` props, all inert when absent (today's `App.tsx` compiles and
behaves exactly as before):

1. `subcircuitDrift?: ReadonlyMap<string, SubcircuitDriftAnnotation>` — per-instance
   view-model, keyed by component id. `SubcircuitDriftAnnotation` is exported from
   `Canvas.tsx`:
   `{ kind: "drifted" | "missing-sheet" | "sheet-unreadable"; sentence: string; pins?: readonly string[] }`.
   `pins` are pin ids (`p1`…`pN`). The canvas **accepts** the verdict and never computes
   it; map PARENT's `projectSheetInterfaceDrift` output onto this shape.
2. `onReviewDrift?: (componentId: string) => void` — the lamp / Enter / Space; open the
   review dialog.
3. `onOpenLinkedSheet?: (componentId: string) => void` — fired by double-click anywhere
   on a linked block's body. **Wire this, or double-click keeps falling through to the
   inline value editor**, which is the current behaviour.
4. `onCommitNetLabelPort?: (x, y, text, direction | null) => { ok: boolean; error?: string }`
   — wire straight to the store's `upsertNetLabelPort`; its `ProjectSubcircuitResult`
   (`useSchematic.ts:421`) is structurally identical to the prop's return type, so
   `onCommitNetLabelPort={upsertNetLabelPort}` is the whole wiring. **Until this is
   passed, the direction segments do not render at all** and the net-label draft is
   byte-for-byte today's behaviour — that is deliberate, so nothing half-works.
5. `sheetInterfaceDisabledReason?: string | null` — pass
   `"An .asc sheet cannot carry a Tau sheet interface - save it as .sim first"` when the
   open document is an `.asc`. Disables Input/Output/Both ways and leaves Internal live
   (an ordinary net label on an `.asc` sheet is still fine).

Still owed by the orchestrator, outside this lane's files:

- The **context-menu item** for "open the linked sheet". Canvas.tsx has no context menu;
  it lives outside this lane. Double-click is wired here; the menu item is not.
- The parts-rail **"Sheet block"** affordance beside the generic Subcircuit (X), as a
  subckt preset and not a new `ComponentKind` (`catalog.ts` / `Palette.tsx`).
- The schematic **empty-state line** "A sheet in this project can be a block here."

## Two places the spec and the code disagreed — resolved, and how

**1. Acceptance check A4 is not self-consistent for world-frame captions.** A4 asks for
`textAnchor === "start"` for a local-left pin at all of 0/90/180/270 × mirrored. But the
caption layer draws its `<text>` OUTSIDE the oriented group (glyphs always upright and
readable — that is today's behaviour and the brief says not to rebuild the caption
layer), so `start`/`end` are screen directions. At 90°/270° a local-left pin lands on a
horizontal body edge, where neither `start` nor `end` is "inward"; `"middle"` is the only
honest answer, and it is what the code returns.

What was implemented is the invariant the bug actually violated, derived from the pin's
LOCAL inward normal mapped through the orientation:

- captions on the same **local** side share one anchor at every orientation;
- the anchor always runs **inward**, toward the body, so no caption escapes through the
  wall;
- `"middle"` occurs only at 90°/270°, and the test asserts that.

The test covers all eight orientations and **fails on `cdecde0`** with the exact symptom
the brief predicted (see gate output below).

**2. "The model name centred in the body."** Centred horizontally, but placed in the
clear strip just inside the **top** edge (`minY + 8`), not at `y = 0`. `halfHeight =
maxPinY + 12` guarantees `minY … minY+8` can never hold a pin caption, whereas dead
centre collides with the `y = 0` terminal that every odd-sized bank has (a 3-port block
puts `OUT` exactly there). Same reading, no overlap, still pure.

## Not landed in this lane

Deliverable 5(c)'s *default* wiring: the direction control renders and commits, but only
when `onCommitNetLabelPort` is supplied, and `App.tsx` (orchestrator-owned) does not
supply it yet. Nothing about the child's authoring gesture is reachable in the app until
item 4 above is wired.

## Gates

```
pnpm -C apps/desktop typecheck
  → only src/components/ShellPanels.tsx TS6133/TS6192 unused-import errors (PARENT's
    in-flight file). Zero errors in any BLOCK-owned file.

pnpm -C apps/desktop exec vitest run src/components/Canvas src/schematic/symbols.test.tsx \
    src/schematic/subcircuitGeometry.test.ts
  → Test Files 8 passed (8) / Tests 450 passed (450)

pnpm -C apps/desktop exec vitest run   (whole suite)
  → Test Files 2 failed | 271 passed | 2 skipped (275)
    Tests 4 failed | 4892 passed | 9 skipped (4905)
    All 4 failures are in CHILD's in-flight files
    (ProjectSheetPortsDialog.test.tsx ×3, App.workspace.test.tsx "mounts the
    child-sheet interface dialog" ×1). None is in a BLOCK-owned file.

node scripts/design-system-dod-grep.mjs
  → DESIGN-SYSTEM-GREP: hex-outside-tokens=0 native-select=0 … ok
```

### Reproduce-before-you-change, recorded literally

The anchor bug, with only the anchor expression reverted to `labelPoint.x`:

```
× anchors every caption by local side at 90deg
× anchors every caption by local side at 270deg
× anchors every caption by local side at 90deg mirrored
× anchors every caption by local side at 270deg mirrored
AssertionError: local left captions disagree: expected [ 'end', 'start' ] to have a length of 1 but got 2
AssertionError: local left captions disagree: expected [ 'start', 'end' ] to have a length of 1 but got 2
Tests  4 failed | 4 passed | 39 skipped (47)
```

The body width, with `halfWidth` pinned back to the constant 28:

```
× grows the body, so the widened block really is a different box
× selects a click 30 units off-centre, which only the widened body covers
× uses that same box for placement collision
AssertionError: expected 28 to be greater than 28
AssertionError: expected 28 to be greater than or equal to 30
AssertionError: collision never noticed the widened body: expected undefined to be defined
Tests  3 failed | 73 skipped (76)
```

---

## VERIFY pass (independent), 2026-08-13

Three defects found and FIXED inside BLOCK-owned files, each with a test that
was recorded failing first:

1. **Eight new canvas marks shipped with no ink at all.** None of the 15 new
   class names has a rule in `App.css`, and SVG's *initial* `fill` is opaque
   BLACK, not "invisible". Recorded failures:
   `["circle.subckt-drift-lamp-dot", "rect.subckt-body-drift.transient",
   "rect.subckt-drift-lamp-hit", "text.subckt-model-label"]` and
   `["circle.net-candidate-mark", "circle.net-pick-puck",
   "path.net-port-tag-body", "text.net-port-ordinal"]`.
   Five of those render **today with no new prop**: the candidate marks and the
   r=12 pick puck (a 24-unit black disc over the net you are aiming at) fire on
   any `tool.mode === "label"`, the port tag fires on any label authored through
   the dialog, and `text.subckt-model-label` fires on EVERY existing linked
   block - unstyled it inherits the app's ~13px UI font as WORLD units while the
   X glyph is now dropped, so an existing document's block loses its glyph and
   gains an oversized black name. FIX: candidate marks reuse `.snap-dot` and the
   puck reuses `.snap-ring` (they *are* snap points, so this is reuse not
   analogy); the rest carry token-valued presentation attributes
   (`var(--muted)`, `var(--canvas-label-muted)`, `var(--diagnostic-warning)`,
   `var(--diagnostic-warning-line)`, `fill="transparent"` on the lamp hit rect
   because `none` is not hit-tested). Presentation attributes are the
   lowest-priority origin, so App.css still wins later without unpicking this.
   Gate: `Canvas - every painted mark declares its own ink` in
   Canvas.shapes.test.tsx, including a self-check that the gate reports a
   knowingly-unstyled mark. **App.css still owes the real rules** - the
   fallbacks are honest, not final.

2. **The direction segments were mouse-only.** The name input commits on
   `onBlur` ("click-away confirms"), so Tab out of it committed the label as
   Internal and unmounted the row: a keyboard user could never mark a net as an
   input or an output (WCAG 2.1.1). Recorded failure: `expected "vi.fn()" to not
   be called at all, but actually been called 1 times`. FIX: blur into the
   direction row no longer commits; the row is a real radiogroup (roving
   tabindex, Arrow keys move selection *and* focus and skip segments the .asc
   reason disabled, Enter/Space commits the draft).

3. **The electrical-freedom claim was only a comment.** Now proven by building
   the deck both ways in `subcircuitGeometry.test.ts`: two instances differing
   ONLY in the `directions` argument (p3/GND left vs right, guarded against
   vacuity) emit a byte-identical `.subckt TauBuck VIN VOUT GND` header and
   `X1 … TauBuck` card, and a bank whose ORDER disagrees still throws.
   Mutating the id assignment from ports order to slot order makes it fail with
   the real refusal `X1 needs an exact ordered p1…pN bank for TauBuck.`

### STILL OPEN, and not BLOCK's files - the student path is BLOCKED here

`App.tsx` passes **none** of the five props to `<Canvas>` (checked at
App.tsx:4107-4120) and **does not pass `sheetInterfaces`** to the inspector
(`ShellPanels.tsx:2086` defaults it to `[]`), nor `usedBy` /
`interfaceDisabledReason` to `ProjectSheetPortsDialog` (App.tsx:4642). Measured
consequences in the running app:

- The child cannot mark a port **on the drawing** at all. Worse, the dialog's
  "Pick a net on the drawing" button closes the dialog and arms the tag tool -
  handing the student to a name box with no direction control. That button is
  currently a trap.
- `sheetInterfaces = []` means every sheet option is unannotated, the proposed
  pin table is empty, and "Link this sheet" commits `ports: []`. Zero-retyping
  (PDF5 reason 1) is a **no-op in the app** even though the component supports it.
- `projectSheetInterfaceDrift(link.ports, null, …)` always returns
  `"not-checked"`, so the lamp can never light - and the canvas has no
  `subcircuitDrift` prop to draw it with anyway.
- No parent->child navigation (double-click still opens the value editor) and no
  child->parent "Used by".
- The `.asc` refusals never appear on either side.

Also cross-lane: `App.workspace.test.tsx` fails because CHILD renamed the dialog
title "Child sheet interface" -> "Sheet interface"; `ShellPanels.test.tsx` fails
x3 on `useSchematic.getState().setSelected is not a function`.
