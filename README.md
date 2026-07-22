<div align="center">

# τ &nbsp;Tau

**A native-Mac, LTspice-.asc-compatible circuit simulator.**

*A real SPICE engine. An interface that doesn't fight you.*

</div>

---

> **Status: v1.0 release.** Tau is a working circuit simulator you can use for
> real design today: a native desktop app with an embedded ngspice engine
> (transient, operating point, AC, DC, noise, transfer-function, and step
> analyses), LTspice `.asc` import verified against a 189-schematic corpus,
> vendor SPICE model import (`.lib`/`.subckt` files attach per document and
> simulate through the native engine), click-to-probe plotting with live
> measurements, ready-to-run demos in [examples/](examples/README.md), and an
> optional AI circuit assistant. The browser-only dev path retains a smaller
> TypeScript preview solver. Remaining limitations are tracked honestly in
> [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## What is Tau?

Tau is a standalone desktop circuit simulator that pairs a serious, SPICE-class
numerical engine with an interface that feels like a modern design canvas -
fast, obvious, and beginner-friendly, without hiding the underlying engineering.

- **Powerful** - a real SPICE engine (ngspice, embedded natively), not a toy approximation.
- **Fast** - a native Rust/Tauri app that uses your hardware efficiently. Computational efficiency is a first-class priority.
- **Approachable** - drag-and-drop placement, search-first components, smart wiring, click-to-probe, automatic plots.
- **Honest** - beginner mode explains what's happening; expert mode exposes raw netlists, directives, and solver settings.

## Why Tau?

LTspice is powerful but its interaction model is painful. EveryCircuit is
approachable but paywalled and limited. Tau aims to be powerful *and*
approachable - a tool you can learn circuits on and still trust for real design.

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Tauri v2 (Rust) - standalone desktop, minimal overhead |
| Frontend | React 19 + TypeScript + Vite 7 |
| Schematic canvas | SVG + React (v0) → Canvas2D/WebGL for scale |
| State | Zustand |
| Engine | Bundled ngspice via Rust FFI (`libngspice`); TypeScript MNA only for browser dev fallback |
| Plotting | SVG plotter now; uPlot or custom renderer later |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture.

## Current component library

Tau ships an owned generic SPICE-style starter library: squiggly resistor,
capacitor, inductor, DC/AC voltage and current sources, ground, diode/LED/zener,
NMOS/PMOS, NPN/PNP, op amp, potentiometer, switch, transformer, and test point.

The native desktop app exports the current library to ngspice. R/C/L, DC and
AC sources, diodes, LEDs, zeners, NMOS/PMOS, NPN/PNP, ideal op amps,
potentiometers, switches, transformers, grounds, and test points therefore run
through real SPICE analysis. Tau supplies conservative generic models for the
semiconductor symbols.

For vendor-accurate parts, attach the manufacturer's `.lib`/`.subckt` file to
the document through the Model libraries dialog (toolbar button or command
palette). Attached definitions resolve by name, persist with the document, and
simulate through the native engine; LTspice-only constructs common in vendor
macromodels (`VSWITCH`/`ISWITCH` cards, parenthesized switch control nodes,
`mfg=` annotations) are translated automatically. The
[AD8541 example](examples/README.md) runs a real Analog Devices macromodel end
to end. Tau does not bundle or copy LTspice's proprietary libraries.

## Quickstart (development)

Prerequisites: **Node ≥ 20**, **pnpm**, **Rust** (stable), and the platform's
native webview toolchain (macOS: Xcode Command Line Tools). Native engine
builds also need a C toolchain, GNU Make, Git, and GNU Bison 3.x (macOS:
`brew install bison`). Build each distributable on its target platform; Tau
does not cross-compile ngspice resources.

```bash
pnpm install          # install workspace dependencies
scripts/build-ngspice.sh # build and stage the bundled native ngspice resource
pnpm dev              # launch the Tauri desktop app (native window)
pnpm dev:web          # OR run just the frontend in a browser (Vite dev server)
pnpm typecheck        # type-check the app
pnpm test             # run solver/example correctness tests
```

`pnpm dev:web` intentionally uses the browser fallback and cannot exercise the
native engine. Use `pnpm dev` for ngspice verification.

The build script locks ngspice to its recorded source commit, compiles out of
tree, stages a target-matched library under `src-tauri/resources/ngspice/`, and
writes `build-info.json` with the exact provenance. Desktop builds fail early
when that staged library is absent. `TAU_NGSPICE_LIB` remains an explicit local
development override only; packaged apps resolve their library through Tauri's
resource directory and never load an arbitrary system/Homebrew installation.

`scripts/build-ngspice.sh` currently automates native macOS and Linux builds.
Tau is macOS-only today; other platforms are not part of this release.

## Release build

```bash
pnpm typecheck
pnpm test
scripts/build-ngspice.sh
pnpm --filter @tau/desktop build   # frontend production bundle
pnpm build                         # Tauri release app + DMG
```

Before shipping a macOS build, inspect the staged resource and signed bundle:

```bash
otool -L apps/desktop/src-tauri/resources/ngspice/lib/libngspice.dylib
codesign --verify --deep --strict apps/desktop/src-tauri/target/release/bundle/macos/Tau.app
```

The build script normalizes the staged ngspice install name so it cannot retain
a machine-local build path. A public macOS release still must be Developer ID
signed and notarized after bundling.

Current macOS release artifacts are produced under
`apps/desktop/src-tauri/target/release/bundle/`:

- `macos/Tau.app`
- `dmg/Tau_1.0.0_aarch64.dmg`
- `dmg/Tau_1.0.0_aarch64_signed.dmg` after the local ad-hoc signing pass

Local release builds are ad-hoc signed and the app bundle code signature
verifies after signing. Public distribution still needs Apple Developer ID
signing and notarization; without that, Gatekeeper will reject the app.

Current signed local DMG SHA-256 (`Tau_1.0.0_aarch64.dmg`):
`51e0472babacf3184c06067222ea822e139eaad561304d72f63e565e8cb6d611`.

## Repository layout

```
Tau/
├── apps/desktop/         # Tauri v2 desktop app (React frontend + Rust shell)
├── packages/
│   └── schematic-core/   # canonical schematic document model & types
├── examples/             # ready-to-run demo schematics (see examples/README.md)
├── ARCHITECTURE.md       # system design
├── KNOWN_ISSUES.md       # current limitations, tracked honestly
└── SHARE.md              # install notes for the unsigned preview build
```

## License

Copyright (c) 2026 Omar Reyes. All rights reserved. The long-term license is
intentionally undecided to keep open-source, open-core, and commercial paths
available.
