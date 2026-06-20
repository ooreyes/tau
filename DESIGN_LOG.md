# Tau — Design Log

This is the shared, durable memory for the Tau project. It is written so that
**multiple agents (Claude, GPT, Gemini) and humans can collaborate** without
losing context. It complements [ARCHITECTURE.md](ARCHITECTURE.md) (the design)
and [README.md](README.md) (the pitch).

## How to use this file (coordination protocol)

1. **Before working:** read the *Project snapshot*, *Locked decisions*, and the
   most recent *Session log* entries.
2. **While working:** if you make a non-obvious decision or change direction,
   add/update a *Locked decision* or *Open question*.
3. **After working:** append a dated entry to the *Session log* (newest at the
   bottom). Note what changed, why, and anything the next agent should know.
4. **Don't rewrite history.** Edit *Locked decisions* / *Open questions* freely,
   but only *append* to the *Session log*.
5. Keep entries concise and factual. Link files like `apps/desktop/src/App.tsx`.

---

## Project snapshot

- **Product:** standalone desktop circuit simulator. SPICE-class engine
  (ngspice, embedded) behind a modern, fast, beginner-friendly UI.
- **Positioning:** the power of LTspice with an interface that doesn't fight
  you; more capable and open than EveryCircuit.
- **Business stance:** likely open-core later (free powerful core; paid cloud /
  collaboration / AI / education / team libraries). License kept **proprietary
  for now** to preserve all options. Decide license with the business model.
- **Audience:** learners → hobbyists → working engineers (one continuum, via
  Beginner/Expert modes).

## Locked decisions  _(as of 2026-06-17)_

| # | Decision | Rationale |
|---|---|---|
| D1 | **Standalone desktop app via Tauri v2 (Rust)**, not Electron, not browser-first | Computational efficiency is a priority; native shell, small footprint, Rust pairs with engine FFI |
| D2 | **Engine = ngspice via Rust FFI to `libngspice`, bundled** | Native speed + live streaming + zero-install; not CLI subprocess (overhead, no streaming), not WASM (perf ceiling) |
| D3 | **Frontend = React 19 + TypeScript + Vite 7** | Reach, ecosystem, hiring |
| D4 | **Schematic canvas = SVG + React for v0**, migrate to Canvas2D/WebGL for scale | Fastest path to a correct, crisp, interactive first milestone; renderer is behind a boundary |
| D5 | **State = Zustand**; view state (pan/zoom) local, document state in store | Simple, fast; sets up command-stack undo/redo later |
| D6 | **License proprietary / all rights reserved for now** | Keep open-source, open-core, and commercial paths open |
| D7 | **Monorepo: pnpm workspaces (JS) now; Cargo workspace added with `crates/` in Phase 3** | Avoid breaking the Rust build before there are multiple crates |
| D8 | **Two simulation modes**: Live (animated, interactive) and Analysis (full SPICE) | Live mode is the EveryCircuit-like "feel"; Analysis is the rigor. Distinct execution models. |

## Roadmap (condensed)

- **Phase 1 — Schematic editor (current):** canvas, component placement, wiring,
  editing, net extraction, save/load, netlist export.
- **Phase 2 — First simulation:** build/bundle `libngspice`, FFI crate, run
  `.op`/`.tran`/`.ac`/`.dc`, click-to-probe, waveform viewer.
- **Phase 3 — Real components & analyses:** MOSFET/BJT (BSIM), op-amps,
  subcircuit import, parameter sweeps, noise, Live mode.
- **Phase 4+ — Scale & intelligence:** Verilog-A via OpenVAF/OSDI, optional Xyce
  for large/parallel circuits, part-number import, Monte Carlo, AI assistant.

## Open questions

- OQ1: Project name "Tau" — confirm availability for any future product/domain.
- OQ2: Net-label vs. implicit-connection semantics for the net extractor.
- OQ3: When to extract schematic types from the app into `@tau/schematic-core`
  (needs TS project references or a build step like tsup).
- OQ4: Live-mode integration loop — reuse ngspice background-run streaming, or a
  purpose-built lightweight transient loop for real-time animation?
