# Cross-lane handoff requests — lane CHROME (home-screen review, 2026-08-13)

Settings moved out of the status strip's lower-right utility and into the foot
of the activity rail. The two prop sites live in files CHROME does not own.

## apps/desktop/src/App.tsx
Why: `StatusBar` no longer takes `onOpenSettings` (the gear is now the last
control in `ActivityRail`), so the current call site is a type error.
Exact change: two edits.

1. At the `<StatusBar …>` call (was line 4576, now ~4602 — the sole
   `<StatusBar` in the file), drop the settings prop:

       -      <StatusBar mode={mode} result={analysis} onOpenSettings={openSettingsSurface} />
       +      <StatusBar mode={mode} result={analysis} />

2. At the `<ActivityRail` call (~line 3938), pass the same handler. It can go
   anywhere in the prop list; alongside the other callbacks reads best:

             onFocusComponents={() => {
               ...
             }}
       +      onOpenSettings={openSettingsSurface}
           />

   `onOpenSettings` is optional on the rail, so the rail simply grows no foot
   if it is omitted — but then the app has no Settings entry point at all, and
   `App.workspace.test.tsx`'s "exactly one Settings button" assertion fails.

Blocks: CHROME-2 (`pnpm -C apps/desktop typecheck` fails on App.tsx until this
lands; `App.workspace.test.tsx` "Settings is a surface in this window" needs
edit 2 to still find its single entry point).

## apps/desktop/src/uiux/Wave2Regression.test.tsx
Why: `renderSharedChrome()` (line ~57) still hands `onOpenSettings` to
`StatusBar`, which is both a type error and the reason its
`getAllByRole("button", { name: "Settings" })` one-owner assertion would find
zero. Move the prop to the rail — the assertion then passes unchanged, and it
keeps testing exactly what it was written to test.
Exact change:

    -      <StatusBar mode="schematic" result={null} onOpenSettings={vi.fn()} />
    +      <StatusBar mode="schematic" result={null} />
           <ActivityRail
             mode="schematic"
             explorerOpen
             partsOpen={false}
             projectOpen
             schematicOpen
             onFocusExplorer={vi.fn()}
             onModeChange={vi.fn()}
             onSearch={vi.fn()}
             onFocusComponents={vi.fn()}
    +        onOpenSettings={vi.fn()}
           />

Blocks: CHROME-2 (typecheck + that file's chrome-name uniqueness test).

## apps/desktop/src/App.workspace.test.tsx (comment only, optional)
Why: line ~810 reads "after the redundant activity-rail gear is removed" — the
gear is now deliberately IN the rail and removed from the status strip. The
assertion itself (exactly one Settings button) is still correct and still the
right guard; only the sentence is stale.
Exact change: reword to "Settings remains a single, keyboard-addressable
affordance now that it lives at the foot of the activity rail rather than in
the status strip."
Blocks: nothing.

---

## VERIFY escalation (2026-08-13, verify pass) — this is a SHIPPING BLOCKER, not paperwork

The two prop moves above have NOT landed. Re-verified at this working tree:

    grep -n "onOpenSettings" apps/desktop/src/App.tsx
    4596:              onOpenSettings={openSettingsSurface}   # AssistantPanel
    4603:      <StatusBar mode={mode} result={analysis} onOpenSettings={openSettingsSurface} />
    4627:              onOpenSettings={openSettingsSurface}   # CommandPalette

`<ActivityRail>` (App.tsx:3958) still receives no `onOpenSettings`, and
`onOpenSettings` is OPTIONAL on the rail — so the rail silently grows no foot
instead of failing. Consequence in the running window right now: **Tau has no
Settings gear anywhere in its chrome.** It is not "moved", it is gone. The only
remaining routes to the settings surface are the command palette and the
assistant panel. This is a straight regression against the user's ask, which was
to relocate a control they can see.

Runtime proof (not a type error — the control genuinely is not in the DOM):

    pnpm -C apps/desktop exec vitest run src/uiux/Wave2Regression.test.tsx
    × keeps the shared shell namespace named and collision-free
      TestingLibraryElementError: Unable to find an accessible element with the
      role "button" and name "Settings"

Two gates that were GREEN at the lane's baseline are now RED and stay red until
the edits above land: `pnpm -C apps/desktop typecheck` (2 errors) and
Wave2Regression. A third is new, added by this verify pass so the absence cannot
pass unnoticed from inside CHROME's own gate — every other rail test injects
`onOpenSettings` itself and therefore cannot see this:

    apps/desktop/src/components/shell/NavRail.test.tsx
      describe "the shell actually mounts the rail's foot"
      × passes onOpenSettings to ActivityRail, so Settings exists in the running window
        AssertionError: ActivityRail is mounted without onOpenSettings: the app
        has no Settings gear

Whoever owns App.tsx: applying the two edits above turns all three green. Until
then CHROME item 2 is NOT CLOSED and must not be reported as fixed.
