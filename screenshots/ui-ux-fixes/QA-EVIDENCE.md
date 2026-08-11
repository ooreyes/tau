# UI/UX correction QA evidence

Capture date: 2026-08-11 (fresh packaged-app restart after the laptop-overlap
warning). Planning base: `8fb45f6`. Functional code/test tip: `44333cf`.
The current evidence was recorded in commit `3687171`; the final heartbeat
metadata commit is its direct descendant.

The packaged binary was rebuilt from the same correction lineage and is at
`/Users/omarreyes/Desktop/Tau/apps/desktop/src-tauri/target/release/bundle/macos/Tau.app`.
The current binary code is `811b0c7`; `44333cf` adds the corrected physical
pin-order fixtures and their decode assertions. Native screenshots are JPEG
payloads retained with the repository's `.png` naming convention, as are the
existing screenshot-pipeline artifacts. Their measured pixel bounds are in
`evidence-manifest.json`.

## Acceptance policy and truth status

Computer Use on the packaged Tauri app is authoritative for import, editing,
properties, simulation, model recovery, and macOS chrome. Chrome `dev:web` is
responsive/console evidence only; no Chrome file-upload claim is made.

This file supersedes the earlier `0b5d22b` QA prose. The current evidence was
recaptured after a clean packaged restart and after correcting the fixture
generator's physical pin order. The 24 stable issue rows below are now
`FIXED_WITH_CURRENT_EVIDENCE`; the final Sol High review remains explicitly
`PENDING` and is not represented as a passed gate.

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
- Title-bar/window actions: `native/titlebar-actions.json` indexes the fresh
  before/move/double-click/system-zoom/restore screenshots and measured bounds.
  A title-bar drag was exercised. The automation backend's direct double-click
  gesture was also exercised; the native Window → Zoom command is the measured
  zoom/restore control because the direct gesture did not change bounds in this
  window-manager session. This limitation is disclosed rather than inferred
  from cursor artwork.

### Native viewport convention

The app was exercised at requested logical 900×600, 1280×800, and 1440×900
states. Computer Use returns the app-content screenshot bounds rather than the
logical window bounds; the exact requested viewport, screenshot pixel bounds,
gesture coordinates, and assertions are machine-readable in
`evidence-manifest.json`.

## Current Chrome responsive/console evidence

`chrome/devweb-matrix.json` records all six exact combinations and
`chrome/devweb-console.log` records the complete warning/error readout. The
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
| SHELL-04 | `cad4a69` | `native/titlebar-actions.json` and current bounds captures |
| SHELL-05 | `cad4a69`, `6d96e3c` | Settings and populated editor captures |
| SHELL-06 | `71ad682` | current symbol placement states plus geometry tests |
| SHELL-07 | `cad4a69` | current packaged rail/settings light/dark |
| COMP-01 | `fd2193a`, `811b0c7` | source properties, edit `5→4`, clean packaged rerun |
| COMP-02 | `02371ec` | current source and component-property inspectors |
| COMP-03 | `71ad682` | current-source palette/glyph capture |
| COMP-04 | `02371ec` | current polarized-cap/LED/zener/photodiode/op-amp/switch inspectors |
| COMP-05 | `d6fbcfd` | connected RC ground and ngspice run |
| COMP-06 | `22f7366`, `551ec0a` | movable inspector chrome and selection-identity tests |
| COMP-07 | `71ad682` | polarized-cap placement/properties capture |
| COMP-08 | `71ad682`, `d6fbcfd` | LED placement/properties capture and electrical tests |
| COMP-09 | `66e96aa`, `d6fbcfd` | zener placement/properties capture and identity tests |
| COMP-10 | `71ad682` | photodiode placement/properties capture |
| COMP-11 | `22f7366`, `02371ec`, `811b0c7` | Settings absence plus exact-model recovery copy |
| COMP-12 | `fd2193a`, `811b0c7` | PULSE property edit/rerun and source/PWL validation tests |
| COMP-13 | `f173b18`, `811b0c7` | bounded op-amp inspector plus deck/unit tests |
| COMP-14 | `02371ec` | current concise inspectors |
| COMP-15 | `71ad682`, `811b0c7` | seven-segment symbol and digit matrix |
| COMP-16 | `1bd9327`, `be88bbe`, `0b5d22b`, `44333cf` | digits 0–9/live/stopped packaged corpus |
| COMP-17 | `71ad682` | switch placement/properties capture |

All 24 stable rows have a current packaged artifact or a current packaged
shell/state artifact plus focused code tests. This is not a claim that Sol High
has approved the work: **Final Sol High review: PENDING**.

## Literal gates

All commands below returned exit 0 against the current correction tree before
the evidence commit `3687171`; the final descendant changes only tracker
metadata and the heartbeat:

- Focused correction suite: **9 files passed; 344 tests passed**.
- `pnpm -C apps/desktop typecheck`: **exit 0**.
- `pnpm -C apps/desktop test`: **262 files passed; 2 skipped; 4,405 tests
  passed; 8 skipped**.
- `bash scripts/design-system-drift.sh`: **DESIGN-SYSTEM-DRIFT: ok**;
  6 files / 49 tests passed.
- `bash scripts/min-window-dod.sh`: **MIN-WINDOW: 900x600 fail=0/12**;
  **MIN-WINDOW-DOD: ok**.
- `scripts/sevenseg-acceptance.sh .../Tau.app`: **12/12 fixtures current; 1
  file / 22 tests passed; packaged app present**.
- `pnpm --filter @tau/desktop build`: **exit 0** (2,243 modules; normal Vite
  externalization/chunk-size warnings only).
- `pnpm --filter @tau/desktop tauri build`: **exit 0**; Tau.app and
  `Tau_1.0.0_aarch64.dmg` produced.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`:
  **exit 0**.
- `cargo clippy --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml
  -- -D warnings`: **exit 0**.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: **104
  passed; 0 failed; 42 ignored** (plus zero-test main/doc-test targets).
- `TAU_NGSPICE_LIB=.../libngspice.dylib cargo test ... --ignored`: **42
  passed; 0 failed; 0 ignored**.
- `codesign --verify --deep --strict Tau.app`: **exit 0**; deployment target
  **macOS 11.0 arm64, 9 files**.
- `hdiutil verify Tau_1.0.0_aarch64.dmg`: **VALID**.
- Mounted DMG proof: **resource diff clean; mounted ignored ngspice 42 passed;
  packaged-engine-smoke 336 samples, out=0..5 V; Tau executable stayed alive
  for 5 seconds**.

The evidence commit that records this block is `3687171`, directly after the
code/test tip `44333cf`. The final descendant records the completed heartbeat
and preserves this evidence unchanged. Final Sol High review remains
**PENDING**.
