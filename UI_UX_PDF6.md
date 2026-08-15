# Tau UI/UX remediation — PDF report 6 (10 items)

Source: `~/Downloads/Untitled document (3).pdf` (5 pages), read visually and by
text extraction on 2026-08-14.

Integration branch: `fix/pdf3-fourteen-items` (the PDF-4/5 integration branch),
starting at commit `b1a4510`. `auto/ltspice-parity` remains untouched.

Run ID: `pdf6-20260814-1`.

## How this pass is organised

The report touches six surfaces in ten items: the explorer, the editor tab
strip, the nav rail, diagnostics, the palette, and the titlebar. Those surfaces
are worked **in parallel**, which is only safe because of two rules:

1. **No lane edits `App.css` or `App.tsx`.** Each lane owns one stylesheet
   (`styles/pdf6*.css`), all six imported from `App.tsx` after `App.css` so an
   equal-specificity rule in a lane's file wins. The imports and the two
   cross-lane contract files were landed first, in `71de0b0`, so no lane needs
   to touch a shared file at all.
2. **One owner per file, including test files.** Where a surface's tests live in
   a file another lane owns, the lane reports the failure instead of editing it,
   and integration resolves it.

Evidence rule, inherited from the PDF-3 pass and restated because it is the
thing most easily lost: **a screenshot is not proof.** A previous remediation
round on this codebase marked items fixed against pictures that, read closely,
still showed the defect. Every item here gets a number from
`scripts/pdf6-verify.mjs`, which exits non-zero if any check fails. Pictures are
captured beside the numbers for a human to look at, not to stand in for them.

## Measured "before" state

Taken from the running app (dev server, dark theme, project with two open
schematics) before any change landed:

| Fact | Measured |
| --- | --- |
| Explorer header icons, gap between glyph edges | **12 px** (5 icons, 28 px boxes, `gap: 0`) |
| `.rail-active` bounding box | **x = 0** — the indicator escapes its button and paints on the window's left edge |
| Editor tabs | every tab renders a coloured chip (`<i class="blue">`/`amber`); an unsaved tab shows chip **and** dot **and** `×` |
| Internal explorer drag | the node moves via the pointer fallback, but **no drop-target highlight appears at any point in the gesture** |
| `dragDropEnabled` in `tauri.conf.json` | **absent**, so Tauri v2 defaults it to `true` |
| `usePanelWidth` | `setWidth` on **every** `pointermove` — one React commit per pointer sample |

## The ten items

| # | Report | Surface / lane |
| --- | --- | --- |
| 1 | Drag and drop is still not functional; `.asc` files cannot be moved into folders. "This needs to be completely resolved." | Explorer (A) |
| 2 | The five explorer header icons are too far apart; they should be close like VS Code. | Explorer (A) |
| 3 | "Since VScode is forked or open source can you copy their drag and drop mechanism?" | Explorer (A) |
| 4 | Remove the vibecoded tell-tale sign from the schematic tab (the sliver hanging off the rail's active button). | Rail (C) |
| 5 | Redesign the tab selectors. "There shouldnt be that blue dot only a dot to show when they haven't been saved." | Tabs (B) |
| 6 | A `!` button that toggles the error window; red fatal / yellow warnings / green all good; a setting to drop warnings so it is only red or green; **red only if it will not run in the simulator**. | Diagnostics (D) |
| 7 | Redesign the rail; better icons for schematic, simulator, and the exclamation mark for warnings. | Rail (C) |
| 8 | Sliding the component window and the magnify/home toolbar feels incredibly laggy. | Panels (E) |
| 9 | Redesign the top-left (traffic lights, τ, "tau", filename, dot) — messy, must follow the design guidelines set. | Titlebar (F) |
| 10 | The component hint text needs to be aligned, and every component that needs one should have one. | Palette (E) |

## Why item 1 was still broken after previous passes

Two mechanisms were fighting, and the platform was quietly disqualifying one of
them.

- `tauri.conf.json` never set `dragDropEnabled`, so Tauri v2 left it at `true`.
  On macOS that installs a native drag-and-drop handler on the WKWebView which
  swallows HTML5 drag-and-drop. Nothing in the tree listens for Tauri's
  `onDragDropEvent`, so the interception bought nothing and cost the feature.
  It also explains why dragging a file in from Finder did nothing: the HTML5
  `drop` that `runFileImport` waits for never arrived either.
- The tree rows were `draggable` *and* carried a pointer-event fallback. In
  WKWebView a pointer move starts a native drag, `beginNodeDrag` then hands back
  pointer capture and forgets the gesture, and the native drop never lands. The
  fallback was written to get out of the native path's way, so when the native
  path is disqualified, both paths lose.
- Even on the path that does work (verified in Chromium by synthesising a
  pointer drag against the live app: the node moved), **no drop-target highlight
  ever appeared**. A move with no affordance is indistinguishable from a bug.

The answer to item 3 is therefore not "port VS Code's code" — VS Code runs on
Chromium, where HTML5 DnD is sound, and Tau does not. It is to copy what VS
Code's tree drag *does* (threshold, drag image, folder-row target, auto-expand
on hover, cancel semantics) on top of pointer events, which behave identically
in WKWebView and Chromium, and to stop letting the webview arbitrate.

## Results

All ten items closed. `node scripts/pdf6-verify.mjs <label>` is **40/40** —
ten checks across light and dark at 1280×800 and at 900×600, the app's real
minimum window. Output and screenshots: `screenshots/pdf6-verify/pdf6-final/`.

