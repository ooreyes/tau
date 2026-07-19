# Tau - Architecture

This document describes the intended system design. It is aspirational where it
describes layers not yet built; those are marked _(planned)_. See
[DESIGN_LOG.md](DESIGN_LOG.md) for what actually exists today.

## Guiding principles

1. **Computational efficiency is a first-class priority.** Tau is a native
   standalone app (Tauri/Rust), embeds the engine via FFI (no subprocess or
   network hop on the hot path), and is architected so parallelism (sweeps,
   Monte Carlo) scales across cores.
2. **The UI never talks to a simulator directly.** It produces a neutral
   **Circuit IR** + **Analysis Spec**, hands them to an engine adapter, and
   consumes a streamed **Result** protocol. The engine can evolve or be swapped
   without touching the UI.
3. **The schematic is the single source of truth.** The netlist is *derived*
   from it, never hand-maintained. Undo/redo is a command stack over the model.
4. **Two simulation modes, one engine.**
   - **Live mode** _(planned)_ - continuous, animated, interactive transient for
     small circuits (the EveryCircuit-like "feel").
   - **Analysis mode** _(planned)_ - full SPICE analyses (transient, AC, DC
     sweep, op, noise, parametric, Monte Carlo) with a waveform viewer.
5. **Never hide the math; make it legible.** Beginner mode explains; expert mode
   exposes raw directives, netlists, model parameters, and solver settings.

## Layered view

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND  (apps/desktop/src - React + TypeScript)             │
│                                                                │
│  Toolbar · Palette · Command palette (planned)                 │
│  Schematic Canvas (SVG→Canvas2D/WebGL)   Zustand doc + undo    │
│  Net extractor → SPICE deck exporter → typed results           │
│  Plotter UI   Probe manager                                    │
└───────────────────────────────┬────────────────────────────────┘
                                 │  Engine Contract (typed, planned)
                                 │  {CircuitIR, AnalysisSpec} → stream<Result>
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│  RUST SHELL  (apps/desktop/src-tauri)  +  crates/ (planned)    │
│                                                                │
│  Tauri command  ⇄  serialized native ngspice access            │
│     ├─ apps/desktop/src-tauri/src/spice.rs                     │
│     └─ future sim-orchestrator / streaming crate               │
│     └─ multi-process pool for parallel sweeps / MC  (planned)  │
└──────────────────────────────────────────────────────────────┘
                                 │
                          bundled libngspice
```

## Module boundaries

| Module | Location | Responsibility |
|---|---|---|
| `@tau/desktop` | `apps/desktop` | The app: UI, canvas, Rust shell |
| `@tau/schematic-core` | `packages/schematic-core` | Canonical document model & types (net extraction, IR - planned) |
| `ngspice-sys` _(planned)_ | `crates/ngspice-sys` | Raw FFI bindings to `libngspice` |
| `ngspice-rs` _(planned)_ | `crates/ngspice-rs` | Safe wrapper + result streaming via ngspice callbacks |
| `sim-orchestrator` _(planned)_ | `crates/sim-orchestrator` | Run scheduling, parallel sweeps/Monte Carlo |

## Engine integration

- **Mechanism:** Rust dynamically loads the bundled `libngspice` and serializes
  calls behind one Tauri command because ngspice has global process state. It
  returns completed vector data for `.tran`, `.op`, and `.ac`; streaming remains
  future work.
- **Build:** `scripts/build-ngspice.sh` pins and builds ngspice with
  `--with-ngshared`, KLU enabled, OpenMP disabled, then stages resources under
  `apps/desktop/src-tauri/resources/ngspice/` for Tauri bundling.
- **Concurrency note:** `libngspice` carries global state and is not safely
  reentrant. Parallel sweeps/Monte Carlo run as **multiple processes**, not
  threads inside one instance. This is the robust path to "use all cores."
- **Numerics (provided by ngspice):** Modified Nodal Analysis forms a stiff DAE
  system; implicit integration (Backward Euler / Trapezoidal / Gear) with
  adaptive time-stepping and local-truncation-error control; Newton-Raphson with
  Gmin/source stepping for convergence; sparse LU (KLU) per iteration.

## Browser fallback

`apps/desktop/src/simulation/` retains a small TypeScript MNA implementation
only for `pnpm dev:web`. `apps/desktop/src/engine/` exports schematic documents
to SPICE and adapts the native command result into the existing plotter types.
The desktop app must not silently fall back when native ngspice loading fails;
that failure is shown to the user.

## Decisions locked

See [DESIGN_LOG.md](DESIGN_LOG.md) → "Locked decisions".
