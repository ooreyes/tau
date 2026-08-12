# Tau UI/UX Remediation — PDF report 3 (14 items)

Source: `screenshots/pdf3-report/source-report.pdf`
(original: `~/Downloads/Untitled document (1).pdf`, 6 pages).
Extracted screenshots from that PDF live beside it as `img-<page>-<n>.png`;
`-x5.png` variants are nearest-neighbour upscales for reading small symbols.

Branch: `fix/pdf3-fourteen-items`, based on `fix/ui-ux-followup` @ `f5ee776`.
This is a **separate branch**; `auto/ltspice-parity` is untouched.

The report numbers its items 1–14 but skips 9 and uses "4" twice. This tracker
uses stable IDs `P3-01 … P3-14` mapped below, so nothing is lost to the
renumbering.

---

## Non-negotiables (inherited from AGENTS.md / UI_UX_FIXES.md)

Every change must preserve:

- unmodified `.asc` import round-trip, and exact user/attached model resolution;
- fail-closed named-device behaviour — never silently substitute a model;
- derived netlists (schematic is the source of truth, netlists are emitted);
- undo/redo through the Zustand document store;
- the design-token system (`src/styles/tokens.css`); no raw hex in new CSS
  unless it is a token definition;
- the proprietary licence — do **not** add an OSS licence file, and do not
  vendor third-party art without a `THIRD_PARTY_NOTICES` entry.

Gates that must pass before an item may be called done:

```bash
pnpm -C apps/desktop typecheck
pnpm -C apps/desktop test
node scripts/design-system-dod.mjs      # design-token / palette gate
node scripts/validate-palette.mjs
```

---

## File-ownership map (conflict avoidance)

Multiple items land in the same very large files (`App.tsx` 191 KB,
`App.css` 10 474 lines, `ShellPanels.tsx` 96 KB). Parallel workers therefore get
**disjoint** ownership. A worker that needs an edit in a file it does not own
writes the request into `docs/handoff/<lane>.md` instead of editing it.

New per-concern stylesheets were pre-created and pre-imported from `App.tsx`
immediately after `import "./App.css"`, so **no worker needs to touch App.css**:

| Stylesheet | Lane |
| --- | --- |
| `src/styles/explorerTree.css` | EXPLORER |
| `src/styles/sourceSymbols.css` | SYMBOLS |
| `src/styles/editorToolbarIcons.css` | TOOLBAR |
| `src/styles/diagnosticsDock.css` | DOCK |

| Lane | Items | Owns |
| --- | --- | --- |
| EXPLORER | P3-02, P3-04A, P3-06 | `components/ShellPanels.tsx`, `components/ShellPanels.test.tsx`, `components/ExplorerPanel.test.tsx`, `store/useProject.ts`, `store/useProject.test.ts`, `styles/explorerTree.css` |
| SYMBOLS | P3-01, P3-03, P3-08 | `schematic/catalog.ts`, `componentNames.ts`, `params.ts`, `sourceValue.ts`, `kindGroups.ts`, `paletteItems.ts`, `symbols.tsx`, `symbols.test.tsx`, `sourceGeometry.test.tsx`, `components/IndependentSourceEditor.tsx`(+test), `components/Palette.tsx`, `store/useSchematic.ts`(+test), `styles/sourceSymbols.css` |
| CANVAS | P3-07, P3-10, P3-11 | `components/Canvas.tsx`, `Canvas.geometry.ts`, `Canvas.labels.test.ts`, `Canvas.geometry.test.ts`, `Canvas.geometry.placement.test.ts`, `Canvas.shapes.test.tsx`, `components/ScopeZoomCluster.tsx`, `schematic/shortcuts.ts`(+test) |
| TOOLBAR | P3-12, P3-13, P3-04B | `components/editor/EditorChrome.tsx`, `components/editor/*` (new icon module), `components/EmptyState.tsx`(+test), `styles/editorToolbarIcons.css`, `THIRD_PARTY_NOTICES` |
| DOCK | P3-14, P3-05 | `App.tsx`, `styles/diagnosticsDock.css`, `schematic/documentValidation.ts`(+test), `components/ComponentMeasurementsPanel.tsx`(+test), `App.workspace.test.tsx`, `components/drawer/ResultsDrawer.tsx`(+test), `components/drawer/DiagnosticsTab.tsx` |

The orchestrator alone owns `lib/devBridge.ts` (the dev-only automation bridge
the capture harness drives) and `scripts/`.

`App.tsx` is owned solely by DOCK. Lanes that need an `App.tsx` wiring change
(a new prop, a renamed import) file it in `docs/handoff/<lane>.md`; the
orchestrator applies it between batches.

