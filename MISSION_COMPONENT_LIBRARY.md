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

**Half B, the polarity - DONE 2026-08-08.** `simulation/polarizedCapacitor.ts`
inspects a finished transient rather than changing the netlist. Pin `a` is the
positive terminal, agreed independently by the pin label, the `+` glyph beside
the straight plate in the symbol, and the node order the netlist emits; the
check re-verifies that pairing instead of trusting `TERMINAL_PAIRS` order,
because reordering that table would silently invert the test.

Threshold is `max(1 mV, 1e-3 x peak |V|)`, modelled on ngspice's own
reltol/vntol criterion - a fixed floor alone reports phantom reversals on a
12 V rail, a relative floor alone has nothing to scale against at 0 V. It is a
numerical floor, deliberately **not** a device rating: real electrolytics
tolerate about a volt, but Tau has no per-part rating data and inventing one is
what the LED advisory already refuses to do. The whole waveform is inspected and
the three cases are named separately (still reversed at the end, reversed only
while settling, intermittent); "sustained" is phrased as measured rather than as
steady state, because one transient cannot prove steady state.

The advisory rides `ComponentMeasurement.advisories`, not `result.warnings`, so
it cannot become a run blocker. It is transient-only; there is no operating-point
advisory path today.

Item 2 is closed.

### 3. Redraw: bulb, potentiometer, opamp, comparator, transformer, ctTransformer — DONE 2026-08-08
Fix the "+"/"−" collision on every amplifier-derived symbol. Close the
transformer lead gaps and land the CT tap on the coil junction. Make the
potentiometer read as adjustable. Fix `SYMBOL_BODY`/`SYMBOL_BOX` drift for each.

**Done when:** every lead terminates at its pin, no glyph is within a stroke
width of a body edge at selection weight, and both themes look right at the
1440×900 floor.

### 4. Controlled sources: drawings + settings — DONE 2026-08-08
VCVS/VCCS/CCCS/CCVS get distinguishable symbols and properties that name the
gain with its real unit (V/V, A/V, A/A, V/A) and explain the control port.
Decide and document whether a named control reference is added.

**Done when:** each of the four is identifiable from its symbol alone, and its
Properties panel explains what it computes.

**Settings half - DONE 2026-08-08.** All four were among the kinds with no
schema at all, so they fell through to `ShellPanels.tsx`'s raw "Value" textbox:
a transresistance reached the user as a box labelled "Value" containing `1k`.
Each now has a named gain carrying the unit `spiceNetlist.ts` actually emits it
in, plus a description of the control port. Pure `SCHEMA` data, no dispatch
edit. A `Laplace=H(s)` value on an E or G source is a value variant rather than
a second box, on the charge-capacitor's mechanism, and anything in front of the
`Laplace=` token rides through an edit under `EXTRA_PARAM_KEY`.

**The Laplace description is per-kind, and that is a correctness constraint, not
a style choice.** `s_xfer` is a voltage-in/voltage-out code model, so
`laplaceSourceLines` guards its exact branch with `if (!isCurrent)` and falls
every G source back to the DC gain H(0). A single shared string saying the
output follows H(s) would promise a VCCS user a frequency response the deck
never runs. A test asserts the VCCS text does not contain "exactly", so the two
cannot be quietly re-merged.

Worth carrying into items 5 and 9, which will both add field sets: **giving a
kind a numeric field with a unit is not a neutral act.** It moves the value out
of the raw textbox into `EngineeringInput`, which only commits a parseable
quantity. Any kind whose value may legitimately not be a quantity needs a
`when:` variant for that spelling, or the field cannot be edited at all. Check
what the netlist accepts before adding the field, and decode through the
engine's own parser rather than a second pattern - the comparator and the
Laplace variant both do, so the panel cannot disagree with the deck about what a
value means.

