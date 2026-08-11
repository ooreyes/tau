# UI/UX correction QA evidence

Run date: 2026-08-11
Code tip exercised by QA: `0b5d22b`
Planning base: `8fb45f623baee1cd0429a0a161fcd28b5278fa62`
Packaged app: `/Users/omarreyes/Desktop/Tau/apps/desktop/src-tauri/target/release/bundle/macos/Tau.app`

## Acceptance policy

This is the correction-pass record after Sol High rejected `5f5fd20`. Native
Tauri/Computer Use is authoritative for import, editing, simulation, model
resolution, and macOS chrome. Chrome `dev:web` is recorded only for responsive
layout and console diagnosis. No Chrome file-upload claim is made.

The old captures remain in `native/` and `chrome/` for historical comparison,
but the `packaged-*` and `devweb-*` files below were captured from the current
unsigned release bundle or the current Vite server after the correction code
landed. Native screenshots named `1280x800` are the 1182×768 content capture
inside the 1280×800 logical app window; Chrome captures are exact viewport
dimensions.

## Literal gate results

- Focused correction suite: **10 files passed; 312 tests passed**.
- Frontend suite: **260 files passed; 2 skipped; 4,368 tests passed; 8 skipped**.
- `pnpm -C apps/desktop typecheck`: **exit 0**.
- `bash scripts/design-system-drift.sh`: **DESIGN-SYSTEM-DRIFT: ok**.
- `bash scripts/min-window-dod.sh`: **MIN-WINDOW: 900x600 fail=0/12; MIN-WINDOW-DOD: ok**.
- `pnpm --filter @tau/desktop build`: **exit 0**.
- `cargo fmt --check`: **exit 0**; `cargo clippy -- -D warnings`: **exit 0**.
- Native Rust tests: **104 passed; 0 failed; 42 ignored**.
- Ignored real-ngspice tests with the packaged dylib: **42 passed; 0 failed; 0 ignored**.
- Tauri bundle: **exit 0**; app strict codesign verification **passed**;
  DMG `hdiutil verify` **VALID**; mounted deployment target **11.0 arm64**.
- Mounted packaged engine smoke: **passed, 336 samples, 0..5 V**; mounted
  app stayed alive for **5 seconds**.

## Current packaged native evidence

### Connected edit and shell/model proof

- `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-edited-circuit-dark-1280x800.png`
  and `.../packaged-edited-circuit-light-1280x800.png`: imported authored
  `Draft2.asc`, selected V1, changed amplitude `1 → 2`, saved, and reran. The
  connected circuit completed with **980 samples, 3 nets, 4 parts**, ngspice,
  and no Errors count.
- `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-current-source-dark-1280x800.png`:
  current-source glyph selected with its editable properties visible.
- `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-settings-dark-1280x800.png`
  and `.../packaged-settings-light-1280x800.png`: current Settings navigation
  has no Model libraries authoring page.
- `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-command-palette-dark-1280x800.png`:
  current palette contains component/settings commands and no Model libraries
  authoring command.
- `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-empty-dark-900x600.png`:
  packaged empty-editor minimum-window baseline.
- `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-titlebar-before-dark-1280x800.png`,
  `.../packaged-titlebar-after-drag-dark-1280x800.png`, and
  `.../packaged-titlebar-doubleclick-dark-1280x800.png`: Computer Use title-bar
  drag and double-click gestures on the packaged window; controls remained
  reachable and the app stayed alive.

### Seven-segment native simulation proof

Each fixture was imported through the packaged file picker and run separately;
the accessibility result for every run was `COMPLETE` with the matching
rendered digit. The fixtures are connected to eight independent voltage
sources and ground, so this is an electrical run, not a static display shot.

- Digits 0–4: `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-sevenseg-{0,1,2,3,4}-light-1280x800.png`
- Digits 5–9: `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-sevenseg-{5,6,7,8,9}-light-1280x800.png`
- Dark-theme digit 9: `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-sevenseg-9-dark-1280x800.png`
- Live run: `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-sevenseg-live-light-1280x800.png`,
  showing `Running — t = 214.726 s`, a live scope, and `Live — newest sample
  at the right edge`.
- Stopped run: `/Users/omarreyes/Desktop/Tau/screenshots/ui-ux-fixes/native/packaged-sevenseg-stopped-light-1280x800.png`,
  showing `Stopped at 975.667 s` and the explicit sample-budget reason.