---

## The items

### P3-01 — a voltage source's waveform must change its identity, not hide inside "DC source"

**Report (item 1).** Evidence: `img-001-000.png`. The inspector titles the part
**"DC source"** while its Waveform selector says **Sine**, and the panel then
shows *both* `DC operating point 5 V` *and* `Offset 5 V` — two names for the
same number. The canvas caption already reads `Sine · 1 V @ 1k Hz` and the
symbol is already the sine circle, so the drawing and the identity disagree.

Verbatim: *"the two should conflate… We should not have DC options and AC
options intertwined only if it makes complete sense… selection of it should
completely swap the component to be the corresponding one… replace the drawing
which it already does and also replace any sign of its former self."*

**Decision (the user is away; this is the judgement call taken).** Keep one
palette entry, **"Voltage source"**, because a beginner should not have to know
the waveform before placing the part. Make the *Waveform* control an identity
switch: choosing a waveform converts `component.kind` to the matching kind that
already exists in `componentNames.ts` (`vsource`, `vac`, `vpulse`, and the `exp`
/ `pwl` / `sffm` equivalents), so that after the change:

1. the inspector title reads the new name (e.g. **"Sine voltage source"**), not
   "DC source";
2. the field set is exactly the new waveform's fields — no `DC operating point`
   row beside `Offset`; a sine shows `Offset`, a DC source shows `DC level`;
3. the symbol and the canvas caption follow (they already do — keep it true);
4. nothing of the previous waveform survives in `component.value`, the
   inspector, or the emitted netlist;
5. the reference designator stays `V<n>` and the netlist still emits a single
   `V` card — this is a UI/identity change, **not** a netlist change;
6. undo restores the previous kind *and* value as one step.

The same applies to current sources (`isource` family). `Small-signal AC (.ac)`
stays available on every waveform: it is an orthogonal analysis stimulus, not a
waveform, and LTspice allows `SINE(...) AC 1`.

**Done when:** a test converts DC→Sine→Pulse→DC and asserts kind, display name,
field set, `value`, caption, and netlist card at each step, plus an undo/redo
round trip; and no state exists in which the title says "DC source" while the
waveform is not DC.

---

### P3-02 — a file cannot be dragged into a folder

**Report (item 2).** Evidence: `img-002-001.png`. *"I am unable to drag
untitled.asc into the project storage folder."*

**Root cause already located.** `ShellPanels.tsx` implements the whole HTML5
drag protocol — `onDragStart`, `onDragOver`, `onDrop`, a `dataTransfer` payload
type `application/x-tau-project-node`, drop-target highlighting — but **no row
ever sets the `draggable` attribute** (`grep -n draggable
apps/desktop/src/components/ShellPanels.tsx` returns nothing). Without
`draggable`, `dragstart` never fires on a `<button>`, so the entire native path
is dead code. A pointer-event fallback (`beginPointerDrag` →
`pointerDestination` → `finishPointerDrag`) exists; verify whether it actually
reaches a destination in WKWebView, because it is the only path currently alive.

**Done when:** dragging a file row onto a folder row moves it on disk and in the
tree, at both depths, with drop-target highlight; dragging onto the project root
row moves it to the root; an invalid drop (onto itself, into its own parent,
into its own subtree) is refused; open tabs follow the moved path. Prove it with
a test that dispatches real `dragstart`/`dragover`/`drop` events, **and** with a
Playwright drag against the running app (`page.dragAndDrop`), because a
synthetic React test cannot prove `draggable` is set.

---

### P3-03 — the LED must not be coloured in the parts list

**Report (item 3).** Evidence: `img-002-002.png` — the palette's LED glyph is
drawn in red while every neighbour is monochrome. *"The LED should not have a
color."*

`symbols.tsx:1092` wraps LED artwork in `led-artwork led-color-<c>` from
`ledColorFromValue`. That tint is right on the canvas (an LED's colour is a real
parameter) and wrong in the palette, which is an index of part *types*.

**Done when:** every palette glyph, including LED, renders in the palette's
monochrome stroke colour; the canvas LED keeps its colour-derived tint and its
Vf coupling; a test asserts the palette LED's computed stroke equals the palette
stroke token and that the canvas LED's does not.

---

### P3-04A — the panel overflow "⋯" must survive a narrow window

**Report (item 4, first).** Evidence: `img-002-003.png`. *"There is ample space
to show the settings. I like the current three dot approach but we should be
able to see them at a smaller window size as long as it has decent space from
the text of the folder name it should be able to dynamically adjust."*

