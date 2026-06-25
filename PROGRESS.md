# Tau Autobuilder — Progress Log

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
