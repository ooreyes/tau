# Tau → LTspice Feature Parity

> **Living checklist + to‑do list.** Goal: functional parity with **LTspice 17.2.4**.
> Update as items land — flip `⬜`/`🟡` to `✅` with a one-line note (commit/file).
> Any agent picks up the next unchecked item. Work loop + **Definition of Done**
> live in [AGENTS.md](AGENTS.md); live status in the [PROGRESS.md](PROGRESS.md) heartbeat.

> **📊 Headline metric (the finish line):** acceptance import **~71 / 82** files
> warning‑clean (xtal/DIAC/TRIAC/varistor mappings landed; next: Comparators\*
> vendor pin banks unblock 8 more) · **1031 tests** green. **Done = ≥ 80/82 + Class‑D `.tran`/`.meas`
> parity + signed DMG** (full checklist in AGENTS.md → Definition of Done).

---

## 🎯 KEY GOAL (the acceptance test)

**Tau must open the user's own LTspice `.asc` files and reproduce LTspice's results.**

Concretely, these must load, simulate, and match LTspice:
- `~/Downloads/LTspice_export/class-d_starter.asc` (Class-D modulator: triangle + sine → comparator → gate drive → half-bridge)
- `~/Downloads/LTspice_export/deadtime.asc`
- `~/Documents/LTspice/*.asc` (Draft1–10, hw3) and `~/Documents/LTspice/examples/Educational/*.asc`
  (colpitts oscillator, loop gain, curve tracer, varactor, …)

When a real, unmodified LTspice schematic from this machine opens in Tau and the
plotted waveforms match LTspice's, Tau is a real replacement. **Everything below
serves that goal.** Track progress with these circuits as the test suite.

### Directives actually used in the user's circuits (frequency — prioritize accordingly)
`.tran` 932 · `.param` 180 · `.ac` 124 · `.meas` 61 · `.dc` 37 · `.step` 34 ·
`.model` 29 · `.noise` 13 · `.func` 13 · `.op` 10 · `.options` 7 · `.temp` 4 ·
`.subckt` 2 · `.tf` 1 · `.inc` 1

---

## How to work on this (for the next LLM)

- Repo: Tauri v2 + React 19 + TS (`apps/desktop/`), Rust ngspice FFI (`src-tauri/src/spice.rs`).
- Engine: native ngspice (desktop only) in `engine/nativeSpice.ts` + `engine/spiceNetlist.ts`;
  interim TS MNA solver (`simulation/*.ts`) for the browser/tests (linear only).
- Schematic is source of truth; netlists are DERIVED (`schematic/netlist.ts`).
- Verify every change: `pnpm -C apps/desktop typecheck` and `pnpm -C apps/desktop test`.
  Validate decks with the installed `ngspice -b file.cir` CLI. ~228 tests currently pass.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Worktree gotcha:** isolated agent worktrees branch from the OLD v0.1 scaffold.
  First run `git fetch origin && git merge --ff-only origin/<branch>` and confirm ~228 tests.

Status legend: ✅ done · 🟡 partial · ⬜ not started

---

