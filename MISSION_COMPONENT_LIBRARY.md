# Mission: the component library must be comprehensible

**Status:** active, supersedes other missions until every item below is done.
**Opened:** 2026-08-08. **Branch:** `auto/ltspice-parity`.

A student drops a part on the sheet and cannot tell what it does, cannot
configure it, and in several cases the drawing is wrong. That is the whole
problem. Every item below is one part of it.

Work the items in the order given — the order is dependency-driven, not
priority-driven. Commit after each item passes its gates. Do not start an item
before its blockers are green.

---

## Decisions already made (do not relitigate)

- **Ideal-by-default is scoped to parts placed in Tau.** A part dropped from the
  palette defaults to ideal behaviour (diode = fixed forward drop). A part read
  from an LTspice `.asc` keeps its real model, because that file already means
  something specific and the corpus baseline must stay valid. Provenance decides,
  not a global switch.
- **Test Point is deleted, not deprecated.** Probes do the job.
- Colour comes from tokens only. See `DESIGN_SYSTEM.md` and the
  `tau-instrument-aesthetic` skill; `scripts/design-system-drift.sh` enforces it.

---

## Architecture notes (surveyed 2026-08-08 — trust these, do not re-derive)

### `schematic/params.ts` has a destructive trap

`paramFields(kind, value)` returns `SCHEMA[kind] ?? []`. `decodeParams` and
`encodeParams` are **hand-written dispatch ladders** whose fallthrough is
`return {}` and `return ""` respectively.

> Adding a multi-field `SCHEMA` entry **without** adding matching branches to
> both `decodeParams` and `encodeParams` renders every box blank and **erases
> the component's value on the first keystroke.**

Single-field entries are safe (both functions have a generic `fields.length === 1`
path). Nearly every kind in this mission needs multiple fields, so the first
task is a **generic `key=value` codec** driven by the field list, not another
hand-rolled branch. Most of the digital block already shares one grammar
(`Vhigh= Vlow= Vt= Vhys= Td=`, parsed by `engine/digitalGateSpec.ts`), so one
codec covers digitalGate, all four flip-flops, counter, adc, dac and sampleHold.

`ParamField` today is `{key,label,unit}`. `engine/subcircuitCatalog.ts`'s
`SubcircuitParameter` is `{name,defaultValue,label,unit,min,max,minExclusive,description}`
— that is the richer descriptor to grow toward.

A kind with no schema falls back to one raw "Value" textbox
(`ShellPanels.tsx`), which writes `setValue` directly, bypassing the codec.
Any encoding added must tolerate a string typed there, and also one typed into
the canvas inline editor (`Canvas.tsx`, double-click).

### Symbols

`ComponentSymbol({ kind, value })` **already receives `value`** — value-driven
drawing needs no signature change. Only one case reads it today (`vsource`
sine glyph).

`getLocalPins(kind)` is **kind-only** and is called from 11 sites. Making pin
count depend on `value` (needed for configurable gate inputs) means routing
through `getComponentPins(component)`, which already has the component in hand.
`schematic/subcircuitGeometry.ts` is the existing precedent for
parameter-driven geometry — `verticalOffsets(count)` keeps terminals on the
16-grid and `nativeSubcircuitBody` grows the body with the pin count. Reuse it
rather than inventing a second mechanism, but do **not** overload `pinOverride`,
which currently means "imported, absolute world coords".

`SYMBOL_BODY` and `SYMBOL_BOX` are hand-maintained and **drift from the JSX**.
Confirmed drift to fix while redrawing:

| kind | declared | actually drawn |
|---|---|---|
| `digitalGate` | `maxX: 28` | nose reaches **x = 40**; both output leads and the inversion bubble are drawn **inside** the body |
| `srflop` | `maxY: 40` | rect bottom is y = 32 |
| `vcvs`/`vccs`/`cccs`/`ccvs` | `±18 × ±22` | rect is only `±14 × ±20` |