- OQ5: Rotate keybinding — currently `Space`; revisit against muscle memory.
- OQ6: Interim TypeScript linear transient solver — keep as a small Live-mode
  seed/test oracle, or replace entirely once the Rust/ngspice adapter lands?

## Known tech debt

- Schematic types currently live in `apps/desktop/src/schematic/` rather than in
  `@tau/schematic-core` (see OQ3). The package holds the canonical *intended*
  API; the app will migrate to import from it.
- The current simulation path is an interim frontend TypeScript MNA solver for
  linear R/C/L/V/GND circuits only. It is real analysis, not mocked output, but
  it does not replace the locked ngspice/Rust engine decision.

---

## Session log  _(append-only; newest at the bottom)_

### 2026-06-17 — Project kickoff & scaffold — Claude (Opus 4.8) via Claude Code

- Established the product/architecture plan and the locked decisions above.
- Scaffolded the monorepo: `pnpm-workspace.yaml`, root `package.json`,
  `.gitignore`, `LICENSE` (proprietary placeholder).
- Generated the Tauri v2 + React 19 + TS app via `create-tauri-app` at
  `apps/desktop`; rebranded crate/app to Tau.
- Created docs: `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, this `DESIGN_LOG.md`.
- Created `packages/schematic-core` (canonical types) and `crates/` placeholder.
- Built the first interactive schematic canvas (Phase 1): infinite pan/zoom grid,
  component palette (R, C, L, V, GND), keyboard + click placement, grid snapping,
  selection, drag-to-move, rotate, delete. SVG-based renderer.
- **Engine is NOT wired yet** — the "Run" button is a stub. No simulation occurs.
- ✅ Verified end-to-end: frontend renders and places components with no console
  errors; the native Tauri shell compiles clean (`tau` crate, Tauri 2.11.3, ~49s).
  Repo pushed to https://github.com/ooreyes/tau (private).
- Next: wiring tool + net labels → net extraction → SPICE netlist export, then
  Phase 2 (build `libngspice`, FFI crate, first `.op`/`.tran`).

### 2026-06-18 — Wire tool and document model — Codex

- Added app-local wire document state: `SchematicWire` stores grid-snapped
  orthogonal polylines in `apps/desktop/src/schematic/types.ts`, and Zustand now
  keeps `wires` beside `components`.
- Mirrored the intended canonical wire shape into
  `packages/schematic-core/src/index.ts`; the app still uses its local Phase 1
  types until OQ3 is resolved.
- Added a Wire tool (`W` hotkey and palette button). In wire mode, click once to
  start, click another grid point to commit an orthogonal segment, and continue
  chaining; `Esc` returns to select mode.
- Renders persisted wires and an in-progress preview on the SVG canvas. Nets are
  still not extracted and simulation remains unwired.
- Verified with `pnpm typecheck` and a browser smoke test at
  `http://localhost:1420/`: the Wire button appears, one two-click segment
  creates exactly one persisted wire, and the status bar reports wire count.
- Next: add pin-aware endpoint snapping/visual pin affordances, wire selection /
  deletion, then net extraction over component pins + wire graph.

### 2026-06-18 — Interim simulation and plotter UI — Codex

- Added pin metadata (`apps/desktop/src/schematic/pins.ts`) and a net extractor
  (`apps/desktop/src/schematic/netlist.ts`) that connects coincident pins, wire
  intersections, pins lying on wire segments, and all ground symbols.
- Added `apps/desktop/src/simulation/linearTransient.ts`: a limited but real
  linear transient solver using Modified Nodal Analysis. It supports the current
  R/C/L/V/GND catalog, ideal DC voltage sources, Backward Euler companion models
  for capacitors/inductors, and reports structured failures for unsupported or
  singular circuits.
- Replaced the disabled Run stub with working transient analysis and added a
  right-side plotter panel styled after the supplied dark synth/control-panel
  references: dense mode tabs, neon waveform traces, meters, dials, status LEDs,
  and selected-part value editing.
- Added visible pin targets while wiring so users can connect the exact terminal
  points the net extractor consumes.
