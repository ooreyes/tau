# EXPLORER lane handoff requests (P3-02, P3-04A, P3-06)

No `apps/desktop/src` file outside the lane's OWNED list needed to change. In
particular `App.css` was NOT edited: `styles/explorerTree.css` is imported from
`App.tsx:8`, after `App.css` at `:4`, so plain rules there beat App.css at equal
specificity (a `@container` block adds no specificity, so it loses on source
order too). The three requests below are gate/coverage items, not source edits
this lane could make.

## ~~scripts/design-system-dod-grep.mjs (App.css `.shell-toast`)~~ — RESOLVED, no action
Mid-run this gate was red on `scripts/design-system-dod-grep.mjs:163` ("App.css
still defines .shell-toast"), a pre-existing failure in a file this lane does not
own and did not modify. Another lane removed the dead block while this lane was
working; the gate now reports `hex-outside-tokens=0 native-select=0` … `ok`,
exit 0. Recorded only so the observation is not mistaken for a new regression.
The check that actually binds this lane — the "zero `#hex` in any
`apps/desktop/src/**/*.css`" walk — passes:
`grep -cE '#[0-9a-fA-F]{3,8}' apps/desktop/src/styles/explorerTree.css` is 0.

## apps/desktop/src/App.workspace.test.tsx (or another App-level suite) — DOCK owns it
Why: P3-02's "Done when" includes *open tabs follow the moved path*. The wiring
exists (`App.tsx:812` remaps every tab through `remapMovedProjectPath` on move,
`:824` on rename) and the pure function is covered by
`apps/desktop/src/project/types.test.ts:672-686`, but nothing drives the two
together: no test opens a tab, moves that file in the Explorer, and asserts the
tab's `filePath` followed. This lane can only prove that `ExplorerPanel` calls
the injected `onMoveNode` — which it does, in
`components/ExplorerPanel.test.tsx` ("moves a file onto a folder through the
explicit project move contract" and five sibling cases).
Exact change: add an App-level test that (1) opens `<root>/gain.asc` as a tab,
(2) drags its `button.tree-file` row onto a `button.tree-folder-row`, (3) asserts
the open tab's `filePath` is now `<folder>/gain.asc` and the tab is still active.
Blocks: the last unproven clause of P3-02.

## scripts/pdf3-verify.mjs — orchestrator owns it, no change requested
Why: for the record. The native measured proof this lane cannot produce (rule 3:
no dev server, port 1420) already exists in that script and should now pass:
- `P3-02` reads `document.querySelector("button.tree-file").draggable` and then
  `fileRow.dragTo(folderRow)`. The attribute is now literally `"true"` on both
  file and folder rows, so `dragstart` can fire and the native protocol is
  reachable for the first time.
- `P3-04A` requires `triggerVisible && insideHead && gapToName >= 8 &&
  !headOverflowing`. `.explorer-overflow-trigger` is now `display: grid`
  unconditionally, and the derived `trigger.left - rootName.right` is 128px at
  the shipped 226px default, 106px at 208px, 62px at the 168px floor.
- `P3-06` requires `contentLeft` to step ≥ 10px per level. It now steps exactly
  14px: root row 8px, its children 22px, their children 36px, and `.tree-list`'s
  `padding: 1px 4px 8px` gives every row the same `rect.left`, so the padding
  deltas *are* the `contentLeft` deltas.
Blocks: nothing. Flagged so the orchestrator knows which probes changed state.

## Side effect to be aware of
Running `node scripts/design-system-dod.mjs` (a gate this lane was told to run,
and which passes: `DESIGN-SYSTEM-DOD: ok`) rewrites the eight PNGs plus
`DESIGN-QA-NOTES.md` under `screenshots/design-system-dod/`. Those appear as
modified in the working tree and were not authored by this lane.
