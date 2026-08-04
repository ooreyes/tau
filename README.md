<div align="center">

# τ &nbsp;Tau

**A native-Mac, LTspice-.asc-compatible circuit simulator.**

*A real SPICE engine. An interface that doesn't fight you.*

</div>

---

> **Status: v1.0, with real gaps.** Tau is a native desktop app with an
> embedded ngspice engine, LTspice `.asc` import, vendor SPICE model import
> (`.lib`/`.subckt` files attach per document and simulate natively),
> click-to-probe plotting with live measurements, ready-to-run demos in
> [examples/](examples/README.md), and an optional AI circuit assistant.
>
> **Transient, operating point, AC, DC sweep, transfer function and noise all
> run on the embedded ngspice engine.** Current-controlled switches are not
> modelled. Read [KNOWN_ISSUES.md](KNOWN_ISSUES.md) before trusting a result;
> it is specific about what is and is not real.
>
> Tau is an LTspice-compatible simulator, not a drop-in LTspice replacement.

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
through real SPICE analysis. Tau supplies conservative generic models only for
symbols the user deliberately leaves generic. If a schematic names a vendor
device, Tau resolves the exact model or refuses the run; it never presents a
generic device's waveform as that named part.

For vendor-accurate parts, attach the manufacturer's `.lib`/`.subckt` file to
the document through the Model libraries dialog (toolbar button or command
palette). Attached definitions resolve by name, persist with the document, and
simulate through the native engine; LTspice-only constructs common in vendor
macromodels (`VSWITCH`/`ISWITCH` cards, parenthesized switch control nodes,
`mfg=` annotations) are translated automatically. The
[AD8541 example](examples/README.md) runs a real Analog Devices macromodel end
to end. Tau does not bundle or copy LTspice's proprietary libraries.
On macOS, the desktop app also consults the four implicit `standard.*` device
databases in the user's installed LTspice copy without adding those files to
the Tau document or distribution.

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
when that staged library is absent, and again when it is present but is not the
pinned build: the build reads `build-info.json` and refuses a resource that
carries no record, was built from another commit or for another target, or is
missing an XSPICE code model. `TAU_NGSPICE_LIB` remains an explicit local
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
- `dmg/Tau_1.0.0_aarch64.dmg` - the ad-hoc-signed app plus the `Examples`
  folder and install notes, packed with `hdiutil` (Tauri's own DMG step needs
  a GUI session for its Finder styling pass)

Local release builds are ad-hoc signed and the app bundle code signature
verifies after signing, including from the read-only mounted DMG. Public
distribution still needs Apple Developer ID signing and notarization; without
that, Gatekeeper needs the one-time Control-click Open.

Current DMG SHA-256 (`Tau_1.0.0_aarch64.dmg`):
`d8672917b57b9d958c6b754dbf32c2586527e3f5c7d0749097d2ad2931d7538c`.

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

Copyright (c) 2026 Omar Reyes. All rights reserved. See [LICENSE](LICENSE). The
long-term license is intentionally undecided to keep open-source, open-core,
and commercial paths available.

Tau bundles third-party open-source software - most of all the ngspice engine,
which is under the Modified BSD license with LGPL v2.1 and MPL v2.0 parts. Those
components, their license texts, and the ngspice source offer (pinned commit
plus the one patch Tau applies) are in
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Tau ships no GPL-licensed code:
ngspice's GPL v2 `table` code model and its Verilog/VHDL co-simulation tool
chain are both dropped from the bundle, and Tau uses neither.
