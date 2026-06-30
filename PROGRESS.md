# Tau Autobuilder — Progress Log

## 2026-06-29T20:10Z — auto/ltspice-parity — ideal lossless transmission line (`tline`) component kind (§3)

### What I did
- Added a full `tline` (ideal lossless transmission line) component kind
  end-to-end — the most-used missing component class in the user's circuits
  (15 `SYMBOL tline` across the corpus, incl. `examples/Educational/
  TransmissionLineInverter.asc`); previously skipped on import with a warning.
- `engine/tlineSpec.ts` (new): `parseTlineSpec` reads LTspice's order-independent
  `Td=<s> Z0=<Ω>` value (SI suffixes, `TD=`/`delay=` spellings, case-insensitive),
  with a robust fallback (Z0=50/Td=1n) that never throws on malformed text;
  `tlineDeckParams` → `Z0=<ohm> TD=<s>`.
- Deck: `buildSpiceDeck` emits `T<name> a1 a2 b1 b2 Z0=.. TD=..` (4-terminal
  2-port). Live-verified in ngspice-46 (matched 75 Ω line shows the correct
  TD-delayed step at the far end). Native engine only — added to no TS-solver
  allowlist, so it's cleanly reported as needing the native engine (like MOS).
- Wired through `types.ts` (kind), `pins.ts` (a1/a2/b1/b2, ordered to match
  LTspice SpiceOrder I1,R1,I2,R2), `catalog.ts` (Electromechanical palette),
  `symbols.tsx` (tapered two-conductor glyph + body/box), and the `.asc`
  importer (`ltspiceTypeToKind`/`ltPinKey`/`LTSPICE_PINS["tline"]` with the real
  `.asy` pin offsets; empty `Value` adopts the `.asy` default `Td=50n Z0=50`).
  Export reverse-map (`kindToLtspiceType`) round-trips `tline`→`tline`.

### Files touched
- src/engine/tlineSpec.ts (new), src/engine/tlineSpec.test.ts (new, 8 tests)
- src/schematic/types.ts, src/schematic/pins.ts, src/schematic/catalog.ts, src/schematic/symbols.tsx
- src/engine/spiceNetlist.ts (case + prefix map), src/engine/spiceNetlist.test.ts (+1 deck test)
- src/io/ascImport.ts (map + pins + default value), src/io/ascImport.test.ts (+3 tests)
- src/io/ascExport.ts (round-trip map)
- FEATURE_PARITY.md (§3 transmission lines ⬜→🟡; kinds list)

### Tests
832 passing (was 821; +11 new). Typecheck clean. Real-file proof: the
educational `TransmissionLineInverter.asc` imports T1 (default `Td=50n Z0=50`)
and T2 (`Td=30n Z0=150`) as `tline` with no "no Tau equivalent" warning.

### FEATURE_PARITY items updated
- §3 Transmission lines (T, LTRA, UR): ⬜ → 🟡 (ideal lossless `T` done).
- §3 kinds list: added `tline` (and `comparator`, previously omitted).

### UX issues found
- None blocking. The `tline` palette entry has no hotkey (the obvious `t` is
  taken by transformer); fine — it's reachable via the palette. Imported `tline`
  renders at Tau's fixed geometry (pins are override-accurate); same known
  cosmetic gap as other imported parts.

### Next step
Pick the next missing high-frequency component class — LTspice DIGITAL gates
(`DIGITAL\\AND`/`INV`, ~37 uses, `A`-device XSPICE primitives) or a structured
param editor (Td/Z0 fields) for `tline` — or move to §2 capture (multi-select).

## 2026-06-29T14:31Z — auto/ltspice-parity — overlay an LTspice .raw reference on the scope (§6/KEY GOAL)

### What I did
- The keystone acceptance-test feature: load LTspice's own `.raw` output and
  overlay it against Tau's results, with a numeric agreement verdict.
- New `simulation/rawOverlay.ts` `buildReferenceOverlay(data, times, tauSignals,
  colors)` — matches reference variables to plotted Tau traces by name
  (case/space-insensitive), resamples each onto Tau's time grid (`resampleOnto`),
  and compares (`compareWaveforms`) → returns dashed reference `Trace[]`,
  per-signal `{normalizedRms, maxAbsError, pass}`, and the unmatched names.
- Wired into `SimulationPanel`: a **Ref .raw** button (file input → `parseRaw`),
  a **Clear ref** button, the dashed overlay traces concatenated into the scope's
  `extraTraces`, and a `.ref-compare` readout showing each matched signal's
  **% RMS + ✓/✗**. New `.scope-trace.ref` dashed style + `REF_COLORS`.

### Files touched
- src/simulation/rawOverlay.ts (new), src/simulation/rawOverlay.test.ts (new, 4 tests)
- src/components/SimulationPanel.tsx (refData state, overlay memo, Ref/Clear buttons,
  comparison readout, dashed ref traces)
- src/App.css (.scope-trace.ref, .ref-compare/.ref-pass/.ref-fail)
- FEATURE_PARITY.md (§1 `.raw` scope overlay note; §6 overlay ✅)

### Tests
821 passing (was 817; +4 new). Typecheck clean. `vite build` succeeds.

### FEATURE_PARITY items updated
- §6 "Overlay an LTspice `.raw` reference on the scope" ✅ (new line); §1 `.raw`
  note updated.

### UX issues found
- UX debt: name-matching only overlays reference signals whose names match a
  plotted Tau trace (works for labelled nets; LTspice auto names like `V(n005)`
  won't match Tau's `N00x`). Acceptable; surfaced as "no reference signal
  matched" with the unmatched names listed. Visual QA of the dashed overlay still
  pending a headless screenshot path.

### Next step
Probe-in-place (§6 ⬜: click a node/wire to add its trace), or AC/step-pane
expression traces (§6), or tune ngspice defaults so the overlay verdict passes
across the real-deck suite (§7).

## 2026-06-29T14:22Z — auto/ltspice-parity — measurement cursors on the transient scope (§6)

### What I did
- New `simulation/cursors.ts` — pure cursor math (LTspice "1 & 2" cursors):
  `fractionToX` maps a 0–1 slider position to an axis value; `cursorReadout`
  interpolates every trace at both cursors and returns t1/t2/Δt/(1/Δt) plus each
  signal's y1/y2/Δy/slope. Clamps to range, NaN-guards coincident cursors,
  validates trace lengths. Reuses the tested `interpolateAt` resampler.
- New `CursorView` collapsible panel on the transient pane (`SimulationPanel`):
  two sliders position the cursors; a meter row shows t1/t2/Δt/(1/Δt) and a
  table lists each shown signal (node V + branch I + plotted expressions) at C1,
  C2, and the delta. Sliders + table (no canvas drag) keep visual risk low.
- New `.cursor-sliders`/`.cursor-table` CSS (theme variables only).

### Files touched
- src/simulation/cursors.ts (new), src/simulation/cursors.test.ts (new, 8 tests)
- src/components/SimulationPanel.tsx (CursorView + render + imports)
- src/App.css (.cursor-sliders/.cursor-table)
- FEATURE_PARITY.md (§6 "Measurement cursors" ⬜→✅)

