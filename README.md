<div align="center">

# τ &nbsp;Tau

**A modern, fast circuit simulator with a SPICE-class engine.**

*The power of LTspice. An interface that doesn't fight you.*

</div>

---

> ⚠️ **Status: early development (v0.1, pre-alpha).** The schematic editor is taking shape; the simulation engine is not yet wired in. Not yet usable for real work.

## What is Tau?

Tau is a standalone desktop circuit simulator that pairs a serious, SPICE-class
numerical engine with an interface that feels like a modern design canvas —
fast, obvious, and beginner-friendly, without hiding the underlying engineering.

- **Powerful** — a real SPICE engine (ngspice, embedded natively), not a toy approximation.
- **Fast** — a native Rust/Tauri app that uses your hardware efficiently. Computational efficiency is a first-class priority.
- **Approachable** — drag-and-drop placement, search-first components, smart wiring, click-to-probe, automatic plots.
- **Honest** — beginner mode explains what's happening; expert mode exposes raw netlists, directives, and solver settings.

## Why Tau?

LTspice is powerful but its interaction model is painful. EveryCircuit is
approachable but paywalled and limited. Tau aims to be powerful *and*
approachable — a tool you can learn circuits on and still trust for real design.

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Tauri v2 (Rust) — standalone desktop, minimal overhead |
| Frontend | React 19 + TypeScript + Vite 7 |
| Schematic canvas | SVG + React (v0) → Canvas2D/WebGL for scale |
| State | Zustand |
| Engine | ngspice via Rust FFI (`libngspice`), bundled (Phase 3) |
| Plotting | uPlot (planned) |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture and
[DESIGN_LOG.md](DESIGN_LOG.md) for decisions and current state.

## Quickstart (development)

Prerequisites: **Node ≥ 20**, **pnpm**, **Rust** (stable), and the platform's
native webview toolchain (macOS: Xcode Command Line Tools).

```bash
pnpm install          # install workspace dependencies
pnpm dev              # launch the Tauri desktop app (native window)
pnpm dev:web          # OR run just the frontend in a browser (Vite dev server)
pnpm typecheck        # type-check the app
```

## Repository layout

```
Tau/
├── apps/desktop/         # Tauri v2 desktop app (React frontend + Rust shell)
├── packages/
│   └── schematic-core/   # canonical schematic document model & types
├── crates/               # (Phase 3) Rust crates: ngspice FFI, orchestrator
├── ARCHITECTURE.md       # system design
├── DESIGN_LOG.md         # decisions + append-only session log (read this first)
└── CLAUDE.md             # context for AI assistants working on the repo
```

## License

Proprietary, all rights reserved during early development — see [LICENSE](LICENSE).
The long-term license is intentionally undecided to keep open-source, open-core,
and commercial paths available.