**Cause corrected by recon — the first reading of this item was wrong.** There
is no overflow and the `⋯` is never clipped. The five primary icons and the `⋯`
are never on screen together: `App.css:5192-5199` makes the panel its own query
container, `App.css:5288` sets `.explorer-overflow-trigger { display: none }`
unconditionally, and `App.css:5320-5332` flips it to `display: grid` while
hiding `.explorer-primary-actions` only inside
`@container explorer-shell (max-width: 280px)`. So the header is a **binary swap
keyed at 280 px**: wide gives five icons and no `⋯`, narrow gives `⋯` and no
icons. The reported screenshot is the narrow half.

Read against that, the ask is the one the user actually wrote — keep the `⋯`
(they like it), keep the actions reachable as the window shrinks, and let the
header *adjust* instead of flipping.

**Done when:** the header degrades progressively — as width falls, primary icons
drop out widest-first and the `⋯` **always** remains, holding everything that
dropped; at every width the `⋯` is inside the header's client box with a measured
gap of ≥ 8 px to the root-name text; and no width exists where an action is
unreachable from both the icon row and the menu. Measured at explorer widths
168 px (`EXPLORER_PANEL_WIDTH.minWidth`), 226 px (the default) and 420 px, at
900×600 and 1440×900.

An unknown or zero measured width must **fail open** and render all five icons:
jsdom evaluates no CSS, and 27 existing header-button queries across
`ExplorerPanel.test.tsx`, `App.import.test.tsx` and `EmptyState.test.tsx` — two
of those files in other lanes — would break if a zero width hid the icons.

---

### P3-04B — the empty-editor copy must point at the parts rail

**Report (item 4, second).** Evidence: `img-003-004.png`. Today
`EmptyState.tsx:67` says *"Create or open a schematic"* — but the reader is
already **in** an empty schematic, so the instruction is a no-op.

Verbatim: *"the wording should be more of a place a component down. I imagine it
highlighting or emphasizing the component library — it should almost guide the
user to use the components we have, or you can ask Bode to create one."*

**Decision.** When a schematic is open and empty, the card becomes a *place your
first part* prompt: a headline about placing a component, a line naming the
parts rail on the right, a primary action that opens/flashes the parts rail
(reuse the existing rail-open action; a brief highlight pulse on the rail, one
cycle, `prefers-reduced-motion` respected), and **Ask Bode** kept as the
secondary. The "no project open" copy is unchanged.

**Done when:** with a project open and an empty schematic, the card's headline
and body name placing a part and the parts rail; the primary action reveals and
highlights the rail; a test asserts both strings and the action; the
no-project-open variant still reads "Open a project folder".

---

### P3-05 — "Don't save" on an empty untitled schematic should not leave a file behind

**Report (item 5).** Evidence: `img-003-005.png`. *"If i click dont save and
theyre empty then they should probably be deleted."* The explorer accumulates
`untitled-2.asc … untitled-4.asc`, all empty.

**Decision, stated because the safe reading matters.** Delete only when *all* of
these hold: the file was created by Tau in this session as an untitled
schematic (its name matches the `untitled*.asc` mint pattern **and** the store
recorded it as Tau-minted), the user chose *Don't save*, and the document is
empty — no components, no wires, no net labels, no probes, no directives, and
the on-disk text is byte-equal to the empty template Tau wrote. Anything else
(a renamed file, an imported file, any content ever committed to disk, a file
Tau did not create) is **kept**. On failure to delete, keep the file and surface
the reason; never fail silently.

**Done when:** closing an untouched untitled tab with *Don't save* removes the
file from disk and the tree; closing one that has ever held a component keeps
it; an imported `.asc` is never deleted; tests cover all three; a delete failure
surfaces a notice.

---

### P3-06 — files must look nested inside their folder

**Report (item 6).** Evidence: `img-003-005.png`. *"Id like for the files to
look indented almost to denote they live within a folder."*

Two mechanisms, both confirmed by measurement:

1. **Depth basis.** `ProjectTree` indents with `paddingLeft: 8 + depth * 12` and
   renders the project root's own children at `depth = 0`, while the root row
   itself carries no inline padding at all (it inherits the `<button>` UA
   default, ~6 px). Measured on the pre-fix tree: root row content at 62 px, its
   child folder at **+2 px**, the file inside that folder at +12 px. A 2 px step
   satisfies "greater than" and satisfies nobody looking at it.
2. **Missing caret column.** File rows render no caret spacer, so a file's icon
   does not line up with a sibling folder's icon — the thing that makes the
   screenshot read as "flat list" rather than "tree".

