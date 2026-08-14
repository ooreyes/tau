# DIAG lane handoff requests

## apps/desktop/src/uiux/Wave2Regression.test.tsx
Why: `typecheck` is red with two errors, and neither is from this lane's diff.
The NavRail lane moved Settings off `StatusBar` and deleted its `onOpenSettings`
prop (see `git diff apps/desktop/src/components/StatusBar.tsx`), but two call
sites still pass it:

    src/App.tsx(4602,48): error TS2322: ... Property 'onOpenSettings' does not exist
    src/uiux/Wave2Regression.test.tsx(60,49): error TS2322: ... Property 'onOpenSettings' does not exist

Exact change: drop `onOpenSettings={...}` from the `<StatusBar …>` element at
`Wave2Regression.test.tsx:60`, and from `<StatusBar mode={mode} result={analysis}
onOpenSettings={openSettingsSurface} />` at `App.tsx:4602`. This lane owns
App.tsx but deliberately left that line alone: it is the NavRail change's own
call site, and half-applying their move here could break their in-flight tests.
Blocks: nothing in DIAG (all four DIAG test files pass); it blocks the shared
`typecheck` gate for every lane.

## apps/desktop/src/App.tsx (NavRail lane's own wiring, observed not fixed)
Why: with `StatusBar`'s gear deleted and `ActivityRail`'s `onOpenSettings` never
passed at `App.tsx:3958`, Settings currently has NO entry point in the shell.
Four `App.workspace.test.tsx` tests fail on it, and they are not this lane's:

    FAIL  Settings is a surface in this window > opens Settings over the schematic and closes it again, from every entry point
    FAIL  Settings is a surface in this window > keeps focus inside Settings while it is open
    FAIL  Settings is a surface in this window > returns focus to the control that opened Settings
    FAIL  App schematic workspace tools > keeps AI and Components together at 900px, yielding Explorer until explicitly requested
          (separator count: expected 2, received 3 - the third is ResultsDrawer's new PanelResizeHandle)

Exact change: add `onOpenSettings={openSettingsSurface}` to the `<ActivityRail>`
element at `App.tsx:3958` (the handler already exists and is still passed to the
assistant panel), and update the 900px separator count to 3 with a comment
naming the drawer handle. Left alone here so the NavRail/Drawer lanes' own
assertions decide the final shape.
Blocks: nothing in DIAG.