**Decision on a named control reference: no. Tau keeps the physical sense pair,
and the divergence from LTspice is real and now written down.** LTspice's `f`
and `h` symbols are two-pin and name their controlling source in the value;
Tau's are four-pin and synthesize `V_<base>_sense` across the C+/C- pair
(`spiceNetlist.ts:1951`, `:1960`). `ascImport.ts:976` already records that those
two symbols stay unbanked for this reason. The pair is kept because it is the
schematic-native answer: where the current is sensed is visible on the sheet and
moves with the wiring, whereas a typed source name is an invisible dependency
that breaks silently when the source it names is renamed or deleted. The cost is
that an imported LTspice `f`/`h` carries a value like `V1 2` that is not a
quantity; `parseQuantity`'s pattern is anchored and rejects it, and
`parsedNumberFrom` (`spiceNetlist.ts:2456`) turns that into "F1 needs a valid
A/A value." by name rather than guessing a number.

### 4b. Behavioral source, VCO and Subcircuit — DONE 2026-08-08

**Added 2026-08-08 after an audit found it missing.** The owner raised this
twice in the original request and it never made it into this file, so nine
items were worked and this one was not. That is a process failure, not a
scoping decision: nothing about it was ever declined.

`bsource` (B), `modulator` (VCO) and `subckt` (X) are the three parts a reader
cannot configure or even understand from the panel.

- **`bsource`** stores a raw LTspice expression (`V=1` by default) and gets the
  fallback single "Value" textbox. `simulation/behavioral.ts` already parses it
  and throws `"Behavioral source needs a V=/I= expression."` when the prefix is
  missing -- the panel should never let a reader reach that. Needs: a
  voltage/current mode, an expression field validated against the real parser,
  and worked examples, because "write an equation of other node quantities" is
  useless without knowing the vocabulary.
- **`modulator`** stores `mark=1K space=1K`, parsed by `engine/modulatorSpec.ts`
  into an XSPICE `sine` code model. Nothing in the UI says it is a VCO, what
  mark and space mean, or what drives its FM and AM pins.
- **`subckt`** already has a real picker (`ShellPanels.tsx`, `subcircuitOptions`
  + `describeSubcircuit`), so it is the least broken of the three. What is
  missing is the port list and per-port mapping being legible before you place
  one, and a route from "I have a .lib" to "it is on my sheet".

The item 1 codec means the field sets are data edits. `IndependentSourceEditor`
is the precedent for a mode-plus-conditional-fields editor.

**Done when:** a reader who drops a B, a VCO or an X can tell what it does and
configure it without leaving the app for a SPICE manual, and a malformed
behavioral expression is refused in the panel with the reason, not at run time.

### 5. Digital parts: pinouts and settings — DONE 2026-08-08
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

**Behaviour and re-run - DONE 2026-08-08. The drawing does not move yet.**

`schematic/actuation.ts` is the pure model: given a part and a press or a
release, what should its value become. A switch latches and ignores the
release; a push button springs back; an SPDT throws; a relay is refused **by
name with a reason**, because it has a moving contact a reader will certainly
click but it is driven by its coil.

Two conventions are load-bearing and tested:
- The contact state stays the **leading bare token** of the value string,
  because the solver reads the raw string's first word (`isStaticContactClosed`).
  Moving it behind a `state=` key makes every closed button read as open.
- A momentary button records where it rests **on the way in**. After one press
  an NC button reads "open" and nothing left in the value would say it should
  spring back to closed, so `form` falls back to *unset* rather than to "no":
  an omitted form still means "the state on disk is the rest state", and the
  catalog default stays spelled exactly `open`.

Both were found by tests that failed first.

The re-run answer: every component change runs `invalidateAnalysis`, which
nulls every result because the plot no longer describes the circuit. Throwing a
switch is the one edit whose purpose is to see the new result, so it re-solves
instead of blanking. The flag rides a ref so the invalidation effect keeps its
original dependencies.

