# UI/UX correction QA evidence

Run date: 2026-08-11  
Integration SHA: `83b5a05` (correction pass in progress)  
Planning base: `8fb45f623baee1cd0429a0a161fcd28b5278fa62`  
Packaged app: `apps/desktop/src-tauri/target/release/bundle/macos/Tau.app`

## Evidence policy

Sol High rejected the previous completion signal at `5f5fd20`. The earlier
native and Chrome captures are retained as historical artifacts, but they are
not acceptance evidence for this pass. In particular, the edited-circuit
capture contains 26 simulation errors and disconnected additions, and the
seven-segment captures show only an undriven blank display. The Chrome set
covered empty states only; no Chrome file-upload claim is made here. Native
packaged Computer Use is authoritative for import, editing, simulation, and
native chrome.

Only a fresh capture that names the exact issue, app state, theme, viewport,
action, result, and absolute screenshot path may move a tracker item to
`FIXED` or `ALREADY SATISFIED`. A filename by itself is not proof.

## Sol High correction findings

- `COMP-01`: legacy `vac`/`iac`/`vpulse` edit and waveform migration must remain
  lossless, preserve explicit DC bias, and build a runnable deck.
- `COMP-13`: generic op-amp displayed defaults must match bounded deck behavior.
- `SHELL-02`: manual Model libraries authoring must be hidden from the default
  toolbar, command palette, and Settings without weakening exact resolution.
- `COMP-12`: invalid source drafts and non-binary logic constants must not
  mutate the schematic.
- `COMP-09`, `COMP-16`, `COMP-06`: zener identity, directional seven-segment
  semantics, and selection-identity inspector placement need code and tests.
- Evidence gaps remain open for the stable issues listed in `UI_UX_FIXES.md`;
  the prior “all 24 fixed” table is withdrawn.

## Fresh correction evidence log

No fresh packaged correction evidence has been recorded yet. The required
matrix is: light and dark themes × 900×600, 1280×800, and 1440×900, with
empty editor, populated connected schematic, selected component, properties,
and simulator states. The native run must also show seven-segment digits 0–9,
live and stopped states, a meaningful edited connected circuit with zero
errors, current-source glyph geometry, and source/model validation results.

Screenshots will be stored under this directory with issue/state names and
indexed here as they are captured.

## Historical artifacts (not acceptance proof)

The prior run's images remain under `native/` and `chrome/` for comparison.
They must not be cited as current proof for any reopened issue.
