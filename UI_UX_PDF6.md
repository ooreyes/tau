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

Filled in at integration — see the tables and the `scripts/pdf6-verify.mjs`
output referenced there.
