# Lane PARENT handoff — Item 14 (a sheet is a block), parent side

Owned and changed: `apps/desktop/src/components/ShellPanels.tsx`,
`apps/desktop/src/components/ShellPanels.test.tsx`,
`apps/desktop/src/store/useSchematic.ts`, `apps/desktop/src/store/useSchematic.test.ts`.

## 1. Frozen store signatures (Deliverable 1 — published)

```ts
upsertNetLabelPort(x: number, y: number, text: string,
                   direction: SchematicPortDirection | null): ProjectSubcircuitResult;
setProjectSubcircuitLink(id: string, link: ProjectSubcircuitLink | null,
                         options?: { directions?: readonly SchematicPortDirection[] }): ProjectSubcircuitResult;
resyncProjectSubcircuit(id: string,
                        next: { ports: readonly string[];
                                directions?: readonly SchematicPortDirection[] }): ProjectSubcircuitResult;
```

`ProjectSubcircuitResult = { ok: boolean; error?: string }` (already exported from
`store/useSchematic.ts`). No persisted-format change: `ProjectSubcircuitLink`,
`ProjectSheetPort` and `NetLabel` are untouched, `schematic/types.ts` was not edited,
and directions are never stored — `pinOverride` is the record of the directions used
at link time, recoverable through `subcircuitBankSides`.

BLOCK: the canvas net-label draft must commit through `upsertNetLabelPort`, not
`upsertNetLabel`. `upsertNetLabel` still silently demotes a marked net on rename
(`useSchematic.ts`, the `wasProjectPort` branch); that behaviour is deliberately left
in place for the old callers and is pinned as the *bug* in
`useSchematic.test.ts` → "renames a marked net in place where upsertNetLabel silently
demotes it". Once every gesture routes through the new action, the orchestrator can
delete that branch.

## 2. What App.tsx must supply (ORCHESTRATOR)

`ComponentInspector` gained four optional props, threaded through
`ComponentPropertyGroup` into `ProjectSubcircuitLinkEditor`:

