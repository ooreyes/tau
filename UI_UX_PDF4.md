# Tau UI/UX Remediation - PDF report 4 (20 items)

Source: `/Users/omarreyes/Downloads/Untitled document (2).pdf` (9 pages),
reviewed visually and by text extraction on 2026-08-13.

Integration branch: `fix/pdf3-fourteen-items`, starting at reviewed tag
`pdf3-fourteen-items-reviewed` / commit `5d476d1`. The branch
`auto/ltspice-parity` remains untouched.

Run ID: `pdf4-20260813-1`.

## Product decisions and non-negotiables

- A probe is identified by electrical net, not click coordinates. A net has at
  most one voltage probe; distinct nets receive distinct visible colors.
- "Delete schematic" clears the complete in-memory sheet after confirmation,
  including a saved sheet, but never deletes or overwrites the saved file.
- Advanced SPICE capabilities remain truthful. Small-signal AC stimulus,
  saturation current, and attached model resolution may be progressively
  disclosed, but they are not removed from the data model, importer, exporter,
  or engine.
- Component references are unique case-insensitively. Rename refuses a
  collision with inline feedback. New placement uses the lowest available
  positive suffix. Deleting `R2` may make the next resistor `R2`; existing
  references are never silently renumbered because directives and measurements
  may refer to them.
- `.lib` controls are hidden for ordinary Tau-owned generic parts. They remain
  available where a named/imported/unresolved device genuinely needs model
  resolution. Tau continues to import unmodified `.asc` documents.
- Polarity marks appear only where electrical polarity is meaningful. Passive
  non-polar parts and bidirectional switches do not gain false `+`/`-` marks.
- A linked subcircuit is a project-backed child schematic with an explicit,
  ordered port contract. It is not a pasted copy and not a silently substituted
  model. Missing/invalid child sheets fail closed with a diagnostic.
- Stop is visible while a run is cancellable. Idle transport does not present a
  dead Stop button. Run and Ask Bode may use a restrained, token-driven shared
  sheen; reduced-motion users get a static state.
- The empty lower-right area is balanced with existing project/run context only;
  this report does not authorize a new product feature.

Every change preserves unmodified `.asc` round-trip, exact model resolution,
fail-closed named-device behavior, derived netlists, undo/redo, design tokens,
and the proprietary license. New CSS uses existing tokens or adds tokens only
inside the token source; no component-level raw colors.

## Fleet ownership

The orchestrator alone owns `PROGRESS.md`, `FEATURE_PARITY.md`,
`UI_UX_FIXES.md`, this file, `scripts/`, integration, screenshots, and pushes.
Workers use isolated local-only worktrees and never fetch, reset, push, merge,
or edit orchestrator-owned tracking files.

| Lane | Items | Primary ownership |
| --- | --- | --- |
| DOCUMENT | 1, 2, 14, 17 | schematic/project stores, hierarchy model/emission, document diagnostics, focused UI wiring |
| INSPECTOR | 7-13, 15-16 | inspector editors/schema/validation, pins and electromechanical/semiconductor symbols, palette preview |
| CHROME | 3-6, 18-20 | editor chrome, cursors, empty state/layout, settings placement, transport styling |

Cross-lane changes are requested in `docs/handoff/pdf4-<lane>.md`; a worker does
not edit another lane's files to make a local test pass.

## Items and acceptance contracts

### P4-01 - one deterministic color per electrical net

Placing a voltage probe replaces any existing probe on that net. Different nets
receive different colors while the palette has an unused entry; colors are
stable through save/load and undo/redo. Tests cover repeated clicks on one net,
two geometrically separate points on one net, distinct nets, manually duplicated
legacy colors, and probe deletion/replacement.

### P4-02 - confirmed whole-sheet delete, independent of save state

The bin opens a clear confirmation for dirty and clean/saved schematics. Confirm
removes components, wires, labels, probes, directives, and selection as one
undoable document operation; cancel changes nothing. Disk content and project
tree remain untouched. Copy names "Clear schematic" rather than implying file
deletion.

### P4-03 - Bode empty panel centered in the actual canvas viewport

The empty-state panel centers inside the visible schematic stage after Explorer,
inspector, parts rail, and resizable panel widths are applied. It stays centered
at 900x600, 1280x800, and 1440x900 while either side panel is resized.

### P4-04 - readable, accessible editor toolbar

Primary editor targets are at least 32x32 CSS px, glyphs remain legible, and the
strip scrolls/reflows without clipping at 900x600. Disabled/active/focus states
remain distinct in both themes.

### P4-05 - physical tag cursor

Net-label mode uses a custom tag cursor comparable in scale to the probe lead.
Its attachment point/hotspot is at the tag's short end nearest the selector; the
preview and committed anchor agree at every supported zoom.

### P4-06 - compact, standard toolbar rhythm

Toolbar controls use one target scale and a tighter token-driven gap comparable
to desktop editor chrome. No control overlaps or drops below the item 4 floor.

### P4-07 - source inspector clarity, drag dismissal, and reference identity

Small-signal AC becomes an Advanced disclosure labelled "AC analysis stimulus"
with a one-line explanation. The property surface hides while the selected part
is actively dragged and returns afterward. Waveform and field rows align. IDs
are unique case-insensitively with inline collision feedback and lowest-free
allocation for new parts; existing parts never auto-renumber.