## 1. File I/O & interoperability  ← **highest leverage for the key goal**
- 🟡 **Real-`.asc` op-deck build now 82/82** (was 34/82 at this work's start):
  `decodeSchematicText` falls back to **Windows-1252** when the bytes aren't valid
  UTF-8, so LTspice's single-byte `µ` (0xB5) decodes as the micro sign instead of
  U+FFFD (was the biggest blocker — 32 files); `buildParamScope` accepts the
  plural **`.params`** keyword; `stripSourceModifiers` drops `Rser=`/`Cpar=`/
  `wavefile=` instance-param tokens ngspice rejects on independent sources; the
  expression engine resolves LTspice **statistical functions** (`mc`/`gauss`/
  `flat`/`rand`/`random`/`white`) at their nominal/mean value;
  `componentValueFromAttrs` now **reassembles a source spec split across all four
  SYMATTR fields** (`Value`/`Value2`/`SpiceLine`/`SpiceLine2` — P2.asc's SINE);
  and **`Laplace=H(s)` on E/G sources** is realized as an XSPICE `s_xfer`
  (rational transfers, ngspice-verified) or its DC gain H(0) (exact for `.op`;
  transport-delay/√ fallbacks) — unblocked Draft8/PLL/PLL2/TwoTau/HalfSlope; and
  a **Chan magnetic-core inductor** (`Hc/Bs/Br/A/Lm/Lg/N`) is sized to its
  **unsaturated linear inductance** from the gap+core reluctance
  (`engine/coreInductor.ts`; ngspice has no saturable-core primitive) — unblocked
  NonLinearTransformer. **All 82 now build a deck.** (NonLinearTransformer is a
  behavioral-magnetics demo whose flux-integrating G-source loop still hits a
  singular matrix in ngspice without the true Chan model — building ≠ converging
  for that one file; the saturable waveform is genuinely out of ngspice's reach.)
- 🟡 **Import LTspice `.asc` schematics** — **parser + `ascToSchematic()` landed**
  (`io/ascImport.ts`). Parses `Version/SHEET/WIRE/FLAG/SYMBOL/SYMATTR/WINDOW/TEXT/
  LINE/…` losslessly; validated by parsing **4,012 real LTspice files (49,625
  symbols, 165,744 wires) with zero throws**, plus `ltspiceTypeToKind` +
  orientation map.
  - ✅ **(a) `ascToSchematic()`** — converts a parsed doc to Tau components
    (with `pinOverride`), wires, ground symbols / net labels, and surfaces
    `TEXT !` directives + `;` comments. Coords kept 1:1 (LTspice grid = Tau
    GRID = 16). Real-file proof: `deadtime.asc` → 18 comps / 59 wires / 12 nets,
    ground found, vcc/vee/gp/gn/pwm/vrcp/vrcm each collapse to one net;
    `class-d_starter.asc` → 15 comps / 10 nets / 4 directives (`.tran`, 3×`.meas`).
  - ✅ **(b) pin-accurate connectivity via `pinOverride`** — `PinOverride`
    (world pin positions) added to `SchematicComponent`; honored in
    `schematic/pins.ts` `getComponentPins`. `ascToSchematic` places each part with
    `pinOverride = anchor + transformLtPoint(pin)` so nets extract exactly as
    LTspice intends (no connector-wire hacks). 3-terminal MOS bulk tied to source.
  - ✅ **Net labels are now electrical** — `extractCircuit(…, netLabels)` merges
    same-named FLAGs into one net, treats `0`/`GND` as ground, and names nets
    after their label (so `V(vcc)` resolves). Threaded through the native +
    TS-solver paths and `App.tsx`. (Previously net labels were cosmetic.)
  - ✅ **(d-param) directives carried on the document + fed into the param scope** —
    `directives: string[]` added to `SchematicDocument`/`Doc` (store, persistence,
    undo/redo, tab snapshots, validation) with a `setDirectives` action. `App.tsx`
    memoizes `buildParamScope(directives)` and threads `params` into **all six run
    sites** (native + TS `.tran`/`.op`/`.ac`), so an imported `.asc`'s `.param`/
    `.func`/`{expr}` values resolve when simulated. End-to-end proof in
    `ascImport.test.ts`: a parsed `!.param Rload=4.7k` + `Value {Rload}` resolves
    to `4700` through `buildParamScope` → `resolveComponentValues`.
  - ✅ **(d-analyses `.tran`/`.ac`) directive → analysis options** — `io/
    directiveAnalysis.ts` parses `.tran <Tstep> <Tstop> …` → `{ stopTime, steps }`
    and `.ac <dec|oct|lin> <N> <Fstart> <Fstop>` → `{ startHz, stopHz,
    pointsPerDecade }` (SI suffixes, modifiers ignored, lin/oct normalized to
    points-per-decade). `App.tsx` `adoptDirectiveOptions` applies an imported
    circuit's own `.tran` window on open / tab-switch, so it simulates as
    authored instead of with the editor default. 14 unit tests, hand-computed.
  - ✅ **(c) Open dialog wired to the importer** — the toolbar **Open** button's
    file picker now accepts `.asc` (`accept=".tau.json,.asc,application/json"`).
    `ShellPanels.openCircuit` branches on extension: `.asc` → `importAsc(text)`
    (`parseAsc`→`ascToSchematic`, new convenience export) → builds a
    `SchematicDocument` with `components/wires/netLabels/directives` and calls
    `onOpenCircuit` → `App.openDocument`, which already adopts the imported
    `.tran`/`.ac` window (`adoptDirectiveOptions`) and builds the param scope.
    Empty/non-LTspice files error cleanly ("No schematic content found …");
    banked-pin warnings logged non-fatally. Real-file proof: opening
    `class-d_starter.asc` (15 comps/46 wires/4 directives), `deadtime.asc`
    (18/59), `Draft1.asc` (4/10/1) all load.
  - ✅ **Op-amp + E/G controlled-source pins now banked** — extracted from the
    real LTspice 17.2.4 `lib/sym` `.asy` files. Op-amps resolve to one of two
    geometry families (`opampC` for the centered UniversalOpAmp/UniversalOpAmp2;
    `opampO` for the offset layout shared by `opamp.asy`, `opamp2.asy` and EVERY
    vendor part — AD823/LT1001/LT1028/AD711/OP07…); E/E2 (VCVS) and G/G2 (VCCS)
    map their control/output pairs (the `2` variants swap controls; G reverses
    output polarity). This flips **22 acceptance files** from "placed without
    pin-accurate geometry (connections may be wrong)" to pin-accurate — incl. the
    key-goal `deadtime.asc`. Warning-clean import coverage **45→67/82**.
  - **NEXT:** map `.meas`/`.dc`/`.step` directives (need those analyses first —
    §4); render imported symbols at their LTspice geometry. Remaining 15
    warned files all need NEW component kinds: hierarchical sub-block import
    (`deadtime` used inside class-d_starter — §2), DIGITAL `A`-devices
    (INV/XOR/dflop/SCHMTBUF — §3), SpecialFunctions (MODULATE/sample/varistor),
    and DIAC/TRIAC/IGBT/XTAL/capmeter primitives.
  - **Pin data banked:** `LTSPICE_PINS` + `transformLtPoint()` in `io/ascImport.ts`
    hold the real LTspice symbol-local pin offsets (from `lib/sym/*.asy`) and the
    orientation transform (clockwise, Y-down, mirror-aware). Now covers passives,
    sources, semis, tline, op-amps, and E/G controlled sources.
- ⬜ **Import LTspice `.asy` symbols** (so library parts render) — 6,280 ship with LTspice.
  - 🟡 **Alias symbols now map to existing kinds** (`ltspiceTypeToKind`): a corpus
    survey of unmapped `SYMBOL` types found several that are just packaging
    variants of kinds Tau already has — `varactor`/`SMdiode` → diode,
    `Misc\battery` → DC voltage source, `RN55upright`/`UprightPowerResistor` →
    resistor — so **98 previously-skipped symbol instances across the user's
    files now import** with pin-accurate geometry (the SMdiode/RN55 vertical pin
    layouts banked in `LTSPICE_PINS`; varactor/battery reuse the diode/voltage
    banks). 7 tests. (The varactor still needs its `.model` to behave as a
    variable-capacitance device, but it now places + connects instead of being
    dropped.)
  - 🟡 **`Misc\jumper` imports as a wire net-tie** — a jumper is a graphical
    0 Ω short (LTspice emits no SPICE line for it), so `ascToSchematic` converts
    each one to a `WIRE` between its two pins (`+(-32,64)`/`-(32,64)`) so the
    nets merge exactly. ~26 instances across the corpus (e.g. Educational/160.asc
    uses 6). 1 test.
  - 🟡 **`Misc\signal` → voltage source** — LTspice's "signal" source variant
    (the generic DC/AC/PULSE/SINE/PWL/EXP/SFFM symbol, Prefix V) maps to
    `vsource` with the same +/− pin bank as `voltage`; its SINE value + `AC`
    stimulus flow through unchanged. Cleans **Draft1.asc** (a key-goal file).
  - **Acceptance import coverage: 67/82 of the user's own files now import with
    zero unmapped symbols** (was 66 before signal; the remaining 15 need
    hierarchical-block (`deadtime` sub-schematic), DIGITAL `A`-device, or
    DIAC/TRIAC/IGBT support — all tracked ⬜ items).
- 🟡 Map LTspice `SYMATTR Value/Value2/SpiceModel/ModelFile` to Tau component
  values — **source AC-stimulus mapping landed** (`io/ascImport.ts`
  `componentValueFromAttrs`): for `voltage`/`current` symbols the importer now
  joins `Value` + `Value2` + `SpiceLine` onto the component value, exactly as
  LTspice concatenates them on the netlist line, so the `AC <mag> [phase]`
  stimulus (the common `SYMATTR Value2 AC 1`) is no longer dropped.
  `engine/acSpec.ts` (`parseAcSpec`/`stripAcSpec`/`acSpecDeckText`) pulls the AC
  chunk back out: the **native ngspice deck** emits it (`V1 n1 0 SIN(0 1 1) AC 1`,
  live-verified — RC corner at −3.01 dB/−45°), the **TS AC solver** drives any
  `vsource`/`isource` carrying an AC spec as that phasor (not a short/open), and
  the TS transient/OP DC-parse sites strip the AC chunk so a `5 AC 2` value still
  reads 5 V. 21 hand-computed tests. **NEXT:** semiconductor instance params
  (`Value2`/`SpiceLine` on diodes/MOS), `SpiceModel`/`ModelFile` model selection.
- ✅ Export Tau schematic → `.asc` (round-trip). `io/ascExport.ts`:
  `serializeAscDocument` (inverse of `parseAsc`, round-trips an `AscDocument`)
  + `schematicToAsc` (Tau components/wires/netLabels/directives → `.asc` text,
  `kindToLtspiceType`/`rotationToOrientation` reverse maps). Wired to a **Save
  .asc** toolbar button (`ShellPanels`). Validated: real `deadtime.asc` (18
  comps/59 wires/13 nets), `class-d_starter.asc` (15/46/8), `Draft1.asc` (4/10)
  import→export→re-import preserve all counts/kinds with idempotent re-export
  and zero warnings. 11 unit tests.
- 🟡 Native SPICE netlist generation (`engine/spiceNetlist.ts`) — works for built-in kinds; needs the directive/model coverage below.
- ✅ Export `.cir`/netlist to file; import `.cir`. — **Netlist export landed**
  (LTspice "View → SPICE Netlist"): a **Netlist** button on the transient pane
  builds the same deck the engine runs (`buildSpiceDeck` with the document's
  `.param` scope) and downloads it as `tau-netlist-<date>.cir`. Build errors
  (no ground, no parts) surface inline instead of crashing. **`.cir` import
  landed** (`io/cirImport.ts` `parseCir`): parses a SPICE deck (title card,
  `+` continuations, `;`/`$` inline comments, `.model` polarity → npn/pnp,
  nmos/pmos, ambiguous 3/4-terminal MOS resolved via the model map) into Tau
  components laid out on a grid with **net-label-per-pin connectivity** (a label
  at each pin's exact coordinate shares the pin's DSU point key, so same-named
  nets merge and `0`/`GND` → ground — no wire routing needed). Handles
  R/C/L/V/I/D/Q/M/E/G/B; warns+skips X/K/F/H/T. Wired into the Open dialog
  (`.cir`/`.net`/`.sp`). Validated: a real `deadtime.asc` → `buildSpiceDeck` →
  `parseCir` re-imports all 16 deck devices, 0 warnings, 10 nets, ground
  resolved. 10 unit tests incl. an `extractCircuit` connectivity check.
- ✅ `.raw` waveform export/import (LTspice binary raw format).
  **Import** (`io/rawImport.ts` `parseRaw`): decodes LTspice's UTF-16LE/ASCII
  header + `Variables:` table + `Binary:`/`Values:` data, with the exact
  precision layout (var0 float64, dependents float32 unless `double`; complex
  `.ac` as re/im float64 pairs). `rawTrace(data, name)` pairs a named variable
  with the independent axis (magnitude for complex). Verified against a REAL
  embedded `_t_startup.op.raw` fixture (`V(n001)≈-0.9983`).
  **Export** (`io/rawExport.ts` `serializeRaw`): writes the canonical LTspice
  binary `.raw` (UTF-16LE header, var0 float64 / dependents float32) so Tau
  results open in LTspice's viewer; `parseRaw(serializeRaw(x))` round-trips
  (real + complex). Wired to a **Save .raw** button on the transient pane
  (time + every node V / branch I / plotted expression). 11 unit tests total.
  **Scope overlay landed:** a **Ref .raw** button on the transient pane loads an
  LTspice `.raw`, matches its variables to the plotted Tau traces by name
  (`simulation/rawOverlay.ts` `buildReferenceOverlay`), resamples each onto Tau's
  time grid, draws it dashed, and shows a per-signal **% RMS + pass/✗** readout
  via `compareWaveforms` — a direct LTspice-vs-Tau acceptance check in the UI.
- ⬜ Save/Open Tau-native `.tau.json` — **partial** (toolbar Save/Open exists); verify robustness.

## 2. Schematic capture
- ✅ Place / move / rotate / mirror / delete components — `Canvas.tsx`, `store/useSchematic.ts` (mirror = horizontal flip, applied before rotation; Ctrl+E)
- ✅ Wire drawing with orthogonal routing + junction dots — `Canvas.tsx` (`routeWireSmart`)
- ✅ Net labels (name a node) — `FLAG` equivalent — store `upsertNetLabel`;
  **now electrical** (merge same-named nets, `0`/`GND`→ground, name the net) in
  `schematic/netlist.ts` `extractCircuit`
- ✅ Ground symbol — ✅
- ✅ Grid snap, pan, zoom, fit — `Canvas.tsx`
- ✅ Undo/redo, autosave, multi-tab documents
- ✅ Component value editing (double-click) + structured params
- ✅ Probe tool (click node → plot) — `probes`
- ✅ **Mirror/flip components** (LTspice Ctrl+E) — `mirrored` flag on
  `SchematicComponent` (flip across the vertical axis, applied BEFORE rotation to
  match LTspice `M*`); `transformPoint` in `schematic/pins.ts` drives connectivity,
  `symbolTransform` (`rotate(R) scale(-1 1)`) drives rendering. `mirror()` store
  action toggles the selection or the placement ghost; Ctrl+E bound in `App.tsx`.
  The importer now sets `mirrored` for `M*` orientations so imported parts render
  flipped. 12 hand-computed tests (pin geometry incl. mirror-before-rotate, store
  toggle/undo/place, import mapping).
- 🟡 **Copy/paste, duplicate** (single selection) — **landed** in
  `store/useSchematic.ts`: `copySelected` → ephemeral `clipboard`; `paste`/
  `duplicateSelected` place a `placeClone` (fresh id, next ref-des, 2-grid diagonal
  offset, `pinOverride` offset in lockstep so imported parts stay wired); both
  undoable and select the copy. Bound to Ctrl+C / Ctrl+V / Ctrl+D in `App.tsx`.
  9 store tests. **Multi-select landed** — `selectedIds` + `selectMultiple`/
  `toggleSelect` (Shift+click) in the store; drag-box select (fully-enclosed,
  LTspice semantics, middle-mouse pans) + group move (single undo step) in
  `Canvas.tsx`; group delete. 10 store tests.
- ✅ **Drag wires / move with rubber-banding** — `moveGroup` rubber-bands wire
  endpoints attached to moved pins with orthogonal elbow insertion (store-level,
  shared by single and group moves).
- ⬜ Bus wires / bus taps
- ⬜ `.asc`-style `TEXT` SPICE directives placed on the canvas (free-text directive blocks)
- ⬜ `.asc`-style `TEXT` comments
- ⬜ Draw primitives (line/rect/circle/arc) on schematic
- 🟡 Hierarchical schematics (a schematic used as a symbol / `.subckt`) —
  **import-flattening landed** (`io/ascImport.ts`): `parseAsy` reads `.asy`
  `BLOCK` pins (SpiceOrder), and a `resolveSubcircuit` hook on `ascToSchematic`
  **inlines** a referenced sub-schematic into the parent — ports bridge to the
  parent net at each pin via synthetic net labels, internals stay private
  (`<inst>/…`), ground stays global, and each block is packed into a disjoint
  X-region so no geometry shorts across instances; body directives are dropped.
  `makeSubcircuitResolver` builds a resolver from sibling-file text and the Open
  dialog (multi-select) feeds it the user's `.asy/.asc` siblings. **Clears the
  last import warning on the flagship `class-d_starter.asc`** (its `deadtime` X1
  fully inlines: 33 components, all 5 ports bridged, netlist extracts clean). 7
  tests. Still ⬜: a Tau-native subckt *device* / hierarchy re-export and an
  in-canvas hierarchical block symbol (this path flattens on import only).
- ⬜ Net highlighting (hover a net → highlight whole net)
- ⬜ Component attribute window/editor (full SPICE line editor per part)
- ⬜ Pin/port symbols (IOPIN) for hierarchy

## 3. Component / symbol library
Current Tau kinds (~25): R, C, L, pot, V(DC), I(DC), Vac, Iac, **Vpulse**, diode, LED,
zener, opamp, comparator, **VCVS (E)**, **VCCS (G)**, **CCCS (F)**, **CCVS (H)**, **B (behavioral)**, NMOS, PMOS, **NJF**, **PJF**, NPN, PNP, switch, transformer, **tline**, testpoint, ground.
- 🟡 Passives R/C/L (✅) — **C/L initial conditions (`IC=`) landed**: the importer
  pulls an `IC=` token from a cap/inductor's `Value2`/`SpiceLine`/`SpiceLine2`
  (LTspice writes e.g. `SpiceLine2 IC=1`; `engine/icSpec.ts` + `componentValueFromAttrs`)
  and the native deck emits `C1 n1 n2 100p IC=1`, adding `uic` to the transient so
  the value holds at t=0 (live-verified in ngspice — cap starts at 1 V). Real
  case: Draft10.asc. **TS-solver IC support now landed**
  (`simulation/linearTransient.ts`): `positiveValue` strips the `IC=` token before
  parsing a C/L magnitude (a value like `1u IC=2` used to throw "Could not parse"),
  and the transient seeds the backward-Euler companion state from the parsed IC so
  the value holds at t=0 (LTspice `IC=`+`uic` semantics). Hand-computed proof
  (`initialConditions.test.ts`): a 1µF/1kΩ cap charged to IC=2 V discharges as
  `V[n]=IC/(1+h/RC)^(n+1)` — starts ≈2 V, reaches ≈IC·e⁻¹=0.736 V at t=RC=1 ms,
  monotonic; an IC=1 A inductor delivers ~1 A at t=0 and decays through R; without
  IC the node starts at 0. 3 tests. Still to add: parasitics (ESR/Rser),
  behavioral R/C/L.
- 🟡 Sources — DC/AC/PULSE plus **inline LTspice transient functions on V/I sources now emit to the ngspice deck: SINE (offset/amp/freq/td/damping/phase), PULSE (full 7-arg, Ncycles trimmed), PWL, EXP, SFFM** (`engine/sourceFunction.ts`; µ/meg normalized). **TS-fallback solver now evaluates the same families in the time domain** (`simulation/sourceWaveform.ts` `parseTransientSource` → `{ dc, at(t), maxFrequencyHz }`): the `.tran` loop drives `vsource`/`isource` (and the `vac`/`iac` AC symbols) from the parsed waveform instead of DC-only, `.op` seeds the t=0 bias, and `inspectTransientResolution` derives the sampling requirement from a function source's own frequency. ngspice-verified: PULSE(0 5 1m 0 0 2m 4m) node = 0/5/0 V at t=0.5/2/3.5 ms in both engines. Still missing: PWL FILE, explicit AC spec on these, noise sources (**arbitrary behavioral B-source `V=…`/`I=…` also landed** — see the dedicated B item below)
- 🟡 Semiconductors — diode/BJT/MOS/zener present; **bundled LTspice standard
  models landed** (`engine/standardModels.ts`): common parts referenced by name
  with no inline `.model` (1N4148/1N914, 1N5817-19 Schottky, BAT54, 1N750/4733/
  5231 zeners, 2N2222/3904/BC547 NPN, 2N2907/3906/BC557 PNP) now emit their real
  LTspice `lib/cmp/standard.*` parameters into the deck and the device line uses
  the part name. Live-verified in ngspice (1N750 zener clamps at 4.67 V). Generic
  `TAU_*` still covers unbundled/unknown names. **NEXT:** broaden the bundle; MOS
  VDMOS power models + JFET kinds; browser TS-solver model parsing.
- ✅ **Behavioral sources (B)** — used constantly in real LTspice circuits —
  **landed end-to-end.** New `bsource` component kind (2-terminal output, value
  carries `V=<expr>`/`I=<expr>`): pin geometry + diamond symbol + palette entry
  (hotkey `j`). **Native ngspice deck** emits `B p n V=…`/`I=…` verbatim
  (`engine/spiceNetlist.ts` + `simulation/behavioral.ts behavioralSpecText`,
  brace-substituted; bare expr defaults to `V=`); live-verified in ngspice 17
  (`V=2*V(in)+0.5` → 4.5 V; `I=1m*V(ctrl)` polarity matched). **Import**:
  LTspice `bv`/`bi`/`b`/`b2` → `bsource`, value (`I=I(V1)…`) flows through 1:1,
  pin geometry banked (bv≈voltage, bi≈current — matches GFT.asc wiring). **TS
  solver** simulates the *affine* subset via `linearizeBehavioral` (reduces
  `const + Σ coeff·V(node)` by symbolic perturbation with a multi-point
  linearity check; rejects products/powers/`time`/`I(...)`/unknown params):
  V-type stamps as a multi-input VCVS (branch unknown + constant offset), I-type
  as transconductance, in `.op`/`.tran`/`.ac` (constant drops at AC). Nonlinear/
  dynamic forms raise a clear "needs native engine" error rather than silently
  mis-solving. **35 hand-computed tests** (behavioral parse/linearize, deck
  emission, import mapping, op/tran/ac solves) cross-checked against ngspice 17.
  **LTspice `if(cond,a,b)` now auto-translated to ngspice's ternary**
  `(cond) ? (a) : (b)` in `behavioralSpecText` (`ifToTernary`): ngspice has no
  `if` function in B-sources ("no such function 'if'", live-verified) and its
  compat mode can't be set per-deck, so any imported behavioral source using
  `if()` would otherwise crash the deck. Handles nesting, commas inside nested
  calls, 2-arg `if` (else→0), case-insensitivity, and leaves `if` inside longer
  identifiers (`motif`) alone. +9 tests; the translated ternary live-verified in
  ngspice 17 (outputs exactly the two rails).
- ✅ **Voltage/current-controlled sources** E/F/G/H — **all four landed**
  end-to-end: `vcvs`/`vccs`/`cccs`/`ccvs` component kinds (2-port: control pair +
  output pair), pin geometry + symbols + palette entries, and **linear MNA stamps
  in all three TS solvers** (`.op`/`.tran`/`.ac`). VCCS is a pure transconductance
  stamp; VCVS adds a branch-current unknown like a voltage source. **F (CCCS) and
  H (CCVS)** model the control port as an internal **zero-volt sense branch**
  whose branch current is the controlling current I(cp→cn): CCCS adds 1 unknown
  (sense) and stamps output current `gain·I_sense`; CCVS adds 2 unknowns (sense +
  output branch) and constrains `V(op)−V(on)=r·I_sense`. Native ngspice deck emits
  `E/G op on cp cn k` and, for F/H, a per-device `V_<ref>_sense cp cn 0` plus
  `F/H op on V_<ref>_sense k`. `ascImport` maps LTspice `e/e2`→VCVS, `g/g2`→VCCS,
  `f/f2`→CCCS, `h/h2`→CCVS. 18 hand-computed tests cross-checked against ngspice 17
  (E: V(op)=gain·V(cp); G: V(op)=−gm·R·V(cp); F: V(out)=−gain·I_sense·R;
  H: V(out)=r·I_sense, load-independent; difference-amp, negative gain/r, flat-gain
  AC, branch current).
  - 🟡 **`Laplace=H(s)` transfer functions on E/G** (`engine/laplace.ts`):
    a symbolic rational expander turns LTspice's `Laplace=A0/(1+s/wp1)/(1+s/wp2)`,
    `1/(1+τs)**n`, band-pass `ks/(s²+ks+w²)`, … into **highest-power-first
    numerator/denominator coefficient lists** for ngspice's XSPICE `s_xfer` code
    model (params resolved against the schematic scope; AC rolloff ngspice-46
    verified). Non-rational transfers — transport delay `exp(-Ts)`, fractional
    `sqrt(1+τs)` (TwoTau/HalfSlope) — fall back to the **DC gain H(0)**, which is
    exact for an operating point and a low-frequency stand-in elsewhere, so every
    Laplace source builds. Current (G) Laplace always uses the DC fallback
    (s_xfer sources a voltage, not a current). 10 unit + 2 deck-integration tests.
- 🟡 JFET, MESFET, IGBT — **JFET landed end-to-end.** New `njf`/`pjf`
  component kinds (3-terminal D/G/S, parallel to nmos/pmos): pin geometry +
  symbol (vertical channel + gate arrow, direction per polarity) + palette
  (Semiconductors) + `buildSpiceDeck` `J<name> d g s <model>` with bundled
  generic `TAU_NJF`/`TAU_PJF` models (`Vto=∓2 Beta=1m Lambda=1e-4`).
  Live-verified in ngspice-46 (NJF common-source bias: Id = Beta·(Vgs−Vto)²
  = 2.25 mA exact at Vgs=−0.5). Import maps LTspice `njf`/`pjf` with the real
  `.asy` D/G/S pins (gate at dy=64) and export round-trips. Native engine only
  (nonlinear — excluded from the linear TS solver). 5 tests. **Real LTspice
  JFET models now bundled** (`engine/standardModels.ts`): 2N3819/J309/J310/
  2N5484/2N5486 (NJF) + 2N5460/J175 (PJF) emit their verbatim `standard.jft`
  params when referenced by name (ngspice-46 verified; LTspice-extra keys it
  ignores are non-fatal), else generic `TAU_NJF`/`TAU_PJF`. **NEXT:** MESFET,
  IGBT; browser TS-solver JFET model.
- 🟡 MOSFET level/VDMOS power models, body diode — **VDMOS device emission landed**
  (`engine/spiceNetlist.ts` + `engine/modelDirectives.ts` `definedModelTypes`):
  a MOSFET that resolves to a `.model … VDMOS(…)` definition (vendor `.lib`/`.sub`,
  a pasted TEXT model, or a bundled standard part — `standardModelType`) now emits
  ngspice's **3-terminal** VDMOS line `M nd ng ns model` instead of the 4-terminal
  level-1 form. Emitting the 4th (bulk) node against a VDMOS model silently
  reinterprets it as the model's optional thermal node (or floats it when the
  LTspice 3-pin VDMOS symbol left the Tau `nmos`/`pmos` bulk pin unconnected), so
  the bulk pin is dropped. Non-VDMOS MOSFETs keep their 4-terminal line. ngspice-46
  verified the 3-node VDMOS form (`M1 d g s nv` → Id=32.2 A at Vgs=5, Vto=2, Kp=8).
  9 tests (model-type parsing, 3-vs-4-node emission, VDMOS passthrough).
  **NEXT:** ship real power-MOSFET VDMOS model params by name (class-d's
  `RSR015P06`/`QS6K1` still fall back to the generic level-1 starter — they need a
  bundled vendor model); browser TS-solver VDMOS; body-diode + thermal node.
- 🟡 Comparators / logic gates / digital (LTspice `A` devices) — **needed for class-d_starter.asc**
  - ✅ **Dedicated `comparator` component kind landed** (`engine/comparatorSpec.ts`):
    a real open-loop comparator with **explicit output high/low levels + optional
    hysteresis** instead of the gain-1e6 op-amp model that saturates to ~1e7 V.
    Value parses `5 0` / `Vhigh=5 Vlow=0 Vhyst=0.1` (positional or keyed, SI
    suffixes, aliases). The native deck emits a single **B-source using ngspice's
    ternary** `V=(V(in+)-V(in-))>0 ? vhigh : vlow` — LTspice's `if()` is rejected
    by ngspice outside compat mode (live-verified "no such function 'if'"), the
    ternary clamps correctly. Hysteresis uses the self-referential `V(out)`-state
    idiom (live-verified Schmitt switching in ngspice 17: flips high past +Vhyst,
    low past −Vhyst). New kind wired through types/catalog (palette)/pins (in+/
    in-/out, no supply pins so it can't mis-clamp like a floating-rail op-amp)/
    params (structured Output-high/low/hysteresis fields)/symbol (triangle + step
    glyph)/netlist. 16 tests (parse, ternary + hysteretic deck lines, deck
    integration). Nonlinear → native-engine only (correctly excluded from the
    linear TS solver set, like MOSFETs).
  - **NEXT:** import-map LTspice comparator symbols (`Comparators\\*`) to this
    kind; logic gates / `A` devices; UniversalOpAmp2 open-loop rail behavior
    (class-d's U1 — stays an op-amp since it's also used in feedback, see finding).
  - **Finding (2026-06-28):** class-d_starter.asc now *builds and runs* its `.tran`
    in ngspice 17 — the comparator U1 imports as the generic `opamp` and emits as
    a gain-1e6 VCVS (`E_U1 … 1e6`). But open-loop it **saturates to ~1e7 V** at
    `vpwm` instead of clamping to a logic/rail level, so the half-bridge gate
    drive is unphysical and won't match LTspice. The 1e6 gain is *correct* for
    feedback opamps (Sallen-Key, inv/non-inv amps all pass), so the fix is a real
    **comparator kind with defined output high/low levels** (or output `limit()`
    keyed to explicit rails) — NOT a blanket clamp on the shared opamp.
- 🟡 Transmission lines (T, LTRA, UR) — **ideal lossless line `T` landed
  end-to-end.** New `tline` component kind (4-terminal 2-port: port A `a1/a2`,
  port B `b1/b2`), value carries LTspice's `Td=<s> Z0=<Ω>`. `engine/tlineSpec.ts`
  parses the order-independent SI-suffixed value (robust fallback Z0=50/Td=1n on
  malformed input) and `buildSpiceDeck` emits `T<name> a1 a2 b1 b2 Z0=.. TD=..`
  (ngspice-46 verified — delayed step response on a matched 75 Ω line). Wired
  through types/catalog (Electromechanical palette)/pins/symbol (tapered
  two-conductor glyph). **Import**: LTspice `tline` → `tline` with the four
  `.asy` pins (SpiceOrder I1,R1,I2,R2) banked in `LTSPICE_PINS`, and a missing
  `SYMATTR Value` adopts the `.asy` default `Td=50n Z0=50`. Real-file proof:
  `examples/Educational/TransmissionLineInverter.asc` imports both T1 (default)
  and T2 (`Td=30n Z0=150`). **Native engine only** (the linear TS MNA solver has
  no delay-element stamp — correctly excluded). 15 tests. **NEXT:** lossy line
  (LTRA), `tline` UI param fields, TS-solver frequency-domain stamp.
- 🟡 Coupled inductors `K` — **directive passthrough landed** (`engine/
  couplingDirectives.ts`): a document's on-canvas `K` TEXT directives
  (`K1 L1 L2 1`, `K3 L1 L2 .95`, the all-windings `K1 L1 L2 L3 L4 1`, parameterized
  `Kcup1 L2 L3 {Kcup}`) now flow into the native deck verbatim with any `{expr}`
  coefficient resolved against the param scope — previously dropped, which made a
  coupled transformer simulate as independent inductors. Live-verified in ngspice
  17 (1mH:4mH, K=0.99 → 2× step-up). 8 tests. **TS-solver mutual-inductance stamp
  now landed** (`simulation/coupling.ts`): `parseCouplingSpecs` reads a document's
  `K` directives (multi-winding `K1 L1 L2 L3 1`, fractional/`{param}` coefficients)
  into specs, and `mutualTerms` turns them + the circuit's inductor set into
  pairwise M = k·√(La·Lb) terms (|k| clamped to 1; all C(N,2) pairs per line;
  first-wins dedupe). Both interim solvers stamp them: **acSweep** adds the −jωM
  cross term to each coupled inductor branch row, **linearTransient** adds the
  backward-Euler (M/h) companion cross term + history RHS. `App.tsx` memoizes the
  specs (`couplings`) off the directives and threads them into both TS run sites.
  End-to-end proof (`transformerCoupling.test.ts`): an ideal 1mH:4mH open-circuit
  transformer steps a 1 V primary to **2 V** secondary (=√(L2/L1)) in both AC
  (+6.02 dB, frequency-independent) and transient (V(out)=2·V(in) every step),
  k=0.5 scales it to 0 dB, and an uncoupled pair leaves the secondary dead.
  15 + 5 hand-computed tests. **NEXT:** a placeable K symbol/UI (still must
  hand-edit the directive).
- ⬜ Special functions: TRIANGLE/PWM generators, schmitt, etc.
- 🟡 **Model/library import** (`.model`, `.lib`, `.inc`, `.subckt`) — LTspice ships 2,038 `.lib` + 2,469 `.sub`.
  **Passthrough to native ngspice landed** (`engine/modelDirectives.ts`):
  `modelLibLinesFromDirectives` extracts a document's `.model`/`.lib`/`.inc`
  (→`.include`)/`.subckt`…`.ends` directives, expands LTspice multi-line TEXT
  blocks on the literal `\n` escape, normalizes the opening keyword, and skips
  analysis/param/option directives. `buildSpiceDeck` emits them so an imported
  `.asc` simulates against its real device models instead of the generic `TAU_*`
  starters (live-verified: `.model MyDiode D(...)` is picked up by ngspice 17).
  11 unit tests + a deck-integration test. **Model-name mapping landed:**
  `definedModelNames` collects the document's `.model`/`.subckt` names and the
  deck builder emits a semiconductor's own `SYMATTR Value` model name on its
  device line *when that model is defined* (else the generic `TAU_*`), so it
  never introduces an undefined-model error. **NEXT:** resolve `.lib`/`.inc`
  *file paths* (read & inline, or hand to ngspice); browser TS-solver model
  parsing.

## 4. Analyses (simulation commands)
- ✅ `.op` Operating point — TS + native — `operatingPoint.ts`
- ✅ `.tran` Transient — TS + native — `linearTransient.ts`
- ✅ `.ac` AC sweep (Bode) — TS + native — `acSweep.ts`
- 🟡 `.dc` **DC sweep** (source sweep, nested) — used 37× by user — **solver +
  directive parser landed** (`simulation/dcSweep.ts`): `parseDcDirective(".dc V1
  start stop incr")` → `{source,start,stop,step}` (SI suffixes, leading `.`/`!`,
  ascending/descending), `runDcSweep` overrides the named source and re-solves
  the OP per step, returning a per-net voltage series. Reuses `runOperatingPoint`
  (no duplicated stamping); guards zero/oversized increments. Hand-computed
  divider test (V(mid)=Vsweep/2), 9 tests. **UI dispatch + plot pane + import
  mapping landed:** a **DC** tab in `SimulationPanel` runs `runDcSweep` and a new
  linear-axis `DcPlot` (mirrors `AcPlot`; X = swept source value, Y = node volts,
  ground dropped); `App.runDcAnalysis` sources the sweep spec from the document's
  own `.dc` directive via `analysesFromDirectives` (so an imported `.asc` sweeps
  as authored) and shows a clear prompt when none is present. Native ngspice deck
  now emits `.dc <src> <start> <stop> <inc>` (stop-directed sign) —
  `buildSpiceDeck` `kind:"dc"`, live-validated in ngspice 17 (1:1 divider →
  V(mid)=Vsweep/2). **Nested 2nd-source sweep now landed** (`.dc V1 … V2 …`):
  `parseDcDirective` reads the second leg (SPICE inner-source-first order),
  `runDcSweep` re-runs the inner sweep once per outer value and returns the
  result as a fan of curves (one annotated net trace per outer value, shared
  inner X axis — how LTspice draws nested DC); `DcPlot` renders the fan via a
  `ground` flag on each net. Native deck appends `<src2> <start2> <stop2>
  <inc2>` to the `.dc` line. Hand-computed summing-node test (V(out)=(V1+V2)/2)
  **matches ngspice 17 exactly** (9-row fan). **NEXT:** native (FFI) DC runner
  for nonlinear sweeps; manual source/range picker for hand-built circuits.
- ✅ `.noise` **Noise analysis** — used 13× — **solver + parser + UI landed**
  (`simulation/noise.ts`): `parseNoiseDirective(".noise V(out) V1 dec 10 1 1Meg")`
  → `{output, source, sweep}` (`V(node)`/`V(a,b)` output, independent-source input,
  `dec`/`oct`/`lin` sweep). `runNoiseAnalysis` builds the complex AC MNA system and
  uses the **adjoint (transpose) method** — one extra solve per frequency yields
  the transimpedance from every internal noise source to the output port; resistor
  thermal noise (`4kT/R`) is summed to the output PSD and input-referred via the
  input→output gain. Returns onoise/inoise spectral densities + integrated totals.
  **Verified against textbook values**: 1k resistor → 4.07 nV/√Hz flat; RC low-pass
  output noise = 4kTR/(1+(ωRC)²); integrated kTC noise = √(kT/C). 16 hand-computed
  tests. `analysesFromDirectives` maps an imported `.asc`'s own `.noise`; a **NOISE**
  tab in `SimulationPanel` (`NoisePlot`) draws output-referred density on a log–log
  axis with integrated totals. **NEXT:** device (non-resistor) noise needs the
  native ngspice engine; `.meas noise` domain.
- ✅ `.tf` **Transfer function** (small-signal DC gain, Zin/Zout) — **solver +
  parser + UI landed** (`simulation/transferFunction.ts`): `parseTfDirective`
  reads `V(node)`/`V(a,b)`/`I(dev)` outputs + an independent source; `runTransferFunction`
  computes gain, input impedance and output impedance by perturbation around
  `runOperatingPoint` (no duplicated stamping — additive `OpOptions` add
  test-current injection + branch-current return to the OP solver). Handles
  voltage and current inputs. `analysesFromDirectives` maps an imported `.asc`'s
  own `.tf`; a **TF** tab in `SimulationPanel` shows gain/Zin/Zout.
  **12 hand-computed tests, cross-checked against ngspice 17** (1k:1k divider →
  gain 0.5, Zin 2k, Zout 500 — exact match). **NEXT:** native/nonlinear path
  (linearized around the bias point) once the OP solver gains nonlinear devices.
- 🟡 `.step` **Parametric sweep** (param/source/temp, nested, list) — used 34×; huge for real work.
  **Parser + param-runner landed** (`simulation/paramStep.ts`): `parseStepDirective`
  enumerates every LTspice form — linear `start stop incr`, `dec`/`oct` log
  (N points/decade|octave), explicit `list`, and `param`/`source`/`temp` kinds —
  up front into `StepSpec.values`. `runParamStep` injects each swept value into a
  copy of the `ParamScope` (`withStepValue`) and re-runs a caller-supplied
  analysis closure, yielding a labelled family of results; reuses the existing
  `.op`/`.tran`/`.ac` solvers (proven against the divider solver). `stepFromDirectives`
  picks an imported circuit's first `.step`. 25 tests, hand-computed.
  **UI dispatch + family-of-curves overlay landed** (`simulation/stepFamily.ts`):
  `stepContexts(spec, params, components)` expands a spec into one concrete run
  context per swept value — **param** injects into a scope copy (`withStepValue`),
  **source** overrides the matched component's `value` (case-insensitive ref-des),
  **temp** throws a clear message — capped at `MAX_FAMILY_MEMBERS` (16).
  `App.runStepAnalysis` re-runs the transient (native or TS) once per context and
  stores a `StepFamilyResult`; a **STEP** tab in `SimulationPanel` overlays the
  probed signal across the family in a trace-variable color ramp (`StepPlot`, §6).
  10 hand-computed tests incl. a source sweep that tracks a 1:1 divider's
  half-supply through the real OP solver. **Temp run path landed** (`simulation/
  temperature.ts`): `.step temp` no longer throws — each swept temperature
  rescales every inline-`tc=tc1[,tc2]` resistor per LTspice's law
  `R(T)=R0(1+tc1·ΔT+tc2·ΔT²)` (`applyTemperature`), `stepContexts` carries
  `context.temperature`, the TS solver strips `tc=` when parsing R, and the
  native step path forwards the value as `.temp` so device models shift too.
  24 tests (14 temperature + updated stepFamily temp family). **Nested `.step`
  landed** (`nestedStepContexts` + `runnableStepsFromDirectives`): two-or-more
  `.step` directives now form LTspice's outer×inner Cartesian product (first
  directive = outermost loop), composing every axis's transform (param inject /
  source override / temp rescale) onto each member, joining labels with `", "`,
  merging the innermost temperature, and capping the product at 16. `App` drives
  it for any 1..N runnable specs. 7 more hand-computed tests.
  **AC/DC-domain step families now landed (engine)** (`simulation/stepAnalysisFamily.ts`):
  a generic `runStepFamily<R>(specs, params, components, run, resultOk,
  resultWarnings)` re-runs *any* synchronous solver once per nested-`.step`
  context (reusing `nestedStepContexts`), collecting a labelled `AnalysisFamily<R>`
  — no-spec / expansion-error paths surface a clear `ok:false` message. Thin
  `runAcStepFamily` (family of Bode sweeps) + `runDcStepFamily` (family of DC
  transfer curves) wrappers drive the TS `runAcSweep`/`runDcSweep`. 9 hand-computed
  tests: an RC low-pass whose stepped R shifts the −3 dB corner (≥4 dB extra
  attenuation for 2× R), and a divider whose stepped top resistor tracks the ratio
  (Rt=1k→½·Vsweep, Rt=3k→¼·Vsweep). **NEXT:** wire a domain selector into the STEP
  tab (currently transient-only in the UI); per-trace pick in the overlay legend.
- ✅ `.four` **Fourier analysis** — **parser + solver + UI landed** (`simulation/fourier.ts`):
  `parseFourDirective(".four 1k [Nharm] [Nperiods] V(out) …")` → `{freq, harmonics,
  outputs}` (leading `.`/`!` tolerated, bare-integer Nharmonics/Nperiods consumed,
  SI-suffixed freq). `computeFourier` extracts DC + fundamental + harmonics over the
  **last period** by direct trapezoidal integration of the Fourier coefficients
  (no resampling error), reporting per-harmonic magnitude/phase/normalized + THD.
  `runFourier` resolves `V(node)`/bare-node/`I(ref)` outputs against the transient
  `MeasWaveform` and analyzes each. `analysesFromDirectives` now surfaces an
  imported circuit's `.four`. 15 hand-computed tests (pure DC/sine/cosine,
  DC+sine separation, fundamental+½ 2nd-harmonic THD=50%, multi-period
  last-period selection, signal resolution). `App.tsx` memoizes `runFourier` off
  the transient result; a **`FourierTable`** under the transient scope shows each
  output's THD + DC/fundamental/harmonic magnitudes (normalized to the fundamental).
  **NEXT:** native ngspice `.four` path for nonlinear distortion.