| prop | type | meaning |
|---|---|---|
| `sheetInterfaces` | `readonly ProjectSheetInterfaceEntry[]` (CHILD's type) | the advisory index; an ABSENT entry renders as "not checked", never as fine |
| `comparedSource` | `"open-tab" \| "disk"` | which copy the index read; the review dialog prints it, otherwise the badge is untrustworthy |
| `onOpenSheet` | `(sheetPath: string) => void` | parent → child navigation, and the "Open <file> and mark its nets" confirm for a child with no interface |
| `onSaveSheetAsSim` | `() => void` | the `.asc` escape hatch |

Index requirements:
- must reuse `projectSheetPortsValidation` and the same net-touch / one-net-per-port
  checks as `projectHierarchy.ts:177-211`; it may never be `ok` where Run refuses
  (spec D5 equivalence test is the orchestrator's).
- must be memoised by path + `diskContentFingerprint` (App.tsx:3138) with a ceiling on
  sheet count and total bytes: ungating it from `projectHierarchyActive` (App.tsx:960,
  985) means parsing every project `.sim` whenever the inspector is open, which the app
  does not do today.
- `status: "missing"` must be an entry, not an absent one — that is what makes the
  missing-sheet row (with its explicit Unlink) appear instead of silence.

## 3. App.css class names referenced by this lane (ORCHESTRATOR owns the styles)

`.project-sheet-link-head`, `.project-sheet-pin-table`, `.port-direction`,
`.project-sheet-drift`, `.project-sheet-drift.is-missing`,
`.project-sheet-drift-summary`, `.project-sheet-advanced`, `.sheet-drift-dialog`,
`.sheet-drift-table`, `.sheet-drift-row` (+ `.is-same/.is-renamed/.is-moved/.is-direction/.is-added/.is-removed`),
`.sheet-drift-consequence`, `.sheet-drift-source`.
Existing classes reused unchanged: `.project-sheet-link`, `.property-hint`,
`.property-field`, `.property-validation-error`, `.port-list`, `.port-index`,
`.port-name`, `.port-side`, `.mono-num`, `.property-text`.
Diagnostic state must stay dash + lamp + text (never colour alone) and use the
existing `--diagnostic-warning*` tokens; no new hue. All new controls are
`Button size="sm"` = `h-7` = 28px = `--control-hit`.

## 4. Cross-lane facts and one blocked test

- Consumed from CHILD (all present and used as specified): `ProjectSheetInterfaceEntry`,
  `projectSheetInterfaceDrift`, `defaultProjectModelName`, `PortSide`,
  `ProjectInterfaceDrift`, `asciiFold`.
- Consumed from BLOCK: `subcircuitPortSlots`, `subcircuitBankSides`, and
  `buildSubcircuitPinOverride`'s optional third argument. ShellPanels' local
  `subcircuitPortSides` now delegates to those two, so there is one side rule.
- **Failing test that is NOT this lane's:** `src/App.workspace.test.tsx:841`
  ("mounts the child-sheet interface dialog from a fresh schematic toolbar") can no
  longer find the dialog / its "Add project port" button after CHILD's
  `ProjectSheetPortsDialog.tsx` rewrite removed the auto-pick control (spec 2.6).
  `App.workspace.test.tsx` is orchestrator-owned; it needs its expectation moved to
  the new "Pick a net on the drawing" control.

## 5. Deliberate gaps, booked

- No canvas-side lamp/dashed body here — that is BLOCK's (`Canvas.tsx`). This lane
  supplies the inspector channel (summary line + review dialog) only.
- Partial adopt is not offered; a subset is authored through Advanced → the ordered
  contract field, exactly as the spec says.
- An Explorer rename still lands as `missing-sheet` with no automatic link rewriting;
  "N blocks point at this file" before a rename is out of v1.

## 6. VERIFY pass (independent) — what is still open, and what was fixed here

Fixed inside the lane's own files, each with a test that was recorded failing first:

1. **A pre-Item-14 document was accused of a change it never had.** A link stored
   without directions carries the historical half-split bank, so its pin *sides*
   disagree with the child's directions and the panel printed
   `child.sim changed its interface. 2 direction changes.` on open — a claim about
   a file edit that did not happen, on *every* existing linked document. The panel
   now proves the bank IS `buildSubcircuitPinOverride(component, link.ports)` (the
   undirected layout) and, when the drift is direction-only, says
   "This block is drawn with Tau's older side layout, not child.sim's pin
   directions. Nothing electrical changes" under the title "Block layout is out of
   date". A genuine rename/reorder on the same legacy bank still reads as drift.
   Residual: CHILD's generated per-row consequence still phrases a direction row
   as "OUT is now out", which reads as a change in this case.
2. **The Select pre-selected the alphabetically first sibling**, so one click on
   the panel's only prominent button linked the block to a file nobody chose.
   Unlinked blocks now start with nothing selected, no proposed pinout and no
   "Link this sheet".
3. **The option annotation listed every port name** — 410 characters for a
   20-port sheet inside a `max-w-[168px]` trigger. Now count-first with a
   character-budgeted sample and an ellipsis.
4. **A successful link produced no confirmation in the running app.** The `saved`
   flag is local state and App re-renders this panel with a fresh component prop,
   which runs the reset effect. The confirmation is now derived from the
   in-sync verdict, so it persists.
5. **"Choose another sheet" on the missing-sheet row opened the manual contract
   editor**, two rows under the control that really chooses a sheet. Removed; the
   sentence points at "Project sheet" instead, and a test proves relinking a
   vanished child to a real sheet works.

Also added: a PARENT-side deck proof — link through the inspector with zero
typing, then `buildProjectHierarchyDeck` and read the cards
(`.subckt Child VIN VOUT GND`, `.ends Child`, `X1 vin vout 0 Child`). It pins the
electrical claim that the new DIRECTED bank changes nothing the compiler emits.

### NOT CLOSED — orchestrator wiring, and it is the whole student path

Item 14 is unreachable in the built app. Both halves are gated on props App does
not pass:

- `App.tsx:4430` renders `<ComponentInspector selected … projectFilePath …>` with
  **no `sheetInterfaces`, `comparedSource`, `onOpenSheet` or `onSaveSheetAsSim`**.
  With an empty index every sheet is "not checked", so there is no pinout, no
  "Link this sheet", no drift lamp and no "Open child.sim". The only enabled path
  left on the panel is Advanced → *type the ordered port list* — i.e. PDF5 reason
  1 exactly as it was, now one disclosure deeper. `.asc` refusal also has no
  Save-as target, and PDF5 reason 5 (navigate both ways) has no parent side.
- `Canvas` is rendered without **`onCommitNetLabelPort`**, and `Canvas.tsx:2513`
  gates the whole direction segmented control on that prop, so a student cannot
  mark a net as a port anywhere in the app. `upsertNetLabelPort` has no caller
  outside tests.
- No **"Sheet block"** entry exists in the parts rail (spec 3.1); `Palette` is not
  a PARENT file. Nothing in the palette or the empty state says a sheet can be a
  block.
- **None of the CSS class names in §3 exist in App.css.** The proposed pin table
  and the drift table render with browser defaults; the review dialog has no
  width constraint, which is the risk in a 900×600 window.

Until those four are wired, every acceptance check in §7C is a test-only proof.
Evidence weakness worth knowing: `ShellPanels.test.tsx` renders one frozen
`selected` object, so it never sees the fresh component prop App supplies — that
is what hid finding 4. New tests that care use a store-subscribed host.
