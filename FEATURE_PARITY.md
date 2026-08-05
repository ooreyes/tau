# Tau → LTspice Feature Parity

> **Living checklist + to‑do list.** Goal: functional parity with **LTspice 17.2.4**.
> Update as items land — flip `⬜`/`🟡` to `✅` with a one-line note (commit/file).
> Any agent picks up the next unchecked item. Work loop + **Definition of Done**
> live in [AGENTS.md](AGENTS.md); live status in the [PROGRESS.md](PROGRESS.md) heartbeat.

> **📊 Headline metric (the finish line):** test count and current unit are
> **only ever live in the `PROGRESS.md` heartbeat** — read that, not a number
> copy‑pasted here, since this file is not rewritten every run and WILL drift.
> Acceptance corpus is tracked qualitatively below (per‑symbol ⬜/🟡/✅ in §1)
> **and quantitatively by the committed runner** `scripts/acceptance-corpus.sh`
> (✅ — see §1; measured 2026‑08‑04: 82 imported / 81 warning‑clean / 79
> deck‑built / 79 op‑converged, with three honest deck refusals: NIGBT,
> Chan‑core NonLinearTransformer, and unresolved LT1184F on Royer via the
> app's unresolvedSubckts guard). **Done = corpus script proves the
> capability floor (success ≥79 + refusal-only remainder + zero
> deck-guard-leak/failure) + Class‑D `.tran`/`.meas` parity +
> production-ready unsigned DMG** (full checklist in AGENTS.md → Definition
> of Done). The old "≥80/82" deck/op DoD wording is retired — honest ceiling
> on this 82-set is **79** deck/op; do not weaken the three refusals.

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
  Validate decks with the installed `ngspice -b file.cir` CLI. Test count is
  live only in the `PROGRESS.md` heartbeat — do not hand-copy a number here.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **One branch, always:** `auto/ltspice-parity` is the only lineage — see
  AGENTS.md "Branch discipline." There is no longer a separate scaffold branch
  to merge from; `git fetch origin && git reset --hard origin/auto/ltspice-parity`
  is always sufficient to be current.

Status legend: ✅ done · 🟡 partial · ⬜ not started

---

## 1. File I/O & interoperability  ← **highest leverage for the key goal**
- ✅ **Committed acceptance-corpus runner** (`scripts/acceptance-corpus.sh` →
  `apps/desktop/scripts/acceptanceCorpus.corpus.ts` via `vitest.corpus.config.ts`,
  outside the default suite): recursively imports every `.asc` in
  `~/Downloads/LTspice_export` + `~/Documents/LTspice`, builds an `.op` deck,
  batch-runs `ngspice -b`, prints a per-file table + summary, and **fails on any
  regression below the measured floors**. Pure verdict/aggregation helpers in
  `src/io/corpusReport.ts` (8 unit tests in the default suite; ngspice's exit
  code alone is untrustworthy — it exits 0 after "simulation(s) aborted", so the
  verdict requires "No. of Data Rows" in the output and no failure marker).
  The default run now covers all 4,012 discovered files and separately reports
  the historical 82-file release subset; soft assertions report every release
  floor in one run instead of hiding later regressions behind the first failure.
  **First trustworthy measurement (2026-07-03): 82 imported / 71 warning-clean /
  79 deck-built / 64 op-converged.** This corrected the hand-typed "82/82 build"
  claim below. **Update 2026-07-04: 82/82 deck-built (ALL) / 73 warning-clean /
  67 op-converged** — the 3 deck-build failures are fixed for real: Pierce XTAL
  now expands to a 4-element crystal model (`engine/crystalSpec.ts`), and
  varistor/diac placeholders get a valid high-Z value + collision-safe SPICE
  names. **Current truthful measurement (2026-08-04): 82 imported / 81
  warning-clean / 79 deck-built / 79 op-converged.** Three honest deck
  refusals: NIGBT (IGBT.asc), Chan-core NonLinearTransformer, and unresolved
  LT1184F on Royer.asc (corpus now applies the app's `unresolvedSubckts`
  guard). Canonical hard failures: 0.   Knobs: `CORPUS_SKIP_NGSPICE=1`
  (import+deck only),
  `CORPUS_CANONICAL_ONLY=1` (historical release subset).
  **P0.4 capability buckets (2026-08-04):** the runner reports
  `success` / `capability-refusal` / `deck-guard-leak` / `failure` via
  `classifyCorpusCapability` (structured `unresolvedSubckts` preferred over
  error-message prefixes). The full-corpus `hardFailures === 0` soft assert is
  removed — it was prefix-satisfiable and hid recursive-tree leaks. Canonical
  soft floors remain; canonical `deck_guard_leak` must stay 0.
  **DoD honesty (2026-08-04):** AGENTS.md no longer requires fake ≥80/82
  deck/op; the checked box is success ≥79 + refusal-only remainder +
  leak/failure 0 (script stdout). Soft asserts also encode
  `canonicalCapability.success ≥ 79`, `failure === 0`, and
  `success + capability_refusal === total`.
- ✅ **Real-`.asc` release floors by the committed runner: warning-clean ≥80,
  deck-built ≥79, op-converged ≥79, CAPABILITY success ≥79 / refusal-only
  remainder / leak 0 / failure 0** (was 34/82 at this work's start; briefly
  80/82 while a Chan core was silently sized to unsaturated linear L and while
  the corpus skipped the app's unresolvedSubckts guard; fail-closed Chan
  refusal + unresolvedSubckts on 2026-08-04 set deck/op at 79/82). The "82/82"
  previously recorded here
  predated the runner and double-counted 3 files — Pierce/dimmer/varistor —
  that throw at deck time:
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
  transport-delay/√ fallbacks, with `exact:false` now warned on
  `circuit.warnings`) — unblocked Draft8/PLL/PLL2/TwoTau/HalfSlope. A **Chan
  magnetic-core inductor** (`Hc/Bs/Br/A/Lm/Lg/N`) now **refuses atomically**
  (`engine/coreInductor.ts`) — ngspice has no saturable-core primitive, and
  substituting unsaturated linear L deleted the phenomenon under study.
  NonLinearTransformer is the Chan casualty. DIAC/TRIAC invoke the
  unmodified file's authored `.subckt`s; VARISTOR and PHASEDET have direct
  LTspice waveform proofs. Named deck refusals: NIGBT (LTspice-only
  intrinsic), Chan-core NonLinearTransformer, and unresolved LT1184F
  (Royer.asc) via unresolvedSubckts.