- 🟡 `.temp` **temperature set** — used 4× — `parseTempDirective` (°C, leading
  `.`/`!` + SI/negative tolerated, first value) in `io/directiveAnalysis.ts`;
  surfaced on `DirectiveAnalyses.temp`. `buildSpiceDeck` emits `.temp <°C>` from
  the document directives so **native ngspice** runs its temperature-dependent
  device models at the authored temperature (live-verified: `.temp 100` shifts a
  diode drop). 6 tests. **TS-solver resistor temperature coefficients landed**
  (`simulation/temperature.ts`) and the **`.step temp` sweep family now runs**
  (no longer throws) — see the `.step` item above. **NEXT:** TS-solver
  device-model (diode/BJT) temperature physics for the interim engine.
- 🟡 `.meas` **Measurements** (extract gain, BW, rise time, etc.) — used 61× —
  **transient engine + UI landed** (`simulation/measure.ts`): `parseMeasDirective`
  handles `MAX/MIN/PP/AVG/RMS/INTEG` aggregates over `FROM/TO`, `PARAM` expressions,
  `FIND <expr> AT=/WHEN`, `WHEN` crossing-time, and `TRIG/TARG` timing
  (`RISE/FALL/CROSS`, occurrence, `TD`). `runMeasurements` chains results by name
  through a scope seeded with `.param`/`.func`, matching deadtime.asc exactly;
  signals (`V(node)`, `V(a,b)`) resolve against trace ids/labels via the
  expression engine. `App.tsx` memoizes them off the transient result and renders
  a `MeasTable` in `SimulationPanel`. **AC-domain `.meas` now landed**
  (`simulation/measureAc.ts`): the measure core was generalized to an
  axis-agnostic `evaluateOnAxis` (time *or* frequency) and an AC compiler resolves
  `db()/mag()/ph()/re()/im()` (bare `V` ⇒ magnitude) and `V(a,b)` complex
  differences from the AcTrace dB/phase, so `FIND db(V(out)) AT=1k`,
  `WHEN mag(V(out))=0.707` (−3 dB corner), `MAX MAG(V(out))`, and `TRIG/TARG`
  bandwidth resolve over frequency. `runAcMeasurements` consumes only `.meas ac`
  directives and chains them by name; `App.tsx` memoizes them off the AC result
  and renders a second `MeasTable` under the Bode plot. Crossing thresholds are
  now **scope-evaluated expressions** (`=GAIN/sqrt(2)`, `=(vout_3db)`) instead of
  parse-time literals — fixing a latent throw on real decks — and the `freq`/`time`
  independent variable is exposed (`FIND freq WHEN …`). 44 hand-computed tests,
  incl. the AD4080/AFE bandwidth-chain forms from the user's own circuits.
  **`I(...)` branch-current signals now resolve** — the transient solvers expose
  per-device current waveforms (`simulation/currents.ts` `CurrentTrace`): the TS
  MNA solver emits voltage-source/inductor currents straight from the solution
  vector and R/C/I currents derived from node voltages; native ngspice pulls
  source currents from its `<ref>#branch` vectors (live-confirmed: a 10 V/1k:1k
  divider gives `v1#branch = -5 mA = I(V1)`) and derives R/C currents the same
  way (`deriveRcCurrents`). `measure.ts` `makeGetter` resolves `I(ref)` against
  these, so deadtime.asc's `PS avg -(10*I(V1)+10*I(V2))` / `PL avg V(vo)*I(R1)` /
  `Efficiency=PL/PS` evaluate. 13 hand-computed tests (I(R)=V/R, I(V1)=−5 mA,
  I(C)=C·dV/dt=I(R) in series, power forms).
  **`.meas dc` now landed** (`simulation/measureDc.ts`): a DC-sweep result is the
  same real-valued shape as a transient one with the **swept-source value as the
  axis**, so `runDcMeasurements` adapts a `DcSweepResult` into a `MeasWaveform`
  (`dcResultToWaveform`) and reuses the transient measurement core — `MAX/MIN/PP/
  AVG/RMS/INTEG`, `FIND V(out) AT=<Vsrc>`, `WHEN V(out)=<level>` (returns the
  source value at the crossing) and chained `PARAM`s all evaluate over the sweep.
  `runMeasurements` no longer mis-routes `dc` lines onto the time axis (it now
  takes only `tran`/untyped); `App.tsx` memoizes `dcMeasurements` off the DC
  result and renders a `MeasTable` under the DC plot. 8 hand-computed tests
  (divider V(out)=Vin/2). **`.meas noise` now landed too**
  (`simulation/measureNoise.ts`): a NoiseResult is adapted into a MeasWaveform
  over frequency with `onoise`/`inoise` traces, so `MAX/MIN V(onoise)`,
  `FIND V(onoise) AT=1k`, `WHEN V(onoise)=10n` and `V(inoise)` resolve; `App.tsx`
  memoizes `noiseMeasurements` and renders a `MeasTable` under the noise plot.
  7 hand-computed tests. All four spectral/sweep `.meas` domains
  (tran/ac/dc/noise) now run. **NEXT:** expose currents in the waveform viewer
  (probe a device → plot its current, §6).