- Verified with `pnpm typecheck` and an in-browser smoke test at
  `http://localhost:1420/`: placed a 5-component RC circuit (V source, R, C, two
  grounds), ran transient analysis, rendered 2 voltage traces, produced 241
  samples, and had no warnings. Layout check: plotter `scrollHeight` equals its
  642px panel height at the default viewport.
- Next: add wire/component deletion for wires, save/load, explicit probe
  selection, net labels, and eventually replace/route this interim solver
  behind the planned Rust/ngspice engine adapter.

### 2026-06-18 — Onboarding and persistence polish — Codex

- Picked up after the editor undo/redo and solver-test commits. Finished the
  interrupted onboarding/persistence increment.
- Added autosave to `localStorage` in `apps/desktop/src/store/useSchematic.ts`;
  reload restores the last schematic. `loadCircuit` now clones incoming
  documents with fresh ids and derives reference-designator counters.
- Added toolbar actions for New, Open, Save, and an Examples picker backed by
  `apps/desktop/src/examples/circuits.ts`. Save emits a `.tau.json` document;
  Open accepts Tau JSON documents through a hidden file input.
- Added `apps/desktop/src/components/EmptyState.tsx`: an empty-canvas overlay
  with a one-click RC example plus direct Resistor/Wire entry points. Analysis
  results are cleared whenever the schematic changes so stale traces do not
  survive New/example/open/edit actions.
- Updated `README.md` to reflect the current v0.2 pre-alpha reality: simple
  schematic editing, examples, interim linear simulation, and plotter are
  working; Rust/ngspice is still planned. Added root `pnpm test`.
- Verified with `pnpm typecheck` and `pnpm --filter @tau/desktop test`
  (68 tests passing). Browser smoke at `http://localhost:1420/`: New shows the
  empty state, Open RC example loads 5 components/1 wire, reload restores the
  autosaved circuit, Examples picker loads RLC (6 components/2 wires), Run
  renders 3 traces with no warnings, and layout has no body overflow at
  1280x720. In-app browser download events are unsupported, so Save download
  could not be asserted there beyond enabled/disabled UI state and typecheck.
- Next: add explicit probe selection, component/wire labels in the plot legend,
  stronger imported-document validation, native Tauri file dialogs for Open/Save,
  and a production build pass for the Tauri shell.

### 2026-06-18 — Production build hardening — Codex

- Ran the full release gate: `pnpm typecheck`, `pnpm test` (68 tests),
  `pnpm --filter @tau/desktop build`, and `pnpm build`.
- Aligned app/package/Rust/Tauri versions to `0.2.0` across `package.json`,
  `apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml`,
  `apps/desktop/src-tauri/Cargo.lock`, and
  `apps/desktop/src-tauri/tauri.conf.json`.
- Produced release artifacts:
  `apps/desktop/src-tauri/target/release/bundle/macos/Tau.app` and
  `apps/desktop/src-tauri/target/release/bundle/dmg/Tau_0.2.0_aarch64.dmg`.
- The generated `.app` initially had only a linker ad-hoc executable signature,
  so bundle verification failed. Re-signed the full app bundle with ad-hoc
  signing (`codesign --force --deep --sign -`), verified the bundle, rebuilt the
  DMG from the signed app, verified the DMG checksum with `hdiutil verify`, then
  mounted the DMG and verified the contained `Tau.app` signature.
- `pnpm audit --prod --audit-level high` reported no known vulnerabilities.
- Current release checksum:
  `d759579eb93356d7f59987602ad24949f25596c09531b62ec6f3e482bfb57b74`
  for `Tau_0.2.0_aarch64.dmg`.
- Distribution caveat: the app is ad-hoc signed, not Developer ID signed or
  notarized. `spctl --assess --type execute` rejects it as expected. Public
  distribution still needs Apple Developer ID signing/notarization credentials.
- Next: wire native Tauri file dialogs for Open/Save, add explicit probe
  selection, set up Developer ID signing/notarization, and consider enabling a
  production CSP once Tauri IPC/download behavior is verified under it.

### 2026-06-18 — Expanded generic component library — Codex

