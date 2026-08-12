# UI/UX correction QA evidence

Capture date: 2026-08-11 local (fresh packaged-app restart after the
laptop-overlap warning; manifest timestamps are UTC 2026-08-12). Planning
base: `8fb45f6`. Targeted correction candidate: `24f7583`.
The existing matrix and interaction artifacts below were captured from the
prior packaged evidence tip `d3c9c3d`; the titlebar drag-proof captures and
action log were captured from a fresh package built with `24f7583`.

The fresh targeted package was rebuilt from the same correction lineage and is at
`/Users/omarreyes/Desktop/Tau/apps/desktop/src-tauri/target/release/bundle/macos/Tau.app`.
The fresh targeted package is at the path above; the seven-segment physical
pin-order fixtures and decode assertions remain committed in the prior
lineage. Native screenshots are JPEG
payloads retained with the repository's `.png` naming convention, as are the
existing screenshot-pipeline artifacts. Their measured pixel bounds are in
`evidence-manifest.json`.

## Acceptance policy and truth status

Computer Use on the packaged Tauri app is authoritative for import, editing,
properties, simulation, model recovery, and macOS chrome. Chrome `dev:web` is
responsive/console evidence only; no Chrome file-upload claim is made.

This file supersedes the earlier `0b5d22b`/`3687171` QA prose. The current
evidence was recaptured after a clean packaged restart and after correcting the
fixture generator's physical pin order. The 24 stable issue rows are indexed
as `FIXED_WITH_CURRENT_EVIDENCE` in
`native/matrix-manifest.json`; the final Sol High review remains explicitly
`PENDING` and is not represented as a passed gate.

### Exact current native matrix

`native/matrix-manifest.json` contains the complete Cartesian matrix:
2 themes × 3 requested logical sizes × 5 states = **30 entries**. Each entry
records the requested viewport, measured Computer Use app-content pixels,
timestamp, screenshot path, and state assertions. The validator result is:

```text
UI-UX-MATRIX: PASS: 30/30 keys; 6 interaction artifacts; all files and dimensions verified
```

The packaged interaction artifacts include the actual current-source states,
PULSE rise/fall zero edits, Settings sheets, seven-segment digit-8 simulator
state, and the LED inspector. `component-led-dark-1280x800.jpg` shows Red and
`component-led-green-dark-1280x800.jpg` shows Green with the default typical Vf
changing from 2 V to 2.2 V; the inspector keeps Vf editable and labels it as a
typical/default rather than a color-derived guarantee.

## Current native evidence

### Packaged circuits and simulation

- Digits 0–9: `native/corrected-packaged-sevenseg-{0,1,2,3,4,5,6,7,8,9}-dark-1280x800.png`.
  Each was opened from the project-owned fixture corpus, run in the packaged
  app, and returned `COMPLETE`, `ngspice`, and the matching `image U1 display:
  digit N` accessibility assertion.
- Live/stopped: `native/corrected-packaged-sevenseg-live-dark-1280x800.png`,
  `native/corrected-packaged-sevenseg-stopped-dark-1280x800.png`, and the
  light stopped counterpart. The live capture contains a live scope and
  `Running — t = 343.33 s`; the stopped capture names `stopped.asc`, shows
  `digit 8`, `COMPLETE`, and `ngspice`.
- Connected RC/PULSE circuit: `native/corrected-packaged-edited-circuit-light-900x600.png`
  (before run), `native/corrected-packaged-edited-circuit-run-light-900x600.png`,
  `native/corrected-packaged-edited-circuit-run-dark-900x600.png`, and
  `native/corrected-packaged-edited-circuit-run-dark-1440x900.png`. The run
  returned `3,079 samples`, `3 nets · 4 parts`, `COMPLETE`, and `ngspice`.
- Property edit and rerun: `native/corrected-packaged-source-properties-light-900x600.png`
  and `native/corrected-packaged-edited-pulse-run-light-900x600.png`. Computer
  Use changed V1 high level `5 → 4`; the packaged inspector retained `High
  level = 4`, and the rerun returned `COMPLETE`, `3 nets · 4 parts`, and
  `ngspice`.

### Packaged Settings, shell, and component states