- ✅ **DC operating point annotation on schematic** (show node V / device I
  in-place, 2026-07-02) — after an OP run, the simulator-mode canvas labels
  every non-ground net with its DC voltage (cyan, at the net's
  topmost-leftmost point) and every V-source/inductor with its MNA branch
  current (amber, centered under the body). Pure resolver
  `simulation/opAnnotations.ts` (5 tests on a real divider run: V(out)=Vin/2
  at the hand-computed anchor, I(V1)=−5 mA, ground skipped, stale/failed/null
  inputs degrade to []); `runOperatingAnalysis` now requests `returnBranches`
  from the JS solver (native ngspice path annotates voltages only). Labels
  use a background stroke for readability over wires. Live-verified via
  Playwright on the divider example: 10 V / 5 V / −5 mA all placed correctly.
- 🟡 Initial conditions **`.ic` / `.nodeset`** — `buildSpiceDeck` carries both
  through to the native ngspice deck verbatim (re-prefixed, lower-cased keyword);
  when any `.ic` is present the `.tran` line gains **`uic`** so the values hold at
  t=0 (LTspice semantics) rather than only biasing the OP. Live-verified in ngspice
  17 (`.ic v(cap)=2` → cap starts at 2 V). 2 deck tests. **`C`/`L` per-instance
  `IC=` attribute now landed** (`engine/icSpec.ts`; deck emits `IC=` + `uic`;
  importer reads it from `SpiceLine2` etc. — see §3 passives). **TS-solver IC
  support landed** too (seeds the companion-model state — see §3 passives).