Lead/pin mismatches to fix: `transformer` p2/s2 leads stop ~6.3 units short of
the coil curve; `ctTransformer` the same plus its `ct` tap lead lands at y=0
while the coil junction is at y=4; `potentiometer` wiper arrow tip is 8 units
short of the resistor body; `sevenSeg` has a zero-length degenerate `<line>`.

Grid is 16. Pins must stay on multiples of 16. Preview viewBoxes are ~±42 × ±40,
so anything drawn past that is clipped in the palette and inspector — `sevenSeg`,
`digitalGate`, the flip-flops, `counter`, `adc`, `dac` and `timer555` all clip today.

Symbol JSX is drawn un-rotated; the wrapper `<g>` applies
`rotate(R) scale(-1 1)`. **Any `<text>` in a symbol rotates with the body and
will be upside-down at 180°.** There is no counter-rotation. The `555` label is
the existing offender.

Paint comes from CSS `.symbol { stroke: var(--comp) }`. `fill: none` is global,
so a closed shape you want filled must opt out via `.symbol-arrow`. Note there
are **two** `.symbol` rules in `App.css`; the later one (stroke-width 1.55) wins.

### Opamp / comparator "+" collision — measured

Triangle is `M -24 -26 L -24 26 L 30 0 Z`; the lower hypotenuse is
`y = 26 − (26/54)(x + 24)`. The "+" vertical bar runs `(-16,12) → (-16,20)`,
and the edge at x = −16 is y = **22.148** — a nominal 2.148 units of clearance.
Effective stroke 1.55 (half 0.775, projecting 0.860 vertically across the 25.7°
slant) plus a round line cap (another 0.775) consumes all of it, so the glyph
**already touches the edge at rest**; when selected (stroke 2.35) it overlaps by
0.33 units and the drop-shadow halo bleeds across. `vector-effect: non-scaling-stroke`
makes it worse as you zoom out, because clearance shrinks with zoom while stroke
does not.

The "−" is safe (4.222 units). The asymmetry is the root cause: both glyphs sit
on the same |y| = 16 pin rows, but "+" is 8 units tall and "−" is flat.

### Simulator mode is strictly view-only

`App.tsx` renders the simulator canvas with `interactive={false}` and cancels
any tool outside `["select","probe","ammeter","label"]`. Critically:

```ts
useEffect(() => { invalidateAnalysis(); }, [components, wires, directives, ...]);
```

**Any component mutation nulls every analysis result.** So making a switch
clickable during simulation is not just a click handler — actuating a contact
changes the circuit, so it must invalidate and re-run. Design that path
deliberately; a switch that clears the plot when you press it is worse than one
that does nothing. Net-label renaming already has a precedent carve-out for
simulator mode.

No component is interactive today, in either mode. Switch state lives in
`component.value` (`schematic/kindGroups.ts` — `isStaticContactClosed`), and has
**zero UI consumers**; the only way to change it is the Properties text field,
which is schematic-mode only.

### Per-component simulation state on the canvas

`ComponentView` receives only `{comp, selected, showPins}` — no currents. The
one overlay that draws simulation state is `OpCurrentFlowLayer`, and it draws on
**wires**, not components. The data it needs already exists in `Canvas.tsx`:
`tranComponentCurrents(tran, sample)` / `opComponentCurrents(op, biasCircuit)`,
plus a real time cursor (`readoutTime` prop, driven by scope cursors or the live
scrub). LED glow should reuse that path, not build a second one.

A numeric per-part annotation on the schematic **used to exist and was
deliberately removed** for covering the drawing; `Canvas.currentMode.test.tsx`
asserts `.op-annotation` is absent. Do not bring it back.

### Ideal vs real today

There is **no** ideal-diode UI path and no fixed-drop ideal diode in the ngspice
deck. What exists to build on:

- `engine/userModelLibrary.ts` — `translateIdealDiodeDeckLines()` already
  rewrites an LTspice `.model X D(Ron= Vfwd= …)` into ngspice `.model X sidiode(…)`,
  gated by `BuildSpiceDeckOptions.idealDiodeAsSidiode` (default true). **This is
  the mechanism to expose**, currently reachable only by hand-authoring a directive.
