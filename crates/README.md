# crates/ — Rust engine crates (Phase 2+)

This directory will hold Tau's native simulation crates. It is intentionally
empty until the engine phase, at which point a Cargo **workspace** will be
introduced at the repo root including `apps/desktop/src-tauri` and these crates.

Planned crates:

- **`ngspice-sys`** — raw FFI bindings to `libngspice` (the ngspice shared
  library). Generated/maintained against the ngspice C API.
- **`ngspice-rs`** — safe, idiomatic Rust wrapper. Owns the engine lifecycle and
  streams results via ngspice's data/exit callbacks.
- **`sim-orchestrator`** — run scheduling and parallelism. Because `libngspice`
  is not safely reentrant, parameter sweeps and Monte Carlo run as **multiple
  processes**, coordinated here.

See `ARCHITECTURE.md` → "Engine integration (Phase 3)" for the plan, including
building `libngspice` from source with the KLU solver.