- ✅ `.options` **passthrough** (reltol, etc.) — used 7× — `engine/spiceOptions.ts`:
  `parseOptionsDirectives` collects every `.options`/`.option` key=val + bare flag
  (lower-cased keys, later lines win, leading `.`/`!` + comma separators tolerated),
  `mergeOptionsLine` overlays them on Tau's defaults (gmin/reltol/abstol/vntol;
  document wins, deterministic order). `buildSpiceDeck` emits the merged line and
  `App.tsx` threads the document `directives` into all three native run sites
  (tran/op/ac). Live-verified: ngspice tolerates LTspice-only keys (plotwinsize,
  numdgt, maxstep) without error and an overridden reltol still solves
  V(out)=2.5 V. 10 hand-computed tests (parse/merge/override/deck emission).

## 5. Expressions & parameters
- ✅ `.param` parameter definitions — used 180× (critical) — `buildParamScope`
  (multi-assignment lines, inter-param refs in any order via fixpoint,
  cycle/undefined detection; **now expands LTspice multi-line `\n` TEXT blocks
  and strips inline `;` comments** via `expandDirectiveLines` — real circuits
  pack a whole param block into one TEXT entry, e.g. Cohn.asc) + `resolveComponentValues` threaded into **all four
  solve paths** (`linearTransient`/`operatingPoint`/`acSweep`/`spiceNetlist`).
  End-to-end proof in `paramIntegration.test.ts`: a `{Vsrc}/{Rtop}/{Rbot}`
  divider solves to the hand-computed 9 V. **§1(d-param) done:** `directives` now
  live on the document and `App.tsx` builds the scope (`buildParamScope`) and
  passes `params` to every run site, so an imported `.asc` resolves its params.