**Still open on this item:** the symbol does not show the contact moving
(`symbols.tsx` was owned by another change in flight), the potentiometer wiper
is not yet draggable, and there is no hover affordance telling a reader a part
is operable.

### 7. LEDs glow with current — DONE 2026-08-08
Brightness from the current through the part, tracking the existing time cursor.
No glow without a result. Document the mapping.

**Done when:** an LED in a working circuit visibly brightens with drive current
and stays dark when reverse-biased.

### 8. Ideal by default, real behind Advanced — MODELS DONE 2026-08-08, disclosure open
Per the scoping decision above. Every placeable part defaults to textbook
behaviour; losses and second-order effects live under an Advanced disclosure.
Both paths must simulate correctly and be tested.

**Done when:** a freshly placed diode drops its ideal forward voltage, an
imported `.asc` diode is unchanged, and the corpus gate has not moved.

### 9. Configurable gate input count — DONE 2026-08-08
AND/OR/NAND/NOR/XOR/XNOR get an input-count control (minimum 2). The symbol
redraws with that many inputs; the netlist emits the matching gate. The five
always-drawn input leads go away.

**Done when:** setting a gate to 3 inputs shows 3 leads and simulates as a
3-input gate, and the palette icons for the seven gate types are distinguishable.

---

## Status at 2026-08-08 12:40

**Items 0-9 are closed, but item 4b was found missing in an audit and is open.** except the three tails listed under "Left open"
below. Gates: typecheck clean, **3581 tests passed / 8 skipped**, drift 10/10,
cargo `--lib` 77 passed.

### Item 5, 9 notes
The gate is now derived geometry: `gateInputRows()` on a 16 pitch (even banks
skip the centre so nothing lands on +/-8), seven distinguishable silhouettes,
and the inversion bubble sits on the output that **actually** carries the
inverted sense -- the old always-bubble-qbar drawing mislabelled every NAND,
NOR, XNOR and NOT. `getLocalPins(kind, value?)` is now two things on purpose:
with a value it is the instance's bank, without one it is the kind's full
dictionary, because `ascImport`'s `buildPinOverride` maps an `.asy`'s pin names
through it and narrowing by kind alone would drop `in2..in5` from every
imported AND.

All ten digital parts draw their pin names, the 555 included, and no digital
terminal passes |y| = 32 any more, so nothing clips the preview box.

**Pin captions turn with the body**, corrected only for the half-turn that
would invert them and the flip that would mirror them. Upright-at-every-angle
was built first and rejected on looking at it: at 90 degrees the 555's five
left captions land on one horizontal line 16 units apart while RESET alone is
21 wide.

### Item 7 notes
An overlay, not a symbol change, for the reason the flow layer is one:
`ComponentSymbol` is a pure function of kind and value. Brightness is
logarithmic between 50 uA and 20 mA because perception is -- linear would put
1 mA at 0.05. Reverse bias, a non-finite current, and no result at all are all
dark. Deliberately **not** behind Current Mode: the flow dots are a debugging
aid, a lit lamp is what the part does. Every LED is amber because Tau does not
model wavelength.

## Status at 2026-08-08 15:20 — items 0-9 and 4b all closed

Gates: typecheck clean, **3668 tests passed / 8 skipped**, drift 10/10, cargo
`--lib` 77 passed.

The three tails are done. Reversion was checked on each after the fact, because
the agents that wrote them were cut off mid-verification:
disabling `strandedTerminals` fails 5; stubbing `checkBehavioral` to always
accept fails 8; making the wiper drag absolute fails 3.

**Tail 3 moved nothing, deliberately.** A saved document records where its wires
end, not which pin they meant, so a moved terminal silently disconnects and the
circuit still opens, still runs, and solves differently. Relocation was
considered and rejected on the evidence: the DAC's VREF crossed from the left
edge to the right and the 7-segment was re-banked onto two columns, so
reattaching an endpoint would route a conductor through the body, and the
16-unit moves would leave a bend the user never drew. Redrawing somebody's
schematic to match a new symbol is worse than telling them which two wires to
move. Named, not repaired — the same contract as `retiredKinds`. Redrawing a
part in future means adding a row to `relocatedPins.ts`.

