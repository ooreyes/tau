# DRAWER lane handoffs

## apps/desktop/src/App.tsx - WITHDRAWN (closed inside the lane)
This asked DIAG to add `import "./styles/resultsDrawerResize.css";` to App.tsx,
because nothing imported the new sheet and the handle therefore fell back to the
shared 8px rule - under the 24px hit floor, hairline 20px adrift. That is no
longer a cross-lane dependency: the VERIFY pass moved the import into
`components/drawer/ResultsDrawer.tsx` itself (line 14), which is DRAWER-owned, so
the handle and its hit area now arrive together or not at all. A duplicate import
from App.tsx would be inert (the bundler dedupes by resolved id) but is not
needed. `ResultsDrawer.test.tsx` now asserts the import exists in a shipping
module, so this cannot silently regress to an orphan sheet again.

## apps/desktop/src/App.workspace.test.tsx
Why: the results drawer now renders a third `separator` (its top-edge height
handle) in schematic mode, so the bare count at line 236 -
`expect(screen.getAllByRole("separator")).toHaveLength(2); // Components + Assistant.`
- fails with `expected ... to have a length of 2 but got 3`. The count is the
assertion's weakness, not the drawer's: the comment right below it in the
simulator case already argues for naming separators rather than counting them.
Exact change: replace that line with the named form, which cannot pass by
accident if one handle replaces another:

    expect(screen.getByRole("separator", { name: SHELL_SEPARATORS.properties })).toBeTruthy();
    expect(screen.getByRole("separator", { name: SHELL_SEPARATORS.assistant })).toBeTruthy();
    // Third: the results drawer's own top edge (its height handle). Present in
    // both modes - the drawer is docked bottom here.
    expect(screen.getAllByRole("separator")).toHaveLength(3);

(`SHELL_SEPARATORS` is already imported in that file's sibling App tests; if it
is not imported there, the two literal names work equally well.)
Blocks: nothing in the DRAWER item's own gate, but it is a red test in
`App.workspace.test.tsx` caused by this lane, so it belongs here.

## apps/desktop/src/components/shellContract.ts
Why: `SHELL_SEPARATORS` is the register of every resize handle in the shell, and
the drawer's new one is not in it - the drawer names it locally
(`DRAG_HANDLE_LABEL` in ResultsDrawer.tsx). One name in two places is how the
contract stops being a contract.
Exact change: add to `SHELL_SEPARATORS`:

    /** The results drawer's top edge, docked bottom: the only axis it can
     *  negotiate there. Absent docked right, where the drawer is a full-height
     *  column and `analysisPane` owns the negotiable axis instead. */
    resultsHeight: "Resize results drawer height",

then in `apps/desktop/src/components/drawer/ResultsDrawer.tsx` replace the
`DRAG_HANDLE_LABEL` constant with `SHELL_SEPARATORS.resultsHeight`. The string
must stay byte-identical or `ResultsDrawer.test.tsx` (`/resize results drawer/i`)
and any shell-contract sweep will disagree about the same handle.
Blocks: nothing functional; it is the contract's own bookkeeping rule.