- ✅ `.func` user functions — used 13× — `parseFuncDirective` + call binding in
  `simulation/expr.ts` (args bound into a child scope; nested funcs resolve)
- ✅ `{expression}` evaluation in any value field (the LTspice braces syntax) —
  `substituteBraces()` replaces every `{…}` in a value (incl. compound source
  specs like `PULSE(0 {Vhi} …)`) with its evaluated literal before extraction,
  exactly as LTspice does
- ✅ Built-in functions (sin, sqrt, if, limit, table, pwr/pwrs, min/max, floor…) +
  constants (pi, e) — `simulation/expr.ts` `FUNCS`/`CONSTS`; SI-suffixed literals
  (1k/2.2meg/10n/1mil), comparison/logical/ternary, `^`/`**` power semantics.
  **Added the remaining LTspice built-ins:** inverse hyperbolics
  `asinh/acosh/atanh`, `arcsin/arccos/arctan` aliases, `nint`, `db` (20·log10|x|),
  and the boolean helpers `and/or/not/xor` (0.5-thresholded like `buf`/`inv`).
  Constants now include LTspice's spelled-out aliases `boltz`/`echarge`/`planck`/
  `kelvin` alongside `pi`/`e`/`k`/`q`.
- ✅ `.step param x list/range` driving the above — `simulation/paramStep.ts`
  `runParamStep` binds each swept value into the `ParamScope` (`withStepValue`)
  so `{...}` component values re-resolve per step; **`buildParamScope` now also
  seeds each `.step param` variable with its first value** so a default
  (non-stepped) run / preview deck resolves `{X}` for circuits whose only
  definition of `X` is the `.step` line (real cases: Howland, notch, dimmer,
  passive, varactor); list + linear + `dec`/`oct`
  log ranges all enumerate to concrete values. Engine support complete and tested
  end-to-end through `runOperatingPoint`; UI dispatch/overlay tracked in §4/§6.