## Left open (small, named)

- **Item 6:** the potentiometer wiper is not draggable, and there is no hover
  affordance telling a reader a contact is operable. Behaviour and drawing both
  work.
- **Item 8:** nothing outstanding in the models; the Advanced disclosure landed.
- **`io/ascImport.ts`:** an imported `Digital\and` keeps five `pinOverride`
  inputs while its value names no count, so the body draws two leads and three
  import leads start 8 units off it. Appending `Inputs=<n>` at import fixes it,
  but that changes the exported `Value` attribute which `ascExport.test.ts`
  round-trips -- do both together.
- **Saved documents wired to the old digital pin positions** need those wires
  re-attached. Pin ids and order did not change, only coordinates, and there is
  no endpoint-relocation path today.

## Status at 2026-08-08 11:00

Closed: **0** (Test Point), **1** (parameter codec), **2** (wiper + polarity),
**3** (redraws), **4** (drawings + settings). Partly closed: **6** (behaviour
and re-run done, drawing/wiper/affordance open), **8** (ideal models done,
Advanced disclosure open). Untouched: **5**, **7**, **9**.

Gates here: typecheck clean, **3482 tests passed / 8 skipped**, drift 10/10,
cargo `--lib` 77 passed.

### Item 3 notes
The `+` collision was fixed in the *triangle*, not the glyph: the body grew to
half-height 32 (LTspice's opamp proportions) and the glyphs moved to x = -14.
Closest approach between any glyph centreline and any body edge is now **6.0
units** against **1.935** before, i.e. two full selected-stroke widths. Both
amplifiers share one `AmplifierBody`. Transformer windings are generated so each
coil spans exactly its own pin rows; the CT tap leaves at the junction and
carries a dot. The potentiometer track is symmetric about the wiper pin so the
arrow tip lands on it. Looked at in the running app at 1440x900 in both themes:
nothing clips the +/-42 x +/-40 preview box, stroke 1.55, `--comp` in both.

### Item 4 notes
All four controlled sources now differ on **both** ports: open pair vs closed
sense branch on the control side, diamond-with-+/- vs diamond-with-arrow on the
output. Body corrected to the drawn `+/-24 x +/-22`. Still open is the *settings*
half: gain with its real unit and an explanation of the control port.

### Item 8 notes
Provenance is an absence test -- `pinOverride`, `ltSymbolType`, `ltModelName`,
`ltModelFile`, `ltWindows`, `ltExtraAttrs`, `ltHierarchy` -- because no positive
"placed in Tau" flag exists and adding one would rewrite every saved document.
Ideal is expressed in LTspice's own `D(Ron= Roff= Vfwd= epsilon=)` spelling so
the existing `translateIdealDiodeDeckLines()` turns it into ngspice `sidiode`.
`epsilon=10m` was chosen by measurement: at 1m a 30 mA LED makes ngspice print
gmin-stepping noise into Diagnostics on a correct run; at 50m a 1 A diode reads
0.710 V.

Two consequences worth knowing. A zero-volt series ammeter is emitted with each
ideal part, because an XSPICE `A` device reports no current of its own -- without
it every placed diode loses `I(D1)`, and item 7 depends on that current. And a
placed junction loses its `.op` VD/GD row, which for an ideal part carried no
information but is a visible difference.

Corpus invariance was proven, not sampled: across all **4012** `.asc` files,
**2114** junction components import and **0** can reach the ideal path. The
canonical corpus gate returns byte-identical numbers with and without the change.

**Still open on item 8:** the Advanced disclosure, which needs `params.ts` and
`ShellPanels.tsx`. The switch family is already ideal (1 mOhm / 1 TOhm) with no
real model to hide, so nothing to do there unless contact resistance is added.

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