- Added Tau-owned generic SPICE-style schematic parts instead of copying
  LTspice's proprietary library: squiggly resistor, capacitor, inductor,
  potentiometer, DC/AC voltage sources, DC/AC current sources, ground,
  diode/LED/zener, NMOS/PMOS, NPN/PNP, op amp, switch, transformer, and test
  point.
- Updated `apps/desktop/src/schematic/catalog.ts`, `symbols.tsx`, `pins.ts`,
  app-local schematic types, and `@tau/schematic-core` intended types. The
  palette is now grouped by component section and scrolls inside the left rail.
- Interim transient solver now supports DC current sources, sine AC voltage and
  current sources (`"amplitude frequency"` or `"offset amplitude frequency"`),
  open/closed switches, and test points in addition to the previous R/C/L/DC
  voltage source/ground set. Operating-point analysis supports DC current
  sources, AC sources as 0 at DC, open/closed switches, and test points.
- Nonlinear/model parts (diodes, LEDs, zeners, MOSFETs, BJTs, op amps,
  potentiometers, transformers) are placeable and wireable but analysis returns
  an explicit unsupported-model error until ngspice/model/subcircuit support is
  added.
- Added tests for transient AC source behavior, DC current-source behavior, and
  clear unsupported-model feedback. Verified `pnpm typecheck`, `pnpm test`
  (71 tests), and `pnpm --filter @tau/desktop build`.
- Browser smoke at `http://localhost:1420/`: expanded grouped palette renders,
  AC Voltage can be placed with Ground, Run produces one trace, and layout has
  no body overflow. A lone source produces a single-pin warning as expected.
- Rebuilt the Tauri release app/DMG after the library changes, ad-hoc signed
  `Tau.app`, rebuilt `Tau_0.2.0_aarch64.dmg`, verified the DMG with
  `hdiutil verify`, mounted it, and verified the contained app signature.
  Updated DMG SHA-256:
  `afb1c281c4c6292412ef09724caf01bad9b16b429b0563cc8e454933eafd20e2`.
- Next: add user-provided SPICE `.lib`/`.subckt` import and symbol mapping.
  Do not vendor/copy LTspice libraries unless licensing is explicitly resolved.

### 2026-06-19 — Finished OP/AC analysis wiring and release verification — Codex

- Picked up an interrupted pass where structured per-part parameters were
  already committed and `apps/desktop/src/components/SimulationPanel.tsx` plus
  a new AC sweep solver were left uncommitted.
- Finished `apps/desktop/src/simulation/acSweep.ts`: complex-valued MNA over a
  logarithmic frequency sweep, R/C/L impedance stamping, DC sources handled as
  AC shorts/opens, AC voltage/current excitation, ideal op-amp support, closed
  switch conductance, friendly `V(part·part)` labels, and explicit
  unsupported-model failures instead of silently ignoring nonlinear/model parts.
- Wired the OP and AC plotter tabs live in the UI. OP now renders a styled DC
  node-voltage table with friendly labels; AC renders a Bode magnitude plot,
  trace legend, and START/POINTS/PEAK meters. TRAN remains the only tab with a
  Run button and stop/steps sliders.
- Added `apps/desktop/src/components/AnalysisErrorBoundary.tsx` around the
  analysis panel after browser verification exposed a render-time crash. Root
  cause was `formatEngineering(..., digits=0)` reaching
  `Number.toPrecision(0)`; fixed `formatEngineering` to clamp precision safely
  and covered it with a regression test.
- Added/extended solver tests: AC RC low-pass validates cutoff magnitude, phase,
  rolloff, passband, labels, graceful failures, unsupported nonlinear parts,
  and closed-switch AC behavior. Operating-point tests now assert display
  labels. Test count is now 100.
- Verification:
  - `pnpm typecheck`
  - `pnpm test` — 100 tests passing
  - `pnpm --filter @tau/desktop build`
  - Browser smoke at `http://localhost:1420/`: loaded the non-inverting
    amplifier example, verified OP table renders 7 rows without raw `N###`
    labels, verified AC sweep renders 4 non-empty traces with no overflow, and
    verified TRAN still shows Run plus STOP/STEPS sliders. No browser errors.
  - `pnpm build` produced `Tau.app` and `Tau_0.2.0_aarch64.dmg`.
  - Re-signed `Tau.app` ad-hoc with `codesign --force --deep --sign -`,
    rebuilt the DMG from the signed app using the generated Tauri
    `bundle_dmg.sh`, verified the DMG with `hdiutil verify`, mounted it, and
    verified `/Volumes/Tau/Tau.app` with `codesign --verify --deep --strict`.
