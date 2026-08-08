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

### `schematic/params.ts` - the destructive trap is gone (item 1, 2026-08-08)

It used to be that `decodeParams`/`encodeParams` were hand-written dispatch
ladders falling through to `{}` and `""`, so adding a multi-field `SCHEMA` entry
without editing both ladders blanked every box and erased the component's value
on the first keystroke. **That is fixed.** Both directions are now driven by one
declarative table, and giving a kind a field set is a data edit.

A `SCHEMA` entry is `{ fields, codec?, when? }`, or an array of those when a kind
has variant grammars (the charge-defined capacitor is the one such kind). The
codec defaults to `single` for a lone field and `keyed` otherwise, so the common
case needs no `codec` at all. The four grammars:

- `keyed` - `MODEL Key=value …`, the default and the one a new kind should want.
  A `bare: true` field claims the first token that is not itself a `Key=value`,
  wherever in the string it sits - it does not have to lead, because a value can
  be hand-typed on the canvas or in a `.asc` and the panel must read it the same
  way the netlist does. Tokens no field claims are preserved under
  `EXTRA_PARAM_KEY` and re-emitted, so editing one box never deletes syntax the
  panel does not model.
- `positional` - ordered bare tokens; only for value strings already on disk and
  in `.asc` files (AC sources, vpulse, motor). `omittable` marks a leading field
  that may be absent, which is how a two-token AC source means "amplitude
  frequency" with no offset.
- `single` - the whole trimmed value under one key.
- `custom` - an escape hatch for a grammar with its own parser (the charge
  capacitor, and the comparator, which decodes through the solver's own
  `parseComparator` so the panel shows the levels it will really switch between).

Per-field options: `token` (the `Name=` spelling, defaults to `key`), `fallback`
(substituted when the stored value omits the field), `blank` (written when the
user clears the box, if that differs from `fallback`), `omitWhenFallback` (keyed
only: drop the token while it still holds its default, which is how a centred
potentiometer stays the bare `10k` already on disk), plus `kind`, `choices`,
`min`, `max`, `advanced` and `description` for the editor. The `description`
renders as a `.property-hint` under the field.

`tline` was added as a data-only entry (`Td=` / `Z0=`, matching
`engine/tlineSpec.ts`'s own defaults) to prove the claim: named Delay and
Impedance controls, no dispatch edit. Most of the digital block already shares
one grammar (`Vhigh= Vlow= Vt= Vhys= Td=`, parsed by `engine/digitalGateSpec.ts`),
so `keyed` covers digitalGate, all four flip-flops, counter, adc, dac and
sampleHold when item 5 gets there.

`params.test.ts` has a catalog-driven test that, for **every** kind with a field
set, asserts the default re-encodes to itself and that editing each field keeps
all the others. A kind added later is covered by it the day it gets a schema.

Two things to know before adding fields:

- `ComponentInspector` has **two** field-render loops. The generic one renders
  `description`; the model-chooser branch (nmos/pmos, `ShellPanels.tsx` ~1773)
  has its own loop that does not. No MOSFET field carries a description today,
  so nothing is dropped - but a description added there would not appear until
  that loop renders it too.
- `engine/subcircuitCatalog.ts`'s `SubcircuitParameter` carries a
  `minExclusive` that `ParamField` still lacks; add it there if a kind needs it.

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

- `potentiometer` emits two resistors split at the wiper (item 2 half A). The
  fraction rides in the value string as `Wiper=`, parsed by
  `engine/potentiometerSpec.ts`; ASC I/O needs nothing, because the pot is a Tau
  carrier kind whose whole value round-trips through `SYMATTR TauValue`.
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

### 1. Generic parameter codec — DONE 2026-08-08 — unblocks items 2, 4, 5, 6, 9
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

Landed. The grammar table and its options are documented in the architecture
notes above. How each clause was proved:

- **Existing kinds unchanged.** `params.test.ts` went 12 -> 95 tests, written to
  characterise every existing shape *before* the refactor. 87 of them pass
  against both the old ladders and the new codec; that is the evidence the
  refactor preserved behaviour rather than redefining it. The 5 that fail on the
  old code are the new capability (`tline`, and unmodelled tokens surviving an
  edit).
- **No ladder edit.** `tline` is a data-only entry and reaches the panel with
  named Delay and Impedance controls. Reverting only `params.ts` fails its tests;
  reverting only `ShellPanels.tsx` fails the description assertion, so the hint
  is genuinely rendered and not merely computed.
- **Identity over catalog defaults.** The catalog-driven test walks `CATALOG`,
  asserts `encode(decode(defaultValue)) === defaultValue.trim()` for every kind
  with a field set, and separately asserts that editing each field preserves
  every other one - the destructive trap, tested directly.

### 2. Potentiometer wiper + polarized capacitor meaning
Wiper position 0..1 (default 0.5) that splits total R into two legs; the netlist
stops hardcoding half. Polarized capacitor gets a meaning: at minimum a
reverse-bias check that reports when the simulation drove it backwards, and
properties that say what the polarity marking is for.

**Done when:** a wiper sweep changes the divider output, and a reverse-biased
polarized cap produces a named warning.

The two halves are independent - one is a netlist parameter, the other inspects
a finished result - so they land as two commits. Half A is done; the item stays
open until half B lands.

**Half A, the wiper - DONE 2026-08-08.** `engine/potentiometerSpec.ts` is the
single parser, and `params.ts` gained the `Wiper=` key as a pure data edit, which
is item 1 paying off. Three things worth knowing before half B or item 6:

- **The 50 % constant lived in TWO places, not one.** The architecture notes
  above named `spiceNetlist.ts`; `lib/assistantCircuitPlan.ts` lowers a
  potentiometer into two resistors for assistant-generated circuits and had the
  same `total / 2`. Both now go through `potentiometerLegs`. Grep for a constant
  before assuming a netlist fact is single-sited.
- **A bare `10k` still means a centred wiper**, and re-encodes to exactly `10k`.
  That is a new `omitWhenFallback` field option on the keyed grammar: without it
  the catalog default would re-encode to `10k Wiper=0.5`, which fails item 1's
  identity test and would rewrite the value of every pot already on disk.
- **Each leg is floored at one part per billion of the track**, so a wiper run
  fully to either end cannot emit a zero-ohm branch. Verified on real ngspice:
  the same divider at wiper 0 / 0.25 / 0.5 / 0.75 / 1 solves to 10 / 7.5 / 5 /
  2.5 / ~0 V, extremes included.

Half B remains: the reverse-bias check is a result-inspection path, so it
attaches where `App.tsx` sets a transient or operating-point result rather than
in the deck. Audit every consumer of that warning list first - `ShellPanels.tsx`
spreads it, and a warning that becomes a blocker is trap 3 in `STATE.md`.

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
