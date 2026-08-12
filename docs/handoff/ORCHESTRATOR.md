# Orchestrator notes to the lanes (read this if your lane is named)

## DOCK — your ownership is extended to the drawer module

`P3-14` cannot be finished from `App.tsx` alone. You now also own:

- `apps/desktop/src/components/drawer/ResultsDrawer.tsx`
- `apps/desktop/src/components/drawer/ResultsDrawer.test.tsx`
- `apps/desktop/src/components/drawer/DiagnosticsTab.tsx`

No other lane touches them.

Two things found while mapping the code, so you do not have to rediscover them:

1. `ResultsDrawer` already drops a tab whose `content` is `null` — see the case
   at `ResultsDrawer.test.tsx:209-211` ("a tab that opens onto nothing"). So the
   Measurements tab disappearing in schematic mode may be as small as passing
   `measurements={null}` while `mode === "schematic"` at `App.tsx:3878`. Verify
   that the tab strip then renders as a single Errors tab and not as a
   one-item tab strip that still looks like a chooser. The report's ask is
   "just having an errors section", so a lone tab that cannot be switched away
   from should read as a section header, not a tab.
2. `App.tsx:3869` already passes `preferredTab={mode === "simulator" ?
   "waveforms" : "errors"}`, and `App.tsx:1296` says `diagnosticsBadge` is
   "the same count the Errors tab renders". Keep that identity true — the
   report's done-when requires badge count === row count — and check it still
   holds once validation runs pre-run, which is the part that is currently
   missing.

## Orchestrator's own integration queue (applied after the lanes finish)

1. **`Canvas.tsx` reveal input, for DOCK's benefit.** DOCK's P3-14 done-when
   includes "each row … selects/centres it when clicked". `select(id)` is
   reachable from DOCK, but centring is not: `Canvas.tsx` exposes only a
   `fitSignal`, which frames *all* artwork. CANVAS owns that file and its brief
   was already sent, so the orchestrator adds the `revealComponentId` /
   `revealSignal` input during integration rather than having two lanes edit
   `Canvas.tsx`. DOCK should build the row click to call `select(id)` and leave a
   clearly-named seam for the centring half.

2. **`data-owner` on label groups, for the P3-07 gate.** The Playwright gate can
   prove label-vs-label overlap, but not label-vs-artwork, because
   `ComponentLabels` renders `<g key={c.id}>` with no attribute tying a label
   back to its own part — so a label legitimately sitting beside its own body
   cannot be told from one printed across a neighbour's. CANVAS should assert the
   artwork invariant in a **unit** test, where it has component identity. The
   gate reports the artwork number as informational only, and says so.

## Measured baseline, so no lane invents a change that is not needed

The orchestrator ran `scripts/pdf3-verify.mjs` against a pristine worktree at the
base commit. Two results worth knowing before you edit:

- **P3-08 already passes on every web placement path measured**: palette click
  with the tool rotated twice, the same with the tool also mirrored, and a
  palette drag all produced `rotation 0, mirrored false`. If SYMBOLS cannot
  reproduce a sideways ground either, the honest answer is `ALREADY SATISFIED`
  with the .asc-import and assistant paths checked and a regression test added —
  not an invented change. The reported screenshot may predate the
  `kind === "ground" ? 0 : s.placeRotation` rule at `useSchematic.ts:1153`.
- **P3-02's pointer fallback works under synthetic mouse events**: Playwright's
  `dragTo` did move the file, because it drives pointer events and hits
  `beginPointerDrag`. `draggable` is still absent and still the defect — the
  native HTML5 path is dead code in WebKit — so the gate asserts the attribute
  itself, not just that some drag succeeded.

## Everyone — the dev bridge now exposes the document store

`apps/desktop/src/lib/devBridge.ts` (dev-only, folded out of production builds)
now exposes `useSchematic` alongside `useProject`. The orchestrator's capture
harness uses it to read store facts a screenshot cannot show — a dropped
ground's real rotation, whether Backspace removed a net label from the document
or only its glyph, whether a waveform change rewrote `kind` as well as `value`.
The orchestrator owns that file; do not edit it. If you want another accessor on
it, ask here.
