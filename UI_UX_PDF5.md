# Tau review — PDF report 5 (20 items)

Source: `~/Downloads/Untitled document (2).pdf` (9 pages, items 1–20).

**Scope of the current pass: item 14 only.** The instruction was "focus on making
the subcircuit feature work … it needs to be intuitive and reliable, easy for a
student or an experienced EE to work with." The other nineteen are logged below
verbatim-in-substance so none is lost, and none is claimed as done.

---

## Item 14 — linked schematic sheets as subcircuits (THE FOCUS)

The vision, in the user's words: tie a subcircuit block "to another schematic
sheet in the same project" — someone builds a boost converter on its own sheet,
with an input and an output, then on a second sheet says *this block is my boost
converter*. "We'd have to be able to change the pinouts of this and define a pin
… you should be able to click on it, connected to a schematic, highlight the pins
that are your inputs and outputs … and then it'll just get added. But think of the
architecture, cuz it's important to get this right."

### What already exists, and works

The engine side is real and was verified end to end before this pass:

- `ProjectSubcircuitLink { sheetPath, model, ports }` on the parent component;
  `ProjectSheetPort { name, labelId, direction }` in the child's `projectPorts`.
- `buildProjectHierarchyDeck` compiles a parent + child pair into one deck.
  Measured output for a 1 k/100 n RC cell:

  ```
  .subckt TauRC VIN VOUT GND
  R__tau_TauRC_1 VIN VOUT 1000
  C__tau_TauRC_2 VOUT GND 1e-7
  .ends TauRC
  V1 n001 0 DC 0 SIN(0 1 1000)
  X1 n001 out 0 TauRC
  ```
- Fail-closed contracts that are *correct* and caught two real authoring mistakes:
  `X1 needs an exact ordered p1…pN bank for TauRC`, and `Port "VIN" on
  "rc-cell.sim" does not connect to a component net`.
- The preview solver refuses hierarchy rather than approximating it
  ("requires Tau's packaged ngspice engine"), which is the
  never-fake-a-simulation rule holding.

### Why it is not usable yet

Nothing above is a UX. Measured against the vision:

1. **The parent makes you type the interface.** The inspector's link editor has a
   free-text "Ordered project ports" field (placeholder `IN, OUT, GND`). The
   contract is then compared case-insensitively but **order-sensitively** against
   the child (`hasMatchingOrderedProjectPorts`), and Run refuses on any mismatch.
   So the flow is: read the child's ports, remember them, retype them in the right
   order, hope. The vision says the pins should "just get added".
2. **The child's ports are authored blind.** `Add project port` takes *the first
   unused net label it finds* and inherits its direction. You cannot pick a net
   on the drawing; you cannot see which nets are candidates; ordering is
   whatever the click sequence produced.
3. **Nothing survives a change.** The parent stores a *copy* of the port list. If
   the child gains, loses, renames or reorders a port, the only feedback is Run
   refusing later. There is no drift indicator and no resync.
4. **The block does not look like a block.** `symbols.tsx` draws `subckt` as a
   fixed 48×40 rectangle with an X and **exactly two leads**, regardless of port
   count. A three-port instance gets three `pinOverride` pins on a body drawn for
   two, and no pin is named on the canvas. The reference screenshot shows this:
   "1 LEFT / 2 RIGHT" listed in the inspector because the drawing cannot say it.
5. **No way in and no way back.** Nothing in the palette or the empty state
   suggests a sheet can *be* a block; from a parent there is no "open the child",
   and from a child no sense of who instantiates it.
6. **Wrong-file trap.** `.asc` cannot carry a link (`projectSheetChoices` offers
   only `.sim`/`.tau.json`), but a student working in `.asc` gets no hint until a
   save warning.

### Done when

- A child sheet's interface is authored **on the drawing** — pick a net, mark it a
  port, set direction and order — with the candidate nets visible, and no
  arbitrary auto-pick.
- A parent links a block by **choosing a sheet**; the pinout arrives from that
  sheet automatically, in order. Typing a port list is never required.
- Port **drift is detected and shown on the instance**, with a one-click resync
  that is explicit about what changes, rather than only surfacing at Run.
- The block is **drawn from its interface**: body sized to the port count, pins on
  the side their direction implies, names on the drawing.
- Parent and child are **navigable both ways**.
- Every existing guarantee is preserved: deterministic netlist, exact ordered
  contract, fail-closed refusal on a real mismatch, `.asc` round-trip untouched,
  cycle rejection, undo/redo.
- Proven by a test that builds a two-sheet project through the UI path and
  asserts the emitted `.subckt`/`X` cards, plus a drift case and a resync case.

---

## Items 1–13 and 15–20 — logged, not addressed in this pass

| # | Substance |
| --- | --- |
| 1 | Probe colours must be unique per distinct node; same node ⇒ one colour, and a second probe on that node collapses to one. |
| 2 | "Delete schematic" should delete the whole schematic even when saved, with an "are you sure" confirmation. (This pass' wording change made the dialog honest about *not* deleting the file; the user wants the stronger behaviour.) |
| 3 | Centre the Bode empty-state card in the schematic window regardless of panel resizing. |
| 4 | Toolbar icons still feel too small for Apple's guidance — make them bigger so the selection is visible. |
| 5 | Add a tag-shaped custom cursor for the net-label tool, sized like the probe cursor, short end near the pointer. |
| 6 | Tighten the explorer header icon spacing; VS Code-standard button sizes. |
| 7 | Question whether small-signal AC is needed at all; properties window should hide while dragging; align the waveform value; **prevent duplicate Component IDs** and renumber dynamically on delete. |
| 8 | Align the potentiometer menu rows; fix the cropped `0–10…` range text. |
| 9 | Saturation current may be too deep a parameter to expose. |
| 10 | LED: colour only the arrows, not the whole diode; reword to "Generic LED, forward voltage (Vf) default per colour, adjustable". |
| 11 | Drop `.lib`/`.sub` attach affordances — imports are not planned yet. |
| 12 | Semiconductor parameter sets must be able to match real circuits; add a one-line explanation per parameter so a student learns what each does. |
| 13 | Denote + and − pins; audit every component for which needs polarity marks. |
| 15 | Switch/relay/pushbutton artwork is wrong: stray connection stubs let terminals short in four places (S2), the plain switch has four terminals where two suffice, the relay has no coil. **And values must be validated — `ejejeje` must not be accepted.** |
| 16 | Show the CT transformer in the symbol viewer when a tool is selected. |
| 17 | The Errors count is not useful on its own; show real diagnostics like a compiler does (syntax vs correctness), in a dedicated window, with yellow/red. |
| 18 | Settings icon to the bottom **right**; shift Run and Ask Bode right. (Supersedes this session's earlier bottom-left move.) |
| 19 | Redesign the run/transport cluster; question whether Stop is needed if the simulator runs live; Run **and** Bode should shimmer together in the established palette. |
| 20 | The bottom-left corner still feels empty — suggest something rather than inventing an unnecessary feature. |

Note on 18 vs this session: settings was moved to the rail's **bottom-left** foot
earlier today, at the user's request in the previous round. Item 18 asks for
bottom-**right**. The later instruction wins; it is logged here rather than acted
on because this pass is scoped to item 14.