### P4-08 - aligned fields without clipped ranges

Potentiometer and other dense rows align labels, controls, units, and bounds.
`0-100%` and engineering ranges remain fully readable at the minimum window.

### P4-09 - saturation current is advanced but teachable

Generic diode saturation current remains editable under Advanced device model
parameters and has a concise explanation of leakage/current scaling. The common
view is not dominated by it.

### P4-10 - LED light color, naming, and Vf behavior

Only the emitted-light arrows use the selected LED color; the diode body uses
normal schematic ink. Copy reads "Generic LED" and explains that each color has
a default adjustable forward voltage. Changing color updates an untouched
default Vf but preserves a user override.

### P4-11 - model attachment only when electrically relevant

Generic Tau components do not show an unconditional "Attach .lib/.sub" action.
Imported/named/unresolved components still expose the exact-model resolution
path. Backend attachment and round-trip behavior remain covered.

### P4-12 - EveryCircuit-level semiconductor controls with one-line help

Supported diode/BJT/JFET/MOSFET controls expose the authored parameter set Tau
can simulate honestly. Every adjustable field has one concise student-facing
effect description, valid bounds, and unit-aware input.

### P4-13 - meaningful terminal polarity

Voltage sources, polarized capacitors, diodes/LEDs/photodiodes/zener, and other
directed devices show correct polarity/anode-cathode cues in canvas and palette
preview. Non-polar/bidirectional parts do not. Rotation/mirror tests prove marks
remain attached to the correct pins.

### P4-14 - project-linked hierarchical subcircuits

A subcircuit instance can select another schematic in the open project, define
an ordered list of named ports from labels/explicit port markers, and render
those names on its symbol. Deck generation resolves the child sheet recursively,
maps parent nets by that order, rejects cycles/missing sheets/duplicate ports,
and emits a deterministic `.subckt` block. The link survives save/reopen and
undo/redo. A two-sheet buck/boost-style fixture proves parent-to-child signal
flow with native ngspice. Imported file-backed `.subckt` behavior is unchanged.

### P4-15 - truthful electromechanical drawings and kind-aware values

SPST switch and push-button expose only their two path terminals. SPDT exposes
COM/NO/NC once each. Relay visibly includes coil plus contact and has four
functional terminals. No artwork creates phantom connection targets. Every
component editor rejects syntactically invalid values (including arbitrary text
such as `ejeeje`) with inline feedback and without committing an invalid deck.

### P4-16 - selected component preview

The component rail's symbol viewer shows the currently highlighted catalog
item, including CT transformer and every electromechanical symbol, using the
same symbol/pin geometry as the canvas.

### P4-17 - code-editor-grade diagnostics

Diagnostics list individual errors and warnings with severity color/icon,
human-readable message, affected reference/net, and an action that focuses the
offending object. Count-only status is not the primary presentation. The panel
is usable before Run and engine diagnostics merge without duplication.

### P4-18 - settings in the lower-right utility position

Settings moves to the lower-right shell utility area. Run and Ask Bode shift to
the right-hand action group without overlap at minimum width. The old settings
placement disappears.

### P4-19 - calmer transport with truthful motion

Idle chrome shows Run, not a permanently enabled Stop pair. Stop appears while
the current run can be cancelled. Run and Ask Bode share a restrained sheen in
the established accent palette and animate in phase; `prefers-reduced-motion`
removes animation. Live simulator semantics and cancellation remain honest.

### P4-20 - balance the lower-right without scope invention

Use existing project/run context (for example current analysis and compact run
state) or spacing/material adjustments to balance the lower-right corner. No
new feature, telemetry, tutorial, or decorative card. Screenshot review decides
between the smallest alternatives.

## Gates and evidence

Before integration: focused lane tests and typecheck. Before push:

```bash
pnpm -C apps/desktop typecheck
pnpm -C apps/desktop test
pnpm --filter @tau/desktop build
node scripts/design-system-dod-grep.mjs
```

Engine/hierarchy changes additionally require native Rust gates and a real
ngspice hierarchy fixture. Final evidence is light/dark at 900x600, 1280x800,
and 1440x900 plus packaged WKWebView interaction for cursor/drag/transport.
Screenshots and machine-readable measurements live under
`screenshots/pdf4-verify/`.

## 2026-08-13 checkpoint

Commit `0ece2f7` is the pushed, green Luna-authored checkpoint. It is not the
final reviewed tag. Evidence and exact gate results are in
`screenshots/pdf4-verify/REPORT.md`.

Final Sol closure review confirmed stable project-port persistence, recursive
hierarchy execution/fail-closed behavior, the end-to-end child interface UI,
named photodiode exact/refusal behavior, advanced model disclosure, corrected
zener and placement semantics, and the staged Tau-worker hierarchy fixture.
The following remain open before this contract can be marked complete:

- P4-01: manual trace/probe recoloring can duplicate another active net color.
- P4-15: malformed multi-token switch text is still presented as a named model;
  named controlled switches can silently behave open in preview fallback.
- P4-17: hierarchy diagnostics lose focus metadata after entering Simulator;
  net focus lacks a visible selection/highlight when the target is on screen.
- P4-14 copy: “saved” must say the interface was applied to dirty memory and
  still needs a document save.

Implementation is paused because the separate GPT-5.6 Luna coding task reached
its weekly limit. Sol remains review-only and has not authored these changes.