**Done when:** each level is indented **≥ 10 px** more than its parent (roughly
the caret width — a step a reader can see, not merely a positive number), the
root row's own padding is explicit rather than inherited from a UA default, file
rows carry the caret-column spacer so icons align with sibling folders, a
vertical guide marks the parent–child relationship, and the guide's x derives
from the same depth value the padding does so the two cannot drift. Measured at
every depth.

---

### P3-07 — labels must never overlap

**Report (item 7).** Evidence: `img-004-006.png`, upscaled `-x5`. `C1 / 1µ` and
`R1 / 1k Ω` collide into `1µ F1k Ω`. Verbatim: *"Absolutely no overlap between
labels EVER."*

**Done when:** a property-style invariant over many randomised layouts (dense
grids, parts at every rotation, parts one grid pitch apart, long values, all
kinds) asserts **zero** pairwise intersection between any two rendered label
boxes, and none between a label box and any other part's artwork. The existing
label-slot search must fall back deterministically — shrink, re-anchor, or, as
the last resort, hide with an ellipsis affordance — rather than emitting an
overlapping placement. The test must fail on today's code (record the failure
text) so it is known to have teeth.

---

### P3-08 — this part must land pin-up

**Report (item 8).** Evidence: `img-004-007.png` / `-x5`. The part is the
**ground** symbol, drawn rotated so its pin points sideways: three vertical bars
of increasing height plus a stem, which is `symbols.tsx`'s ground
(`0,0→0,10` stem; bars at `y = 10, 15, 20`) turned 90°. *"THis component should
always be facing upwards the point facing up when dropped into schematic."*

`useSchematic.ts:1153` already forces `rotation: kind === "ground" ? 0 :
s.placeRotation`, so the reported state must come from another path — a mirrored
placement, a drag-and-drop placement that bypasses `addComponent`, the palette
preview, or a sticky `placeRotation` applied elsewhere. **Find the live path
before changing anything**, then make ground pin-up on *every* placement path.

**Done when:** every placement path (palette click, palette drag-drop, keyboard
hotkey, command palette, assistant-authored circuit) yields `rotation === 0` and
`mirrored === false` for ground, proven per path in a test; an explicit user
rotation after placement is still honoured and still round-trips through
`.asc`; imported `.asc` grounds keep their authored orientation (import
fidelity outranks this preference — say so in the test name).

---

### P3-10 — the auto-centre button must actually re-centre, and follow a resize

**Report (item 10).** Evidence: `img-005-008.png` — the circuit sits left of
centre with the parts rail open. *"The autocentering button does not work. It
needs to work dynamically as the user resizes each tab."*

`Canvas.tsx` has a fit path (`fitView`, ~line 1388) that already reasons about
covered edges and the parts rail; the reported failure is that the button is a
no-op in this state and that fit does not track a resize.

**Done when:** clicking fit frames all artwork centred in the *visible* canvas
box (excluding the parts rail, the bottom dock, and any overlay), to a measured
tolerance of ≤ 1 px on both axes; it works from any prior pan/zoom; resizing the
window or a panel re-fits while the camera is still the one fit chose, and does
**not** stomp a user pan; a test asserts the centring numbers at 900×600,
1280×800 and 1440×900 with the rail open and closed.

---

### P3-11 — a net label must be deletable with Backspace

**Report (item 11).** Evidence: `img-005-009.png` — a selected net label
`endn`. *"Naming a node i should be able to select the text box and hit
backspace to delete it."*

`shortcuts.ts:134` maps `Backspace` to `delete`, and the store has
`selectedLabelIds` + `deleteSelected`, so the miss is upstream: either the label
is not click-selectable, or the naming input still owns focus, or the keydown is
gated to components. **Reproduce first**, then fix the actual break.

**Done when:** clicking a placed net label selects it (visibly), Backspace and
Delete both remove it, undo restores it, and the same holds while the label is
the only selection and while it is part of a multi-select; typing inside the
rename input is never intercepted (Backspace there edits text). Tests cover
both key names and the focus split.

---

### P3-12 — the probe tool needs a real probe icon

