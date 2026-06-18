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

## Known tech debt

- Schematic types currently live in `apps/desktop/src/schematic/` rather than in
  `@tau/schematic-core` (see OQ3). The package holds the canonical *intended*
  API; the app will migrate to import from it.

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
- Next: wiring tool + net labels → net extraction → SPICE netlist export, then
  Phase 2 (build `libngspice`, FFI crate, first `.op`/`.tran`).