- Current local release artifacts:
  - `apps/desktop/src-tauri/target/release/bundle/macos/Tau.app`
  - `apps/desktop/src-tauri/target/release/bundle/dmg/Tau_0.2.0_aarch64.dmg`
  - DMG SHA-256:
    `d43df26263fa892658e1ee3cadd3cc9ae51baaf52bd7b46f5e6b051ed967b354`
- Caveats / next work:
  - App is still ad-hoc signed, not Developer ID signed/notarized.
  - AC sweep uses fixed 10 Hz to 1 MHz / 20 points-per-decade options in the UI;
    expose sweep controls next.
  - Nonlinear/model parts still require the planned ngspice/model/subcircuit
    engine path. Do not vendor LTspice libraries; add user-provided SPICE
    library import and symbol mapping instead.

### 2026-06-19 — Probes, net labels, canvas UX, structured params, maximize — Claude (Opus) via Claude Code

Feature batch, each committed separately (probes/node-names; home-zoom; pin
snapping; dials→sliders; structured params; OP/AC wiring [Codex]; maximize; net
labels):
- **Meter probes** (`probe` tool, palette Tools + ⌘K): click a wire/pin → a
  colored probe; the scope plots exactly the probed nets in multimeter colors.
  `probes` in store; markers in Canvas; `SimulationPanel` resolves probe points
  → traces. Re-click toggles off.
- **Friendly node names**: solver trace labels are `V(R1·C1)` (from net pin
  labels), not `V(N001)`; all non-ground nodes returned.
- **Explicit net labels**: select a wire → NET NAME field; renders on canvas and
  overrides the auto label in the transient legend (`V(Vout)`). `netLabels`
  (point-pinned) in store; cleared on New/Open.
- **Home / zoom-to-fit** + zoom controls; **pin-aware** wiring & probing
  (`snappedCursor` latches to nearest pin, else grid) with a hover snap ring.
- **Inline value editing** (double-click) + **structured per-part parameters**
  (`schematic/params.ts`): AC sources split into Offset/Amplitude/Frequency,
  etc., encoded to/from the value string (solver unchanged).
- **Dials → labeled sliders**; **maximizable** analysis panel.
- Verified: `pnpm typecheck`, `pnpm test` (100), `pnpm --filter @tau/desktop
  build`; browser smoke — probes plot, net label `V(Vmid)`, AC Bode 20.8 dB
  (×11) on the non-inverting amp.
- Next: AC-sweep range controls; persist probes/net-labels with the document;
  source series resistance in the solver; the ngspice engine path.

### 2026-06-19 — Canvas label readability and Apple-like visual polish — Codex

- Fixed the black/overlaid schematic label bug from the screenshot. The newer
  always-on-top `.label-layer` now has explicit light fill, SF-style font
  styling, and a dark canvas halo instead of inheriting SVG's default black
  text.
- Reworked component label placement in `apps/desktop/src/components/Canvas.tsx`
  to use the full rotated pin/body footprint. Vertical two-terminal parts now
  place reference/value labels to the side, so source and rotated-part leads no
  longer run through text. Horizontal parts keep centered labels above/below.
- Added compact display formatting for schematic values, including AC sources
  (`1V @ 1kHz`) instead of concatenating raw value plus catalog units
  (`1 1kV Hz`).
- Continued the restrained Apple-like surface pass in `apps/desktop/src/App.css`:
  glassy toolbar/palette/plotter/status surfaces, subtler grid, cleaner wire
  strokes, and calmer label/net-label typography.
- Verified with `pnpm typecheck`, `pnpm test` (100 passing),
  `pnpm --filter @tau/desktop build`, and browser smoke at
  `http://localhost:1420/` using the non-inverting amplifier example. The AC
  source/ground stack now renders light, legible, and clear of the symbol/lead.

