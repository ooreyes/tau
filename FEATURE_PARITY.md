# Tau → LTspice Feature Parity

> **Living checklist.** Goal: Tau reaches functional parity with **LTspice 17.2.4**
> (the version installed at `/Applications/LTspice.app` on this machine).
> Update this file as items land — flip `⬜`/`🟡` to `✅` and add a one-line note
> with the commit or file path. Any LLM/human can pick up the next unchecked item.

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
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Worktree gotcha:** isolated agent worktrees branch from the OLD v0.1 scaffold.
  First run `git fetch origin && git merge --ff-only origin/<branch>` and confirm ~228 tests.

Status legend: ✅ done · 🟡 partial · ⬜ not started

---

## 1. File I/O & interoperability  ← **highest leverage for the key goal**
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
  - **NEXT:** map `.meas`/`.dc`/`.step` directives (need those analyses first —
    §4); render imported symbols at their LTspice geometry; bank `.asy` pins for
    opamps/pots/transformers (currently placed but flagged "no banked pins").
  - **Pin data banked:** `LTSPICE_PINS` + `transformLtPoint()` in `io/ascImport.ts`
    hold the real LTspice symbol-local pin offsets (from `lib/sym/*.asy`) and the
    orientation transform (clockwise, Y-down, mirror-aware).
- ⬜ **Import LTspice `.asy` symbols** (so library parts render) — 6,280 ship with LTspice.
- ⬜ Map LTspice `SYMATTR Value/Value2/SpiceModel/ModelFile` to Tau component values.
- ⬜ Export Tau schematic → `.asc` (round-trip).
- 🟡 Native SPICE netlist generation (`engine/spiceNetlist.ts`) — works for built-in kinds; needs the directive/model coverage below.
- ⬜ Export `.cir`/netlist to file; import `.cir`.
- ⬜ `.raw` waveform export/import (LTspice binary raw format).
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
  9 store tests. **Still ⬜: multi-select, drag-box select, group move.**
- ⬜ **Drag wires / move with rubber-banding** (move a part, wires follow)
- ⬜ Bus wires / bus taps
- ⬜ `.asc`-style `TEXT` SPICE directives placed on the canvas (free-text directive blocks)
- ⬜ `.asc`-style `TEXT` comments
- ⬜ Draw primitives (line/rect/circle/arc) on schematic
- ⬜ Hierarchical schematics (a schematic used as a symbol / `.subckt`)
- ⬜ Net highlighting (hover a net → highlight whole net)
- ⬜ Component attribute window/editor (full SPICE line editor per part)
- ⬜ Pin/port symbols (IOPIN) for hierarchy

## 3. Component / symbol library
Current Tau kinds (~25): R, C, L, pot, V(DC), I(DC), Vac, Iac, **Vpulse**, diode, LED,
zener, opamp, **VCVS (E)**, **VCCS (G)**, **CCCS (F)**, **CCVS (H)**, **B (behavioral)**, NMOS, PMOS, NPN, PNP, switch, transformer, testpoint, ground.
- 🟡 Passives R/C/L (✅) — add: parasitics (ESR/IC), behavioral R/C/L, **C/L initial conditions**
- 🟡 Sources — DC/AC/PULSE plus **inline LTspice transient functions on V/I sources now emit to the ngspice deck: SINE (offset/amp/freq/td/damping/phase), PULSE (full 7-arg, Ncycles trimmed), PWL, EXP, SFFM** (`engine/sourceFunction.ts`; µ/meg normalized). Still missing: PWL FILE, explicit AC spec on these, noise sources, TS-fallback solver support for the non-DC functions (**arbitrary behavioral B-source `V=…`/`I=…` now landed** — see the dedicated B item below)
- 🟡 Semiconductors — diode/BJT/MOS/zener present with **generic models only**. Need real model selection.
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
- ⬜ JFET, MESFET, IGBT
- ⬜ MOSFET level/VDMOS power models, body diode
- ⬜ Comparators / logic gates / digital (LTspice `A` devices) — **needed for class-d_starter.asc**
- ⬜ Transmission lines (T, LTRA, UR)
- ⬜ Coupled inductors `K` (have transformer; expose generic K)
- ⬜ Special functions: TRIANGLE/PWM generators, schmitt, etc.
- ⬜ **Model/library import** (`.model`, `.lib`, `.inc`, `.subckt`) — LTspice ships 2,038 `.lib` + 2,469 `.sub`

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
  V(mid)=Vsweep/2). **NEXT:** native (FFI) DC runner for nonlinear sweeps;
  manual source/range picker for hand-built circuits; nested 2nd-source sweep.
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
  half-supply through the real OP solver. **NEXT:** temp run path; nested steps;
  AC/DC-domain step families; per-trace pick in the overlay legend.
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
- ⬜ `.temp` temperature sweep / set — used 4×
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
  **NEXT:** `.meas dc`/`.meas noise` domains; expose currents in the waveform
  viewer (probe a device → plot its current, §6).
- ⬜ DC operating point annotation on schematic (show node V / device I in-place)
- ⬜ Initial conditions `.ic` / `.nodeset`
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
  cycle/undefined detection) + `resolveComponentValues` threaded into **all four
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
  (1k/2.2meg/10n/1mil), comparison/logical/ternary, `^`/`**` power semantics
- ✅ `.step param x list/range` driving the above — `simulation/paramStep.ts`
  `runParamStep` binds each swept value into the `ParamScope` (`withStepValue`)
  so `{...}` component values re-resolve per step; list + linear + `dec`/`oct`
  log ranges all enumerate to concrete values. Engine support complete and tested
  end-to-end through `runOperatingPoint`; UI dispatch/overlay tracked in §4/§6.

## 6. Waveform viewer (the LTspice plot window)
- 🟡 Transient scope — `SimulationPanel.tsx` (downsamples large native results ✅)
- 🟡 Bode (AC mag/phase) — present
- 🟡 OP results table — present
- ⬜ **Click a node/wire on the schematic to add its trace** (LTspice probe-in-place)
- ⬜ **Plot arbitrary expressions** (`V(a)-V(b)`, `I(R1)*V(out)`, power `V(out)*I(out)`)
- ⬜ Multiple plot panes, add/remove traces, autorange, manual axis
- ⬜ **Measurement cursors** (1 & 2, delta readout)
- ⬜ FFT of a waveform; THD readout
- ⬜ Log/linear axes, dB, phase, group delay
- 🟡 `.step` family-of-curves overlay — **transient overlay landed** (`StepPlot`
  in `SimulationPanel`): the **STEP** tab re-runs the sweep and draws the probed
  signal across all step members in a color ramp; legend lists each `name=value`.
  Pending: AC/DC-domain families, per-trace selection, cursor readout.
- ⬜ Save plot settings (`.plt`), export image/CSV
- ⬜ Right-click trace → math/operations

## 7. Engine & accuracy
- ✅ Native ngspice FFI (desktop) — `src-tauri/src/spice.rs`
- ✅ Interim TS MNA solver (linear) for browser/tests
- ✅ Source polarity matches SPICE convention; R/C/L value guards
- ⬜ Match LTspice's defaults/timestep/convergence for waveform-level agreement
- ⬜ Ship/bundle a real device-model set (currently generic; weak MOSFET Kp)
- ⬜ Convergence aids (gmin stepping, source stepping) surfaced to user
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
