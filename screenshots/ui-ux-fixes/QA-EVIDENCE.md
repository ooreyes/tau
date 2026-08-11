# UI/UX remediation QA evidence

Run date: 2026-08-11  
Integration SHA: `564c375926ca7f7a80a7b3977a260c9ce11ba1f5`  
Planning base: `8fb45f623baee1cd0429a0a161fcd28b5278fa62`  
Packaged app: `apps/desktop/src-tauri/target/release/bundle/macos/Tau.app`

The `screenshots/ui-ux-fix-brief/` images referenced by each tracker item are
the before/source captures. The native and Chrome images below are the
after-state captures from this integration. Every stable issue is marked
`FIXED` in `UI_UX_FIXES.md` only with a code commit, a literal focused test
result, and a matching packaged or browser capture.

## Native Computer Use run

- Imported unmodified `Circuit_testing_v1/02_tran_rc_pulse_meas.asc` into the
  disposable project `/private/tmp/tau-qa-project`.
- Baseline packaged run: `COMPLETE`, `3,079 samples`, `3 nets · 4 parts`,
  engine `ngspice`; measured `vmax 4.967 V`, `vavg 2.501 V`.
- Edited-circuit run after placing LED, Zener, photodiode, op amp, seven
  segment, switch, polarized capacitor, and D flip-flop: `COMPLETE`, `3,104
  samples`, engine `ngspice`; simulator reports `U2 display: blank` for the
  deliberately undriven seven-segment nodes (derived state, no fabricated
  digit).
- Source editing accepted a valid pulse change and rejected a non-finite
  draft with `Enter a finite V.`; the invalid draft remained visible.
- Native inspector movement, color selection, title-bar drag, double-click
  zoom/restore, fullscreen toggle, settings theme changes, and simulator
  controls were exercised with fresh accessibility state after each action.
- Native resize targets were exercised at 900×600, 1280×800, and 1440×900 in
  both themes. macOS display scaling produces 1181×737 and 1230×768 capture
  pixels for the larger native targets; the 900×600 capture is 900×600.

## Chrome dev:web run

Chrome loaded `http://localhost:1420/` at all requested sizes and themes.
For every row, `scrollWidth == innerWidth` and `scrollHeight == innerHeight`;
the filtered app-origin console error count was `0` after reload.

| Theme | Viewport | Metrics | Capture |
| --- | --- | --- | --- |
| dark | 900×600 | 900×600, overflow 0 | `chrome/01-dark-900x600-empty.png` |
| dark | 1280×800 | 1280×800, overflow 0 | `chrome/03-dark-1280x800-empty.png` |
| dark | 1440×900 | 1440×900, overflow 0 | `chrome/04-dark-1440x900-empty.png` |
| light | 900×600 | 900×600, overflow 0 | `chrome/07-light-900x600-empty.png` |
| light | 1280×800 | 1280×800, overflow 0 | `chrome/06-light-1280x800-empty.png` |
| light | 1440×900 | 1440×900, overflow 0 | `chrome/05-light-1440x900-empty.png` |

The Chrome extension's local-file bridge refused the `.asc` file chooser
operation. This is an environment permission, not an app-origin failure; the
packaged Computer Use run above proves the end-to-end import/edit/simulation
path. To enable that optional Chrome upload path, Chrome reports: “To enable
file upload, open chrome://extensions, click Details under the ChatGPT browser
extension, and enable \"Allow access to file URLs.\"”

## Issue-to-commit and visual index

