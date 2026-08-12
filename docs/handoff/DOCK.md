# DOCK lane handoff requests (P3-14, P3-05)

Only one request, and it is the second verb in one of P3-14's clauses. Nothing
here blocks the lane's commit; the shipped behaviour degrades to "selects" and
says so in a comment at the call site.

## apps/desktop/src/components/Canvas.tsx (CANVAS / orchestrator)
Why: P3-14's done-when is "each row states the problem, the offending part, and
selects/**centres** it when clicked". `select(id)` is reachable from `App.tsx`
and is wired (`App.tsx` `revealDiagnosticComponent`, passed to `BottomPanel` as
`onSelectComponent`), and it is proven by
`App.workspace.test.tsx` → "selects the offending part when its row is clicked"
(`useSchematic.getState().selectedId === "r2"`). Centring is not: `Canvas.tsx`
exposes only `fitSignal`, which frames *all* artwork and would throw away the
reader's pan — a diagnostics row must not re-zoom the sheet.

Exact change: add a reveal input to `Canvas` —
`revealComponentId?: string | null` plus a `revealSignal?: number`, matching the
existing `fitSignal` idiom — that pans the viewport so the named component is
in view **without changing zoom**, and does nothing when the component is
already visible. The DOCK side is one line inside
`revealDiagnosticComponent`: bump the signal next to the `select(componentId)`
that is already there. The comment on that callback names this seam.

Blocks: the "centres" half of P3-14's row-click clause. The "selects" half,
every error class, the live/no-run path and the badge-equals-rows identity are
all delivered and tested.

---

## Requests from other lanes that DOCK applied (recorded here so they are not applied twice)

- **`docs/handoff/TOOLBAR.md` → "App.tsx, simulator Probe button".** Applied.
  `Crosshair` is gone from the lucide import on line 3 (it had no other use) and
  the simulator's Probe button now renders `<ProbeIcon size={13} />` from
  `components/editor/ToolIcons`.
- **`docs/handoff/TOOLBAR.md` → "App.tsx, second `<EmptyState>`" (P3-04B).**
  Applied, once TOOLBAR's own half landed. `schematicOpen` and `onShowParts`
  are now passed on the second `<EmptyState>` only — the first one, over a
  shell with no file open, deliberately keeps the "create or open a schematic"
  copy. `onShowParts` calls `setPartsOpen(true)` plus a
  `componentFocusSignal` bump, not the toggling `onFocusComponents`, exactly as
  the request reasoned. (This was blocked for part of the run:
  `components/EmptyState.tsx` did not declare either prop, so passing them
  would have been a typecheck failure in App.tsx over another lane's
  component.)
- **`docs/handoff/EXPLORER.md` → "App.workspace.test.tsx, tab follows a moved
  file" (P3-02).** Applied — see "an open tab follows its file when the explorer
  moves it (P3-02, EXPLORER handoff)" in that suite.

---

## Added by the DOCK VERIFY pass

### `scripts/pdf3-verify.mjs` (orchestrator) — the P3-14 check now contradicts the contract
Why: at `scripts/pdf3-verify.mjs:1021` the acceptance predicate is
`!dock.hasMeasurementsTab && dock.hasErrorsTab && flagsPreRun`, and
`hasErrorsTab` is computed from `drawer.querySelectorAll('[role="tab"]')`. The
contract's own clause is "no tab strip if there is one item", which the fix
implements: with Measurements and Waveforms both withheld in schematic mode the
drawer renders `<h2 class="results-drawer-section">Errors …</h2>` and no
`[role="tab"]` at all. So the harness now reads a correctly-fixed dock as a
failure — `tabs` is `[]`, `hasErrorsTab` is `false`.

Exact change: widen the Errors probe to accept the single-surface heading, e.g.
```js
hasErrorsTab: tabs.some((t) => /error/i.test(t ?? ""))
  || /error/i.test(drawer?.querySelector(".results-drawer-section")?.textContent ?? ""),
```
and keep `hasMeasurementsTab` as it is (its absence is still the thing under
test). The badge probe (`[class*=badge]`) already finds the heading's badge.

Blocks: nothing in the app; it makes the P3-14 acceptance run report a false
negative. `scripts/pdf3-verify.mjs` is not a DOCK-owned file and hard rule 3
forbids running it here, so this is filed rather than applied.

### Centring is still open after verify
Re-checked against the tree as it stands: `Canvas.tsx` still exposes only
`fitSignal` (`components/Canvas.tsx:271,290`) and its camera is component-local
`useState<View>` at `Canvas.tsx:321`, so no owned file can pan it. The request
at the top of this document stands unchanged.