- `library/opamps.ts` — `OPAMP_LIBRARY[0]` is a genuine `Ideal` part with
  `gbwHz: Infinity`; the op-amp dropdown is the UI precedent to copy.
- Defaults emitted today: `.model TAU_DIODE D(Is=1e-14 N=1)`,
  `.model TAU_LED D(Is=1e-16 N=2 Rs=10)`, `.model TAU_ZENER D(Is=1e-14 N=1 Bv=5.1 Ibv=1m)`.
  All DC-only, no charge storage. Zener `Bv` is fixed at 5.1 regardless of the
  name typed.

### Netlist facts worth knowing

- `potentiometer` emits two resistors at a **hardcoded 50 % split**
  (`spiceNetlist.ts`); there is no wiper field anywhere in types, ASC I/O, or
  the store. A wiper is a new encoded key **and** a netlist change.
- `polarizedCapacitor` shares the `capacitor` case verbatim — polarity means
  nothing to the solver today.
- `bulb` shares the `resistor` case verbatim — a filament that never heats.
- `cccs`/`ccvs` synthesize their own `V_<base>_sense` zero-volt source, so the
  user **cannot** point one at an existing `V1`; they must physically insert the
  C+/C− pair in series. Decide whether to keep that or add a named reference.
- `digitalGate` input count is **already 1..5**, determined by which of the five
  input pins are wired. The symbol always draws all five. So item 9 is mostly a
  drawing + properties problem, not a netlist one.
- `sevenSeg` emits plain `1G` resistors — no decoder, no LEDs.
- `timer555` is the only IC with a real `.subckt` (`engine/bundled/tau_555.sub`).
  Flip-flops and counter are XSPICE `d_dff`/`d_tff`/`d_jkff`; adc, dac and
  sampleHold are behavioural B-sources.

---

## The items

### 0. Delete Test Point — DONE 2026-08-08
Remove the `testpoint` kind and its ~32 references across types, catalog,
params, pins, symbols, paletteItems, netlist, spiceNetlist, terminalRoles, the
four solvers, measurementModel, ascExport and assistantContext. A saved document
containing one must still open — migrate it, do not fail.

**Done when:** the kind is gone, `catalogContract.test.tsx` passes, and a
document containing a test point opens with a named notice.

Landed across 26 files. Three consequences worth knowing before item 3:

- `testpoint` was the only `Markers` catalog entry, so that palette section is
  gone from `PALETTE_SECTIONS` too. The catalog runs Sources → Passives →
  Semiconductors → Analog → Digital → Electromechanical.
- **There are two load paths, and deleting a kind breaks both differently.**
  `schematic/retiredKinds.ts` is the single registry; retiring any future kind
  means adding a row there, not just deleting the enum member.
  - `.asc`: checked in the symbol loop *before* `TauKind` resolution. Without
    it the saved carrier (`SYMBOL res` + `Value 1T` + `SYMATTR TauKind
    testpoint`) resolves to its carrier and the marker becomes a real 1 TΩ
    resistor - a silent wrong answer.
  - `.sim`: `documentValidation.ts` rejects any kind not in `CATALOG_BY_KIND`,
    so without the carve-out the *entire document* refuses to open. Retired
    kinds now drop and report; every other unknown kind still hard-fails, so
    the guard is not widened.
- Both drops are reported: the `.asc` notice reaches the Diagnostics panel via
  `importWarningsByPath`, the `.sim` notice rides `openDocument`'s `notice`
  toast. Each has a regression test that was checked against its own reversion.

### 1. Generic parameter codec — BLOCKS items 2, 4, 5, 6, 9
Replace the hand-rolled `decodeParams`/`encodeParams` ladders with a declarative
codec driven by the field list, so adding a field set is safe by construction.
Keep every existing round-trip working (MOSFET, charge capacitor, vac/iac,
vpulse, comparator, motor are the existing shapes; `params.test.ts` covers only
some of them — widen it first, then refactor under a green suite).

