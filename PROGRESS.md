# Tau Autobuilder — Progress Log

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
