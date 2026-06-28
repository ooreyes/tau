# Tau Autobuilder — Progress Log

## 2026-06-28T06:53Z — auto/ltspice-parity — .ic/.nodeset passthrough + uic (§4)

### What I did
- Added **`.ic` / `.nodeset` initial-condition passthrough** to the native deck.
  `icLinesFromDirectives` in `spiceNetlist.ts` collects both (re-prefixed leading
  dot, lower-cased keyword) and reports whether any `.ic` is present; the lines are
  emitted and `analysisLine` gains a `useInitialConditions` flag that appends
  **`uic`** to the `.tran` line so initial values hold at t=0 (LTspice semantics),
  not merely bias the OP.

### Files touched
- src/engine/spiceNetlist.ts (icLinesFromDirectives + uic on .tran)
- src/engine/spiceNetlist.test.ts (+2)
- FEATURE_PARITY.md (§4 .ic/.nodeset 🟡)

### Tests
588 passing (was 586; +2 new). Typecheck clean. Live-verified in ngspice 17:
`.ic v(cap)=2` + `.tran … uic` → cap starts at 2 V.

### FEATURE_PARITY items updated
- §4 **Initial conditions `.ic`/`.nodeset`** ⬜ → 🟡 (native deck path; TS IC next).

### UX issues found
- None new.

### Next step
§3 coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §6
probe-in-place / arbitrary-expression plots, or finish `.step temp` family.

## 2026-06-28T06:50Z — auto/ltspice-parity — .temp → native deck temperature (§4)

### What I did
- Added **`.temp` temperature set** (used 4×). `parseTempDirective` (°C; leading
  `.`/`!`, SI suffixes, negatives, first value of a list) in
  `io/directiveAnalysis.ts`, surfaced on `DirectiveAnalyses.temp`. `buildSpiceDeck`
  emits `.temp <°C>` from the document directives so **native ngspice** runs its
  temperature-dependent device models at the authored temperature. TS solver still
  ignores temperature (→ 🟡, not ✅).

### Files touched
- src/io/directiveAnalysis.ts (parseTempDirective + temp discovery)
- src/engine/spiceNetlist.ts (emit .temp from directives)
- src/io/directiveAnalysis.test.ts (+3), src/engine/spiceNetlist.test.ts (+1)
- FEATURE_PARITY.md (§4 .temp 🟡)

### Tests
586 passing (was 582; +4 new). Typecheck clean. Live-verified in ngspice 17:
`.temp 100` shifts a diode forward drop (V(out) 0.499 vs ~0.52 at 27 °C).

### FEATURE_PARITY items updated
- §4 **`.temp`** ⬜ → 🟡 (native deck path; TS coefficients + `.step temp` next).

### UX issues found
- None new.

### Next step
§3 coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §6
probe-in-place / arbitrary-expression plots, or finish `.step temp` family.

## 2026-06-28T06:46Z — auto/ltspice-parity — .options passthrough (§4)