- Settings: `native/corrected-packaged-settings-dark-1280x800.png` and
  `native/corrected-packaged-settings-light-1280x800.png`. Both are real
  Settings sheets; neither exposes a `Model Libraries` authoring page.
- Source/palette: `native/corrected-packaged-component-palette-dark-900x600.png`
  and `native/corrected-packaged-source-properties-light-900x600.png` show the
  current-source glyph, populated editor, Explorer, and the source inspector.
- Component previews: `native/corrected-packaged-symbol-polarized-cap-dark-900x600.png`,
  `...symbol-led-dark-900x600.png`, `...symbol-zener-dark-900x600.png`,
  `...symbol-photodiode-dark-900x600.png`, `...symbol-opamp-dark-900x600.png`,
  `...symbol-seven-segment-dark-900x600.png`, and
  `...symbol-switch-dark-900x600.png` are current packaged placement states.
- Component properties: `native/corrected-packaged-polarized-cap-properties-dark-900x600.png`,
  `...led-properties...`, `...zener-properties...`,
  `...photodiode-properties...`, `...opamp-properties...`, and
  `...switch-properties...` show current packaged inspectors. The op-amp
  inspector exposes bounded gain/min/max defaults (`1 MegV/V`, `-15 V`,
  `15 V`); the zener exposes both breakdown and forward voltage; the switch
  exposes open/closed state.
- Title-bar/window actions: `native/final/titlebar-action-log.json` indexes the
  fresh direct AX target (`Window drag area; double-click to maximize or
  restore`) and the before/maximized/restored/drag screenshots. Two explicit
  direct AX presses changed measured app-content width `1182 → 1224`, and the
  second pair restored it `1224 → 1182`. The fresh packaged pointer drag moved
  the AX window from `(116,63,1280,832)` to `(216,103,1280,832)`, a measured
  `(+100,+40)` delta; the matching before/after captures are indexed by the
  action log.

### Native viewport convention

The app was exercised at requested logical 900×600, 1280×800, and 1440×900
states. Computer Use returns the app-content screenshot bounds rather than the
logical window bounds; the exact requested viewport, screenshot pixel bounds,
gesture coordinates, and assertions are machine-readable in
`evidence-manifest.json`.

## Current Chrome responsive/console evidence

`chrome/devweb-matrix.json` records all six exact combinations and
`chrome/devweb-console.json` records the complete machine-readable warning/error readout. The
settings sheet was visible at every exact viewport; `scrollWidth == innerWidth`
and `scrollHeight == innerHeight` for all six. `Model Libraries` was absent.
The only two console errors were Chrome-extension transport messages:
`Could not establish connection. Receiving end does not exist`; they are
recorded verbatim and are not page-origin Tau errors. The Chrome tab was
finalized after resetting the temporary viewport override.

## Reproducible seven-segment corpus

The stable fixture source is `fixtures/ui-ux/seven-segment/`, generated and
checked by `scripts/generate-sevenseg-fixtures.mjs`. The acceptance command is:

```text
scripts/sevenseg-acceptance.sh /Users/omarreyes/Desktop/Tau/apps/desktop/src-tauri/target/release/bundle/macos/Tau.app
```

It checks 12/12 committed fixtures, runs the Vitest acceptance test, verifies
the directional 220-ohm deck (no obsolete `1G` stamp), and requires the
packaged app path. The acceptance test now decodes every imported `digit-0`
through `digit-9` fixture against the shared renderer patterns, in addition to
the live/stopped fixture checks.

## Issue-to-commit and current evidence map

