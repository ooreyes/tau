
## Item 14, lane CHILD - handoff (2026-08-13)

Owned edits landed: `apps/desktop/src/schematic/projectSubcircuit.ts`,
`apps/desktop/src/schematic/projectSubcircuit.ports.test.ts` (new),
`apps/desktop/src/components/ProjectSheetPortsDialog.tsx`,
`apps/desktop/src/components/ProjectSheetPortsDialog.test.tsx`.

### 1. Vocabulary deviation the other lanes must know about
`ProjectSheetInterfaceEntry.status` is `"ok" | "no-interface" | "unreadable" | "missing"`.
The frozen brief listed only the first three, but `ProjectInterfaceDrift` has a
`missing-sheet` kind and `entry === null` already means `not-checked` (silence),
so a sheet the link names but the project does not contain had no representable
input. `"missing"` is additive: every published field name and shape is
unchanged, and PARENT may keep constructing ok/no-interface/unreadable entries.

### 2. Files I could not touch, that now need the orchestrator
- **`apps/desktop/src/App.workspace.test.tsx:839-843`** FAILS now. Literal output:
  `TestingLibraryElementError: Unable to find role="dialog" and name "Child sheet interface"`.
  Fix: dialog title is now **"Sheet interface"**, the editor group's accessible
  name is now **"Sheet interface"** (was "Child sheet project ports"), the
  ordered list is **"Ordered sheet interface ports"**, and **"Add project port"
  no longer exists** (PDF5 reason 2 deleted). Reach a port with
  `Mark <NET> as an input|an output|bidirectional`, or assert the footer
  `Pick a net on the drawing`.
- **`apps/desktop/src/components/ShellPanels.test.tsx:95`** and
  **`components/editor/EditorChrome.tsx:117`**: the toolbar button title is still
  the jargon `Child sheet interface`; relabel to `Sheet interface (N ports)` per
  the spec and update the test's `getByRole("button", …)` name in the same commit.
- **`apps/desktop/src/App.tsx:4642`** should now pass the two new optional props:
  `usedBy={…}` (derived from the sheet-interface index; omit the prop entirely
  rather than passing `[]` when the index has not resolved - the component
  deliberately renders nothing instead of claiming "nobody uses this sheet") and
  `interfaceDisabledReason="An .asc sheet cannot carry a Tau sheet interface - save it as .sim first"`
  when the open document is `.asc`.
- **`apps/desktop/src/App.css`** owns the styling for the class names I
  reference. New, currently unstyled (they render as plain blocks):
  `.project-sheet-port-disabled`, `.project-sheet-port-candidates`,
  `.project-sheet-port-candidate-list`, `.project-sheet-port-candidate`,
  `.project-sheet-port-candidate-actions`, `.project-sheet-port-candidate-mark`,
  `.project-sheet-port-usedby`, `.project-sheet-port-usedby-list`.
  Existing and unchanged: `.project-sheet-ports-editor`, `.project-sheet-port-list`,
  `.project-sheet-port-row`, `.project-sheet-port-actions`, `.project-sheet-port-footer`.
  Tokens only; every interactive element in the new markup is a `Button size="sm"`
  (`h-7` = 28px = `--control-hit`) or `size="icon-sm"` (`size-7`), so nothing is
  under 24x24. The tag-glyph and ordinal-badge canvas styles are BLOCK's, not mine.

### 3. The index itself (App.tsx) - still owed
It must reuse `projectSheetPortsValidation` **plus** the label-exactness,
net-touch and one-net-per-port checks that `projectHierarchy.ts:177-211`
performs, and it must stay ADVISORY: no compiler path may read it. Equivalence
test D5 is mandatory - `index(sheet).status === "ok"` IFF
`buildProjectHierarchyDeck` does not throw for that sheet. My classifier is pure
and imports nothing but `./types`; it takes `sides` as a parameter precisely so
it never duplicates BLOCK's slot rule.

### 4. Deliberate non-change
`ProjectSheetPort` stays `{name, labelId, direction}`; no `portId`. Every refusal
string in `projectSheetPortsValidation` is byte-identical, proven by reading the
literals out of the `cdecde0` git blob rather than retyping them.

---

## VERIFY pass (2026-08-13) - what the student walk found

Walked the path from a one-sheet project. Frictions, in the order they hit:

1. **The way in is jargon and icon-only.** The only route to the child editor is
   `EditorChrome.tsx:117`, an unlabelled `Network` glyph titled *"Child sheet
   interface"*. A student does not know they are a "child". Nothing in the parts
   rail or the empty state says a sheet can be a block (spec 3.1 is unbuilt).
2. **"Pick a net on the drawing" is still a dead end.** It arms the label tool and
   closes, exactly as specified - but `Canvas.tsx:400`'s `labelDraft` has no
   direction segments (spec 2.3/2.4), so the student labels the net and must find
   the glyph again to say input/output. `upsertNetLabelPort` now EXISTS in the
   store (`useSchematic.ts:1586`) and no UI calls it.
3. **The zero-typing promise is inert in the running app.** `App.tsx` never passes
   `sheetInterfaces`, so `ShellPanels.tsx:2086` defaults to `[]`: every sheet
   option is "not checked", no pinout arrives, and drift can never leave
   `not-checked`. This is the single biggest open gap in Item 14.
4. **The child editor is never told anything by its host either.** `App.tsx:4642`
   still renders `<ProjectSheetPortsDialog open … onOpenChange … />` with no
   `usedBy` (so child->parent navigation, spec 3.7, is invisible) and no
   `interfaceDisabledReason` (so PDF5 reason 6 on the child side is unclosed in
   the app even though the component and its test are ready).

Fixed in this pass, inside CHILD-owned files, with a test each:

5. **The two refusals Run knows about are now said at authoring time.** A marked
   net that touches no component pin, and two ports on one electrical net, were
   only ever reported by Run - on the *parent* sheet, after wiring. The editor now
   computes them with the compiler's own `extractCircuit` + `netAtPoint`
   (no second rule) and renders one `role="alert"` region; when clean it states
   `Ready: … Pinout in order: VIN, VOUT.` The test derives every expected phrase
   from the message `buildProjectHierarchyDeck` actually throws for the same
   document, and asserts the "ready" claim only appears where the deck builds.
6. **The dialog could grow past a 900x600 window with no way to scroll.**
   `ui/dialog.tsx:66` has no max-height and no overflow, and the panel now stacks
   ports + every named net + verdict + "Used by". The body is now a bounded
   scroll region (`data-slot="sheet-interface-scroll"`), header and Done outside it.
7. **B7 was not proving what it claimed.** Its pattern pool was every literal in
   the module with `${…}` holes wildcarded, so renaming a refusal's role from
   `Sheet port name` to `Interface pin name` still matched `issueForToken`'s
   template and the test stayed green (demonstrated). The pool is now restricted
   to `projectSheetPortsValidation`'s own body with the role and the port limit
   substituted from the baseline blob; the same mutation now fails with
   `Interface pin name must be a SPICE-safe name…: expected false to be true`.

New class names App.css still owes styling for, in addition to the list above:
`.project-sheet-port-problems`, `.project-sheet-port-ready`.

Residual risk left open deliberately: if a caller passes `sides.current` /
`sides.expected` of different lengths while the names match in order (a legacy
file whose `pinOverride` is shorter than `link.ports`), `projectSheetInterfaceDrift`
returns `drifted` with every row `same` - a lit lamp whose table names no change.
It needs a caller bug to reach, and refusing to hide it is the fail-closed
reading, but PARENT should assert bank length === ports length before comparing.