## 6. Waveform viewer (the LTspice plot window)
- 🟡 Transient scope — `SimulationPanel.tsx` (downsamples large native results ✅)
- 🟡 Bode (AC mag/phase) — **magnitude + phase now both plotted** (`AcPlot`): a
  second log-frequency sub-plot draws each trace's `phaseDeg` on a 45°-snapped
  degrees axis below the dB magnitude, matching LTspice's dual Bode. Shared
  `bodeValuePath` (generalized from `bodePath`) maps any value vs. log-f.
- 🟡 OP results table — present
- ✅ **Click a node/wire on the schematic to add its trace** (LTspice
  probe-in-place, 2026-07-02): in simulator mode the canvas is read-only, so a
  plain wire click toggles a probe at the snapped point (crosshair cursor +
  hover highlight advertise it; status-bar hint updated) and the scope plots
  that net — LTspice's plot-open→click-wire→trace. Underneath, new
  `netAtPoint` (`schematic/netlist.ts`, 5 tests) resolves a probe to its net
  when the point lies **anywhere on a wire segment**, fixing the latent bug
  where a mid-segment probe (no DSU point of its own) silently failed to plot;
  all three resolution sites (scope trace list, WaveformPlot, step-family
  picker) now share it. **Component-body current probe landed too**
  (LTspice clamp-meter, 2026-07-02): in simulator mode clicking a part toggles
  `I(ref)` on the scope — `Probe.componentId` marks a clamp probe, store
  `toggleCurrentProbe` (5 tests), `simulation/currentProbe.ts` resolves
  id→ref→`result.currents` with the probe's color + unit A (7 tests incl. a
  physics check: I(R1) t=0 ≈ 5 mA in the RC example), dashed-ring marker
  follows the component, status-bar hint advertises both gestures.
  Live-verified via Playwright: click V1 → scope shows only I(V1) (−5.3 mA→0
  charging decay), second click restores the default traces.
- 🟡 **Plot arbitrary expressions** (`V(a)-V(b)`, `I(R1)*V(out)`, power `V(out)*I(out)`)
  — **landed** (`simulation/plotExpression.ts`): an expression bar under the
  transient scope evaluates any expression of the simulated signals at every
  time point and overlays it as a derived trace. Reuses the `.meas` expression
  compiler (`compileExpr`, now exported) so `V(out)-V(in)`, `2*V(in)+1` and
  instantaneous power `V(out)*I(R1)` all resolve against node-voltage traces +
  branch-current waveforms — one evaluator shared with measurements. Bad signal
  names surface a clear error; added/removed via labelled chips. 6 hand-computed
  tests. **Per-trace axis/unit now landed** (`simulation/exprUnit.ts`,
  16 tests): a plotted expression is labelled by its physical dimension — `I(R1)`
  → A, `V(out)*I(R1)` → W, `V/I` → Ω — and the scope value axis shows the traces'
  shared unit (`commonTraceUnit`) instead of always "V".
  **AC-pane expression traces now landed (engine)** (`simulation/plotExpressionAc.ts`):
  `evaluateAcPlotExpression` reuses the `.meas ac` compiler (`compileAcExpr`, now
  exported) so a Bode expression — a transfer `db(V(out))-db(V(in))`, `mag(V(a,b))`,
  or a raw ratio — evaluates at every swept frequency into an overlay `AcTrace`
  (value carried on `magDb`, plotted as written à la LTspice; flat phase). 6
  hand-computed tests: `db(V(out))` exactly reproduces the output trace's dB,
  `db(V(out))-db(V(in))` is a self-consistent 0 dB→rolloff transfer, empty / no-run
  / unknown-signal / scope-scalar paths.
  **DC-pane expression traces now landed (engine)** too (`simulation/plotExpressionDc.ts`):
  `evaluateDcPlotExpression` adapts a DC sweep into the `.meas` waveform
  (`dcResultToWaveform`) and reuses the transient `compileExpr`, so an expression
  of the swept node voltages (`V(out)-V(in)`, `V(a)/V(b)`, a scaled term)
  evaluates per sweep point into an overlay `DcSweepNet`. 5 hand-computed tests
  (divider: Vtop−Vmid = Vsweep/2; scaled Vmid·2 = Vsweep; empty / no-run /
  unknown-signal). **AC/DC expression bars now wired into the UI**
  (`SimulationPanel.tsx`): the Bode and DC panes each carry the same expression
  bar as the transient scope — add/remove labelled chips, error surfaced inline,
  overlays drawn on the shared magnitude/voltage axis and listed in the legend.
  **NEXT:** expression traces in the step pane; dual axis for mixed V+A.
- 🟡 Multiple plot panes, add/remove traces, autorange — **landed for the
  transient scope** (`plotPanes.ts` pure pane model + per-pane Y autorange,
  add/remove pane, per-trace pane selector in the legend; 27 tests). Still ⬜:
  AC/DC panes, manual axis limits.
- ✅ **Measurement cursors** (1 & 2, delta readout) — `simulation/cursors.ts`
  (`cursorReadout`/`fractionToX`, 8 unit tests) + a collapsible **Cursors** panel
  on the transient scope (`SimulationPanel` `CursorView`). Two sliders position
  cursors along the run; a meter row shows t1/t2/Δt/(1/Δt) and a table lists each
  signal's value at C1, C2, and the delta. Reuses the tested `interpolateAt`
  resampler so readings are interpolated between samples.
- ✅ **Overlay an LTspice `.raw` reference on the scope** (the acceptance-test
  overlay) — **Ref .raw** button loads a `.raw`, `buildReferenceOverlay`
  (`simulation/rawOverlay.ts`, 4 tests) matches its variables to the plotted Tau
  traces by name, resamples onto Tau's grid, draws them dashed
  (`.scope-trace.ref`), and shows a per-signal **% RMS + pass/✗** verdict from
  `compareWaveforms`. Lets the user confirm Tau matches LTspice at a glance.
- ✅ **FFT of a waveform** (LTspice "View → FFT") — **landed** (`simulation/fft.ts`):
  an in-place radix-2 Cooley–Tukey FFT (`fftRadix2`), window functions
  (`rectangular`/`hann`/`hamming`/`blackman`), and `waveformSpectrum` which
  linear-resamples a transient signal onto a power-of-two uniform grid over the
  time window, windows it, transforms, and returns the **one-sided amplitude
  spectrum** scaled so a pure `A·cos(ωt)` reads amplitude `A` at its bin (DC and
  Nyquist carry no doubling). `runWaveformFft` resolves `V(node)`/bare-node/
  `I(ref)` against the transient `MeasWaveform`; `dominantFrequency` reports the
  loudest tone above DC. 19 hand-computed tests (DC→bin 0, exact-bin sine→true
  amplitude, 4-point DFT of `[1,2,3,4]`, dB conversion, window coefficients). A
  collapsible **FFT spectrum** view under the transient scope
  (`SimulationPanel` `FftView`) picks a signal + window and draws the magnitude
  on a log-frequency / dB axis (shares `bodePath` with the Bode plot) with a peak
  frequency / **THD** / DC readout. `spectrumThd(spectrum, [f0])` reads THD from
  the spectrum (fundamental = supplied freq or loudest bin above DC; harmonics =
  bins nearest `2f₀,3f₀,…` to Nyquist; exact for a leakage-free signal — 50% for
  a half-amplitude 2nd harmonic, hand-verified). **FFT measurement cursors
  landed** (2026-07-02): a `cursors` toggle in the FFT bar shows two
  log-frequency cursors (sliders move in decades via `logFractionToX`, 3 tests)
  with dashed lines on the plot and an f1/f2/dB@each/ΔdB readout plus the
  **dB/decade slope** between them (`dbPerDecade`, 2 tests — reads −20 dB/dec
  off a synthetic 1-pole rolloff exactly). Fixed en route: `resolveSignal` (in
  both `fft.ts` and `fourier.ts`) only matched a `V(x)` output against the net
  id or the full label, so display labels like `V(R1·C1)` — exactly what the
  FFT signal picker feeds back — never resolved and the FFT pane showed "No
  spectrum" for every named net; it now also matches the label's inner name
  (2 regression tests). Live-verified: RC example FFT renders, cursors read
  271 Hz→13.1 kHz, Δ −105.8 dB, −62.7 dB/dec.