| Issue | Code/test landing | Current packaged evidence |
| --- | --- | --- |
| SHELL-01 | `cad4a69`, shell tests | RC populated Explorer/minimum capture |
| SHELL-02 | `22f7366`, `6d96e3c`, `811b0c7` | current Settings light/dark; Chrome six-state absence check |
| SHELL-03 | `cad4a69` | RC Explorer at 900 and 1440 |
| SHELL-04 | `cad4a69`, `24f7583` | `native/final/titlebar-action-log.json`; direct AX width 1182→1224→1182 and measured drag delta |
| SHELL-05 | `cad4a69`, `6d96e3c` | Settings and populated editor captures |
| SHELL-06 | `71ad682` | current symbol placement states plus geometry tests |
| SHELL-07 | `cad4a69` | current packaged rail/settings light/dark |
| COMP-01 | `fd2193a`, `d3c9c3d` | current PULSE/source properties and clean packaged rerun |
| COMP-02 | `02371ec` | current source and component-property inspectors |
| COMP-03 | `71ad682` | current-source palette/glyph capture |
| COMP-04 | `02371ec`, `24f7583` | current component inspectors; LED Red/Green color/Vf captures |
| COMP-05 | `d6fbcfd` | connected RC ground and ngspice run |
| COMP-06 | `22f7366`, `551ec0a` | movable inspector chrome and selection-identity tests |
| COMP-07 | `71ad682` | polarized-cap placement/properties capture |
| COMP-08 | `71ad682`, `d6fbcfd`, `24f7583` | LED placement/properties plus Red/Green typical-Vf interaction |
| COMP-09 | `66e96aa`, `d6fbcfd` | zener placement/properties capture and identity tests |
| COMP-10 | `71ad682` | photodiode placement/properties capture |
| COMP-11 | `22f7366`, `02371ec`, `811b0c7` | Settings absence plus exact-model recovery copy |
| COMP-12 | `fd2193a`, `d3c9c3d` | PULSE property edit/rerun and source/PWL validation tests |
| COMP-13 | `f173b18`, `811b0c7` | bounded op-amp inspector plus deck/unit tests |
| COMP-14 | `02371ec`, `d3c9c3d` | current concise inspectors; one-line engineering help |
| COMP-15 | `71ad682`, `811b0c7` | seven-segment symbol and digit matrix |
| COMP-16 | `1bd9327`, `be88bbe`, `0b5d22b`, `d3c9c3d` | digits 0–9/live/stopped packaged corpus |
| COMP-17 | `71ad682` | switch placement/properties capture |

All 24 stable rows have a current packaged artifact or a current packaged
shell/state artifact plus focused code tests, indexed by the current native
manifest. This is not a claim that Sol High has approved the work: **Final Sol
High review: PENDING**.

## Literal gates

All commands below returned exit 0 on the current correction tree. The
packaged binary and DMG were built from functional/package code tip `d3c9c3d`;
the only post-build source change is the matching stale-diagnostic assertion in
`nativeSpice.test.ts`.

- Focused correction suite: **261 files passed; 2 skipped; 4,426 tests passed;
  8 skipped** (the full suite includes the correction tests).
- `pnpm -C apps/desktop typecheck`: **exit 0**.
- `pnpm -C apps/desktop test`: **261 files passed; 2 skipped; 4,426 tests
  passed; 8 skipped**.
- `bash scripts/design-system-drift.sh`: **DESIGN-SYSTEM-DRIFT: ok**;
  6 files / 49 tests passed.
- `bash scripts/min-window-dod.sh`: **MIN-WINDOW: 900x600 fail=0/12**;
  **MIN-WINDOW-DOD: ok**.
- `node scripts/validate-ui-ux-matrix.mjs`: **30/30 keys; 8 interaction
  artifacts; all files and dimensions verified**.
- `scripts/sevenseg-acceptance.sh .../Tau.app`: **12/12 fixtures current; 1
  file / 22 tests passed; packaged app worker smoke passed**.
- `pnpm --filter @tau/desktop build`: **exit 0** (2,247 modules; normal Vite
  externalization/chunk-size warnings only).
- `pnpm --filter @tau/desktop tauri build`: **exit 0**; Tau.app and
  `Tau_1.0.0_aarch64.dmg` produced from `d3c9c3d`.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`:
  **exit 0**.
- `cargo clippy --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml
  -- -D warnings`: **exit 0**.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: **104
  passed; 0 failed; 42 ignored** (main/doc-test targets also passed).
- `TAU_NGSPICE_LIB=.../libngspice.dylib cargo test ... --ignored`: **42
  passed; 0 failed; 0 ignored**.
- `codesign --verify --deep --strict Tau.app`: **exit 0**.
- `hdiutil verify Tau_1.0.0_aarch64.dmg`: **VALID**.
- Packaged engine smoke: **336 samples, out=0..5 V**; the seven-segment runner
  and native package worker smoke both passed.

Final Sol High review remains **PENDING**; no Sol review was run here.
