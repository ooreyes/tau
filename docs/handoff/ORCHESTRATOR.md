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

## Everyone — the dev bridge now exposes the document store

`apps/desktop/src/lib/devBridge.ts` (dev-only, folded out of production builds)
now exposes `useSchematic` alongside `useProject`. The orchestrator's capture
harness uses it to read store facts a screenshot cannot show — a dropped
ground's real rotation, whether Backspace removed a net label from the document
or only its glyph, whether a waveform change rewrote `kind` as well as `value`.
The orchestrator owns that file; do not edit it. If you want another accessor on
it, ask here.
