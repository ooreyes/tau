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
- 🟡 **Import LTspice `.asc` schematics** — **parser landed** (`io/ascImport.ts`,
  13 tests). Parses `Version/SHEET/WIRE/FLAG/SYMBOL/SYMATTR/WINDOW/TEXT/LINE/…`
  losslessly; validated by parsing **4,012 real LTspice files (49,625 symbols,
  165,744 wires) with zero throws**, plus `ltspiceTypeToKind` + orientation map.
  **NEXT:** (a) `ascToSchematic()` — convert to Tau `SchematicDocument` with
  coordinate scaling; (b) **pin-accurate connectivity** so nets extract (align
  LTspice symbol pins to Tau pins, or drive nets from LTspice `.asy` pin coords);
  (c) wire into the Open dialog; (d) parse `TEXT !` directives → analyses.
- ⬜ **Import LTspice `.asy` symbols** (so library parts render) — 6,280 ship with LTspice.
- ⬜ Map LTspice `SYMATTR Value/Value2/SpiceModel/ModelFile` to Tau component values.
- ⬜ Export Tau schematic → `.asc` (round-trip).
- 🟡 Native SPICE netlist generation (`engine/spiceNetlist.ts`) — works for built-in kinds; needs the directive/model coverage below.
- ⬜ Export `.cir`/netlist to file; import `.cir`.
- ⬜ `.raw` waveform export/import (LTspice binary raw format).
- ⬜ Save/Open Tau-native `.tau.json` — **partial** (toolbar Save/Open exists); verify robustness.

## 2. Schematic capture
- ✅ Place / move / rotate / mirror? (rotate ✅; **mirror ⬜**) / delete components — `Canvas.tsx`, `store/useSchematic.ts`
- ✅ Wire drawing with orthogonal routing + junction dots — `Canvas.tsx` (`routeWireSmart`)
- ✅ Net labels (name a node) — `FLAG` equivalent — store `upsertNetLabel`
- ✅ Ground symbol — ✅
- ✅ Grid snap, pan, zoom, fit — `Canvas.tsx`
- ✅ Undo/redo, autosave, multi-tab documents
- ✅ Component value editing (double-click) + structured params
- ✅ Probe tool (click node → plot) — `probes`
- ⬜ **Mirror/flip components** (LTspice Ctrl+E / Ctrl+R)
- ⬜ **Copy/paste, duplicate, multi-select, drag-box select, group move**
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
Current Tau kinds (~21): R, C, L, pot, V(DC), I(DC), Vac, Iac, **Vpulse**, diode, LED,
zener, opamp, NMOS, PMOS, NPN, PNP, switch, transformer, testpoint, ground.
- 🟡 Passives R/C/L (✅) — add: parasitics (ESR/IC), behavioral R/C/L, **C/L initial conditions**
- 🟡 Sources — have DC/AC/PULSE. **Missing LTspice source functions:** SINE (with damping/phase), EXP, PWL, PWL FILE, SFFM, **arbitrary behavioral B-source** (`V=...`, `I=...`), AC spec, noise sources
- 🟡 Semiconductors — diode/BJT/MOS/zener present with **generic models only**. Need real model selection.
- ⬜ **Behavioral sources (B)** — used constantly in real LTspice circuits
- ⬜ **Voltage/current-controlled sources** E/F/G/H
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
- ⬜ `.dc` **DC sweep** (source sweep, nested) — used 37× by user
- ⬜ `.noise` **Noise analysis** — used 13×
- ⬜ `.tf` **Transfer function** (small-signal DC gain, Zin/Zout)
- ⬜ `.step` **Parametric sweep** (param/source/temp, nested, list) — used 34×; huge for real work
- ⬜ `.four` Fourier analysis
- ⬜ `.temp` temperature sweep / set — used 4×
- ⬜ `.meas` **Measurements** (extract gain, BW, rise time, etc.) — used 61×
- ⬜ DC operating point annotation on schematic (show node V / device I in-place)
- ⬜ Initial conditions `.ic` / `.nodeset`
- ⬜ `.options` passthrough (reltol, etc.) — used 7×

## 5. Expressions & parameters
- ⬜ `.param` parameter definitions — used 180× (critical)
- ⬜ `.func` user functions — used 13×
- ⬜ `{expression}` evaluation in any value field (the LTspice braces syntax)
- ⬜ Built-in functions (sin, sqrt, if, limit, table, etc.) + constants
- ⬜ `.step param x list/range` driving the above

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
- ⬜ `.step` family-of-curves overlay
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
- ⬜ Keyboard shortcut parity (F2 part, F3 wire, F4 label, F5 delete, F6 copy, F7 move, F8 drag, Ctrl+R rotate, Ctrl+E mirror, etc.)
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