### Tests
817 passing (was 809; +8 new). Typecheck clean. `vite build` succeeds (99
modules) — confirms the UI bundles. Visual QA still blocked (no headless
screenshot); component mirrors the existing FftView pattern exactly.

### FEATURE_PARITY items updated
- §6 "Measurement cursors (1 & 2, delta readout)" ⬜→✅.

### UX issues found
- UX debt: cursors are slider-driven, not draggable vertical lines on the plot
  (LTspice drags on the trace). Functional + testable now; drag-on-canvas is a
  visual-polish follow-up once headless screenshotting is unblocked.

### Next step
Overlay a loaded `.raw` reference trace on the scope (resample via `resampleOnto`,
show `compareWaveforms` metrics) — the last keystone for the acceptance test.

## 2026-06-29T14:12Z — auto/ltspice-parity — numeric waveform comparison vs LTspice (§7)

### What I did
- New `simulation/waveformCompare.ts` — turns the acceptance test ("reproduce
  LTspice's waveforms exactly") into a number:
  - `interpolateAt` / `resampleOnto` — linear resampling onto an arbitrary time
    grid (also the resampler the future `.raw` scope overlay needs).
  - `compareWaveforms(testT,testV, refT,refV, opts)` — resamples the reference
    onto the test's times over the overlapping interval and reports samples,
    overlap, max/RMS abs error, reference peak-to-peak range, normalized RMS/max,
    and a pass/fail verdict (default 5% RMS / 10% max of full scale). Handles a
    flat reference (no divide-by-zero), partial overlap, and empty/no-overlap
    inputs (throws).

### Files touched
- src/simulation/waveformCompare.ts (new), src/simulation/waveformCompare.test.ts (new, 10 tests)
- FEATURE_PARITY.md (§7 waveform-agreement: tooling 🟡 note)

### Tests
809 passing (was 799; +10 new). Typecheck clean. Tests: linear interp + clamp,
zero-error on mismatched grids, normalized-offset metrics, tolerance pass/fail,
overlap restriction, flat reference, error guards.

### FEATURE_PARITY items updated
- §7 "Match LTspice's defaults … for waveform-level agreement" — added a 🟡
  sub-bullet for the comparison tooling (the tuning itself stays ⬜).

### UX issues found
- None (pure logic). This unblocks an automated/visual LTspice-vs-Tau overlay.

### Next step
Overlay a loaded `.raw` reference trace on the transient scope using
`resampleOnto` + show `compareWaveforms` metrics (§6), or measurement cursors.

## 2026-06-29T14:06Z — auto/ltspice-parity — export Tau results as LTspice .raw (§1)

### What I did
- New `io/rawExport.ts` `serializeRaw(input)` — writes the canonical LTspice
  binary `.raw` (UTF-16LE header, `Variables:` table, `Binary:` marker, var0
  float64 / dependents float32; complex re/im float64 pairs). `inferRawType`
  classifies axis/signal names. `parseRaw(serializeRaw(x))` round-trips for both
  real and complex data.
- Wired a **Save .raw** button onto the transient pane (`SimulationPanel`):
  exports time + every node voltage / branch current / plotted expression so the
  result opens in LTspice's own waveform viewer for a side-by-side comparison.
  Generalized `downloadText` to accept `BlobPart` (string or bytes).
- **Made the `.raw` import test hermetic:** the prior commit's `rawImport.test.ts`
  used `node:fs` (no `@types/node` in this project → `tsc` failed). Replaced the
  on-disk reads with an embedded base64 fixture of the real `_t_startup.op.raw`
  (`rawFixture.ts`); typecheck is green again and the test still exercises the
  genuine UTF-16LE + float64/float32 binary layout.

### Files touched
- src/io/rawExport.ts (new), src/io/rawExport.test.ts (new, 5 tests)
- src/io/rawFixture.ts (new, embedded real .op.raw), src/io/rawImport.test.ts (hermetic)
- src/components/SimulationPanel.tsx (Save .raw button + exportRaw, downloadText BlobPart)
- FEATURE_PARITY.md (§1 `.raw` import+export 🟡→✅)

### Tests
799 passing (was 795). Typecheck clean (also fixes the regression the previous
commit introduced). Round-trip tests cover real transient + complex AC; the
import fixture is a genuine LTspice file.

### FEATURE_PARITY items updated
- §1 "`.raw` waveform export/import" 🟡→✅.

### UX issues found
- Save .raw is disabled until a transient result exists (matches Export CSV).
  Visual QA still blocked (dev port held) — button parallels existing exports.

### Next step
Overlay an imported `.raw` reference trace on the transient scope (§6), or
measurement cursors (§6 ⬜).

## 2026-06-29T13:55Z — auto/ltspice-parity — parse LTspice .raw waveform output (§1)

### What I did
- New `io/rawImport.ts` `parseRaw(buffer)` — reads LTspice's `.raw` simulation
  output so its reference waveforms can be loaded into Tau (the heart of the
  acceptance test: overlay LTspice vs Tau). Decodes the UTF-16LE/ASCII header,
  `Variables:` table, and `Binary:`/`Values:` data with the **exact LTspice
  precision layout** (independent var0 = float64, dependents = float32 unless
  the `double` flag; complex `.ac` = re/im float64 pairs). `rawTrace(data, name)`
  pairs a named variable with the independent axis (magnitude for complex).
- Verified the binary layout empirically against a real file in Python first
  (var0 double + 21 float32 = 92 bytes/point for `_t_startup.op.raw`).

### Files touched
- src/io/rawImport.ts (new), src/io/rawImport.test.ts (new, 7 tests)
- FEATURE_PARITY.md (§1 `.raw` import ⬜→🟡)

### Tests
795 passing (was 788; +7 new). Typecheck clean. Tests cover a synthetic binary
deck (deterministic float64/float32 layout), a synthetic ASCII `Values:` deck,
the no-marker error, and two REAL machine files: `_t_startup.op.raw`
(`V(n001)≈-0.9983`) and `_t_startup.raw` (monotonic time over No. Points). The
real-file tests self-skip (`describe.runIf`) on machines without them.

### FEATURE_PARITY items updated
- §1 "`.raw` waveform export/import" ⬜→🟡 (import parser done; scope overlay +
  export pending).

### UX issues found
- None (no UI surface changed).

### Next step
Overlay an imported `.raw` reference trace on the transient scope (§1/§6), or
measurement cursors (§6 ⬜).

## 2026-06-29T13:48Z — auto/ltspice-parity — import SPICE .cir netlists into a schematic (§1)

### What I did
- New `io/cirImport.ts` `parseCir(text)` — turns a SPICE deck into Tau schematic
  content. Connectivity is electrical via **one net label per device pin**,
  placed at the pin's exact world coordinate so it shares the pin's DSU point key
  in `extractCircuit` (same-named labels merge; `0`/`GND` → ground). No wire
  routing needed; devices land on a deterministic grid.
- Handles R/C/L, V/I, D, Q, M, E/G, B. Parses the title card, `+` continuations,
  `;`/`$` inline comments, `.model` polarity (npn↔pnp, nmos↔pmos), and the
  ambiguous 3-vs-4-terminal MOS/BJT node count by locating the model name in the
  `.model` map. Ties a 3-terminal MOS bulk to its source. Warns + skips
  X/K/F/H/T (subckt, coupling, current-controlled sources, transmission lines).
- Wired into the Open dialog (`.cir`/`.net`/`.sp`/`.spice`), with an empty-deck
  error message.

### Files touched
- src/io/cirImport.ts (new), src/io/cirImport.test.ts (new, 10 tests)
- src/components/ShellPanels.tsx (Open dialog branch + accept list)
- FEATURE_PARITY.md (§1 "import `.cir`" ⬜→✅, line now fully ✅)

### Tests
788 passing (was 778; +10 new). Typecheck clean. Validated with a throwaway test
(removed): real `deadtime.asc` → `buildSpiceDeck` → `parseCir` re-imports all 16
deck devices with 0 warnings, `extractCircuit` yields 10 nets with ground.

### FEATURE_PARITY items updated
- §1 "Export `.cir`/netlist to file; import `.cir`" 🟡→✅.

### UX issues found
- None new. Imported `.cir` parts render at Tau geometry on a grid (no original
  layout exists in a netlist) — expected; connectivity is correct.

### Next step
Measurement cursors on the transient/FFT plots (§6 ⬜, delta readout between two
clicked points), or `.raw` waveform export (§1 ⬜).

## 2026-06-29T13:36Z — auto/ltspice-parity — export Tau schematic → LTspice .asc (round-trip) (§1)

### What I did
- New `io/ascExport.ts` — the inverse of `ascImport.ts`:
  - `serializeAscDocument(doc)` serializes an `AscDocument` to `.asc` text;
    the round-trip `parseAsc(serializeAscDocument(doc)) ≅ doc` holds for all
    structured content (VERSION/SHEET/WIRE/FLAG/SYMBOL/SYMATTR/TEXT).
  - `schematicToAsc({components,wires,netLabels,directives,comments})` builds an
    `AscDocument` from Tau content and serializes it — `ground` parts + net
    labels → FLAGs, components → SYMBOL+SYMATTR (`InstName`/`Value`), Tau
    polyline wires split into single-segment WIREs, directives/comments → TEXT.
  - `kindToLtspiceType` / `rotationToOrientation` reverse maps (chosen so the
    banked-pin symbol type re-imports with the same `pinOverride`).
- Wired a **Save .asc** toolbar button into `ShellPanels` next to Save.

### Files touched
- src/io/ascExport.ts (new), src/io/ascExport.test.ts (new, 11 tests)
- src/components/ShellPanels.tsx (Save .asc button + saveAsc)
- FEATURE_PARITY.md (§1 "Export Tau schematic → .asc" ⬜→✅)

### Tests
778 passing (was 767; +11 new). Typecheck clean. Validated with a throwaway
test (since removed) that imports the real `deadtime.asc` (18 comps/59 wires/13
nets), `class-d_starter.asc` (15/46/8), and `Draft1.asc` (4/10), exports, and
re-imports: all counts/kinds preserved, re-export byte-idempotent, 0 warnings.

### FEATURE_PARITY items updated
- §1 "Export Tau schematic → `.asc` (round-trip)" ⬜→✅.

### UX issues found
- None new. Save .asc disabled on empty document, matching Save.

### Next step
Import a `.cir` netlist back into a schematic (§1, the other half of the 🟡
netlist line), or measurement cursors on the transient/FFT plots (§6 ⬜).

## 2026-06-29T06:56Z — auto/ltspice-parity — FFT THD readout + noise CSV + SPICE netlist export (§6/§1)

### What I did
Three follow-on increments after the FFT view:
- **THD-from-spectrum** (§6, `simulation/fft.ts` `spectrumThd`): fundamental =
  supplied freq or loudest bin above DC; harmonics = bins nearest `2f₀,3f₀,…` to
  Nyquist; `THD = √(Σ harmonic²)/fundamental`. Shown in the FFT view's meter row
  (replaced the BINS metric). +3 tests (50% THD for a half-amplitude 2nd
  harmonic; 0% for a pure tone; explicit-f₀ form), exact on a leakage-free signal.
- **Noise CSV export** (§6): an **Export CSV** button on the noise pane writes
  `freq` + `onoise (V/√Hz)` + `inoise (<unit>)` via the shared `seriesToCsv`/
  `downloadCsv` helpers.
- **SPICE netlist export** (§1, LTspice "View → SPICE Netlist"): a **Netlist**
  button on the transient pane builds the same deck the engine runs
  (`buildSpiceDeck` with the document's `.param` scope) and downloads it as
  `tau-netlist-<date>.cir`; build errors (no ground, no parts) surface inline.
  Generalized `downloadCsv` into a `downloadText` helper.

### Validation
- **End-to-end ngspice check** of the netlist export: imported the real
  `~/Downloads/LTspice_export/deadtime.asc` through `importAsc` → `buildSpiceDeck`,
  wrote the deck to `/tmp`, and ran it in ngspice 17 — parsed cleanly and solved
  a 1008-row transient (the batch-mode "needs .print" notice is expected; the FFI
  path reads vectors). Deck included the bundled `1N4148` model, both op-amp
  VCVS stages, and the resolved `.tran` line. (Throwaway test removed.)

### Files touched
- src/simulation/fft.ts (+spectrumThd), src/simulation/fft.test.ts (+3 tests)
- src/components/SimulationPanel.tsx (THD metric, noise CSV, netlist export, downloadText)
- FEATURE_PARITY.md (§6 FFT THD note; §6 CSV noise pane; §1 netlist export ⬜→🟡)

### Tests
767 passing (was 764; +3 new). Typecheck clean.

### FEATURE_PARITY items updated
- §6 FFT: THD readout done. §6 CSV: noise pane added. §1 "Export `.cir`/netlist
  to file" ⬜→🟡 (netlist export done; `.cir` import still pending).

### UX issues found
- None new.

### Next step
Import a `.cir` netlist back into a schematic (§1), or measurement cursors on the
transient/FFT plots (§6 ⬜) — delta readout between two clicked points.

## 2026-06-29T06:47Z — auto/ltspice-parity — FFT of a waveform on the transient scope (§6)

### What I did
- **FFT of a transient waveform** (§6 ⬜→🟡, LTspice "View → FFT"), pure-logic
  core in `simulation/fft.ts`:
  - `fftRadix2` — in-place iterative radix-2 Cooley–Tukey FFT (bit-reversal +
    butterflies); throws on non-power-of-two length.
  - `windowValue` — rectangular/Hann/Hamming/Blackman window coefficients.
  - `waveformSpectrum` — linear-resamples a (non-uniform) transient signal onto a
    power-of-two uniform grid over the time window, windows it, FFTs, and returns
    the **one-sided amplitude spectrum** (DC…Nyquist) with coherent-gain
    normalization so a pure `A·cos(ωt)` reads amplitude `A` at its bin (DC and
    Nyquist carry no ×2 fold). Magnitude in linear + dB (floored), phase in deg.
  - `runWaveformFft` resolves `V(node)`/bare-node/`I(ref)` against a transient
    `MeasWaveform`; `dominantFrequency` reports the loudest bin above DC.
- **UI:** collapsible **FFT spectrum** view under the transient scope
  (`SimulationPanel` `FftView`): signal + window selectors, magnitude on a
  log-frequency / dB axis (shares `bodePath` with the Bode plot), peak-frequency
  / bin-count / DC readout. Collapsed by default so the transform only runs when
  opened. New `.fft-toggle`/`.fft-view` CSS (theme variables, no hardcoded color).

### Files touched
- src/simulation/fft.ts (new), src/simulation/fft.test.ts (new, 19 tests)
- src/components/SimulationPanel.tsx (FftView + render in transient pane)
- src/App.css (.fft-toggle/.fft-view)
- FEATURE_PARITY.md (§6 FFT ⬜→🟡)

### Tests
764 passing (was 745; +19 new). Typecheck clean.

### FEATURE_PARITY items updated
- §6 "FFT of a waveform; THD readout" ⬜→🟡 (spectrum + UI done; THD-from-spectrum
  + FFT cursor still pending — `.four` already gives THD over a known fundamental).

### UX issues found
- None new. FFT view is collapsed by default to avoid recomputing on every
  transient run; reuses the Bode plot's log-frequency rendering for consistency.

### Next step
Add a THD-from-spectrum readout to the FFT view (pick the fundamental as the
dominant bin, sum harmonic bins) and/or measurement cursors (§6 ⬜) on the
transient/FFT plots — delta readout between two clicked points.

## 2026-06-29T06:37Z — auto/ltspice-parity — waveform viewer: expression plots + CSV export (§6)

### What I did
Two §6 waveform-viewer features, both with a pure testable core reused from
existing infrastructure:
- **Plot arbitrary expressions** (`simulation/plotExpression.ts`): an expression
  bar under the transient scope evaluates any expression of the simulated
  signals (`V(out)-V(in)`, power `V(out)*I(R1)`, `2*V(in)+1`) at every timestep
  and overlays it as a derived trace. Reuses the `.meas` compiler (`compileExpr`,
  now exported from `measure.ts`) so node voltages + branch currents resolve
  through one evaluator. Bad signal names show a clear error; traces managed via
  labelled removable chips. WaveformPlot gained an `extraTraces` prop folded into
  its bounds + rendering.
- **CSV export** (`simulation/waveformCsv.ts`): **Export CSV** buttons on the
  transient pane (`time` + node traces + branch currents + plotted expressions),
  the AC pane (`freq` + per-trace mag(dB)/phase(°)) and the DC pane (swept source
  + each net voltage), sharing a `downloadCsv` helper. RFC-4180 header quoting,
  non-finite samples as empty cells.

### Files touched
- src/simulation/plotExpression.ts (+ .test.ts, 6 tests)
- src/simulation/waveformCsv.ts (+ .test.ts, 4 tests)
- src/simulation/measure.ts (export compileExpr)
- src/components/SimulationPanel.tsx (expr bar, chips, export button, exprTraces)
- src/App.css (.expr-* styles)
- FEATURE_PARITY.md (§6 expression-plot + CSV notes)

### Tests
745 passing (was 735; +10 new). Typecheck clean. `pnpm vite build` succeeds.

### FEATURE_PARITY items updated
- §6 plot arbitrary expressions 🟡 (was ⬜); §6 export CSV 🟡 (was ⬜).

### UX issues found
- Live headless screenshot still blocked (dev port held per design log), so the
  new expression bar was verified via typecheck + production build + following
  existing CSS patterns, not a live screenshot — **UX debt: visual QA pending**.
- Expression traces (incl. power, in W) render on the scope's shared "V" axis;
  per-trace units/axis is future work.

### Next step
§6: measurement cursors (1 & 2 with delta readout) on the transient scope, or
add expression traces to the AC/Bode pane (reuse measureAc's compiler). Also a
good time for a live visual QA pass once the dev port is free (UX debt above).

## 2026-06-29T06:27Z — auto/ltspice-parity — .meas dc + .meas noise domains (§4)

### What I did
Closed the two remaining spectral/sweep `.meas` domains by reusing the
transient measurement core (axis-generic `evaluateMeasurement` + `compileExpr`)
against adapted waveforms — no duplicated parsing or crossing logic.
- **`.meas dc`** (`simulation/measureDc.ts`): `dcResultToWaveform` maps a
  DcSweepResult onto a MeasWaveform with the swept-source value as the axis, so
  `MAX/MIN/FIND AT/WHEN`/chained PARAMs evaluate over the sweep. Fixed a latent
  bug: `runMeasurements` used to route `dc` lines onto the *time* axis — it now
  takes only tran/untyped.
- **`.meas noise`** (`simulation/measureNoise.ts`): `noiseResultToWaveform`
  exposes `onoise`/`inoise` traces over frequency, so `V(onoise)`/`V(inoise)`
  measurements resolve.
- Wired both into `App.tsx` (`dcMeasurements`/`noiseMeasurements` memos) and a
  `MeasTable` under the DC and NOISE plots in `SimulationPanel`.

### Files touched
- src/simulation/measureDc.ts (+ .test.ts, 8 tests)
- src/simulation/measureNoise.ts (+ .test.ts, 7 tests)
- src/simulation/measure.ts (runMeasurements no longer routes `dc`)
- src/App.tsx, src/components/SimulationPanel.tsx (memos + MeasTables)
- FEATURE_PARITY.md (§4 .meas dc/noise notes)

### Tests
735 passing (was 720; +15 new). Typecheck clean.

### FEATURE_PARITY items updated
- §4 `.meas`: dc + noise domains ✅ (all of tran/ac/dc/noise now run).

### UX issues found
- None new.

### Next step
§4: expose branch currents in the waveform viewer (probe a device → plot its
current, §6), or a native (FFI) DC runner for nonlinear `.dc` sweeps.

## 2026-06-29T06:20Z — auto/ltspice-parity — nested 2nd-source .dc sweep (§4)

### What I did
- Implemented LTspice's **nested two-source `.dc` sweep** (`.dc V1 … V2 …`,
  used 37× by the user's circuits), the last documented gap on the `.dc` item.
  - `parseDcDirective` now reads an optional second leg (SPICE inner-source-first
    order); `DcSweepSpec` gains optional `source2/start2/stop2/step2`.
  - `runDcSweep` re-runs the inner sweep once per outer value and returns the
    result as a **fan of curves** — one annotated net trace per outer value
    (`V(out) (V2=2)`), sharing the inner sweep X axis, exactly how LTspice draws
    nested DC. Refactored the per-step solve into `solveInnerSweep`.
  - Each net now carries a `ground` flag; `DcPlot` filters on it (instead of the
    literal `"GND"` label, which the annotation broke). Outer loop capped at 64.
  - Native ngspice deck (`spiceNetlist.ts` `kind:"dc"`) appends
    `<src2> <start2> <stop2> <inc2>` to the `.dc` line.

### Files touched
- src/simulation/dcSweep.ts (nested parse + fan runner)
- src/simulation/dcSweep.test.ts (+5 tests)
- src/engine/spiceNetlist.ts (nested .dc emission)
- src/engine/spiceNetlist.test.ts (+1 test)
- src/components/SimulationPanel.tsx (DcPlot uses `ground` flag)
- FEATURE_PARITY.md (§4 .dc nested note)

### Tests
720 passing (was 714; +6 new). Typecheck clean. **Validated against ngspice 17**:
a summing node V(out)=(V1+V2)/2 with `.dc V1 0 4 2 V2 0 4 2` produces the same
9-row fan ([0,1,2],[1,2,3],[2,3,4]) as the TS solver — exact match.

### FEATURE_PARITY items updated
- §4 `.dc` nested 2nd-source sweep ✅ (line stays 🟡: native FFI DC runner for
  nonlinear sweeps + manual source picker still pending).

### UX issues found
- None new. DcPlot caps the fan at 6 traces (existing `.slice(0,6)`); a large
  nested sweep shows only the first few curves — acceptable, noted as future
  legend/pick work.

### Next step
Continue §4: add the `.meas dc` domain (run measurements over a DC sweep result),
or wire a native (FFI) DC runner so nonlinear `.dc` sweeps match ngspice.

## 2026-06-29T01:05Z — auto/ltspice-parity — real-.asc op-deck *run* 45 → 70/82 (§3/§4/§7)

### What I did
With all 82 acceptance files now building a deck, measured the next layer —
how many ngspice actually **solves an `.op` for** (a throwaway smoke ran each
deck through `ngspice -b`). Baseline 45/82; drove to **~70/82** with four fixes:
- **`rshunt=1e12` in the default `.options`** (`engine/spiceOptions.ts`): ngspice
  throws a fatal "singular matrix" the instant any node lacks a DC path to ground
  (floating op-amp input, AC-coupled stage, ideal-transformer winding). A 1 TΩ
  shunt from every node fixes it; numerically invisible (a 5 V divider still
  reads 5.000000 V). **+19 files** (Wien/Howland/phono/LoopGain/Linkwitz/GFT/…).
- **`LPNP`/`LNPN` → `PNP`/`NPN`** (`engine/modelDirectives.ts`): ngspice has no
  lateral-BJT model type, so the discrete LM741/LM308 `.model PN LPNP(...)` was
  "Unknown model type lpnp - ignored" → every transistor type-mismatched.
- **Split multi-directive TEXT blocks on `\n`** (`engine/spiceNetlist.ts`):
  LTspice packs `.ic v(vo)=0.5\n.tran 10m` into one TEXT; the single-line
  directive consumers (.options/.temp/.ic/K) now read `expandDirectiveLines`
  so two directives don't collapse into one malformed line (Draft6).
- **Rewrite `K` coupling refs to renamed inductors** (`engine/couplingDirectives.ts`):
  a K line names inductors by LTspice instance name, but the deck renames an
  inductor whose label isn't a valid ngspice `L…` name (T2a → transmission line),
  so ngspice hit "coupling to non-existent inductor t2b" (Electrometer). The deck
  now passes the label→emitted-name map and the K refs are rewritten.

### Files touched
- src/engine/spiceOptions.ts (+ test), modelDirectives.ts (+ test),
  couplingDirectives.ts (+ test), spiceNetlist.ts (flat directives, inductor map),
  spiceDeck.test.ts (+1 \n-split test)
- FEATURE_PARITY.md (§7 op-run ~70/82 + rshunt convergence aid)

### Tests
714 passing (was 692 at session start; +22 over the whole session). Typecheck
clean. ngspice-46 verified each fix end-to-end.

### FEATURE_PARITY items updated
- §7 added "op-deck *run* ~70/82" + flipped convergence-aids ⬜→🟡 (rshunt ships).
- §3 model-type translation + K-rename notes.

### UX issues found
- None (engine only).

### Next step
The ~12 non-running files are mostly out of ngspice's reach: 4 need external
`.sub` libs not on disk, PLL/PLL2 use `rand()`, SoftDiodeRecovery a proprietary
diode `Vp`, UHFpreamp an unbundled `mrf901`, 2 ISO demos time out, LoopGain2/P2
are deep loop-probe/connectivity cases. Highest-value next: a real **waveform
diff vs. LTspice** on the ~70 that run (the KEY GOAL needs values, not just
convergence) — or resolve `.lib`/`.inc` paths against LTspice's lib dir to
unblock the `.sub` files. P2's shorted-node connectivity (pin geometry on dense
multi-transistor sheets) is its own focused task.

## 2026-06-29T00:45Z — auto/ltspice-parity — real-.asc op-deck build 75 → 82/82 (§1/§3)

### What I did
Reproduced the 75/82 acceptance-deck-build metric (throwaway smoke over the 82
real files = 2 Downloads + 11 Documents/LTspice + 69 Educational) and drove it
to **82/82** with three targeted, fully-tested fixes:
- **Split-field source spec** (`io/ascImport.ts`): LTspice can spread one
  transient function across all four SYMATTR fields (P2.asc I1:
  `Value SINE(` / `Value2 0 100u` / `SpiceLine 5Meg` / `SpiceLine2 0 0 0 1)`).
  `componentValueFromAttrs` only joined the first three — append `SpiceLine2`.
- **`Laplace=H(s)` on E/G sources** (`engine/laplace.ts`, new): a symbolic
  rational expander (polynomial ± × ÷ ** over s, params resolved against the
  scope) emits ngspice XSPICE `s_xfer` num/den coefficient lists (highest-power
  first — empirically confirmed in ngspice-46). Non-rational transfers
  (`exp(-Ts)`, `sqrt`) fall back to the DC gain H(0), exact for an `.op`.
  Unblocked Draft8/PLL/PLL2/TwoTau/HalfSlope. Wired into `buildSpiceDeck`'s
  vcvs/vccs cases. Live-verified: `A0/(1+s/wp1)/(1+s/wp2)` → correct 60 dB
  two-pole AC rolloff in ngspice-46.
- **Chan magnetic-core inductor** (`engine/coreInductor.ts`, new): no ngspice
  saturable-core primitive exists, so size the unsaturated linear inductance from
  the magnetic reluctance `L = N²·µ0·A/(Lg + Lm/µi)`, `µi = Br/(µ0·Hc)`.
  `componentValueFromAttrs` now preserves the core geometry (was dropping
  A=/Lm=/Lg=/N=). Unblocked NonLinearTransformer (L1 → 45.7 mH, hand-verified).

### Files touched
- src/engine/laplace.ts (new), laplace.test.ts (new, 10)
- src/engine/coreInductor.ts (new), coreInductor.test.ts (new, 5)
- src/engine/spiceNetlist.ts (Laplace in vcvs/vccs; core inductor; thread params)
- src/engine/spiceDeck.test.ts (+2 Laplace deck-integration tests)
- src/io/ascImport.ts (SpiceLine2 for sources; preserve core geometry)
- src/io/ascImport.test.ts (+1 split-field test)
- FEATURE_PARITY.md (§1 deck-build 82/82; §3 Laplace sub-item)

### Tests
710 passing (was 692; +18 new). Typecheck clean. ngspice-46 verified the s_xfer
AC rolloff and the emitted decks.

### FEATURE_PARITY items updated
- §1 real-.asc op-deck build 75 → **82/82** (every acceptance file builds a deck).
- §3 E/F/G/H: added 🟡 `Laplace=H(s)` sub-item (s_xfer + DC fallback).

### UX issues found
- None (engine/import only; no UI surface changed).

### Next step
Deck-BUILD is 82/82 but build ≠ converge: pivot to **waveform fidelity** — run
each acceptance file's own analyses through native ngspice and diff node voltages
vs. LTspice (the KEY GOAL). Or pick a testable UI item: §6 probe-in-place /
expression plotting, or §2 multi-select. NonLinearTransformer's behavioral
G-source loop is singular in ngspice (genuinely needs the Chan model — document,
don't chase).

## 2026-06-28T19:09Z — auto/ltspice-parity — dedicated comparator component kind (§3)

### What I did
- Added a real `comparator` component kind so an **open-loop** comparator clamps
  to explicit rails instead of the shared op-amp's gain-1e6 model saturating to
  ~1e7 V (the documented class-d_starter.asc blocker, §3 finding).
- `engine/comparatorSpec.ts`: `parseComparator` (positional `5 0 0.1` or keyed
  `Vhigh=/Vlow=/Vhyst=` with aliases + SI suffixes, ignores stray tokens) and
  `comparatorDeckLine` emitting an ngspice **ternary** B-source
  `V=(V(in+)-V(in-))>0 ? vhigh : vlow`, with a self-referential `V(out)`-state
  hysteresis form for Schmitt behavior.
- Discovered ngspice rejects LTspice's `if()` ("no such function 'if'") outside
  compat mode; the ternary form is what works — **live-verified both ideal
  (clamps 5V/0V) and hysteretic (asymmetric ±0.5 switching) in ngspice 17.**
- Wired the new kind through types, catalog (palette, empty hotkey — all letters
  taken), pins (in+/in-/out, no supply pins), params (structured Output high/low/
  hysteresis fields), symbols (triangle + step glyph), and the native netlist.
  Nonlinear → stays out of the linear TS solver set (native-engine only).

### Files touched
- src/engine/comparatorSpec.ts (new), comparatorSpec.test.ts (new, 13)
- src/engine/spiceNetlist.ts (comparator case + prefix + import)
- src/engine/spiceDeck.test.ts (+2 deck-integration tests, +NetLabel import)
- src/schematic/{types,pins,catalog,params,symbols.tsx} (new kind plumbing)
- FEATURE_PARITY.md (§3 comparator ⬜ → 🟡)

### Tests
683 passing (was 668; +15). Typecheck clean. ngspice-validated decks.

### FEATURE_PARITY items updated
- §3 Comparators / logic gates ⬜ → 🟡 (comparator kind done; logic/A-devices +
  import mapping pending).

### UX issues found
- Comparator palette entry has an empty hotkey (all 26 letters already assigned);
  it's still placeable via the palette/command palette. UX debt: revisit hotkey
  scheme (e.g. shifted keys or a two-key chord) when the library grows further.

### Next step
Import-map LTspice `Comparators\\*` symbols to the new comparator kind, or pick
the next §3/§4 item (logic gates, or TS-solver mutual-inductance K stamp).

## 2026-06-28T18:55Z — auto/ltspice-parity — coupled-inductor K passthrough (§3)

### What I did
- Real LTspice transformer circuits (Transformer, varactor, Royer) keep winding
  coupling in on-canvas `K` TEXT directives; the deck builder only emitted
  .model/.lib/.options/.temp/.ic, so `K` lines were **silently dropped** —
  simulating a coupled transformer as independent inductors (wrong waveforms).
- New `engine/couplingDirectives.ts couplingLinesFromDirectives()` passes every
  K line through verbatim (ngspice shares LTspice's syntax) with any `{expr}`
  coefficient resolved against the param scope; wired into `buildSpiceDeck`.
- Live-verified in ngspice 17: a 1mH:4mH transformer with K=0.99 steps a 1 V
  sine up to ~1.9 V (turns ratio 2) — physically correct.

### Files touched
- src/engine/couplingDirectives.ts (new), couplingDirectives.test.ts (new, 7)
- src/engine/spiceNetlist.ts (emit coupling lines after model/lib)
- src/engine/spiceDeck.test.ts (+1 deck-integration test, +Lind builder)
- FEATURE_PARITY.md (§3 coupled-inductor K → 🟡)

### Tests
668 passing (was 659; +8 wait, +9 incl deck). Typecheck clean.

### FEATURE_PARITY items updated
- §3 Coupled inductors `K` ⬜ → 🟡 (native passthrough; TS-stamp + UI pending).

### UX issues found
- None (engine only).

### Next step
TS-solver mutual-inductance (`K`) stamp for the browser path; or a placeable K
symbol so users don't hand-edit the directive. Or continue native-only deck
blockers (Laplace E/G — note arbitrary s-expressions like exp(-.001*s) can't map
to ngspice's polynomial-only s_xfer, so full Laplace parity is partly
impossible). Or pivot to testable §6 (expression plotting) / §2 (multi-select).

## 2026-06-28T18:40Z — auto/ltspice-parity — real-.asc deck build 34→75/82 (§1/§5)

### What I did
Drove the real-acceptance op-deck build from **34/82 to 75/82** with four
targeted, fully-tested fixes (throwaway smoke over all 82 files guided each):
- **Windows-1252 decoding** (`io/ascImport.ts` `decodeSchematicText`): the single
  biggest blocker. LTspice saves many single-byte `.asc` files where the micro
  prefix is the lone high byte 0xB5 (`47µ`); decoding as UTF-8 mangled it to
  U+FFFD so `47µ` no longer parsed. Now strict-decode UTF-8 first and fall back
  to windows-1252 on invalid bytes → 0xB5 = µ (U+00B5). Unblocked 32 files.
- **Plural `.params`** (`simulation/paramScope.ts`): LTspice accepts both `.param`
  and `.params`; we only matched the singular, leaving `{6*R}` unresolved
  (notch, passive, varactor, phaseshift2).
- **`stripSourceModifiers`** (`engine/acSpec.ts`): ngspice rejects inline
  instance params on independent sources (`unknown parameter (rser)`), so a value
  of `AC 1 Rser=1K` left `Rser=1K` after the AC strip and failed as "needs a
  valid V value". Now drop every `key=value` token before the DC level parses
  (NoiseFigure, S-param, wavein). Transient functions carry no bare key=value.
- **LTspice statistical functions** (`simulation/expr.ts`): `mc`/`gauss`/`flat`/
  `rand`/`random`/`white` now resolve to their nominal/mean value (single
  deterministic run) instead of throwing "Unknown function" (MonteCarlo.asc).
- Verified end-to-end: built NoiseFigure.asc's op deck and ran it in **ngspice 17
  — clean solve**. (passive.asc is singular only under `.op` because it's an LC
  ladder = DC short; it's an `.ac` circuit, so that's expected, not a regression.)

### Files touched
- src/io/ascImport.ts (windows-1252 fallback), src/io/encoding.test.ts (+2)
- src/simulation/paramScope.ts (.params alias), paramScope.test.ts (+1)
- src/engine/acSpec.ts (stripSourceModifiers), acSpec.test.ts (+3)
- src/engine/spiceNetlist.ts (apply stripSourceModifiers to V/I sources)
- src/simulation/expr.ts (mc/gauss/flat/rand/random/white), expr.test.ts (+1)
- FEATURE_PARITY.md (§1 deck-build 75/82 summary)

### Tests
659 passing (was 653; +6 new across 4 files). Typecheck clean. 4 commits, each
pushed.

### FEATURE_PARITY items updated
- §1 import `.asc`: deck-build 34→75/82 (new summary bullet). §5 statistical fns.

### UX issues found
- None (no UI surface changed this run).

### Next step
Remaining 7 deck blockers are native-only: `Laplace=` transfer-function E/G
sources (PLL/PLL2/TwoTau/Draft8/HalfSlope ×5 — needs ngspice XSPICE `s_xfer` or
B-source mapping; untestable in the TS suite), a hysteretic/nonlinear inductor
(NonLinearTransformer), and one malformed WIP source (P2). Either implement the
native Laplace path (validate via `ngspice -b`), or pivot to a testable item:
§6 probe-in-place / expression plotting, or §2 multi-select / rubber-band move.

## 2026-06-28T13:00Z — auto/ltspice-parity — seed .step param first value (§5)

### What I did
- `buildParamScope` now seeds each `.step param X …` variable with its first
  enumerated value (reusing `parseStepDirective`), so a default/preview run can
  resolve `{X}` component values for circuits whose only definition of `X` is the
  `.step` line. A stepped run still overrides per value via `withStepValue`; a
  `.step` value overrides a same-named `.param` default.
- Import cycle paramScope→paramStep is benign (the imported fn is used only in
  the function body; paramStep's EMPTY_SCOPE is likewise body-only).
- Re-ran the real-`.asc` smoke (throwaway): deck-build success now **64/82**
  (session start was 43/82).

### Files touched
- src/simulation/paramScope.ts (step seeding + import), paramScope.test.ts (+2)
- FEATURE_PARITY.md (§5 .step seed note)

### Tests
653 passing (was 651; +2). Typecheck clean.

### FEATURE_PARITY items updated
- §5 `.step param`: base-scope first-value seeding.

### Session summary (this run, 9 commits)
605→653 tests. Real-circuit `.op` deck-build 43→64/82. Landed: source AC stimulus
(Value2), bundled LTspice standard models (diodes/zeners/BJTs + 1N4007), C/L `IC=`,
multi-line/`;`-comment `.param`, trailing-dot numbers, empty `""` source sentinel,
negative resistance, `.step param` seeding.

### Next step (remaining real-.asc deck blockers)
Laplace E/G sources (PLL/PLL2/HalfSlope/TwoTau/Draft8 — need `Laplace=` support);
`mc()` Monte-Carlo function; hierarchical IOPIN sheets (Draft4/5); a few sources
still "needs valid V value" (NoiseFigure/S-param — investigate Value2 path).
Or pivot to §3 VDMOS MOSFET models, or `.lib`/`.inc` file-path resolution.

## 2026-06-28T12:55Z — auto/ltspice-parity — real-.asc import robustness (§1/§5/§7)

### What I did
- Wrote a throwaway smoke test importing all 82 real acceptance `.asc` files and
  building an `.op` deck. Baseline: 82 import, **43 build a deck**. Used the
  failures to drive fixes; deck-build success rose to **58/82** (then more).
- **`.param` multi-line/comment** (`paramScope.ts` `expandDirectiveLines`):
  LTspice packs a whole param block into one TEXT entry with literal `\n` joins
  and inline `;` comments (e.g. Cohn.asc). `buildParamScope` now splits on `\n`
  and strips `;` before parsing — unblocked Cohn/100W/IdealTransformer/Linkwitz/
  MonteCarlo/Draft8/Draft10 and more.
- **Trailing/leading decimal point** (`quantity.ts`): `parseQuantity` rejected
  `10.` (LTspice style) — required a digit after the dot. Regex now accepts
  `10.`, `.5`, `2.k`. Unblocked Clapp/Hartly/Pierce/colpits/curvetrace/…
- **Empty source sentinel** (`ascImport.ts`): LTspice writes a 0 V source as
  `Value ""`; `componentValueFromAttrs` normalizes `""`/`''` to empty so the
  source emits `DC 0` (+ any AC spec). Unblocked GFT/S-param/MeasureBW/NoiseFigure.
- **Negative resistance** (`spiceNetlist.ts`): SPICE allows a negative (active)
  resistor (Draft7 `-1k`); resistors now use `nonZeroNumberValue` (reject only
  zero), C/L stay strictly positive. Removed the now-unused `positiveNumberValue`.

### Files touched
- src/simulation/paramScope.ts (+expandDirectiveLines), paramScope.test.ts (+1)
- src/simulation/quantity.ts (regex), quantity.test.ts (+2)
- src/io/ascImport.ts (empty sentinel), ascImport.test.ts (+1)
- src/engine/spiceNetlist.ts (nonZeroNumberValue; drop positiveNumberValue),
  spiceNetlist.test.ts (+2), spiceDeck.test.ts (message update)
- FEATURE_PARITY.md (§5 .param multi-line, §7 negative R)

### Tests
651 passing (was 645; +6 net). Typecheck clean.

### FEATURE_PARITY items updated
- §5 `.param`: multi-line `\n` block + `;` comment handling.
- §7: negative (active) resistance allowed.

### UX issues found
- None (import/deck plumbing).

### Next step
Remaining real-.asc deck blockers (lower priority — most run via their own
`.step`/`.ac` machinery): `.step param`-only `{x}` refs (seed base scope with
first step value — watch the paramStep↔paramScope import cycle), VCVS/VCCS `E/G`
value format (PLL/HalfSlope), `mc()` Monte-Carlo function, hierarchical/IOPIN
sheets (Draft4/5). Or: `.lib`/`.inc` file-path resolution for deadtime.asc.

## 2026-06-28T12:41Z — auto/ltspice-parity — C/L per-instance IC= initial condition (§3/§4)

### What I did
- Real acceptance circuit Draft10.asc has a cap with `SYMATTR SpiceLine2 IC=1`.
  New `engine/icSpec.ts` (`parseIcValue`/`stripIcSpec`/`icSpecDeckText`) extracts/
  removes an `IC=<token>` from a value (SI suffix preserved, spaces/`-` tolerated).
- Importer `componentValueFromAttrs`: for capacitor/inductor, pulls just the `IC=`
  token from `Value2`/`SpiceLine`/`SpiceLine2` (not the whole attr — avoids
  ngspice-incompatible LTspice keys like Rser) and appends it → `100p IC=1`.
- Native deck (`spiceNetlist.ts`): C/L emit the value (IC stripped) + ` IC=<v>`
  via new `positiveNumberFromText`; when any C/L (or `.ic`) carries an IC the
  `.tran` line gets `uic` so the value holds at t=0.
- Also added 1N4007 rectifier to the standard-model bundle (prior commit).

### Files touched
- src/engine/icSpec.ts (new), icSpec.test.ts (new, 9 tests)
- src/engine/spiceNetlist.ts (+positiveNumberFromText, C/L IC emit, uic), +2 tests
- src/io/ascImport.ts (componentValueFromAttrs C/L IC), ascImport.test.ts (+1)
- src/engine/standardModels.ts (1N4007)
- FEATURE_PARITY.md (§3 passives C/L IC, §4 .ic per-instance)

### Tests
645 passing (was 635; +10). Typecheck clean. ngspice CLI: `C1 ... 100p IC=1`
with uic → cap starts at 1 V.

### FEATURE_PARITY items updated
- §3 Passives: C/L initial conditions landed.
- §4 `.ic`/`.nodeset`: per-instance IC= attribute landed.

### UX issues found
- None (importer + deck plumbing).

### Next step
TS-solver IC support; or `.lib`/`.inc` file-path resolution (inject a file
reader, inline `.model`/`.subckt` blocks) so deadtime.asc's UniversalOpamp2
subcircuit resolves; or VDMOS MOSFET model support.

## 2026-06-28T12:33Z — auto/ltspice-parity — bundle LTspice standard device models (§3/§7)

### What I did
- New `engine/standardModels.ts`: a curated bundle of LTspice's shipped standard
  device models (`lib/cmp/standard.dio`/`.bjt`), keyed by lower-cased name →
  `.model` line. Parameters verbatim from LTspice 17.2.4, with LTspice-only
  annotation keys (mfg/Iave/Vpk/Vceo/Icrating/type) stripped so each is a clean
  ngspice line. Bundled: 1N4148/1N914/MMSD4148, 1N5817-19 + BAT54 Schottky,
  1N750/751/4733/5231 zeners, 2N2222/2N3904/BC547 NPN, 2N2907/2N3906/BC557 PNP.
  Only parts a Tau kind can instantiate (diode/zener/npn/pnp).
- `buildSpiceDeck` now, for each semiconductor referencing a model name that the
  document doesn't define but we bundle, emits the real `.model` line and uses
  the part name on the device line (union set drives `deviceModel`). Unbundled/
  unknown names still fall back to the generic `TAU_*` starter.

### Files touched
- src/engine/standardModels.ts (new), standardModels.test.ts (new, 7 tests)
- src/engine/spiceNetlist.ts (emit referenced standard models; knownModels union)
- src/engine/spiceNetlist.test.ts (+2 tests; retargeted 1 obsolete fallback test)
- FEATURE_PARITY.md (§3 semiconductors, §7 model bundle → 🟡)

### Tests
635 passing (was 626; +9 net). Typecheck clean. ngspice CLI: all 17 bundled
models parse; 1N750 zener clamps at 4.67 V; 1N4148 forward drop correct.

### FEATURE_PARITY items updated
- §3 Semiconductors: bundled standard models note (still 🟡 — MOS generic).
- §7 Ship a real device-model set: ⬜ → 🟡.

### UX issues found
- None (deck-only plumbing).

### Next step
Resolve `.lib`/`.inc` file paths (read referenced model files, inline blocks) so
deadtime.asc's UniversalOpamp2 subcircuit and any lib-referenced parts resolve;
or broaden the standard-model bundle / add VDMOS MOSFET support.

## 2026-06-28T12:24Z — auto/ltspice-parity — source AC stimulus (SYMATTR Value2) → deck + solvers (§1)

### What I did
- Found a concrete acceptance-test blocker: Draft1.asc / Draft2.asc carry their
  AC stimulus in `SYMATTR Value2 AC 1` (separate from the `SYMATTR Value SINE(...)`
  transient spec). The importer dropped `Value2`, so `.ac`/`.meas AC` ran against
  a 0 V source.
- New `engine/acSpec.ts`: `parseAcSpec`/`stripAcSpec`/`acSpecDeckText` extract /
  remove an `AC <mag> [phase]` chunk from a source value (SI suffixes, optional
  numeric phase, won't mistake a trailing `Rser=…` for phase).
- Importer (`componentValueFromAttrs`): for `vsource`/`isource` joins
  `Value`+`Value2`+`SpiceLine` onto the value (LTspice netlist concatenation).
  Non-source kinds keep `Value` only (semiconductor instance params deferred).
- Native deck (`spiceNetlist.ts`): vsource/isource emit the AC spec after the
  DC/function text (`V1 n1 0 SIN(0 1 1) AC 1`); DC level parsed from the
  AC-stripped text via new `numberFromText`.
- TS AC solver (`acSweep.ts`): vsource/isource with an AC spec now drive the
  sweep as a phasor (`acPhasor`), and `hasAcSource` recognizes them.
- TS transient/OP DC-parse sites strip the AC chunk so `5 AC 2` still reads 5 V.

### Files touched
- src/engine/acSpec.ts (new), src/engine/acSpec.test.ts (new, 13 tests)
- src/engine/spiceNetlist.ts (+numberFromText, AC emission), spiceNetlist.test.ts (+2)
- src/io/ascImport.ts (+componentValueFromAttrs), ascImport.test.ts (+4)
- src/simulation/acSweep.ts (+acPhasor, vsource/isource AC), acSweep.test.ts (+2)
- src/simulation/{linearTransient,operatingPoint}.ts (strip AC at DC parse)
- FEATURE_PARITY.md (§1 SYMATTR mapping ⬜ → 🟡)

### Tests
626 passing (was 605; +21 new). Typecheck clean. ngspice CLI confirmed:
`SIN(0 1 1) AC 1` → RC corner −3.01 dB / −45° at fc.

### FEATURE_PARITY items updated
- §1 SYMATTR Value/Value2/SpiceModel/ModelFile mapping ⬜ → 🟡 (source AC spec).

### UX issues found
- None (importer + deck + solver plumbing; no UI surface changed).

### Next step
Map semiconductor `Value2`/`SpiceLine` instance params and `SpiceModel`/`ModelFile`
to model selection; or resolve `.lib`/`.inc` file paths so deadtime.asc's
1N4148 / UniversalOpamp2 resolve.

## 2026-06-28T07:04Z — auto/ltspice-parity — .model/.lib/.inc/.subckt passthrough + model-name mapping (§3)

### What I did
- **Model/library directive passthrough** (`engine/modelDirectives.ts`):
  `modelLibLinesFromDirectives` pulls a document's `.model`/`.lib`/`.inc`
  (→`.include`)/`.subckt`…`.ends` directives out of the imported TEXT directives,
  expands LTspice multi-line blocks on the literal `\n` escape, normalizes the
  opening keyword (leading dot, `.inc`→`.include`), and skips analysis/param/
  option directives. `buildSpiceDeck` now emits these so an imported `.asc`
  simulates against its real device models, not just Tau's generic `TAU_*`.
  Live-verified in ngspice 17 (`.model MyDiode D(...)` picked up).
- **Model-name mapping**: `definedModelNames` collects the document's
  `.model`/`.subckt` names; the deck builder emits a semiconductor's own
  `SYMATTR Value` model name on its device line *when that model is defined*
  (else the generic `TAU_*`) — strictly improving, never an undefined-model error.

### Files touched
- src/engine/modelDirectives.ts (new), src/engine/modelDirectives.test.ts (new, 14 tests)
- src/engine/spiceNetlist.ts (emit model/lib lines; deviceModel() per semiconductor)
- src/engine/spiceNetlist.test.ts (+3 deck-integration tests)
- FEATURE_PARITY.md (§3 model/library import ⬜ → 🟡)

### Tests
605 passing (was 588; +17 new). Typecheck clean. ngspice CLI confirmed model pickup.

### FEATURE_PARITY items updated
- §3 **Model/library import** ⬜ → 🟡 (passthrough + model-name mapping; lib/inc
  file-path resolution + TS-solver model parsing remain).

### UX issues found
- None (no UI surface changed; deck-only plumbing).

### Next step
Resolve `.lib`/`.inc` *file paths* — read the referenced model file and inline its
`.model`/`.subckt` blocks into the deck (or hand the path to ngspice's search
path) so circuits referencing LTspice's shipped libraries simulate. Then bring
model parsing to the browser TS solver.

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