**Report (item 12).** Evidence: `img-005-010.png` (today's crosshair) and
`img-006-011.png` / `img-006-012.png` (the reference: a red multimeter probe,
red body, chromed tip, black lead). *"Replace the probe sign with a red
multimeter probe something like the following."*

**Done when:** the probe tool button, the canvas probe cursor affordance, and
any probe marker read as a red multimeter probe at 16 px; the red comes from a
design token (add one if none fits) and holds contrast in light and dark; the
icon is legible at 16 px, not a shrunken illustration; a test asserts the button
renders the probe icon and its token-derived colour.

---

### P3-13 — the editor tool strip should look like its real-world counterparts

**Report (item 13).** Evidence: `img-006-013.png` / `-x5` — today's strip is
nine identical grey glyphs. Verbatim: *"Id like to add more color and make this
toolbar pop a bit more… using the design guidelines we have id like icons with
color schemes like the design reference images. For example a pink/grey metal
erase, a gray trascan, different color do and undo buttons. A tag that looks
like a real tag. A red wire. The goal is to just have these items look like
their real counterparts while maining the strict style guides. You should source
icons from internet and try to avoid creating only if thats the last resort."*

**Decision on sourcing, taken deliberately.** Tau is proprietary and keeps a
rigorous `THIRD_PARTY_NOTICES`. Icons are therefore taken in this order:
(1) **Lucide**, already a dependency and already attributed, wherever its
geometry reads as the object; (2) another **permissively licensed** set
(MIT / Apache-2.0 / CC0 — e.g. Tabler, Material Symbols) if it has a materially
better glyph, **with a new `THIRD_PARTY_NOTICES` section naming the project,
copyright, licence, and which files came from it**; (3) hand-authored SVG only
where neither has the object. No unlicensed or unattributed art, ever, and no
copying of the photographic references in the PDF.

Per-tool colour, all via tokens, no raw hex outside a token definition:
red wire; kraft/manila tag; pink-and-grey eraser; grey trash can; undo and redo
distinguishable from each other and from the destructive pair; select stays
neutral. Read `.claude/skills`' `tau-instrument-aesthetic` guidance and
`DESIGN_SYSTEM.md` first — colour must arrive as restrained material accents on
a precision instrument, not as a rainbow.

**Done when:** each tool's icon carries its own token-derived accent in light and
dark; the strip passes `scripts/design-system-dod.mjs` and
`scripts/validate-palette.mjs`; disabled and active states remain legible and
distinguishable (a disabled coloured icon must read as disabled); contrast
against both surfaces is measured, not assumed; any third-party glyph is
attributed in `THIRD_PARTY_NOTICES`.

---

### P3-14 — the schematic's bottom dock should be Errors only, and catch problems before Run

**Report (item 14).** Evidence: `img-006-014.png`. *"In the schematic bottom tab
I believe just having an errors section to show what is wrong with the schematic
is more than nough — measurements are displayed in simulator tab. This errors
section should be robust and try to catch errors before the user has hit run
simulation."*

**Done when:** in **schematic** mode the bottom dock shows only **Errors** (no
Measurements tab, no tab strip if there is one item); the simulator's own
measurements are untouched; the Errors list is populated live from
`documentValidation.ts` as the user edits, with no run required, and covers at
minimum: floating/unconnected pins, no ground reference, no source, shorted
source, duplicate reference designators, unparseable or out-of-range parameter
values, a net label naming nothing, an unresolved named device / missing model
(fail-closed, and it must say so), and directive errors; each row states the
problem, the offending part, and selects/centres it when clicked; the dock's
badge count equals the row count. Tests cover each error class and the live
(no-run) path.

---

## Status

| ID | Item | Status | Landing commit | Evidence |
| --- | --- | --- | --- | --- |
| P3-01 | Waveform changes source identity | UNVERIFIED | — | — |
| P3-02 | Drag file into folder | UNVERIFIED | — | — |
| P3-03 | LED uncoloured in palette | UNVERIFIED | — | — |
| P3-04A | Overflow `⋯` at small widths | UNVERIFIED | — | — |
| P3-04B | Empty-editor copy → place a part | UNVERIFIED | — | — |
| P3-05 | Don't-save deletes empty untitled | UNVERIFIED | — | — |
| P3-06 | Tree indentation shows nesting | UNVERIFIED | — | — |
| P3-07 | Zero label overlap | UNVERIFIED | — | — |
| P3-08 | Ground lands pin-up | UNVERIFIED | — | — |
| P3-10 | Auto-centre works and tracks resize | UNVERIFIED | — | — |
| P3-11 | Backspace deletes a net label | UNVERIFIED | — | — |
| P3-12 | Red multimeter probe icon | UNVERIFIED | — | — |
| P3-13 | Coloured, object-like tool strip | UNVERIFIED | — | — |
| P3-14 | Errors-only dock, live validation | UNVERIFIED | — | — |

Allowed statuses: `UNVERIFIED`, `CONFIRMED`, `IN PROGRESS`, `FIXED`,
`ALREADY SATISFIED`, `BLOCKED`. Only the orchestrator edits this table. `FIXED`
requires the landing commit, the test names with literal results, and a
before/after screenshot pair at matching state.