`ParamField` grows: `{ key, label, unit, kind?: "number"|"text"|"choice"|"toggle",
choices?, min?, max?, advanced?: boolean, description? }`.

**Done when:** every existing kind round-trips unchanged, a new multi-field kind
needs no ladder edit, and a fuzz test proves encode∘decode is identity over the
catalog defaults.

### 2. Potentiometer wiper + polarized capacitor meaning
Wiper position 0..1 (default 0.5) that splits total R into two legs; the netlist
stops hardcoding half. Polarized capacitor gets a meaning: at minimum a
reverse-bias check that reports when the simulation drove it backwards, and
properties that say what the polarity marking is for.

**Done when:** a wiper sweep changes the divider output, and a reverse-biased
polarized cap produces a named warning.

### 3. Redraw: bulb, potentiometer, opamp, comparator, transformer, ctTransformer
Fix the "+"/"−" collision on every amplifier-derived symbol. Close the
transformer lead gaps and land the CT tap on the coil junction. Make the
potentiometer read as adjustable. Fix `SYMBOL_BODY`/`SYMBOL_BOX` drift for each.

**Done when:** every lead terminates at its pin, no glyph is within a stroke
width of a body edge at selection weight, and both themes look right at the
1440×900 floor.

### 4. Controlled sources: drawings + settings
VCVS/VCCS/CCCS/CCVS get distinguishable symbols and properties that name the
gain with its real unit (V/V, A/V, A/A, V/A) and explain the control port.
Decide and document whether a named control reference is added.

**Done when:** each of the four is identifiable from its symbol alone, and its
Properties panel explains what it computes.

### 5. Digital parts: pinouts and settings
SR/D/T/JK, counter, 555, ADC, DAC, 7-segment, sample & hold. Labelled pins on
the drawing (555 must show TRIG/OUT/RESET/CTRL/THRES/DISCH/VCC/GND), and real
properties for the shared logic grammar. Nothing may clip in the palette preview.

**Done when:** every digital part's function and pinout is readable from the
symbol plus its Properties panel, with no reference to the datasheet.

### 6. Clickable contacts during simulation
Switch, push button, SPDT and relay actuate on click in simulator mode with
visible motion; the potentiometer wiper is draggable. Buttons gain configurable
behaviour (momentary vs latching, NO vs NC). Resolve the re-run question above.

**Done when:** clicking a switch mid-simulation changes the result without the
user touching Run, and the drawing shows the contact moving.

### 7. LEDs glow with current
Brightness from the current through the part, tracking the existing time cursor.
No glow without a result. Document the mapping.

**Done when:** an LED in a working circuit visibly brightens with drive current
and stays dark when reverse-biased.

### 8. Ideal by default, real behind Advanced
Per the scoping decision above. Every placeable part defaults to textbook
behaviour; losses and second-order effects live under an Advanced disclosure.
Both paths must simulate correctly and be tested.

**Done when:** a freshly placed diode drops its ideal forward voltage, an
imported `.asc` diode is unchanged, and the corpus gate has not moved.

### 9. Configurable gate input count
AND/OR/NAND/NOR/XOR/XNOR get an input-count control (minimum 2). The symbol
redraws with that many inputs; the netlist emits the matching gate. The five
always-drawn input leads go away.

**Done when:** setting a gate to 3 inputs shows 3 leads and simulates as a
3-input gate, and the palette icons for the seven gate types are distinguishable.

---

## Gates for every item

```
pnpm -C apps/desktop typecheck
pnpm -C apps/desktop test
bash scripts/design-system-drift.sh
cd apps/desktop/src-tauri && cargo test --lib
```

Plus, for anything that touches a symbol or a panel: look at it in both themes
at 1440×900 before calling it done. A design change that was never looked at is
not done.

Every behavioural fix needs a test that **fails when the fix is reverted**.
Check that; do not assume it.