### What I did
- Implemented **`.options` passthrough** (used 7× in the user's circuits). New
  `engine/spiceOptions.ts`: `parseOptionsDirectives` (collects `.options`/`.option`
  key=val + bare flags; lower-cased keys; later lines win; leading `.`/`!` + comma
  separators tolerated), `mergeOptionsLine` (overlays document options on Tau's
  gmin/reltol/abstol/vntol defaults — document wins, deterministic order),
  `optionsLineFromDirectives`. `buildSpiceDeck` now emits the merged line from
  `schematic.directives`; `App.tsx` threads document `directives` into all three
  native run sites (tran/op/ac, deps updated). Schematic type bag gained an
  optional `directives?: string[]` in both spiceNetlist + nativeSpice (existing
  callers unaffected).

### Files touched
- src/engine/spiceOptions.ts (new), spiceOptions.test.ts (new, 10)
- src/engine/spiceNetlist.ts (merged options line + directives field)
- src/engine/nativeSpice.ts (directives field), src/App.tsx (thread directives)
- src/engine/spiceNetlist.test.ts (+2 deck override tests)
- FEATURE_PARITY.md (§4 .options ✅)

### Tests
582 passing (was 572; +10 new). Typecheck clean. Live-verified in ngspice 17:
LTspice-only keys (plotwinsize/numdgt/maxstep) tolerated, overridden reltol still
solves V(out)=2.5 V on a 1:1 divider.

### FEATURE_PARITY items updated
- §4 **`.options` passthrough** ⬜ → ✅.

### UX issues found
- None new.

### Next step
§3 coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §6
probe-in-place / arbitrary-expression plots, or §4 `.temp`.

## 2026-06-28T06:42Z — auto/ltspice-parity — Fourier results table UI (§4/§6)

### What I did
- Surfaced `.four` results in the UI: `App.tsx` memoizes `runFourier` off the
  transient `analysis` + the document's `.four` directive; a new `FourierTable`
  under the transient scope (`SimulationPanel.tsx`) shows, per output, the THD
  header and DC/fundamental/harmonic magnitudes (each ≥1 normalized to the
  fundamental). Reuses the existing `.meas` table styling — no new CSS. `.four`
  flipped ⬜→🟡→✅ (TS solver + UI; native path the remaining NEXT).

### Files touched
- src/App.tsx (fourier memo + prop), src/components/SimulationPanel.tsx
  (prop + FourierTable component + render under transient MeasTable)
- FEATURE_PARITY.md (§4 .four ✅)

### Tests
572 passing (unchanged; UI is presentational, logic covered by fourier.test.ts).
Typecheck clean.

### FEATURE_PARITY items updated
- §4 **`.four` Fourier analysis** 🟡 → ✅.

### UX issues found
- Visual QA still headless-blocked (§8) — FourierTable not screenshot-verified,
  but it reuses the verified meas-table layout.

### Next step
§3 coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §4
`.temp`, or §6 probe-in-place / expression plots.

## 2026-06-28T06:38Z — auto/ltspice-parity — .four Fourier analysis (§4)

### What I did
- Added **`.four` Fourier analysis** (§4 missing analysis), engine layer.
  `simulation/fourier.ts`: `parseFourDirective` (freq + optional bare-integer
  `[Nharmonics] [Nperiods]` + output list; leading `.`/`!` tolerated; SI freq),
  `computeFourier` (DC + fundamental + harmonics over the **last period** via
  direct trapezoidal integration of `a_k`/`b_k` — no resample error — with
  per-harmonic magnitude/phase/normalized + THD; guards an ill-defined fundamental
  so pure DC reads 0% THD), and `runFourier` (resolves `V(node)`/bare/`I(ref)`
  against the transient `MeasWaveform`). Wired into `analysesFromDirectives` so an
  imported `.asc`'s `.four` is discovered.

### Files touched
- src/simulation/fourier.ts (new), src/simulation/fourier.test.ts (new, 14)
- src/io/directiveAnalysis.ts (four discovery), directiveAnalysis.test.ts (+1)
- FEATURE_PARITY.md (§4 .four 🟡)

### Tests
572 passing (was 557; +15 new). Typecheck clean. Coefficients hand-verified
(pure sine A=1 phase 90°, fundamental+½·2nd-harmonic → THD 50%).

### FEATURE_PARITY items updated
- §4 **`.four` Fourier analysis** ⬜ → 🟡 (engine landed; UI tab + native path next).

### UX issues found
- No FOUR results tab in the SimulationPanel yet (engine-only this session).

### Next step
Wire a FOUR tab/table into `SimulationPanel` (mirror MeasTable), or §4 `.temp`
sweep, or §3 coupled-inductor `K` / comparators (A devices for class-d_starter).

## 2026-06-28T06:32Z — auto/ltspice-parity — Copy/paste + duplicate (Ctrl+C/V/D) (§2)

### What I did
- Added **copy / paste / duplicate** for the single selection (§2). Store gains an
  ephemeral `clipboard: SchematicComponent | null`, `copySelected`, `paste`,
  `duplicateSelected`, and a `placeClone` helper that produces a clone with a fresh
  id, the next ref-des for its kind, and a 2-grid diagonal offset. **`pinOverride`
  positions are offset by the same delta** so imported, pin-accurate parts stay
  connected the same way after a copy. Paste/duplicate are undoable and select the
  new copy. Bound Ctrl/Cmd+C / +V / +D in `App.tsx`; StatusBar hint adds ⌘D.

### Files touched
- src/store/useSchematic.ts (clipboard + placeClone + 3 actions)
- src/App.tsx (Ctrl+C/V/D), src/components/StatusBar.tsx (hint)
- src/store/useSchematic.test.ts (+4)
- FEATURE_PARITY.md (§2 copy/paste 🟡; §8 keyboard line)

### Tests
557 passing (was 553; +4 new). Typecheck clean.

### FEATURE_PARITY items updated
- §2 **Copy/paste, duplicate** ⬜ → 🟡 (single selection; multi-select still ⬜).
- §8 keyboard parity note extended (Ctrl+C/V/D).

### UX issues found
- Multi-select / drag-box / group move still absent — copy acts on one part only.

### Next step
§2 **multi-select + drag-box select** (bigger Canvas-interaction change), or §3
coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §4
`.four`/`.temp`.

## 2026-06-28T06:30Z — auto/ltspice-parity — Mirror/flip components (Ctrl+E) (§2)

### What I did
- Implemented **mirror/flip** — the top remaining ⬜ in §2 schematic capture and a
  keyboard-parity gap (LTspice Ctrl+E). Added a `mirrored?: boolean` to
  `SchematicComponent` (horizontal flip across the vertical axis, applied **before**
  rotation to match LTspice `M*` orientations + the importer's `transformLtPoint`).
- **Connectivity:** new `transformPoint(point, rotation, mirrored)` in
  `schematic/pins.ts` (mirror x→-x, then rotate); `getComponentPins` uses it, so
  net extraction / netlist emission see the flipped pin positions. **Rendering:**
  `symbolTransform` in `Canvas.tsx` emits `rotate(R) scale(-1 1)` (SVG right-to-left
  = flip then rotate) for the symbol, pin-layer, and placement ghost.
- **Store:** `placeMirror` state + `mirror()` action — toggles the placement ghost
  in place mode, else toggles the selection's flag (undoable). `addComponent`
  stamps `mirrored: placeMirror`. `documentValidation` preserves the flag on
  load/save round-trips.
- **Keyboard:** Ctrl/Cmd+E → mirror, Ctrl/Cmd+R → rotate bound in `App.tsx`
  (Space=rotate kept). StatusBar hint updated.
- **Import fidelity:** `ascImport` now sets `mirrored: true` for `M*` orientations,
  so imported parts render flipped as in LTspice (pins were already correct via
  pinOverride).

### Files touched
- src/schematic/types.ts (mirrored flag)
- src/schematic/pins.ts (transformPoint + getComponentPins)
- src/schematic/documentValidation.ts (preserve mirrored)
- src/store/useSchematic.ts (placeMirror + mirror action + addComponent)
- src/components/Canvas.tsx (symbolTransform, ghost, ComponentView, selector)
- src/components/StatusBar.tsx (hint), src/App.tsx (Ctrl+E/Ctrl+R)
- src/io/ascImport.ts (M* → mirrored)
- tests: pins.test.ts (+5), useSchematic.test.ts (+3), ascImport.test.ts (+1)
- FEATURE_PARITY.md (§2 mirror ✅; §8 keyboard 🟡)

### Tests
553 passing (was 544; +9 new). Typecheck clean.

### FEATURE_PARITY items updated
- §2 **Mirror/flip components** ⬜ → ✅; §2 place/move/rotate/mirror line ✅.
- §8 keyboard parity ⬜ → 🟡 (Ctrl+R/Ctrl+E bound).

### UX issues found
- Function-key shortcuts (F2–F8) still unbound (§8). Multi-select/copy-paste still
  ⬜ — mirror only acts on the single selection.

### Next step
§2 next ⬜: **copy/paste + duplicate + multi-select** (drag-box select), or §3
**coupled inductors K** (small, testable) / comparators (A devices, needed for
class-d_starter.asc).


## 2026-06-28T01:05Z — auto/ltspice-parity — Behavioral B-source end-to-end (§3)

### What I did
- Added the **behavioral B-source** (`bsource` kind) — the top remaining ⬜ in
  §3, "used constantly in real LTspice circuits". 2-terminal output; value carries
  `V=<expr>`/`I=<expr>`. Full plumbing: type, pin geometry (p/n), diamond symbol +
  bounds/box, palette entry (hotkey `j`).
- **Native ngspice deck**: emits `B p n V=…`/`I=…` verbatim (brace-substituted;
  bare expr → `V=`). Live-verified in ngspice 17 (`V=2*V(in)+0.5` → 4.5 V;
  `I=1m*V(ctrl)` polarity confirmed and matched in the TS stamp).
- **Import**: LTspice `bv`/`bi`/`b`/`b2` → `bsource`; value flows through; pin
  geometry banked (bv≈voltage, bi≈current), matching GFT.asc wiring.
- **TS solver (linear subset)**: `simulation/behavioral.ts` `linearizeBehavioral`
  reduces an affine expression to `const + Σ coeff·V(node)` via symbolic
  perturbation + a multi-point linearity check (rejects products/powers/`time`/
  `I(...)`/unknown params). Stamped in `.op`/`.tran`/`.ac`: V-type as a
  multi-input VCVS (branch unknown + offset), I-type as transconductance
  (constant drops at AC). Nonlinear/dynamic forms raise a clear "needs native
  engine" error instead of mis-solving.

### Files touched
- src/schematic/types.ts, pins.ts, symbols.tsx, catalog.ts (new kind plumbing)
- src/engine/spiceNetlist.ts (deck emission + prefix)
- src/io/ascImport.ts (bv/bi mapping + pin keys)
- src/simulation/behavioral.ts (new: parse/normalize/linearize/term-resolve)
- src/simulation/{operatingPoint,linearTransient,acSweep}.ts (stamps + offsets)
- tests: behavioral.test.ts (15), behavioralSolver.test.ts (9),
  engine/spiceDeck.test.ts (+2), io/ascImport.test.ts (+2)
- FEATURE_PARITY.md (§3 B-source ✅; kinds list)

### Tests
544 passing (was 516 at run start; +28 new). Typecheck clean. Native deck
validated in ngspice 17.

### FEATURE_PARITY items updated
- §3 **Behavioral sources (B)** ⬜ → ✅. Kinds list + §3 Sources note updated.

### UX issues found
- B-source value editing uses the plain value field (free-text `V=…`); no
  structured editor or syntax highlighting yet. Imported B-source renders at
  Tau's diamond geometry (pins correct via override). Logged as UX debt.

### Next step
§3 next ⬜: **Comparators / logic gates (LTspice `A` devices)** — needed for
class-d_starter.asc — or generic coupled-inductor `K`. Alternatively §2
mirror/flip (Ctrl+E), the next schematic-capture gap.

## 2026-06-27T19:33Z — auto/ltspice-parity — CCCS (F) + CCVS (H) current-controlled sources (§3)

### What I did
- Completed the controlled-source family **E/F/G/H** by adding the two
  current-controlled kinds — **CCCS (F)** and **CCVS (H)** — the documented NEXT
  step from the VCVS/VCCS session. Linear, so the existing TS MNA solvers handle
  them exactly with hand-computable expected values.
- Modelled the control port (like LTspice's F/H symbols) as an **internal
  zero-volt sense branch** across `cp`/`cn`; its branch current is the controlling
  current I(cp→cn). **CCCS** adds 1 MNA unknown (sense current) and stamps output
  current `gain·I_sense` leaving `op`/entering `on`. **CCVS** adds 2 unknowns
  (sense + output branch) and constrains `V(op)−V(on)=r·I_sense`. Added the same
  stamps to all three TS solvers (`.op`/`.tran`/`.ac`, complex in AC).
- New component kinds `cccs`/`ccvs` (4-pin 2-ports, same geometry as VCVS/VCCS):
  filled every exhaustive `Record<ComponentKind,…>` — `pins.ts`, `SYMBOL_BODY`/
  `SYMBOL_BOX` + render cases (current-sense arrow on the left port; diamond +
  arrow for F, diamond + ± for H), `catalog.ts` palette (F hotkey `f`, H hotkey
  `n`), and the `spiceNetlist` prefix map (F/H).
- Native ngspice deck: each F/H emits a per-device `V_<ref>_sense cp cn 0` plus
  `F/H op on V_<ref>_sense k` (the only correct way ngspice senses a current).
- `ascImport`: LTspice `f/f2`→cccs, `h/h2`→ccvs.
- Transient solver now reports F/H branch currents as `I(ref)`.

### Files touched
- src/schematic/types.ts (cccs/ccvs kinds)
- src/schematic/pins.ts, src/schematic/symbols.tsx, src/schematic/catalog.ts
- src/engine/spiceNetlist.ts (prefix + F/H emission w/ internal sense source)
- src/io/ascImport.ts (f/h→cccs/ccvs)
- src/simulation/operatingPoint.ts, linearTransient.ts, acSweep.ts (MNA stamps)
- src/simulation/controlledSources.test.ts (+9), src/io/ascImport.test.ts (+1)
- FEATURE_PARITY.md (§3 E/F/G/H ✅)

### Tests
516 passing (was 506; +10 new). Typecheck clean. Sign conventions cross-checked
live against ngspice 17 on an equivalent deck: CCCS V(out)=−gain·I_sense·R=−10 V,
CCVS V(out)=r·I_sense=+2 V — both exact.

### FEATURE_PARITY items updated
- §3 E/F/G/H controlled sources: 🟡 → ✅ (CCCS + CCVS complete the family).
- §3 component-kinds header: ~23 → ~25 kinds.

### UX issues found
- None new. Like VCVS/VCCS, imported F/H symbols have no banked `.asy` pin
  geometry yet, so they're placed-but-flagged on import (tracked under §1).

### Next step
Tackle §3 **behavioral B-source** (`V=…`/`I=…`), used constantly in real LTspice
circuits — but it's nonlinear in general, so scope a linear/native split first;
or do §4 `.four` (Fourier) / `.temp` which are smaller and fully testable in TS.

## 2026-06-27T18:52Z — auto/ltspice-parity — VCVS (E) + VCCS (G) controlled sources (§3)

### What I did
- Added the two **voltage-controlled linear sources** — VCVS (E) and VCCS (G) —
  which §3 flags as "used constantly in real LTspice circuits." Chose these (over
  more analyses) as the highest-leverage *testable* increment: linear, so the
  existing TS MNA solvers handle them exactly, with hand-computable expected values.
- New component kinds `vcvs`/`vccs` modelled as 4-pin 2-ports: control pair
  (`cp`/`cn`, left) + output pair (`op`/`on`, right). Filled every exhaustive
  `Record<ComponentKind,…>` — pin geometry (`pins.ts`), `SYMBOL_BODY`/`SYMBOL_BOX`
  + a drawn 2-port block symbol with source diamond (`symbols.tsx`), catalog
  entries (`catalog.ts`, Analog section, prefixes E/G).
- **MNA stamps in all three TS solvers**: VCCS is a pure transconductance stamp
  (`I(op→on)=gm·V(cp,cn)`, no extra unknown); VCVS adds a branch-current unknown
  with a controlled constraint row (`V(op)−V(on)=gain·V(cp,cn)`). Done for
  `operatingPoint.ts`, `linearTransient.ts` (incl. I(ref) current samples), and
  `acSweep.ts` (complex, real gain). Added to each solver's SUPPORTED set.
- Native ngspice deck (`spiceNetlist.ts`): emits `E op on cp cn gain` /
  `G op on cp cn gm`, prefixes E/G. `ascImport.ts`: LTspice `e`/`e2`→vcvs,
  `g`/`g2`→vccs (previously skipped as "no Tau equivalent").
- **Verified sign conventions live against ngspice 17** before coding tests:
  `E op 0 cp 0 10`→V(op)=10; `G op 0 cp 0 1m` with op-side 1k load →V(op)=−1;
  negative gain `E −5`→−10. All match.

### Files touched
- src/schematic/{types.ts,pins.ts,symbols.tsx,catalog.ts}
- src/simulation/{operatingPoint.ts,linearTransient.ts,acSweep.ts}
- src/engine/spiceNetlist.ts
- src/io/ascImport.ts (+ ascImport.test.ts mapping test)
- src/simulation/controlledSources.test.ts (new, 9 tests)
- FEATURE_PARITY.md (§3 E/G → 🟡 with detail; kind count 21→23)

### Tests
506 passing (was 496; +10 new). Typecheck clean. New tests are hand-computed
and cross-checked against ngspice 17 (gain·V, −gm·R·V, difference-amp, negative
gain, flat-gain AC, branch current, deck E/G emission, e/g import mapping).

### FEATURE_PARITY items updated
- §3 "Voltage/current-controlled sources E/F/G/H" ⬜ → 🟡 (E + G done; F/H pending).

### UX issues found
- Visual QA of the two new palette symbols not done this run (headless screenshot
  still blocked per prior runs). The symbols follow existing SVG patterns and
  typecheck; **UX debt:** eyeball the VCVS/VCCS glyphs + rotation in `pnpm dev:web`.

### Next step
Implement the current-controlled pair F (CCCS) and H (CCVS): they need a
controlling-current sense branch (current through a 0 V sense element), so add a
branch-current unknown for the control path and reference it in the output stamp.
Then flip §3 E/F/G/H to ✅.

## 2026-06-27T18:05Z — auto/ltspice-parity — wire `.noise` to a NOISE tab + log it (§4/§6)

### What I did
- The previous session landed the `.noise` solver + parser (`simulation/noise.ts`,
  commit ea6df81) but never wired it to the UI, flipped FEATURE_PARITY, or logged
  it. Closed all three so `.noise` is reachable end-to-end like `.tf`/`.dc`/`.step`.
- `App.tsx`: new `noiseAnalysis` state (reset in `invalidateAnalysis`) + a
  `runNoiseAnalysis_` callback that reads the document's own `.noise` via
  `analysesFromDirectives`, runs `runNoiseAnalysis({components,wires,netLabels,params},
  spec)` with the request-version guard, and prompts clearly when no `.noise`
  directive is present. Threaded `noiseResult`/`onRunNoise` props into `SimulationPanel`.
- `SimulationPanel.tsx`: added `"noise"` to the tab mode union, a **NOISE** tab
  button (runs on select), the panel title, and a new `NoisePlot` component —
  output-referred noise density on a **log–log** axis (frequency decades X, V/√Hz
  decades Y; `noisePath` maps through log10), a legend naming the output port, and
  a metric row with integrated total output / input-referred noise + point count.

### Files touched
- src/App.tsx (noiseAnalysis state, runNoiseAnalysis_, props)
- src/components/SimulationPanel.tsx (NOISE tab, NoisePlot, noisePath)
- FEATURE_PARITY.md (§4 `.noise` ⬜ → ✅)

### Tests
496 passing (unchanged; solver's 16 tests + directive mapping already covered).
Typecheck clean. NoisePlot/noisePath are presentational (no component-render test
infra in the repo); the numeric path is validated by the solver's textbook tests.

### FEATURE_PARITY items updated
- §4 `.noise` Noise analysis: ⬜ → ✅ (TS adjoint solver; native device noise NEXT).

### UX issues found
- None new — NOISE tab follows the established AC/DC plot styling (CSS variables,
  log axis, dense metric row). Native FFI noise path still pending (TS-only), same
  caveat as `.tf`/`.dc`.

### Next step
Either (a) start §3 behavioral B-source deck emission (needed for class-d_starter),
or (b) §6 waveform viewer: surface `I(...)` branch currents as probable traces.

## 2026-06-27T12:16Z — auto/ltspice-parity — `.tf` transfer-function analysis (solver + parser + UI) (§4/§6)

### What I did
- Implemented the `.tf` small-signal DC transfer function — the next ⬜ in §4
  analyses. `simulation/transferFunction.ts`:
  - `parseTfDirective(".tf V(out) V1")` → `{output, source}`. Outputs:
    `V(node)`, differential `V(a,b)` (commas + spaces ok), `I(device)`, and the
    bare-node form. Strips leading `.`/`!`.
  - `runTransferFunction` computes **gain**, **input impedance**, **output
    impedance** by perturbation around `runOperatingPoint` (same no-duplicated-
    stamping pattern as `dcSweep`): gain = Δoutput over a unit input step;
    Rin = drive input alone with a unit stimulus and read delivered current
    (voltage input) or terminal voltage (current input); Rout = zero every
    source, inject a unit test current into the output port, read the response.
  - Handles both voltage and current input sources; AC source kinds collapse to
    a DC stimulus for the small-signal solve.
- Extended the OP solver **additively** (`operatingPoint.ts`): new `OpOptions`
  `{ injectCurrents, returnBranches }` — test-current injection into named nets
  and voltage-source/inductor branch-current return. Default behavior unchanged
  (all 468 prior tests still green).
- `analysesFromDirectives` now also returns `tf` so an imported `.asc`'s own
  `.tf` runs as authored (`io/directiveAnalysis.ts`).
- UI: a **TF** tab in `SimulationPanel` (`TfTable`) shows gain/Zin/Zout in a
  metric row + table; `App.runTfAnalysis` runs it from the document directive
  with a clear prompt when none is present. Mirrors the DC tab wiring.

### Files touched
- src/simulation/transferFunction.ts (new), transferFunction.test.ts (new, 12)
- src/simulation/operatingPoint.ts (additive OpOptions + branches)
- src/io/directiveAnalysis.ts (+tf), directiveAnalysis.test.ts (+1)
- src/components/SimulationPanel.tsx (TF tab + TfTable)
- src/App.tsx (tfAnalysis state, runTfAnalysis, props)
- FEATURE_PARITY.md (§4 `.tf` ⬜ → ✅)

### Tests
480 passing (was 468; +12 new). Typecheck clean. **Cross-checked against
ngspice 17**: 1k:1k divider `.tf v(out) V1` → ngspice reports gain 0.5,
input_impedance 2000, output_impedance 500 — Tau matches exactly. Current-input
transimpedance case also hand-verified.

### FEATURE_PARITY items updated
- §4 `.tf` Transfer function: ⬜ → ✅ (TS path; native/nonlinear noted as NEXT).

### UX issues found
- None new. TF tab follows the established OP/DC table styling (CSS variables,
  dense metric row). Note: TF has no native FFI path yet (TS-only), same as DC.

### Next step
Either (a) add `.noise` analysis (§4, the last ⬜ analysis besides .four/.temp),
or (b) start §3 behavioral B-source deck emission (needed for class-d_starter).

## 2026-06-27T11:30Z — auto/ltspice-parity — expose I(...) branch currents to .meas (§4)

### What I did
- Closed the explicit §4 `.meas` NEXT: **branch-current signals `I(ref)`**. The
  measure engine previously returned NaN for every `I(...)`, which blocked
  deadtime.asc's `.meas` lines (`I(V1)`, `I(V2)`, `I(R1)` → PS/PL/Efficiency).
- **TS solver** (`linearTransient.ts`): added `CurrentTrace` + `currents:
  CurrentTrace[]` to the ok result. During the solve loop I now capture each
  device's branch current in SPICE sign convention — voltage-source & inductor
  currents straight from the MNA solution vector, resistor currents `(Va-Vb)/R`,
  capacitor `C·dV/dt`, independent-source currents from the set value. Keyed by
  ref-des (unlabeled parts skipped).
- **Native ngspice** (`nativeSpice.ts`): pulls source currents from ngspice's
  `<ref>#branch` vectors and derives R/C currents from the node voltages it
  already returns (`deriveRcCurrents` in `currents.ts`). Live-confirmed with
  `ngspice -b`: a 10 V / 1k:1k divider gives `v1#branch = -0.005 = I(V1)`,
  matching the TS convention exactly (resistor currents aren't in ngspice's
  default vector set, hence the derivation).
- **measure.ts**: `makeGetter` resolves `I(ref)` against `wf.currents`
  (case-insensitive); added optional `currents` to `MeasWaveform`. App already
  passes the AnalysisResult straight through, so both engine paths light up.

### Files touched
- src/simulation/linearTransient.ts (CurrentTrace + currents capture)
- src/simulation/currents.ts (deriveRcCurrents helper) + currents.test.ts (new, 4)
- src/simulation/measure.ts (I(ref) resolution + MeasWaveform.currents)
- src/simulation/linearTransient.test.ts (+4 hand-computed current tests)
- src/simulation/measure.test.ts (+5 I(...) tests incl. deadtime power forms)
- src/engine/nativeSpice.ts (currents from #branch + derived R/C)
- FEATURE_PARITY.md (§4 .meas I(...) note)

### Tests
468 passing (was 455; +13 new). Typecheck clean. Native `#branch` sign/value
live-validated against ngspice 17 CLI.

### FEATURE_PARITY items updated
- §4 `.meas` — `I(...)` branch-current signals ✅ (line stays 🟡 for `.meas dc`/
  `.meas noise` domains, now the NEXT).

### UX issues found
- None (no UI surface changed). Currents are now available to plot, but the
  waveform viewer doesn't yet offer a current probe — logged as the §6 NEXT.

### Next step
Surface `currents` in the waveform viewer (§6): let a probe/trace picker plot
`I(R1)` etc. alongside voltages; then add `.meas dc`/`.meas noise` domains.

---

## 2026-06-26T08:36Z — auto/ltspice-parity — wire .step sweep to UI + family overlay (§4/§6)

### What I did
- The `.step` parser + generic param-runner (`simulation/paramStep.ts`) existed
  but was unreachable from the UI: an imported circuit with `.step` never swept.
  Wired it end-to-end (used 34× in the user's circuits).
- New pure module `simulation/stepFamily.ts`: `stepContexts(spec, params,
  components)` expands a `StepSpec` into one concrete run context per swept value.
  Handles all three kinds — **param** injects into a scope copy (`withStepValue`),
  **source** overrides the matched component's `value` (case-insensitive ref-des,
  list untouched), **temp** throws a clear "not supported yet" message. Capped at
  `MAX_FAMILY_MEMBERS` (16) so a fine `.step` can't launch hundreds of sims.
  Added `isRunnableStep` + `StepFamilyResult`/`StepFamilyMember` types.
- `App.runStepAnalysis`: reads `stepFromDirectives`, expands contexts, re-runs the
  transient (native ngspice, TS fallback) once per context, stores a
  `StepFamilyResult`. Clear prompts for missing/temp specs. New `stepFamily` state,
  invalidated alongside the other analyses.
- `SimulationPanel`: new **STEP** tab + `StepPlot` overlay — draws the probed
  signal (first probed net, else first trace) across every step member in a
  trace-variable color ramp; legend lists each `name=value`; metrics show signal /
  step count / swept name. Honest empty states for no-directive / no-data.

### Files touched
- src/simulation/stepFamily.ts (new), src/simulation/stepFamily.test.ts (new, 10)
- src/App.tsx (state + runStepAnalysis + props)
- src/components/SimulationPanel.tsx (STEP tab + StepPlot + pickFamilyTraceId)
- FEATURE_PARITY.md (§4 .step note, §6 family-overlay 🟡)

### Tests
455 passing (was 445; +10 new). Typecheck clean. Source-sweep integration test
runs through the real OP solver and tracks a 1:1 divider's half-supply
(V1∈{4,8,12} → mid∈{2,4,6}).

### FEATURE_PARITY items updated
- §4 `.step` — UI dispatch + family overlay landed (stays 🟡: temp/nested/AC-DC
  families pending).
- §6 `.step` family-of-curves overlay ⬜ → 🟡 (transient overlay landed).

### UX issues found
- Step overlay plots a single signal (probe-driven). LTspice overlays *every*
  trace as its own family — per-trace selection is the next UI step. Logged as
  UX debt.

### Next step
Add the temp run path (set analysis temperature) and AC/DC-domain step families,
then a per-trace selector in the STEP legend so a user can choose which signal's
family to overlay.

---

## 2026-06-26T08:00Z — auto/ltspice-parity — wire .dc DC sweep end-to-end (§4)

### What I did
- The `.dc` solver + parser (`simulation/dcSweep.ts`) had been landed but was
  never reachable from the UI or from an imported circuit's directives. Wired it
  end-to-end so a `.dc` source sweep actually runs and plots.
- **Import mapping:** `analysesFromDirectives` (`io/directiveAnalysis.ts`) now
  also returns the first `.dc` directive as a `DcSweepSpec` (reusing
  `parseDcDirective`), so an imported `.asc` sweeps the source it specifies.
- **UI dispatch + plot:** added a **DC** tab to `SimulationPanel` and a new
  linear-axis `DcPlot` component (mirrors `AcPlot`: X = swept source value,
  Y = node voltages, the GND net dropped). `App.runDcAnalysis` pulls the sweep
  spec from the document's own `.dc` directive and runs `runDcSweep`; with no
  `.dc` present it shows a clear prompt instead of a silent no-op. DC result
  state is cleared by `invalidateAnalysis` like the other analyses.
- **Native deck:** `buildSpiceDeck` gained a `kind:"dc"` analysis emitting
  `.dc <src> <start> <stop> <inc>` with the increment signed toward `stop`.

### Files touched
- src/io/directiveAnalysis.ts (+ `.dc` recognition), directiveAnalysis.test.ts (+2)
- src/engine/spiceNetlist.ts (`SpiceAnalysis` dc kind + `analysisLine`), spiceNetlist.test.ts (+1)
- src/App.tsx (dcAnalysis state, runDcAnalysis, props, invalidate)
- src/components/SimulationPanel.tsx (DC tab + DcPlot + dcPath)
- FEATURE_PARITY.md (§4 `.dc` notes)

### Tests
444 passing (was 441; +3 new). Typecheck clean. Native `.dc` deck live-validated
in ngspice 17 (`ngspice -b`): a 1:1 divider sweep `.dc V1 0 10 2` prints
V(mid)=Vsweep/2 across all 6 points exactly.

### FEATURE_PARITY items updated
- §4 `.dc` — UI dispatch + plot pane + import mapping + native deck line all
  landed (line stays 🟡 only for native/FFI nonlinear DC runner, a manual
  source/range picker, and nested 2nd-source sweeps).

### UX issues found
- Visual QA still blocked headless (no playwright/puppeteer in node_modules,
  consistent with prior sessions). DcPlot is a faithful mirror of AcPlot; verify
  the DC tab visually on a real desktop run. Tracked as UX debt.
- DC sweep currently runs only via the TS OP solver, so nonlinear DC sweeps
  (diode/MOS curve tracer) on desktop need the native FFI runner — follow-up.

### Next step
Add a native ngspice DC runner (`runNativeDcSweep` in `engine/nativeSpice.ts`)
so nonlinear `.dc` sweeps (curve-tracer/varactor circuits) match LTspice on
desktop, then prefer it over the TS solver in `App.runDcAnalysis` exactly as the
other analyses do (`runNative… ?? runTS…`).

---

## 2026-06-26T02:05Z — auto/ltspice-parity — inline LTspice source functions in the ngspice deck (§3)

### What I did
- Found a hard blocker for the user's real files: an imported LTspice
  `voltage`/`current` symbol carries its stimulus inline on the Value attribute
  (`SINE(0 7.5 1k)`, `PULSE(-10 10 5u 25u 25u 0u 50u)` in class-d_starter.asc),
  but `buildSpiceDeck` only emitted `DC <number>` for `vsource`/`isource` — so it
  threw `needs a valid V value` on those decks and nothing simulated.
- New `engine/sourceFunction.ts`: `parseSourceFunction(rawValue, "V"|"A")` parses
  the five LTspice transient families — **SINE/SIN, PULSE, PWL, EXP, SFFM** — and
  re-emits an ngspice-ready spec (`DC <t0> SIN(...)` etc.). It (a) parses every
  numeric arg through `parseQuantity` so LTspice's `µ`/`meg`/unicode prefixes are
  normalized to plain numbers ngspice always accepts, (b) rounds to 12 sig-digits
  to kill binary-float noise (`10·1e-6` → `0.00001`, not `0.0000099999`), and
  (c) trims the trailing `Ncycles` slot that ngspice's SIN/PULSE reject. Returns
  `null` for a plain DC number so the existing numeric path still handles it.
- Wired it into `buildSpiceDeck`'s `vsource`/`isource` cases (keeping the isource
  node-swap polarity convention intact).

### Files touched
- src/engine/sourceFunction.ts (new), src/engine/sourceFunction.test.ts (new, 10 tests)
- src/engine/spiceNetlist.ts (vsource/isource try the function parser first)
- src/engine/spiceNetlist.test.ts (+2 deck-integration tests)
- FEATURE_PARITY.md (§3 Sources note)

### Tests
441 passing (was 429; +12 new). Typecheck clean. Live-validated both generated
decks in real ngspice 17 (`/opt/homebrew/bin/ngspice -b`): the SIN deck produces
v() output and the full-PULSE deck runs with zero errors/warnings.

### FEATURE_PARITY items updated
- §3 Sources — SINE/PULSE/PWL/EXP/SFFM inline functions now reach the deck
  (line stays 🟡: PWL FILE, behavioral B-source, AC spec, noise sources, and
  TS-fallback-solver support for these functions remain).

### UX issues found
- None (no UI surface touched). The TS fallback solver (web mode, no native
  ngspice) still treats a `vsource` SINE string as DC-only — native path is
  unaffected since ngspice now gets the real function.

### Next step
Teach the TS fallback solver (`simulation/linearTransient.ts`) to drive a
`vsource`/`isource` from `parseSourceFunction` (at least SINE + PULSE) so web-mode
sims match native; or add the behavioral **B-source** (`V=`/`I=` expressions),
the last remaining source family the user's circuits need.

## 2026-06-26T02:00Z — auto/ltspice-parity — AC-domain `.meas` engine + UI (§4/§6)

### What I did
- Generalized the `.meas` evaluation core in `simulation/measure.ts` to be
  **axis-agnostic**: extracted `evaluateOnAxis(spec, axis, compile, scope, funcs)`
  plus axis-generic `interpAt`/`findCrossing`/`evalAggregateOnAxis` that work on
  either the transient time axis or the AC frequency axis. The transient
  `evaluateMeasurement`/`runMeasurements` API is unchanged (delegates to the core).
- Tagged each parsed `MeasSpec` with its `analysis` domain (`tran`/`ac`/…),
  captured from the directive's type token, and **domain-routed** the runners so a
  `.meas ac …` line never runs against a transient result and vice-versa.
- New `simulation/measureAc.ts`: `runAcMeasurements`/`evaluateAcMeasurement` over
  an `AcMeasData {freqs, traces[{magDb,phaseDeg}]}`. An AC expression compiler
  reconstructs each node's complex phasor from dB/phase and resolves the LTspice
  wrappers `db/mag/ph(phase)/re/im` (bare `V` ⇒ magnitude) and two-node `V(a,b)`
  complex differences. So `FIND db(V(out)) AT=1k`, `WHEN mag(V(out))=0.707`,
  `MAX MAG(V(out))`, `PP/AVG`, and `TRIG/TARG` bandwidth all resolve over freq.
- Made crossing thresholds **scope-evaluated expressions** (`CrossingClause.value`
  is now a raw string) so real forms like `WHEN mag(V(out))=GAIN/sqrt(2)` and
  `=(vout_3db)` work — these previously threw at parse time with an empty scope
  (latent crash on the user's AD4080/AFE decks). Exposed the `freq`/`time`
  independent variable so `FIND freq WHEN …` (the AD4080 bandwidth idiom) returns
  the crossing frequency.
- Wired into the app: `App.tsx` memoizes `runAcMeasurements(directives, acAnalysis,
  params.scope, params.funcs)`; `SimulationPanel` renders a second `MeasTable`
  under the Bode plot in AC mode.

### Files touched
- src/simulation/measure.ts (axis-generic core, `analysis` tag, string thresholds,
  `time` var, exports `evaluateOnAxis`/`CompiledExpr`/`safeEvalScalar`)
- src/simulation/measureAc.ts (new), src/simulation/measureAc.test.ts (new, 19 tests)
- src/simulation/measure.test.ts (3 expectations updated for the new fields)
- src/components/SimulationPanel.tsx (acMeasurements prop + AC MeasTable)
- src/App.tsx (acMeasurements memo + prop wiring)
- FEATURE_PARITY.md (§4 `.meas` note: AC domain landed)

### Tests
423 passing (was 404; +19 new). Typecheck clean. AC math is hand-computed
against a 1-pole low-pass H(f)=1/(1+jf/fc): −3.01 dB / 0.707 / −45° at the corner,
WHEN/db corner detection, MAX/MIN/PP over the sweep, `V(a,b)` differential dB, and
the user's exact AD4080 `vout_max→vout_3db→FIND freq WHEN mag(V)=(vout_3db)` and
`WHEN mag(V) = GAIN/sqrt(2)` bandwidth chains.

### FEATURE_PARITY items updated
- §4 `.meas` — AC domain now covered (still 🟡 overall: `I(...)` branch currents
  and `.meas dc`/`.meas noise` remain).

### UX issues found
- Visual QA still blocked headless; AC MeasTable reuses the verified transient
  MeasTable component, so low risk.

### Next step
Add `I(...)` branch-current signals to `.meas` (requires the TS solver to expose
device currents), or wire the landed `.dc`/`.step` solvers into the UI (both
engines exist and are tested; only `.tran`/`.ac` dispatch today).

## 2026-06-26T01:06Z — auto/ltspice-parity — `.meas` transient measurement engine + UI (§4/§6)

### What I did
- Built `simulation/measure.ts`, a full LTspice `.meas`/`.measure` engine for
  transient results. `parseMeasDirective` covers the forms used in the user's
  circuits: `MAX/MIN/PP/AVG/RMS/INTEG` aggregates over `FROM/TO` windows,
  `PARAM <expr>`, `FIND <expr> AT=/WHEN`, bare `WHEN <cond>` (crossing time),
  and `TRIG ... TARG ...` timing with `RISE/FALL/CROSS`, occurrence count, and
  `TD`. SI suffixes via the existing expr engine; `=`/space option forms both.
- `runMeasurements` evaluates directives in order through an accumulating scope
  (seeded with circuit `.param`/`.func`) so later `PARAM` lines reference earlier
  measurements by name — reproducing deadtime.asc's
  `vmax→vmin→vamp→tper→freq→*_err` chain. Signals `V(node)`/`V(a,b)` resolve
  against trace ids/labels and combine with arbitrary expressions; crossing times
  and FIND...AT use linear interpolation.
- Wired into the app: `App.tsx` memoizes `runMeasurements(directives, analysis,
  params.scope, params.funcs)` off the transient result and passes a `MeasResult[]`
  to `SimulationPanel`, which renders a new `MeasTable` under the transient meters
  (op-table styling; failed measurements show their reason). New `.meas-table` CSS.

### Files touched
- src/simulation/measure.ts (new), src/simulation/measure.test.ts (new, 25 tests)
- src/components/SimulationPanel.tsx (measurements prop + MeasTable)
- src/App.tsx (memoized measurements + prop wiring)
- src/App.css (.meas-table styles)
- FEATURE_PARITY.md (§4 `.meas` ⬜→🟡)

### Tests
404 passing (was 379; +25 new). Typecheck clean. Measurement math is
hand-computed: triangle-wave MAX/MIN/PP, trapezoidal INTEG/AVG/RMS of constants,
interpolated FIND/WHEN, and a full deadtime.asc-style TRIG/TARG period →
frequency chain with `.param`-seeded percentage error.

### FEATURE_PARITY items updated
- §4 `.meas` ⬜ → 🟡 (transient domain done; AC-domain `.meas` and `I(...)`
  branch-current signals remain).

### UX issues found
- Visual QA still blocked headless (cannot screenshot the running dev server);
  MeasTable styling mirrors the verified op-table, so low risk. Tracked as UX debt.

### Next step
Map an imported `.dc`/`.step` directive to its landed solver and dispatch from the
UI (both engines exist; only `.tran`/`.ac` adopt directive options today), then
add AC-domain `.meas` so loop-gain circuits' `FIND v(vout) AT`/`WHEN db()=-3`
measurements resolve.

---

## 2026-06-26T00:10Z — auto/ltspice-parity — `.step` parametric-sweep parser + param runner (§4/§5)

### What I did
- Added `simulation/paramStep.ts`. `parseStepDirective` enumerates every LTspice
  `.step` form up front into `StepSpec.values`:
  - linear `start stop incr` (handles clean endpoints, descending ranges,
    negative increments normalized toward stop, SI suffixes),
  - `dec`/`oct` log ranges (N points per decade/octave, endpoint-inclusive),
  - explicit `list`,
  - `param <name>` / bare-source / `temp` kinds.
- `runParamStep` (param kind): injects each swept value into a copy of the
  `ParamScope` via `withStepValue` (exact + lowercased key, base untouched) and
  re-runs a caller-supplied analysis closure, returning a labelled family
  (`{value,label,result}`). Reuses existing `.op`/`.tran`/`.ac` solvers.
- `stepFromDirectives` picks an imported circuit's first `.step`.

### Files touched
- src/simulation/paramStep.ts (new)
- src/simulation/paramStep.test.ts (new, 25 tests)
- FEATURE_PARITY.md (§4 `.step` ⬜→🟡, §5 `.step param x list/range` ⬜→✅)

### Tests
379 passing (was 354; +25 new). Typecheck clean. Integration test sweeps a
divider's Rtop through the real `runOperatingPoint` solver and confirms the
midpoint voltage tracks 12·1k/(Rtop+1k) = 6 V then 3 V.

### FEATURE_PARITY items updated
- §4 `.step`: ⬜ → 🟡 (parser + param-runner done; UI dispatch/source-temp/nested pending)
- §5 `.step param x list/range`: ⬜ → ✅ (engine support complete + tested)

### UX issues found
- None (no UI surface changed this run).

### Next step
Wire `stepFromDirectives` + `runParamStep` into App.tsx's run path with a
family-of-curves overlay in the waveform pane (§6); then add source/temp step
run paths (override a component `value` / analysis temp) and nested `.step`.

## 2026-06-25T23:57Z — auto/ltspice-parity — `.dc` DC-sweep solver + directive parser (§4)

### What I did
- Added `simulation/dcSweep.ts`, a self-contained `.dc` analysis layer:
  - `parseDcDirective(line)` parses `.dc <src> <start> <stop> <incr>` (SI
    suffixes via `parseQuantity`, leading `.`/`!` stripped, returns `null` on
    non-`dc`/malformed/unparseable lines — `parseQuantity` throws, so wrapped).
  - `runDcSweep(schematic, spec)` builds the ordered sweep points (ascending or
    descending, endpoint-inclusive with a 1e-9 fudge), overrides the named
    independent source's `value` per step, and re-solves via `runOperatingPoint`
    — so it inherits the exact same MNA solver with zero duplicated stamping.
    Returns a per-net voltage series aligned to the sweep index. Guards a
    zero increment (no infinite loop) and a point count past MAX_POINTS=100001.
- This is the solver foundation; UI dispatch (a `.dc` run mode + a sweep
  waveform pane) and mapping an imported `.dc` directive to it are the next step.

### Files touched
- src/simulation/dcSweep.ts (new)
- src/simulation/dcSweep.test.ts (new, 9 tests)
- FEATURE_PARITY.md (§4 `.dc` ⬜ → 🟡)

### Tests
354 passing (was 345; +9 new). Typecheck clean. Hand-computed divider proof:
V1 swept 0→10 step 2 → midpoint net = [0,1,2,3,4,5] (Vsweep/2); descending
sweep, unknown-source / non-source / zero-increment / oversized-range all error.

### FEATURE_PARITY items updated
- §4 `.dc` DC sweep → 🟡 (solver + parser done; UI + directive mapping pending).

### UX issues found
- None (no UI surface this increment).

### Next step
Wire `runDcSweep` into the app: add a `.dc` run mode (dispatch when the active
circuit's directives contain a `.dc` line via `parseDcDirective`) and a sweep
plot pane in `SimulationPanel` (x = swept value, y = chosen net traces). Then
the imported class-d/Draft circuits with `.dc` directives run end-to-end.

## 2026-06-25T23:53Z — auto/ltspice-parity — Open dialog imports `.asc` files (§1c)

### What I did
- Wired the LTspice importer into the existing toolbar **Open** button so a user
  can actually open a real `.asc` (the §1 key-goal blocker). The file picker now
  accepts `.asc`; `ShellPanels.openCircuit` branches on extension and, for `.asc`,
  runs the new `importAsc(text)` convenience export (`parseAsc`→`ascToSchematic`),
  builds a `SchematicDocument` carrying `components/wires/netLabels/directives`,
  and hands it to `App.openDocument` — which already adopts the imported
  `.tran`/`.ac` window (`adoptDirectiveOptions`) and builds the param scope at run.
- Honest error states: a non-LTspice or content-free file throws
  "No schematic content found …" (caught → `window.alert`); banked-pin warnings
  for vendor symbols are logged non-fatally rather than blocking the open.

### Files touched
- src/io/ascImport.ts (`importAsc` convenience export)
- src/io/ascImport.test.ts (+2 tests: one-step import, empty-file guard)
- src/components/ShellPanels.tsx (`.asc` branch in `openCircuit`, `accept` attr, import)
- FEATURE_PARITY.md (§1c ✅, NEXT note trimmed)

### Tests
345 passing (was 343; +2 new). Typecheck clean. Validated end-to-end with a
throwaway smoke test over the user's **real** files (since removed):
class-d_starter.asc → 15 comps/46 wires/8 labels/4 directives, deadtime.asc →
18/59/13/0, Draft1.asc → 4/10/0/1. All import without throwing.

### FEATURE_PARITY items updated
- §1 import `.asc`: (c) Open dialog ✅. Line stays 🟡 overall (symbol geometry +
  `.asy` pin banking + `.meas`/`.dc`/`.step` directive mapping still pending).

### UX issues found
- Imported parts still render at Tau's built-in geometry (pins correct via
  override, drawn symbol won't match LTspice spacing) — tracked §1 follow-up.
- Desktop visual QA still blocked (dev port held); this change is a behavioral
  tweak to an existing toolbar button, no new visual surface.

### Next step
§4 analyses are the next blocker for the key goal: implement `.step` (used 34×)
or `.meas` (used 61×) so imported circuits' directives run, OR map
`.dc`/`.meas`/`.step` directive strings → analysis options once those runners
exist. Recommend `.dc` source sweep next (simplest, 37× usage), then `.step`.

## 2026-06-25 — auto/ltspice-parity — imported `.tran`/`.ac` directives drive the run options (§1 d-analyses)

### What I did
- Built `io/directiveAnalysis.ts` — pure parsers turning LTspice analysis
  directives into Tau's option shapes:
  - `parseTranDirective`: `.tran <Tstop>` (short) and `.tran <Tstep> <Tstop>
    [<Tstart> [<Tmax>]] [uic…]` (full) → `{ stopTime, steps }`. Steps derived
    from `Tstop/Tstep` (clamped to [2, MAX_TRANSIENT_STEPS]); zero/missing Tstep
    falls back to the editor default (240). SI suffixes via `parseQuantity`.
  - `parseAcDirective`: `.ac <dec|oct|lin> <N> <Fstart> <Fstop>` → `{ startHz,
    stopHz, pointsPerDecade }`. `dec` maps directly; `oct` → ×log2(10); `lin`'s
    total-point count normalized across the span's decades.
  - `analysesFromDirectives`: picks the first `.tran`/`.ac` from a directive list.
- Wired into `App.tsx`: `adoptDirectiveOptions(doc)` applies an imported circuit's
  own `.tran` window on document-open and tab-switch, so it runs as authored
  rather than with the hardcoded 6 ms / 240-sample default.

### Files touched
- src/io/directiveAnalysis.ts (new)
- src/io/directiveAnalysis.test.ts (new, 14 tests, hand-computed)
- src/App.tsx (import + adoptDirectiveOptions on open/switch)
- FEATURE_PARITY.md (§1 d-analyses .tran/.ac ✅)

### Tests
343 passing (was 329; +14 new). Typecheck clean.

### FEATURE_PARITY items updated
- §1 import `.asc`: (d-analyses) `.tran`/`.ac` directive→options ✅. `.meas`/
  `.dc`/`.step` directive mapping still pending (need those analyses first, §4).

### UX issues found
- None this run. Note: `analysisOptions` is app-global, not per-tab; switching
  tabs adopts the active circuit's `.tran` but a manual options edit isn't yet
  remembered per-tab. Tracked as minor UX debt — fine until §1(c) Open dialog.

### Next step
Either §1(c) — a real Open dialog (Tauri file picker → `parseAsc` →
`ascToSchematic` → `openDocument` with directives) so users open their own
`.asc` — or start §4 `.dc`/`.step` analyses (the next directive kinds to map and
high-value for the user's circuits: .dc ×37, .step ×34).

## 2026-06-25 — auto/ltspice-parity — directives carried on the document + fed to the param scope at every run site (§1 d-param)

### What I did
- Closed the §1(d) param half: an imported `.asc`'s `.param`/`.func`/`{expr}`
  values now resolve when the circuit simulates. Previously `ascToSchematic`
  surfaced directives but they died on the floor — nothing stored them, so the
  running app never built a param scope from an imported file.
- Added `directives: string[]` to the document model (`Doc` + `SchematicDocument`)
  and threaded it through the whole store: `docOf`, `copyDocument`,
  `copyHistoryEntry`, initial state, `loadCircuit`/`restoreCircuit`/`newCircuit`,
  persistence subscriber, and a new `setDirectives` action (undoable).
- Bounded-validated `directives` in `documentValidation` (≤1000 lines, ≤1024
  chars each, must be strings) so persisted/imported docs stay safe.
- Added `params?: ParamScope` to the native `Schematic` type; `buildSpiceDeck`
  already reads `schematic.params`, so native ngspice now resolves params too.
- `App.tsx`: memoized `params = buildParamScope(directives)` (falls back to
  `EMPTY_SCOPE` on a cycle/undefined rather than crashing the run) and passed
  `params` into all six run sites — native + TS `.tran`/`.op`/`.ac` — plus the
  tab snapshot so directives survive tab switches.

### Files touched
- src/store/useSchematic.ts (directives field + setDirectives + threading)
- src/store/useSchematic.test.ts (+3 tests: load/carry, setDirectives undo/redo, newCircuit clears)
- src/schematic/documentValidation.ts (validate directives array)
- src/schematic/documentValidation.test.ts (+1 test, validDocument carries directives)
- src/engine/nativeSpice.ts (params on Schematic type)
- src/io/ascImport.test.ts (+1 integration test: directives → buildParamScope → resolved value)
- src/App.tsx (memoized param scope + params at every run site + snapshot)
- FEATURE_PARITY.md (§1 d-param ✅; §5 .param NEXT note updated)

### Tests
329 passing (was 324; +5 new). Typecheck clean.

### FEATURE_PARITY items updated
- §1 import `.asc`: (d-param) directives-on-document + param-scope wiring ✅.
  Line stays 🟡 overall — (c) Open dialog and (d-analyses) directive→analysis
  mapping still pending.
- §5 `.param` NEXT note resolved (scope now built from imported directives).

### UX issues found
- None this run (no UI surface changed; the directive plumbing is invisible until
  an Open dialog (§1 c) or a canvas directive editor (§2) exposes it).

### Next step
Build §1(c): an Open dialog / file picker that runs `parseAsc` → `ascToSchematic`
and calls `loadCircuit(doc)` with `directives` populated, so a user can actually
open a `.asc`. Then §1(d-analyses): parse the stored `.tran`/`.ac` directives into
`AnalysisOptions` (stopTime/steps, start/stop Hz) so the imported analysis runs
with the circuit's own settings instead of the hardcoded defaults.


## 2026-06-25 — auto/ltspice-parity — LTspice expression engine + .param/.func resolved through every solver (§5)

### What I did
- Built a complete LTspice/SPICE **expression evaluator** (`simulation/expr.ts`):
  tokenizer + precedence-climbing parser + evaluator. SI-suffixed literals
  (1k/2.2meg/10n/1mil, trailing unit ignored), `+ - * / % ^ **` (power
  right-assoc, `-2^2 = -4`), comparison/logical/ternary, built-in functions
  (trig, exp/ln/log10, sqrt, abs, sgn, min/max, floor/ceil/round, pow/pwr/pwrs,
  if, limit, table w/ interpolation, uramp/u/buf/inv), constants (pi, e), and
  user `.func` calls (args bound into a child scope, nested funcs resolve).
- Built **`.param`/`.func` scope resolution** (`simulation/paramScope.ts`):
  `buildParamScope` parses directive strings (multi-assignment lines, the rare
  name-value form), resolves inter-param references in any order via an
  iterative fixpoint, and throws on cycles/undefined refs. `substituteBraces`
  does LTspice-style `{…}` → literal substitution (incl. inside compound specs
  like `PULSE(0 {Vhi} …)`); `resolveComponentValues` maps a component list.
- **Threaded the scope through every solve path** — `runTransientAnalysis`,
  `runOperatingPoint`, `runAcSweep`, and `buildSpiceDeck` now accept an optional
  `params: ParamScope` and resolve brace values before extraction. No-param
  circuits and brace-free components pay nothing (fast path returns the same
  array reference).
- End-to-end proof (`paramIntegration.test.ts`): a `{Vsrc}/{Rtop}/{Rbot}`
  divider with `.param Vsrc=12 Rtop=1k` / `.param Rbot={Rtop*3}` solves to the
  hand-computed 9 V, and the native deck emits concrete numbers (no braces).

### Files touched
- src/simulation/expr.ts (new), src/simulation/expr.test.ts (new, 32 tests)
- src/simulation/paramScope.ts (new), src/simulation/paramScope.test.ts (new, 22 tests)
- src/simulation/paramIntegration.test.ts (new, 7 tests)
- src/simulation/{linearTransient,operatingPoint,acSweep}.ts (thread params)
- src/engine/spiceNetlist.ts (thread params)
- FEATURE_PARITY.md (§5: .param/.func/{expr}/built-ins → ✅; .step still ⬜)

### Tests
324 passing (was 263; +61 new). Typecheck clean. (Note: the full suite is
timing-sensitive — saw a transient 2-test flake once under load that did not
reproduce on three subsequent clean runs; native-ngspice spawn latency suspected,
not a logic regression.)

### FEATURE_PARITY items updated
- §5 `.param` ✅, `.func` ✅, `{expression}` ✅, built-in functions+constants ✅.
  `.step param` remains ⬜ (needs the sweep driver in §4).

### UX issues found
- None (no UI surface changed).

### Next step
Add `directives?: string[]` to `SchematicDocument` (+ `Doc`, `docOf`,
`copyDocument`, persistence) and have `App.tsx` call `buildParamScope(directives)`
and pass `params` to all run sites — this lights up the chain for imported
`.asc` files (FEATURE_PARITY §1 d). Wire `ascToSchematic`'s parsed `TEXT !`
directives into that field at the same time, then map `.tran`/`.ac`/`.op`
directives to the matching analysis runner.

---

## 2026-06-25 — auto/ltspice-parity — ascToSchematic() + pinOverride + electrical net labels

### What I did
- Implemented `ascToSchematic()` (FEATURE_PARITY §1 task a) and pin-accurate
  connectivity via `pinOverride` (task b) — the documented next step for the key
  goal (open the user's real `.asc` files).
- Made net labels **electrical** (they were cosmetic): `extractCircuit` now takes
  an optional `netLabels` arg, merges same-named FLAGs into one net, treats
  `0`/`GND` as ground, and names the net after its label so `V(vcc)` resolves.
  Threaded `netLabels` through native ngspice + all three TS solvers + App.tsx.
- Added `PinOverride` (absolute world pin positions) to `SchematicComponent`;
  `getComponentPins` honors it (falls back to kind+rotation geometry otherwise).
- `ascToSchematic` maps symbols → components with `pinOverride = anchor +
  transformLtPoint(pin)`, wires 1:1, FLAGs → ground symbols / net labels, and
  `TEXT` → directives / comments. 3-terminal MOS bulk tied to source. Unmappable
  vendor symbols skipped with a warning; mapped-but-unbanked symbols (opamps)
  placed and honestly flagged.

### Files touched
- src/schematic/types.ts (PinOverride + field)
- src/schematic/pins.ts (honor pinOverride)
- src/schematic/netlist.ts (electrical net labels, net naming)
- src/schematic/netlist.test.ts (+7 tests), src/schematic/pins.test.ts (new, 4 tests)
- src/io/ascImport.ts (ascToSchematic + helpers), src/io/ascImport.test.ts (+6 tests)
- src/engine/spiceNetlist.ts, src/engine/nativeSpice.ts (thread netLabels)
- src/simulation/{linearTransient,acSweep,operatingPoint}.ts (thread netLabels)
- src/App.tsx (pass netLabels to run sites + deps)
- FEATURE_PARITY.md (§1 a/b ✅, net-labels-electrical note)

### Tests
263 passing (was 246; +17 new). Typecheck clean. Validated against the real
`~/Downloads/LTspice_export/deadtime.asc` and `class-d_starter.asc` via throwaway
tests (since removed): both import without throwing, ground resolves, vcc/vee/etc
collapse to single nets, directives parse.

### FEATURE_PARITY items updated
- §1 import `.asc`: (a) ascToSchematic ✅, (b) pinOverride connectivity ✅,
  net-labels-electrical ✅ (line remains 🟡 overall — (c) Open dialog and
  (d) directive→analysis mapping still pending).
- §2 net labels: annotated as now electrical.

### UX issues found
- None this run (no UI surface changed). Note: imported components still render
  at Tau's built-in geometry (pins are correct via override, but the drawn symbol
  won't visually match LTspice spacing) — tracked as a §1 follow-up.

### Next step
Wire `ascToSchematic` into an Open dialog / file picker so a user can actually
load a `.asc` into the store (FEATURE_PARITY §1 task c), then map parsed
`TEXT !` directives (`.tran`/`.ac`/`.param`/`.meas`) to runnable analyses (task d).