| # | Measured after | Was |
| --- | --- | --- |
| 1 | a real pointer drag moves the file into the folder, and the drop target is highlighted mid-gesture (samples 0/0/0/2/2/2), with a drag label following the cursor | moved silently on the pointer path, lit nothing, and did nothing at all in the packaged app |
| 2 | glyph-edge gaps **8/8/8/8 px**, hit boxes 24×24 | 12 px gaps, 28 px boxes |
| 3 | `dragDropEnabled: false`; no tree row carries `draggable`; nothing subscribes to Tauri's drop events | Tauri's default `true`, plus rows that were native drag sources |
| 4 | **0** rail descendants paint left of the rail | 1 — `.rail-active` at `left: -4px`, box measured at x = 0 |
| 5 | 0 colour chips on any tab; 0 dots clean, exactly 1 when unsaved | a chip on every tab, and chip + dot + × together when unsaved |
| 6 | the app's own RC example reads green with no badge before any Run; the `!` raises the window and puts it away (`peek → half → peek`); a sheet with no ground reads red; the policy persists | an "Errors" count with no traffic light, no toggle, and no policy |
| 7 | 6 rail buttons, all named, none under 24 px, **no two sharing a glyph** | judgement is the human's on the captured shots; `CircuitBoard`→`Waypoints`, `Activity`→`AudioWaveform` |
| 8 | 40/40 distinct live widths tracked, settling on the size last painted; **0 React commits during the moves** (was 30 for a 30-sample drag) | one React commit per `pointermove`, plus a 120 ms ease restarted on every sample |
| 9 | first glyph at x = **78** (clears the traffic lights), no collision with the mode toggle, a long name truncates | the unsaved marker was a character inside the ellipsising filename, so a long name truncated it away |
| 10 | 51 hints across 58 rows at **one** left offset (spread 0 px) | 10 hints at three different offsets |

Repo gates at this state: desktop typecheck clean; **281 files / 5057 tests
passed, 9 skipped, 0 failed** (4,779 at the PDF-4 checkpoint); web build clean;
`design-system-drift` ok.

### Follow-up given during the review

**The lamp belongs under Waveforms.** It was first built into the rail's pinned
foot, above Settings, on the argument that a health light wants a constant screen
position. Omar's instruction on seeing it was "i imagined this button being under
waveforms button", so it is now the fourth key in the destination stack. The
original argument was also weaker than it looked: the stack above the lamp is
fixed in length, because entries are disabled rather than removed, so its
position is stable either way — and sitting there it reads as part of the group of
surfaces it reports on. Settings stays pinned to the foot and last in the tab
order. `f593e11`.

### Two things found by testing the claims rather than the code

**The flagship example claimed it would not run.** Proving item 6's rule — red
only when the circuit will not run — meant checking a circuit that runs. Tau's
own "Try RC Charging" example showed a red lamp reading *"this circuit will not
run"*, then went green the instant Run was pressed. `vsource`'s parameter schema
is a single DC-level number, but a source's value legitimately carries a whole
SPICE stimulus (`PULSE(...)`, `SIN(...)`, an `AC` spec, an `Rser=` param, an
LTspice `;` comment) because `ascImport` joins `Value` + `Value2` into one string
and `cirImport` keeps the function verbatim. Judged as a number, every one of
those read `DC level: Enter a finite V.` at `severity: "error"` — so **every
imported LTspice circuit with a stimulus source** was told it would not run.
Before this pass that was a wrong number in a count; item 6 turned it into a red
light. The check now normalises exactly as the deck builder does and stands down
where the emitter understands the value.

**A live region un-hid the whole shell behind a modal.** The new drag
announcement was declared with `aria-live="polite"` inside the explorer. Radix's
modal hiding goes through the `aria-hidden` package, which deliberately keeps any
subtree containing an `[aria-live]` element visible — including every ancestor,
up to the app container. So with Settings open, a screen reader could still reach
the tree, the canvas and the rail. `App.shellContract.test.tsx` caught it, and
the base commit was checked in a worktree to confirm the failure was ours rather
than pre-existing. `role="status"` carries implicit polite semantics, so the
announcement survives and the attribute the hiding library keys on is gone.

### What the gate does not prove

- **`dragDropEnabled: false` is asserted as configuration.** Only a real Tauri
  window can demonstrate that WKWebView has stopped swallowing the events; the
  dev app rebuilt and relaunched with it, so the fix is live in the running
  window, but the browser gate cannot see that far.
- **Item 7's "better icons" is a human judgement.** The gate proves every button
  is named, meets the 24 px target floor, and that no two destinations share a
  glyph; whether `Waypoints` reads as *schematic* is a call on the screenshots.
- **ms-per-move in P6-08 is reported, not gated.** Each sample costs two CDP
  round-trips, and the same build measured 8.7 and 20.1 ms/move within one run of
  the matrix. The render-pressure claim rests on
  `components/panelResize.pdf6.test.tsx`, which counts React commits directly.
- **Item 4's source image is a tight, ambiguous crop.** It was read as the
  protruding rail indicator, which is the artefact visible in items 1, 5 and 7's
  screenshots too. The check gates the general rule — nothing inside the rail may
  paint outside its left edge — so it holds under either reading.

### Note on the gate's own honesty

Every failure `pdf6-verify.mjs` reported against the finished code was a defect
in the **check**, not the app: a fixture with three real wiring errors used to
test the "clean" state, an `[role="region"]` attribute selector against a
`<section>` whose region role is implicit, a traffic-light inset measured in a
browser that has no traffic lights, a dirtying step that silently missed, and a
fixed tracking floor unreachable at a viewport where the panel has 6 px of room.
They are listed in `dc00467` because a gate that can fail for its own reasons
will eventually be believed when it does.