- ✅ **Repository-owned analysis/UX stress pack** (`Circuit_testing_v1/`,
  expanded 2026-07-23): 19 LTspice-compatible `.asc` fixtures plus `run.sh`
  cover OP/TRAN/AC/DC/STEP/MEAS/TF/NOISE, RLC behavior, an 18-part ladder,
  MOSFET buck/boost converters, six-output combinational logic, a cascaded
  D-flop register, a four-pole buffered active filter, a compensated
  three-phase feeder, a bridge supply, a three-op-amp instrumentation
  amplifier, and deliberate missing-ground/duplicate-ref failures. The
  one-command report is green at 55/55 across Tau solvers and installed
  ngspice. The exact packaged macOS app additionally proved the buck at
  4.642 V average / 15.11 mV ripple, all eight logic traces warning-free, the
  four-pole AC run, and −210 mV INA output from 10 mV differential input.
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
  - ✅ **(b-visual) imported symbol bodies fit their real terminal banks** —
    genuine LTspice anchors are not body centres and several R0 symbol axes
    differ from Tau's native artwork. `componentVisualPlacement()` now fits the
    native body to immutable `pinOverride` terminals using the eight legal
    rotation/mirror orientations plus translation. Rendering, label collision,
    fit-to-view, hit-testing, and routing obstacles share that placement, so
    imported passives and semiconductors no longer grow crooked diagonal repair
    leads or overlapping labels. Synthetic geometry regressions cover vertical
    passives, rotated passives, and a three-terminal JFET.
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
    pointsPerDecade }` (SI suffixes, lin/oct normalized to points-per-decade).
    Authored transient options now outrank auto-resolution until the user
    explicitly overrides them. LTspice's `startup` modifier is preserved
    separately from plain `uic`: both skip the operating point, while startup
    also ramps independent DC sources from zero over the first 20 µs.
    Packaged proof: the educational Colpitts file runs its authored 500 µs
    window (14,822 native samples) and develops a 1.97 V full-run p-p drain
    waveform instead of the former flat 2.5 µs trace.
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
  - 🟡 **Op-amp + E/G controlled-source pins banked** — extracted from the
    real LTspice 17.2.4 `lib/sym` `.asy` files. Op-amps resolve to one of two
    geometry families (`opampC` for the centered UniversalOpAmp/UniversalOpAmp2;
    `opampO` for the offset layout shared by `opamp.asy`, `opamp2.asy`, and
    ordinary five-pin vendor symbols); E/E2 (VCVS) and G/G2 (VCCS)
    map their control/output pairs (the `2` variants swap controls; G reverses
    output polarity). This flips **22 acceptance files** from "placed without
    pin-accurate geometry (connections may be wrong)" to pin-accurate — incl. the
    key-goal `deadtime.asc`. Warning-clean import coverage is **81/82**;
    deck-built / op-converged **79/82**. Three honest deck refusals: NIGBT,
    Chan-core NonLinearTransformer, and unresolved LT1184F (Royer).
    **Correction (2026-08-03):** “every vendor part” was false. AD8235, LT1168,
    LT1194, and LT1795 expose instrumentation/fully-differential/high-current
    multi-pin layouts. The guessed opampO bank collapsed REF/output/supply nets
    and generated singular or shorted VCVSs. They now remain lossless foreign
    records and refuse by name. **Named five-pin vendor op-amps are now
    model-gated (2026-08-03):** a verified five-terminal `.subckt` from the
    document or a user-attached library executes through Tau's native worker;
    a missing or incompatible model refuses atomically instead of using the
    generic gain block. Part / Simulation model / status are named inspector
    controls and exact `Value2` model identity round-trips. **Preview transient
    closed (2026-08-04):** `runTransientAnalysis` now refuses named vendor
    op-amps with the same "will not substitute" copy as OP/AC/noise (previously
    stamped the ideal nullor). Semiconductor Properties copy matches the
    fail-closed deck: missing named models block Run rather than promising a
    generic starter. Proof: `scripts/named-device-fidelity.sh` →
    `NAMED-DEVICE: exact=2 refuse=4 silent=0` and recursive
    `NAMED-DEVICE-RECURSIVE: unencrypted=2538 exact=410 refuse=2128 silent=0
    hard-failure=0 encrypted-excluded=1474 exact-rate=16.2%` (tip 2026-08-04
    23:59). Bare Applications SYMBOL → unique-leaf `.asy` + plaintext
    ModelFile/SpiceModel.lib (+10 exact vs 15.8% ModelFile-twin tip). Harness
    skips encrypted-only leaves (no 33.4% denominator game). Never silent
    substitution. SHIPPABLE? NO.
    Still open: import arbitrary user-supplied multi-pin `.asy` banks; raise
    recursive exact-model floor to ≥95% with hard-failure=0; a shared five-pin
    shape does not prove pin fidelity for those parts.
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
  - **Acceptance warning-clean coverage: 80/82.** Unknown symbols are preserved
    for lossless editing and gate Run; they are never dropped from simulation.
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
- ✅ **Native Schematics-folder Explorer (2026-07-14):** Tau opens a user-picked
  folder as the project root, recursively authorizes only that selected root,
  and can create real blank `.asc` files and subfolders there. Native file
  creation now crosses a project-root-constrained Rust command that uses
  `OpenOptions::create_new(true)`: another Tau window or process can win a name
  race, but it can never be overwritten or truncated; Tau retries the numbered
  filename instead. Browser File System Access remains explicitly non-atomic.
  String-valued native errors remain visible instead of being discarded. Files
  and folders are draggable between Explorer directories via
  a traversal/collision/symlink-safe native move command; matching open-tab
  paths are remapped so the next Save follows the move. Explorer chrome uses
  the VS Code action set and density (New File, New Folder, Refresh, Collapse;
  compact Lucide file/folder/chevron rows). The editor-tab `+`, Settings New
  Circuit, and Cmd-S on a pathless startup/scratch tab now all materialize a
  collision-safe real `.asc` in the open Schematics folder; failed or blocked
  first saves clean up the placeholder instead of leaving a ghost file. File
  reservation is serialized, so two rapid `+` activations create
  `untitled.asc` and `untitled-2.asc` instead of racing onto one path. A real
  two-thread Rust race test proves one exclusive winner and one explicit
  `AlreadyExists` result while preserving the winning file byte-for-byte.
  Packaged macOS QA created and opened a real `native-create-check.asc` with the
  canonical 26-byte blank LTspice document; store, panel, path-remap, and Rust
  boundary tests cover moves and creation. **Explorer reliability follow-up
  (2026-07-14):** drag state is captured synchronously and recovered from both
  Tau's custom payload and native `dataTransfer`, so a quick drop into a newly
  created folder cannot lose its source to React timing. Failed moves stay
  visible, destination folders refresh/expand after success, and the redundant
  project-open `Open Folder…` / `Import .asc…` footer is gone; those actions
  remain available as compact toolbar controls. **Round-trip move follow-up
  (2026-07-14):** the project root is now a persistent, named drop target, so a
  file can move into a newly-created nested folder and back to root without
  aiming at blank Explorer space. Files and whole folders move across siblings;
  invalid descendant/collision/root-source moves stay blocked. Root-file
  creation no longer removes a descendant folder's `.keep` marker, and a
  successful native move still remaps open tabs even if the subsequent refresh
  reports an error. **Native-directory follow-up (2026-07-15):** folder creation
  now uses a validated `create_project_directory` Rust command instead of the
  webview filesystem plugin. Real temporary-disk tests create nested folders,
  create ASC files inside them, and move both files and folders into/out of the
  new destinations while preserving bytes.
  **Release file-workflow follow-up (2026-07-16):** double-click is strictly
  open/inline-rename and can no longer invoke deletion. A shadcn context menu
  exposes Copy Path, Copy Relative Path, Rename, and confirmed Delete (plus New
  File/New Folder on directories). Explorer and tab renames preserve schematic
  extensions, remap every affected open tab, and serialize an immediate Cmd-S
  behind the native rename so the old path cannot be recreated. Tau probe dots
  are session annotations and no longer block an otherwise lossless `.asc`
  save. Run now waits for that save before launching simulation, and converting
  a Tau polyline into multiple LTspice WIRE records is correctly treated as an
  exact representation instead of a save-blocking warning. Native WKWebView drag uses a pointer gesture instead of its unreliable
  HTML drag lifecycle; packaged-app QA moved a real renamed ASC into a folder
  and verified the source disappeared and destination bytes persisted on disk.

## 2. Schematic capture
- ✅ Place / move / rotate / mirror / delete components — `Canvas.tsx`, `store/useSchematic.ts` (mirror = horizontal flip, applied before rotation; Ctrl+E)
- ✅ Wire drawing with orthogonal routing + junction dots — `Canvas.tsx` (`routeWireSmart`).
  **Schematic legibility pass (2026-07-13):** automatic routes score component
  hits, collinear overlap, accidental node contacts, near-parallel runs,
  crossings, length, and corners, with clearance/end
  channels generated around existing wires; unavoidable unconnected crossings
  render a hop-over arc while connected joins retain junction dots. Net names
  avoid components, wires, probes, and one another; selected parts/wires/labels/
  probes use a stable toolbar/Delete-key action. Component symbols use corrected
  filled device arrows and crisp token-backed canvas typography. Run/error states
  use evidence-based gradients: neutral before validation, amber while running,
  green after a clean run, and red on failure. Diagnostics now receives the same
  live running signal and suppresses stale success/error content during a rerun.
  Explorer actions mirror VS Code's
  New File, New Folder, Refresh, and Collapse All behavior. **Grid/routing
  hardening (2026-07-14):** free wire endpoints are normalized before routing,
  while exact imported pins and off-grid wire junctions remain untouched; the
  store also collapses redundant collinear vertices before persistence. This
  prevents fractional pointer drift from becoming a tiny pin-adjacent dogleg.
  **Persistent-wire follow-up (2026-07-15):** landing on a pin or existing
  conductor now finishes the current run while keeping Wire active for the next
  connection; empty-grid clicks remain explicit waypoints, and clicking the
  active start again cancels only that run. Probe colors no longer repaint whole
  conductors or node labels, so topology retains one neutral visual language.
  44 geometry tests plus browser/packaged-app QA.
- ✅ Net labels (name a node) — `FLAG` equivalent — store `upsertNetLabel`;
  **now electrical** (merge same-named nets, `0`/`GND`→ground, name the net) in
  `schematic/netlist.ts` `extractCircuit`. **F4 net-label tool landed**
  (2026-07-02): a `label` tool mode (F4 / toolbar / palette / ⌘K) — click a
  snapped point, an inline input opens there (pre-filled if a label exists),
  Enter or click-away commits via the undoable `upsertNetLabel`, empty text
  deletes, Esc cancels. No-op commits (empty on empty, unchanged text) skip
  the undo history.
- ✅ Ground symbol — ✅
- ✅ Grid snap, pan, zoom, fit — `Canvas.tsx`
  **Fit/placement correctness follow-up (2026-07-14):** fit-to-view now sizes
  against labels but centers the electrical topology, so an asymmetric ref/value
  does not pull the circuit sideways; simulator resize fitting measures the
  visible SVG after the telemetry/flex layout settles. Home framing now uses
  each symbol's transformed rendered body and real pins—including rotated,
  mirrored, asymmetric, and imported absolute-pin geometry—instead of a fixed
  square around the component origin. Dropping a two-terminal part collinearly
  onto an ideal wire removes the covered conductor and terminates the two
  remaining wire pieces at the part pins in the same undo step. Perpendicular
  crossings and non-ideal resistive wires stay untouched, and the used placement
  ghost clears immediately instead of drawing a dashed duplicate over the newly
  placed symbol. All resistor rotations, asymmetric ground rotations, imported
  pin overrides, direct Home activation, horizontal/vertical insertion, undo,
  resistance preservation, ghost lifecycle, and resize regressions are covered.
- ✅ Undo/redo, autosave, multi-tab documents
- ✅ Component value editing (double-click) + structured params.
  **Product contract (Omar, 2026-08-03):** every known SPICE knob belongs in a
  named Value/Analysis control with units and validation; normal users should
  never need to author `.op(...)`-style text on the canvas. Raw directives are
  retained for lossless import/export and as an explicit advanced escape hatch,
  not as the primary UI. Any known option that is only a raw string is still an
  unfinished item under this contract.
  **Charge-defined capacitor controls (2026-08-03):** an imported LTspice
  `Q=<expression>` capacitor exposes separate **Charge expression** and
  **Initial voltage** fields. Edits encode back to the native value without
  asking the user to author `Q=` or `IC=` syntax.
  **Engineering-input repair (2026-07-23):** single-quantity component editors
  now size from the visible mantissa instead of collapsing to a one-digit
  border-box; complete values remain readable and long finite mantissas compact
  to scientific notation on commit. The shared editor accepts decimal and
  exponent forms (including normal in-progress states such as `1e-`) while
  rejecting alphabetic input, so component values, transient STOP, and exact
  cursor times share one numeric contract. Focused tests cover full-width
  rendering, numeric-only filtering, exponent entry, and compaction.
- ✅ **Comparator/opamp value label + inspector param fields fixed (§UX)**:
  two bugs, both traced to multi-field values getting treated like a single
  quantity. (a) The canvas label blindly suffixed the catalog's `unit`
  string onto the whole value, so a comparator's default "1 0" + the
  `unit: "Vhi Vlo"` hint rendered as garbled "1 0Vhi Vlo" (same class of bug
  also latent for `vpulse`'s 4-token PULSE spec and `tline`'s "Td=/Z0=" key=
  value spec). `unit` is now reserved for genuine single-quantity kinds;
  `Canvas.tsx`'s `sourceValueLabel` gives each multi-field kind its own
  formatter built from the same `decodeParams` the inspector uses —
  comparator → "1V/0V" (± hysteresis when set), vpulse → "0V→5V @ 100kHz",
  tline → the raw "Td=50n Z0=50" text as-is (no unit ever applied to it).
  (b) The simulator view's "selection strip" (`SimulationPanel.tsx`)
  OUTPUT HIGH/OUTPUT LOW/HYSTERESIS fields rendered as empty pill outlines —
  values decoded fine ("1"/"0"/"0"), so this was a pure CSS bug, and a
  different one than it looked: `.selection-strip` is a 2-column CSS grid
  (52px label rail + 1fr content); `.param-fields` (the 3rd+ grid child,
  wrapping every structured-param field for ANY selected component, not
  just the comparator) had no explicit `grid-column`, so it auto-placed into
  row 2 / **column 1** — the narrow 52px rail — collapsing every value input
  to ~18px (just the SI-prefix arrow). `.value-editor` (the single-field/
  MODEL-picker sibling) already carried the fix (`grid-column: 1/-1`);
  `.param-fields` was just missing the same line. Fixed at 1440×900 and the
  app's 900×600 floor; screenshots (before/after) under
  `screenshots/unitA-comparator/`. 8 new label-formatter tests
  (`Canvas.labels.test.ts`).
- ✅ Probe tool (click node → plot) — `probes`. **Editor hit-target follow-up
  (2026-07-15):** each colored probe marker is directly selectable by pointer or
  keyboard and Delete removes that marker, never the wire beneath it. The
  marker owns pointer events in the editor and exposes an accessible button
  target; packaged-app QA proved the wire selection no longer changes.
- ✅ **Mirror/flip components** (LTspice Ctrl+E) — `mirrored` flag on
  `SchematicComponent` (flip across the vertical axis, applied BEFORE rotation to
  match LTspice `M*`); `transformPoint` in `schematic/pins.ts` drives connectivity,
  `symbolTransform` (`rotate(R) scale(-1 1)`) drives rendering. `mirror()` store
  action toggles the selection or the placement ghost; Ctrl+E bound in `App.tsx`.
  The importer now sets `mirrored` for `M*` orientations so imported parts render
  flipped. 12 hand-computed tests (pin geometry incl. mirror-before-rotate, store
  toggle/undo/place, import mapping).
- ✅ **Copy/paste, duplicate** — **landed** in
  `store/useSchematic.ts`: `copySelected` → ephemeral `clipboard`; `paste`/
  `duplicateSelected` place a `placeClone` (fresh id, next ref-des, 2-grid diagonal
  offset, `pinOverride` offset in lockstep so imported parts stay wired); both
  undoable and select the copy. Bound to Ctrl+C / Ctrl+V / Ctrl+D in `App.tsx`.
  9 store tests. **Multi-select landed** — `selectedIds` + `selectMultiple`/
  `toggleSelect` (Shift+click) in the store; drag-box select (fully-enclosed,
  LTspice semantics, middle-mouse pans) + group move (single undo step) in
  `Canvas.tsx`; group delete. **Selection regression hardening (2026-07-14):**
  individual and marquee gestures now have end-to-end pointer/Zustand tests;
  marquee geometry stays synchronous through pointer-up, and document selection
  commits outside React state updaters. Selected symbols/wires and the drag box
  use high-contrast neutral weight/halo treatment instead of a nearly invisible
  82/18 neutral mix. **Complete mixed-move follow-up (2026-07-15):** dragging a
  marquee selection now translates explicitly selected standalone wires, net
  labels, and probes with its components in one undo step. A selected wire can
  start that group drag, and the pointer-down grid point is the anchor so the
  circuit does not jump when grabbed away from a symbol center. **Whole-circuit
  clipboard follow-up (2026-07-16):** Cmd-C/Cmd-V and Duplicate now clone the
  complete marquee selection—components, wires, net labels, and probes—as one
  offset group with fresh object IDs and reference designators, preserving
  relative geometry and one-step undo. 11 store tests.
- ✅ **Drag wires / move with rubber-banding** — `moveGroup` rubber-bands wire
  endpoints attached to moved pins with orthogonal elbow insertion (store-level,
  shared by single and group moves). **Topology-invariant hardening
  (2026-07-16):** rendering, hit targets, extraction, single/group movement,
  rotate/mirror, clipboard, and undo now use the same imported-pin authority.
  A selected pin on a conductor midpoint or a junction shared by a stationary
  component keeps the original junction and gains an orthogonal lead instead of
  silently detaching the other branch. Pointer-cancel/window-blur rolls back the
  partial drag, and subdivided/overlapping wire insertion removes every bypass.
  Exact endpoint, midpoint, shared-junction, multi-selection, imported-pin, and
  cancellation regressions cover the complete gesture/store path.
- ✅ **Schematic is read-only outside the schematic tab (§UX)**: the simulator
  view only permits pan/zoom/probe. Canvas mouse interactions were already
  gated by `interactive={mode==="schematic"}`, but two bypasses let the
  simulator view mutate the document: (1) `App.tsx`'s keydown handler had no
  `mode` check — Delete/Backspace, undo/redo, rotate/mirror, copy/paste/
  duplicate, and place-shortcuts (R/C/L/V/…) all fired regardless of view;
  (2) `EditorToolbar` (`ShellPanels.tsx`) renders unconditionally and its
  Wire/Label/Undo/Redo/Clear-scratchpad buttons stayed live in simulator
  mode — Undo/Redo/Clear could mutate or wipe the document with **zero**
  canvas interaction. Fixed via a pure, unit-tested gate
  (`schematic/shortcuts.ts` `isEditingAction`/`dispatchShortcutAction`) plus
  a `mode` prop on `EditorToolbar` that disables the mutating buttons; Select
  (cancel) and Probe stay enabled (non-mutating / probing must keep working
  in simulator view). 26 new tests wire the real store (not mocks) through
  the same callback graph `App.tsx` uses and assert the document is
  unchanged when gated.
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
  tests. **Guarded hierarchy re-export now landed (2026-08-02):** every
  flattened simulation member carries exact owner/fingerprint provenance, so
  an untouched instance saves as its original LTspice `SYMBOL` while its
  synthetic components/wires/labels are suppressed. Any edit, deletion, or
  incomplete group remains blocked by instance name; `.sim` persistence,
  hostile validation, copy/duplicate stripping, and the canonical Class-D
  round trip are covered. **Tau-native X device landed (2026-08-03):**
  Properties discovers document, attached-library, and bundled `.subckt`
  contracts in native first-wins order, selects one by name, lists every formal
  terminal, and exposes declared `params:` as named fields. Selection creates a
  dynamic in-canvas block with exact p1..pN terminal order and labels, relocates
  attached wires/labels/probes, emits the resolvable X line, and keeps raw
  `param=value` text off the sketch. Guarded `TauPins` carrier metadata preserves
  up to 64 terminals through `.asc` save/reopen; malformed/forged metadata is
  ignored. Still ⬜: editing a child hierarchy as its own Tau schematic and
  binding a native block directly to that child document.
- ⬜ Net highlighting (hover a net → highlight whole net)
- ⬜ Component attribute window/editor (full SPICE line editor per part)
- ⬜ Pin/port symbols (IOPIN) for hierarchy

## 3. Component / symbol library
Current Tau kinds (~25): R, C, L, pot, V(DC), I(DC), Vac, Iac, **Vpulse**, diode, LED,
zener, opamp, comparator, **VCVS (E)**, **VCCS (G)**, **CCCS (F)**, **CCVS (H)**, **B (behavioral)**, NMOS, PMOS, **NJF**, **PJF**, NPN, PNP, switch, transformer, **tline**, testpoint, ground.
- ✅ **LTspice current-controlled switch (`csw` / W device)** — the importer
  reconstructs the native instance tail from LTspice's actual fields
  (`SpiceModel` sensing-source identity + `Value` CSW model + optional state),
  the exporter round-trips those fields and the two-pin symbol exactly, and the
  native deck resolves hierarchical source names before emitting `W...`.
  Inline/attached `CSW` and LTspice `ISWITCH` cards are supported; missing,
  malformed, or wrong-kind sources/models atomically refuse with no partial
  circuit. Browser preview OP/tran/AC/noise also refuses rather than reviving
  the old 1 TΩ fixed-open approximation. Real CLI ngspice and the freshly
  packaged Tau.app prove both on/off behavior and a 5 V switched output.
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
  IC the node starts at 0. 3 tests. **Native passive ESR/Rser now landed**:
  importer extraction keeps supported `Rser` while dropping vendor-only
  metadata such as `Irms`/`Ipk`; the deck expands C/L ESR into a namespaced
  internal series resistor because ngspice's primitives do not accept LTspice's
  per-instance token. A capacitor is only treated as a BVD crystal when its
  motional `Lser` is present (bare `Cpar`/`Rser` no longer misclassifies it).
  PowerSim LLC's C1/Lp/Ls/Lr now build and run with their authored losses.
  **LTspice nonlinear `Q=<charge expression>` capacitors now land on ngspice's
  native charge-defined capacitor.** Bare LTspice `x` is bound to that exact
  instance's terminal voltage, `.param`/`.func` and LT function translations
  are preserved, and `IC=` remains supported. A real-ngspice RC corpus proves
  the electrical result; preview OP/tran/AC/noise refuse by name because their
  constant-C stamp cannot reproduce `dQ/dV`/`dQ/dt`. Self-contained braced
  values such as `{5.1Meg+120K}` and `{3.3/2}` also evaluate without requiring a
  `.param` scope. **Negative constant capacitance also lands on the same native
  charge law, `Q(V)=C*V`, preserving the authored sign instead of rejecting,
  clamping, or absolutizing it.** Native AC proves the required +45-degree lead
  and the real `elip_grd.asc` now builds/converges; browser previews refuse the
  non-passive stamp explicitly. Still to add: browser-solver ESR stamps and
  behavioral R/L.
- 🟡 Sources — DC/AC/PULSE plus **inline LTspice transient functions on V/I sources now emit to the ngspice deck: SINE (offset/amp/freq/td/damping/phase), PULSE (full 7-arg, Ncycles trimmed), PWL, EXP, SFFM** (`engine/sourceFunction.ts`; µ/meg normalized). **TS-fallback solver now evaluates the same families in the time domain** (`simulation/sourceWaveform.ts` `parseTransientSource` → `{ dc, at(t), maxFrequencyHz }`): the `.tran` loop drives `vsource`/`isource` (and the `vac`/`iac` AC symbols) from the parsed waveform instead of DC-only, `.op` seeds the t=0 bias, and `inspectTransientResolution` derives the sampling requirement from a function source's own frequency. ngspice-verified: PULSE(0 5 1m 0 0 2m 4m) node = 0/5/0 V at t=0.5/2/3.5 ms in both engines. **Named source editor landed (2026-08-03):** Waveform selector plus unit-aware DC operating point, Sine/Pulse/EXP/SFFM parameters, PWL time/level rows, and optional AC amplitude/phase. The DC bias is electrically separate from the transient waveform in both engines; imported text stays byte-stable until edited and edited ASC round-trips. Still missing: PWL FILE, source noise, and named controls for imported source parasitics such as Rser/Cpar (**arbitrary behavioral B-source `V=…`/`I=…` also landed** — see the dedicated B item below)
- 🟡 Semiconductors — diode/BJT/MOS/zener present; **bundled LTspice standard
  models landed** (`engine/standardModels.ts`): common parts referenced by name
  with no inline `.model` (1N4148/1N914, 1N5817-19 Schottky, BAT54, 1N750/4733/
  5231 zeners, 2N2222/3904/BC547 NPN, 2N2907/3906/BC557 PNP) now emit their real
  LTspice `lib/cmp/standard.*` parameters into the deck and the device line uses
  the part name. Live-verified in ngspice (1N750 zener clamps at 4.67 V). Generic
  `TAU_*` covers only deliberately generic parts. **Named model chooser landed
  (2026-08-03):** diode/BJT/JFET/MOS Properties lists only compatible definitions
  from the document, attached Model Libraries, and Tau's exact bundle, with the
  winning source named beside each part. Wrong-polarity VDMOS choices are absent;
  unresolved imported names remain selected and refuse atomically before any
  engine call. The Class-D pair RSR015P06/QS6K1 is selectable without syntax and emits
  exact three-terminal VDMOS cards. Generic MOS W/L/KP/VTO are named controls and
  KP/VTO now build a real per-instance Level-1 model instead of being ignored;
  exact vendor models hide inapplicable override fields. The desktop app also
  discovers the user's four installed LTspice `standard.*` databases before the
  first runnable UI and consults them after document attachments, without
  persisting or redistributing those files. The canonical corpus is 80/82 with
  zero named-model substitutions. **NEXT:** browser TS-solver model parsing and
  broader compatible vendor-subcircuit resolution.
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
  ✅ **class-d's `RSR015P06`/`QS6K1` are now bundled** (2026-07-03,
  `standardModels.ts`): verbatim LTspice `standard.mos` VDMOS lines with
  `Cgso`→`Cgs` renamed (ngspice's parameter name — "unrecognized parameter
  (cgso)" otherwise, live-verified) and mfg/Vds/Ron/Qg annotation keys
  stripped; `standardModelType` reports them `vdmos` so they emit 3-terminal.
  **NEXT:** more standard.mos parts as corpus files need them; browser
  TS-solver VDMOS; body-diode + thermal node.
- 🟡 Comparators / logic gates / digital (LTspice `A` devices) —
  **Class-D's PWM stage does not need this path** (2026-08-04 re-measure):
  `class-d_starter.asc` uses `OpAmps/UniversalOpAmp2`, which imports as
  `opamp` and emits the rail-clamped tanh B-source; Efficiency + waveform
  parity vs LTspice are green under `scripts/dod-parity.sh`. Missing sibling
  `deadtime` still refuses Run. Remaining work here is LTspice `A`-device
  gates / comparator-library symbols for other circuits, not the flagship.
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
  - ✅ **UniversalOpAmp2 open-loop rail behavior SOLVED (2026-07-03)** — see the
    rail-clamped op-amp item in §7: an op-amp whose V+/V− pins are driven now
    emits `Vmid + Vhalf·tanh(Avol·Vd/Vhalf)` and clamps to its rails in any
    usage (feedback OR open-loop), which is exactly LTspice's behavior. The
    finding below is resolved; the dedicated `comparator` kind remains for
    supply-less comparator symbols.
  - ✅ **Digital `A`-device gates landed (2026-07-04)** — path-gated
    `Digital\{inv,buf,buf1,and,or,xor,schmitt,schmtbuf,schmtinv}` import onto a
    behavioral `digitalGate` kind and `dflop` onto a `dflop` kind
    (`engine/digitalGateSpec.ts`). Combinational/Schmitt gates emit a B-source
    ternary per connected output (`V=((cond) ? vhigh : vlow)`, cond
    parenthesized so the Schmitt sub-ternary doesn't get swallowed by
    right-associativity); DFLOP emits an XSPICE `adc_bridge → d_dff →
    dac_bridge` chain at the gate's parsed levels/threshold. Pin banks are
    id-mapped (each `.asy` exposes a SUBSET of the 8-slot SpiceOrder contract,
    so mapped by pin id, not positional zip). Diagonal-wire netlist fix so
    crossing diagonals don't falsely merge (Electrometer dflop feedback
    overpass). Warning-clean 71→73. 24 tests. **Embedded-library hardening
    (2026-07-16):** Tau now explicitly loads every bundled ngspice code-model
    module before accepting decks, because `ngSpice_Circ` does not source the
    CLI's `spinit`; fatal parser/MIF messages are rejected even when libngspice
    returns status zero, preventing stale prior vectors from masquerading as a
    successful run. The reported two-DFF 01→11→10 register deck is an ignored
    real-library smoke test and passes against the packaged app's own dylib.
  - **Landed (2026-07-04): `sampleHold` kind** — `SpecialFunctions\sample`
    (SAMPLEHOLD) imports with its id-mapped `.asy` pin bank and emits a real
    behavioral track-and-hold (`engine/sampleHoldSpec.ts`): S/H mode = switch +
    hold cap between B-source buffers; CLK mode = master-slave stage pair that
    latches on the rising edge (a one-shot window was rejected — the solver
    steps over ~100 ns control pulses). Both modes verified against
    hand-computed sine samples in `scripts/sampleHoldParity.corpus.ts`.
    Net-label endpoints now count as connections (a single-pin net probed via a
    bare flag — LTspice's probe idiom — is not "floating"). Warning-clean
    73→**74**. 13 tests.
  - **Landed (2026-07-04): `modulator` kind** — `SpecialFunctions\modulate`
    (MODULATOR, behavioral VCO) imports with its id-mapped `.asy` pin bank
    (FM=1, AM=2, Q=7, com=8) and emits an XSPICE `sine` controlled oscillator
    (`engine/modulatorSpec.ts`): `cntl_array=[0 1] freq_array=[space mark]` is
    exactly LTspice's linear FM law, wrapped in B-source buffers for the com
    reference and AM amplitude scaling. Live-verified in ngspice (FM=0.5 with
    mark=2K/space=1K measures 1.5000 kHz), including PLL.asc's `space=0` entry.
    `modulate2` (SIN/COS variant) stays on the skip path — XSPICE `sine` has no
    phase control and it's not in the corpus. PLL.asc is now warning-clean
    (its remaining `.op` failure is LTspice's `rand()` in a B-source, a
    separate unit). Warning-clean 74→**75**. 12 tests.
  - **Landed (2026-07-04): `rand()`/`random()`/`white()` B-source surrogate**
    — `statFuncsToNgspice` (simulation/behavioral.ts) rewrites LTspice's
    statistical functions (which ngspice lacks) to the deterministic uniform
    hash `frac(sin(floor(x))*43758.5453)` — a fresh [0,1) value per floor(x)
    increment, matching `rand(x)` semantics; `white()` shifts zero-mean.
    Live-verified (mean 0.546 over 150 bit periods). PLL.asc + PLL2.asc
    `.op` converge: op-converged 67→**69**. 7 tests.
  - **PHIDET landed (2026-08-02):** a two-DFF phase/frequency detector plus
    charge pump matches LTspice's polarity and accumulated phase-error waveform.
    Counter/srflop and comparator-library symbols not present in the release
    corpus remain explicit unsupported cases.
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
  (`K Lp Ls 1`, `K1 L1 L2 1`, `K3 L1 L2 .95`, the all-windings `K1 L1 L2 L3 L4 1`, parameterized
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
  The bare `K` designator accepted by LTspice is included (PowerSim LLC); it was
  formerly mistaken for a non-coupling line and silently dropped. 16 + 5
  hand-computed tests. **NEXT:** a placeable K symbol/UI (still must
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
  device line *when that model is defined*. An unresolved explicitly named
  semiconductor/switch now refuses the whole run; generic `TAU_*` models are
  reserved for deliberately generic parts. **User-attached vendor libraries
  landed** (`engine/userModelLibrary.ts`): `parseUserModelLibraries` folds
  attached `.lib`/`.subckt`/`.mod` text into a registry the deck builder
  consults after inline directives and before Tau's bundled parts, inlining the
  matched `.model` line or `.subckt` block so a deliberately attached local
  definition can override a same-named bundled part.
  **Unresolved-reference errors surfaced:** a `subckt` reference that resolves
  nowhere is reported on `SpiceDeck.unresolvedSubckts`, and the native runner
  fails fast through `userFacingErrorMessage` naming the missing part instead of
  handing ngspice a deck that dies with a cryptic "unknown subckt".
  **Transitive nested-X closure (2026-08-04):** `buildSpiceDeck` walks every
  inlined `.subckt` body for nested `X` instances — emits resolvable peer
  definitions from the document / user library / bundled blocks, and adds
  missing nested names to `unresolvedSubckts` (same honest refusal path as
  top-level). Local nested `.subckt`…`.ends` definitions inside the same body
  are not flagged.
  **Installed-library browser (2026-08-03):** Model Libraries now locates the
  user's own macOS LTspice data tree (`~/Library/Application Support/LTspice/
  lib`), searches its supported subcircuit/standard-model text files, and
  selectively attaches one chosen file to the current document. The real local
  install reports 2,698 attachable files and `UniversalOpAmp4.lib` reads cleanly.
  Tau never copies or embeds the user's 133 MB installed library. The native
  boundary is fixed-root/read-only, skips symlinks, limits recursion and count,
  accepts only model-text extensions up to 5 MiB, rejects traversal and binary/
  encrypted content, and retains the document's 64-file/20 MiB aggregate caps.
  The four implicit installed `standard.dio` / `.bjt` / `.mos` / `.jft`
  databases are loaded into ephemeral runtime state before the UI renders, so
  named parts behave as they do in LTspice without inflating the document or
  redistributing third-party assets. Explicit document attachments retain
  first-definition priority.
  **Native subcircuit chooser (2026-08-03):** every resolvable block is now a
  source-labelled Properties choice with its exact named terminal count and
  declared parameter defaults; missing blocks remain selected and explicitly
  blocked with a Model Libraries action rather than accepting a raw X value or
  guessing behavior. Formal parameters on `+` header continuations and
  case-insensitive instance overrides are covered.
  **Menu-first Class-D gate driver (2026-08-03):** Tau now bundles an original
  five-terminal `TauDeadtimeDriver` block for VCC / VEE / PWM / high-side gate /
  low-side gate. Properties exposes Dead time, Input threshold, Hysteresis, Gate
  transition, and Output resistance as bounded named controls with units; the
  canvas carries no raw `X...` or delay expression. The one shared subcircuit
  source uses the packaged XSPICE ADC/event-buffer/DAC path: the outgoing device
  turns off immediately and the incoming device turns on after the requested
  interval. Embedded-library regressions prove 200 ns on -10/+10 V rails and an
  edited 400 ns on 0/5 V rails within 2 ns, with zero simultaneous-on command.
  **NEXT:** optional extra user-authorized library search roots beyond the
  project folder + installed LTspice tree; browser TS model physics.
  **Nested confined `.include`/`.lib` (2026-08-04):** `importProjectAsc` now
  BFS-follows `.include`/`.inc`/`.lib` cards inside auto-resolved library text
  through the same project-relative + installed-LTspice confinement (extension
  allowlist, no `..`, aggregate caps, cycle-safe). Peer files attach as their
  own model-library entries; the deck sanitizer still never sees a file-backed
  card. Covers the AD8310.lib → UniversalOpAmp2.lib pattern.

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
  **temp** carries the requested analysis temperature. Ordinary sweeps now run
  in full (including 100-point ranges); a product above the 256-run safety limit
  is refused before the first solver call with “No partial results were run.”
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
  merging the innermost temperature. `App` drives it for any 1..N runnable specs.
  Every successful transient member evaluates the authored `.meas` directives
  against that member's waveform and step-param scope; `StepPlot` displays the
  resulting step / measure / value rows instead of losing `.step × .meas` data.
  **AC/DC-domain step families now landed (engine)** (`simulation/stepAnalysisFamily.ts`):
  a generic `runStepFamily<R>(specs, params, components, run, resultOk,
  resultWarnings)` re-runs *any* synchronous solver once per nested-`.step`
  context (reusing `nestedStepContexts`), collecting a labelled `AnalysisFamily<R>`
  — no-spec / expansion-error paths surface a clear `ok:false` message. Thin
  `runAcStepFamily` (family of Bode sweeps) + `runDcStepFamily` (family of DC
  transfer curves) wrappers drive the TS `runAcSweep`/`runDcSweep`. 9 hand-computed
  tests: an RC low-pass whose stepped R shifts the −3 dB corner (≥4 dB extra
  attenuation for 2× R), and a divider whose stepped top resistor tracks the ratio
  (Rt=1k→½·Vsweep, Rt=3k→¼·Vsweep). **P1.6 native `.step` (2026-08-04):**
  `emitNativeStep` deck flag (default off) + `stepLinesFromDirectives`;
  `runNativeSteppedTransient` emits once and consumes `extraPlots`+current as a
  `StepFamilyResult`. **Mutually exclusive** with the TS re-run loop (that path
  never sets the flag — would double-step). Eligible: **source** + **param** +
  **temp**. Stock ngspice rejects the `.step` *card*; Rust `step_expand`
  strips it and multi-runs (temp via `.temp`, source via `alter`, param via
  rewritten `.param`). Resistors emit ngspice-visible `tc1=`/`tc2=` from
  LTspice `tc=`. Param braces inside SINE/PULSE/PWL/… or `AC {…}` fall back to
  TS. `MAX_EXTRA_PLOTS` 255. **AC/DC native step (2026-08-04):**
  `runNativeSteppedAcSweep` / `runNativeSteppedDcSweep` reuse the same
  emit + Rust `step_expand` + multi-plot assemble path; App wires them into
  AC/DC runs and the STEP tab (domain from authored `.ac`/`.dc` via
  `stepAnalysisDomain`). TS `runAcStepFamily` / `runDcStepFamily` remain the
  exclusive fallback (never `emitNativeStep`). Per-trace pick in the overlay
  legend still open.
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
  **P1.6 native path (2026-08-04):** deck emission + `parseNativeFourier` log
  parse — UI prefers ngspice's printed table when present; TS `runFourier`
  remains the fallback when the log has none.
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
  7 hand-computed tests. Native AC results now add source/inductor `#branch`,
  saved semiconductor terminal, and phasor-derived R/C traces, so
  `mag(I(L1))`, `ph(I(Q1))`, and `.meas ac` current expressions resolve. The
  installed-ngspice corpus holds `I(L1)` against the series resistor phasor at
  every frequency. All four spectral/sweep `.meas` domains run.
  **Menu-first measurement authoring (2026-08-03):** Simulation Setup decodes
  imported aggregate/derived measurements into named rows and authors AVG/RMS/
  MAX/MIN/PP/INTEG results over node voltage, component current, power absorbed,
  or power delivered by a source. Power expressions are derived from extracted
  terminal connectivity; chained PARAM rows expose formulas such as `PL / PS`
  without exposing a `.meas` line. The Class-D `PS`/`PL`/`Efficiency` set
  round-trips exactly. Optional windows are named fields; invalid or duplicate
  rows block Apply. Unsupported WHEN/TRIG/TARG forms and unrelated directives
  remain byte-for-byte in Expert until their dedicated controls land.
  **P1.6 deck emission + native log parse (2026-08-04):** domain-matched
  `.meas`/`.measure`/`.four` cards ride in the native netlist after the analysis
  line (`measFourLinesFromDirectives`); `parseNativeMeasurements` /
  `parseNativeFourier` read ngspice's printed results from the engine message
  log and `App.tsx` prefers those when present (TS runners remain the fallback)
  for transient, AC, and DC native runs. **Native `.step` (2026-08-04):**
  source + param + temp single-deck emit + multi-plot consume via
  `emitNativeStep` / `runNativeSteppedTransient` / Rust `step_expand`
  (stock ngspice has no `.step` card; resistors emit `tc1=`/`tc2=` from
  LTspice `tc=`). **AC/DC:** `runNativeSteppedAcSweep` /
  `runNativeSteppedDcSweep` + STEP-tab domain from authored `.ac`/`.dc`.
  Unsupported param brace shapes stay on the TS re-run loop (mutually
  exclusive — no emit under that loop).
