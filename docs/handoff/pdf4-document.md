# PDF4 document-lane wiring handoff

## Project-linked sheets (P4-14)

The document lane adds a real, pure hierarchy compiler at
`apps/desktop/src/schematic/projectHierarchy.ts`.

- The project/Run owner must load every candidate Tau sheet through
  `validateSchematicDocument`, key it by its **canonical project-relative**
  `.sim` / `.tau.json` path, and call `buildProjectHierarchyDeck({ rootPath,
  root, sheets, analysis })` before native run.
- If the active document contains any `component.projectSubcircuit`, it must
  use this compiler exclusively. Do not fall back to a bare `buildSpiceDeck`:
  that would turn a missing/cyclic link into an unhelpful unresolved `X` line.
  Surface `ProjectHierarchyError.message` as the run/diagnostic refusal.
- The compiler is intentionally standalone and only emits a tested real
  passive (`R/C/L`) + nested Tau-link child subset. Unsupported child contents,
  attached models, imported hierarchy, missing sheets, cycles, duplicate ports,
  model collisions, and inline/bundled-definition collisions all refuse.
- The schema API is in `useSchematic`:
  `setProjectSheetPorts(ports)` atomically marks ordered label ports, and
  `setProjectSubcircuitLink(id, link)` builds the visible p1..pN bank with the
  ordered names. Link paths are relative to the open project; a UI must not
  hand it an absolute path. `projectPorts` and `projectSubcircuit` persist in
  `.sim` / `.tau.json`; ASC save is deliberately blocked as lossy.
- Inspector/project UI is still needed to choose a sibling sheet, edit its
  explicit ordered port list/direction markers, and call these APIs. This lane
  did not edit `App.tsx`, inspector, or project explorer wiring.

## Clear-sheet and diagnostics wiring

- The shell bin confirmation should say **“Clear schematic”**, call
  `useSchematic.getState().clearSheet()` only on confirm, and preserve the
  disk file/project tree/tab identity. The store action is undoable and never
  performs filesystem work.
- `DiagnosticsTab` now accepts `onFocusDiagnostic(target)`, where target is a
  structured component or net focus target. Wire this to existing Canvas
  selection/pan behavior; keep `onSelectComponent` as the fallback for old
  callers. It already locally deduplicates equivalent live/engine messages.

