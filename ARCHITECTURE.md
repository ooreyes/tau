# Tau — Architecture

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
   - **Live mode** _(planned)_ — continuous, animated, interactive transient for
     small circuits (the EveryCircuit-like "feel").
   - **Analysis mode** _(planned)_ — full SPICE analyses (transient, AC, DC
     sweep, op, noise, parametric, Monte Carlo) with a waveform viewer.
5. **Never hide the math; make it legible.** Beginner mode explains; expert mode
   exposes raw directives, netlists, model parameters, and solver settings.

## Layered view

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND  (apps/desktop/src — React + TypeScript)             │
│                                                                │
│  Toolbar · Palette · Command palette (planned)                 │
│  Schematic Canvas (SVG→Canvas2D/WebGL)   Zustand doc + undo    │
│  Net extractor (planned) → Circuit IR → Netlist gen (planned)  │
│  Waveform viewer (planned)   Probe manager (planned)           │
└───────────────────────────────┬────────────────────────────────┘
                                 │  Engine Contract (typed, planned)
                                 │  {CircuitIR, AnalysisSpec} → stream<Result>
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│  RUST SHELL  (apps/desktop/src-tauri)  +  crates/ (planned)    │
│                                                                │
│  Tauri commands / events  ⇄  sim-orchestrator (planned)        │
│     ├─ ngspice-rs  (safe wrapper, streaming)        (planned)  │
│     │     └─ ngspice-sys (FFI bindings to libngspice)(planned) │
│     └─ multi-process pool for parallel sweeps / MC  (planned)  │
└──────────────────────────────────────────────────────────────┘
                                 │
                          bundled libngspice (Phase 3)
```

## Module boundaries

| Module | Location | Responsibility |
|---|---|---|
| `@tau/desktop` | `apps/desktop` | The app: UI, canvas, Rust shell |
| `@tau/schematic-core` | `packages/schematic-core` | Canonical document model & types (net extraction, IR — planned) |
| `ngspice-sys` _(planned)_ | `crates/ngspice-sys` | Raw FFI bindings to `libngspice` |
| `ngspice-rs` _(planned)_ | `crates/ngspice-rs` | Safe wrapper + result streaming via ngspice callbacks |
| `sim-orchestrator` _(planned)_ | `crates/sim-orchestrator` | Run scheduling, parallel sweeps/Monte Carlo |

## Engine integration (Phase 3)

- **Mechanism:** Rust FFI to `libngspice` (the ngspice shared library), **bundled**
  into the app. Chosen for native speed, live result streaming (via ngspice's
  data/exit callbacks → Tauri events → live plots), and zero-install for users.
- **Build:** ngspice's shared library is not shipped by Homebrew; it will be
  built from source (`--with-ngshared`) and linked. KLU sparse solver enabled.
- **Concurrency note:** `libngspice` carries global state and is not safely
  reentrant. Parallel sweeps/Monte Carlo run as **multiple processes**, not
  threads inside one instance. This is the robust path to "use all cores."
- **Numerics (provided by ngspice):** Modified Nodal Analysis forms a stiff DAE
  system; implicit integration (Backward Euler / Trapezoidal / Gear) with
  adaptive time-stepping and local-truncation-error control; Newton–Raphson with
  Gmin/source stepping for convergence; sparse LU (KLU) per iteration.

## Decisions locked

See [DESIGN_LOG.md](DESIGN_LOG.md) → "Locked decisions".