### Responsive and console proof in Chrome

The current `dev:web` server was inspected at all requested sizes in both
themes. Screenshots:

- 900×600 settings: `chrome/devweb-settings-light-900x600.png`,
  `chrome/devweb-settings-dark-900x600.png`.
- 1280×800 settings: `chrome/devweb-settings-light-1280x800.png`,
  `chrome/devweb-settings-dark-1280x800.png`.
- 1440×900 settings: `chrome/devweb-settings-light-1440x900.png`,
  `chrome/devweb-settings-dark-1440x900.png`.
- 1440×900 empty editor: `chrome/devweb-empty-light-1440x900.png`,
  `chrome/devweb-empty-dark-1440x900.png`.

Measured DOM results were exact `900×600`, `1280×800`, and `1440×900` with
`scrollWidth == innerWidth`, `scrollHeight == innerHeight`, and no horizontal
or vertical overflow at any size. Page-origin console errors were **0**. Two
Chrome-extension transport messages (`Could not establish connection;
Receiving end does not exist`) were observed and are recorded as tooling noise,
not hidden as application output.

## Issue-to-commit and evidence map

All 24 stable issues are FIXED below. Focused tests are the correction suite
above; native paths are represented by the current packaged evidence index.

| Issue | Landed code | Acceptance evidence |
| --- | --- | --- |
| SHELL-01 | `cad4a69` | shell contract tests; current minimum-window matrix |
| SHELL-02 | `22f7366`, `6d96e3c` | Command Palette/Settings tests; current Settings and palette captures; exact-model/native smoke gates |
| SHELL-03 | `cad4a69` | shell tests; 900×600 packaged and Chrome no-overflow matrix |
| SHELL-04 | `cad4a69` | packaged title-bar drag/double-click captures above |
| SHELL-05 | `cad4a69`, `6d96e3c` | command/settings reachability tests and packaged captures |
| SHELL-06 | `71ad682` | rotation/mirror label geometry tests; current populated packaged editor |
| SHELL-07 | `cad4a69` | shell/design-token tests; packaged light/dark minimum-window matrix |
| COMP-01 | `fd2193a` | sourceValue, editor, deck, and legacy regression tests; imported/run edited circuit |
| COMP-02 | `02371ec` | shared inspector-row tests; selected packaged properties in both themes |
| COMP-03 | `71ad682` | current-source glyph geometry tests and selected packaged glyph capture |
| COMP-04 | `02371ec` | all-family inspector audit and validation-row tests; selected packaged properties |
| COMP-05 | `d6fbcfd` | ground identity/node-zero tests; connected packaged run |
| COMP-06 | `22f7366`, `02371ec`, `551ec0a` | drag/clamp and selection-identity tests; packaged selected inspector/title-bar captures |
| COMP-07 | `71ad682` | polarized-capacitor geometry tests; current design-token/minimum-window matrix |
| COMP-08 | `71ad682`, `d6fbcfd` | LED geometry/schema/model tests; current packaged selected-properties matrix |
| COMP-09 | `66e96aa`, `d6fbcfd` | zener identity/deck/range tests; exact-model safety gates |
| COMP-10 | `71ad682` | photodiode geometry and hit-bound tests; current packaged design matrix |
| COMP-11 | `22f7366`, `02371ec` | hidden picker tests; exact-model/refusal tests; packaged Settings/palette proof |
| COMP-12 | `fd2193a` | draft validation, binary logic, legacy source, and deck tests; packaged edit/run proof |
| COMP-13 | `f173b18`, `02371ec`, `551ec0a` | bounded op-amp model/deck/inspector tests and native gates |
| COMP-14 | `02371ec` | concise-help/long-description audit; packaged Settings/properties matrix |
| COMP-15 | `71ad682` | dense digital symbol rotation/mirror/collision tests; seven-segment packaged matrix |
| COMP-16 | `1bd9327`, `be88bbe`, `0b5d22b` | directional LED/deck tests; connected native 0–9/live/stopped proof |
| COMP-17 | `71ad682` | switch geometry/control-port tests; current packaged editor matrix |

The pre-correction captures are retained for audit history but are not used to
support this table. No Chrome upload is claimed. No named-device fallback was
introduced; exact imported/attached model resolution and fail-closed refusal
tests remain in the integrated suite.