| Issue | Implementation commit(s) | Literal focused result | After-state evidence |
| --- | --- | --- | --- |
| SHELL-01 | `cad4a69` | shell 5 files / 75 passed; integrated shell 6 files / 46 passed | `native/09-dark-900x600-schematic.png`, `native/18-light-900x600-schematic.png`, `chrome/01-dark-900x600-empty.png` |
| SHELL-02 | `d6fbcfd`, `02371ec` | electrical 12 files / 723 passed; inspector 3 files / 114 passed | `native/13-light-1440x900-settings.png`, `native/20-light-900x600-led-amber-inspector.png`, `native/23-light-900-opamp-inspector.png` |
| SHELL-03 | `cad4a69` | shell 5 files / 75 passed; design drift 9 checks + 48 tests passed | `native/09-dark-900x600-schematic.png`, `native/17-light-900x600-simulator.png`, `chrome/07-light-900x600-empty.png` |
| SHELL-04 | `cad4a69` | native shell contract tests; packaged drag/double-click/fullscreen actions completed | `native/28-light-titlebar-moved.png`, `native/29-light-titlebar-zoom.png`, `native/30-light-window-zoom-control.png` |
| SHELL-05 | `cad4a69`, `6d96e3c` | command-palette reachability 1 file / 3 passed; design drift 9 checks + 48 tests passed | `native/13-light-1440x900-settings.png`, `chrome/05-light-1440x900-empty.png` |
| SHELL-06 | `71ad682` | symbols lane 5 files / 215 passed | `native/26-light-900-polarized-cap-inspector.png`, `native/09-dark-900x600-schematic.png` |
| SHELL-07 | `cad4a69` | shell 5 files / 75 passed; design drift 9 checks + 48 tests passed | `native/09-dark-900x600-schematic.png`, `native/18-light-900x600-schematic.png`, `chrome/06-light-1280x800-empty.png` |
| COMP-01 | `d6fbcfd` | electrical 12 files / 723 passed; packaged pulse run COMPLETE / 3,079 samples | `native/03-dark-source-inspector-columns.png`, `native/10-dark-900x600-simulator-complete.png` |
| COMP-02 | `02371ec` | inspector 3 files / 114 passed | `native/03-dark-source-inspector-columns.png`, `native/20-light-900x600-led-amber-inspector.png`, `native/23-light-900-opamp-inspector.png` |
| COMP-03 | `71ad682` | symbols lane 5 files / 215 passed | `native/01-dark-imported-rc-default.png`, `native/03-dark-source-inspector-columns.png` |
| COMP-04 | `02371ec` | inspector 3 files / 114 passed; design drift 9 checks + 48 tests passed | `native/20-light-900x600-led-amber-inspector.png`, `native/21-light-900-zener-inspector.png`, `native/26-light-900-polarized-cap-inspector.png` |
| COMP-05 | `d6fbcfd` | electrical 12 files / 723 passed; native run COMPLETE | `native/09-dark-900x600-schematic.png`, `native/18-light-900x600-schematic.png` |
| COMP-06 | `02371ec` | inspector 3 files / 114 passed; native drag completed | `native/05-dark-inspector-moved.png`, `native/20-light-900x600-led-amber-inspector.png` |
| COMP-07 | `71ad682` | symbols lane 5 files / 215 passed | `native/26-light-900-polarized-cap-inspector.png`, `native/18-light-900x600-schematic.png` |
| COMP-08 | `71ad682`, `d6fbcfd`, `02371ec` | electrical 12 files / 723 passed; inspector 3 files / 114 passed | `native/06-dark-led-inspector-geometry.png`, `native/20-light-900x600-led-amber-inspector.png`, `native/31-light-edited-circuit-simulation.png` |
| COMP-09 | `d6fbcfd`, `02371ec` | electrical 12 files / 723 passed; inspector 3 files / 114 passed | `native/21-light-900-zener-inspector.png` |
| COMP-10 | `71ad682` | symbols lane 5 files / 215 passed | `native/22-light-900-photodiode-inspector.png`, `native/18-light-900x600-schematic.png` |
| COMP-11 | `d6fbcfd`, `02371ec` | electrical 12 files / 723 passed; inspector 3 files / 114 passed; real-ngspice 42 passed / 0 failed | `native/13-light-1440x900-settings.png`, `native/23-light-900-opamp-inspector.png`, `native/32-dark-edited-circuit-simulation.png` |
| COMP-12 | `d6fbcfd`, `02371ec` | electrical 12 files / 723 passed; inspector 3 files / 114 passed | `native/04-dark-invalid-source-draft.png`, `native/20-light-900x600-led-amber-inspector.png` |
| COMP-13 | `d6fbcfd`, `02371ec` | electrical 12 files / 723 passed; inspector 3 files / 114 passed | `native/23-light-900-opamp-inspector.png`, `native/32-dark-edited-circuit-simulation.png` |
| COMP-14 | `02371ec` | inspector 3 files / 114 passed, including long-help audit | `native/20-light-900x600-led-amber-inspector.png`, `native/21-light-900-zener-inspector.png` |
| COMP-15 | `71ad682` | symbols lane 5 files / 215 passed | `native/27-light-900-dflipflop-inspector.png`, `native/31-light-edited-circuit-simulation.png` |
| COMP-16 | `10b043e` | simulator/operating-point 3 files / 92 passed; packaged edited run COMPLETE / 3,104 samples | `native/24-light-900-seven-segment-inspector.png`, `native/31-light-edited-circuit-simulation.png`, `native/32-dark-edited-circuit-simulation.png` |
| COMP-17 | `71ad682` | symbols lane 5 files / 215 passed | `native/25-light-900-switch-inspector.png`, `native/32-dark-edited-circuit-simulation.png` |

