<div align="center">

# τ &nbsp;Tau

**A modern, fast circuit simulator with a SPICE-class engine.**

*The power of LTspice. An interface that doesn't fight you.*

</div>

---

> ⚠️ **Status: early development (v0.2, pre-alpha).** Tau can edit simple schematics, load examples, run a real interim linear transient/operating-point solver for R/C/L/V/GND circuits, and plot node voltages. The planned Rust/ngspice engine is not wired in yet.

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
| Engine | Interim TypeScript MNA solver now; ngspice via Rust FFI (`libngspice`) planned |
| Plotting | SVG plotter now; uPlot or custom renderer later |

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
pnpm test             # run solver/example correctness tests
```

## Release build

```bash
pnpm typecheck
pnpm test
pnpm --filter @tau/desktop build   # frontend production bundle
pnpm build                         # Tauri release app + DMG
```

Current macOS release artifacts are produced under
`apps/desktop/src-tauri/target/release/bundle/`:

- `macos/Tau.app`
- `dmg/Tau_0.2.0_aarch64.dmg`

Local release builds are ad-hoc signed and the app bundle code signature
verifies after signing. Public distribution still needs Apple Developer ID
signing and notarization; without that, Gatekeeper will reject the app.

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