- ✅ **DC operating point annotation on schematic** (show node V / device I
  in-place, 2026-07-02) — after an OP run, the simulator-mode canvas labels
  every non-ground net with its DC voltage (cyan, at the net's
  topmost-leftmost point) and every V-source/inductor with its MNA branch
  current (amber, centered under the body). Native `.op` also requests and
  displays device bias/small-signal data (diode VD/GD; BJT VBE/VBC/GM/GPI/GO;
  MOS/JFET VGS/VDS/VDSAT/GM/GDS) and classifies cutoff, active/linear, and
  saturation regions from the returned operating point. Pure resolver
  `simulation/opAnnotations.ts` (5 tests on a real divider run: V(out)=Vin/2
  at the hand-computed anchor, I(V1)=−5 mA, ground skipped, stale/failed/null
  inputs degrade to []); `runOperatingAnalysis` now requests `returnBranches`
  from the JS solver (native ngspice path annotates voltages only). Labels
  use a background stroke for readability over wires. Live-verified via
  Playwright on the divider example: 10 V / 5 V / −5 mA all placed correctly.
- 🟡 Initial conditions **`.ic` / `.nodeset`** — `buildSpiceDeck` carries node
  voltages and `.nodeset` through to native ngspice. LTspice-only inductor
  current assignments (`.ic I(L1)=…`) are translated to the winding's instance
  `IC=…`; a reference made stale by deleting the inductor is omitted with a
  concise warning instead of producing ngspice's fatal `.ic syntax error`;
  when any `.ic` is present the `.tran` line gains **`uic`** so the values hold at
  t=0 (LTspice semantics) rather than only biasing the OP. Live-verified in ngspice
  17 (`.ic v(cap)=2` → cap starts at 2 V; `I(L1)=250m` → 250 mA). **`C`/`L` per-instance
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
- 🟡 Transient scope — `SimulationPanel.tsx` (downsamples large native results ✅).
  **§11 simulator workspace landed (2026-07-10):** the simulator keeps a
  selectable, topology-read-only schematic beside the analysis, automatically
  creates one plot card per named/probed signal and labels V/A/W axes
  semantically. **Instrument plot overhaul (2026-07-12):** signal cards now
  stack vertically for time correlation, share their horizontal zoom/pan
  window, retain independent Y autorange, expose 190–340 px plot-height
  controls, and show familiar zoom-responsive tick intervals plus in-plot
  MIN/AVG/MAX reference lines. Each card has a compact RMS/final, peak-to-peak,
  and frequency readout; complete statistics stay in a disclosure. Current-flow
  arrows/toggle/readout were removed until the
  electrical model is mature enough to represent them without confusion.
  **Resolution-control correctness (2026-07-23):** every transient override is
  clamped through the circuit-derived sampling requirement before either the UI
  or run path can consume it. The STEPS slider's minimum moves to that required
  count (bounded by the active runtime cap), so users cannot select an
  under-sampled run; STOP uses the shared engineering editor and accepts
  exponent notation without accepting words. **Imported-analysis intent
  (2026-07-23):** the global Run command now follows the first valid authored
  `.op`/`.tran`/`.ac`/`.dc`/`.tf`/`.noise` directive, the analysis rail opens on
  that mode, and base AC runs honor the imported `dec`/`oct`/`lin` settings
  instead of silently substituting an automatic sweep. Clean `.asc` imports no
  longer show an unsaved dot merely because the store regenerated internal
  IDs; duplicate-reference errors name the duplicated component and count.
  **Transient-settings semantics (2026-08-03):** the raw STEPS slider and
  opaque refine-and-rerun transport action are removed. The primary settings
  now distinguish **Circuit duration** (simulated physical time, with
  ns/µs/ms/s/min units) from **Waveform detail** (Quick/Balanced/Precision,
  derived from the fastest source and time constant). Exact output points stay
  available under an Expert disclosure for reproducibility. Tau reports the
  measured elapsed time after a real run rather than predicting solver time.
  Settings provenance reads AUTOMATIC, DOCUMENT, or CUSTOM; a custom reset
  returns to the imported `.tran` when present, and switching/opening a circuit
  clears the preceding document's manual override. The cycle-density mapping,
  runtime cap, human-duration input, provenance/reset, App workspace import
  path, and two-button Run/Stop transport have regression coverage.
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
  **One probe per net (§UX, dedup by net identity, not exact position)**:
  `addProbe` previously deduped on exact `x===x && y===y`, but wire clicks
  snap to varying midpoints, so re-probing the same net from a different
  point stacked a second probe ring on it. Now resolves both the click and
  every existing voltage probe through `netAtPoint` (the same net-identity
  authority §6's plot-open→click-wire→trace path already uses) and keeps at
  most one voltage probe per net: same point again removes it (toggle off),
  a different point on the same net **moves** the marker there instead of
  duplicating. Clicking empty canvas is a no-op; an isolated pin with no wire
  still probes (a valid, if unconnected, net). Current/clamp probes dedup per
  component in `toggleCurrentProbe`. 7 new store tests.
  **Interaction contract tightened (review pass, 2026-07-16):** Select-mode
  component clicks focus telemetry and never create a probe implicitly. In the
  explicit Probe tool, a wire/pin click toggles voltage while a component-body
  click toggles its real branch-current trace over time. Probe dots remain
  keyboard/click removable. The Name tool adds/renames/removes the one name per
  physical node. Components, values, wires, and topology remain immutable.
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
  Transient derived traces/reference/export controls now live under a
  closed-by-default **Advanced plot tools** disclosure.
  **NEXT:** expression traces in the step pane; dual axis for mixed V+A.
- 🟡 Multiple plot panes and autorange — **landed for the
  transient scope** (`plotPanes.ts` pure pane model + per-pane Y autorange,
  with manual pane add/remove/move removed from the default UI so plots remain
  consequences of node names/probes). **Automatic signal
  cards + default statistics landed (§11 D9/D11/D12):** each visible trace gets
  its own initial card, steady/transient/periodic classification, estimated
  frequency for periodic data, and compact min/max/average/RMS/final readouts
  using engineering units (`measurementModel.ts`; 29 pane-model + 9 measurement
  tests). The 2026-07-12 overhaul replaced the former two-column cards with
  full-width, vertically aligned instrument panes and synchronized time zoom.
  Still ⬜: AC/DC panes, manual axis limits.
- ✅ **Per-component simulator telemetry (§11 D10, 2026-07-10):** every named
  component receives a selectable row with voltage across, current through,
  instantaneous power, sparkline, and signal class. Voltage polarity follows
  the component's positive→negative terminal convention; current reuses the
  solver/native branch-current authority; positive power is absorbed and
  negative power is delivered. Periodic V/I use RMS; periodic power uses
  average real power. Selecting a part in the read-only schematic focuses its
  row without changing probes; explicit probe/name tools are the only circuit
  mutations exposed in the simulator. **Telemetry presentation overhaul
  (2026-07-12):** searchable semantic component cards provide spacious V/I/P
  readings, bounded waveform previews, an explicit Select control, and one
  shared sign-convention disclosure instead of repeated per-row prose.
  **Responsive dock follow-up (2026-07-14):** the primary V/I/P cards now live
  once beneath the read-only circuit, reflow to one column at the 300px floor,
  never require horizontal scrolling, persist a keyboard-resizable height, and
  cap that height so the circuit canvas remains usable at 900×600. The former
  duplicate analysis-column telemetry computation/UI was removed. **Current
  integrity follow-up (2026-07-14):** when ngspice omits a semiconductor branch
  vector, telemetry may recover it only by exact sample-by-sample KCL at an
  unbranched two-terminal net; junctions and multi-terminal paths are never
  guessed. A direct 5 V source/LED loop now reports the LED's +315 mA and
  +1.575 W instead of dashes while preserving the source's passive-sign
  −315 mA/−1.575 W. LEDs directly across an ideal voltage source receive a
  visible **direct drive · no external limiter** advisory that reports the
  model-predicted current and recommends a series resistor/current regulator;
  Tau does not invent a part-rating threshold it does not know. A completed
  zero-current direct-drive result remains `0 A`/`0 W` with no advisory, and a
  series-resistor case is covered against false positives.
  **Transient-understanding follow-up (2026-07-16):** compact dock cards now
  show separate, labelled V(t) and I(t) waveform previews only when those
  quantities classify as transient or periodic. The previews use bounded real
  simulation samples, never mix V and A on one scale, and explicitly direct the
  user to Probe for the full physical time-axis plot; steady parts keep the
  quieter numeric V/I/P presentation.
- ✅ **Measurement cursors** (1 & 2, delta readout) — `simulation/cursors.ts`
  (`cursorReadout`/`fractionToX`, 8 unit tests) + a collapsible **Cursors** panel
  on the transient scope (`SimulationPanel` `CursorView`). Two sliders position
  cursors along the run; a meter row shows t1/t2/Δt/(1/Δt) and a table lists each
  signal's value at C1, C2, and the delta. Reuses the tested `interpolateAt`
  resampler so readings are interpolated between samples.
  **Engineer-facing cursor redesign (2026-07-23):** C1/C2 are now shared across
  every visible transient plot and drawn as labelled, color-distinct vertical
  lines on the waveform. Sliders remain for coarse placement, while dedicated
  engineering-value fields accept exact C1/C2 endpoints (including exponent
  notation) for precise time-interval measurements. Packaged-app QA on a real
  200,015-sample native run verified the plot lines, full `781.25 ms` /
  `2.34375 s` fields, interpolated signal table, Δt, and reciprocal-frequency
  readout at the 900×600 minimum.
  **Direct trace interaction (2026-08-03):** each transient channel is now
  selectable beside its plot with Tau's validated color-safe palette. C1/C2
  activate directly from that channel and glide over interpolated plot data by
  mouse hover or captured touch drag; keyboard arrows provide fine adjustment
  and Pan restores plot navigation. Every pane keeps the shared vertical lines,
  while the selected channel adds a colored sample point and inline physical
  value/time chip. The table now carries each signal's real V/A/W/etc. unit
  instead of hard-coding volts. Exact-time fields and plot movement share the
  same fractions. Regression coverage includes zoom-aware pointer mapping,
  touch/mouse control wiring, palette application, unit propagation, and the
  real SimulationPanel activation path.
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
  **Detailed spectrum inspector (2026-07-12):** FFT now annotates the dominant
  tone and first five harmonics on the plot, reports resolution, DC, median
  per-bin noise floor, SFDR, THD, and THD+N, and lists up to eight harmonic
  peaks with dB/dBc values. Harmonic lookup is binary-search based and covered
  by a 131k-bin regression, avoiding quadratic work on large native spectra.
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
- ✅ **Real tick axes on every plot context** (§UX Unit B, owner feedback: "the
  table is completely devoid of x/y labels") — new pure `simulation/axisTicks.ts`
  (nice-number 1/2/5×10^n ticks, log-decade ticks, SI-prefixed unit labels
  reusing `formatEngineering`, 33 tests) rendered via a shared
  `components/PlotAxes.tsx` (gridlines AT tick positions, stronger zero-line,
  tick count shrinks with measured pixel size so labels never collide down to
  the 900×600 minimum window). Wired into all 8 plot render sites — TRAN
  (incl. multi-pane, one `useMeasuredSize` per pane), AC mag+phase, DC sweep,
  FFT, noise density, and the three `.step` family plots. 5 component tests
  (`SimulationPanel.axes.test.tsx`). **Desmos-style zoom/pan** (cursor-anchored
  wheel zoom, drag pan, auto-fit ⌂) — see `simulation/plotViewport.ts` — lands
  in the same unit's second commit. **Transient scope follow-up (2026-07-14):**
  traces are always unfilled lines, dense periodic/pulse data is reduced with a
  per-pixel min/max envelope so narrow extrema survive, Home fits the full X/Y
  result. **Interest-frame follow-up (2026-07-15):** Auto Frame classifies the
  waveform, shows the final four cycles of the slowest periodic trace, fits Y to
  only that window, and publishes X to every shared pane; nonperiodic data keeps
  the user's current X window and fits visible Y. Show Full Run remains a
  distinct action. Flat, negative-only, tiny-range, startup-outlier, 100 kHz / 7
  ms density, and dense-square-wave regressions keep padding useful without
  inventing a giant zero-based area or an opaque 700-cycle block. **Axis polish
  follow-up (2026-07-16):** plot padding and title offsets now give unit labels
  breathing room, while visible tick spacing selects 3–9 significant digits so
  deep zoom produces distinct, numerically accurate labels instead of repeated
  rounded values. Transient paths also reserve a small SVG edge gutter, keeping
  round-capped traces visibly inside the right frame without changing the time
  domain or tick values. Femtoscale native-solver residue on a physically steady
  engineering signal now receives steady-signal framing instead of generating
  visually duplicate, crowded Y labels.
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
  Per-member `.meas` results are shown below the transient family. Pending:
  per-trace selection, cursor readout.
- 🟡 Save plot settings (`.plt`), export image/CSV — **CSV + PNG export landed**
  (`simulation/waveformCsv.ts` `seriesToCsv`): an **Export CSV** button on the
  transient scope writes a table of `time` + every node-voltage trace + branch
  current + plotted expression, one row per timestep (RFC-4180 quoting,
  non-finite samples as gaps). **Export CSV buttons on the AC pane** (freq +
  per-trace mag(dB)/phase(°)), **DC pane** (swept source + each net voltage),
  and **noise pane** (freq + onoise V/√Hz + inoise) too, sharing a `downloadCsv`
  helper. **Export PNG** rasterizes every visible transient SVG pane into one
  two-column, 2× image; computed theme/trace styles are inlined so the file is
  faithful outside the app, and a multi-pane dashboard is never reduced to its
  first plot. 6 hand-computed/DOM tests. **NEXT:** `.plt` settings and
  step-family CSV (per-member time grids).
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
- ✅ **Real-`.asc` truthful op-deck run is 80/82** (was 45/82 when first measured this
  session) — i.e. how many acceptance decks ngspice actually solves an operating
  point for, not just builds. Driven up by: a **default `rshunt=1e12`** (every node
  gets a DC path — 19 op-amp/AC-coupled circuits stopped throwing "singular
  matrix"); **`LPNP`/`LNPN` → `PNP`/`NPN`** (discrete LM741/LM308); splitting
  **multi-directive TEXT blocks** on `\n` so `.ic`/`.tran` don't collapse
  (Draft6); **rewriting `K` coupling refs** to renamed inductor instances
  (Electrometer); and **bundled library subcircuits** (2026-07-05:
  `engine/bundledSubcircuits.ts` embeds opamp.sub +
  TowTom2/capometer/ISO16750-2/ISO7637-2 pre-sanitized — capmeter, both ISO
  demos, opamp.asc and logamp.asc now converge); and a **default
  `rseries=1e-3`** matching LTspice's documented 1 mΩ inductor Rser default —
  un-degenerates pure-L loops at DC (Cohn/passive/varactor2 now converge);
  and **{param} substitution on passthrough `.model` lines** (Fc converges —
  document `.param`s are consumed into Tau's scope, so braces on passthrough
  lines must be resolved at deck build; subckt bodies stay verbatim).
  The 4 that still don't run: ~~PLL/PLL2 use LTspice's `rand()`~~ (fixed
  2026-07-04: statFuncsToNgspice surrogate — both converge),
  ~~SoftDiodeRecovery/P2/UHFpreamp/LoopGain2~~ (fixed 2026-07-05: per-line
  TEXT-block dispatch + `+` continuation folding + `type=silicon` strip +
  Q-on-subckt → X rewrite + Mn rotate-then-mirror orientation), and
  ~~logamp~~ (fixed 2026-07-05: imported current-source polarity — LTspice's
  `−` pin zips onto Tau's p because isource emission swaps to `I n p`; the
  identity zip ran every imported I source backwards and logamp's starved
  bias node hung gmin stepping). **Zero remaining op failures.**
  **Extended-corpus correction (2026-08-03):** after named-device substitution
  was made fatal, the full 4,012-file run reports 4,012 imported/schema-valid,
  522 warning-clean, 228 deck-built, 167 synthetic-op converged, 61 non-refusal
  hard failures, 3,784 honest unsupported refusals, and zero model
  substitutions. The canonical subset remains 80/82 build/converge. This is an
  honest compatibility baseline, not an LTspice-killer claim; vendor symbol and
  macromodel coverage plus authored-analysis differential results must improve
  materially before completion.
  **Passive-parasitic compatibility (2026-08-03):** LTspice C/L instance
  `Rser`, `Rpar`, and `Cpar` inside installed vendor subcircuits now expand to
  the exact documented series/parallel topology with explicit native elements;
  the original C/L identity remains available to probes and K coupling. Literal
  zero series resistance is elided, parameter expressions survive, and `m=`
  combinations refuse until per-unit scaling is proven. The full corpus hard-
  failure count falls from 61 to 14 and native OP convergence rises 167→214.
  Numeric LTspice ideal-diode model names (for example AD8033's `.model 2p`)
  are now rebound to deterministic valid XSPICE identifiers without changing
  safe vendor names, bringing hard failures to 12 and native OPs to 216.
  Positional diode area inside local-model subcircuits is rewritten from
  LTspice's `D… model 1000` to the electrically identical `area=1000` keyword;
  this avoids ngspice's malformed double-scope model lookup and moves the same
  metrics to 7 hard failures / 221 native OPs.
  LTspice 17.2.4 measurements of the undocumented G-source `dir=±1 vto=V`
  extension established `I = dir·gain·max(dir·(Vcontrol−vto), 0)²`; Tau now
  emits that exact one-sided square-law transfer as a behavioral current
  source. Both directions and the refusal path are regression-tested. LT1208,
  LT1209, LT1220, LT1221, LT1225, and LTC1049 now converge, taking the same
  4,012-file corpus to 228 native OP convergences, zero non-refusal hard
  failures, 3,784 explicit unsupported refusals, and zero substitutions. The
  remaining refusals are the next compatibility workload; zero hard failures
  alone is not an LTspice-killer claim.
- ✅ **Class-D fidelity — the flagship circuit now SIMULATES correctly
  (2026-07-03), proven by a committed runner** (`scripts/classdParity.corpus.ts`,
  runs with `scripts/acceptance-corpus.sh`). Two fixes:
  (1) **Rail-clamped op-amp** (`engine/opampSpec.ts`): an op-amp whose V+/V−
  pins are driven (net has ≥2 pins, or is ground) emits a B-source
  `Vmid + Vhalf·tanh(Avol·Vd/max(|Vhalf|,0.5))` — Avol parsed from the imported
  `Avol=…` (UniversalOpamp2's Value2, now carried by `componentValueFromAttrs`),
  default 1e6; floating-supply op-amps keep the classic unbounded E-source.
  Formulation battle-tested against the corpus: hard min/max clamp broke 5
  feedback circuits (singular matrix), the E+clamp-diode macro broke open-loop
  usage (~1e5 A through the clamp), tanh with a 0.5 V divisor floor passes all
  (a 1µ floor breaks ngspice source stepping — slope 1e12 at early steps).
  (2) **Real power VDMOS models bundled** (QS6K1 + RSR015P06, see §3) — the
  half-bridge previously fell back to Kp=200µ signal-level starters and made
  ~0.1 V into 8 Ω. Measured (ngspice, .tran 0 3m): vpwm exactly ±10 (rails),
  vo −8.3…+9.8 V tracking the 7.5 V/1 kHz program, avg −16 mV. Corpus floors
  hold at 82/71/79/64.
  **Release proof update (2026-08-02):** `scripts/dod-parity.sh` runs the
  unmodified owner fixture through Tau's importer/deck path, evaluates its own
  three authored `.meas` directives with Tau's measurement engine, and compares
  Efficiency to installed LTspice within 2%. The same gate compares RC and
  Class-D traces point-for-point and the unmodified educational Colpitts
  oscillator by amplitude, RMS, and frequency. All four proofs pass headlessly.
  **Differential matrix slice (2026-08-04):** `scripts/differential-parity.sh`
  (wired into `dod-parity.sh`) prints pass/sibling/gap coverage to stdout
  (truth). Gap-closure pass → **pass=18 · sibling=5 · gap=2**: prior cells
  plus expanded `.step` temp/source/nested, Educational steptemp OP +
  stepmodelparam Vaf expand, Colpitts AC (AC stim on V1), Class-D OP
  (linear L1; harness strips `@device` save wraps). Remaining gaps: native
  step_expand vs LTspice `.step` card; Class-D AC/DC/noise/tf. DoD
  broad-differential box remains open — see AGENTS.md.
- 🟡 Resolve a real device-model set — **common LTspice standard diodes/
  zeners/BJTs + the class-d power VDMOS pair bundled** (`engine/standardModels.ts`,
  real `standard.*` params, emitted by `buildSpiceDeck` when referenced by name).
  The desktop app additionally uses the user's installed standard diode/BJT/
  MOS/JFET databases in place. Unresolved named parts refuse; only an explicitly
  generic catalog choice receives a starter model.
- 🟡 Convergence aids — a baseline `rshunt=1e12` ships in the default `.options`
  so floating-node circuits solve; gmin/source stepping not yet surfaced to user.
- ⬜ Per-analysis ngspice option mapping

## 8. UX / app
- ✅ IDE-style shell, multi-tab, command palette, settings, status bar engine indicator
- 🟡 **Visual QA on the actual desktop app:** the current Tauri hot-reload app
  stays alive on `auto/ltspice-parity`; live browser QA verified centered
  simulator fit/Home, the cross-mode assistant, and no horizontal overflow at
  900×600. A persisted-width stress pass maximized Explorer and Assistant and
  still held `shell.scrollWidth === 900` with the editor reachable. A fresh
  unsigned release bundle now also launches and stays alive, created a canonical
  ASC on disk in the selected native folder, and exposed the same Components +
  Assistant stack; the live 900×600 check measured body `scrollWidth === 900`
  with both tools reachable. Remaining: repeat the *full* screenshot matrix in
  the packaged build.
- ✅ **One circuit-aware assistant in both modes (2026-07-14):** a single
  top-right toolbar entry opens the same assistant beside Schematic or
  Simulator. Context is built from the real document/result; Anthropic tool
  output is parsed/validated as supported LTspice ASC and shown as an explicit
  Create action rather than silently changing the circuit. The API key is
  persisted through the native OS keychain (never web/project storage), and a
  bounded project transcript follows the user across every open schematic and
  app mode. Closing the panel synchronously archives the active transcript;
  reopening or choosing Past chats restores it. Legacy per-file sessions merge
  into project history without replacing the active thread. For exact post-run questions, a
  bounded private `inspect_simulation_signal` operation evaluates real transient
  vectors/expressions and returns min/max/average/RMS/final/classification to the
  model; tool syntax and payloads never appear in chat. CSP, action validation,
  collision-safe disk creation, private tool continuation, and mocked streaming
  paths are covered. **Current-circuit editing follow-up:** Components and the
  Assistant are separate sibling columns with independent resize boundaries;
  neither is an overlay and opening Assistant does not replace the component
  library at normal desktop widths. At the exact 900px minimum an explicitly
  opened Assistant keeps Components beside it; the passive Explorer yields
  first because all three minimum widths cannot physically fit. Selecting
  Explorer explicitly swaps it with Components, while closing Assistant restores
  Explorer without an overlay.
  A complete validated `apply_current_asc_circuit` proposal replaces the
  active document only after confirmation, records one undo step, preserves
  resolvable probes, marks the file dirty, and invalidates stale analyses;
  incomplete/lossy/oversize serialization disables the operation. **Local MLX
  provider follow-up:** Settings now offers local Qwen3 4B (recommended) and
  1.7B presets plus Anthropic, with cache-aware Start/Stop and an explicit
  download-size confirmation. Users can also persistently import/select/remove
  any MLX-compatible Hugging Face `owner/model` repository; both TypeScript and
  Rust validate the identifier, and Rust passes it as a direct process argument
  without a shell. Removing a registration deliberately leaves shared cache
  weights untouched. Native inference is fixed to `127.0.0.1:8080`
  with audited built-in repositories and allowed origins. The model emits only logical
  plans and exact `ref.pin` nets for 29 safe library kinds;
  Tau validates, auto-places,
  obstacle-routes, serializes, re-imports, proves requested net connectivity and
  isolation, and asks for confirmation. Comparator, potentiometer, transformer,
  static switch, CCCS, and CCVS requests lower into portable LTspice primitive
  networks instead of false single-symbol mappings. Live 4B tests created a
  protected 5 V LED, a powered inverting amplifier, and a loaded 1:2 transformer
  through this boundary.
  Malformed/missing-part plans receive at most two private repair attempts and
  never reach the canvas or disk; an MLX server bug that reports a tool-call
  finish without returning the payload recovers via strict whole-body JSON.
  Op-amps export as LTspice `opamp2` and MOSFETs as `nmos4`/`pmos4` so the
  five-pin native role bank survives save/reopen; kinds without equivalent pin
  geometry are never silently advertised as a stock symbol.
  **Cloud architecture follow-up (2026-07-15):** Sonnet now emits the same
  compact logical `ref.pin` circuit plan as local MLX; Tau owns validation,
  layout, obstacle routing, ASC export, and re-import proof. This replaces the
  slow coordinate-heavy raw-ASC generation/recursive-payload repair path while
  retaining exact ASC only for current-document edits. One validator-guided
  correction is bounded to the original compact transcript; full failed tool
  payloads are never echoed back. New builds use medium effort/6k output behind
  a progress-aware lifecycle: Sonnet gets two minutes to connect, then each
  thinking/text/tool event rearms a two-minute inactivity deadline, with a
  12-minute absolute build ceiling (six minutes for read-only questions).
  Stop and terminal deadlines invalidate late/replayed SDK events, so stale
  completions cannot apply a circuit. Ordinary questions still get only the
  read-only inspection tool at low effort/2.5k output. Recurring history is
  capped at 12 messages/12k chars,
  current ASC is sent only for edit intent, and static prompt/tool content uses
  Anthropic prompt caching. The shadcn-grade run card shows Plan → Validate →
  Ready, a real countdown/Stop action, and a duration/pass/token/cache receipt.
  Failed/interrupted turns restore as an exact Retry after reload; validated
  Create/Apply cards and their receipts also survive reload. The packaged app
  created and simulated a 10 kHz LC tank in ~15s (1,152 transient samples plus
  AC) and a 13-part/21-wire Class-D plan in ~25s (200,012 ngspice samples,
  measured 1 kHz input/100 kHz carrier/±15 V PWM). Keychain reads/writes now run
  off Tauri's UI thread, so an unsigned-build SecurityAgent authorization can no
  longer leave a black frozen window. The packaged app also uses the circuit-
  trace Tau icon at every platform asset size instead of the placeholder mark.
  **Project + Tauri UX follow-up (2026-07-16):** startup is now project-first:
  editing, simulation, component tools, and AI stay disabled until the user opens
  or creates a folder, and every AI-created schematic is written inside it.
  Disk-backed tabs derive an exact saved-document signature, show an unsaved dot
  after any mutation, and clear it only after a successful save. Tauri now has a
  resistor mark (faceless Bode; Sparkles retired 2026-08-04) and complete platform icon set, durable named chat
  sessions that can be reopened/deleted, editable user turns with branch-and-
  resend behavior, a shadcn model selector, a concise AI fallibility note, and
  deterministic quick prompts derived from the selected part, schematic, and
  latest results. Agent stop hooks keep the Vite/Tauri dev app attached and
  force a full reload; duplicate-process detection is scoped by process cwd.
  **Catalog/save hardening follow-up (2026-07-16):** all 35 Library entries now
  have a tested save/reopen path with no export warning or rewrite blocker, a
  finite ngspice `.op` deck, and a render contract with pins and finite bounds.
  Standard AC/pulse sources export natively; Tau-only symbols use validated
  Tau metadata on a benign LTspice carrier so they reopen exactly in Tau rather
  than blocking Save. Empty sheets select Library automatically, Simulator edit
  shortcuts explain that the view is read-only, and the minimum-width Assistant
  header gives its ellipsized model selector a dedicated row below visible New,
  History, Delete, and Close actions.
  **Semantic round-trip follow-up (2026-07-16):** ASC Save now reimports its own
  output and compares canonical terminal-connectivity partitions before writing;
  it cannot silently persist a drawing whose visible loop reopens as floating
  pins. Native Tau pin geometry carries explicit round-trip metadata, while the
  malformed geometry written by older Tau builds is detected from wire topology
  and repaired on open. The reported LED loop was verified from a fresh mounted
  DMG through open → save → bundled-ngspice run → reload → rerun as 3 nets / 4
  parts with no connectivity warnings.
  **Safe save + authoring follow-up (2026-07-23):** imported LTspice comments,
  positioned directives, and custom `SHEET` geometry now survive document
  history, persistence, assistant apply, and ASC save, eliminating the
  recurring comment blocker without weakening the remaining loss-risk checks.
  A toolbar Simulation setup dialog authors `.op`, `.tran`, and `.ac` through
  named fields, keeps expert cards under Advanced, and points new users to
  Pulse/AC Voltage components instead of requiring raw source syntax. Every
  dirty tab now closes through Save / Don't Save / Cancel; Save completes the
  disk write before closing. Packaged Tau proved the flow on the buck fixture
  and reran its bundled-ngspice transient after save/reopen.
  **Structured LTspice slot editing (2026-08-02):** the App validator now
  preserves/bounds `ltExtraAttrs` instead of dropping it on open. A minimal edit
  wholly inside one joined `Value2`/`SpiceLine` slot is written back to that
  exact slot; cross-slot transformations remain explicit refusals. Imported
  parameterized op-amps are labeled “Imported / custom” and expose their full
  Parameters line. The packaged app changed Avol in Value2 while retaining an
  untouched SpiceLine and emitted no collapsed Value record.
  **Release stress/security follow-up (2026-07-16):** a committed five-case
  adversarial suite now drives the logical-plan ceiling (80 components / 160
  pins), long PWL/identifier boundaries, ambiguous/dangling/case-colliding
  plans, crossing feedback meshes, ASC export/reimport/deck proof, and a real
  four-DFF mixed-signal ngspice transient. Large fanout uses repeated named
  flags and compiles in ~25–43 ms instead of 6–8 seconds. Narrow XSPICE ADC
  threshold bands and finite 10 ns DAC edges fix the reproduced
  vanishing-timestep failure under simultaneous RC loads. The native boundary
  accepts advertised safe inline model/analysis/subcircuit cards while
  rejecting external include/lib, control, shell, file-I/O, mutation, and code-
  model commands. Diagnostics, schematic files, and assistant prompts are
  bounded; symlink moves and unowned localhost AI listeners are refused;
  production CSP/CORS no longer inherit dev origins. The installed 3,995-file
  LTspice tree imports 3,995, builds 2,900 decks, and op-solves 2,895;
  unsupported proprietary models remain explicit rather than being claimed
  universally compatible.
- 🟡 Component picker matching LTspice (F2 part browser over the full library)
  — **F2 now opens the searchable part palette** (symbols, categories, hotkeys,
  ↑↓/↵ placement); remaining: coverage audit vs. LTspice's full library tree.
- 🟡 Keyboard shortcut parity — **LTspice function keys now bound**
  (2026-07-02): F2 part picker, F3 wire, **F4 net label**, F5 delete, F6 copy,
  F9 undo / Shift+F9 redo, alongside Ctrl+R rotate, Ctrl+E mirror, Ctrl+C/V/D,
  Space=rotate, W=wire, hotkey placement, ⌘K palette. The whole table lives in
  a pure resolver (`schematic/shortcuts.ts`, 27 tests — every binding + the
  guard that unrelated modifier combos pass through) and `App.tsx` just
  dispatches on it. Live-verified: F3→wire tool, F2→palette, F4→label input,
  F5 deletes the selected part, F9 restores it. **Still unbound on purpose:**
  F7 (move), F8 (drag) — Tau has no distinct move/drag tools yet (select+drag
  covers both); binding them to approximations would teach the wrong reflex.
  Those flip this item ✅ when the tools land.
- ⬜ Help / model docs, error console with SPICE messages
- 🟡 Crash-free on large/real circuits — the committed adversarial AI-plan suite
  and 3,995-file installed-LTspice sweep complete without a process crash.
  Remaining: native libngspice is in-process and lacks a hard cancellation/time
  budget, so an intentionally pathological deck can monopolize or crash Tau.

## 9. Packaging / distribution (to actually sell)
- ✅ Bundle `libngspice` reliably — `scripts/build-ngspice.sh` rebuilds the
  pinned commit with XSPICE, stages every required module, signs the macOS
  dylib ad hoc, and records SHA-256 for the exact resource tree. `build.rs`
  refuses stale target/commit/library metadata, missing or extra files, changed
  bytes, malformed digests, and escaping symlinks before packaging. Completion
  compares the verified staged tree with the mounted DMG and runs real OP and
  XSPICE tests against the library inside it (27/27 files verified 2026-08-02).
- 🧑‍💻 macOS code signing + notarization — **HUMAN-OWNED (Omar), does not gate
  completion** (see AGENTS.md → Definition of Done). Agent scope stops at an
  unsigned, production-ready DMG. Windows/Linux builds: later, out of DoD.
- ⬜ Auto-update, licensing/activation
- 🟡 Installer + onboarding — first-run Local AI setup dialog + one-click
  `Install MLX LM` (uv tool install) in the native app; unsigned DMG already
  builds. `uv tool install mlx-lm` installs the complete isolated transitive
  dependency environment; packaged-runtime QA confirms `mlx_lm.server --help`
  loads successfully. Unsigned builds request an explicit ad-hoc identity and
  deliberately leave hardened runtime for the human Developer-ID signing step:
  ad-hoc hardened runtime rejects bundled libraries because neither side has a
  Team ID. The unsigned app therefore loads sealed bundled ngspice end-to-end;
  `codesign --verify --deep --strict` and `hdiutil verify` still pass. The final
  Developer ID signature must re-enable hardened runtime before notarization.
- ✅ **Truthful completion notification gate (2026-08-03):** the scheduler can
  stop only on a fresh two-commit marker whose parent is the exact clean commit
  that passed `scripts/verify-autobuilder-completion.sh --record`; unit-level
  heartbeat text is never consulted. Gate v2 pins the editor/viewer regression
  files, runs all real embedded-engine tests against both staged and mounted
  resources, produces the 48-image dark/light 1440/1280/900 matrix from its own
  strict-port Vite server outside the worktree, verifies codesign and the DMG,
  and makes the executable mounted from that DMG return a structured 0-to-5 V
  XSPICE transient before it may write the marker. An occupied visual-QA port,
  missing library, stale/malformed marker, dirty tree, or less than 15 GiB free
  fails closed and cannot notify.

## 10. Visual design system — **IMPERATIVE (Omar's directive)** — 🟡 ADOPTED WITH DRIFT (2026-08-04 overnight)

Goal: the app looks and feels **shadcn-grade** — a coherent, beautiful,
token-driven design system, not a pile of ad-hoc CSS. This gates the
Definition of Done. Migrate **incrementally, panel by panel**, with screenshot
QA (STEP 3.5 pipeline) before/after every panel — never a big-bang rewrite,
never a broken intermediate state on the branch.

**Status: foundation + panel migrations landed (Phases 1–4c), but AGENTS.md §10
DoD stays UNCHECKED.** Overnight 2026-08-04 (Tokens + Cupertino + Anduril Light
palette pop): Light is the product default; cool-paper + precision-blue accent
popped to `#EDF1F6` / `#0068D6` (was `#F5F6F8` / `#0A66C2`); radius scale
extended (`--r-2xs`/`--r-xs`/`--r-pill`) and raw chrome radii snapped; warning
chrome stays quiet ochre (soft ≈0.05 — not danger-red for optional empties);
settings rows simplified. Remaining §10 debt that blocks an honest DoD check:
Resizable/Command/Toast primitives still deferred; native `<select>`s in
FFT/op-amp not on `ui/Select`; Assistant/local-AI settings surfaces still
mid-migration; Cupertino icon chrome still settling; no proof of zero ad-hoc
drift across every panel at both themes + min window.
Do **not** flip the AGENTS box until that grep+screenshot proof exists.

**Earlier claim (2026-07-08 Phase 4c) that §10 "closes" AGENTS DoD was premature**
once light theme, Anduril retune, and post-migration chrome re-entered the
branch. Honest accounting of wider DoD (not §10): see AGENTS.md checklist.

- ✅ **True-black palette retune (2026-07-08):** the single `:root` token block
  in `App.css` retuned from a cool blue-tinted graphite console (`--bg:
  #0a0c10`, radial-gradient "glass" canvas/scope surfaces) to a flat
  true-solid-black operator console (Braun "systems" poster / OP-1 / u-he
  reference direction) — `--bg:#000000`, neutral near-black panel steps,
  `--canvas-surface`/`--scope-surface` converted from gradients to flat
  solids, hairline alphas bumped for crispness on true black, `--success`/
  `--danger`/`--signal` brightened into vivid indicator-lamp colors (hues
  unchanged). The interaction accent was later retuned on 2026-07-14 from
  saturated system blue to warm ice/graphite; signal, danger/success, and trace
  families remain separate semantic tokens. Screenshot-verified against
  `screenshots/baseline/` via `screenshots/phase1-true-black/`. No runtime
  theme switcher exists yet (grepped, none found).
- ✅ **Semantic chrome refinement (2026-07-14):** the clean Errors panel is a
  static 28px status line (no success-green wash or empty expandable body),
  while warning/error states retain amber/red emphasis. Analysis navigation
  uses a neutral active material with one purpose sentence per LTspice mode.
  Dedicated AC sources identify as sine sources; inferred repeating traces say
  periodic. The selection-following delete bubble was removed in favor of a
  stable selection-aware toolbar action and the existing Delete key. Shared
  Button/Tabs foregrounds now consume `--accent-ink`, preserving 12.5:1
  contrast against the light interaction accent. **Instrument-spacing and AI
  header follow-up (2026-07-16):** Y tick anchors and vertical titles occupy
  opposite sides of the plot gutter, and the minimum-width Assistant uses a
  symmetric `New · History · Model · Delete · Close` grid below its title.
  Every sine-bearing symbol now consumes one shared centered sine glyph.
- ✅ **Foundation (2026-07-03):** Tailwind CSS v4 (`@tailwindcss/vite`) +
  shadcn scaffolding (components.json new-york, `src/lib/utils.ts` cn helper
  +4 tests, `@/*` alias in vite+tsconfig). `src/styles/tokens.css` maps the
  EXISTING App.css palette into `@theme inline` tokens **via var() refs** —
  so the runtime theme switcher re-themes utilities for free. Two deliberate
  deviations from stock shadcn: tokens live ONLY in the `--color-*` namespace
  (App.css `--muted` is a *text* color; shadcn's bare `--muted` surface var
  would collide), and **preflight is NOT imported** (theme+utilities layers
  only) so shipping is pixel-neutral — the BEFORE/AFTER STEP 3.5 screenshots
  are **byte-identical** (cmp-verified). Tailwind's stock palette is wiped
  (`--color-*: initial`): `bg-red-500` is a build error, all color goes
  through Tau tokens. Preflight's border reset lands with the first primitive.
  Production build green.
- 🟡 **Core primitives adopted:** Button ✅ (2026-07-04: `ui/button.tsx`,
  new-york via cva on Tau tokens, self-contained UA resets since preflight
  is absent, dense sm=28px; first adoption = the 4 document buttons in
  ShellPanels, killing `.editor-text-btn`'s hardcoded colors). Phase 2
  (2026-07-08) added the rest of the priority set, all hand-ported from
  shadcn new-york onto Tau tokens (no stock shadcn colors, self-contained UA
  resets, dense sizing): **Input** (`ui/input.tsx`, 28px sm default +
  `mono` variant → `.mono-num`), **Separator**, **Tabs**, **Tooltip**,
  **Dialog** (true-black `--popover` panel, hairline ring, `--elev-pop`
  shadow, `--scrim-strong` backdrop), **DropdownMenu**, **Select**,
  **ScrollArea**, **ContextMenu** — 8 new Radix packages installed
  (`@radix-ui/react-{separator,tabs,tooltip,dialog,dropdown-menu,select,
  scroll-area,context-menu}`) plus `lucide-react` (components.json's
  declared icon library; first real usage). Open/close motion for every
  popover-style primitive routes through two new `tokens.css` `@theme`
  animations (`animate-pop-in/out`, `animate-fade-in/out`) built from the
  existing `--motion-fast`/`--spring` tokens instead of the
  tailwindcss-animate plugin, so it stays on the app's own motion language.
  New shared utilities: `.mono-num` (App.css — tabular-nums + tuned
  tracking for numeric readouts; the 15+ existing ad-hoc mono call-sites
  still migrate per-panel in Phase 3) and density tokens `--row-h`(28px)/
  `--row-h-dense`(24px) in the single `:root` block. First adoption proof:
  the toolbar Run button now uses `Tooltip` (`Toolbar.tsx`, aria-label
  "Run simulation" unchanged); the Palette filter input was evaluated for
  the `Input` primitive but skipped — `.palette-search` has a custom
  search-glyph mask + a second density override at the responsive
  "DESIGN HANDOFF MIGRATION" breakpoint (~L3626) that `Input` doesn't
  model, so adopting it there now would cascade into a layout change
  outside this phase's scope. Remaining: Resizable (for the three-column
  simulator layout), Command (replace/augment the command palette),
  Toast/Sonner (errors + notifications) — deferred to a later phase per
  the brief. New vitest suite `ui/primitives.test.tsx` (11 tests, jsdom via
  a per-file `// @vitest-environment jsdom` pragma — every other suite
  stays on the fast default `node` environment) added `@testing-library/
  react` + `jsdom` as devDependencies; `vitest.config.ts` now also includes
  `*.test.tsx` and resolves the `@/` alias (previously only needed by
  `.test.ts` files, which never imported components).
- 🟡 **Panel migrations** (one commit each, screenshot-verified):
  toolbar/topbar ✅ (2026-07-05: run/settings buttons onto the Button
  primitive with a new `icon-sm` 28px size + `--color-success` token; the
  whole topbar CSS block tokenized — hardcoded `#d68a3c`/`#efe9d6`/`#71ab7e`
  etc. now route through `--accent`/`--cream`/`--trace-green` so the runtime
  theme switcher re-themes it; dead `.title-run`/`.settings-btn` rules
  deleted; 1440×900 screenshot-verified) → **toolbar/topbar + mode toggle,
  Phase 3a ✅ (2026-07-08):** operator-grade rework, not just re-tokenizing —
  bar surface `--panel-2`→`--panel` (one notch darker); the plain-text
  live-pill replaced with a real `.status-lamp` (off/idle, amber/running
  with a `status-lamp-pulse` animation, green/ok, red/error, amber-static/
  warn for a stale result) driving a new uppercase-tracked mono instrument
  label + a new `--danger-glow` token (mirrors `--success-glow`/
  `--signal-glow`); Run became a labelled transport control (`▶ run`,
  `--color-success`-tinted outline `Button` at `size="sm"`, new
  `--color-warning`→`--signal` Tailwind mapping) that disables while a sim
  is in flight (`analysisRunning` now threaded into `Toolbar` as
  `isRunning`) — confirmed no cancel/abort path exists anywhere in the repo
  (grepped `src/` and `src-tauri/src/`), so no fake Stop button was added,
  per the brief; the segmented `.mode-toggle` flattened (embossed inset
  shadow + 11px pill radius → hairline `--border` track on `--panel-3` +
  `--r-md`, active segment glow dropped for a flat `--accent` fill); both
  Settings and Run now wrapped in `Tooltip`. Dead-CSS sweep in the same
  commit: the legacy pre-migration `.toolbar`/`.brand`/`.brand-mark`/
  `.brand-name` duplicates plus the fully-unused `.brand-sub`/
  `.toolbar-spacer`/`.toolbar-group`/`.tool-btn`/`.run-btn`/`.version-tag`
  rules deleted (~110 lines; the two properties that actually leaked past
  their migration counterparts — `.toolbar`'s dead `backdrop-filter` and
  `.brand`'s load-bearing `flex-shrink: 0` — were audited per-property, the
  former dropped, the latter folded into the live rule) — net **App.css −49
  lines** even after adding the 5-state lamp system. Verified at
  900×600 (no clipping/overflow of the toggle, lamp, or transport button).
  → part palette ✅ (2026-07-06: the
  active "DESIGN HANDOFF MIGRATION" palette rules tokenized — panel/panel-3/
  text/faint surfaces + the one-off cyan selection now route through tokens;
  new `--accent-line` + `--overlay-hover`/`-faint` tokens; selection unified
  onto the accent system; search glyph moved from a baked-hex data-URI to a
  `--muted` CSS mask; dead `.palette-head button/div` rules deleted;
  screenshot-verified) → inspector/params ✅ (2026-07-06: `.inspector-summary`
  + `.property-field` tokenized — cream title, `--muted` secondary text,
  `--panel-3` fields, `--border-strong` borders, `--accent`/`--accent-soft`
  focus ring unified with `.engineering-input`; empty + selected-R1 states
  screenshot-verified) → **part palette + inspector, Phase 3b ✅ (2026-07-08):**
  operator-grade density, not just re-tokenizing — palette rows moved to
  `--row-h-dense` (24px), hotkeys flattened from an embossed gradient keycap
  to a crisp hairline mono badge, section headers dropped the "— X —"
  em-dash bracketing for an uppercase-tracked micro-label + a hairline rule,
  selection reads as an accent hairline + accent text (`--overlay-hover-faint`,
  never the old `--accent-soft` heavy fill). Fixed the actual bug behind the
  panel's bad truncation ("DC Volta…", "Potentio…" at every viewport): the
  `.palette` rule that looked authoritative (316px) was fully shadowed by a
  higher-specificity `.shell-body > .palette { width: 236px }` nobody had
  reconciled since the flex-shell migration — the panel was already narrower
  than it looked. That rule is now the single source of truth (264px
  comfortable / 208px at the 900px floor); the item grid favors the name
  column over the description; and a `@container palette-list` query drops
  the description entirely below 220px rather than ellipsizing both — every
  catalog name now renders in full at every viewport except "Transmission
  Line" at the narrowest. Search field migrated onto the shadcn `Input`
  primitive (first real consumer in the repo — fixed a latent `size`
  prop-collision type bug in `input.tsx` in the process: `Omit<...,"size">`).
  Symbol preview dropped its `--accent-soft` card fill for flat
  `--canvas-surface` + `--elev-inset` (an instrument screen, not a UI card).
  `.property-grid` rebuilt from a 2-up card grid into a single-column spec
  sheet: one `--row-h` row per field, a fixed micro-label column so every
  row's value aligns at the same x, `.mono-num` values. `.engineering-input`
  renamed `.eng-input` (matches its component file) and now uses
  `var(--row-h)` + `.mono-num` throughout (shared with SimulationPanel's
  selection-strip editors — those unify for free, untouched otherwise).
  **Correction (§UX, 2026-07-08)**: "untouched" concealed a real, more severe
  bug in the selection-strip's OWN layout that this pass never exercised —
  `design-shot.mjs`'s `inspector` state only ever selects a component in
  SCHEMATIC view (`.property-grid`), never in the simulator view
  (`.selection-strip`), so the bug had no screenshot coverage. See the dated
  entry below for the root cause and fix.
  `scripts/design-shot.mjs` gained a permanent `inspector` state (selects
  the first canvas component so the populated property grid, not just its
  empty state, is screenshot-verified going forward). Dead-CSS sweep: the
  entire pre-migration `PALETTE` block (~250 lines, fully shadowed) +
  `.property-field em` (zero TSX hits) deleted; `.palette-table-head` (the
  decorative "ITEM / DESCRIPTION" header) removed from `Palette.tsx` for
  density — net `App.css` **−72 lines** even after the container query and
  two new responsive breakpoints. Screenshot-verified at 1440×900, 1280×720,
  and 900×600 (zero clipped controls; canvas got measurably wider at the
  floor size as a side effect of the palette's narrower breakpoint);
  manual QA on a 3-field component (AC Voltage: Offset/Amplitude/Frequency)
  confirmed row alignment and focus-ring correctness) →
  **analysis tabs + SimulationPanel controls, Phase 3c ✅ (2026-07-08):**
  the TRAN/OP/AC/DC/TF/NOISE/STEP tabs are now the ui/ `Tabs` primitive
  (Radix, first real consumer in the repo) with mono-uppercase instrument-
  abbreviation labels and an accent-filled `[data-state="active"]` tab,
  matching the toolbar's segmented-toggle language; the header's stop/step/
  maximize/close icon actions and the transient Run button are the real
  shadcn `Button` + `Tooltip` primitives — the Run button literally shares
  the toolbar Run button's component and Tailwind classes now, not just its
  look; the secondary control row (Add trace/Export CSV/Netlist/Save .raw/
  Ref .raw/+ Add pane/FFT cursors) is `Button` `sm`/`outline`, expression
  inputs are the `Input` `variant="mono"`; FFT spectrum/Cursors disclosure
  headers dropped their bordered-pill look for the Palette's Braun micro-
  label + hairline-rule + chevron pattern; the NETS/NODES/SAMPLES/STOP/
  STEPS/RESOLUTION instrument readouts route through the shared `.mono-num`
  utility instead of three separate ad-hoc font declarations; the scope
  face (`.scope-svg`/`.op-table`) now consistently paints `--scope-surface`
  with a `var(--border-strong)` hairline (a migration-era override had
  silently replaced it with a hardcoded `rgba(255,255,255,0.08)` border —
  fixed, and the now-fully-dead `--scope-bg` token removed); trace-legend
  swatches are 8×8px indicator-lamp squares, not 14×1.5px underlines. Dead
  CSS: `.plotter-run`/`.run-btn` (the latter had zero TSX usages — an
  orphan from the Toolbar's own earlier `Button` migration),
  `.plotter-icon-action`, `.plotter-max`, `.pane-btn`, `.fft-toggle` all
  deleted; the `.plotter-header`/`-title`/`-tabs`/`-tabs-inner` "DESIGN
  HANDOFF MIGRATION" duplicate overrides folded into their single primary
  rule. Net `App.css` **−92 lines**. Screenshot-verified at 1440×900,
  1280×720, and 900×600 (zero clipped controls; same RC-charging trace
  renders identically — only chrome changed). Left for a later pass: the
  FFT signal/window `<select>`s and the op-amp model `<select>` (native,
  not yet ui/ `Select`); native range sliders keep their existing styling
  per the brief. →
  **dialogs ✅ (2026-07-08, Phase 3d unit A):** `SettingsPanel` migrated onto
  a new `ui/sheet.tsx` (Radix `Dialog`-based right-anchored slide-in sheet,
  same true-black-popover/hairline-ring/`--elev-pop` recipe as `ui/dialog.tsx`
  with slide-from-edge motion) with dense hairline settings rows (micro-label
  + hint + real `Button` action, not a card-per-row); `ConfirmDialog` moved
  onto `ui/dialog.tsx`'s `Dialog` directly (manual Escape/focus-trap code
  deleted, Cancel/Confirm are real `Button` `outline`/`destructive`
  variants). ⁓210 lines of `.settings-*`/`.confirm-*` CSS deleted. →
  **empty/error states, status bar, rail, command palette ✅ (2026-07-08,
  Phase 3d unit B):** canvas `EmptyState.tsx` onboarding card is now a flat
  `--panel-3` card (hairline ring, `--elev-pop`, no blur/gradient) with an
  idle status lamp in its kicker and hairline mono keycaps on its actions;
  `ErrorPanel`'s empty fallback extends the inspector's reticle language
  (dim `--icon-reticle` glyph + mono uppercase title + faint guidance) via
  a new `.panel-empty` class; status bar's mode indicator is now the same
  `.status-lamp` component as the toolbar's transport lamp (was a static
  per-mode color, not run-state-driven), every other readout carries
  `.mono-num`; activity rail buttons wrap a real `ui/Tooltip` (with the
  real ⌘K shortcut for Search), hover is a hairline ring not a filled
  patch, and the active state drops its `--accent-soft` fill (icon color +
  the existing left accent edge carry it alone); command palette
  (`.cmdk-*`) had 3 hardcoded rgba literals + 2 `backdrop-filter: blur()`
  glass effects removed for the same true-black-pop-surface recipe
  `ui/dialog.tsx` uses, item names went mono (matching `.palette-name`),
  and selection is now an accent-hairline edge, not a flat fill; every
  shortcut keycap in the app (`.palette-key`/`.status-hints kbd`/
  `.cmdk-key`/`.empty-actions kbd`) now shares one CSS rule instead of
  three near-duplicates that had drifted. **This closes §10 Phase 3d.**
  Remaining §10 scope: the schematic canvas's own chrome (zoom controls,
  hover cards, net-label popover) and a final hardcoded-color grep pass.
  (The type/spacing sweep closed in Phase 4a, below.)
- ✅ **The schematic canvas keeps its bespoke SVG rendering** (it is the
  product's soul, untouched) — its chrome now adopts the system
  (2026-07-08, Phase 4c). Found exactly four chrome surfaces in `Canvas.tsx`
  (`App.tsx`/`ShellPanels.tsx` have none, confirmed by grep): the zoom
  cluster (`.view-controls`, already mostly on-system from an earlier pass —
  tightened raw `9px`/`16px` radius/inset to `--r-md`/`--sp-4`, glyphs to
  `--font-mono`, native `title`s to real `ui/Tooltip`s, and deleted the dead
  `.view-btn.fit` hack that hid a button's literal text via `font-size: 0`
  and painted a different glyph over it via `::before`); the "Current flow"
  toggle + "slowed ×" readout (`.flow-controls` — the real gap: rebuilt from
  a stadium-shaped, `backdrop-filter: blur()`'d glass pill with an orphaned
  hardcoded `rgba(23,184,158,…)` teal glow when ON — a color with no entry
  in the token `:root`, invisible to the hex-only color-gate since it wasn't
  `#hex` — into a flat hairline `--panel-3` chip with a real indicator lamp
  dot for the ON state, cobalt `--accent-line`, and a `.mono-num` readout
  chip); the inline value/net-label-name editor (`.value-edit-input` — the
  closest thing to a "net-label popover" this codebase has; no separate
  popover component exists) moved onto the same `--panel-4`/`--elev-pop`
  true-black pop-surface recipe every other floating surface uses instead of
  a `--panel-2` + raw `rgba(0,0,0,0.5)` shadow. No hover cards exist on the
  canvas today (only `.snap-ring`, an SVG wire/pin snap indicator — geometry,
  not chrome, left alone). Zero backdrop-filter remains on any canvas
  overlay (pan/zoom stays 60fps — nothing new added, one blur removed).
  Verified via `node scripts/design-shot.mjs canvas-chrome` against
  `screenshots/phase4b-floor/` at 1440×900 and 900×600: the flow pill is an
  obvious, large visual diff (rounded teal glow → flat cobalt hairline +
  lamp); the zoom cluster's diff is intentionally subtle since most of it
  was already migrated. **This was the last open §10 sub-item — §10 is now
  fully adopted**, see the section header note below.
- ✅ **Type & spacing scale (2026-07-08, Phase 4a):** audited every
  `font-size` in `App.css` (118 declarations across `font-size:`/`font:`
  shorthand) — the app had already clustered on 9/10/11/12/13px for ~90% of
  its text, so the scale names exactly those five steps (`--fs-micro`
  9/`--fs-caption` 10/`--fs-body` 11/`--fs-label` 12/`--fs-title` 13) plus
  two larger steps used consistently by short high-emphasis strings
  (`--fs-heading` 14 for close-glyphs, `--fs-display` 15 for the search
  input/brand wordmark). 109 declarations re-pointed to a token (91 clean
  bulk repoints + 16 odd one-offs snapped to the nearest role-appropriate
  step, e.g. `.palette-name` 11.5px→12px now matches `.cmdk-name` per its
  own "same treatment" comment, `.inspector-summary.empty span` 11.5px→11px
  now matches its populated-state sibling). 11 odd sizes kept as documented
  exceptions — all schematic/scope canvas SVG text (`.label-layer`,
  `.scope-axis`, `.op-annotation`, `.net-label-text`, `.plot-cursor text`,
  `.component .ref/.val`), the brand lockup, the one welcome headline, and
  the one big-digit instrument readout — each has an inline comment
  explaining why. Spacing: audited every `padding`/`margin`/`gap`, snapped
  57 arbitrary values (5/7/9/10/11/14/18px one-offs) to `--sp-*`, plus
  tokenized 31 more that already matched the scale numerically but were
  still raw px. Letter-spacing: uppercase micro-labels had drifted across
  ten different tracking values for visually identical roles — consolidated
  to two tokens (`--tracking-micro` 0.5px, `--tracking-wide` 0.14em) and
  folded three separate N-copies-of-the-same-rule micro-label groups into
  three shared multi-selector rules (14 selectors deduplicated), the same
  pattern Phase 3d used for keycaps.
- ✅ **Density mode (2026-07-08, Phase 4a):** resolved as "dense is the
  default," not a runtime toggle — swept remaining control-row heights onto
  `--row-h`/`--row-h-dense` (21 sites) and fixed two real drift cases where
  a table's header row didn't match its own explicitly-commented sibling
  (`.meas-table-head` 22px → now matches `.op-head`'s 24px; `.meas-row`
  26px → now matches `.op-row`'s 28px), plus tightened two oversized
  controls by one notch (`.explorer-search`, `.editor-icon-btn`: 30px→28px).
  No runtime density toggle was built (out of scope per the brief); a
  handful of rows stayed intentionally below `--row-h-dense` (22px table/
  section headers, the compact transport cluster, the app-chrome status
  bar) since forcing them onto the two-tier scale would have erased a
  deliberate header/data-row size hierarchy — each is commented in place.
- ✅ **Responsive floor (2026-07-08, Phase 4b):** fixed the orchestrator-
  flagged bug where the simulator's three-column layout (schematic/scope/Ask
  Sim) squeezed the schematic column to ~130px at the 900×600 minimum window
  — `explorer`/`plotter`/`ask-panel` had no real width budget, just fixed
  440px/330px defaults plus a JS drag-clamp that only applied while actively
  dragging, so on load/resize the schematic column got whatever pixels were
  left over (often near zero). Fix: `App.tsx` now measures `.shell-body`'s
  real width via `ResizeObserver` and keeps a hard 260px floor for the
  schematic column, shrinking the scope (300px floor) and Ask Sim (260px
  floor) columns to fit — auto-collapsing Ask Sim (already had a minimize
  affordance via `MinimizedPanelDock`) only if literally no width remains
  even at both floors; the same budget now also bounds the manual drag
  handles, not just the initial layout. `App.css` carries matching
  `min-width` floors on `.editor-shell`/`.plotter`/`.ask-panel` as a CSS
  backstop for the pre-layout-effect frame. Found and fixed a second bug the
  first pass surfaced: the TRAN/OP/AC/DC/TF/NOISE/STEP analysis tab strip
  hard-clipped STEP at the new 300px scope-column floor (it was previously
  only readable because the column happened to default to 440px) — tightened
  `.plotter-tab` padding/tracking under 1024px so all seven tabs fit exactly
  (verified via a headless measurement: `scrollWidth === clientWidth` at
  900×600), plus added `overflow-x: auto` on `.plotter-tabs` as a scroll
  fallback so a tab is never truly unreachable even if a future label grows.
  **Schematic-panel follow-up (2026-07-14):** Explorer, Components, and the
  Assistant now share the measured shell budget. Persisted desktop widths are
  synchronously clamped at the 900px minimum so the schematic editor keeps its
  260px floor without a one-frame overflow or an unreachable resize handle.
  Also hardened `.sim-results`' 3-column grid with a 64px column floor
  (`minmax(64px, 1fr)`, was `minmax(0, 1fr)`) plus `overflow-x: auto`, so the
  results table can no longer collapse into single-letter headers regardless
  of how narrow its column gets. Verified via
  `node scripts/design-shot.mjs phase4b-floor`: read every 900×600 PNG (all
  6 states) plus 1280×720 (all 6) and spot-checked 1440×900 — simulator
  900×600 now shows a fully legible schematic column (both tab labels, the
  "Current flow" pill uncut, all 7 analysis tabs, and a readable
  CURRENT/VOLTAGE/POWER results table) side by side with a full-width scope
  and Ask Sim panel; zero clipped/unreachable controls found in any other
  state at either floor size. Canvas SVG rendering/geometry untouched.
  **Independent-column follow-up (2026-07-14):** the old vertically shared
  Components/Assistant dock is removed. At 1280px both appear as direct sibling
  columns with their own handles; at 900px the deterministic budget preserves
  editor plus the simultaneously open Components and Assistant with zero
  overlay by yielding passive Explorer first. Explicitly opening Explorer swaps
  it into the constrained workspace. Focused DOM tests and live hot-reload
  screenshots prove both breakpoints.
  **Creation-tools follow-up (2026-07-15):** Components and Assistant now remain
  simultaneously reachable at 900px by yielding Explorer first; the Explorer
  rail action explicitly swaps the passive/creation column when requested.
- ✅ **Sweep (2026-07-08, Phase 4b):** hex gate —
  `rg -n "#[0-9a-fA-F]{3,8}" apps/desktop/src` (ts/tsx/css) — confirms **zero
  hardcoded colors outside the single `:root`** in `App.css`; the only other
  hits are the documented `"#000"` probe-color sentinel in
  `SimulationPanel.tsx` (engine logic, not styling) and RGB test fixtures in
  `plotExpression.test.ts` (`#f00`/`#0f0`/`#abc`, not app UI). Dead-rule
  sweep: cross-referenced all 270 class selectors in `App.css` against every
  `.ts`/`.tsx` file (including dynamically-built classnames like
  `` `app-${mode}` `` and `` `status-lamp--${lampState}` ``, verified by hand
  so they weren't wrongly deleted) — found and deleted two genuinely dead
  rules: `.attached-libraries` (8-line rule, zero references anywhere in the
  repo — a leftover from an earlier bottom-panel layout) and the
  `.transport-pause.active` selector (no pause button exists, only
  play/stop; kept the still-live `.transport-play`/`.transport-stop` rules
  on the same line/block). Also checked for unused CSS custom properties;
  found 3 (`--cream-soft`, `--ease-snap`, `--sp-8`) but left them — they're
  part of documented, systematic scales (spacing/easing/color steps) rather
  than orphaned one-offs, so removing them is a design-system judgment call
  outside a conservative "provable dead rule" sweep. Net `App.css`: 4511
  (original) → 4243 lines. Focus rings (`ui/*.tsx`'s
  `focus-visible:ring-2 focus-visible:ring-ring/50`, `--color-ring: var(--accent)`
  = electric cobalt) verified visible on true black via a headless
  keyboard-tab screenshot of the settings sheet — clear blue ring around the
  focused button, good contrast. At the time of this unit, the schematic
  canvas's own chrome (zoom controls, hover cards, net-label popover) was
  the one remaining §10 scope item, noted since Phase 3d — **closed in
  Phase 4c** (see "The schematic canvas keeps its bespoke SVG rendering"
  bullet above); §10 is now fully adopted end to end.
  - ✅ **Cleared (2026-07-04):** `.symbol-preview` card now derives from
    tokens (`--accent-soft` surface + `--border` hairline + `--accent`
    stroke/label + `--muted` hotkey, radius `--r-md`) — screenshot-verified
    that it re-themes with the active accent instead of clashing cream/teal.

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

_This footer is intentionally not a live status line — see the `PROGRESS.md`
heartbeat for the current test count and active unit. The committed runner now
proves **81/82 warning-clean and 79/82 deck-built / op-converged**, with three
honest deck refusals (NIGBT, Chan-core NonLinearTransformer, unresolved
LT1184F on Royer) and zero canonical hard failures._