- 🟡 Log/linear axes, dB, phase, **group delay** — **group delay landed**
  (`simulation/groupDelay.ts`, 12 tests): pure `groupDelay(freqs, phaseDeg)`
  computes τ = −dφ/dω in seconds — phase is **unwrapped** first (`unwrapPhaseDeg`
  removes ±360° cliffs so a response that sweeps past ±180° doesn't spike), then
  central-differenced (one-sided at the ends) with the degrees→Hz conversion
  τ = −dφ_deg/(360·df). Hand-verified: a linear-phase pure delay gives constant τ,
  flat phase gives 0, and an unwrapped ±180 crossing stays smooth. The AC pane's
  meter row now shows the primary trace's **peak group delay**. Still ⬜:
  log/linear axis toggle, standalone phase pane, group-delay trace overlay.
- 🟡 **Loop-stability margins** (LTspice Bode readouts) — **landed**
  (`simulation/stability.ts`, 10 tests): `stabilityMargins(freqs, magDb, phaseDeg)`
  returns **phase margin** (180°+φ at the 0 dB gain crossover) and **gain margin**
  (−gain at the −180° phase crossover), each with its crossover frequency,
  interpolating the crossing in dB/degrees vs. **log-frequency** so it doesn't
  snap to a swept point; `null` when the loop never crosses. The AC meter row now
  shows **PM** and **GM** (red when negative = unstable). Hand-verified incl. a
  geometric-mean log-space crossover and a negative-PM unstable case.
- 🟡 `.step` family-of-curves overlay — **transient + AC + DC families landed**.
  Transient: `StepPlot` in `SimulationPanel` (the **STEP** tab re-runs the sweep
  and draws the probed signal across all members in a color ramp; legend lists
  each `name=value`). AC/DC: `simulation/stepAnalysisFamily.ts` re-runs the TS
  `.ac`/`.dc` solvers per swept value (`runAcStepFamily`/`runDcStepFamily`,
  generic `runStepFamily` core, nested products) and `acFamilyOverlaySeries`/
  `dcFamilyOverlaySeries` pick the step-responsive signal; `AcFamilyPlot`/
  `DcFamilyPlot` draw the family under the Bode/DC panes with a `name=value`
  legend, autoranged axes, and per-member error surfacing. 11 tests with
  hand-computed RC-corner / divider-ratio values.
  Pending: per-trace selection, cursor readout.
- 🟡 Save plot settings (`.plt`), export image/CSV — **CSV export landed**
  (`simulation/waveformCsv.ts` `seriesToCsv`): an **Export CSV** button on the
  transient scope writes a table of `time` + every node-voltage trace + branch
  current + plotted expression, one row per timestep (RFC-4180 quoting,
  non-finite samples as gaps). **Export CSV buttons on the AC pane** (freq +
  per-trace mag(dB)/phase(°)), **DC pane** (swept source + each net voltage),
  and **noise pane** (freq + onoise V/√Hz + inoise) too, sharing a `downloadCsv`
  helper. 4 hand-computed tests. **NEXT:** `.plt`
  settings, PNG image export, step-family CSV (per-member time grids).
- ⬜ Right-click trace → math/operations

## 7. Engine & accuracy
- ✅ Native ngspice FFI (desktop) — `src-tauri/src/spice.rs`
- ✅ Interim TS MNA solver (linear) for browser/tests
- ✅ Source polarity matches SPICE convention; R/C/L value guards (resistors now
  allow a **negative (active) resistance** — SPICE-legal, e.g. Draft7's -1k — and
  reject only zero; C/L stay strictly positive)
- ✅ **SPICE suffix semantics on the engine/import path** (2026-07-02):
  `parseQuantity` now follows LTspice rules — suffixes case-insensitive,
  `m`/`M` both milli, only `meg` (any case) mega, `mil` = 25.4 µ, greek mu
  accepted, unit letters after the prefix ignored (`1MHz` = 1 milli-hertz,
  faithfully). `formatEngineering` emits `Meg` for 1e6 so formatted values
  re-parse correctly. The UI dropdown (`schematic/engineering.ts`) stores
  `Meg` for mega and maps any-case `M` to milli; values it can't represent
  (`1mil`) survive round-trip as raw text instead of being corrupted.
  Hand-computed tests cover the `1MHz` and `1F`-is-femto gotchas.
- ⬜ Match LTspice's defaults/timestep/convergence for waveform-level agreement
  - 🟡 **Numeric agreement tooling landed** (`simulation/waveformCompare.ts`):
    `compareWaveforms(testT,testV, refT,refV)` resamples a reference series
    (e.g. parsed from an LTspice `.raw`) onto the test's time grid over the
    overlapping interval and reports max/RMS abs error plus reference-normalized
    metrics and a pass/fail verdict — so "match LTspice within tolerance" is a
    number, not an eyeball. `interpolateAt`/`resampleOnto` exported for the
    `.raw` scope overlay. 10 unit tests. (Still ⬜: actually tuning ngspice
    defaults so the verdict passes across the deck suite.)
- 🟡 **Real-`.asc` op-deck *run* now ~70/82** (was 45/82 when first measured this
  session) — i.e. how many acceptance decks ngspice actually solves an operating
  point for, not just builds. Driven up by: a **default `rshunt=1e12`** (every node
  gets a DC path — 19 op-amp/AC-coupled circuits stopped throwing "singular
  matrix"); **`LPNP`/`LNPN` → `PNP`/`NPN`** (discrete LM741/LM308); splitting
  **multi-directive TEXT blocks** on `\n` so `.ic`/`.tran` don't collapse
  (Draft6); and **rewriting `K` coupling refs** to renamed inductor instances
  (Electrometer). The ~12 that still don't run are genuinely out of ngspice's
  reach here: 4 reference external `.sub` libraries not present on disk
  (opamp/capometer/TowTom2), PLL/PLL2 use LTspice's `rand()`, SoftDiodeRecovery a
  proprietary diode `Vp` param, UHFpreamp an unbundled `mrf901`, 2 ISO demos time
  out, plus two deep loop-probe/connectivity cases (LoopGain2, P2).
- 🟡 Ship/bundle a real device-model set — **common LTspice standard diodes/
  zeners/BJTs bundled** (`engine/standardModels.ts`, real `standard.*` params,
  emitted by `buildSpiceDeck` when referenced by name). Still generic for MOS and
  any unbundled part.
- 🟡 Convergence aids — a baseline `rshunt=1e12` ships in the default `.options`
  so floating-node circuits solve; gmin/source stepping not yet surfaced to user.
- ⬜ Per-analysis ngspice option mapping

## 8. UX / app
- ✅ IDE-style shell, multi-tab, command palette, settings, status bar engine indicator
- ⬜ **Visual QA on the actual desktop app** (currently blocked — dev port held; cannot screenshot headless)
- ⬜ Component picker matching LTspice (F2 part browser over the full library)
- 🟡 Keyboard shortcut parity — **Ctrl+R rotate, Ctrl+E mirror, Ctrl+C/V copy/paste,
  Ctrl+D duplicate now bound** (`App.tsx`), alongside existing Space=rotate, W=wire,
  hotkey placement, ⌘K palette. Still missing the LTspice function-key set (F2 part,
  F3 wire, F4 label, F5 delete, F6 copy, F7 move, F8 drag).
- ⬜ Help / model docs, error console with SPICE messages
- ⬜ Crash-free on large/real circuits (stack-overflow class fixed; keep stress-testing)

## 9. Packaging / distribution (to actually sell)
- ⬜ Bundle `libngspice` reliably (currently git-untracked; only `.gitkeep`)
- ⬜ macOS code signing + notarization; Windows/Linux builds
- ⬜ Auto-update, licensing/activation
- ⬜ Installer + onboarding

---

## Appendix: LTspice `.asc` format (for the importer)
Plain text, integer coords (LTspice grid). Key lines seen in `class-d_starter.asc`:
```
Version 4
SHEET 1 <w> <h>
WIRE x1 y1 x2 y2                  ; a wire segment between two grid points
FLAG x y <netname>               ; net label; "0" = ground
SYMBOL <type> x y <R0|R90|M0|…>  ; a placed symbol (rotation/mirror in the orient)
SYMATTR InstName R1              ; reference designator
SYMATTR Value 10k               ; primary value / model
SYMATTR Value2 ...              ; secondary (e.g. source spec)
SYMATTR SpiceModel / SpiceLine  ; extra SPICE attributes
WINDOW <id> x y <align> <size>  ; label placement (can ignore for v1)
TEXT x y <Left|…> <size> !<directive>   ; "!" = SPICE directive; ";" = comment
LINE/RECTANGLE/CIRCLE/ARC ...    ; drawing primitives
IOPIN x y <dir>                  ; hierarchy port
```
Symbols are separate `.asy` files (same SYMBOL/PIN/WINDOW grammar). The importer
should map LTspice symbol `type` → Tau `ComponentKind`, falling back to a generic
2/3/N-pin symbol driven by the `.asy` when no native kind matches.

---

_Last updated: 2026-06-22. Current state: 228 tests passing; native ngspice works;
schematic editor solid. Nothing in §1 (LTspice interop) started yet — **start there.**_