### 2026-06-20 — Migrated LTspice-style shell design handoff — Codex

- Consumed `/Users/omarreyes/Downloads/Tau LTspice UI design.zip`, specifically
  `design_handoff_tau_editor/README.md` and the `Tau.dc.html` prototype. The
  prototype was used as a visual/source spec only; no HTML runtime was shipped.
- Migrated the React app to the handoff's production shell: 40px title bar,
  54px activity rail, 226px explorer, VS Code-like editor tabs, a fixed editor
  canvas plus bottom inspector/results panel, simulator plotter column, and
  Ask Sim right rail.
- Added `apps/desktop/src/components/ShellPanels.tsx` for the activity rail,
  explorer, editor toolbar/tabs, bottom panel, result lists, component
  inspector, and Ask Sim panel. Repurposed `Toolbar.tsx` as the macOS-style
  title bar and expanded `StatusBar.tsx`/`Palette.tsx` to match the handoff.
- Reworked `apps/desktop/src/App.css` with the handoff token palette
  (`#0a0a0c`/cream/amber/blue/green/red), dense chrome, lighter SVG text,
  restrained borders, fixed panel dimensions, and non-wrapping status footer
  text so labels do not turn black or bleed into panels.
- Kept the real Tau schematic canvas, solver, plotter, component model, and
  examples wired through the new shell. The Run buttons now execute the current
  transient analysis and switch into simulator mode.
- Verification:
  - `pnpm typecheck`
  - `pnpm test` — 100 tests passing
  - `pnpm --filter @tau/desktop build`
  - Browser smoke at `http://localhost:1420/`: schematic shell rendered at
    1280x720 with no document scroll; label colors were cream/line instead of
    black; source/op-amp/resistor labels no longer overlap their symbols; Run
    switched to simulator mode with waveform plotter and Ask Sim visible.
- Caveat: after the initial screenshots and simulator smoke, the in-app browser
  refused a reload under its URL policy, so the final status-footer CSS tweak
  was verified by compiler/build rather than a second browser screenshot.

### 2026-06-20 — Button behavior audit and interaction pass — Codex

- Audited the shell after the design migration for enabled buttons that looked
  clickable but had no behavior or were hidden under overlapping panels.
- Wired the activity rail: Explorer switches to schematic, Search opens the
  command palette, Components focuses the component filter, Waveforms switches
  to simulator, and Settings opens a real settings popover.
- Added app-level document title, notice/toast, settings, and run-state wiring.
  New/Open/Examples now update the visible document title; Settings can open
  the command palette, clear probes, clear local autosave, or start a new blank
  circuit.
- Palette library +/- now attach/remove user-selected model-library filenames
  locally and clearly report that SPICE model mapping is not enabled yet. This
  avoids pretending LTspice/model import exists before the planned importer.
- Editor tabs now perform actions: the reference tab opens the RC Charging
  example, + starts a new blank circuit, and the simulator hide tab returns to
  schematic mode. Bottom tabs now switch between component/results, output/log,
  and real error/warning content.
- Ask Sim send now accepts prompt text and returns a deterministic summary based
  on the current schematic/result. It is not an external AI integration.
- Found and fixed a real simulator-mode click bug: the editor toolbar transport
  overflowed behind the plotter header, so Stop was covered. In simulator mode
  the cramped editor transport is hidden, and Stop now lives in the plotter
  header next to Run where it clears the transient result.
- Pause and Step remain disabled with explicit titles because the current
  transient solver is synchronous and has no async/incremental execution loop.
  Do not fake pause/step until the engine supports it.
- Verification:
  - `pnpm typecheck`
  - `pnpm test` — 100 tests passing
  - `pnpm --filter @tau/desktop build`
  - Browser smoke at `http://127.0.0.1:1421/`: settings open/close, Search opens
    command palette, Components focuses palette search, bottom tabs switch,
    RC example loads, Run enters simulator, OP/AC tabs activate, Ask Sim sends,
    plotter Stop clears the result and updates the live pill to `sim stopped`,
    simulator hide returns to schematic, remove-library reports feedback, and
    no console errors were present.
