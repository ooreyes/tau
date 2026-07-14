# Tau Autobuilder — Progress Log

<!-- ───────────────────────────────────────────────────────────────────────
     ⏱ HEARTBEAT — the single source of "what is happening right now".
     Every run REWRITES this block: at claim (Status: IN PROGRESS) and again at
     done (Status: DONE). If you start a run and Status is still IN PROGRESS
     from an OLD timestamp, the previous run died mid-unit — run
     `git log --oneline -8`, recover/finish/revert that unit FIRST, then go on.
     ─────────────────────────────────────────────────────────────────────── -->
## ⏱ HEARTBEAT
- **Headline metric:** 1536 committed-branch tests green · corpus 82/82 import · 82/82 op-converge · 79/82 warning-clean
- **Run started (UTC):** 2026-07-14T05:05Z
- **Synced to origin:** auto/ltspice-parity @ de5359e (dirty shared tree preserved).
- **Claimed unit:** §1/§6/§10 `.asc`-native workspace and simulator information architecture.
- **Status:** DONE
- **Last completed sub-step:** landed the ASC-native Schematics explorer, compact
  analysis rail, unified instrument icons, and responsive V/I/P telemetry dock.
- **Plan:** continue the plot-card/cursor/FFT sequence in `TAU_DESIGN_VISION.md`.
- **Note:** existing simulator/assistant worktree edits belong to earlier units and
  must remain intact; stage only reviewed hunks.
- **Next step:** unify plot-card axes/cursors and complete FFT engineering readouts.

---

## 2026-07-14T05:50Z — auto/ltspice-parity — UI architecture and ASC-native workspace

### What I did
- Published `TAU_DESIGN_VISION.md` as the durable Apple/LTspice/Desmos design contract and recorded the live 900×600 baseline audit.
- Removed the seeded Powerboard/examples workflow. Tau now starts with a real Schematics-folder choice, creates valid `.asc` files by default, preserves imported filenames/encodings, and keeps `.sim` explicitly legacy.
- Made ASC saves format-aware and loss-aware: complex source records, probe dots, and exporter-skipped parts block before disk writes; collisions are suffixed and traversal-like filenames rejected.
- Replaced the oversized analysis slab with a 32px accessible directive rail; all seven modes fit the 300px analysis floor with zero overflow.
- Added one responsive, resizable component telemetry dock with selectable V/I/P cards. At 900×600, four cards measured 281px client/scroll width (no horizontal carousel); dock height preserves circuit context.
- Unified simulator zoom controls on the reusable Lucide instrument-icon button.

### Tests / verification
- Isolated committed snapshot: typecheck passed; 106 files / 1536 tests passed.
- Production Vite builds passed for each landed unit (existing chunk-size advisory only).
- In-app browser at 900×600: ASC-first empty state, seven analysis modes, run/result telemetry, zero horizontal telemetry overflow, and edit-locked simulator interactions verified.
- Independent review found and closed destructive ASC save, overwrite/path traversal, duplicate telemetry computation, and minimum-height regressions before handoff.

### Commits
- `52f7263`, `ce269dc` — design contract and baseline audit.
- `46f146d`, `d0f36a2` — icon controls and compact analysis rail.
- `dd27fab` — ASC-native Schematics workspace.
- `e16456c`, `edafa30` — responsive telemetry dock and review fixes.

### Next step
- Continue `TAU_DESIGN_VISION.md` sequence 3–4: unified plot cards/axes/cursors, then FFT/THD detail. Complex vendor ASC editing remains explicitly blocked from lossy in-place save until the exporter preserves the original structured records.

---

## 2026-07-13T14:49Z — auto/ltspice-parity — §2 schematic routing and controls follow-up

### What I did
- Hardened automatic wire routing against exact/near-parallel runs, accidental
  contacts with existing nodes, and candidate elbows that would create an
  unintended electrical junction; ordinary unavoidable crossings remain legal
  and retain hop-over arcs.
- Replaced the Explorer's inert/prompt-based header controls with working
  VS Code-style New File, New Folder, Refresh, and Collapse All actions. New
  items use a focused inline editor; Open Folder and `.asc` import remain.
- Made Run and Errors visibly green in the acceptable state and red after a
  failed validation, made Errors collapsible, reopens it for changed issues,
  and preserves the result when switching views.
- Prevented Refresh from reporting success when the project-store refresh fails.

### Files
- `apps/desktop/src/components/Canvas.geometry.ts` + tests
- `apps/desktop/src/components/Toolbar.tsx` + tests
- `apps/desktop/src/components/ShellPanels.tsx` + Explorer/Errors tests
- `apps/desktop/src/store/useProject.ts`, `apps/desktop/src/App.tsx`, `apps/desktop/src/App.css`
- `SCHEMATIC_UX_PLAN.md`, `FEATURE_PARITY.md`

### Tests
- Focused UI/geometry: 4 files / 61 tests passed.
- Isolated staged-only: typecheck passed; 100 files / 1499 tests passed;
  production Vite build passed (existing chunk-size advisory only).
- In-app browser: all four Explorer actions, inline creation, collapse/refresh,
  Errors toggle, valid green state, and real validation-error red state verified.

### Parity items
- §2 schematic capture: routing readability and core schematic controls hardened.
- Commit: `5f69f6e` pushed to `origin/auto/ltspice-parity`.

### Next step
- Continue the active `FEATURE_PARITY.md` queue; keep the unrelated shared-tree
  simulator/assistant work in its own separately reviewed units.

---

## 2026-07-13T05:10Z — auto/ltspice-parity — §2 schematic legibility

### What I did
- Made net-name placement deterministic and collision-aware across component
  bodies, wires, probe dots, manually positioned labels, and other automatic
  labels.
- Added electrical-drawing hop arcs for unconnected wire crossings while
  preserving junction dots for connected joins.
- Extended orthogonal auto-routing to score overlap/crossings and generate
  clearance/end-run lanes around existing wires; fixed its stale wire-list
  callback dependency.
- Added a 30×30 floating one-click delete control for every schematic selection,
  corrected filled transistor/FET arrows, and made reference/value/net-name
  typography crisp at normal zoom.
- Added restrained success/danger gradients to Run and Errors state surfaces.
  The complete continuation/audit checklist is in `SCHEMATIC_UX_PLAN.md`.

### Files
- `apps/desktop/src/components/Canvas.geometry.ts` and focused tests
- `apps/desktop/src/components/Canvas.tsx`, `Toolbar.tsx`, `ShellPanels.tsx`
- `apps/desktop/src/schematic/symbols.tsx`, `apps/desktop/src/App.css`
- `SCHEMATIC_UX_PLAN.md`, `FEATURE_PARITY.md`, `PROGRESS.md`

### Tests / verification
- `pnpm -C apps/desktop typecheck` — pass.
- `pnpm -C apps/desktop test` — 102 files / 1540 tests pass.
- `pnpm --filter @tau/desktop build` — pass (existing advisories only).
- Staged-only detached-worktree check — typecheck, 115 focused tests, and
  production build pass; no dependency on unrelated working-tree edits.
- In-app browser QA — schematic loaded at 1280×720; component reference text
  measured 11px with 1.5px halo; selected `Rin`, measured 30×30 delete target,
  deleted it, and restored via Undo; successful run applied the green gradient.

### Next step
- Resume the highest-leverage waveform-parity / acceptance-corpus item.

---

## 2026-07-12T00:54Z — auto/ltspice-parity — §6 instrument-grade simulator plots

### What I did
- Rebuilt the simulator analysis column around full-width, vertically stacked
  engineering plots with shared time zoom/pan, independent Y autorange,
  adjustable height, real zoom-responsive intervals, and MIN/AVG/MAX reference
  annotations.
- Added compact per-signal instrument readouts (RMS/final, peak-to-peak,
  frequency) with full statistics behind an accessible disclosure.
- Replaced the dense telemetry table with searchable semantic component cards,
  spacious V/I/P readings, bounded sparklines, dedicated selection controls,
  and shared sign-convention help.
- Expanded FFT into a spectrum inspector with dominant-tone/harmonic markers,
  resolution, DC, noise floor, SFDR, THD, THD+N, and a harmonic dB/dBc table.
  Hardened harmonic lookup to O(n log n + h log n) and covered 131k bins.
- Followed Apple chart hierarchy/accessibility guidance, LTspice plot-window
  conventions, and Tau's shadcn/token layer. Three subagents implemented
  bounded slices; a separate review found and drove the final hardening pass.

### Files
- `apps/desktop/src/components/SimulationPanel.tsx`, `App.css`,
  `usePlotViewport.ts`
- New `EngineeringTraceReadout.tsx`, `ComponentMeasurementsPanel.tsx`,
  `simulation/engineeringTraceReadout.ts`, `simulation/spectrumInsights.ts`
  and their focused tests
- `FEATURE_PARITY.md`, `PROGRESS.md`

### Tests / verification
- `pnpm -C apps/desktop typecheck` — pass.
- `pnpm -C apps/desktop test` — 98 files / 1471 tests pass.
- `pnpm --filter @tau/desktop build` — pass (existing chunk-size advisory).
- Browser QA — normal workspace and 900×600 minimum; no horizontal overflow;
  probe-created sine plot, FFT metrics, and semantic telemetry verified.

### Next step
- Resume the highest-leverage waveform-parity / acceptance-corpus item.

---

## 2026-07-10T23:05Z — auto/ltspice-parity — review: simulator interaction contract + UI simplification

### What I did
- Audited the prior delegated flow-removal, measurement-model, and simulator UI
  work with three focused reviewers; fixed every P0 and the material P1 issues.
- Enforced a strict simulator circuit contract with three explicit modes:
  Inspect (selection only), Probe (voltage dots only), and Name (one name per
  physical node). Component clicks no longer create current probes. Probe dots
  and node names are directly click/keyboard removable; topology/value/wire
  mutation remains unreachable.
- Made named nodes + explicit probe dots the only default trace authority.
  Removed arbitrary first-six-net plots and manual pane add/remove/move chrome;
  the quiet empty state explains how to create a plot. Derived expressions,
  RAW comparison, netlist/CSV/RAW export remain available under closed
  **Advanced plot tools** for LTspice-grade depth without default clutter.
- Simplified plot cards: compact primary RMS/final reading, classification and
  frequency; full min/max/AVG/RMS/final moves behind each card's Statistics
  disclosure. Removed duplicate meter/LED noise and limited Stop to live runs.
- Hardened telemetry: periodic V/I show RMS, periodic power shows average real
  power, independent current-source polarity follows passive sign convention,
  transient telemetry is hidden outside TRAN, rows are keyboard-operable, and
  stored sparkline samples are bounded to 96 instead of retaining full native
  vectors. Classification/statistics now avoid per-sample object/array growth
  and reject non-finite time/value pairs consistently.

### Files
`App.tsx`, `App.css`, `Canvas.tsx`, `SimulationPanel.tsx`, `StatusBar.tsx`,
`simulation/measurementModel.ts`, new `simulation/visibleTraces.ts`, and tests.

### Tests / visual QA
- `pnpm -C apps/desktop typecheck` — pass.
- `pnpm -C apps/desktop test` — 94 files, 1445/1445 pass.
- `pnpm --filter @tau/desktop build` — pass (1976 modules).
- Live interaction QA: Inspect/Probe/Name modes, wire probe → automatic plot,
  1440×900 and 900×600 DOM/layout. Screenshot capture later timed out in the
  browser bridge; earlier wide visual capture plus fresh DOM checks confirmed
  the final hierarchy and reachability.

### Parity items
§6 transient signal selection/plot cards and §11 measurement UI notes updated.

### Next step
Resume the highest-leverage agent-provable Definition-of-Done item.

---

## 2026-07-10T22:22Z — auto/ltspice-parity — §11 Unit D: simulator workspace + measurement system

### What I did
- Rebuilt the simulator as a two-surface workspace: a pan/zoom/select-only
  schematic stays visible beside compact plot cards. Wire clicks toggle voltage
  probes; part clicks focus telemetry and toggle available current probes. No
  simulator control can edit circuit topology or parameters.
- Removed the current-flow animation end-to-end: arrows, speed model, toggle,
  readout, CSS, dead `FlowLayer`, and animation-only current samplers. Static
  probes, branch-current traces, and operating-point annotations remain.
- Auto-generated one plot card per visible/probed signal, arranged as a
  responsive 2-column grid (one column at 900px). Plot axes now say Voltage,
  Current, or Power from the actual unit instead of always saying Voltage.
- Added `measurementModel.ts`: time-weighted min/max/AVG/RMS/final summaries,
  steady/transient/periodic classification with frequency estimation, and
  per-component signed voltage/current/power series. The UI exposes those in a
  compact telemetry table with sparklines and a documented power sign rule.
- Replaced Unicode simulator action glyphs with the existing Lucide icon system
  and limited glass material to navigation/control chrome, following Apple's
  materials guidance rather than putting translucency behind data.

### Files
`App.tsx`, `App.css`, `Canvas.tsx`, `SimulationPanel.tsx`, `StatusBar.tsx`,
`plotPanes.ts`, `simulation/measurementModel.ts`, `simulation/currents.ts`,
tests; deleted `FlowLayer.tsx`.

### Tests / visual QA
- `pnpm -C apps/desktop typecheck` — pass.
- `pnpm -C apps/desktop test` — 93 files, 1437/1437 pass.
- `pnpm --filter @tau/desktop build` — pass (1975 modules).
- Live Vite QA at 1440×900 and the stated 900×600 minimum: circuit remains
  visible, plots are reachable and legible, cards collapse cleanly, no flow UI.
- Tauri development binary compiled and launched. Computer-use attached to the
  separately installed `/Applications/Tau.app` (an older build), so current-code
  pixel QA was correctly performed against the live development frontend.

### Parity items
§11 D9/D10/D11/D12 complete; FEATURE_PARITY §6 updated. §11 mission complete.

### Next step
Run the owed dedicated review session, then resume the agent-provable DoD list.

---

## 2026-07-10T14:55Z — auto/ltspice-parity — §11 Unit B: resizable side panels (recovered from -wip rescue)

### What I did
- Recovered the previous session's mid-unit work from the durability ref
  `origin/auto/ltspice-parity-wip` (session killed at its 17:59Z checkpoint),
  cherry-picked it, verified it complete, and finished the unit.
- **panelResize.tsx** — one small authority for side-panel resizing: pure
  `clampPanelWidth`/`loadPanelWidth`/`savePanelWidth` (storage-safe: missing,
  unparsable, quota, SSR), `usePanelWidth` hook (pointer-capture drag, config
  min/max clamps, save-on-release), `PanelResizeHandle` (role=separator with
  aria-valuenow/min/max, ArrowLeft/ArrowRight keyboard resize per the
  WAI-ARIA window-splitter pattern, 16px steps).
- Wired into both panels in ShellPanels.tsx: explorer tree (right edge,
  168–420px, key `tau.ui.explorerWidth`) and properties rail (left edge,
  208–480px, key `tau.ui.componentsRailWidth`).
- CSS: 8px grab strip, `ew-resize` cursor, invisible at rest, cobalt hairline
  on hover/drag/focus-visible. No hardcoded hex; tokens only.

### Files touched
panelResize.tsx (new), panelResize.test.tsx (new), ShellPanels.tsx, App.css,
screenshots/unitB-resize/.

### Tests
1395 → 1406 (11 new: clamp math, storage round-trip + corrupt/missing/quota
paths, hook drag + keyboard behavior). Typecheck clean. One full-suite run
had a 5s-timeout flake in an unrelated ShellPanels toolbar test under load;
passes in isolation and the follow-up full run was 1406/1406 — no regression.

### Visual QA (playwright-scripted, screenshots in repo)
Dragged both handles headlessly: explorer 226→346px, rail 264→364px; both
widths survive reload from localStorage (`before-drag.png` /
`after-drag-persisted.png`). Layout reflows cleanly, no jitter, hairline
affordance appears only on hover/drag.

### FEATURE_PARITY items updated
§11 Unit B (mission list in prompt.md) — done.

### UX issues found
None new. Canvas does not auto-refit when panels resize — acceptable
(fit-to-view is an explicit user action), noting for a possible Unit C touch.

### Next step
§11 Unit C: remove SimulationPanel's redundant Run button, then the
dashboard-style simulator layout.

---

## 2026-07-10T14:45Z — auto/ltspice-parity — §11 Unit A: schematic UI polish (empty properties, fit padding, errors tab)

### What I did
- **A1 (dbda551):** Fixed the no-selection properties state. Root cause: the
  rail-scoped `.inspector-summary` rule out-specified `.inspector-summary.empty`,
  collapsing the empty state into a clipped 48px+1fr two-column layout (title
  clipped at the rail edge, helper wrapping in a ragged 10ch column). Restored
  the centered single-column stack, removed the title's nowrap clip, made it
  fill the rail height, and adopted the spec copy: "No Selection" / "Select a
  component, wire, node, or label to view and edit its properties."
- **A2 (7bfecc7):** Fit-to-view breathing room. `fitView` clipped long labels
  ("U1 ideal" cut by the right rail) because `circuitBounds` ignores label
  text. New pure `fitViewTransform` (12% viewport padding per axis, 48px floor,
  0.25–5 zoom clamps, degenerate-safe) + `circuitBoundsWithLabels` (unions the
  real `buildLabelPlacements` boxes). Canvas.fitView now uses both.
- **A3 (5c7b86c):** Errors tab semantic states. Clear: checkmark + "No errors"
  in desaturated success (role=status), replacing the ambiguous "Clear" text.
  Error: existing loud danger head + count. New warnings-only amber `--signal`
  badge for successful runs with warnings. Burned hardcoded `#ff6961`.

### Files touched
ShellPanels.tsx, ShellPanels.test.tsx, Canvas.tsx, Canvas.geometry.ts,
Canvas.geometry.test.ts, App.css, screenshots/unitA-*.

### Tests
1383 → 1395 (2 empty-state + 7 fit/bounds + 3 errors-tab). Typecheck clean.

### FEATURE_PARITY items updated
§11 Unit A (mission list in prompt.md) — all three sub-items done.

### UX issues found
Screenshot-verified before/after each commit: empty state now a centered
reticle stack; schematic fit no longer clips labels; errors strip shows a
quiet green all-clear. Review-rotation debt: 0 `review:` in last 30 commits —
owed after §11.

### Next step
§11 Unit B — resizable properties rail + project tree with persisted widths.

## 2026-07-08T19:43Z — auto/ltspice-parity — §UX Unit B: scope real axes + Desmos-style zoom/pan

### Why
Owner feedback (verbatim intent): "The table is completely devoid of x/y
labels and makes it incredibly difficult to see. LTspice makes it
significantly easier to zoom into plots and zoom out. Almost like Desmos:
auto-center, and x/y axis remain persistent." The scope had only 3 corner
text labels (y-max, y-min, x-end) and a fixed unlabeled 6×5 grid across
every plot context (TRAN, AC mag/phase, DC sweep, FFT, noise, step
families) — no tick values, no units on most labels, no zoom, no pan.

### Commit 1 — `auto: scope axes — nice-number ticks, SI labels, all plot contexts (§UX)`
- **New pure module** `simulation/axisTicks.ts`: `niceTicks` (Heckbert
  1/2/5×10^n step algorithm), `logTicks` (decade ticks, with 1/2/5
  sub-decade marks for spans under ~2 decades and integer-stride thinning
  for spans over the target tick count), `valueToFraction`/`fractionToValue`
  (linear + log axis position mapping), `formatTickLabel` (reuses
  `formatEngineering` from `simulation/quantity.ts` for SI-prefixed units;
  dB/°/% are never SI-scaled), `computeAxisTicks` (the one-stop tick+label+
  zero-flag list), `pickTickCount` (collision-avoidance from a measured
  pixel size). 33 unit tests: tiny (sub-nV) and huge (multi-GV) ranges,
  negative/zero-span/zero-crossing domains, reversed domains, log
  single-decade/multi-decade/many-decade spans, NaN/degenerate inputs.
- **New shared component** `components/PlotAxes.tsx`: renders gridlines AT
  the actual tick positions (replacing the old fixed 6×5 grid), tick-value
  text along both edges (`.mono-num`, `--muted`), a stronger zero-line
  (`--border-strong`) when zero is in range, and the frame rect — one
  authority instead of 8 copy-pasted grid+label blocks.
- **New hook** `components/useMeasuredSize.ts` (`ResizeObserver`-backed,
  SSR/test-safe) + `tickCountsFromSize` — shrinks the target tick count as a
  plot pane's *rendered* pixel size shrinks (multi-pane splits, the app's
  900×600 minimum window), so labels never collide at small sizes.
- **Wired into all 8 plot render sites**: TRAN (`WaveformPlot`, extracted a
  `TranScopePane` subcomponent so each pane in multi-pane mode can own its
  own `useMeasuredSize` — hooks can't live inside a `.map()`), AC magnitude +
  phase (`AcPlot`, log-Hz x shared visually — phase pane shows the x labels,
  magnitude pane suppresses them since they're stacked halves of one Bode
  plot), DC sweep (`DcPlot`), FFT (`FftView`, cursor pixel math untouched),
  noise density (`NoisePlot`, log-log: both axes log-scaled), and the three
  `.step` family plots (`StepPlot`, `AcFamilyPlot`, `DcFamilyPlot`).
  `WaveformPlot`/`AcPlot`/`DcPlot`/`NoisePlot`/`FftView`/`StepPlot`/
  `AcFamilyPlot`/`DcFamilyPlot` are now exported (were file-private) purely
  for component testability.
- **New component tests** `components/SimulationPanel.axes.test.tsx` (5
  tests): mounts `WaveformPlot` (single + multi-pane), `AcPlot`, `DcPlot`,
  `NoisePlot` with synthetic-but-valid results and asserts real unit-bearing
  tick labels render (not just the old corner min/max), and that the
  zero-line class appears when 0 is in range.
- No simulation math or trace data touched — only the axis/grid chrome.
  Cursors, export, and legends are unaffected (spot-checked FFT cursor
  pixel math, still domain-driven).
- **Tests:** 1300 → 1338 (33 `axisTicks.test.ts` + 5 `SimulationPanel.axes.test.tsx`).
  Gates green: `pnpm -C apps/desktop typecheck`, `pnpm -C apps/desktop test`.
- **Screenshot proof:** `node scripts/design-shot.mjs unitB-scope-axes` →
  `screenshots/unitB-scope-axes/simulator-{1440x900,1280x720,900x600}.png`
  show labelled ticks on both axes (e.g. "0V 2V 4V" / "0s 2ms 4ms 6ms") at
  every viewport including the 900×600 minimum, no collisions. Also
  hand-verified (throwaway Playwright script, not committed) that AC
  magnitude/phase, DC sweep, and multi-pane TRAN all render correct
  per-context tick labels once the analysis has real data.
- **Commit:** `d85254f`.

### Commit 2 — `auto: scope zoom/pan — cursor-anchored wheel zoom, drag pan, auto-fit (§UX)`
(see below once landed)

## 2026-07-08T19:09Z — auto/ltspice-parity — §UX: 3-commit interaction-bug unit (edit lock, probe dedup, comparator label/inspector)

### Why
Owner feedback: the app "lacks intuitiveness a real LTspice company would
have." A prior exploration pass produced a code map of three concrete
interaction bugs; this run verified each claim against the actual code
before fixing (two of the three root causes were more/different than the
map described — see below) and landed one commit per bug, tests-first where
practical, gates green on every commit.

### Commit 1 — `auto: schematic read-only outside schematic view — gate keyboard mutations (§UX)`
- **Map claim:** keyboard handler in `App.tsx` has no `mode` guard.
  **Confirmed** — Delete/Backspace, undo/redo, rotate/mirror, copy/paste/
  duplicate, and catalog place-hotkeys (R/C/L/V/…) all dispatched regardless
  of `mode`.
- **Found beyond the map:** `EditorToolbar` (`ShellPanels.tsx`) renders
  unconditionally regardless of `mode` (only `.editor-doc-btn`/example-picker/
  transport are CSS-hidden in simulator mode). Its Wire/Label/Undo/Redo/
  Clear-scratchpad `IconButton`s stayed live and clickable while viewing the
  simulator — Undo/Redo/Clear could mutate or wipe the document via a mouse
  click with **zero** canvas interaction, a more severe bypass than the
  keyboard one.
- **Fix:** extracted the mode gate into a pure, exported pair in
  `schematic/shortcuts.ts` — `isEditingAction` (cancel/palette are
  view-level; everything else is an editing action) and
  `dispatchShortcutAction` (applies the gate, then dispatches to the same
  callback shape `App.tsx` already had). `App.tsx`'s keydown effect now
  calls it instead of switching directly, and also gates the catalog-hotkey
  placement lookup. `EditorToolbar` gained a `mode` prop; Wire/Label/Undo/
  Redo/Clear-scratchpad get `disabled={readOnly}`; Select (cancel) and Probe
  stay enabled (non-mutating / probing must keep working in simulator view).
- **Tests:** 20 new (`shortcuts.test.ts`: `isEditingAction`/
  `dispatchShortcutAction` unit coverage; `useSchematic.test.ts`: a new
  describe block wires `dispatchShortcutAction` to the REAL store's bound
  actions — the same callback graph `App.tsx` uses, not mocks — and proves
  Delete/undo/rotate/mirror/duplicate/paste/wire/label are no-ops in
  simulator mode while cancel still works, plus a schematic-mode positive
  control) + 6 new (`components/ShellPanels.test.tsx`, new file: renders
  `EditorToolbar` and asserts the disabled buttons don't fire their store
  callback on click, and Select/Probe stay enabled).
- **Gates:** typecheck clean; 1285/1285 tests green.
- **Commit:** `503da95`.

### Commit 2 — `auto: one probe per net — net-identity dedup, no body probing (§UX)`
- **Map claim:** `addProbe` dedups on exact `x===x && y===y`; `netAtPoint`
  exists in `schematic/netlist.ts` as the net-resolution authority.
  **Confirmed**, both.
- **Fix:** `addProbe` now resolves the click AND every existing voltage
  probe through `netAtPoint` (via a freshly `extractCircuit`'d net list) so
  a net carries at most one voltage probe. Toggle semantics chosen: the
  SAME point clicked again removes the probe (preserves the old toggle-off
  feel for the common case); a DIFFERENT point on a net that already has a
  probe **moves** the marker there instead of stacking a second ring.
  Clicking off any net entirely (empty canvas, or a component body with no
  pin/wire under the cursor) is a no-op — chose the stricter "nothing"
  behavior per the brief; "probing an opamp makes no sense" now literally
  does nothing rather than dropping a stray, disconnected probe. An isolated
  pin with no wire still probes (a valid, if unconnected, net — pins are DSU
  nodes even without a wire). Current/clamp probes are unaffected
  (`toggleCurrentProbe` already dedups per component).
- **Tests:** 7 new (`useSchematic.test.ts`, new describe block): net dedup
  at two different points (moves, doesn't duplicate), same-point toggle-off,
  component-body no-op, isolated-pin still probes, empty-canvas no-op,
  current/net-probe independence preserved. Also updated one existing
  fixture (`toggleCurrentProbe` describe block) to add a wire so a
  pre-existing "coincident probe" test's click point still resolves to a
  net under the new, stricter rule.
- **Gates:** typecheck clean; 1292/1292 tests green.
- **Commit:** `bc9aeb9`.

### Commit 3 — `auto: fix comparator/opamp value labels + inspector param fields (§UX)`
- **Map claim (a):** canvas label garbled ("1 0Vhi Vlo") because
  `catalog.ts`'s comparator `unit: "Vhi Vlo"` gets blindly suffixed onto the
  joined value tokens in `Canvas.tsx`'s `sourceValueLabel`. **Confirmed**,
  and the same bug class was ALSO latent for `vpulse` (`unit: "V"` suffixed
  onto its 4-token PULSE spec) and `tline` (`unit: "Ω s"` suffixed onto its
  "Td=/Z0=" key=value spec) — opamp's `unit` is already `""` so it was never
  actually broken, just correctly named as a suspect to check.
- **Map claim (b):** inspector pills for OUTPUT HIGH/LOW/HYSTERESIS render
  empty; values decode fine; CSS/layout bug. **Confirmed the symptom, but
  the map's location was wrong**: the SCHEMATIC-mode `ComponentInspector`
  (`.property-grid`, `ShellPanels.tsx`) — the one `design-shot.mjs`'s
  `inspector` state actually screenshots — renders comparator params fine
  (verified live). The real bug is in the SIMULATOR view's separate
  "selection strip" (`SimulationPanel.tsx`, `.selection-strip`/
  `.param-fields`), which has NO screenshot coverage in the pipeline. Root
  cause: `.selection-strip` is a 2-column CSS grid (52px label rail + 1fr
  content); `.param-fields` — the 3rd+ grid child, used for EVERY selected
  component's structured params, not just the comparator — had no explicit
  `grid-column` and CSS grid auto-placement wrapped it into row 2, **column
  1** (the narrow 52px rail) instead of the wide content column, collapsing
  every value input to ~18px (just the SI-prefix select arrow, no room for
  the mantissa — exactly the "value-less pill outline" screenshot). Found by
  dumping computed `gridTemplateColumns`/`getBoundingClientRect()` via a
  headless-Chromium probe, not by guessing at the CSS. `.value-editor` (the
  MODEL-picker/single-field sibling) already had `grid-column: 1/-1`;
  `.param-fields` was just missing the same line.
- **Fix (a):** `catalog.ts`'s comparator/vpulse/tline entries now have
  `unit: ""` (the field is reserved for genuine single-quantity kinds).
  `Canvas.tsx`'s `sourceValueLabel` gives each multi-field kind its own
  formatter built from `decodeParams` (the same structured fields the
  inspector uses): comparator → `"1V/0V"` (`"±0.1V"` appended only when
  hysteresis is non-zero), vpulse → `"0V→5V @ 100kHz"`, tline → the raw
  `"Td=50n Z0=50"` text unmodified (LTspice shows it as-is; no unit ever
  applied). vac/iac's pre-existing "amp @ freq" bespoke formatter is
  unchanged, now sitting alongside these instead of being the one exception.
- **Fix (b):** added `grid-column: 1 / -1;` to `.param-fields` in
  `App.css`, mirroring `.value-editor`'s existing rule.
- **Behavior chosen:** comparator canvas label is `high/low` in volts (LTspice
  doesn't show a "model name" for Tau's native ideal comparator — there
  isn't one, the value line IS the spec), matching the brief's suggested
  `"1V/0V"` format.
- **Tests:** 8 new (`components/Canvas.labels.test.ts`, new file):
  resistor's plain unit-suffix path unchanged, no double-suffix on an
  already-unitted value, vac/iac's existing bespoke format unchanged,
  comparator default/explicit/hysteresis cases, vpulse's 4-token format,
  tline's raw-text format, opamp's untouched empty-unit path.
- **Screenshot proof:** `screenshots/unitA-comparator/` — before/after pairs
  at 1440×900 and the app's 900×600 floor:
  `comparator-selection-strip-before-*-crop.png` (empty pill outlines, only
  the SI-arrow visible) vs. `comparator-selection-strip-after-*-crop.png`
  (values "1"/"0"/"0" visible and editable); `comparator-inspector-after-*`
  and `comparator-simulator-after-*` for full-panel context. Captured via a
  throwaway Playwright driver (not committed) that placed a comparator via
  the command palette, selected it in both schematic and simulator view,
  and screenshotted `.bottom-panel` / `.selection-strip`.
- **Gates:** typecheck clean; 1300/1300 tests green.
- **Commit:** (recorded after this entry lands — see `git log`).

### Bookkeeping
- `FEATURE_PARITY.md`: annotated §2 (schematic capture — edit-lock,
  comparator label/inspector), §6 (probe dedup by net identity), and
  corrected a §10 Phase-3b/4a entry that had claimed the selection-strip
  editors were "untouched" (true, but that concealed the layout bug above —
  now cross-referenced).
- Not pushed — orchestrator reviews per commit. No `wip: checkpoint` auto-
  commit was created during this run (checked `git log` after each commit).

### Next step
Unit complete; return to `FEATURE_PARITY.md`'s Definition-of-Done backlog
(acceptance-corpus script, `class-d_starter.asc` comparator-in-loop
waveform parity, remaining §6 waveform-viewer items) for the next run.

---

## 2026-07-08T18:23Z — auto/ltspice-parity — §10: canvas chrome (Phase 4c, final §10 unit)

- **Status: DONE** — §10 Phase 4c (the final §10 unit): the schematic canvas's
  own CHROME — the one honest gap flagged since Phase 3d and left open through
  4a/4b. Canvas SVG rendering (components, wires, grid, labels, the current-flow
  dots in `FlowLayer.tsx`) is untouched, exactly as scoped. Explored
  `Canvas.tsx` (App.tsx/ShellPanels.tsx have no canvas-chrome — confirmed by
  grep, nothing to migrate there) and found exactly four chrome surfaces, all
  in one component:
  1. **Zoom cluster** (`.view-controls`/`.view-btn`, top-right) was already
     mostly on-system from an earlier pass (hairline `--panel-3` group,
     `--overlay-hover`/`--accent-soft` states, inset focus ring) — tightened
     the remaining drift: `9px`/`16px` raw radius/inset → `--r-md`/`--sp-4`,
     glyphs → `--font-mono` (design brief: "mono glyphs"), and native `title`
     tooltips → real `ui/Tooltip` (same `TooltipTrigger asChild` pattern
     `ShellPanels.tsx`'s rail buttons use). Deleted a genuinely dead rule:
     `.view-btn.fit` had `font-size: 0` hiding the button's literal text
     ("⤢ Fit") and used a `::before { content: "⌂" }` to paint a *different*
     glyph in its place — confusing indirection for a static icon. The button
     now just renders `⌂` directly; the `.fit` modifier class and both CSS
     rules are gone.
  2. **"Current flow" toggle + "slowed ×" readout** (`.flow-controls`) were
     the real gap: a stadium-shaped (`border-radius: 20px`) glassy pill with
     `backdrop-filter: blur(6px)` and, when ON, an undocumented hardcoded
     `rgba(23, 184, 158, …)` teal-green glow that exists nowhere in the token
     `:root` (an orphan from a pre-tokens design, invisible to the hex-only
     `rg "#[0-9a-fA-F]{3,8}"` gate since it's `rgba()` not `#hex` — worth
     flagging: that gate has a blind spot for non-hex color literals). Rebuilt
     as an operator control: flat `--panel-3` hairline chip (`--r-md`,
     `--row-h-dense`), no blur (this floats directly over the 60fps canvas —
     a genuinely hot repaint layer), ON state reads as a real indicator lamp
     (new `.flow-lamp` dot + `--accent-line` hairline, cobalt — a view toggle,
     not a run-state signal, so intentionally NOT the amber `--signal` family
     `.status-lamp--running` uses) instead of a tinted glass fill. The
     "slowed ≈N× vs real time" readout gained `.mono-num` and moved from the
     same glassy pill to a `--panel-3`/`--border-strong` hairline chip.
  3. **Inline value editor** (`.value-edit-input`, shared by the component
     value editor and the net-label name input — the closest thing to a
     "net-label editor popover" in this codebase; there's no separate
     `NetLabel`/`Popover` component) had one hardcoded literal in its drop
     shadow (`0 8px 24px rgba(0,0,0,0.5)`) and sat on `--panel-2` rather than
     the `--panel-4` "true-black pop surface" recipe every other floating
     surface uses (`ui/dialog.tsx`, `ui/tooltip.tsx`, `ui/dropdown-menu.tsx`)
     — repointed to `--panel-4` + `var(--elev-pop)`, kept the accent-cobalt
     border (an active-edit affordance, matching every other focused input
     in the app, not a neutral hairline).
  4. **Hover cards**: none exist on the canvas today (the only hover-adjacent
     affordance is `.snap-ring`, an SVG wire/pin snap indicator — canvas
     geometry, not chrome, left untouched).
  Zero hardcoded colors added (`git diff | grep -E '^\+' | grep -E
  '#[0-9a-fA-F]{3,8}|rgba\('` on the changed files returns nothing); the two
  pre-existing orphan `rgba()` literals above are now gone instead of merely
  undetected. Verified with `node scripts/design-shot.mjs canvas-chrome`:
  compared schematic (zoom cluster) and simulator (flow pill + readout)
  states against `screenshots/phase4b-floor/` at 1440×900 and 900×600 via
  cropped pixel diffs — the flow pill visibly changed from a rounded
  teal-glow stadium to a flat cobalt-hairline chip with a lamp dot (large,
  obvious diff); the zoom cluster's radius/font/tooltip changes are
  intentionally subtle (it was already mostly on-system) but present at both
  sizes; nothing clipped or unreachable at the 900×600 floor. Gates:
  typecheck clean, 1259/1259 tests green (no canvas-chrome test coverage
  existed or was added — `Canvas.geometry.test.ts` only covers pure geometry
  math, confirmed by grep before touching anything). **This closes the LAST
  open §10 sub-item** — every §10 bullet in `FEATURE_PARITY.md` is now ✅.
  §10 full adoption is honest, not aspirational: the acceptance-corpus script,
  `class-d_starter.asc` comparator parity, and waveform-parity Definition-of-
  Done items are separate, still-open sections of the DoD, unaffected by this
  unit. →
- **Status: DONE** — §10 Phase 4b (final phase): the responsive floor + final
  sweep. Orchestrator's review had flagged a concrete bug: in the SIMULATOR
  view at the app's stated 900×600 minimum window, the schematic column
  collapsed to ~130px (explorer tab clipped to "boost convert…", the
  "Current flow" pill wrapped to "Curre flow", the results table showed
  single-letter headers "CU VO P…"). Root cause: `.editor-shell` (flex:1,
  min-width:0) and the fixed-width `.plotter`/`.ask-panel` scope/Ask-Sim
  columns had a JS drag-clamp (300px/260px) that only applied while
  actively dragging — on load/resize the columns just used their 440px/330px
  defaults regardless of available width, so the schematic column got
  whatever was left over (often near-zero at 900px). Fix (candidate (b) from
  the brief, "auto-collapse below a width threshold"; landed as a live
  width-budget rather than a static breakpoint): `App.tsx` now measures
  `.shell-body`'s real width via `ResizeObserver` and keeps a hard 260px
  floor for the schematic column at all times, shrinking scope (300px
  floor) and Ask Sim (260px floor) to fit, auto-collapsing Ask Sim via its
  existing `MinimizedPanelDock` restore-orb affordance only if literally no
  width remains even at both floors — this bounds both the initial layout
  and the manual drag handles (previously only the latter was clamped).
  `App.css` mirrors these as CSS `min-width` floors on `.editor-shell`/
  `.plotter`/`.ask-panel` (defense for the pre-effect frame). Fixing the
  primary bug surfaced a second, follow-on clipping bug at the new 300px
  scope-column floor: the TRAN/OP/AC/DC/TF/NOISE/STEP tab strip hard-clipped
  STEP (it only fit before because the column happened to default to
  440px) — tightened `.plotter-tab` padding/tracking under 1024px so all
  seven fit exactly (verified headlessly: `scrollWidth === clientWidth` at
  900×600) and added `overflow-x:auto` on `.plotter-tabs` as a scroll
  fallback. Also hardened `.sim-results`'s 3-column grid with a 64px column
  floor (was `minmax(0,1fr)`, could collapse to 0) plus `overflow-x:auto`.
  Sweep: hex gate confirms 0 hardcoded colors outside `:root` (unchanged,
  already clean going in — only the documented `SimulationPanel.tsx` `"#000"`
  engine sentinel and test-fixture colors exist outside it); cross-referenced
  all 270 `App.css` class selectors against every `.ts`/`.tsx` usage
  (including dynamically-built classnames, checked by hand) and deleted 2
  provably dead rules — `.attached-libraries` (8 lines, zero refs anywhere in
  the repo) and `.transport-pause.active` (no pause button exists). Left 3
  unused custom properties (`--cream-soft`/`--ease-snap`/`--sp-8`) alone —
  part of documented systematic scales, not one-off orphans, so removing
  them is a judgment call outside a conservative dead-*rule* sweep. Focus
  rings (`ui/*`'s `focus-visible:ring-2 ring-ring/50` → `--color-ring: var(
  --accent)`, electric cobalt) verified visible on true black via a headless
  keyboard-tab screenshot of the settings sheet. Verified with
  `node scripts/design-shot.mjs phase4b-floor`: read all 6 states at
  900×600 and 1280×720 plus spot-checked 1440×900 — simulator 900×600 now
  shows the full schematic column (both tabs, "Current flow" pill,
  CURRENT/VOLTAGE/POWER results table) legible alongside a full scope and
  Ask Sim column; zero clipped/unreachable controls anywhere else at either
  floor size. Gates: typecheck clean, 1259/1259 tests green (unchanged — no
  new test surface), `pnpm --filter @tau/desktop build` (tsc + vite build)
  succeeds. Canvas SVG rendering/geometry and simulation logic untouched.
  This closes the FEATURE_PARITY §10 "Responsive floor" and "Sweep" bullets.
  **§10 is NOT fully closed**: the schematic canvas's own chrome (zoom
  controls, hover cards, net-label popover) remains open — flagged since
  Phase 3d, explicitly out of scope for this unit (canvas SVG is off-limits
  per the build contract), and is the one remaining §10 item. →
- **Status: DONE** — §10 Phase 4a: global type scale + 4pt spacing rhythm +
  dense-default sweep across `App.css` (~4200 lines). Type: audited all 118
  `font-size`/`font:` declarations — the app already clustered on 9/10/11/
  12/13px for ~90% of its text, so `:root` gained a named 5-step scale
  (`--fs-micro` 9 / `--fs-caption` 10 / `--fs-body` 11 / `--fs-label` 12 /
  `--fs-title` 13) plus two larger steps used consistently, not as one-offs
  (`--fs-heading` 14 for close-glyphs, `--fs-display` 15 for the search
  input/brand wordmark). 109 declarations re-pointed (91 clean bulk repoints
  + 16 odd sizes like 8.5/9.5/10.5/11.5/12.5px snapped to the nearest
  role-appropriate step — e.g. `.palette-name` 11.5→12px now actually
  matches `.cmdk-name`, which a stale comment already claimed it did). 11
  odd sizes kept as documented, commented exceptions — all schematic/scope
  canvas SVG text plus the brand lockup, the one welcome headline, and the
  one big-digit instrument readout (never touched canvas rendering/
  geometry, per the brief). Letter-spacing: ten drifted tracking values for
  visually-identical uppercase micro-labels consolidated to two tokens
  (`--tracking-micro` 0.5px, `--tracking-wide` 0.14em); three sets of
  N-copies-of-the-same-rule micro-labels (14 selectors total) folded into
  shared multi-selector rules, same pattern as Phase 3d's keycap
  consolidation. Spacing: audited every padding/margin/gap; snapped 57
  arbitrary values (5/7/9/10/11/14/18px) onto `--sp-*` and tokenized 31 more
  that already matched the scale numerically. Density: swept 21 control-row
  heights onto `--row-h`/`--row-h-dense`, fixed two real drift cases where a
  table header didn't match its own commented "mirrors X" sibling
  (`.meas-table-head`/`.meas-row`), tightened two oversized controls one
  notch (`.explorer-search`, `.editor-icon-btn`: 30→28px); resolved
  "density mode" as dense-by-default (no runtime toggle — out of scope per
  the brief), documented the handful of rows that intentionally stay below
  `--row-h-dense` (22px table/section headers, the transport cluster, the
  status bar) so a real header/data-row hierarchy isn't flattened. Verified
  with `node scripts/design-shot.mjs phase4a-type-spacing` against
  `screenshots/phase3d-chrome/`: consistent rhythm visible (tighter tab
  strip, tab palette, board-summary card, command-palette rows now show
  fewer items per viewport at the new row height) at 1440×900/1280×720/
  900×600, zero clipped controls, schematic/scope trace geometry pixel-
  identical (canvas untouched). Gates: typecheck clean, 1259/1259 tests
  green (unchanged — pure chrome, no new test surface). Net `App.css`:
  +319/−284 lines (comments + new tokens absorb net growth). This closes
  the FEATURE_PARITY §10 "Type & spacing scale" and "Density mode" items.
  Remaining §10 scope: the schematic canvas's own chrome (zoom controls,
  hover cards, net-label popover) and a final hardcoded-color grep pass. →
- **Status: DONE** — §10 Phase 3d unit B: instrument footer, activity rail,
  command palette, and reticle-language empty/error states
  (`StatusBar.tsx`, `ShellPanels.tsx`'s `ActivityRail`/`RailButton`/
  `ErrorPanel`, `EmptyState.tsx`, `App.css`'s `.cmdk-*`/`.rail-*`/
  `.status-*`/`.empty-*` rules). Status bar: the mode/run-state indicator
  is now the shared `.status-lamp` component (idle/ok/error color-coded
  dot + uppercase mono text) — the exact same treatment as the toolbar's
  transport lamp (`Toolbar.tsx`), replacing a `.status-mode`/
  `.status-mode.simulator` pair whose color was hardwired to which *mode*
  you were in (blue=schematic, green=simulator) regardless of whether the
  last run actually succeeded; every other readout (filename, engine
  label, grid/component/wire counts + zoom) now carries `.mono-num`, and
  `.status-count`'s duplicate hand-rolled mono/tabular-nums declarations
  were deleted now that the utility supplies them (same pattern as
  `.metric`/`.param-value`/`.brand-file` from earlier phases). Activity
  rail: `RailButton` now wraps a real `ui/Tooltip` (side="right") instead
  of a bare `title` attribute, with the real ⌘K/F2// shortcut surfaced for
  Search; hover changed from a filled `--overlay-hover` patch to a
  hairline `inset ring` (never a heavy fill, matching the palette's own
  selection rule), and `.rail-btn.active`'s `--accent-soft` background
  fill is gone — the active state is carried by icon color + the existing
  `.rail-active` left accent edge alone. Command palette: `.cmdk`/
  `.cmdk-backdrop` had THREE hardcoded rgba literals (`rgba(4,6,10,.65)`,
  `rgba(13,16,24,.96)`, plus two shadow rgbas) and two `backdrop-filter:
  blur()` glass effects — replaced with `var(--scrim-strong)` / `var(
  --panel-4)` / `var(--elev-pop)` (the exact same true-black-pop-surface
  recipe `ui/dialog.tsx` already uses) and flat surfaces, no blur;
  `.cmdk-item.active` went from a flat `--panel-4` fill to the accent-
  hairline-on-the-left selection language (`.palette-item.active`'s
  `inset 2px 0 0 var(--accent)`); `.cmdk-name` is now mono (matching
  `.palette-name` — the command palette and the palette list the same
  parts catalog, so they now read as the same catalog); `.cmdk-section`
  is now a proper Braun micro-label (mono, tracked). Keycaps: every
  shortcut badge in the app (`.palette-key`, `.status-hints kbd`,
  `.cmdk-key`, and the new `.empty-actions kbd`) now shares ONE hairline-
  mono-keycap CSS rule instead of three near-duplicate declarations that
  had quietly drifted (filled vs. transparent background, 3px vs. 4px
  radius, `--muted` vs. `--faint` text). Empty/error states: the canvas
  `EmptyState.tsx` onboarding card is now a flat `--panel-3` surface with
  a `--border-strong` hairline + `--elev-pop` (was a blurred, gradient-
  edged, alpha-blended `color-mix` card) — no backdrop blur, no gradient
  fade; the micro-label kicker gained a small idle status lamp ("TAU V0.2
  · IDLE" with a green dot, echoing `.status-lamp`'s language); actions
  are flat hairline buttons (no embossed gradient pill) and "Place
  resistor"/"Wire" now carry the same hairline mono keycap (`R`/`W`) as
  every other shortcut affordance in the app. `ErrorPanel`'s "No errors or
  warnings" fallback (bottom errors tab, schematic + simulator modes) now
  extends the *same* reticle language as `.inspector-summary.empty`'s "No
  component selected" (dim aiming-crosshair glyph via the shared
  `--icon-reticle` mask, mono uppercase title, faint guidance) via a new
  `.panel-empty` class, instead of a plain success-tinted bordered `<p>`.
  Fixed `scripts/design-shot.mjs`'s command-palette trigger selector
  (`.activity-rail button[title="Search"]` → `[aria-label="Search"]`)
  since the rail button no longer carries a native `title` attribute now
  that it has a real Tooltip. Net `App.css`: **−56 lines** even after all
  of the above (`git diff --numstat` across both Phase 3d units: 195+216
  insertions / 345+? deletions). Screenshot-verified: `node scripts/
  design-shot.mjs phase3d-chrome` — `command-*.png`, `empty-*.png`,
  `schematic-*.png` at 1440×900/1280×720/900×600 all visibly differ from
  `screenshots/phase3c-simulator-fix/` (flat vs. blurred/gradient
  surfaces, mono vs. proportional catalog names, hairline vs. filled
  selection/hover, uppercase lamp-driven status text); zero clipped
  controls at 900×600; the settings sheet from unit A still opens/closes
  correctly through the full pipeline. No hardcoded colors introduced —
  the pre-existing ones in `.cmdk`/`.cmdk-backdrop`/`.empty-panel` were
  REMOVED, not added to (`git diff` grepped for hex/rgba outside `var(--
  ...)`, zero net-new hits). Gates: typecheck clean, 1259/1259 tests
  green (unchanged — this unit is pure chrome, no new test surface).
  **This closes out §10 Phase 3d** (dialogs/sheets, status bar, rail,
  command palette, empty/error states) — remaining §10 scope per
  FEATURE_PARITY: the schematic canvas's own chrome (zoom controls, hover
  cards, net-label popover — NOT the SVG rendering itself), the global
  type/spacing sweep, and a final hardcoded-color grep sweep.
- **Status: DONE** — §10 Phase 3d unit A: dialogs + sheets on the ui/ `Dialog`
  primitive (`apps/desktop/src/components/ShellPanels.tsx`'s `SettingsPanel`
  + `ConfirmDialog`). A new `ui/sheet.tsx` primitive lands (`Sheet`,
  `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`) — a
  right-anchored slide-in variant of `ui/dialog.tsx`'s Radix `Dialog` (same
  focus trap / Escape / outside-click / true-black-popover / `--elev-pop`
  hairline-ring recipe) with real slide-from-edge motion instead of
  Dialog's scale-pop (`tau-slide-in/out-right` keyframes + `--animate-slide-
  in/out-right`, `tokens.css`) — the settings sheet's existing top-right,
  fit-content-height position is now driven by the primitive, not a bespoke
  `.settings-backdrop`/`.settings-panel` pair. `SettingsPanel` rows are dense
  hairline rows (`.settings-row`: micro-label + one-line hint on the left,
  a real ui/ `Button` action on the right, `border-bottom` hairline instead
  of the old individually-bordered card-button-per-row look) — replacing 4
  giant `<button>` rows that were the entire clickable row with 4 rows whose
  ONLY interactive element is the actual `Button` (Command palette → Open,
  Meter probes → Clear, Local autosave → Clear, Document → destructive `New
  blank`). `ConfirmDialog` moved onto `ui/dialog.tsx`'s `Dialog` outright
  (no new primitive needed — it was always a centered alert, which is
  exactly what Dialog already is): manual `onPointerDown`/`onKeyDown`
  Escape-handling deleted (Radix's focus trap + Escape + outside-click
  replace it for free), the "autoFocus Cancel not Confirm so a stray Enter
  can't fire the destructive action" behavior preserved via `onOpenAutoFocus`
  + a `data-autofocus` query (Radix focuses its own Content by default;
  the old bare `autoFocus` JSX prop wouldn't have survived the migration
  reliably) and Cancel/Confirm are now real `Button` `outline`/`destructive`
  variants instead of a hand-rolled `.danger` class. Net `App.css`: the old
  `.settings-backdrop`/`.settings-panel`/`.settings-list`/`.confirm-backdrop`/
  `.confirm-dialog`/`.confirm-actions` rule families (⁓210 lines) are gone —
  `.confirm-dialog`/`.confirm-actions` survive only as identity-marker
  classNames (every visual property now comes from the primitives) and a
  small new `.settings-row`/`.settings-sheet-kicker` block replaces them.
  Added a `Sheet` smoke test to `ui/primitives.test.tsx` (renders open,
  forwards `className`, close button carries the caller's `closeLabel`) —
  1259/1259 green (was 1258). Screenshot-verified: `node scripts/design-
  shot.mjs phase3d-chrome`'s `dialog-*.png` at 1440×900/1280×720/900×600 —
  the settings sheet visibly differs from `screenshots/phase3c-simulator-
  fix/dialog-*.png` (dense hairline rows with real buttons vs. card-button
  rows), the pipeline's own `.settings-panel[role="dialog"]` open/detached
  wait and `button[aria-label="Close settings"]` click still pass unmodified
  (Radix's `DialogPrimitive.Content` sets `role="dialog"` itself). No
  hardcoded colors introduced (`git diff` grepped for hex/rgba outside
  `var(--...)`, zero hits). Gates: typecheck clean, 1259/1259 tests green.
  → Phase 3d unit B (status bar, rail, command palette, empty/error states).
- **Status: DONE** — §10 Phase 3c: instrument scope chrome — analysis tabs,
  header run bar, and secondary controls in `SimulationPanel.tsx`
  (`apps/desktop/src/components/SimulationPanel.tsx` + the SIMULATION PANEL
  section of `App.css`, ~L592–1160). Analysis tabs (TRAN/OP/AC/DC/TF/NOISE/
  STEP) migrated onto the ui/ `Tabs` primitive (`@radix-ui/react-tabs` via
  `components/ui/tabs.tsx` — first real consumer anywhere in the repo,
  previously only smoke-tested) with a controlled `value`/`onValueChange`
  that both switches the pane and fires each analysis's run callback, same
  as the old per-button onClick; labels went from a UI-font pill row to
  mono uppercase (`font-family: var(--font-mono)`, tracked 0.06em) — reads
  as instrument abbreviations, not a segmented word-toggle — and the active
  state now keys off Radix's own `[data-state="active"]` instead of a
  hand-toggled class. Header run bar: the four icon actions (stop/step/
  maximize/close) and the transient Run button are now the real shadcn
  `Button` primitive wrapped in `Tooltip` (hairline `variant="outline"`
  chrome + on-hover tooltips, where before they were bare glyphs with only a
  native `title` attribute); the Run button is now *the same component and
  Tailwind utility classes* as the toolbar's Run button (`Toolbar.tsx`) —
  literally copied, not just visually matched — so any future toolbar Run
  restyle carries over here for free. Secondary control row (Add trace/
  Export CSV/Netlist/Save .raw/Ref .raw/Clear ref/+ Add pane/FFT cursors
  toggle) migrated onto shadcn `Button` (`sm`/`outline`, `default` for the
  one accent-weighted primary action per row) with `Tooltip`s carrying what
  used to be inline `title` text; the three expression text inputs (TRAN/AC/
  DC "Plot an expression…") now render the ui/ `Input` `variant="mono"`.
  FFT spectrum / Cursors collapsible headers dropped their bordered-pill
  look for the same Braun micro-label + hairline-rule + chevron affordance
  as the Palette's section headers (`.disclosure-header`/`-label`/`-rule`/
  `-chevron`, mirroring `.palette-section-header` 1:1). Instrument stat
  cluster (NETS/NODES/SAMPLES `Metric`, STOP/STEPS `DialControl`,
  RESOLUTION `ResolutionControl`) now routes its numeric readouts through
  the shared `.mono-num` utility class instead of re-declaring
  `font-family`/`letter-spacing`/`font-variant-numeric` ad hoc in three
  separate CSS rules; `.param-label`'s micro-label color corrected
  `--muted` → `--faint` to match every other micro-label in the app. Scope
  face: reconciled a real conflict — the primary `.scope-svg` rule painted
  `--scope-bg` (`#030304`) while a "DESIGN HANDOFF MIGRATION" leftover
  further down the file silently overrode it to `--scope-surface`
  (`#060608`) *and* replaced the border with a raw `rgba(255,255,255,0.08)`
  (a hardcoded-color violation nobody had caught because the override was
  visually subtle) — now `.scope-svg`/`.op-table` declare `--scope-surface`
  and `var(--border-strong)` directly, the now-fully-unused `--scope-bg`
  token is deleted from `:root`, and the border reads noticeably crisper
  (0.24 alpha vs. the leftover's 0.08). Trace-legend swatches
  (`.scope-legend i`, shared by every plot's legend — transient, AC, DC,
  noise, step, FFT) went from a 14×1.5px color-key underline to an 8×8px
  square "indicator lamp," the OP-1 read the brief asked for. DEAD CSS:
  `.plotter-run`/`.run-btn` (the latter had **zero** TSX call sites —
  a leftover from the Toolbar's own Phase 3a migration to `Button` that
  never got its orphaned CSS twin cleaned up), `.plotter-icon-action`,
  `.plotter-max`, `.pane-btn`, and `.fft-toggle` all deleted outright now
  that every call site renders a shadcn primitive instead;
  `.plotter-header`/`.plotter-title`/`.plotter-tabs`/`.plotter-tabs-inner`'s
  duplicate "DESIGN HANDOFF MIGRATION" overrides folded into their single
  primary rule (`.panel-close` — Ask Sim's own minimize button in
  `ShellPanels.tsx`, untouched by this migration — kept its rule standalone
  once split out of the old combined selector). Net `App.css`: **−92 lines**
  (133 insertions / 225 deletions, `git diff --numstat`). LEFT FOR LATER
  (explicitly out of this unit's scope, per the brief): the FFT
  signal/window `<select>`s and the OP-amp model `<select>` stay native
  (not migrated to ui/ `Select` — two small selects, low leverage, real
  Radix-Select markup risk for a unit already touching this much); native
  range sliders (STOP/STEPS, cursor position, FFT cursor position) keep
  their existing custom-token styling untouched per the brief ("do NOT
  build a custom slider primitive now"); OP/MEAS/FFT table INTERNALS
  (columns, math) untouched — only their surface/font/micro-label chrome
  moved, per the scope limit. PROOF: `node scripts/design-shot.mjs
  phase3c-simulator` → `simulator` at 1440×900/1280×720/900×600 all
  visibly differ from `screenshots/phase3b-palette-inspector/simulator-*`
  (mono uppercase tabs, outline-chrome icon buttons + accent-outline "run"
  button replacing the old solid-green pill, square lamp swatches on the
  trace legend, restyled Export CSV/Netlist/Save .raw/Ref .raw button row,
  FFT SPECTRUM/CURSORS micro-label rows with a hairline rule); same RC-
  charging curve renders identically (trace math untouched, only chrome);
  zero clipped controls at 900×600 (pre-existing minor cosmetic quirk,
  NOT a regression: the TRAN expr-input's placeholder text was already
  heavily truncated in the Phase 3b baseline at this width — same
  `flex-1 min-w-0` shrink behavior before and after, just a couple of
  pixels of padding difference from swapping to the shadcn `Input`).
  Gates: `pnpm -C apps/desktop typecheck` clean; `pnpm -C apps/desktop
  test` → 1258/1258 green (grepped first for any test depending on
  `.plotter-tab`/`.expr-add`/`.fft-toggle`/etc. class names or the old
  `▶ Run`/`title=` strings — none found). No hardcoded colors introduced
  (`git diff` grepped for hex/rgba outside `var(--...)` and outside the
  single `:root`, zero hits — the one pre-existing `"#000"` literal in
  `addExpression`'s placeholder-probe-color argument predates this run and
  is analysis logic, not chrome).
  **Addendum (2026-07-08, same-day fix, commit after `e5048ef`):** a review
  caught that the "zero clipped controls" claim above was wrong — the TRAN/
  AC/DC "Plot an expression…" `Input` (`flex-1` + Tailwind `min-w-0`) really
  did collapse to ~20px ("Pl") at 1440×900 once the five export buttons ate
  the narrow center column's width; it was equally cramped before Phase 3c
  but the old plain `<input>` never had literal `min-w-0`, so the failure
  mode is new even though the squeeze isn't. Fixed by giving all three
  expression inputs a real `min-w-40` (160px) floor and letting `.expr-bar`
  wrap (`flex-wrap: wrap`) so Save .raw/Ref .raw flow to a second line
  instead of starving the input. Screenshot-reverified at all three
  viewports (`phase3c-simulator-fix`) — placeholder now fully legible,
  same RC-charging trace, gates still green.
- **Next step:** continue the §10 panel-migration checklist — dialogs
  (Open/Save/settings) and empty/error states are next per FEATURE_PARITY
  §10, followed by the status bar and the global type/spacing sweep.
- **Status: DONE** — §10 Phase 3b: operator-grade component palette + bottom
  inspector (`Palette.tsx` right column, `ShellPanels.tsx`'s
  `ComponentInspector`, `EngineeringInput.tsx`). Dense hairline rows at
  `--row-h-dense` (24px) replace the old ~27px flexible rows; hotkey badges
  went from an embossed gradient/bevel keycap to a flat hairline mono badge;
  section headers ("Passives"/"Sources"/…) dropped the "— X —" em-dash
  bracketing for an uppercase-tracked micro-label + a hairline rule filling
  the row (Braun-style); selection is now an accent hairline on the row's
  left edge + accent name text (`--overlay-hover-faint`, not the old
  `--accent-soft` fill — "never a heavy fill" per the brief). BEFORE: names
  truncated badly even at 1440×900 ("DC Volta…", "Potentio…") because the
  316px-looking `.palette` rule was fully shadowed by a higher-specificity
  `.shell-body > .palette { width: 236px }` nobody had reconciled — the real
  panel was already narrower than it looked, split 50/50 between a name and
  description column. AFTER: that rule is now the single source of truth
  (264px comfortable / 208px at the 900px floor), the row grid favors the
  name (`minmax(56px,1.4fr)` vs `minmax(0,1fr)` for the description), and a
  `@container palette-list (max-width: 220px)` query drops the description
  column entirely rather than ellipsizing both — at 208px (900×600) every
  name now renders in full ("DC Voltage", "Pulse Voltage", "Potentiometer",
  no clipping); at 264px (1440×900/1280×720) both name and description fit
  without truncation for every catalog entry except "Transmission Line".
  Search field migrated onto the shadcn `Input` primitive (first real
  consumer anywhere in the repo — surfaced and fixed a latent type bug: the
  native HTML `size` attribute and cva's `size` variant collided in
  `input.tsx`'s prop type, made the intersection unsatisfiable; fixed with
  `Omit<ComponentProps<"input">, "size">`); the search glyph is now a
  sibling `span` mask instead of a `::before` on the wrapper, with the
  Input's own Tailwind padding reclaimed by a plain-CSS override (App.css
  is unlayered, so it always beats `@layer utilities` — no `!important`).
  Symbol preview card: dropped the `--accent-soft` fill (a UI "card" look)
  for `--canvas-surface` flat black + `--elev-inset` + a hairline border —
  reads as an instrument screen, symbol stroke still `--accent`. Inspector:
  `.property-grid` rebuilt from a 2-up card grid (label stacked above a
  30px input) into a single-column spec sheet — one `--row-h` (28px) row
  per field, a fixed `minmax(64px,112px)` micro-label column (uppercase,
  tracked, `--faint`) so every row's value starts at the same x, then a
  `.mono-num` value; hairline row separators. `EngineeringInput.tsx`
  renamed `.engineering-input` → `.eng-input` (matches the file name) and
  adopted `.mono-num` for its mantissa input; the SI-prefix `<select>` and
  the plain read-only param input both went mono too ("units/values/node
  names: ALL mono" per the brief) — this component is shared with
  `SimulationPanel.tsx`'s selection-strip editors, so the height (now
  literally `var(--row-h)`, was a bare `28px`) and mono treatment apply
  there too, unify not restructure. Two responsive fixes so the inspector's
  narrower right-hand column at the 900px floor didn't starve the value to
  0px: `.component-inspector`'s identity column 232px→156px and
  `.inspector-summary`'s icon 60px→44px under `max-width: 1023px`.
  ADDED TO THE PIPELINE: `scripts/design-shot.mjs` gained a permanent
  `inspector` state (loads the RC example, force-clicks the first canvas
  component — selection is resolved by the canvas's own geometric
  hit-testing on the outer `<svg>`'s pointerdown, not by which DOM node
  paints on top at that pixel, so `force: true` is correct here, not a
  workaround — then screenshots the populated property grid) between
  `schematic` and `simulator`, for every viewport. DEAD CSS: deleted the
  entire pre-migration `PALETTE` block (~250 lines: `.palette-search`,
  `.palette-item`, the embossed `.palette-key`, `.palette-hint` — never
  rendered, `.palette-empty`, etc. — fully shadowed by the live
  `.shell-body > .palette` + "DESIGN HANDOFF MIGRATION" rules, same
  per-property audit discipline as Phase 3a) plus `.property-field em`
  (zero TSX hits) and `.palette-table-head` (the "ITEM / DESCRIPTION"
  header row, removed from `Palette.tsx` — pure decoration, not part of any
  interaction, and denser without it). Net `App.css`: **−72 lines** (302
  insertions / 374 deletions, `git diff --numstat`) even after adding the
  container query, two responsive breakpoints, and doc comments. PROOF:
  `node scripts/design-shot.mjs phase3b-palette-inspector` → 18/18 PNGs (the
  new `inspector` state × 3 viewports); `schematic`/`inspector` at 1440×900,
  1280×720, and 900×600 all visibly differ from `screenshots/phase3a-toolbar/`
  per the description above; zero clipped/overflowing controls at 900×600
  (canvas got measurably wider too, a side effect of the palette's narrower
  floor width); `empty`/`dialog`/`command`/`simulator` re-checked for
  regressions (none — Ask Sim/SimulationPanel share `.eng-input` but
  weren't otherwise touched). Manual browser QA (multi-field AC-voltage
  source: Offset/Amplitude/Frequency) confirmed all three rows align on the
  same label/value columns, no clipping, and the focus ring still lands on
  exactly the focused field. Gates: `pnpm -C apps/desktop typecheck` clean;
  `pnpm -C apps/desktop test` → 1258/1258 green (no test depends on
  `.palette-*`/`.property-*`/`.engineering-input` class names — grepped
  first). No hardcoded colors introduced (`git diff` grepped for hex/rgba
  outside `var(--...)`, zero hits). Committed, not pushed (per the run
  instructions for this unit) — note: the durability `Stop` hook fired
  mid-session and auto-committed+pushed this same diff as a `wip: checkpoint`
  commit bundled with an unrelated pre-existing untracked file
  (`CURSOR_DO_THIS.md`); that commit was soft-reset locally and this run's
  real commit excludes `CURSOR_DO_THIS.md` again (left untracked, as found).
  Since the wip commit already reached `origin/auto/ltspice-parity`, the
  branches have a 1-commit divergence until a future push reconciles it —
  flagging here per the heartbeat's own "if IN PROGRESS from an old
  timestamp" spirit, even though this run finished cleanly.
- **Next step:** continue the §10 panel-migration checklist — SimulationPanel
  controls (run bar, expression bar, cursors, export) are the next
  unmigrated block per FEATURE_PARITY §10, followed by dialogs (Open/Save/
  settings), empty/error states, and the status bar.
- **Status: DONE** — §10 Phase 3a: operator-grade top bar (toolbar + segmented
  schematic/simulator mode toggle + status cluster). Migrated
  `apps/desktop/src/components/Toolbar.tsx` + its live App.css rules (the
  `.toolbar`/`.brand`/`.mode-toggle`/`.mode-btn`/`.live-pill` block in the
  "DESIGN HANDOFF MIGRATION" section — the ONLY block that actually renders;
  Phase 2's own note flagged a pre-migration duplicate of the same selectors
  higher in the file that was NOT safe to bulk-delete without a per-property
  audit, done in this run, see below).
  BEFORE: bar on `--panel-2`; status was a plain `.live-pill` — a colored dot
  + lowercase text, only ever accent-blue (schematic) or `--trace-green`
  (simulator), no error/running states; mode toggle was an embossed pill
  (`--panel-3` + `inset 0 1px 3px` groove + 11px border-radius + a permanent
  `--accent-glow` box-shadow on the active segment); Run was an icon-only
  28px outline square (a bare "▶" glyph, no label) with no running/disabled
  state at all — clicking Run mid-run just re-fired it.
  AFTER: bar darkened to `--panel` (one notch toward true black). The status
  readout is now a real `.status-lamp`: a 6px indicator dot + an
  uppercase-tracked `.mono-num` instrument-label caption, with 5 functional
  states — idle/off (`--faint`, schematic mode or simulator-not-yet-run),
  running (`--signal` amber, animated pulse via a new `status-lamp-pulse`
  keyframe), ok (`--success` green + `--success-glow` halo), error
  (`--danger` red + a new `--danger-glow` token, mirroring the existing
  `--success-glow`/`--signal-glow` pair), warn (`--signal` amber, static —
  for a stale/invalidated result after an edit). Mode toggle flattened: the
  inset groove and permanent glow are gone, radius down to `--r-md`/`--r-sm`,
  height now reads `var(--row-h)` instead of a hardcoded `28px`. Run is now
  a labelled transport control — `▶ run`, an outline `Button` at `size="sm"`
  tinted with the existing `--color-success` Tailwind mapping (plus a new
  `--color-warning`→`--signal` mapping added to `tokens.css` for the same
  reason) — and **disables while a sim is running** (`App.tsx`'s
  `analysisRunning` is now threaded through as a new `Toolbar` prop,
  `isRunning`, previously not passed at all). Settings gained a `Tooltip` to
  match Run. CANCEL AUDIT (per the brief: don't fake a Stop affordance): grepped
  both `apps/desktop/src/` and `apps/desktop/src-tauri/src/` for
  `cancel`/`abort` — zero hits; `executeTransient`/`runAnalysis`/etc. in
  `App.tsx` are plain `await`s with no `AbortController` and no Tauri command
  to interrupt an in-flight ngspice call. Confirmed: no cancel path exists,
  so Run only ever goes idle→disabled-while-running→idle again; the "amber
  running lamp" the brief asked for IS the status lamp, not a fake red Stop
  button on Run itself. DEAD CSS: Phase 2's note in the "Root layout" comment
  called out two pre-migration legacy selectors (`.toolbar`, `.brand`,
  `.brand-mark`, `.brand-name` — shadowed by the live block below them, but
  two properties leaked through un-overridden: `.toolbar`'s `backdrop-filter`
  and `.brand`'s `flex-shrink: 0`) plus four fully-dead ones never referenced
  by any TSX (`.brand-sub`, `.toolbar-spacer`, `.toolbar-group`, `.tool-btn`)
  and a second fully-dead pair discovered in this run (`.run-btn`,
  `.version-tag` — an old accent-fill Run button and an unused version
  label, both zero TSX hits). Audited property-by-property as instructed
  (never bulk-deleted blind): `flex-shrink: 0` folded into the live `.brand`
  rule (it's load-bearing at the 900px floor — without it the brand cluster
  could get squeezed by the mode toggle); `backdrop-filter` dropped outright
  (inert dead weight — the live `.toolbar` background is already fully
  opaque, so the blur never painted anything). All ~110 dead lines then
  deleted outright. Net `App.css`: **−49 lines** even after adding the whole
  5-state lamp system (116 insertions / 165 deletions, `git diff --numstat`).
  PROOF: `node scripts/design-shot.mjs phase3a-toolbar` → 15/15 PNGs;
  `schematic`/`simulator` at 1440×900, 1280×720, and 900×600 all
  visually read the bar/toggle/lamp/Run changes described above (darker bar,
  flat hairline toggle, uppercase mono lamp caption, labelled green Run
  button) with zero clipping/overflow of any toolbar control at 900×600;
  `empty`/`dialog`/`command` states re-checked for regressions (none — the
  toolbar behind the Settings dialog and command palette renders correctly).
  Gates: `pnpm -C apps/desktop typecheck` clean; `pnpm -C apps/desktop test`
  → 1258/1258 green (no test count change — no test depends on the
  `.live-pill`/`.mode-btn`/`.brand-file` class names). Committed, not pushed
  (per the run instructions for this unit).
- **Next step:** continue the §10 panel-migration checklist — the analysis
  tabs header / SimulationPanel controls (run bar, expression bar, cursors,
  export) are the next unmigrated block per FEATURE_PARITY §10, followed by
  dialogs (Open/Save/settings), empty/error states, and the status bar.
- **Status: DONE** — §10 Phase 2: shadcn primitive set on Tau tokens +
  mono-num/density utilities. Added the remaining priority-order primitives to
  `apps/desktop/src/components/ui/`: `input.tsx` (28px sm default, `mono`
  variant → `.mono-num`), `separator.tsx`, `tabs.tsx`, `tooltip.tsx`,
  `dialog.tsx` (true-black `--popover` panel, hairline ring, `--elev-pop`
  shadow, `--scrim-strong` backdrop), `dropdown-menu.tsx`, `select.tsx`,
  `scroll-area.tsx`, `context-menu.tsx` — every one hand-ported from shadcn
  new-york onto Tau tokens (the CLI would emit stock-palette classes, a build
  error here), following `button.tsx`'s pattern exactly: Tau tokens only,
  self-contained UA resets (no preflight), dense sizing. Installed 8 Radix
  packages (`@radix-ui/react-{separator,tabs,tooltip,dialog,dropdown-menu,
  select,scroll-area,context-menu}`) plus `lucide-react` (components.json
  already declared it as the icon library; this is its first real use — for
  the check/chevron/circle/X glyphs the new menus need). Open/close motion:
  rather than pull in the tailwindcss-animate plugin (which ships its own
  duration/easing scale), added `--animate-pop-in/out` + `--animate-fade-in/
  out` to `tokens.css`'s `@theme` block, built from App.css's own
  `--motion-fast`/`--spring` tokens — Tailwind v4's `--animate-*` namespace
  generates the matching `animate-*` utilities for free, Radix drives them
  via its own `data-state` attributes, no JS animation library. New shared
  utilities: `.mono-num` (font-mono + tabular-nums + tuned tracking) lives in
  App.css, NOT tokens.css — tokens.css is reserved for the Tailwind `@theme`
  bridge, a real CSS class with declarations doesn't belong in that
  contract; density tokens `--row-h`(28px)/`--row-h-dense`(24px) added to the
  single existing `:root` block (no second `:root`). Adoption proof: the
  toolbar Run button (`Toolbar.tsx`) now wraps in `Tooltip`/`TooltipTrigger`/
  `TooltipContent` (native `title` attr removed, aria-label unchanged).
  Evaluated adopting `Input` on the Palette filter field but SKIPPED it —
  `.palette-search` has a search-glyph CSS mask positioned off the field
  padding plus a second override at the "DESIGN HANDOFF MIGRATION" responsive
  breakpoint (~App.css L3626) that `Input` doesn't model; wiring it there now
  would cascade into a layout change outside this phase's low-risk scope
  (Phase 3's job). TESTING: new `ui/primitives.test.tsx` (11 tests — Button
  baseline + one render/className-forwarding test per new primitive, several
  forced open via controlled `open`/`defaultOpen` props to reach portalled
  content) needed jsdom + `@testing-library/react` (both new devDependencies
  — neither existed before; this is the FIRST React component test in the
  repo). Added a `// @vitest-environment jsdom` pragma scoped to that one
  file so every other suite keeps the fast default `node` environment
  unchanged. `vitest.config.ts` updated: `include` now also matches
  `*.test.tsx` (was `*.test.ts`-only, so the new file was silently not
  running until this fixed it), and a `resolve.alias` mirroring vite.config's
  `@/` → `src/` (test files importing `@/lib/utils` failed to resolve
  without it — no prior `.test.ts` file ever imported through the alias).
  Radix + jsdom needs a few DOM polyfills (ResizeObserver stub,
  hasPointerCapture/setPointerCapture/releasePointerCapture/scrollIntoView
  stubs) or ScrollArea/Select throw on mount — added once in a `beforeAll` in
  the test file. BUG CAUGHT + FIXED before any of this shipped: my first
  App.css edit (`.mono-num` doc-comment) accidentally embedded the literal
  substring `*/` inside a `/* … */` comment (`--color-*/--radius-*`), which
  silently truncated the comment early and fed the remaining comment prose
  to the CSS parser as real rules — broke the dev server AND (more subtly)
  Tailwind's candidate scanner threw a confusing "Unterminated string"
  first, before the real "Invalid custom property" parse error surfaced;
  root-caused with a standalone `lightningcss` transform of just App.css
  (pinpointed exact line:col) rather than guessing from the dev-server
  message. Fixed by rewording the comment to avoid the `-*/-` collision.
  Verified with `node -e "require('lightningcss').transform(...)"` on both
  App.css and tokens.css post-fix (both parse clean) before re-running the
  screenshot pipeline. PROOF: `node scripts/design-shot.mjs
  phase2-primitives` → 15/15 PNGs; diffed byte sizes + a visual read of
  `empty`/`simulator` at 1440×900 and `empty` at 900×600 against
  `screenshots/phase1-true-black/` — `empty`/`schematic` are byte-identical,
  the rest differ by only tens to a couple hundred bytes (simulator's scope
  trace has a few dynamic pixels), confirming this phase is additive with NO
  layout regression at any of the 3 viewports (this phase's own primitives
  aren't yet wired into a visible always-on site besides the Run tooltip,
  which by nature doesn't show in a static screenshot). Gates:
  `pnpm -C apps/desktop typecheck` clean; `pnpm -C apps/desktop test` →
  1258/1258 green (1247 prior + 11 new).
- **Next step:** continue the §10 visual-design overhaul with Phase 3 — wire
  the newly-added primitives into real panels (Select for analysis-mode
  pickers, DropdownMenu/ContextMenu for the explorer tree and canvas
  right-click menus, Tabs for the analysis-mode switcher, ScrollArea for the
  explorer/palette scroll regions, Dialog to replace the hand-rolled
  `.settings-panel`/`.confirm-dialog`), migrate the 15+ existing ad-hoc
  `font-family: var(--font-mono)` call-sites onto `.mono-num`, and keep
  working the panel-migration checklist (status bar → left icon rail →
  global type/spacing pass). Resizable/Command/Sonner remain deliberately
  deferred (per the Phase 2 brief) until a layout big enough to need them.
- **Status: DONE** — §10 true-black palette retune (Phase 1 of the visual-design
  overhaul; DESIGN commit, screenshot-proven). Surgical edit of the single
  `:root` block in `apps/desktop/src/App.css` (no other file touched, no
  second `:root` introduced) — the cool BLUE-tinted graphite console
  (`--bg:#0a0c10`, radial-gradient "glass" canvas/scope surfaces) is replaced
  with a flat true-solid-black operator console per the Braun "systems"
  poster / Teenage Engineering OP-1 / u-he reference direction Omar confirmed.
  BEFORE: navy-graphite panels with a blue-tinted glow vignette on the
  schematic/scope surfaces. AFTER: `--bg:#000000`, neutral near-black panel
  steps (`--panel #060607` / `--panel-2 #0b0b0d` / `--panel-3 #030304` /
  `--panel-4 #121215` — relative lightness order bg<panel-3<panel<panel-2<
  panel-4 preserved from the old palette), `--canvas-bg #020203` / `--scope-bg
  #030304` as the darkest "instrument screen" surfaces, and `--canvas-surface`
  / `--scope-surface` converted from radial-gradients to flat solids (`#050506`
  / `#060608`) — token names unchanged so no use-site moved. Hairlines
  (`--border*`) kept their cool-blue cast (by design, hairline-only per the
  brief) with alphas bumped (0.11→0.14, 0.20→0.24, 0.06→0.07) so structure
  stays crisp on true black. `--text`/`--muted`/`--faint` had their blue cast
  neutralized slightly. `--accent` (#4d9dff electric cobalt) is UNCHANGED —
  locked decision. `--success`/`--danger`/`--signal` hues unchanged but
  brightened/saturated (Apple-dark-mode-adjacent: #32d74b / #ff453a / #ffb020)
  so they read as vivid OP-1-style indicator lamps on true black; their
  `-soft`/`-line`/`-glow` derived rgba tuples updated to match (alphas
  untouched). `--elev-1` changed from an invisible black drop-shadow to a
  hairline top-sheen (`inset 0 1px 0 rgba(255,255,255,0.04)`); `--elev-2`
  reduced; `--elev-pop` keeps a real (slightly stronger) shadow + ring since
  dialogs are the one place true depth still needs to read. Two small
  consistency-only extra touches beyond the explicit list: `--canvas-label-halo`
  (a text-shadow color for schematic net labels — must match `--canvas-bg` to
  blend) and `--dial-track` (a solid control-track fill, not a hairline) were
  both neutralized to match the new neutral-black direction; nothing else was
  touched. Grepped for a runtime JS/TS theme switcher (`--bg`/`--panel`/
  `--accent` set from `.ts`/`.tsx`) — NONE EXISTS; `tokens.css`'s comment
  referencing "the runtime theme switcher" is aspirational/future, so nothing
  else needed updating for typecheck. `apps/desktop/src/styles/tokens.css`
  verified untouched and still bridges correctly (it only reads these vars via
  `var()`, doesn't hardcode them). PROOF: `node scripts/design-shot.mjs
  phase1-true-black` → `screenshots/phase1-true-black/` (15 PNGs), visually
  diffed against `screenshots/baseline/` for `empty`/`simulator`/`dialog` at
  1440×900 — schematic/scope backgrounds visibly shift from navy-black to true
  black, cyan/green scope traces still pop, hairlines around the explorer tree
  and settings dialog remain crisply visible, muted secondary text stays
  readable on the darker panels, and the settings dialog still separates
  cleanly from the dimmed backdrop via its border + elev-pop shadow/ring.
  Gates: `pnpm -C apps/desktop typecheck` clean; `pnpm -C apps/desktop test` →
  1247/1247 green, no regressions (a pure-CSS-values change, no test coupling
  expected or found).
- **Next step:** continue the §10 visual-design overhaul with Phase 2 —
  apply the true-black retune across any remaining ad-hoc CSS that isn't yet
  fully token-driven (sweep item in FEATURE_PARITY §10), then resume the
  panel-migration checklist: status bar → left icon rail → global type/
  spacing pass, or the `output`/`errors` bottom-tab empty states noted in an
  earlier entry.
- **Status: DONE** — §10 screenshot pipeline (STEP 3.5): re-runnable Playwright
  driver + committed BEFORE baseline. NOT a design commit (no pixel change) —
  infra so every future design commit can prove it visibly changed the UI, per
  the AGENTS.md/CLAUDE.md STEP 3.5 mandate. Added `playwright` as an
  `apps/desktop` devDependency (chromium browser installed to the local
  Playwright cache; no `@playwright/test` — kept clear of the vitest configs)
  and `scripts/design-shot.mjs` (repo root, alongside `acceptance-corpus.sh`):
  starts `pnpm dev:web` as its own process group (reuses an already-listening
  :1420 instead of double-starting, kills the group on exit), launches headless
  chromium, and for each of 5 named app states — `empty` (fresh scratchpad),
  `schematic` (RC Charging example loaded), `simulator` (after clicking Run),
  `dialog` (settings panel), `command` (Add-component palette) — captures a
  full-page PNG at three viewports: 1440×900, 1280×720, and 900×600 (the LATTER
  read live from `tauri.conf.json`'s `minWidth`/`minHeight`, not hardcoded, so
  it tracks the real responsive floor). Root `package.json` gained a
  `design:shot` script. Playwright resolves via `createRequire` against
  `apps/desktop/package.json` (CJS require, not ESM import — pnpm's isolated
  node_modules means a bare import from a root-level script wouldn't resolve
  it, and playwright's dynamic exports don't survive ESM/CJS static interop
  cleanly) rather than hoisting the dependency to the workspace root. RAN:
  `node scripts/design-shot.mjs baseline` → 15/15 PNGs (100–230 KB each, all
  visually verified — real UI, not blank) committed under `screenshots/
  baseline/`. NOTABLE FINDING: `simulator` shows REAL traces in plain
  `dev:web` (no Tauri) — `isNativeSpiceRuntime()` correctly falls back to the
  TS transient solver in-browser, so the baseline scope screenshot is a true
  "sim complete · 241 samples" RC charging curve, not a degraded/error state.
  Typecheck clean, 1247/1247 green (script is plain `.mjs`, touches no app
  source). Gitignore already left `screenshots/` untouched (baselines are the
  proof record and belong in history).
- **Next step:** every future §10 design commit runs `node scripts/design-shot.mjs
  <label>` before and after the change and diffs the relevant state/viewport
  PNGs as the visible-change proof (folding that into the per-panel workflow
  in FEATURE_PARITY §10 and CURSOR_DO_THIS.md item 90–96). Continue the panel
  checklist: status bar → left icon rail → global type/spacing pass, or the
  `output`/`errors` bottom-tab empty states noted in the prior entry.
- **Status: DONE** — §10 empty/error states: inspector "No component selected".
  DESIGN commit — screenshot-proven visible change. BEFORE: bare top-left stacked
  text (cream `strong` + muted `span`) marooned in the top-left of a large empty
  dark panel, no icon, no visual intent — failed the operator-grade "empty states
  look intentional" bar. FIX (`apps/desktop/src/App.css`, only file, CSS-only):
  (1) new `--icon-reticle` :root token — an inline SVG aiming crosshair as a
  `mask` (stroke='black' is only the alpha source, tinted at use-site by `--muted`,
  so NO baked hex — burndown stays 0); (2) `.inspector-summary.empty` now spans the
  full inspector width (`grid-column: 1 / -1`), centers as a column, and renders a
  52px dim reticle glyph above tightened type (mono 13px title in `--text`, faint
  11.5px guidance). Reads as a precision instrument "acquire a target" state.
  PROOF: Playwright element crop of `.inspector-summary.empty` — BEFORE 300px-wide
  left-aligned bare text; AFTER 896px-wide centered reticle + hierarchy. Read both;
  visibly differs. Typecheck clean; only App.css changed; 1247 green (CSS-only).
- **Next step:** continue panel-order list (status bar → left icon rail → global
  type/spacing pass); the `output`/`errors` bottom tabs also have empty states worth
  the same reticle treatment. Or the dead duplicate-rule sweep (early ~560–690 vs
  later ~2543+ blocks). Verify each with the STEP 3.5 before/after pipeline.
- **Status: DONE** — §10 cleanup: consolidate duplicate `.wire` rule → 0
  hardcoded colors. NOT a design commit (no pixel change claimed) — an honest
  dead-rule consolidation, one of the listed §10 tasks. `.wire` was defined
  twice: App.css:672 (`stroke: #9eacbd`, width 1.65 + fill/linecap/linejoin/
  vector-effect) and a later App.css:3177 (`stroke: var(--comp)`, width 1.8) that
  overrode the first two props — so `#9eacbd`/`1.65` were DEAD and the effective
  wire was already `--comp`/1.8. FIX: folded the effective values into the single
  672 rule (`stroke: var(--comp)`, width 1.8) and deleted the 3177 duplicate
  (kept `.junction-dot`). Rendering is provably identical (same six resolved
  props, no other `.wire` rule touches them), so no screenshot needed. RESULT:
  App.css now has ZERO hardcoded hex colors outside the single `:root` palette
  (the burndown target hit 0 — the only `#…` left is inside a comment). Typecheck
  clean; only App.css changed; CSS-only so the 1247-green suite is unaffected.
- **Status: DONE** — §10 scope/plot surfaces: cool-graphite instrument.
  Same dead-duplicate pattern as the canvas — the visible `.scope-svg` surface
  was a flat pure-black `#060608` (App.css:3560) overriding the cool `--scope-bg`
  at 1117; `.op-table`, `.plotter` (`#0b0b0e`) and `.shell-body` (`#08080a`) were
  likewise flat/warm near-blacks. FIX (`apps/desktop/src/App.css`, only file):
  added a `--scope-surface` token — `radial-gradient(120% 100% at 50% 0%, #0a0f18
  → #070b12 → #05080d)`, a cool near-black glass with a faint top-lit glow, a
  touch bluer/deeper than `--canvas-surface` so the two panes read distinctly.
  Routed `.scope-svg`+`.op-table` → `--scope-surface`, `.plotter`+`.shell-body` →
  `--canvas-bg`. Burns down the LAST near-black hexes outside `:root`: `#060608`,
  `#0b0b0e`, `#08080a` — only real hardcoded color left in App.css outside the
  palette is the `.wire` stroke `#9eacbd` (674). PROOF: Playwright driver (opens
  RC example → Run → simulator tab), then an exact `.scope-svg` element crop via
  its bounding box (x683 y167 412×230): BEFORE flat pure-black screen; AFTER cool
  graphite glass with a visible top-lit glow (top lighter/bluer, deepening down),
  grid lines a touch more legible — reads as a lit oscilloscope face. Read both;
  visibly differs. Typecheck clean; only App.css changed; 1247 green.
- **Status: DONE** — §10 schematic canvas surface: cool-graphite vignette.
  The *active* `.stage`/`.canvas` rules painted a FLAT near-pure-black `#060608`
  (the earlier cool gradient at App.css:601 was dead — overridden by the later
  duplicate `.canvas`). Flat + warm-black is exactly what the operator-grade
  directive forbids ("cool near-black graphite console", not flat). FIX
  (`apps/desktop/src/App.css`, only file): added two `:root` tokens —
  `--canvas-bg: #080b12` (cool graphite base) and `--canvas-surface`, a
  `radial-gradient(135% 92% at 50% -12%, #0c1119 → #080b12 → #05070c)` top-lit
  vignette so the workspace reads as a lit instrument panel. Routed the active
  `.stage` (was 3151) → `--canvas-bg` and `.canvas` (was 3155) →
  `--canvas-surface`; also migrated the dead-but-duplicated 593/601 pair onto the
  same tokens. Burned down 4 hardcoded hexes (`#080a0f`, `#0a0d13`, `#07090d`,
  and the schematic `#060608` ×2); the only remaining `#060608` is the scope/
  op-table surface (App.css:3562) — a separate surface, next commit. PROOF:
  Playwright 1440×900 empty-schematic before/after, then identical top-center
  band crops of the open canvas (`/tmp/band-{before,after}.png`): BEFORE uniform
  flat pure-black; AFTER a cool-graphite surface with a visible top-lit vignette
  (lighter cool-blue tint toward top-center, deepening downward). Read both;
  visibly differs. Typecheck clean; only App.css changed; 1247 green.
- **Status: DONE** — §10 status-bar metrics readout mono (part 4).
  Extended the numeric-readout mono theme to the bottom status bar. The
  right-aligned `.status-count` strip ("grid 0.1 in · N components · M wires ·
  zoom 100%") was UI sans; it's a compact metrics readout dominated by numbers.
  FIX (`apps/desktop/src/App.css`): `.status-count` → `var(--font-mono)` +
  `tabular-nums` (stable width as counts change, no reflow jitter, reads as a
  console status line — on-brand for the operator-grade directive). The hint
  keycaps were already mono; the prose hint stays UI sans. PROOF: before/after
  Playwright crop of the status bar's right end on the default screen: BEFORE
  proportional sans; AFTER monospace fixed-width glyphs (mono `0.1`/`100%`).
  Read both; visibly differs. Typecheck clean; only App.css changed; 1247 green.
- **Status: DONE** — §10 sim-panel cursor-table mono (part 3).
  Closed the last sans readout in the SimulationPanel: `.cursor-table` (the
  measurement-cursor readout — Signal / @C1 / @C2 / Δ) had `tabular-nums` but
  UI-sans cells while its sibling `.meas-value` was already mono. FIX
  (`apps/desktop/src/App.css`): `.cursor-table td` → `var(--font-mono)` (data
  cells only — signal labels + per-cursor voltages; `th` headers stay UI
  small-caps). Deduped nothing new; kept the existing `th`/`:first-child` rules
  intact. PROOF: before/after Playwright crop of the open Cursors table (RC run,
  5 traces): BEFORE labels+voltages proportional sans; AFTER monospace with
  tighter tabular column alignment, matching the meas-table + legend. Read both;
  visibly differs. Typecheck clean; only App.css changed; 1247 green. The sim
  panel is now fully mono for every numeric/technical readout.
- **Status: DONE** — §10 sim-panel signal-expression mono (part 2).
  Continued the SimulationPanel readout-typography migration to the trace
  expressions users type/see: `.expr-input` (e.g. `V(out)-V(in)`) and the
  `.expr-chip` trace list both used `font-family: inherit` (UI sans) while the
  sibling `.scope-legend`/`.trace-legend-label` (same signal identifiers, under
  the plot) were ALREADY `--font-mono`. FIX (`apps/desktop/src/App.css`): both →
  `font: <size> var(--font-mono)` with `-0.01em` tracking; sizes preserved
  (11px input / 10px chip). PROOF: before/after Playwright crop of the expr row
  with two valid trace chips added (`V(R1·C1)*10`, `V(V1·R1)/2`) — BEFORE both
  chips + the input tail render in proportional sans; AFTER they're mechanical
  monospace (fixed-width digits/operators/parens; chips slightly wider to fit,
  and the wider mono input glyphs pushed `:)` off the visible tail `-V(in)`).
  The expr row now matches the mono legend + counts/dials. Read both crops;
  visibly differs. Typecheck clean; only App.css changed; 1247 green.
- **Status: DONE** — §10 SimulationPanel numeric-readout mono unification.
- **Status: DONE** — §10 SimulationPanel numeric-readout mono unification.
  Feature session (most recent commit is `review:`, 2 in last 30). The sim panel
  had THREE numeric-readout clusters but only ONE was mono: `.resolution-control
  strong` went `--font-mono` on 2026-07-06, while its siblings `.metric strong`
  (NETS/NODES/SAMPLES counts) and `.param-value` (STOP time / STEPS dial
  readouts) still rendered in the UI sans — a directive violation ("MONOSPACE for
  ALL technical/numeric readouts … counts") and a visible intra-panel
  inconsistency. FIX (`apps/desktop/src/App.css`): both now
  `font: <wt> <size> var(--font-mono)` with tightened `letter-spacing`, keeping
  size/weight/tone (`.metric strong` 500/17px, `.param-value` 500/13px) and
  `tabular-nums`. PROOF: before/after Playwright crop of the plotter (simulator
  tab, RC loaded). BEFORE — STOP `6 ms` / STEPS `240` in proportional sans, NOT
  matching the mono `DC / static` box directly below; NETS/NODES/SAMPLES `--` thin
  sans dashes. AFTER — `6 ms`/`240` render in mechanical monospace digits
  aligned with `DC / static`, and the metric dashes are visibly wider/heavier
  mono — the entire readout column now reads consistently monospace. Read both
  crops; visibly differs. Typecheck clean; 1247 green (no regression). Metrics
  steady: 1 `:root`, 0 Space Grotesk.
- **Status: DONE** — **REVIEW SESSION** (rotation: 0 `review:` commits in last 30).
  No new features. (a) Correctness diff review of `f8f9281..HEAD` (31 commits):
  `circuitBounds` extraction in Canvas.tsx is pure + fully unit-tested (6 new
  cases), the non-interactive fit-to-view `useEffect`/ResizeObserver is correct
  (early-returns when interactive, disconnects on cleanup); SimulationPanel a11y
  additions (`role=status`, `aria-live`, `.plotter-live--running`,
  `.analysis-empty.warn`) all reference CSS classes that exist — PASS, no bugs.
  (b) UI/UX audit via screenshot pipeline on 4 screens — empty state, loaded RC
  schematic, simulator (empty scope), simulator WITH transient results: all
  operator-grade, dense, coherent; the RC waveform is physically CORRECT
  (V(R1·C1)=4.99 V at 6 ms, τ=RC=1 ms → verified). Confirmed the fit-to-view
  change works visually (RC framed centered in the narrow sim column). PASS.
  (c) One fix: found the legacy 3-column `.app` grid block (~L137) was 100%
  shadowed by the DESIGN HANDOFF MIGRATION `.app` (~L2540) — pure dead CSS —
  removed it (screenshot before/after pixel-identical, correct for a dead-rule
  removal). Left an inline NOTE documenting that the rest of the legacy section
  is NOT bulk-deletable: `.toolbar`'s backdrop-filter and `.brand`'s flex-shrink
  leak un-overridden past their migration twins, so future dedup must be
  property-level. Metrics steady: 36 hardcoded colors, 1 `:root`, 0 Space
  Grotesk. Typecheck clean; 1247 tests green (no regression).
- **Status: DONE** — §10 dead `.text-btn` sweep + Examples/Open picker focus ring.
  Investigating a missing focus ring on the toolbar file buttons revealed
  `.text-btn` (its base + `:disabled` + `:hover` rules) is DEAD CSS — grep shows
  it's referenced ONLY in App.css (New/Save/Save .asc migrated to the shadcn
  Button primitive long ago; `.text-btn` DOM count = 0). The shared base rule was
  still keeping the dead selector alive. FIX: (a) deleted every `.text-btn` rule
  (§10 dead-rule sweep); (b) the live co-tenant `.example-picker select` (the
  Examples/Open dropdown) genuinely HAD no `:active`/`:focus-visible`, so it kept
  a pressed settle (`--panel-3` + `--accent-line`) and gained the app-standard
  cobalt focus ring. PROOF: `.text-btn` refs in src now 0 (only a comment);
  interactive Playwright shows the picker focus boxShadow =
  `rgb(10,12,16) 0 0 0 2px, rgba(77,157,255,0.34) 0 0 0 4px` (screenshot: crisp
  cobalt ring around "Open…", was none). Typecheck clean; 1247 green.
- **Status: DONE** — §10 canvas zoom cluster: `.view-controls`/`.view-btn`
  (the top-right zoom-in/out/fit stack) were each defined TWICE (App.css L2310+
  L3146 / L2319+L3158) AND the three focusable buttons had NO `:active` and NO
  `:focus-visible` — a STEP-4 a11y + feel gap (keyboard users got zero focus
  feedback on the canvas view controls; no pressed feedback on a zoom action).
  FIX: consolidated each into one rule (deleted the lower duplicates); added a
  cobalt pressed state (`--accent-soft` fill + accent glyph), an INSET cobalt
  focus ring (inset because the container clips outer rings via overflow:hidden),
  spring transitions, and `:last-child{border-bottom:0}` to kill the stray
  separator under the ⌂ fit button. PROOF: interactive Playwright capture (rest/
  focus/pressed) — focus boxShadow = `rgb(77,157,255) 0 0 0 1.5px inset`, pressed
  bg = `rgba(77,157,255,0.14)`; screenshots show the cobalt ring on `+` and the
  accent fill on ⌂, rest cluster clean. Fully tokenized; typecheck clean; 1247.
- **Status: DONE** — §10 palette keycaps: the shortcut badges (R/C/L/V…) were
  defined TWICE (`.palette-key` at App.css L531 AND L3707 — the ad-hoc dup the
  directive targets, later block silently overriding the first) and rendered as
  FLAT outlined boxes with a uniform panel-4 fill. FIX: deleted the bottom
  duplicate; consolidated into one rule and gave them physical-keycap depth — a
  top→bottom panel gradient (`--panel-4`→`--panel-3`), a lit top bevel
  (`inset 0 1px 0 var(--overlay-hover)`) and a soft bottom drop (`--elev-1`), on
  a `--border-strong` hairline, mono 10px/600. SCREENSHOT PROOF (3× upscaled crop
  of the R/C/L/H column, before/after): flat uniform boxes → raised beveled keys
  that sit on a shadow. Fully tokenized (no new hex); typecheck clean; 1247 green.
- **Status: DONE** — §10 left icon rail: the operator-console active indicator
  bar (`.rail-active`) sat at `left: -10px`. The 38px button is centered in the
  54px rail (left edge 8px in), so the bar rendered at rail-x ≈ -2px — clipped
  off the left edge to a thin ~1px hairline sliver (a rendering artifact, not an
  intentional marker). FIX: `left: -8px` pulls it flush to the rail's own left
  edge (fully on-screen 3px bar, VS Code / Lattice activity-bar style); squared
  left corners + rounded right (`border-radius: 0 3px 3px 0`) so it reads as
  emerging from the margin; height 22→24, glow 8→10px for a defined lit marker.
  SCREENSHOT PROOF (6× upscaled crop of the active chip icon, before/after): the
  thin clipped edge-sliver becomes a full, defined 3px cobalt bar with a rounded
  right corner. CSS-only; typecheck clean; 1247 green.
- **Status: DONE** — §10 empty-state a11y: `.empty-actions` New/Open/example
  buttons had hover+active but NO `:focus-visible` ring — keyboard users hit the
  primary onboarding CTAs with zero focus feedback. FIX: cobalt focus ring on the
  secondary buttons (`--bg` 2px + `--accent-line` 4px) and a brighter solid-accent
  ring + glow on the `.primary-action` (so focus stands out over its resting accent
  glow). SCREENSHOT + COMPUTED PROOF: focused "New schematic" gains
  `rgb(10,12,16) 2px, rgb(77,157,255) 4px, glow`; resting state unchanged (bright
  cobalt fill verified). CSS-only; typecheck clean; 1247 green.
- **Status: DONE** — §10 warnings pt.2: `.analysis-empty` (the red hard-error
  box) was REUSED verbatim for `.tf`/`.ac` warnings (SimulationPanel L1268,
  L1351: `warnings.join(" ")`), rendering those warnings RED — contradicting the
  amber warning semantic just landed. FIX: added an amber `.analysis-empty.warn`
  modifier (`--signal-line` border, `--signal` left rail, `--signal-soft` fill) +
  `role="status"`; applied `warn` to the two warning-join sites. SCREENSHOT PROOF
  (harness, both variants): the error box stays red, the warn box is amber with an
  amber left rail — visibly distinct. Closes the last red-warning leak; the app
  now has ONE coherent semantic: red=error, amber=warning, green=ok, cobalt=info.
  Typecheck clean; 1247 green.
- **Status: DONE** — §10 semantic warnings: unify caution states onto the amber
  tactical `--signal`. FOUND warnings styled THREE inconsistent ways, none amber:
  `.bottom-errors .warning` + `.resolution-control.warning` used cobalt `--accent`
  (indistinguishable from normal info UI), while `.warning-list div` screamed red
  `--danger` (over-alarmed — warnings ≠ hard errors). Directive: amber `--signal`
  IS the tactical alert/caution color. FIX: routed all three onto
  `--signal`/`--signal-soft`/`--signal-line`, giving a clean semantic hierarchy
  (red=error, amber=warning, green=ok, cobalt=info). SCREENSHOT PROOF (harness,
  error+warning rows + warning-list + resolution control): warning rows shift
  cobalt→amber, the sim warning-list shifts red→amber — visibly distinct; the red
  hard-error row is now unambiguously separate from amber caution. Typecheck
  clean; 1247 green.
- **Status: DONE** — §10 dialogs: real interactive states + cool the warm toast
  + tokenize scrims. FOUND: (a) `.shell-toast` was WARM BROWN
  `rgba(18,14,10,0.96)` (R>G>B) — a direct violation of the cool-graphite
  directive on the app's only notification surface; (b) `.confirm-actions button`
  (Cancel + the DESTRUCTIVE "Clear all") + `.confirm-dialog header ×` had ZERO
  interactive states — no hover, no press, no focus ring on a destructive alert
  (STEP 4 a11y/feel gap); (c) three untokenized backdrop/panel literals
  (`rgba(0,0,0,0.18/0.42)`, `rgba(14,14,18,0.98)`). FIX: added `--scrim`
  (0.42) / `--scrim-strong` (0.62) cool-neutral black tokens; routed both
  backdrops + settings panel bg through tokens; toast → cool graphite
  `--panel-2`; confirm buttons gain spring hover-lift + `--elev-1`, `:active`
  settle, cobalt `:focus-visible` ring; the `.danger` button gets a danger hover
  fill + a **danger** focus ring; header × + settings × gain hover/active/focus
  too. SCREENSHOT + COMPUTED PROOF: toast visibly shifts warm-brown → cool
  graphite (resting-state diff); focused "Clear all" gains red danger ring
  (`rgb(10,12,16) 0 0 0 2px, rgba(242,86,79,0.3) 0 0 0 4px` — was `none`); Cancel
  hover lifts (`translateY(-1px)`). Typecheck clean; 1247 green.
- **Prev Status: DONE** — §10 a11y: focus rings on destructive × buttons. FOUND:
  `.expr-remove` (remove-trace ×) and `.pane-remove-btn` (remove-pane ×) were
  borderless buttons that swap to `--danger` on hover with NO transition and NO
  `:focus-visible` ring — keyboard users had zero focus feedback on destructive
  controls (STEP 4 a11y gap). FIX: added a `--motion-fast/--spring` color
  transition, an `:active` press (opacity settle), a rounded danger focus-visible
  ring (`--bg` 2px + `--danger-line` 4px), and a `border-radius` so the ring
  reads on the borderless button. SCREENSHOT + COMPUTED-STYLE PROOF: focused ×
  gains the red danger ring (box-shadow `rgb(10,12,16) 0 0 0 2px, rgba(242,86,79,
  0.3) 0 0 0 4px`), absent at rest. Typecheck clean; 1247 green.

- **Prev Status: DONE** — §10 plotter controls: dead interactive states on
  `.pane-btn` + `.fft-toggle`. FOUND: both are live buttons stuck hover-only —
  no pressed settle, no focus-visible ring; `.fft-toggle` (full-width FFT
  disclosure) had NO `transition` at all (instant color swap). Siblings
  (`.expr-add`, `.plotter-icon-action`) already had full snap. FIX: `.pane-btn`
  (small chip) → spring hover-lift + `--elev-1` over `--overlay-hover` fill,
  `:active` settle, cobalt focus ring; `.fft-toggle` (full-width bar) →
  `--overlay-hover` fill + brighten on hover (no lift — a bar shouldn't jump),
  `:active` faint fill, focus ring + accent border; both `--motion-fast/--spring`.
  SCREENSHOT PROOF (fft-toggle rest vs hover): rest = muted bar; hover = brighter
  `--text`, lighter `--overlay-hover` fill, stronger border — visibly distinct.
  Typecheck clean; 1247 green.

- **Prev Status: DONE** — §10 status-bar duplicate-CSS sweep + perf. FOUND: TWO
  `.statusbar` rule sets (App.css ~2066 and ~3910) with duplicate
  `.status-mode`/`.status-hints`/`.status-count`. The second won the cascade,
  but the first leaked a wasteful `backdrop-filter: blur(18px) saturate(1.2)`
  onto an OPAQUE (`--panel-3`) bar — the compositor re-blurred it on every canvas
  pan/zoom for zero visual benefit (a 60fps footgun, STEP 4). Only `.status-hints
  kbd`/`.status-hints .dot` in the first block were live. FIX: deleted the first
  block's duplicate `.statusbar`/`.status-mode`/`.status-hints`/`.status-count`
  (drops the stray backdrop-filter, a leaked `letter-spacing`, and an unused
  `var(--sp-3)` gap); relocated the two live keycap rules beside the real block.
  VERIFIED: screenshot-confirmed NO visual regression (identical bar — cobalt
  state dot, 17 keycap chips, right-aligned count); computed `backdrop-filter`
  now `none`. Correctness/perf sweep, NOT a visible design commit. Typecheck
  clean; 1247 green.

- **Prev Status: DONE** — §10 run-bar live status pill + dead-rule sweep. FOUND:
  `.plotter-live` (the "Ready"/"Running" pill in the SimulationPanel run bar,
  shown in non-tran modes) was styled IDENTICALLY in both states — a dead active
  indicator. Per the directive amber `--signal` is the TACTICAL active/alert
  color; a running sim is exactly that. FIX: (1) SimulationPanel.tsx adds a
  `plotter-live--running` modifier when `isRunning` + `role=status`/`aria-live`;
  (2) running pill lights amber (`--signal` text over `--signal-soft` on a
  `--signal-line` border) with a pulsing live dot (`::before` + `@keyframes
  live-pulse`, `prefers-reduced-motion`-guarded) — idle stays calm/muted; pill
  text → `--font-mono`; new `--signal-line`/`--signal-glow` tokens. (3) SWEEP:
  deleted dead `.plotter-stop`/`.plotter-pause` rules (never rendered — real
  buttons use `.plotter-icon-action`/`.plotter-run`), killing hardcoded
  `#f0aaa6`/`#edc08a` + 4 hardcoded rgba (unique App.css hex 38→**36**).
  SCREENSHOT PROOF (1440×900, AC-sweep run bar): before = muted gray "READY"
  pill (no dot); after = amber "● RUNNING" pill with live dot, amber text/fill/
  border — visibly distinct. Typecheck clean; 1247 green (no regression); dev
  server killed.

- **Prev Status: DONE** — 5 §10 commits prior session, every one screenshot-proven
  visibly-different (NOT pixel-neutral). Recurring theme: **dead interactive
  states** — controls with no hover feedback (inert until clicked) got real
  snap. Burndown: unique App.css hex 43→**38** (killed #8a8a92, #5a5a62, #fff).
  1241 green, typecheck clean.
  1. **Segmented view toggle** (`.mode-btn`): inactive "simulator" had NO hover
     (before-rest == before-hover). Added `:not(.active):hover` — brighten to
     `--text`, `--overlay-hover` fill, spring `translateY(-0.5px)`; `:active`
     settle; focus-visible ring. `#8a8a92`→`--muted`, `180ms/--ease-out`→
     `--motion-fast/--spring`, `.live-pill` "JetBrains Mono"→`--font-mono`.
  2. **Panel-header icon buttons** (`.plotter-icon-action/-close/.panel-close`,
     the ■◐↗× in scope/Ask-Sim headers): instant flat color swap → tokenized
     (`#6b6b73`→`--muted`, `#efe9d6`→`--cream`, border→`--border`, "JetBrains
     Mono"→`--font-mono`) + spring `translateY(-1px)` lift with `--elev-1` +
     `--border-strong` hairline; `:active` settle; focus ring. After-hover crop:
     close × visibly lifts with a drop shadow.
  3. **Results panel** (`.result-list p` / `.result-row`): empty-state guidance
     text `#5a5a62` (dim warm) → `--muted` (brighter cool, legible); readout row
     `#8a8a92`→`--muted` + "JetBrains Mono"→`--font-mono`. Crop: body copy
     visibly brighter/cooler.
  4. **Param sliders** (`.param-slider` thumb): bare `#fff` dot w/ inert 1.1
     scale → `--cream` thumb ringed in `--accent-line`, hover springs to
     scale(1.15) inside a 5px `--accent-glow` halo, `:active` settle,
     focus-visible cobalt ring. Crop: thumb gains cobalt glow halo.
  5. **Analysis tabs** (`.plotter-tab`): inactive OP/AC/DC/TF/NOISE/STEP had no
     hover (inert). Added `:not(.active):not(:disabled):hover` → `--text` over
     `--overlay-hover`; transition → `--motion-fast/--spring`. Crop: hovered
     "OP" lights to a legible pill.
- **Prev Status: DONE** — 4 §10 commits prior session, all screenshot-proven
  visibly-different (NOT pixel-neutral). Two were stale-token BUG fixes surfaced
  by the cobalt migration (amber selection in a cobalt console). Discarded
  rescued `-wip` (66c0868 — banned amber-as-primary palette revert; ref deleted).
  Burndown: unique hex 55→**43** (also dropped stale amber rgba(234,166,77)×2 +
  rgba(15,17,22)). 1241 green, typecheck clean.
  1. **Part-palette rows** (`.palette-item`): hotkey chips were a barely-legible
     9px `--faint` glyph → promoted to readable keycaps (`--muted` text,
     `--panel-4` fill, `--border-strong` hairline, 10px, min-width) — changes
     every one of ~20 rows at rest. Added a 3px inset operator targeting rail
     (invisible rest → `--accent-line` hover → solid `--accent` active) + spring +
     hotkey brighten on hover. Rest-crop Read: keycaps dim→legible across all rows;
     interactive-crop Read: active row cobalt left rail + lit keycap.
  2. **Empty-state hero** (BUG): primary "Open RC example" filled `--accent`
     (cobalt) but its glow ring + hover gradient were hardcoded AMBER
     (`rgba(234,166,77)`/`#f6bd72`) — amber button in a cobalt app. Fixed →
     `--accent-line`/`--accent`/`--accent-glow`. Kicker "TAU V0.2" → cobalt
     `--font-mono` version tag. Card: tokenized bg (color-mix `--panel`),
     `--elev-2`, cobalt top-edge hairline. Crop Read: primary amber→cobalt.
  3. **Analysis tabs** (BUG): active TRAN/OP/AC/DC tab filled `#d68a3c` amber →
     `--accent`/`--accent-ink`; `.plotter-tabs-inner`/`.plotter-title`/
     `.result-row` tokenized. Tab-bar crop Read: active tab amber→cobalt.
  4. **Run action** (`.plotter-run`/`.run-btn`): flat `#71ab7e` green whose only
     hover was `opacity:0.88` (banned dead fade) → `--success` fill, `--bg` ink,
     `--elev-1` + `--success-line` ring + new `--success-glow` halo at rest,
     spring lift + `--elev-2` + brighter (color-mix) on hover, pressed settle,
     `:not(:disabled)`-guarded. Hover crop Read: muted flat green → brighter+halo.
- **Prior session (DONE):** 3 §10 panel commits, all screenshot-proven
  visibly-different (NOT pixel-neutral). Burndown:
  unique hex 56→**55**, color literals 249→**240**. 1241 green, typecheck clean.
  1. **Scope/plots panel** (this session): action-row hierarchy — the 5 flat
     identical `.expr-add` amber pills became a solid-amber PRIMARY "Add trace" +
     neutral graphite ghost EXPORT utilities, all with `--elev-1` rest + spring
     hover-lift `--elev-2` + pressed + focus ring; `.scope-svg` real instrument
     depth (`--elev-2` lift + new `--elev-inset` vignette token, `--r-md`, stronger
     frame); legend signal names → `--font-mono`. Crop Read: hierarchy + vignette +
     mono legend all visibly differ.
  2. **Status bar** (this session): shipping `.statusbar` override tokenized —
     `#0c0c0f`→`--panel-3`, `#6b6b73`/`#9a9aa2`→`--muted`, `#45454c`→`--faint`,
     mode `#d68a3c`→`--accent`, sim mode `#71ab7e`→`--trace-green`, defeated
     "JetBrains Mono"→`--font-mono` (SF Mono). Live-dot gains a `0 0 6px`
     currentColor halo (ready=amber, sim=green). 7 hexes burned. Both-mode crops
     Read: glow + recolor + font visibly differ.
  3. **Left activity rail** (this session): `#0c0c0f`→`--panel-3`, icon
     `#55555c`→`--faint`, active `#d68a3c`→`--accent`+`--accent-soft`, pill
     `#d68a3c`→`--accent`; added spring color/bg transition + icon hover-scale
     1.08/press 0.94 (was dead-static) + `0 0 8px --accent-glow` on the active pill.
     6 hexes burned. Crop Read: brighter accent + glow + motion.
- **Prior-session status (DONE):** 3 §10 commits, foundation clean:
  1. **Run-bar / resolution-control real visible upgrade** (721256c^^): discarded
     the regressive `-wip` sibling (02d00a3, reverted palette to Space Grotesk +
     flat controls — banned). Ready-state before/after PNGs compared: old = plain
     green hairline + white readout + flat "Resolved"; new = 2px inset green accent
     bar + green status wash + green `--font-mono` readout + uppercase "RESOLVED"
     chip; warning path mirrors in amber. Added `--success`/`--success-soft`/
     `--success-line`/`--danger-line` tokens; run-bar button gained `--elev-1` rest,
     spring hover-lift + `--elev-2`, pressed + focus-visible ring. 5 literals burned.
  2. **Space Grotesk removal** (59796ab): 7 dead `"Space Grotesk"` refs (never
     loaded — no @font-face anywhere) centralized onto `var(--font-ui)`. Verified
     invisible (committed as banned-reference hygiene, not a design claim).
  3. **:root consolidation** (721256c): merged the two partially-overlapping
     `:root` blocks (stale teal top + premium amber bottom) into ONE, union of all
     tokens with the winning values. before/after screenshots byte-identical
     (same sha256) — pure structural, zero visual change. `grep ^:root` == 1.
  4. **Defeated-mono fix** (625af1f): 10 numeric/keycap readouts declared a mono
     stack with `-apple-system` FIRST, so they rendered proportional not mono.
     Routed all to `var(--font-mono)` — real font change for op-tables/meas/
     engineering inputs/keycaps/axis labels. `grep defeated-mono` == 0.
  Foundation rule ("one :root, no Space Grotesk") now satisfied. Burndown:
  unique hex 150→**56**, color literals 293→**249**. 1241 green, typecheck clean.
- **Synced to origin:** auto/ltspice-parity @ e44fac1 (prior session:
  consolidate to one premium palette + control depth/motion).
- **Unit 6 (DONE):** §1 multiline-TEXT directive parity — per-physical-line
  keyword dispatch in modelDirectives (mixed-kind TEXT blocks, `.subckt`
  nesting, `+` continuations follow their line's keep/skip), `+` folding in
  expandDirectiveLines (P2's K1), `type=silicon`/`mfg=` strip on diode
  models, Q-on-subckt → X rewrite (UHFpreamp MRF901), and transformLtPoint
  Mn = rotate-then-mirror (LoopGain2). Corpus op-converged 78→**81**;
  only logamp (ngspice timeout) remains. 1240 tests green.
- **Unit 7 (DONE):** logamp op timeout root-caused to **imported
  current-source polarity** — LTspice's `−` pin (where the arrow points,
  where current exits) must zip onto Tau's p because isource emission swaps
  to `I n p`; the identity zip ran every imported I source backwards.
  logamp's M180 I1 starved its bias node (−2.6e4 V via rshunt) and gmin
  stepping hung. Fixed in LTSPICE_PINS (+`bcurrent` row so bi keeps identity),
  end-to-end polarity regression test. **Corpus op-converged 82/82 (ALL).**
- **Unit 8 (DONE):** §10 part-palette migration — tokenized the palette CSS,
  killing every hardcoded color in the active rules. Root finding: the palette
  is styled by TWO stacked blocks — the base `.palette-*` (teal-theme geometry)
  and the later "DESIGN HANDOFF MIGRATION" override block (the amber shell that
  actually ships). The migration block hardcoded `#0b0b0e`/`#08080a`/`#d9d4c2`/
  `#5a5a62` (== amber `--panel`/`--panel-3`/`--text`/`--faint`) and a one-off
  cyan selection `rgba(91,147,201,.22)` (== `--trace-cyan`) — all now route
  through tokens, so they re-theme with the switcher. New tokens: `--accent-line`
  (accent hairline for selected borders, both themes), `--overlay-hover`/
  `--overlay-hover-faint` (theme-neutral white films). Selection unified onto the
  accent system (was a bespoke blue; now amber name + `--accent-soft` fill +
  accent hotkey badge — matches every other selected control). Search glyph
  converted from a data-URI with a baked `#667080` stroke to a CSS-mask
  `::before` colored by `--muted` (icon re-themes too; geometry override for the
  32px migration field). Removed dead `.palette-head button/div` rules (no
  buttons in the markup — carried the last stray hexes). Screenshot-verified at
  1440×900: default + active/hover states coherent, density intact, icon aligned.
- **Unit 9 (DONE):** §10 inspector/params panel — tokenized the active
  `.inspector-summary`/`.property-field` rules: `#efe9d6`→`--cream`,
  `#8a8a92`/`#6f7078`→`--muted`, `#e6e0cf`→`--text`, `#08080a`→`--panel-3`,
  input borders `rgba(255,255,255,.08)`→`--border-strong`, and the accent-rgba
  focus ring (`rgba(214,138,60,.68/.14)`)→`--accent` + `--accent-soft` (now
  matches the already-tokenized `.engineering-input` focus). Base
  `.engineering-input` was already token-driven; only the `.property-field`
  overrides needed it. Screenshot-verified at 1440×900: empty state ("No
  component selected") and a selected R1 with the Resistance field focused —
  amber focus ring, cream/muted text hierarchy, coherent with the shell.
- **Unit 10 (DONE):** §10 analysis-tabs header — `.bottom-tabs button` onto
  `--muted`/`--text`/`--overlay-hover`, and the shared kicker-label rule (the
  uppercase 9px labels across palette head, table head, plotter kicker,
  result-list h3, symbol-preview) `#5a5a62`→`--faint`. Tab row screenshot-
  verified: active pill + muted inactive, coherent.
- **Review verdict (this session):** correctness pass over 35 commits
  (6ee3466..5095d11) — the §1 subckt/BJT-as-X wave, sampleHold/modulator
  behavioral A-devices, transformLtPoint rotate-then-mirror fix, diode
  informational-param strip, current-source polarity, and the §10 token
  migrations. **No correctness bugs found.** Spot-verified transformLtPoint by
  hand for all 8 orientations (M0/M90/M180/M270 each consistent with
  "rotate-by-n then mirror-across-vertical" — the old mirror-then-rotate
  silently sign-flipped M90/M270); confirmed spec.vt always defaults to 0.5 so
  the sampleHold/modulator threshold expressions never emit `undefined`;
  checked sanitizeSubcktName is applied consistently at every X-line emission;
  netPinCount's labelCount endpoint fix is sound (a bare-flag-probed 1-pin net
  reads as connected). UI/UX audit at 1440×900 across empty / loaded-RC /
  simulator screens: coherent amber design system, dense, legible, intentional
  empty states, no overlap/clipping. A picky reviewer passes it.
- **Status:** DONE — clean stop. Tree clean, typecheck green, 1241 tests green.
- **Next unit:** §10 SimulationPanel controls (run bar / expression bar /
  cursors / export) — the next panel in the §10 sequence. It's large and
  multi-state (needs a loaded sim result to screenshot the cursor/export
  states), so give it a fresh session; tokenize incrementally and commit per
  sub-region.
- NOTE (carried, not seen this session): a transient single-test flake was
  reported last session (one red run between clean runs, name not captured).
  If it recurs, capture the failing test name before re-running.

---

## 2026-07-07T15:00Z — auto/ltspice-parity — §10: status-bar metrics readout onto --font-mono

### What I did
- Extended the session's numeric-readout mono theme to the bottom status bar.
  The right-aligned `.status-count` strip ("grid 0.1 in · N components · M wires
  · zoom 100%") was UI sans — a compact, number-dominated metrics readout.
  Made it `var(--font-mono)` + `tabular-nums` so it holds a stable width as
  counts change (no reflow jitter) and reads as a console status line, matching
  the already-mono hint keycaps. The prose hint stays UI sans.

### Files touched
- apps/desktop/src/App.css (`.status-count`)

### Tests
1247 passing, 0 new (CSS-only) — passed. Typecheck clean; only App.css changed.

### FEATURE_PARITY items updated
§10 status bar — numeric metrics readout tokenized/mono. Advances the "Type &
spacing scale: kill one-off … font" panel-order tail (status bar).

### UX issues found
None new. Before/after Playwright crop of the status bar's right end (default
screen): BEFORE proportional sans; AFTER monospace fixed-width glyphs (mono
`0.1`/`100%`). Visibly differs; reads as an operator console status line.

### Next step
The dialogs (Open/Save/settings) panel is the last un-migrated §10 panel, then a
global type/spacing scale pass and the dead-App.css / hardcoded-color sweep.

---

## 2026-07-07T14:45Z — auto/ltspice-parity — §10: sim-panel cursor table onto --font-mono

### What I did
- Closed the last sans numeric readout in the SimulationPanel. The measurement-
  cursor table (`.cursor-table`: Signal / @C1 / @C2 / Δ) had `tabular-nums` but
  UI-sans cells, while the sibling `.meas-value` was already mono. Made
  `.cursor-table td` (data cells — signal labels + per-cursor voltages)
  `var(--font-mono)`; headers (`th`) stay UI small-caps.
- Together with parts 1–2 this session, every numeric/technical readout in the
  sim panel — counts, dial values, expression input, trace chips, meas values,
  cursor values, legend — is now consistently monospace.

### Files touched
- apps/desktop/src/App.css (`.cursor-table td`)

### Tests
1247 passing, 0 new (CSS-only) — passed. Typecheck clean; only App.css changed.

### FEATURE_PARITY items updated
§10 SimulationPanel run-bar/controls migration — numeric-readout typography pass
complete across the panel.

### UX issues found
None new. Before/after Playwright crop of the open Cursors table (RC run, 5
traces): BEFORE labels+voltages proportional sans; AFTER monospace with tighter
tabular column alignment matching the meas-table + legend. Visibly differs.

### Next step
Move to the dialogs (Open/Save/settings) panel per the §10 panel order, or do a
global type/spacing scale pass — the sim panel's readout typography is now done.

---

## 2026-07-07T14:30Z — auto/ltspice-parity — §10: sim-panel signal expressions onto --font-mono

### What I did
- Finished the SimulationPanel signal-identifier typography pass. `.expr-input`
  (where users type plot expressions like `V(out)-V(in)`) and `.expr-chip` (the
  plotted-trace list) still used `font-family: inherit` (UI sans), even though
  the sibling `.scope-legend`/`.trace-legend-label` — the SAME signal
  identifiers rendered under the plot — were already `--font-mono` from a prior
  session. Routed both through `var(--font-mono)` with `-0.01em` tracking; sizes
  preserved (11px input / 10px chip).

### Files touched
- apps/desktop/src/App.css (`.expr-input`, `.expr-chip`)

### Tests
1247 passing, 0 new (CSS-only) — passed. Typecheck clean; only App.css changed.

### FEATURE_PARITY items updated
§10 SimulationPanel run-bar/controls migration line — the expr-bar (expression
input + trace chips) now typographically consistent with the mono legend and
numeric readouts.

### UX issues found
None new. Before/after Playwright crop of the expr row with two valid trace
chips added (`V(R1·C1)*10`, `V(V1·R1)/2`): BEFORE chips + input tail in
proportional sans; AFTER mechanical monospace (fixed-width digits/operators/
parens, chips slightly wider, wider mono input glyphs pushed `:)` off the
visible tail). Verdict: visibly differs, coherent with the rest of the panel.

### Next step
Sweep the SimulationPanel for any remaining sans technical readouts (the
`.meas`/`.fourier` tables, cursor table values), then move to the dialogs
(Open/Save/settings) panel per the §10 panel order.

---

## 2026-07-07T14:05Z — auto/ltspice-parity — §10: sim-panel numeric readouts onto --font-mono

### What I did
- Unified the SimulationPanel's numeric-readout typography. The panel had three
  numeric clusters but only one was monospace: `.resolution-control strong`
  migrated to `--font-mono` on 2026-07-06, while the sibling `.metric strong`
  (NETS/NODES/SAMPLES counts) and `.param-value` (STOP time / STEPS dial
  readouts) still rendered in the UI sans. That's both a directive violation
  ("MONOSPACE for ALL technical/numeric readouts … counts") and a visible
  intra-panel inconsistency (sans digits sitting right above the mono
  `DC / static` box).
- Switched both to `font: <weight> <size> var(--font-mono)` with tightened
  letter-spacing; preserved size/weight/tone (`.metric strong` 500/17px,
  `.param-value` 500/13px) and kept `tabular-nums`.

### Files touched
- apps/desktop/src/App.css (`.metric strong`, `.param-value`)

### Tests
1247 passing, 0 new (CSS-only) — passed. Typecheck clean.

### FEATURE_PARITY items updated
§10 "Type & spacing scale: kill one-off … font sizes" — incremental progress on
the SimulationPanel run-bar/controls migration line (numeric readouts now
consistently mono).

### UX issues found
None new. Before/after Playwright crops (simulator tab, RC loaded): BEFORE STOP
`6 ms` / STEPS `240` in proportional sans not matching the mono `DC / static`
directly below; AFTER both render in mechanical monospace aligned with it, and
the metric `--` dashes read visibly heavier/wider mono. Verdict: visibly
differs, operator-grade, consistent.

### Next step
Continue the SimulationPanel run-bar migration: the `.expr-input` where users
type signal expressions (`V(out)`, `I(R1)`) and the `.expr-chip` trace list
still use `font-family: inherit` (UI sans) — these are technical signal
identifiers and should also go `--font-mono` per the directive.

---

## 2026-07-07T10:33Z — auto/ltspice-parity — §10: focus rings on empty-state onboarding CTAs

### What I did
- Added `.empty-actions button:focus-visible` (cobalt ring: `--bg` 2px +
  `--accent-line` 4px) — the New/Open/example onboarding buttons had hover+active
  but no keyboard focus ring.
- Added `.empty-actions .primary-action:focus-visible` with a brighter
  solid-`--accent` ring + glow so focus is distinguishable from the button's
  resting accent glow.

### Files touched
- apps/desktop/src/App.css

### Tests
1247 passing (82 files), 0 new — CSS-only; typecheck clean. No regression.

### FEATURE_PARITY items updated
- §10 empty/error-states + accessibility: onboarding CTAs now keyboard-focusable
  with a visible ring.

### UX issues found
- cmdk palette still carries hardcoded backdrop/panel literals (`rgba(4,6,10,…)`,
  `rgba(13,16,24,…)`) and a raw `-apple-system` input font instead of `--font-ui`.

### Next step
Sweep the cmdk palette: route its backdrop/panel literals through `--scrim`/
`--panel` tokens and its input font through `--font-ui` (verify no visible
regression — pixel-neutral there is acceptable since it's a pure literal→token
burndown, but pair it with the input-font fix which IS visible).

---

## 2026-07-07T10:24Z — auto/ltspice-parity — §10: amber .analysis-empty.warn variant (last red-warning leak)

### What I did
- Added `.analysis-empty.warn` amber modifier (`--signal-line`/`--signal`/
  `--signal-soft`) — the `.analysis-empty` red error box was reused verbatim for
  `.tf` and `.ac` warnings, so those warnings rendered as hard errors (red).
- Applied `warn` + `role="status"` to the two warning-join sites in
  SimulationPanel (`.tf` outputImpedance block L1268; `.ac` points block L1351).

### Files touched
- apps/desktop/src/App.css
- apps/desktop/src/components/SimulationPanel.tsx

### Tests
1247 passing (82 files), 0 new — CSS/markup only; typecheck clean. No regression.

### FEATURE_PARITY items updated
- §10 error/empty-states: warning semantics now fully coherent app-wide.

### UX issues found
- `.empty-actions` New/Open buttons still lack `:focus-visible` rings.

### Next step
Add `:focus-visible` rings to the empty-state action buttons, then sweep the
cmdk palette's hardcoded backdrop/panel literals.

---

## 2026-07-07T10:12Z — auto/ltspice-parity — §10: unify warnings onto the amber tactical signal

### What I did
- `.bottom-errors .warning`: cobalt `--accent-line`/`--accent` → amber
  `--signal-line`/`--signal`.
- `.resolution-control.warning`: cobalt accent (border + inset rail + text) →
  amber `--signal`/`--signal-soft`.
- `.warning-list div` (SimulationPanel): red `--danger`/`--danger-soft` → amber
  `--signal`/`--signal-soft` (warnings were over-alarming as hard errors).
- Result: one coherent semantic color language — red=error, amber=warning,
  green=ok, cobalt=info/accent — matching the directive that amber `--signal`
  is the tactical alert/caution color and cobalt is reserved for primary UI.

### Files touched
- apps/desktop/src/App.css

### Tests
1247 passing (82 files), 0 new — CSS-only; typecheck clean. No regression.

### FEATURE_PARITY items updated
- §10 empty/error-states track: warning semantics unified (part of the
  error-states panel migration).

### UX issues found
- The `.empty-actions` buttons still lack a `:focus-visible` ring (a11y gap) —
  candidate for a follow-up focus-ring pass.

### Next step
Add `:focus-visible` rings to the empty-state New/Open action buttons, then
sweep the remaining hardcoded backdrop/panel literals in the cmdk palette.

---

## 2026-07-07T09:55Z — auto/ltspice-parity — §10: dialog interactive states + cool the warm toast

### What I did
- Added `--scrim` (0.42) / `--scrim-strong` (0.62) cool-neutral black backdrop
  tokens and routed `.settings-backdrop` (→ `--scrim`), `.confirm-backdrop`
  (→ `--scrim-strong`), and `.settings-panel` bg (→ `--panel-2`) through them —
  killing `rgba(0,0,0,0.18)`, `rgba(0,0,0,0.42)`, `rgba(14,14,18,0.98)`.
- `.shell-toast` background warm-brown `rgba(18,14,10,0.96)` → cool graphite
  `--panel-2` (directive: no warm primary UI; the toast is the app's only
  notification surface and was the last warm-tinted chrome).
- `.confirm-actions button` (Cancel + destructive "Clear all") gained a spring
  hover-lift (`translateY(-1px)` + `--elev-1` over `--panel-4`), an `:active`
  settle, and a cobalt `:focus-visible` ring. The `.danger` variant gets a
  danger hover fill (`color-mix` 22% danger) + a **danger** focus ring.
- `.confirm-dialog header ×` and `.settings-panel header ×` gained hover/active/
  focus-visible states (previously static).

### Files touched
- apps/desktop/src/App.css

### Tests
1247 passing (82 files), 0 new — CSS-only; typecheck clean. No regression.

### FEATURE_PARITY items updated
- §10 "Panel migrations … → dialogs (Open/Save/settings)": dialog chrome
  interactive states + tokenization advanced (still 🟡 pending Open/Save sheets).

### UX issues found
- The Open/Save file sheets still use bespoke chrome not yet audited — next
  dialog-track candidate.

### Next step
Audit the Open/Save file-picker sheet chrome for the same dead-state /
hardcoded-color gaps, then the empty/error states panel.

---

## 2026-07-07T09:44Z — auto/ltspice-parity — §10: a11y focus rings on destructive × buttons

### What I did
- `.expr-remove` (remove-trace ×) and `.pane-remove-btn` (remove-pane ×) were
  borderless destructive buttons with an instant color swap, no transition, and
  crucially no `:focus-visible` ring — keyboard users got zero focus feedback on
  controls that delete plotted data.
- Added to both: a `--motion-fast`/`--spring` color transition, an `:active`
  press (opacity settle), and a rounded danger focus-visible ring (`--bg` 2px +
  `--danger-line` 4px). Added a small `border-radius` so the ring reads cleanly
  around the otherwise-borderless glyph.

### Files touched
- apps/desktop/src/App.css

### Tests
1247 passing (unchanged) — typecheck clean. CSS-only a11y polish.

### FEATURE_PARITY items updated
§10 accessibility (STEP 4 focus-ring requirement) — destructive plotter controls
now keyboard-focus-visible; motion consistent with the rest of the run bar.

### UX issues found
- Destructive × buttons were keyboard-invisible — fixed and screenshot +
  computed-style verified (focus box-shadow renders the danger ring at rest=none).

### Next step
Continue §10: sweep the remaining hover-only cursor-slider controls, then the
global typography+spacing pass on the 4pt scale called for in the §10 panel
order (kill one-off px font sizes/margins as each cluster migrates).

---

## 2026-07-07T09:28Z — auto/ltspice-parity — §10: plotter .pane-btn/.fft-toggle real pressed + focus states

### What I did
- Two live plotter buttons were stuck in hover-only limbo (no pressed settle, no
  focus-visible ring), inconsistent with their already-snapped siblings
  (`.expr-add`, `.plotter-icon-action`). `.fft-toggle` additionally had NO
  `transition` at all — an instant, un-sprung color swap.
- `.pane-btn` (small split-view chip): now spring hover-lift + `--elev-1` over an
  `--overlay-hover` fill on a stronger hairline, `:active` settle, cobalt
  `:focus-visible` ring.
- `.fft-toggle` (full-width FFT disclosure bar): `--overlay-hover` fill + brighten
  on hover — deliberately NO lift, since a full-width bar jumping looks wrong —
  plus `:active` faint fill and a focus ring with accent border. Added the
  missing `--motion-fast`/`--spring` transitions to both.

### Files touched
- apps/desktop/src/App.css

### Tests
1247 passing (unchanged) — typecheck clean. CSS-only interaction polish.

### FEATURE_PARITY items updated
§10 SimulationPanel controls — continued (dead interactive states burned down on
the pane + FFT controls; motion now consistent across the plotter).

### UX issues found
- `.fft-toggle` had no transition (janky instant swap) — fixed.
- Verified via screenshot: fft-toggle rest (muted bar) vs hover (brighter text +
  `--overlay-hover` fill + stronger border) visibly differ.

### Next step
Continue §10 SimulationPanel controls: audit `.expr-remove` (pane trace remove)
and the cursor-slider controls for the same hover-only pattern; then the global
typography+spacing pass called for in the §10 panel order.

---

## 2026-07-07T09:10Z — auto/ltspice-parity — §10: dedup status-bar CSS, drop wasteful backdrop-filter

### What I did
- Found and removed a duplicate `.statusbar` rule set (App.css had two: ~2066
  and ~3910, each with its own `.status-mode`/`.status-hints`/`.status-count`).
  The second block wins the cascade for shared properties, but the first leaked
  a `backdrop-filter: blur(18px) saturate(1.2)` onto a fully-opaque `--panel-3`
  bar — the compositor re-blurred it on every canvas pan/zoom for zero visual
  gain (a 60fps footgun per STEP 4's perf bar). Also leaked a `letter-spacing`
  and an unused `var(--sp-3)` gap.
- Deleted the first block's duplicate rules; relocated the two genuinely-live
  rules (`.status-hints kbd` / `.status-hints .dot` keycap chips) next to the
  real status-bar block, with a breadcrumb comment where the old block sat.

### Files touched
- apps/desktop/src/App.css

### Tests
1247 passing (unchanged) — typecheck clean. No new unit tests: pure CSS dedup.

### FEATURE_PARITY items updated
§10 "Sweep: delete dead App.css rules as panels migrate" — advanced (one
duplicate rule set removed; single source of truth for the status bar).

### UX issues found
- Wasteful backdrop-filter on the opaque status bar (perf) — removed.
- Verified NO visual regression via screenshot (bar identical: cobalt state dot,
  keycap chips, right-aligned count); computed `backdrop-filter` now `none`.

### Next step
Continue §10 SimulationPanel run bar / plotter-footer controls (`.plotter-footer`
~1991): audit expression/cursor/export controls for dead interactive states and
hardcoded colors — the last unmigrated run-bar cluster before the global
typography+spacing pass.

---

## 2026-07-07T08:52Z — auto/ltspice-parity — §10: run-bar live pill lights amber when running + dead-rule sweep

### What I did
- Gave the `.plotter-live` status pill (run bar, non-tran modes) a real active
  state: it was styled identically for "Ready" and "Running" — a dead indicator.
  Running now lights amber (the directive's tactical `--signal` active color):
  `--signal` text over `--signal-soft` fill on a `--signal-line` border, plus a
  pulsing live dot (`::before` + `@keyframes live-pulse`, `prefers-reduced-motion`
  guarded). Idle stays calm/muted. Pill text moved to `--font-mono`.
- SimulationPanel.tsx: added a `plotter-live--running` modifier gated on
  `isRunning`, plus `role="status"`/`aria-live="polite"` for screen readers.
- Added `--signal-line` / `--signal-glow` tokens to complete the signal family
  (parity with the danger/success families).
- SWEEP: deleted the dead `.plotter-stop` / `.plotter-pause` rules — grep proved
  neither class is rendered in any TSX (the real run-bar buttons are
  `.plotter-icon-action` and `.plotter-run`). This killed hardcoded `#f0aaa6`
  and `#edc08a` text colors plus 4 hardcoded `rgba(...)` fills/borders.

### Files touched
- apps/desktop/src/App.css
- apps/desktop/src/components/SimulationPanel.tsx

### Tests
1247 passing (unchanged, no regression) — typecheck clean. No new unit tests:
this is a CSS/markup design change verified by screenshot, not new logic.

### FEATURE_PARITY items updated
§10 "Sweep: delete dead App.css rules" — advanced (unique App.css hex 38→36);
§10 SimulationPanel run-bar polish — live-state indicator added.

### UX issues found
- The `.plotter-live` pill previously gave zero feedback that a sim was running
  in AC/DC/etc modes — fixed. (Screenshot-proven: muted "READY" → amber "●
  RUNNING" with live dot.)

### Next step
Continue §10 SimulationPanel run bar: audit the expression/cursor/export
controls (§10 checklist "SimulationPanel controls") for dead interactive states
and hardcoded colors; or migrate the status bar (bottom-of-window) which is
still unmigrated per the §10 panel-order list.

---

## 2026-07-07T06:40Z — auto/ltspice-parity — §8/§10: auto-frame circuit in the simulator canvas

### What I did
- Fixed a picky-reviewer eyesore caught in the STEP 3.5 1280×720 audit: in the
  simulator view the mini-schematic showed the circuit off-screen (only "V1 5V"
  floated at the left edge). Root cause: `App.tsx` mounts a single `<Canvas>`
  with `interactive={mode === "schematic"}`; its local pan/zoom persisted across
  the mode switch, so the wide-editor view left the circuit outside the narrow
  read-only column.
- Extracted a pure `circuitBounds(components, wires, margin=40)` helper (padded
  world bbox; null for empty), refactored `fitView` onto it (`useCallback`, now
  bails on a 0-size rect), and added a read-only-only effect that frames the
  circuit on mount-into-simulator and on every column resize (ResizeObserver).
  The interactive editor keeps the user's pan (early-return when interactive).

### Files touched
- apps/desktop/src/components/Canvas.tsx (circuitBounds export, fitView refactor, auto-fit effect)
- apps/desktop/src/components/Canvas.geometry.test.ts (6 new circuitBounds tests)

### Tests
1247 passing (was 1241, +6) — all green, typecheck clean.

### FEATURE_PARITY items updated
- §8 responsive-floor / §10 simulator-view framing: simulator canvas now
  auto-fits at the app's small/known-bad sizes.

### UX issues found
- (fixed) circuit off-screen in the simulator column. Screenshot-proven before
  (bare "V1 5V" at edge) vs after (full RC framed & centered) in both idle and
  post-Run states at 1280×720.

### Next step
- Continue §10 sweep: burn down the ~10 remaining non-`:root` hardcoded hex in
  App.css (near-black surfaces #060608/#08080a/#080a0f/#0b0b0e, wire #9eacbd)
  into named tokens for palette coherence.

---

## 2026-07-07T06:17Z — auto/ltspice-parity — review: CSS correctness pass + 4-screen UI/UX audit

### What I did
- **REVIEW SESSION** (rotation: 0 `review:` commits in the prior 30). No new
  features — correctness + UI/UX audit of the 33 §10 CSS/design commits since
  the last review (263a701..HEAD).
- **Correctness pass over App.css**: grep-diffed defined-vs-used CSS custom
  properties. Confirmed the 3 used-but-undefined tokens
  (`--ask-w`/`--scope-w`/`--fill`) are set via JS inline style (not bugs) and
  the 2 CSS-"unused" trace colors are consumed from JS palettes. Fixed real
  finds: 9 numeric readouts using a raw `"JetBrains Mono"` stack → `--font-mono`
  (SF-Mono-first); `.op-annotation`'s undefined `var(--mono,…)` → `--font-mono`
  (integrated the rescued `-wip` checkpoint); 2 stale "amber accent" comments.
- **UI/UX audit** with the STEP 3.5 pipeline: Read 4 screenshots — empty hero,
  loaded RC schematic, simulator idle, and simulator post-Run with live
  waveforms. Judged operator-grade / picky-Apple.
- **Found + fixed**: hotkey-less palette parts rendered an empty `<kbd>` keycap
  (stray dash in the rail) → conditional render.

### Files touched
- apps/desktop/src/App.css
- apps/desktop/src/components/Palette.tsx
- PROGRESS.md

### Tests
1241 passing (82 files), 0 new — no regression. typecheck clean.

### FEATURE_PARITY items updated
None flipped (review session — no feature scope). §10 quality reaffirmed.

### UX issues found
- Empty keycap box for hotkey-less palette parts (FIXED).
- Raw JetBrains-Mono stacks bypassing the SF-Mono-first token (FIXED).
- Undefined `--mono` token falling back off-brand (FIXED).
- Audit verdict on empty/schematic/simulator-idle/simulator-run screens: PASS —
  coherent operator-grade console, ships.

### Next step
Resume §10 feature track: dialogs (settings/open) depth+spring pass, then the
global typography+spacing sweep, then delete dead App.css rules (STEP 3 panel
order). Or advance §1 Comparator pin banks to unblock corpus warning-clean count.

---

## 2026-07-07T02:36Z — auto/ltspice-parity — §10: five dead-interactive-state fixes + hex burndown

### What I did
- **Segmented view toggle** (`.mode-btn`): the inactive "simulator" segment had
  NO hover — before-rest and before-hover crops were pixel-identical. Added a
  real `:not(.active):hover` (brighten to `--text`, `--overlay-hover` fill,
  spring `translateY(-0.5px)`) + `:active` settle + focus-visible ring; burned
  `#8a8a92`→`--muted`, `180ms/--ease-out`→`--motion-fast/--spring`, `.live-pill`
  "JetBrains Mono"→`--font-mono`.
- **Panel-header icon buttons** (`.plotter-icon-action`/`.plotter-close`/
  `.panel-close`): instant flat color swap → tokenized + spring
  `translateY(-1px)` lift with `--elev-1` + `--border-strong` hairline, `:active`
  settle, focus ring. After-hover crop: close × visibly lifts with a shadow.
- **Results panel** (`.result-list p`/`.result-row`): dim `#5a5a62` empty-state
  guidance → `--muted` (legible cool), readout `#8a8a92`→`--muted` +
  "JetBrains Mono"→`--font-mono`.
- **Param sliders** (`.param-slider` thumb): bare `#fff` dot → `--cream` thumb
  ringed in `--accent-line`, hover springs to scale(1.15) inside a 5px
  `--accent-glow` halo, `:active` + focus-visible cobalt ring.
- **Analysis tabs** (`.plotter-tab`): inactive OP/AC/DC/TF/NOISE/STEP had no
  hover → added `:not(.active):not(:disabled):hover` + spring transition.

### Files touched
apps/desktop/src/App.css · PROGRESS.md

### Tests
1241 passing (0 new — CSS-only) — passed. Typecheck clean each commit.

### FEATURE_PARITY items updated
§10 panel migrations — progressed segmented toggle + analysis tabs + sim-panel
controls (sliders, header icons, results); no checkbox flips (each panel still
has residual work) but all screenshot-proven visibly-different.

### UX issues found
Recurring: multiple prominent controls shipped with NO hover feedback (view
toggle, analysis tabs) — inert until clicked. All fixed this session. Remaining
`.plotter-stop`/`.plotter-pause` (running-sim-only) still hold hardcoded rgba
danger/amber — deferred (can't screenshot headless without a live sim).

### Next step
Continue §10: cool the warm-black surfaces (`.plotter` `#0b0b0e`, `.stage`
`#060608` chrome) to cool panel tokens with a whole-panel before/after, then
tokenize the stop/pause running-state buttons via a scripted live-sim capture.

---

## 2026-07-07T00:45Z — auto/ltspice-parity — §10: palette rows + 3 stale-amber/flat-button fixes

### What I did
- Recovered orientation: discarded rescued `-wip` (66c0868) — it was a banned
  amber-as-primary palette revert against the committed cobalt foundation
  (`1ba6c1d`); deleted the `-wip` ref. Baseline confirmed 1241 green.
- **Part-palette rows:** promoted the barely-legible 9px `--faint` hotkey glyphs
  to readable keycap chips (`--muted`/`--panel-4`/`--border-strong`, 10px,
  min-width) — visibly changes all ~20 rows at rest. Added a 3px inset operator
  targeting rail (hidden rest → `--accent-line` hover → solid `--accent` active)
  + spring motion + hotkey-brighten on hover.
- **Empty-state hero (stale-token BUG):** primary "Open RC example" filled cobalt
  but its glow ring + hover gradient were hardcoded AMBER — fixed to accent
  tokens; kicker → cobalt `--font-mono` version tag; card tokenized + `--elev-2`
  + cobalt top-edge hairline.
- **Analysis tabs (stale-token BUG):** active tab filled `#d68a3c` amber →
  `--accent`; `.plotter-tabs-inner`/`.plotter-title`/`.result-row` tokenized.
- **Run action:** flat `#71ab7e` green with a banned `opacity:0.88` dead fade →
  `--success` fill + `--elev-1`/ring/new `--success-glow` halo at rest, spring
  lift + brighten on hover, pressed settle, `:not(:disabled)`-guarded.

### Files touched
apps/desktop/src/App.css · PROGRESS.md

### Tests
1241 passing (82 files), typecheck clean — no regression, CSS-only changes.

### FEATURE_PARITY items updated
§10 panel migrations advancing; two migration-era stale-amber bugs fixed. Hex
burndown unique 55→43.

### UX issues found
Stale pre-cobalt amber literals still linger in the plotter chrome (pause button
amber = correct tactical semantic; `.plotter-icon-action:hover` `#efe9d6` cream,
`.scope-svg`/`.op-table` `#060608` bg = hygiene, not bugs) — next tokenization pass.

### Next step
Continue §10: tokenize remaining `.plotter-*` chrome (run/stop ink literals,
`.scope-svg`/`.op-table` `#060608`) and route pause to `--signal`, then the
global type+spacing pass and dead-rule sweep.

### Verdict
4 commits, each with before/after crops Read + compared: keycaps dim→legible,
primary button amber→cobalt, active tab amber→cobalt, Run flat→brighter+halo.
All visibly differ — none pixel-neutral.

---

## 2026-07-06T20:00Z — auto/ltspice-parity — §10: scope/plots + status bar + left rail (3 panels)

### What I did
- **Recovered orient:** the `-wip` sibling (02d00a3) was the already-discarded
  banned teal/Space-Grotesk revert (current HEAD's log documents discarding it);
  deleted the stale `origin/…-wip` ref, kept HEAD.
- **Scope/plots panel:** action-row hierarchy (`.expr-add`) — one solid-amber
  PRIMARY "Add trace" vs. neutral graphite ghost export utilities, all with
  `--elev-1`/spring-lift/pressed/focus-ring; `.scope-svg` instrument depth via
  new `--elev-inset` vignette token + `--elev-2` lift; legend names → `--font-mono`.
- **Status bar:** tokenized the shipping override block, recolored to the current
  palette (brighter accent/green), routed the defeated "JetBrains Mono" → SF Mono,
  added a live-dot halo.
- **Left activity rail:** tokenized, recolored active state to brighter accent,
  added spring motion (icon hover-scale/press) + active-pill glow.

### Files touched
- apps/desktop/src/App.css
- apps/desktop/src/components/SimulationPanel.tsx (`primary` class on Add trace)

### Tests
1241 passing (0 new — pure CSS + one className) — passed. Typecheck clean.

### FEATURE_PARITY items updated
§10 panel-migration sequence: scope/plots ✅, status bar ✅, left rail ✅ (all
screenshot-proven visibly-different). Burndown: unique hex 56→55, literals 249→240.

### UX issues found
None blocking. Remaining hardcoded-color clusters: the "DESIGN HANDOFF MIGRATION"
block still has 24 defeated "JetBrains Mono" refs + `#d68a3c`(11)/`#d9d4c2`(11)/
`#6b6b73`(9)/`#08080a`/`#efe9d6` across ask-panel, bottom-output/errors, explorer.

### Next step
Continue the §10 sequence — dialogs and empty/error states, or the Ask Sim /
bottom-output panel (biggest remaining hardcoded-color + defeated-font cluster).

---

## 2026-07-06T18:45Z — auto/ltspice-parity — §10: fix 10 defeated-mono readout font stacks

### What I did
- Found 10 numeric/keycap readouts (`.palette-key`, `.component .val`,
  `.value-edit-input`, `.scope-axis`, `.op-row` values, `.meas-value`,
  `.value-editor input`, `.engineering-input input`, `.status-hints kbd`,
  `.cmdk-key`) whose font stack listed `-apple-system, BlinkMacSystemFont,
  "SF Mono", …` — with `-apple-system` FIRST, macOS resolved it and the mono
  intent was silently defeated: every one rendered PROPORTIONAL, not monospace.
- Routed all 10 to `var(--font-mono)` (mono-first), so numeric values now render
  as true tabular monospace (op-point tables, .meas readouts, engineering inputs,
  axis labels, hotkey caps). Real font change + burndown of a repeated stack.

### Files touched
- apps/desktop/src/App.css

### Tests
1241 passing, 0 new. typecheck clean.

### Visual proof
`grep -cE 'apple-system[^;]*SF Mono'` == 0. Confirmed a visible pixel diff in the
simulator view (full-screenshot sha256 changed before→after). The font actually
resolves differently now — not a token no-op.

### FEATURE_PARITY items updated
§10 typography — numeric readouts now correctly monospace per the "numeric values
use --font-mono" rule. Burndown: unique hex 150→56, color literals 293→249.

### Next step
Continue §10: per-panel visible upgrades (scope/plots depth, dialogs, empty/error
states, status bar) + drive remaining 56 hex / 249 color literals toward zero.

---

## 2026-07-06T18:30Z — auto/ltspice-parity — §10: consolidate two :root blocks into one foundation

### What I did
- §10 foundation rule mandates ONE `:root`; App.css carried two (stale teal
  palette at line 2, shadowed by the premium graphite+amber palette in the
  DESIGN HANDOFF block). They only partially overlapped — top uniquely owned
  radii/spacing/easing/overlay tokens, bottom uniquely owned fonts/motion/
  elevation — so neither could be naively deleted.
- Merged the union into the single top `:root` (bottom values win for every
  color/font token, exactly as the cascade already resolved), deleted block two.

### Files touched
- apps/desktop/src/App.css

### Tests
1241 passing, 0 new. typecheck clean.

### Visual proof
before/after screenshots of the empty state AND the amplifier simulator view are
**byte-for-byte identical (same sha256)** — pure structural consolidation, zero
visual change. `grep "^:root"` now returns 1.

### FEATURE_PARITY items updated
§10 foundation ("one :root, no Space Grotesk") — now satisfied.

### Next step
Continue the §10 hardcoded-color burndown (283 literals remain in App.css) and
the per-panel visible upgrades (scope/plots, dialogs, empty/error states).

---

## 2026-07-06T18:15Z — auto/ltspice-parity — §10: remove dead Space Grotesk font refs

### What I did
- Removed 7 stray `"Space Grotesk"` font-family refs (banned by the §10
  foundation rule), routing `.mode-btn` / `.example-picker select` /
  `.editor-hide` / `.ask-composer input` / `.settings-list button` /
  `.confirm-actions button` / `.shell-toast` onto `var(--font-ui)`.
- Discovered Space Grotesk was never actually loaded (no @font-face / web-font
  import anywhere), so this is cosmetically invisible — committed honestly as
  banned-reference hygiene, NOT a design-progress claim.

### Files touched
- apps/desktop/src/App.css

### Tests
1241 passing, 0 new.

### Visual proof
before/after crops of the mode toggle + Ask Sim composer pixel-identical (font
already resolved to the SF Pro fallback). `grep "Space Grotesk"` returns 0.

### Next step
Consolidate the two :root blocks (done next commit).

---

## 2026-07-06T18:05Z — auto/ltspice-parity — §10: SimulationPanel run-bar / resolution-control real upgrade

### What I did
- Resumed the in-flight claimed unit (heartbeat was IN PROGRESS on the run-bar
  migration). Inspected the rescued `origin/auto/ltspice-parity-wip` (02d00a3):
  it was a sibling of HEAD that *reverted* the premium palette back to the old
  amber + Space Grotesk foundation and stripped `.empty-actions` depth/motion —
  banned by §10. **Discarded it**; kept only the good idea (the run-bar
  tokenization) and redid it properly on top of the premium palette.
- Did it as a REAL visible design upgrade, not a pixel-neutral token shuffle:
  - Added `--success` / `--success-soft` / `--success-line` / `--danger-line`
    tokens to BOTH `:root` blocks with each block's own correct palette values
    (winning root ties `--success` to premium `--trace-green` `#58cc8a`).
  - `.resolution-control.ready` / `.warning` now carry a 2px inset status accent
    bar + a soft status wash (`--success-soft` / `--accent-soft`) so the two
    states read at a glance, and the mono readout takes the status color.
  - `.resolution-control strong` readout moved onto `--font-mono` at 12.5px.
  - Run-bar button gained resting depth (`--elev-1`), spring hover-lift
    (`translateY(-1px)` + `--elev-2` + `color-mix` brighten), pressed reset, and
    a `:focus-visible` accent ring; label is now uppercase tracked.
  - Burned down 5 hardcoded literals to tokens: the button's
    `rgba(214,138,60,.5)` / `#f3c38d` / `#9eb7a2`, `.analysis-empty`'s
    `rgba(240,64,96,.28)`, and the `.bottom-errors` amber/green border+text pair.

### Files touched
- apps/desktop/src/App.css

### Tests
1241 passing (82 files), 0 new — no regression. typecheck clean.

### Visual proof (STEP 3.5)
Loaded "Non-inverting Amplifier" (1 kHz vac) → simulator TRAN → resolution-control
resolves to the `ready` state. Before/after crops Read + compared:
- **Before:** plain green hairline border, white "40 samples / cycle" readout,
  sentence-case flat "Resolved" button.
- **After:** 2px inset green accent bar + green status wash, green `--font-mono`
  readout, uppercase "RESOLVED" chip with success-token styling.
Unambiguously different — passes the §10 "must visibly differ" bar.

### FEATURE_PARITY items updated
§10 run-bar / resolution-control panel — migrated (🟡 in-progress track).

### UX issues found
- Two `:root` blocks + 7 stray "Space Grotesk" font refs still violate the §10
  foundation rule ("one :root, no Space Grotesk"). Next dedicated cleanup.

### Next step
Consolidate the two `:root` blocks into one and replace remaining Space Grotesk
font stacks with `--font-ui`, screenshot-proving the type change.

---

## 2026-07-06T05:50Z — auto/ltspice-parity — review: 35-commit correctness pass + 3-screen UI/UX audit

### What I did
- **Review rotation session** (0 `review:` commits in last 30). No features.
- **Correctness diff review** of 6ee3466..5095d11 (35 commits, +3350 lines
  across engine/io/simulation): the §1 generic-subckt X-device wave (bundled
  library inlining, BJT-value-names-a-subckt → X rewrite, subckt instance
  emission with SpiceOrder p1..pN pins), sampleHold + modulator behavioral
  A-devices, `transformLtPoint` rotate-then-mirror fix, diode informational-
  param strip, multiline-TEXT per-line keyword dispatch, current-source
  polarity, and the §10 token migrations.
- **Hand-verified** the correctness-critical spots rather than trusting green:
  - `transformLtPoint`: derived all 8 orientations from "rotate-by-n THEN
    mirror-across-vertical-axis"; M0/M90/M180/M270 each match the new code.
    The old mirror-then-rotate agreed only for M0/M180 and silently sign-
    flipped M90/M270 (the LoopGain2 "shorted VSRC" / P2 floating-cap bugs).
  - `spec.vt` always defaults to `(vhigh+vlow)/2` = 0.5, so the sampleHold /
    modulator threshold comparisons never interpolate `undefined` into a deck.
  - `sanitizeSubcktName` is applied at every X-line emission (instance branch +
    bundled `.subckt` headers); the BJT→X rewrite name is dash-free so its
    un-sanitized emission is safe.
  - `netPinCount` labelCount fix: a single-pin net carrying a bare net-label
    now counts as a 2-endpoint (connected) net — matches the LTspice
    probe-through-a-flag idiom; the floating-pin warning still fires for
    genuinely unlabelled singletons.
- **UI/UX screenshot audit** (STEP 3.5 pipeline, 1440×900): empty state
  ("Build, wire, run." card), loaded RC example (V1/R1/C1 rendered crisp with
  wires + ground), and the simulator scope (TRAN/OP/AC/DC/TF/NOISE/STEP tabs,
  labelled axes, NETS/NODES/SAMPLES readout, STOP/STEPS sliders, per-column
  empty-state guidance, Ask-Sim board summary). All coherent under the amber
  token system, dense, no overlap/clipping.

### Files touched
- PROGRESS.md (verdict only — no code changed, nothing to fix)

### Tests
1241 passing (0 new) — full suite green, typecheck clean. Baseline held.

### FEATURE_PARITY items updated
None (review session).

### UX issues found
None blocking. The three audited screens meet the product bar. (Simulator
with-results state wasn't captured — the screenshot harness's play-button
click opened the Ask-Sim agent panel instead; not a product defect. Worth a
scripted with-results capture next review.)

### Verdict
**Clean. No correctness bugs, no regressions, UI/UX bar met.** Quality has not
eroded across the last 35 commits.

### Next step
Resume features: §10 SimulationPanel controls (run bar / expression bar /
cursors / export) — tokenize incrementally, fresh session.

---

## 2026-07-06T02:07Z — auto/ltspice-parity — §10: analysis-tabs header + shared kicker-label token

### What I did
- Tokenized the bottom panel's tab row (`component`/`output`/`errors`):
  inactive `--muted`, active `--text` on an `--overlay-hover` pill.
- Tokenized the shared uppercase kicker-label rule (`#5a5a62`→`--faint`) that
  drives every panel's small caps label (palette head, table head, plotter
  kicker, result-list `h3`, symbol-preview) — one edit, re-themes them all.

### Files touched
- apps/desktop/src/App.css

### Tests
1241 passing (82 files), 0 new — CSS-only; typecheck clean.

### FEATURE_PARITY items updated
- §10 panel-migration sequence: analysis-tabs header ✅. Next: SimulationPanel
  controls (run bar, expression bar, cursors, export).

### UX issues found
- None new.

### Next step
Migrate the §10 SimulationPanel controls (run bar / expression bar / cursors /
export) onto the token layer; same tokenize-then-screenshot rhythm.

### What I did
- Migrated the component inspector (bottom-left "component" tab) onto the token
  layer. Tokenized `.inspector-summary strong/span` and every `.property-field`
  rule: cream title, muted secondary text, `--panel-3` input fields,
  `--border-strong` input borders, and the focus ring onto `--accent` +
  `--accent-soft` (unified with the already-tokenized `.engineering-input`).
- Base `.engineering-input` was already token-driven; only the inspector's
  `.property-field` overrides carried hardcoded hex, so the change is contained.

### Files touched
- apps/desktop/src/App.css (inspector block ~2982–3083)

### Tests
1241 passing (82 files), 0 new — CSS-only; typecheck clean.

### FEATURE_PARITY items updated
- §10 panel-migration sequence: inspector/params ✅ (part palette done in the
  prior commit); next is the analysis-tabs header.

### UX issues found
- None new. (Palette two-block UX debt from the prior entry still stands.)

### Next step
Migrate the §10 analysis-tabs header (component/output/errors tab row) onto the
token layer + Tabs primitive; same tokenize-then-screenshot rhythm.

### What I did
- Resumed Unit 8 (prior session died right after the claim commit, no code
  written — heartbeat said "just claimed"). Finished it.
- Discovered the palette is styled by two stacked rule sets: the base
  `.palette-*` block (older teal-theme geometry) and a later "DESIGN HANDOFF
  MIGRATION" override block that is what actually ships (amber shell). The
  override block held all the live hardcoded colors, so the real tokenization
  had to land there — the base block's colors were dead under the active theme.
- Tokenized every active palette color: panel/panel-3/text/faint surfaces and
  the one-off cyan selection (`rgba(91,147,201,.22)` == `--trace-cyan`) now go
  through `var(--…)`, so the runtime theme switcher re-themes the whole panel.
- Added three tokens to both `:root` theme blocks / the neutral block:
  `--accent-line` (accent hairline @ ~.22–.32 for selected borders/badges),
  `--overlay-hover` + `--overlay-hover-faint` (theme-neutral white hover films).
- Unified the active-item selection onto the accent system (was a bespoke blue):
  `--accent-soft` fill, `--accent` name, accent hotkey badge — matches every
  other selected control in the shell.
- Converted the search magnifier from a data-URI with a baked `#667080` stroke
  to a CSS-mask `::before` colored by `--muted` (icon now re-themes too), with a
  geometry override for the 32px migration-shell field vs the denser base field.
- Removed dead `.palette-head button`/`.palette-head div`/`:hover` rules (the
  markup renders only a `<span>`; these carried the last stray hexes).

### Files touched
- apps/desktop/src/App.css

### Tests
1241 passing (82 files), 0 new — CSS-only change; typecheck clean.

### FEATURE_PARITY items updated
- §10 visual design system: part-palette panel migrated to the token layer
  (🟡 in progress — panels landing one per session).

### UX issues found
- The palette is styled by two stacked blocks (base teal geometry + amber
  migration override). Live for now but a future §10 pass should collapse them
  into one token-driven rule set once every theme is switcher-driven, so a
  single `::before`/geometry set is not duplicated per theme. Logged as UX debt.

### Next step
Migrate the next §10 panel (component inspector / parameter form, bottom-left)
onto the token layer + primitives; same tokenize-then-screenshot rhythm.

### What I did
- Root-caused logamp's ngspice op timeout: not a convergence-aid problem —
  **every imported current source ran backwards**. LTspice's current.asy has
  N+ at (0,0) and the arrow toward `−` (0,80); LTspice netlists `I N+ N−`
  (current exits `−`). Tau's isource deck emission swaps to `I n p`, so the
  identity pin zip reversed the sign. logamp's I1 (M180) pulled its 100µA
  bias OUT of n003 → the node floated to −2.6e4 V through rshunt and
  `.op` hung in gmin stepping.
- Fix: `LTSPICE_PINS.current` zips `−`→p / `+`→n; `bi` (behavioral current,
  emitted `B p n` verbatim — no swap) keeps the identity zip via a new
  `bcurrent` row.
- End-to-end regression test: minimal `.asc` import → deck must carry
  LTspice's own `I1 <top> <bottom>` node order.
- Verified logamp solves instantly with the physically correct bias
  (V(out)=1.95 V, n003 = Vbe above the opamp output); corpus floors raised to
  82/79/82/**82** — every corpus file now op-converges. Class-D + sample-hold
  numerical parity specs unaffected (green).

### Files touched
io/ascImport.ts(+test), scripts/acceptanceCorpus.corpus.ts, PROGRESS.md,
FEATURE_PARITY.md

### Tests
1241 passing (1 new) — green; typecheck clean; corpus 82/82/79/82/82.

### FEATURE_PARITY items updated
§1 op-run row: 81→82 (ALL). Op-convergence across the corpus is complete.

### UX issues found
none (engine-only unit)

### Next step
Warning-clean 79→≥80 (DoD gate): the misc\nigbt and POWERPRODUCTS\LT1184F
symbols, or PLL2's stateful PHIDET A-device; alternatively next §10 panel
migration (sidebar/component panel) — check review rotation first.

---

## 2026-07-05T21:30Z — auto/ltspice-parity — §1: multiline-TEXT directive parity, corpus op 78→81

### What I did
- **Recovered the killed session's checkpoint** (`2d2c34a` on the wip ref):
  per-line dispatch in `modelLibLinesFromDirectives`, `+` folding in
  `expandDirectiveLines`, `transformLtPoint` Mn = rotate-then-mirror. Verified
  (typecheck clean, suite green, corpus 78→79) and finished the unit.
- **`type=silicon` strip**: LTspice diode models carry word-valued
  informational params (`type=`, `mfg=`) that ngspice evaluates as expressions
  and dies on ("Undefined parameter [silicon]", P2.asc). Stripped on
  `.model … D(…)` passthrough lines only; numeric informational params left
  alone (they only warn).
- **Q-on-subckt → X rewrite**: LTspice lets a BJT's Value name a `.subckt`
  (UHFpreamp's MRF901 macromodel) and silently netlists it as an X instance
  with the same C-B-E node order; ngspice's Q line fails with "could not find
  a valid modelname". New `definedSubcktNames()`; npn/pnp emission checks
  document + inlined-bundled subckt names.
- Corpus floors raised 82/79/82/78 → 82/79/82/**81** in
  acceptanceCorpus.corpus.ts; both fixed decks verified directly with
  `ngspice -b` (clean op solve).

### Files touched
engine/modelDirectives.ts(+test), engine/spiceNetlist.ts(+test),
simulation/paramScope.ts(+test), io/ascImport.ts,
scripts/acceptanceCorpus.corpus.ts, PROGRESS.md

### Tests
1240 passing (13 new) — green twice consecutively; typecheck clean; corpus
82/82 imported, 79 warning-clean, 82 deck-built, 81 op-converged.

### FEATURE_PARITY items updated
§1 corpus row refreshed (op-converged 78→81; only logamp timeout remains).

### UX issues found
none (engine-only unit)

### Next step
Root-cause logamp.asc's ngspice op timeout (last non-converging corpus file) —
likely the bundled opamp.sub macromodel oscillating in the log feedback loop;
try .options itl1 bump or gmin stepping on that deck.

---

## 2026-07-05T16:05Z — auto/ltspice-parity — §10: toolbar/topbar migrated onto the design system

### What I did
- **Recovered the killed session's work**: previous run died mid-unit; its
  checkpoint was on `origin/auto/ltspice-parity-wip` (cf67322). Cherry-picked,
  verified typecheck-clean, and finished the unit instead of restarting.
- **Buttons → primitive** (from checkpoint): the ▶ run button and settings
  gear in `Toolbar.tsx` now use `ui/button.tsx` (`variant="outline"`, new
  `icon-sm` = 28px size, matching the old footprint exactly); svg styling
  moved to utility classes; `[-webkit-app-region:no-drag]` kept.
- **New `--color-success` token** in tokens.css (maps `--trace-green`) so
  `text-success` exists for run/positive states.
- **Tokenized the whole topbar CSS block** (this session): `.toolbar`
  background → `--panel-2`, `.brand-name` → `--cream`, `.brand-file` →
  `--faint`, `.mode-toggle` → `--panel-3`/`--border-strong`,
  `.mode-btn.active` → `--accent`/`--accent-ink`/`--accent-glow`,
  `.live-pill` → `--accent` (edit) / `--trace-green` (sim). The topbar now
  follows the runtime theme switcher instead of pinning `#d68a3c`.
- **Deleted dead CSS**: `.title-run`/`.settings-btn` rules (no TSX refs left).

### Files touched
components/Toolbar.tsx, components/ui/button.tsx, styles/tokens.css, App.css,
FEATURE_PARITY.md, PROGRESS.md

### Tests
1227 passing — all green, typecheck clean (no new tests: CSS/markup-only
migration; Button primitive already has coverage)

### FEATURE_PARITY items updated
§10 Panel migrations ⬜→🟡 (toolbar/topbar ✅, 7 panels remaining)

### UX issues found
Screenshot at 1440×900: topbar aligned, no clipping, run button reads clearly
green, live pill accent-orange in edit mode. None outstanding.

### Next step
Next §10 panel: part palette (ComponentPalette) onto Input (filter box) +
tokenized list rows; or resume §1 with the 4 remaining op-converge failures
(LoopGain2, P2, SoftDiodeRecovery, UHFpreamp).

## 2026-07-05T12:55Z — auto/ltspice-parity — §1: {param} substitution on passthrough .model lines — Fc converges, op-run 77→78

### What I did
- **Root-caused Fc.asc**: the deck carried `.model DX D(Cjo={Cjo} …)`
  verbatim while the document's `.params Cjo=930p …` were consumed into
  Tau's param scope and never emitted — ngspice died with "Undefined
  parameter [cjo]".
- **Added `substituteKnownBraces`** (simulation/paramScope.ts): substitutes
  every `{expr}` resolvable in the scope, keeps unresolvable braces
  VERBATIM (unlike the throwing `substituteBraces`) — matches LTspice, which
  evaluates `{…}` against global `.param`s anywhere in the netlist.
- **Applied it in spiceNetlist.ts** to passthrough model/lib lines while
  tracking `.subckt…/.ends` depth: braces inside a document-defined subckt
  body stay untouched for ngspice's own subckt-param scoping.
- Verified: rebuilt Fc deck shows `.model DX D(Is=0 Cjo=9.3e-10 m=0.75
  vj=1.2 Fc=0 tt=.5u)`, ngspice runs clean; corpus 78/82, no regressions.

### Files touched
simulation/paramScope.ts + .test.ts, engine/spiceNetlist.ts + .test.ts,
scripts/acceptanceCorpus.corpus.ts (floor 77→78), FEATURE_PARITY.md,
PROGRESS.md

### Tests
1227 passing (+5 new) + 5 corpus specs — all green, typecheck clean

### FEATURE_PARITY items updated
§1 op-deck-run item 77/82 → 78/82 (4 remaining: LoopGain2, P2,
SoftDiodeRecovery, UHFpreamp); footer updated

### UX issues found
none (no UI change)

### Next step
§10 interleave is due this session: migrate the next editor panel onto the
shadcn Button/primitive layer with screenshot QA.

---

## 2026-07-05T12:40Z — auto/ltspice-parity — §1/§7: default rseries=1mΩ — Cohn/passive/varactor2 converge, op-run 74→77

### What I did
- **Added `rseries: "1e-3"` to `DEFAULT_OPTIONS`** (engine/spiceOptions.ts).
  This is LTspice's own documented default (every inductor without an
  explicit Rser gets 1 mΩ; Control Panel → Hacks), so it is simultaneously
  the convergence fix and the parity-faithful choice. A pure-inductor loop
  (Cohn's L2/L3+L4/L6) has an indeterminate DC current split; ngspice's op
  throws "singular matrix: check node lN#branch" where LTspice solves.
- Live-verified semantics first: `rseries=1e-3` adds exactly 1 mΩ per
  inductor (V-across-L probe → 1000 A branch current), then all three
  failing decks solved; full corpus re-run showed zero regressions and the
  Class-D/sample-hold parity specs stayed green.
- Documents can override (`.options rseries=0` wins over the default) —
  covered by a new test.

### Files touched
engine/spiceOptions.ts + .test.ts, scripts/acceptanceCorpus.corpus.ts
(floor 74→77), FEATURE_PARITY.md, PROGRESS.md

### Tests
1222 passing (+1 new) + 5 corpus specs — all green, typecheck clean

### FEATURE_PARITY items updated
§1 op-deck-run item 74/82 → 77/82 (5 remaining: Fc, LoopGain2, P2,
SoftDiodeRecovery, UHFpreamp); footer updated

### UX issues found
none (no UI change). Pre-existing gap noted: imported inductors DROP an
explicit `Rser=` (ascImport filters it; ngspice L has no rser instance
param) — should expand to a series resistor like the crystal BVD path.

### Next step
§10 interleave: migrate the next panel to the shadcn Button/primitive layer,
or attack Fc.asc's `{param}`-inside-`.model` deck passthrough.

---

## 2026-07-05T12:25Z — auto/ltspice-parity — §1: bundled opamp.sub — opamp.asc/logamp.asc converge, op-run 72→74

### What I did
- **Bundled LTspice's ideal single-pole `opamp.sub`** in
  `engine/bundledSubcircuits.ts` (verbatim body; the Aol=100K/GBW=10Meg
  defaults move from the .asy SpiceLines onto the `.subckt` line because
  ngspice rejects undeclared X-line params — live-verified with a unity
  follower (2.000 V) and a −10× inverting amp (−5.000 V from 0.5 V), both
  with and without X-line params).
- **Mapped `Opamps\opamp` → `subckt` kind** (leaf gate ahead of the
  directory-wide behavioral-opamp rule; vendor parts unaffected — corpus
  scan shows only opamp.asc/logamp.asc use this symbol). New `opampIdeal`
  pin bank in SpiceOrder: 1=invin(−32,48), 2=noninvin(−32,80), 3=out(32,64)
  — NOTE this is inverting-input-FIRST, opposite of the opampO role bank;
  fetched authoritative opamp.asy/opamp.sub to pin this down rather than
  trusting geometry-family assumptions.
- Corpus floors raised 72→74 op-converged; census test 30→31 blocks.

### Files touched
engine/bundledSubcircuits.ts + .test.ts, io/ascImport.ts + .test.ts,
scripts/acceptanceCorpus.corpus.ts, FEATURE_PARITY.md, PROGRESS.md

### Tests
1221 passing (+2 new) + 5 corpus specs — all green, typecheck clean

### FEATURE_PARITY items updated
§1 op-deck-run item 72/82 → 74/82; footer updated (remaining: PHIDET,
nigbt/LT1184F for warning-clean; Cohn/passive/varactor2 L-loop singulars
for op-run)

### UX issues found
UX debt: the ideal opamp now renders as the generic subckt box instead of a
triangle glyph in opamp.asc/logamp.asc — consider a triangle glyph when the
subckt value is `opamp`.

### Next step
Either the 3 inductor-loop singular matrices (Cohn/passive/varactor2 — likely
need ngspice `.options` or a gmin/rser strategy for L-only loops) or a §10
panel migration per the interleave rhythm.

---

## 2026-07-05T12:10Z — auto/ltspice-parity — §1: library-subcircuit Prefix X path (recovered + finished)

### What I did
- **Recovered the previous session's rescued checkpoint** (`f6fba33` on
  `auto/ltspice-parity-wip`, session killed mid-unit at 09:59Z) via
  `cherry-pick --no-commit`, then re-verified everything before committing.
- **New `subckt` component kind + bundled-library path**:
  `engine/bundledSubcircuits.ts` embeds 4 LTspice libs pre-sanitized
  (dash→underscore subckt names — dashes are fatal to ngspice; capometer
  `Rpar` → plain resistor, `if()` → ternary, `µ` → `u`). `io/ascImport.ts`
  maps MISC\TowTom2, capmeter, ISO16750-2, ISO7637-2 leaf symbols to
  subcircuit instances with real pin banks; `engine/spiceNetlist.ts` emits
  X-lines and expands bundled blocks/includes; catalog/pins/symbols/types
  wired for the new kind.

### Files touched
engine/bundledSubcircuits.ts (NEW) + .test.ts (NEW, 240 lines),
io/ascImport.ts + .test.ts, engine/spiceNetlist.ts,
schematic/{catalog,pins,symbols,types}, scripts/acceptanceCorpus.corpus.ts
(floors 75→79, 69→72), FEATURE_PARITY.md, PROGRESS.md

### Tests
1219 passing (was 1195, +24 new) + 5 corpus specs — all green, typecheck clean

### FEATURE_PARITY items updated
§1 op-deck-run item: ~70/82 → 72/82 with bundled-subckt note; footer updated
(next: opamp.sub, PHIDET, nigbt/LT1184F)

### UX issues found
none (no UI change)

### Next step
Bundle Educational `opamp.sub` via the same bundledSubcircuits path so
opamp.asc/logamp.asc resolve their `.include` — op-converged 72→74.

---

## 2026-07-04T18:45Z — auto/ltspice-parity — §10: Button primitive + editor document buttons migrated

### What I did
- **First shadcn core primitive landed**: `components/ui/button.tsx`
  (new-york style via cva; +class-variance-authority +@radix-ui/react-slot).
  All color routes through the §10 token layer so it re-themes with the
  runtime theme switcher. The base string carries its own UA resets
  (`appearance-none`, explicit border, `[font-family:inherit]`) because
  preflight is deliberately not imported (tokens.css). Dense sizes: sm =
  28px row height per the §10 density rule.
- **First adoption**: the 4 document buttons in ShellPanels.tsx
  (New/Open/Save/Save .asc) → `<Button variant="outline" size="sm">`;
  their old `.editor-text-btn` CSS (hardcoded `#08080a` + white alphas)
  deleted; `.editor-doc-btn` kept only as the simulator-mode visibility
  marker. `.example-picker select` (still native until the Select
  primitive) had its hardcoded colors swapped to `var(--bg)`/
  `var(--border)`/`var(--panel-4)` in passing.
- **Verified**: DOM probe shows all 4 rendering via the primitive at
  exactly 28px with correct disabled states; simulator mode still hides
  them; before/after screenshots at 1440×900 visually equivalent.

### Files touched
components/ui/button.tsx (NEW), components/ShellPanels.tsx, App.css,
package.json (+2 deps), PROGRESS.md, FEATURE_PARITY.md

### Tests
1195 passing (UI-only change; suite re-run green). Typecheck clean.

### FEATURE_PARITY items updated
§10 "Core primitives adopted" → 🟡 (Button in; Input/Select/Tabs/… remain).

### UX issues found
None — the migration is pixel-faithful by design (token values match the
old hardcoded ones).

### Next step
Next §10 primitive (Input or Select — the example-picker select is the
natural Select adoption) or the library-subcircuit Prefix X import path.

---

## 2026-07-04T18:20Z — auto/ltspice-parity — rand()/random()/white() B-source surrogate (op-converged 67→69)

### What I did
- **`statFuncsToNgspice` in `simulation/behavioral.ts`**: rewrites LTspice's
  statistical functions in B-source expressions — ngspice has no `rand()`
  ("no such function 'rand'", the exact failure PLL.asc/PLL2.asc hit after
  the modulator unit). Surrogate = the classic uniform hash
  `frac(sin(floor(x))*43758.5453)`: a fresh deterministic [0,1) value each
  time floor(x) increments, which is LTspice's `rand(x)` semantics
  (PLL's `V=rand(time*500) >= .5` is a 500-baud random NRZ stream — the
  surrogate reproduces the distribution; LTspice's exact seed isn't stable
  across its own versions anyway). `random()` keeps the stepped surrogate
  (its smoothing is cosmetic); `white()` maps zero-mean to [-0.5,0.5).
  Word-boundary + 1-arg gated (`mybrand(...)`/multi-arg left verbatim);
  recursive like `ifToTernary`; wired into `behavioralSpecText`.
- **Live ngspice proof** before coding: surrogate measured vmax 0.9935 /
  vmin 0 / mean 0.546 over 150 bit periods at 500 baud; the `>= .5` bit
  stream toggles correctly.
- **Corpus floors raised** to measured 82/75/82/**69** — PLL.asc and
  PLL2.asc `.op` both converge now.

### Files touched
simulation/behavioral.ts(+test), scripts/acceptanceCorpus.corpus.ts,
PROGRESS.md, FEATURE_PARITY.md

### Tests
1195 passing (+7 new statFuncsToNgspice specs) + 5 corpus specs green.
Typecheck clean. NOTE: one transient failure (1194/1195) observed once
between two consecutive clean runs — not reproducible; flagged for watch.

### FEATURE_PARITY items updated
§1 NEXT list: `rand()` mapping done; remaining are counter/srflop, PHIDET,
and the library-subcircuit Prefix X path.

### UX issues found
None (no UI change).

### Next step
Library-subcircuit `.asy` Prefix X path (TowTom2/capmeter/ISO16750-2/
ISO7637-2 — 4 warning-clean files) or the next §10 panel migration.

---

## 2026-07-04T18:00Z — auto/ltspice-parity — modulator kind: SpecialFunctions\MODULATE as a behavioral VCO (74→75 warning-clean)

### What I did
- **Resumed the killed session's unit** (heartbeat protocol): the rescued
  `engine/modulatorSpec.ts` (+10 tests) was already cherry-picked at f27a0bd;
  the stale `-wip` ref (strictly older) was discarded and deleted.
- **Wired `modulator` end-to-end**: new ComponentKind; native pin bank
  (FM/AM left, Q right, com below); nose-box + sine-wave glyph;
  "Modulator (VCO)" catalog entry under Analog (default `mark=1K space=1K`
  so a bare placement oscillates at 1 kHz with FM unwired).
- **Importer**: `SpecialFunctions\modulate` (path-gated) → `modulator` with
  the id-mapped `.asy` pin bank (FM=1, AM=2, Q=7, com=8 @ (0,0)/(0,64)/
  (144,32)/(0,96)); A-device params joined across Value/Value2/SpiceLine;
  export maps back to `SpecialFunctions\\modulate`. `modulate2` (SIN/COS)
  stays on the skip path — XSPICE `sine` has no phase control, not in corpus.
- **Emitter**: XSPICE `sine` controlled oscillator (`cntl_array=[0 1]
  freq_array=[space mark]` = LTspice's linear FM law) with B-source buffers
  for the com reference and AM scaling. Live ngspice check: FM=0.5 V with
  mark=2K/space=1K measured exactly 1.5000 kHz (zero-crossing .meas).
- **Corpus floors raised** to measured 82/75/82/67 — PLL.asc is now
  warning-clean; its `.op` still fails on LTspice's `rand()` in a B-source
  (logged as a follow-up unit; PLL2 additionally needs PHIDET).

### Files touched
schematic/{types,pins,catalog}.ts, schematic/symbols.tsx,
io/{ascImport(+test),ascExport}.ts, engine/spiceNetlist.ts(+test),
scripts/acceptanceCorpus.corpus.ts, PROGRESS.md, FEATURE_PARITY.md
(engine/modulatorSpec.ts+test landed earlier at f27a0bd)

### Tests
1188 passing (+2 this commit: MODULATE import w/ R0+M0 pin banks, VCO deck
emission; +10 spec tests at f27a0bd) + 5 corpus specs green. Typecheck clean.

### FEATURE_PARITY items updated
§1: modulator landed (74→75 warning-clean); NEXT list now counter/srflop +
PHIDET + `rand()` mapping.

### UX issues found
None — screenshot QA (1440×900): picker search row, placed symbol, and
inspector preview are coherent with the sampleHold/gate family.

### Next step
Either the `rand()` → ngspice mapping (unblocks PLL/PLL2 `.op`), the
library-subcircuit `.asy` Prefix X path (4 files), or the next §10 panel
migration per the FEATURE_PARITY §10 sequence.

---

## 2026-07-04T04:55Z — auto/ltspice-parity — §10: symbol-preview chip on tokens (last hardcoded-color element cleared)

### What I did
Migrated `.symbol-preview` from hardcoded cream `#e9e6da` / teal `#2a7d7d` to
tokens: `--accent-soft` surface, `--border` hairline, `--accent` stroke+label,
`--muted` hotkey hint, `--r-md` radius. CSS-only.

### Files touched
apps/desktop/src/App.css, FEATURE_PARITY.md (§10 debt flipped ✅), PROGRESS.md

### Tests
1177 passing, typecheck clean (CSS-only change; suite re-run to be sure).

### FEATURE_PARITY items updated
§10 "Known debt: symbol-preview hardcoded colors" → ✅ cleared.

### UX issues found
None — screenshot QA (1440×900): the chip re-themes with the active accent
(orange under the current theme) and finally sits inside the dark system.

### Next step
Next warning-clean push: MODULATE/PHIDET A-devices (PLL.asc/PLL2.asc), or the
next §10 panel migration per the FEATURE_PARITY §10 sequence.

---

## 2026-07-04T04:40Z — auto/ltspice-parity — sampleHold kind: SpecialFunctions\sample as a real track-and-hold (73→74 warning-clean)

### What I did
- **Recovered the killed session's claim** from `origin/auto/ltspice-parity-wip`
  (heartbeat + warnall.corpus.ts diagnostic), cherry-picked, deleted the wip ref.
- **New `sampleHold` component kind** end-to-end: `engine/sampleHoldSpec.ts`
  emits S/H mode as B-buffer → ideal switch → 1n hold cap → B-buffer, and CLK
  mode as a master-slave stage pair (master tracks while CLK low, slave tracks
  the buffered master while CLK high ⇒ rising-edge latch). A one-shot RC window
  was **rejected by live ngspice test**: the transient solver steps straight
  over a ~100 ns control pulse (sampled ~0 V); the master-slave form only
  switches on breakpoint-resolved clock crossings and reproduced hand-computed
  sine samples to 4 digits. Vt/com/differential-input semantics follow the
  digitalGate conventions; S/H wins if both controls are wired (documented).
- **Importer**: `SpecialFunctions\sample` (path-gated) → `sampleHold` with the
  id-mapped `.asy` pin bank (in+,in-,CLK,S/H,out,com @ SpiceOrder 1,2,3,4,7,8);
  A-device params joined across Value/Value2/SpiceLine; export maps back to
  `SpecialFunctions\\sample`.
- **Root-cause connectivity fix**: `ExtractedNet.labelCount` — net labels now
  count as electrical endpoints. Before, a single-pin net probed through a bare
  flag (`FLAG … A` — the LTspice probe idiom, used by both SampleAndHold.asc
  outputs) was treated as floating: the deck builder silently dropped the
  A-device lines and the importer warned "only connected to one pin".
- **Corpus floors raised** to measured 82 imported / 74 warning-clean /
  82 deck-built / 67 op-converged; new `scripts/sampleHoldParity.corpus.ts`
  gate runs the real Educational file through ngspice with .meas assertions.

### Files touched
engine/sampleHoldSpec.ts(+test, NEW), scripts/sampleHoldParity.corpus.ts (NEW),
schematic/{types,pins,catalog,netlist}.ts(+netlist.test), schematic/symbols.tsx,
io/{ascImport(+test),ascExport}.ts, engine/spiceNetlist.ts(+test),
scripts/acceptanceCorpus.corpus.ts, PROGRESS.md, FEATURE_PARITY.md

### Tests
1176 passing (+12 new: 9 spec, 2 import, 1 netlist-emission, 1 extraction) +
5 corpus specs green. Typecheck clean.

### FEATURE_PARITY items updated
§1: sampleHold landed (73→74 warning-clean); NEXT list now counter/srflop +
MODULATE/PHIDET only.

### UX issues found
None new — picker row + placed symbol + inspector preview screenshot-audited
(coherent with the dflop/gate family; CLK wedge + staircase glyph read well).

### Next step
Either MODULATE/PHIDET (PLL.asc/PLL2.asc, stateful A-devices) or the
library-subcircuit `.asy` Prefix X path (TowTom2/capmeter/ISO16750-2/ISO7637-2)
— the latter unblocks 4 files but needs LTspice lib `.sub` resolution.

---

## 2026-07-04T03:48Z — auto/ltspice-parity — REVIEW SESSION: 32-commit correctness pass + 3-screen UI/UX audit

### Why a review session
`git log --oneline -30 | grep -c "^\w* review:"` → 0. Per AGENTS.md review
rotation, no new features this run. Reviewed everything since the last
`review:` commit (`401ede9`) — 32 commits.

### (a) Correctness review of the diff — VERDICT: clean, nothing to fix
Read the substantive engine/parsing changes line-by-line:
- **engine/crystalSpec.ts** (BVD crystal) — inert defaults for malformed fields,
  namespaced internal nodes, Rser=0/Cpar=0 collapse handled. Sound.
- **engine/digitalGateSpec.ts** (digital A-devices) — B-source ternary emission,
  Schmitt self-referential state read, DFLOP adc/d_dff/dac bridge chain with a
  ≥1 ns event-queue delay floor. The XOR ">2 inputs = exactly one true" gap is
  documented (matches classic XOR at 2 inputs); acceptable. `com` reference is
  applied consistently to inputs and level-shift. Sound.
- **engine/opampSpec.ts** (rail-clamped tanh opamp) — verified small-signal gain
  = Avol exactly (d/dx of Vhalf·tanh(Avol·Vd/Vhalf) at 0 = Avol); 0.5 V divisor
  guard rationale (source-stepping stability) is documented and empirically
  justified. Sound.
- **engine/spiceNetlist.ts** — collision-safe instance name (`${p}${label}`
  instead of colliding `${p}${index+1}`), driven-supply detection for the
  clamped opamp swap, digitalGate/dflop emission gated on connected pins. Sound.
- **quantity.ts / engineering.ts** — SPICE M=milli suffix semantics unified
  through one authority; `meg`/`mil` longest-match, µ (U+00B5) + μ (U+03BC) both
  accepted, `formatEngineering` emits `Meg`. Round-trip-safe. Sound.
- **schematic/netlist.ts** — the diagonal-wire `segmentIntersections`
  reclassification (explicit H/V tests instead of `!vertical`) is a genuine
  correctness FIX preventing false endpoint-merges of crossing diagonals;
  `netAtPoint` probe resolution is correct (segment endpoints are DSU points).
- **store/useSchematic.ts** — probe/label toggles guard against empty undo-history
  entries; current-probe keyed by componentId, distinct from point probes. Sound.

No solver/netlist edge-case bugs, unit-handling bugs, or re-render hot paths
found. The range is well-tested (+32 tests, 1132→1164) and carefully commented.

### (b) UI/UX audit (STEP 3.5 screenshot pipeline, 1440×900)
Screenshotted and read: empty state, loaded RC schematic (V1/R1/C1/gnd), and
the simulator transient scope. All three are dense, aligned, dark-coherent,
with clear intentional empty states and a full LTspice keyboard-hint status bar
(R C L V I A G place · W wire · F4 label · rotate · mirror). A picky reviewer
would pass these screens.

### UX debt (logged, not fixed — belongs to the §10 migration)
- **`.symbol-preview` card uses hardcoded colors** (`#e9e6da` cream fill,
  `#2a7d7d` teal stroke/label, `App.css:3478/3487/3491/3499`). It is the single
  element that clashes with the dark §10 design system, and it violates the
  project's no-hardcoded-colors convention. It's a deliberate "silkscreen chip"
  aesthetic, so restyling is a §10 design decision — the §10 panel migration
  should map it to `tokens.css` surface/accent vars rather than a drive-by
  restyle mid-migration. **Top item for the next §10 pass.**

### Files touched
PROGRESS.md, FEATURE_PARITY.md (audit note).

### Tests
1164 passing, typecheck clean — no code changes, baseline held.

### FEATURE_PARITY items updated
§10 note: symbol-preview hardcoded-color migration flagged as top debt.

### Next step
Features resume next session: warning-clean push toward ≥80 via the
library-subcircuit-symbol (`.asy` Prefix X → subcircuit instance) path — unblocks
TowTom2/capmeter/ISO16750-2/ISO7637-2 (4 files) in one mechanism.

---

## 2026-07-04T22:35Z — auto/ltspice-parity — corpus deck-build closeout: crystal model + placeholder value fixes → 82/82 deck-built

### What I did
Four tested increments after recovering the §1 digital gates (logged below):
- **Varistor placeholder value** (`6cbdaf9`): `SpecialFunctions\varistor`→resistor
  carried `Rclamp=1` (an A-device param, not Ohm) that crashed deck-build. Gave
  the placeholder a neutral high-Z resting value (1Meg ≈ open below clamp V).
- **Real crystal (BVD) model** (`d9205e2`): new `engine/crystalSpec.ts`. LTspice
  `Misc\xtal` lands as a capacitor whose value carries `Cser Rser= Lser= Cpar=`
  — ngspice's `C` can't take those and the value parse crashed. `parseCrystal`
  detects the crystal signature and the deck builder expands the 4-element
  Butterworth–Van Dyke branch (motional Lser-Cser-Rser in series ∥ Cpar shunt,
  namespaced internal nodes). Real crystals now resonate (Pierce oscillator).
- **Diac placeholder + collision-safe names** (`86c2b64`): `misc\DIAC`→resistor
  carried only `VK=30` (no Ohm) → same high-Z fix. AND a latent bug: a device
  remapped to a placeholder kind keeps its label (diac `Q1`), so instanceName
  fell back to `${prefix}${index+1}` = `R1`, colliding with the real R1
  (duplicate SPICE refdes). Now suffixes the label (`RQ1`) — unique, traceable.

### Files touched
apps/desktop/src/io/ascImport.ts (+test), apps/desktop/src/engine/crystalSpec.ts
(new, +test), apps/desktop/src/engine/spiceNetlist.ts (+test).

### Tests
1164 passing (baseline 1132, +32 across the whole run) — all green, typecheck clean.

### Corpus (committed runner, actual output)
Start of run 82 imported / 71 warning-clean / 79 deck-built / 64 op-converged →
**82 imported / 73 warning-clean / 82 deck-built (ALL) / 67 op-converged.**
Deck-built reached 82/82 — every file in the acceptance corpus builds a deck.

### FEATURE_PARITY items updated
§1 crystal (Misc\xtal → BVD model) → ✅; varistor/diac deck-build robustness noted.

### UX issues found
None (no UI change this run).

### Next step
Push warning-clean toward the DoD ≥80/82: the 9 non-clean files split into
library-subcircuit symbols (TowTom2/capmeter/ISO16750-2/ISO7637-2 — need an
LTspice-library `.asy` `Prefix X` → subcircuit-instance path) and stateful
A-devices (SpecialFunctions\MODULATE, Digital\PHIDET). The subcircuit-symbol
mechanism is the higher-leverage single unit (4 files).

---

## 2026-07-04T21:45Z — auto/ltspice-parity — §1 digital A-device gates landed (recovered from wip rescue)

### What I did
- STEP 0 recovery: found `origin/auto/ltspice-parity-wip` @ 41bedf3, a clean
  DIRECT child of branch HEAD ab11a3f (merge-base == HEAD == wip-parent). It
  held the *remaining* §1 digital-gate work the prior heartbeat listed as
  in-flight (ascImport mapping, digitalGateSpec tests, netlist diagonal fix).
- Cherry-picked `-n` and **re-verified everything myself** rather than trusting
  the dead session's claims. Dropped `scripts/dumpDeck.corpus.ts` (a one-off
  debug dump the author explicitly marked "not committed").
- Landed: path-gated `Digital\{inv,buf,buf1,and,or,xor,schmitt,schmtbuf,
  schmtinv}`→`digitalGate` and `dflop`→`dflop`; id-mapped pin banks (each .asy
  exposes a SUBSET of the 8-slot contract, so mapped by pin id not positional
  zip); gate function prepended from the symbol leaf; Vhigh/Vlow/Vt/Vhys/Td
  gathered across all attr fields for parseDigitalGate.
- Bug fixes carried in the wip: parenthesize the Schmitt ternary `cond`
  (right-assoc was swallowing `? hi : lo`); round d_dff event delay to kill
  SI-suffix float noise; classify diagonal wires explicitly in
  `segmentIntersections` so crossing diagonals don't falsely merge endpoints
  (Electrometer dflop feedback overpass). `bi2`→`bsource` with its own bank.

### Files touched
apps/desktop/src/io/ascImport.ts, apps/desktop/src/engine/digitalGateSpec.ts,
apps/desktop/src/engine/digitalGateSpec.test.ts (new),
apps/desktop/src/engine/spiceNetlist.test.ts,
apps/desktop/src/io/ascImport.test.ts, apps/desktop/src/schematic/netlist.ts

### Tests
1156 passing (baseline 1132, +24 new) — all green. typecheck clean.

### FEATURE_PARITY items updated
§1 digital A-device gates (INV/BUF/AND/OR/XOR/SCHMT*/DFLOP import + deck) → ✅.

### Corpus (committed runner, actual output)
82 imported · 73 warning-clean (71→73) · 79 deck-built · 64 op-converged.
Runner test passes at-or-above recorded baseline.

### UX issues found
None (no UI change this unit).

### Next step
Pick highest-leverage next item: Comparators\* pin banks (unblocks ~8 corpus
files toward Class-D) or one §10 panel migration for the interleave rhythm.

---

## 2026-07-03T17:05Z — auto/ltspice-parity — §10 FOUNDATION: Tailwind v4 + shadcn token layer, pixel-neutral (recovered from wip rescue)

### What I did
- Recovered the killed 04:00Z session's unit 3 from `origin/auto/ltspice-parity-wip`
  (`git cherry-pick -n 2c4aaa3`) and **re-verified everything myself** rather
  than trusting the dead session's claims.
- **Tailwind v4 via `@tailwindcss/vite`** + shadcn scaffolding: `components.json`
  (new-york), `src/lib/utils.ts` `cn()` helper (+4 tests), `@/*` alias in
  vite.config.ts + tsconfig.
- **`src/styles/tokens.css`**: theme+utilities layers ONLY — **no preflight**,
  so shipping is pixel-neutral. All shadcn tokens map onto the existing
  App.css palette via `var()` refs inside `@theme inline`, so the runtime
  theme switcher re-themes utilities for free. Stock Tailwind palette wiped
  (`--color-*: initial`) — `bg-red-500` is a build error; all color routes
  through Tau tokens. Tokens live only in the `--color-*` namespace because
  App.css `--muted` is a *text* color and bare shadcn `--muted` (a surface)
  would collide.
- Deleted the consumed `-wip` rescue ref.

### Verification (all re-run this session, not inherited)
- typecheck clean; **1132 tests passing** (baseline 1118, +14).
- STEP 3.5 screenshots at 1440×900 BEFORE (HEAD) vs AFTER (with unit):
  **byte-identical** per `cmp` — pixel-neutrality proven, not claimed.
- Live playwright probe: `bg-primary` → rgb(214,138,60) (App.css --accent),
  `p-2` → 8px. `rounded-md` computed 0px — NOT a bug: Tailwind v4 JIT hadn't
  generated it since no source file uses it yet (bg-primary/p-2 appear in
  utils.test.ts, hence generated). Radius mapping will be exercised by the
  first shadcn primitive.
- Dev server boots warning-clean with the new vite plugin.

### Files touched
FEATURE_PARITY.md, apps/desktop/{package.json, vite.config.ts, tsconfig.json,
components.json, src/main.tsx, src/lib/utils.ts, src/lib/utils.test.ts,
src/styles/tokens.css}, pnpm-lock.yaml, PROGRESS.md

### Tests
1132 passing, 4 new — all green

### FEATURE_PARITY items updated
§10 Foundation ⬜ → ✅

### UX issues found
None (change is deliberately pixel-neutral).

### Next step
§10 "Core primitives adopted": bring in the first shadcn primitive (Button is
the natural start — toolbar buttons), which also lands preflight's border
reset — screenshot-verify that reset against real components per tokens.css
note. Interleave with priority #4 (§1 Comparators\* pin banks).

---

## 2026-07-03T04:45Z — auto/ltspice-parity — §7 Class-D fidelity: rail-clamped op-amp + real VDMOS models (flagship circuit simulates correctly)

### What I did
- **Rail-clamped op-amp emission** (`engine/opampSpec.ts`, new): an op-amp
  whose V+/V− supply pins are driven (pin's net is ground or has ≥2 pins —
  floating pins get singleton nets, so pin-count is the discriminator) emits
  `B V = Vmid + Vhalf·tanh(Avol·Vd / max(|Vhalf|, 0.5))` instead of the
  unbounded `E … 1e6`; open-loop it clamps to the rails exactly like LTspice's
  UniversalOpamp2 (class-d's PWM comparator — was saturating to ~1e7 V).
  Floating-supply op-amps keep the classic unbounded E-source model.
- **Formulation was chosen by corpus evidence, not taste** — three iterations:
  hard `max(min(…))` clamp regressed op-converged 64→59 (zero derivative when
  saturated kills gmin/source stepping on feedback circuits: Wien, LoopGain,
  Howland, phono, Draft10 all "singular matrix"/"timestep too small"); the
  classic E+clamp-diode macro fixed those but broke class-d (open loop the
  internal node forces ~1e5 A through the clamp diodes); smooth tanh with a
  **0.5 V divisor floor** passes everything — and the floor size matters: 1µ
  breaks ngspice source stepping itself (early steps see slope ~1e12;
  phono.asc live-verified: 0.5 converges via source stepping, 1µ does not).
- **Avol imported**: `componentValueFromAttrs` now carries opamp
  Value2/SpiceLine (`Avol=1Meg GBW=10Gig Slew=10Gig`) onto the value;
  `parseOpampAvol` reads it (default 1e6, ignores GBW/Slew).
- **Real power VDMOS models bundled** (`standardModels.ts`): QS6K1 (n) +
  RSR015P06 (p) verbatim from LTspice `standard.mos` with `Cgso`→`Cgs`
  (ngspice's name — live-verified "unrecognized parameter" otherwise) and
  annotation keys stripped. Without them class-d's half-bridge used Kp=200µ
  generic starters and delivered ~0.1 V into the 8 Ω load.
- **Committed Class-D fidelity spec** (`scripts/classdParity.corpus.ts`, runs
  under `scripts/acceptance-corpus.sh`; corpus config include widened to
  `scripts/*.corpus.ts`): imports the real class-d_starter.asc (hierarchical
  deadtime block via sibling resolver), runs its own `.tran 0 3m` in ngspice
  with spliced `.meas` probes (ngspice needs `FROM=`/`TO=` key form), asserts
  PWM clamps to ±10 V rails and the LC-filtered output tracks the 7.5 V/1 kHz
  program. Measured: vpwmmax/min = ±10.0000, vomax +9.77 / vomin −8.34,
  voavg −15.6 mV.

### Files touched
- apps/desktop/src/engine/opampSpec.ts (+opampSpec.test.ts) (new)
- apps/desktop/src/engine/spiceNetlist.ts (+2 tests), standardModels.ts (+1 test)
- apps/desktop/src/io/ascImport.ts (+1 test)
- apps/desktop/scripts/classdParity.corpus.ts (new), vitest.corpus.config.ts
- FEATURE_PARITY.md (§3 VDMOS ✅ / comparator-finding resolved; §7 Class-D ✅), PROGRESS.md

### Tests
1128 passing (10 new) — default suite green; corpus 82 imported / 71
warning-clean / 79 deck-built / 64 op-converged (exactly at floors, zero
regression); classdParity spec green.

### FEATURE_PARITY items updated
- §7 Class-D fidelity: NEW ✅ (committed-runner-proven)
- §3 VDMOS "NEXT: bundle RSR015P06/QS6K1": ✅
- §3 comparator finding (open-loop opamp saturation): resolved ✅

### UX issues found
none (no UI change). Engine debt: the browser TS solver still models opamps
unbounded (linear solver can't do tanh); native path is authoritative.

### Next step
§10 design system panel migration (imperative per Omar) or the 3 remaining
deck-build failures (Pierce XTAL Y1 F-value, dimmer Q1, varistor A1).

---

## 2026-07-03T04:15Z — auto/ltspice-parity — §1/DoD committed acceptance-corpus runner (recovered from wip, first trustworthy corpus numbers)

### What I did
- **Recovered the killed session's work** from `origin/auto/ltspice-parity-wip`
  (rescued checkpoint d3d7a72) per STEP 0: cherry-picked, verified, finished.
- **Committed acceptance-corpus runner** (§1 / Definition of Done, priority #1):
  `scripts/acceptance-corpus.sh` → `apps/desktop/scripts/acceptanceCorpus.corpus.ts`
  under its own `vitest.corpus.config.ts` (NOT in the default `pnpm test` include).
  Walks `~/Downloads/LTspice_export` + `~/Documents/LTspice` (+`examples/
  Educational`), imports each `.asc` with a sibling-file subcircuit resolver,
  builds an `.op` deck, batch-runs `ngspice -b` (20 s timeout each), prints a
  per-file ✓/✗ table + summary, and asserts the counts against recorded floors.
- **Pure report helpers** in `src/io/corpusReport.ts` (+8 unit tests in the
  default suite): `summarizeCorpus`, `formatCorpusReport`, and
  `ngspiceOpSucceeded` — ngspice exits 0 even after "simulation(s) aborted", so
  success requires "No. of Data Rows" AND no failure marker in the output.
- **Corrected the baselines to the measured truth.** The wip draft had floors
  from PROGRESS.md's hand-typed claims (deck-built ≥ 82); the live run measured
  **82 imported / 71 warning-clean / 79 deck-built / 64 op-converged** — the
  runner immediately caught the drift it was built to catch. Floors now 82/71/79/64.
- Env knobs: `CORPUS_SKIP_NGSPICE=1` (import+deck only, also auto when ngspice
  is missing), `CORPUS_ALL=1` (full examples tree, floors not enforced);
  spec skips cleanly on machines without the corpus dirs.

### Files touched
- scripts/acceptance-corpus.sh (new)
- apps/desktop/scripts/acceptanceCorpus.corpus.ts (new)
- apps/desktop/vitest.corpus.config.ts (new)
- apps/desktop/src/io/corpusReport.ts (+corpusReport.test.ts) (new)
- apps/desktop/package.json (+@types/node), tsconfig.json (include scripts/), pnpm-lock.yaml
- FEATURE_PARITY.md (§1 runner ✅; corrected the stale "82/82 build" claim to 79/82), PROGRESS.md

### Tests
1118 passing (8 new) — default suite green; corpus spec passes live
(`total 82 · imported 82 · warning-clean 71 · deck-built 79 · op-converged 64`).

### FEATURE_PARITY items updated
- §1 committed acceptance-corpus runner: ⬜ → ✅ (was a header-note item)
- §1 "op-deck build 82/82" claim corrected to measured 79/82 (still 🟡)

### Corpus follow-ups surfaced by the runner (op failures worth fixing)
- Deck-build (3): Pierce.asc (XTAL `Y1` needs F value), dimmer.asc (`Q1` Ohm
  value), varistor.asc (A-device `A1` Ohm value)
- Missing include stubs (4): TowTom2.sub, capometer.sub, opamp.sub ×2
- Singular matrix (3): Cohn, passive, varactor2 (inductor-loop `l#branch`)
- Timeouts (2): ISO16750-2/ISO7637-2 examples; misc (5): LoopGain2 shorted
  VSRC, P2 netlist error, PLL/PLL2 `rand` at run-time, SoftDiodeRecovery,
  UHFpreamp line errors

### UX issues found
none (no UI change)

### Next step
Class-D fidelity (priority #2): map LTspice `Comparators\LT1016` et al. to the
`comparator` kind with real pin banks so the flagship circuit stops running open-loop.

---

## 2026-07-02T23:00Z — auto/ltspice-parity — §2/§8 F4 net-label tool (inline placement + text input)

### What I did
- **F4 net-label tool** (§2, and the F4 gap in §8's shortcut parity): new
  `label` tool mode — enter via F4, the toolbar tag button, the sidebar
  palette's Tools section, or ⌘K; the canvas shows crosshair + pin markers +
  the snap ring (shared with wire/probe), and a click on any snapped point
  opens an inline text input right there. Enter or click-away commits through
  the already-undoable `upsertNetLabel` (empty text deletes), Esc cancels.
  Clicking a point that already has a label pre-fills its text for editing.
- **Store no-op guards:** committing an empty draft where no label exists, or
  re-committing unchanged text, no longer pushes a junk undo entry.
- **Fixed en route (focus race):** the input mounts during the opening
  click's pointerdown, so focusing at mount let the browser's default
  mousedown action steal focus straight back — the blur handler closed the
  input before it ever appeared (first Playwright run: keystrokes fell
  through to the global part hotkeys, status bar flipped to "Placing
  capacitor"). Focus is now deferred one animation frame.

### Files touched
- apps/desktop/src/schematic/types.ts, shortcuts.ts (+2 tests)
- apps/desktop/src/store/useSchematic.ts (+3 tests)
- apps/desktop/src/App.tsx, components/Canvas.tsx, ShellPanels.tsx,
  StatusBar.tsx, Palette.tsx, CommandPalette.tsx
- FEATURE_PARITY.md, PROGRESS.md

### Tests
1110 passing (74 files), 5 new — passed. typecheck clean.

### FEATURE_PARITY items updated
- §2 net labels: F4 tool noted on the ✅ item; §8 keyboard parity now lists
  F4 bound (only F7/F8 remain, gated on move/drag tools).

### Visual QA
Playwright: F4 switches the status bar to "Net label — click a point, type a
name" and highlights the toolbar button; click opens the input at the snapped
point (placeholder "net name", accent focus ring); typing vcc + Enter renders
the label at the point; re-click pre-fills "vcc"; F9 removes it. Screenshots
reviewed at each step.

### UX issues found
- A label placed on empty grid (not on a wire/pin) is legal but silently
  non-electrical until wired — LTspice behaves the same, but a subtle "not on
  a net" hint on such labels would help. Logged as UX debt.

### Next step
Next §8 gap (F7 move / F8 drag) or the committed acceptance-corpus runner
(§1 / Definition of Done) — corpus runner is the higher-leverage pick.

---

## 2026-07-03T00:20Z — auto/ltspice-parity — §8 LTspice F-key shortcut parity via pure resolver

### What I did
- **Bound the LTspice function-key set** (§8): F2 part picker (opens the
  searchable palette), F3 wire, F5 delete, F6 copy, F9 undo / Shift+F9 redo.
  F4/F7/F8 stay deliberately unbound — Tau has no net-label/move/drag tools
  yet, and binding approximations would teach users the wrong reflex.
- **Extracted the whole shortcut table into a pure resolver**
  (`schematic/shortcuts.ts` `resolveShortcut({key, ctrlOrMeta, shift})` →
  action id | null): previously the bindings lived as untestable if-chains in
  an App effect; now every binding has a unit test (25 — F-keys, all modifier
  combos incl. Ctrl/Cmd interchangeability and Shift+Z, case-insensitivity,
  unrelated-combo passthrough so OS shortcuts stay untouched, plain "r" still
  reserved for resistor placement). `App.tsx` keyboard effect just guards
  inputs and dispatches; catalog hotkeys unchanged.

### Files touched
- apps/desktop/src/schematic/shortcuts.ts (new, +25 tests)
- apps/desktop/src/App.tsx
- FEATURE_PARITY.md, PROGRESS.md

### Tests
1105 passing (74 files), 25 new — passed. typecheck clean.

### FEATURE_PARITY items updated
- §8 keyboard parity item updated (F-keys bound, remaining F4/F7/F8 gated on
  tools); §8 component picker ⬜ → 🟡 (F2 opens the searchable browser).

### Visual QA
Playwright live check on the RC example: F3 switched the status bar to the
Wiring tool, F2 opened the part palette (screenshot reviewed — searchable list
with symbols/categories/hotkeys, esc closes), click-select + F5 deleted the
component (5→4), F9 restored it (4→5).

### UX issues found
- None new. Palette renders cleanly as the F2 browser.

### Next step
F4 net-label tool (placement + text input) — unlocks binding F4 and moves
§2/§8 forward together.

---

## 2026-07-02T23:45Z — auto/ltspice-parity — §6 DC operating point annotation on the schematic

### What I did
- **In-place OP annotations** (§6, the section's last ⬜): after running the OP
  tab, the simulator-mode schematic now labels every non-ground net with its DC
  voltage (cyan, at the net's topmost-leftmost point, background-stroked for
  readability over wires) and every voltage-source/inductor with its MNA branch
  current (amber, centered under the component body — placed to clear the
  ref/value labels that sit beside the body).
- Pure resolver `opAnnotations(op, circuit)` in `simulation/opAnnotations.ts`:
  matches OP nets/branches to extracted geometry by id, so stale results
  degrade to fewer labels instead of misplaced ones. `runOperatingAnalysis` now
  passes `returnBranches: true` to the JS solver (the native ngspice path
  doesn't return branches — those runs annotate voltages only). Canvas
  re-extracts the circuit only when a successful OP result is on screen in
  simulator mode, never during schematic edits.

### Files touched
- apps/desktop/src/simulation/opAnnotations.ts (new, +5 tests)
- apps/desktop/src/components/Canvas.tsx, App.tsx, App.css
- FEATURE_PARITY.md, PROGRESS.md

### Tests
1080 passing (73 files), 5 new — passed. typecheck clean.

### FEATURE_PARITY items updated
- §6 "DC operating point annotation on schematic" ⬜ → ✅.

### Visual QA
Playwright (Voltage Divider → run → OP tab): three annotations rendered — 10 V
on the source net, 5 V on the divider midpoint, −5 mA under V1 — all matching
the OP table. First pass had the current label colliding with R2's ref text;
fixed by centering it under the body and re-verified.

### UX issues found
- The divider's midpoint 5 V label sits at the canvas's right edge, mostly
  under the simulation panel — same "schematic extends under the panel at
  default view" debt logged last unit; a fit-to-visible-area zoom would fix
  both. Not new to this change.

### Next step
§6 has no ⬜ left — next: remaining 🟡 polish items or §8 keyboard parity.

---

## 2026-07-02T23:10Z — auto/ltspice-parity — §6 FFT measurement cursors + FFT signal-resolution bug fix

### What I did
- **FFT measurement cursors** (LTspice-style, §6): a `cursors` toggle in the
  FFT control bar enables two cursors along the **log-frequency** axis — equal
  slider travel means equal decades (`logFractionToX` in `simulation/cursors.ts`,
  skips the DC bin, NaN on no positive span). Dashed vertical lines with 1/2
  tags render on the spectrum at the exact `bodePath` x-mapping; the readout
  row shows f1, f2, dB at each cursor, ΔdB, and the **dB/decade slope**
  (`dbPerDecade` — the filter-rolloff measurement; hand-verified to read
  exactly −20 dB/dec off a synthetic 1-pole magnitude).
- **Fixed a real pre-existing bug the cursors sat on top of:** the FFT pane
  showed "No spectrum" for every named net. `resolveSignal` (duplicated in
  `fft.ts` and `fourier.ts`) matched a `V(x)` output only against the net id or
  the *full* label, but the FFT signal picker feeds back display labels like
  `V(R1·C1)` whose inner name (`R1·C1`) is a component-derived display name,
  not the net id. Both copies now also match the label's inner name. The
  existing tests missed it because their fixtures used `id: "out"` +
  `label: "V(out)"` — id and inner name identical; new regression tests use
  `id: "n1"` + `label: "V(R1·C1)"`.

### Files touched
- apps/desktop/src/simulation/cursors.ts (+7 tests in cursors.test.ts)
- apps/desktop/src/simulation/fft.ts (+1 regression test), fourier.ts (+1)
- apps/desktop/src/components/SimulationPanel.tsx (FftView)
- apps/desktop/src/App.css (.expr-add.active, .plot-cursor)
- FEATURE_PARITY.md, PROGRESS.md

### Tests
1075 passing (72 files), 9 new — passed. typecheck clean.

### FEATURE_PARITY items updated
- §6 FFT item 🟡 → ✅ (cursors were its last "NEXT"; resolution bug documented).

### Visual QA
Playwright (RC Charging → run → open FFT → enable cursors → C1 10% / C2 90%):
spectrum now renders (fix confirmed live — PEAK f 200 Hz / THD / DC populated),
both dashed cursor lines at the correct log positions, readout f1 271 Hz,
f2 13.1 kHz, @C1 −4.2 dB, @C2 −110.0 dB, Δ −105.8 dB, SLOPE −62.7 dB/dec.
Toggle button shows a clear active state. Screenshot reviewed; layout clean.

### UX issues found
- The FFT cursor sliders sit below the plot rather than being draggable on the
  plot itself; fine for now (matches the transient CursorView pattern) but a
  drag-on-plot interaction would be closer to LTspice. Logged as UX debt.

### Next step
§6 DC operating point annotation on the schematic (show node V / device I
in-place) — the remaining ⬜ in §6.

---

## 2026-07-02T22:20Z — auto/ltspice-parity — §6 component-body current probe (LTspice clamp-meter)

### What I did
- **Recovered rescued wip 883cdd1** (previous session died mid-unit): full
  implementation of the clamp-meter probe — in simulator mode clicking a
  component body toggles an `I(ref)` current trace on the scope. Cherry-picked
  cleanly, then finished the unit: wrote all the missing tests and did the
  visual QA the heartbeat's verify plan called for.
- Implementation (from the wip): `Probe.componentId?` marks a clamp probe
  (persisted + validated in documentValidation), store `toggleCurrentProbe`
  adds/removes it (refuses grounds/unknown ids, shares the probe color cycle),
  `simulation/currentProbe.ts#currentProbeTraces` resolves probe→component
  ref→`result.currents` into a plottable trace (unit "A", probe color, deduped),
  Canvas renders a dashed-ring marker that follows the component and skips
  deleted hosts, SimulationPanel/WaveformPlot append current traces to the
  probed-trace set.
- **New this run:** `currentProbe.test.ts` (7 tests — real RC transient run so
  id→ref→current is end-to-end; physics check I(R1)@t=0 ≈ Vs/R = 5 mA and
  decay <50 µA at 5τ; net-probe/unknown-id/unlabeled/dedup paths) and 5 store
  tests (add carries componentId at part position, toggle-off, color cycling
  with net probes, ground/unknown refused, coincident net probe not stolen by
  `addProbe`). Also fixed the status-bar simulator hint to advertise both
  gestures: "click a wire to probe voltage · a part to probe current".

### Files touched
- apps/desktop/src/simulation/currentProbe.ts (+ currentProbe.test.ts, new)
- apps/desktop/src/store/useSchematic.ts (+ 5 tests in useSchematic.test.ts)
- apps/desktop/src/schematic/types.ts, documentValidation.ts
- apps/desktop/src/components/Canvas.tsx, SimulationPanel.tsx, StatusBar.tsx
- apps/desktop/src/App.css
- FEATURE_PARITY.md, PROGRESS.md

### Tests
1068 passing (72 files), 12 new — passed. typecheck clean.

### FEATURE_PARITY items updated
- §6 probe-in-place item: "Still ⬜ component-body current" → landed, documented.

### Visual QA
Playwright drove the live app (RC Charging → run → simulator): clicking V1's
body added the dashed-ring marker in the probe color and the scope re-filtered
to exactly `I(V1)` (−5.3 mA charging decay toward 0 — the correct negative of
the 5 mA resistor current); second click removed the marker and restored the
default voltage traces. Screenshots reviewed: plot, legend, marker, and the new
status-bar hint all render correctly.

### UX issues found
- The RC example's R1/C1 sit underneath the simulation panel overlay at default
  zoom in a 1440×900 window — clicks there hit the panel, not the canvas. Not
  new to this unit (same for selection), but worth a "zoom to fit visible area"
  pass later. Logged as UX debt.

### Next step
§6 measurement cursor on the FFT plot.

---

## 2026-07-02T16:40Z — auto/ltspice-parity — §6 probe-in-place + netAtPoint mid-segment resolution

### What I did
- **Probe-in-place** (LTspice plot-open→click-wire→trace): in simulator mode the
  canvas is read-only, so a plain left click on a wire now toggles a probe at the
  snapped point and the transient scope immediately re-filters to the probed
  net(s). Crosshair cursor + hover highlight on wires advertise the gesture
  (`.wire-group.probe-ready`); the status-bar simulator hint now says "click a
  wire to probe its net". Schematic-mode click semantics are untouched.
- **Fixed a latent resolution bug** that probe-in-place would have hit
  constantly: probes were matched to nets by *exact* point equality against the
  net's DSU points (endpoints/pins/junctions), so a probe dropped mid-segment
  never resolved and silently plotted nothing. New `netAtPoint(nets, wires, p)`
  in `schematic/netlist.ts` falls back to point-on-any-wire-segment and names
  the net by the segment's endpoints; the scope trace list, `WaveformPlot`, and
  the step-family trace picker all share it now.

### Files touched
- apps/desktop/src/schematic/netlist.ts (+ netlist.test.ts, 5 new)
- apps/desktop/src/components/Canvas.tsx, SimulationPanel.tsx, StatusBar.tsx
- apps/desktop/src/App.css
- FEATURE_PARITY.md, PROGRESS.md

### Tests
1056 passing (71 files), 5 new — passed. typecheck clean.

### Visual QA
Playwright drove the live app (RC Charging example → run → simulator mode):
mid-wire click added a probe marker and the scope re-filtered from the default
two traces to exactly `V(V1·R1)` in the probe's color; second click toggled the
probe off; probe-ready class present. Screenshots reviewed — plot, legend, and
marker all correct; no layout breakage.

### FEATURE_PARITY items updated
§6 "Click a node/wire on the schematic to add its trace" ⬜ → ✅ (component-body
current probe noted as remaining sub-item)

### UX issues found
None new.

### Next step
§6 probe a component body to plot its current, or measurement cursor on the FFT
plot.

---

## 2026-07-02T16:15Z — auto/ltspice-parity — §7 SPICE suffix semantics (M=milli, LTspice rules)

### What I did
Recovered the previous session's wip rescue (`quantity.ts` rewrite, saved to
`auto/ltspice-parity-wip` when that run was killed mid-unit) and finished the unit:
- `parseQuantity` now follows LTspice suffix rules: case-insensitive, `m`/`M`
  BOTH milli, only `meg` (any case) mega, `mil` = 25.4 µ, greek mu (U+03BC)
  accepted alongside the micro sign, unit letters after a prefix ignored — the
  `1MHz` = 1 milli-hertz gotcha is faithful behavior. New exported
  `spiceSuffixMultiplier` is the single authority (mirrors expr.ts literals).
- `formatEngineering` emits `Meg` for 1e6 (an emitted `1M` would read back 10⁹×
  off in a deck).
- `schematic/engineering.ts`: inspector prefix dropdown stores `Meg` for mega,
  maps any-case `M`/aliases via the same longest-match rules, and preserves
  unrepresentable suffixes (`1mil`, unknown letters) as raw text instead of
  silently dropping them (old code corrupted `1mil` → `1`).
- Fixed two `linearTransient.test.ts` literals that used `1M` to mean 1 MHz.

### Files touched
- apps/desktop/src/simulation/quantity.ts (+ .test.ts, 12 new cases)
- apps/desktop/src/schematic/engineering.ts (+ .test.ts)
- apps/desktop/src/simulation/linearTransient.test.ts
- FEATURE_PARITY.md, PROGRESS.md

### Tests
1051 passing (71 files), up from 1043 — passed. typecheck clean. No UI change
(dropdown option text `M`→`Meg` only), no screenshot needed.

### FEATURE_PARITY items updated
§7 "SPICE suffix semantics on the engine/import path" ⬜ → ✅

### UX issues found
None new.

### Next step
§6 probe-in-place: click a node on the schematic after a run → plot that trace.

---

## 2026-07-02T11:20Z — auto/ltspice-parity — REVIEW SESSION (first ever; rotation trigger)

### What I did
Code review of everything since `005f30d~1` (multi-select/group-move, multi-pane
scope, AC/DC expr bars, step families — ~1900 lines):
- **Real bug fixed:** `moveGroup` applied the drag's cumulative delta to the
  *current* positions on every pointer-move, so a multi-select drag compounded
  and ran away from the cursor (existing tests only called it once, where
  cumulative == incremental). Now takes drag-start origins and places absolutely,
  matching the single-move path; regression test with three successive
  cumulative calls added.
- Wire-only rubber-band box now selects the wire (was dead code that silently
  cleared the selection).
- `moveGroup` pin lookup: array `includes` → `Set`.
- Reviewed clean: `plotPanes.ts` (pure, invariant-tested), pane reconciliation
  effect (no loop; deps correct), AC/DC expr-bar lifecycle, family reducers.

UI/UX audit (screenshot pipeline, 9 screens against the "picky Apple reviewer"
standard): fresh empty state (intentional CTA card), schematic with rc-low-pass
example, TRAN with results (dense, panes header, meters, FFT/cursor sections),
OP table, AC/DC/TF/NOISE/STEP empty states — every tab shows a specific,
actionable directive hint; no crashes, no clipped text, no overlap. AC/DC
`.step` family panes verified earlier this session with a live 3-member family.

### Files touched
- apps/desktop/src/store/useSchematic.ts (+ .test.ts)
- apps/desktop/src/components/Canvas.tsx
- PROGRESS.md

### Tests
1043 passing (71 files), 1 new regression — passed. typecheck clean.

### UX debt (logged, not fixed)
- TRAN expr bar: 5 buttons crowd the input at 1440px; placeholder truncates.
- F2–F8 LTspice function-key parity still absent (§8 feature item, not a
  regression; Space/⌘E/⌘D etc. are in the status bar).

### Correctness debt (logged as new §7 item, needs a designed fix)
- `parseQuantity` treats `M` as mega; SPICE/LTspice treat `M` as *milli*
  (only `MEG` is mega). Imported netlist values like `1M` simulate 10⁹× off.
  Not drive-by-fixed because the UI's EngineeringInput deliberately round-trips
  `M`=mega through the same parser — needs an engine/UI parser split.

### Next step
- §6 log/linear axis toggle or probe-in-place (next feature session).

### What I did
- Recovered wip `ac2021c` (killed mid-unit): took `stepAnalysisFamily.ts`
  (generic `runStepFamily` core + `runAcStepFamily`/`runDcStepFamily` + the
  `acFamilyOverlaySeries`/`dcFamilyOverlaySeries` reducers that pick the
  step-responsive signal), its 11 new tests, and the `App.tsx` wiring verbatim
  (both files unchanged on the branch since the wip base e5cd552).
- The wip's SimulationPanel hunk was based on the pre-multi-pane file and would
  have reverted `fac8fe6`; reapplied its intent by hand instead (imports + the
  two new props threaded through).
- Wrote the part the dead session never reached: `AcFamilyPlot` / `DcFamilyPlot`
  render the family under the Bode/DC panes — STEP_COLORS ramp, `name=value`
  legend, autoranged log-f/dB and sweep/volts axes, SIGNAL/STEPS/SWEEP metrics,
  and per-member error surfacing when every member fails (found via QA: the
  generic banner hid the real "matrix is singular" cause).

### Files touched
- apps/desktop/src/simulation/stepAnalysisFamily.ts (+ .test.ts)
- apps/desktop/src/App.tsx
- apps/desktop/src/components/SimulationPanel.tsx
- FEATURE_PARITY.md, PROGRESS.md

### Tests
1042 passing (71 files), 11 new — passed. typecheck clean.

### FEATURE_PARITY items updated
- §6 `.step` family-of-curves: transient+AC+DC families now landed (stays 🟡
  pending per-trace selection and cursor readout).

### UX issues found
- Scripted QA pipeline note: `.asc` written by hand desyncs from Tau pin
  geometry (matrix singular) — use a `.cir` netlist for QA fixtures instead;
  reusable script at /tmp/tau-qa-project/qa-step-family.mjs.
- The DC family of an RC low-pass is three identical lines (physically correct
  at DC) — could hint "curves coincide" in the legend someday; not a bug.

### Next step
- REVIEW SESSION: diff review of everything since the last review + UI/UX
  screenshot audit of the main screens; fixes prefixed `review:`.

---

## 2026-07-02T05:25Z — auto/ltspice-parity — AC/DC expression bars wired into UI (§6)

### What I did
- Verified and finalized the previous run's checkpoint `39d2856`: the AC (Bode)
  and DC panes in `SimulationPanel.tsx` now carry the same expression bar as the
  transient scope — add/remove labelled chips, inline `role="alert"` errors,
  overlays drawn on the shared magnitude/voltage axis and listed in the legend.
  The prior run died right after checkpointing; this run confirmed the tree is
  green and closed the unit (no code changes needed).

### Files touched
- PROGRESS.md (heartbeat + this entry); code landed in checkpoint 39d2856
  (apps/desktop/src/components/SimulationPanel.tsx, FEATURE_PARITY.md)

### Tests
986 passing (70 files) — passed. typecheck clean.

### FEATURE_PARITY items updated
- §6 plot arbitrary expressions — AC/DC-pane UI wiring recorded in the
  checkpoint's FEATURE_PARITY note (item stays 🟡 pending step-pane traces and
  mixed V+A dual axis).

### UX issues found
- Expression lists don't persist across mode switches within a session loss —
  acceptable for now (same lifecycle as transient expr bar).

### Next step
- Wire the AC/DC `.step` family runners into the UI (engine-complete, not yet
  reachable from SimulationPanel).

---

## 2026-07-01T19:00Z — auto/ltspice-parity — DC-pane expression traces (§6)

### What I did
- New `simulation/plotExpressionDc.ts` `evaluateDcPlotExpression`: adapts a DC
  sweep into the `.meas` waveform (`dcResultToWaveform`) and reuses the transient
  `compileExpr`, evaluating an expression of the swept node voltages per sweep
  point into an overlay `DcSweepNet` (the DC-pane counterpart of the transient +
  AC expression plots; one shared evaluator).

### Files touched
- src/simulation/plotExpressionDc.ts (new), src/simulation/plotExpressionDc.test.ts (new),
  FEATURE_PARITY.md, PROGRESS.md

### Tests
986 passing (+5 new: divider Vtop−Vmid = Vsweep/2; scaled Vmid·2 = Vsweep with a
scope scalar; empty / no-run / unknown-signal). typecheck clean.

### FEATURE_PARITY items updated
- §6 plot arbitrary expressions — DC-pane traces (engine) 🟡 landed.

### Next step
- Wire the AC/DC expression bars + AC/DC `.step` family overlays into SimulationPanel.

---

## 2026-07-01T18:56Z — auto/ltspice-parity — AC-pane expression traces (§6)

### What I did
- Exported `compileAcExpr` from `measureAc.ts` (was private) and added
  `simulation/plotExpressionAc.ts` `evaluateAcPlotExpression`: evaluates any Bode
  expression (`db(V(out))-db(V(in))` transfer, `mag(V(a,b))`, raw ratio) against a
  successful AC result at every swept frequency, returning an overlay `AcTrace`
  (value on `magDb`, flat phase) — the AC-pane counterpart of the transient
  `plotExpression`, sharing the same `.meas ac` compiler (one evaluator).

### Files touched
- src/simulation/plotExpressionAc.ts (new), src/simulation/plotExpressionAc.test.ts (new),
  src/simulation/measureAc.ts (export compileAcExpr), FEATURE_PARITY.md, PROGRESS.md

### Tests
981 passing (+6 new: db(V(out)) reproduces trace dB exactly; transfer
db(V(out))-db(V(in)) 0 dB→rolloff; empty / no-run / unknown-signal / scope-scalar).
typecheck clean.

### FEATURE_PARITY items updated
- §6 plot arbitrary expressions — AC-pane traces (engine) 🟡 landed.

### UX issues found
- Both this AC expression evaluator and the AC/DC `.step` family runners are
  engine-complete but not yet reachable from the UI — the natural next wiring step.

### Next step
- Wire the AC expression bar + AC/DC `.step` family overlays into SimulationPanel.

---

## 2026-07-01T18:52Z — auto/ltspice-parity — AC/DC-domain `.step` families (§4)

### What I did
- New `simulation/stepAnalysisFamily.ts`: a generic `runStepFamily<R>` core that
  re-runs any synchronous solver once per nested-`.step` context (via
  `nestedStepContexts`), collecting a labelled `AnalysisFamily<R>`; no-spec and
  expansion-error paths return a clear `ok:false` message.
- Concrete wrappers `runAcStepFamily` (family of Bode sweeps) and
  `runDcStepFamily` (family of DC transfer curves) drive the TS
  `runAcSweep`/`runDcSweep` with each context's params/components.
- Decouples family-of-curves logic from the transient-only `App.runStepAnalysis`,
  making AC/DC families a one-liner and unit-testable without a native engine.

### Files touched
- src/simulation/stepAnalysisFamily.ts (new), src/simulation/stepAnalysisFamily.test.ts (new),
  FEATURE_PARITY.md, PROGRESS.md

### Tests
975 passing (+9 new: generic core empty/absent-source/nested/all-fail paths;
AC RC-corner shift with stepped R; DC divider-ratio with stepped resistor).
typecheck clean.

### FEATURE_PARITY items updated
- §4 `.step` — AC/DC-domain families (engine) 🟡 landed.

### UX issues found
- The STEP tab UI still only runs the transient family; the AC/DC family runners
  exist but are not yet reachable from the UI (tracked as next step).

### Next step
- Wire a tran/AC/DC domain selector into the STEP tab and render an AC/DC family
  overlay; then §6 log/linear axis toggle or probe-in-place.

---

## 2026-07-01T18:32Z — auto/ltspice-parity — nested `.step` sweep (§4)

### What I did
- Refactored `stepFamily.ts`: extracted `validateStep` (up-front error checks)
  and `applyStepValue` (one axis's transform → label + params + components +
  temperature) out of `stepContexts` (behavior unchanged).
- New `nestedStepContexts(specs, …)`: two-or-more `.step` directives now form
  LTspice's outer×inner Cartesian product (first directive = outermost), composing
  every axis's transform onto each member, joining labels with `", "`, merging the
  innermost temperature, capped at MAX_FAMILY_MEMBERS (16).
- New `runnableStepsFromDirectives` collects specs outermost-first.
- `App.runStepAnalysis` now drives 1..N runnable specs (single spec = old family;
  dropped the now-unused `stepFromDirectives`/`stepContexts`/`isRunnableStep`
  imports there).

### Files touched
- src/simulation/stepFamily.ts, src/simulation/stepFamily.test.ts, src/App.tsx,
  FEATURE_PARITY.md

### Tests
965 passing (stepFamily 10→18: single-spec parity, 2-param product, source×temp
composition, product cap, up-front source validation, empty). typecheck clean.
(Note: an earlier full-suite run showed 2 flaky native-ngspice failures caused
by me accidentally running two suites concurrently; a clean serial run is 965/965.)

### FEATURE_PARITY items updated
- §4 `.step` — nested sweep 🟡 landed.

### Next step
- §6 log/linear axis toggle or probe-in-place; §4 AC/DC-domain step families.

---

## 2026-07-01T18:24Z — auto/ltspice-parity — remaining LTspice expr builtins (§5)

### What I did
- Filled the gaps in `simulation/expr.ts` `FUNCS`: inverse hyperbolics
  `asinh/acosh/atanh`, the `arcsin/arccos/arctan` aliases, `nint`, `db`
  (20·log10|x|), and boolean helpers `and/or/not/xor` (operands thresholded at
  0.5, matching `buf`/`inv`). `table` was already handled specially — verified.

### Files touched
- src/simulation/expr.ts, src/simulation/expr.test.ts, FEATURE_PARITY.md

### Tests
957 passing (+3 test cases, 10 new assertions). typecheck clean.

### FEATURE_PARITY items updated
- §5 built-in functions — note expanded (already ✅, now genuinely complete).

### Next step
- §6 log/linear axis toggle or probe-in-place; §4 nested `.step`.

---

## 2026-07-01T18:18Z — auto/ltspice-parity — `.step temp` via resistor tempco (§4)

### What I did
- New pure `simulation/temperature.ts`: `TNOM_C=27`, `stripTcSpec`,
  `parseResistorTemp` (splits an inline `tc=tc1[,tc2]` off a resistor value),
  `resistanceAtTemperature` (LTspice law `R(T)=R0(1+tc1·ΔT+tc2·ΔT²)`), and
  `applyTemperature(components, tempC)` which rescales only tc-bearing resistors
  and passes everything else (tc-less resistors, other kinds, param-expression
  values) through untouched.
- `stepContexts` **temp kind no longer throws**: it builds a real family, one
  context per temperature, with rescaled resistors + `context.temperature`.
  `isRunnableStep` now accepts temp.
- TS solver `positiveValue` strips `tc=` so a tc resistor doesn't crash a plain run.
- `App.runStepAnalysis` forwards each swept temp to native ngspice as a `.temp`
  directive (device models shift too); simplified the now-dead "not supported" msg.

### Files touched
- src/simulation/temperature.ts (new), src/simulation/temperature.test.ts (new)
- src/simulation/stepFamily.ts, src/simulation/stepFamily.test.ts
- src/simulation/linearTransient.ts
- src/App.tsx
- FEATURE_PARITY.md

### Tests
954 passing (+14 new: 14 temperature; stepFamily temp test rewritten from a
throw-assert to a family/rescale check). typecheck clean.

### FEATURE_PARITY items updated
- §4 `.step` — temp run path 🟡 (throws → runs).
- §4 `.temp` — TS resistor temperature coefficients 🟡 landed.

### UX issues found
- Visual QA still blocked (dev port held) — logic verified via unit tests.

### Next step
- §6 log/linear axis toggle or probe-in-place; or §4 nested `.step` / AC-domain
  step families; interim-engine diode/BJT temperature physics.

---

## 2026-07-01T00:20Z — auto/ltspice-parity — Bode phase sub-plot (§6)

### What I did
- `AcPlot` now renders a **phase** sub-plot below the magnitude plot (LTspice
  dual Bode): each trace's `phaseDeg` on a 45°-snapped degrees axis over the same
  log-frequency X. Generalized `bodePath` → `bodeValuePath(values, freqs, {min,
  max,f0,f1})` and delegated magnitude through it; phase bounds computed in the
  `plot` memo. No new numeric logic (SVG render helper, verified via typecheck +
  the existing AcPlot tests); pure margin/delay math from earlier stays tested.

### Files touched
- src/components/SimulationPanel.tsx (bodeValuePath refactor + phase svg + phase bounds)

### Tests
940 passing (no new — render-only change); typecheck clean.

### FEATURE_PARITY items updated
- §6 "Bode (AC mag/phase)" — phase now plotted, not just magnitude.

### UX issues found
- Visual QA still blocked (dev port held, per §9) — change verified by typecheck +
  mirroring the tested magnitude path. Would like a screenshot next interactive run.

### Next step
- §6 log/linear axis toggle or probe-in-place; or §4 `.step temp` path.

---

## 2026-07-01T00:16Z — auto/ltspice-parity — Bode loop-stability margins (§6)

### What I did
- New pure `simulation/stability.ts`: `stabilityMargins(freqs, magDb, phaseDeg)`
  returns phase margin (180°+φ at the 0 dB gain crossover) and gain margin
  (−gain at the −180° phase crossover) with each crossover frequency, found by
  interpolating the crossing in dB/deg vs **log-frequency**; `null` when no
  crossover. Exposes the reusable `firstCrossing` interpolator.
- AC meter row now shows **PM** and **GM** metrics (red when negative/unstable).
- Added a `.metric.red` CSS rule (uses `--danger`).

### Files touched
- src/simulation/stability.ts (new), src/simulation/stability.test.ts (new, 10)
- src/components/SimulationPanel.tsx (PM/GM metrics), src/App.css (.metric.red)

### Tests
940 passing (+10 here) — all green; typecheck clean.

### FEATURE_PARITY items updated
- §6 — added "Loop-stability margins" 🟡 (PM/GM landed).

### UX issues found
- PM/GM assume the primary trace is the open-loop response; no per-trace picker
  yet. Fine for the common single-output Bode case.

### Next step
- §6 log/linear axis toggle or standalone phase pane; or §4 `.step temp` path.

---

## 2026-07-01T00:11Z — auto/ltspice-parity — AC group delay (§6)

### What I did
- New pure `simulation/groupDelay.ts`: `unwrapPhaseDeg` removes ±360° phase-wrap
  cliffs so differentiating across a ±180° crossing doesn't spike; `groupDelay`
  computes τ = −dφ/dω in seconds (central difference interior, one-sided ends,
  degrees→Hz conversion τ = −dφ_deg/(360·df)); duplicate/degenerate inputs → 0.
- Wired a **GRP DELAY** metric (primary trace's peak τ) into the AC meter row.

### Files touched
- src/simulation/groupDelay.ts (new), src/simulation/groupDelay.test.ts (new, 12)
- src/components/SimulationPanel.tsx (import + peak-group-delay metric)

### Tests
930 passing (+12 new here) — all green; typecheck clean.

### FEATURE_PARITY items updated
- §6 "Log/linear axes, dB, phase, group delay" — group delay ⬜→🟡.

### UX issues found
- AC pane still plots magnitude only (no standalone phase/group-delay trace pane);
  group delay currently surfaces as a single peak metric. Future §6 polish.

### Next step
- §6 log/linear axis toggle or standalone phase pane; or a §4/§3 partial.

---

## 2026-07-01T00:06Z — auto/ltspice-parity — per-trace physical unit for plotted expressions (§6)

### What I did
- Recovered the rescued WIP checkpoint (`origin/auto/ltspice-parity-wip`) which
  added `exprUnit.ts` (dimensional inference) but died mid-wiring: the
  `commonTraceUnit` import in `SimulationPanel` was unused (would break a clean
  build) and the scope axis still hardcoded "V".
- Finished the integration: the scope value-axis MAX/MIN labels now format with
  the traces' shared unit via `commonTraceUnit(traces.map(t => t.unit)) || "V"`,
  so a probed branch current reads in A, a `V·I` power expression in W, etc.
- Added `exprUnit.test.ts` — 16 hand-computed cases covering V/A/W/Ω/S, scaling,
  abs/min/max dimension preservation, transcendental unit-stripping, mismatched
  sums, malformed input (never throws), and `commonTraceUnit` agreement/disagree.

### Files touched
- src/simulation/exprUnit.ts (from WIP), src/simulation/exprUnit.test.ts (new, 16)
- src/simulation/expr.ts (export Node), src/simulation/linearTransient.ts (TraceUnit)
- src/simulation/plotExpression.ts (label by inferred unit)
- src/components/SimulationPanel.tsx (axis unit from commonTraceUnit)

### Tests
918 passing (+16 new) — all green; typecheck clean.

### FEATURE_PARITY items updated
- §6 "plot arbitrary expressions" — per-trace axis unit now correct (A/W/Ω), not always V.

### UX issues found
- None new. Scope axis still shows only one shared unit; a mixed V+A pane falls
  back to "V" (LTspice would use a dual axis) — noted as future §6 polish.

### Next step
- Pick the next unchecked FEATURE_PARITY item (continue §6 viewer polish or §4/§3).

---

## 2026-06-30T16:14Z — auto/ltspice-parity — VDMOS power MOSFETs emit 3-terminal ngspice lines (§3)

### What I did
- Implemented §3 "MOSFET level/VDMOS power models" (was ⬜): a MOSFET that
  resolves to a `.model … VDMOS(…)` definition now emits ngspice's **3-terminal**
  VDMOS device line `M nd ng ns model` instead of the 4-terminal level-1 MOS form.
  ngspice's VDMOS is a 3-pin device; the 4th node it would otherwise see is the
  model's optional thermal node, so emitting the bulk there silently mis-models
  the device (and an LTspice 3-pin VDMOS symbol leaves Tau's `nmos`/`pmos` bulk
  pin unconnected → floating-node deck error). Non-VDMOS MOSFETs keep 4 terminals.
- New `definedModelTypes(directives)` in `engine/modelDirectives.ts` (name→type
  map) and `standardModelType(name)` in `engine/standardModels.ts` so the deck
  builder knows a model's type without re-parsing at the call site. `spiceNetlist`
  collects the VDMOS-typed model names (from document directives + any bundled
  standard part) and threads an `isVdmos` predicate into `componentLines`.

### Files touched
- src/engine/modelDirectives.ts (+definedModelTypes), src/engine/modelDirectives.test.ts (+4 tests)
- src/engine/standardModels.ts (+standardModelType), src/engine/standardModels.test.ts (unchanged, still 8)
- src/engine/spiceNetlist.ts (vdmosModels set + 3-vs-4-node nmos/pmos emission)
- src/engine/spiceNetlist.test.ts (+2 emission tests)
- FEATURE_PARITY.md (§3 VDMOS ⬜→🟡)

### Tests
902 passing (was 896; +6). Typecheck clean. ngspice-46 verified the 3-node VDMOS
form (`M1 d g s nv` → Id=32.2 A at Vgs=5, Vto=2, Kp=8); generated deck for a VDMOS
`.model` emits `M1 n n n PWRN` (3 nodes, no bulk).

### FEATURE_PARITY items updated
- §3 "MOSFET level/VDMOS power models, body diode" ⬜→🟡.

### UX issues found
- None (deck-builder internal).

### Next step
Bundle real power-MOSFET VDMOS model params by name so class-d's `RSR015P06`/
`QS6K1` resolve to real devices instead of the generic level-1 starter (they have
no inline `.model`); or pick a clean self-contained §6 item (probe-a-device →
plot its current in the waveform viewer, already flagged NEXT in §4 .meas).

## 2026-06-30T02:32Z — auto/ltspice-parity — bridged port nets keep the parent's name + corpus triage (§1)

### What I did
- Triaged the full 82-file acceptance corpus (throwaway smoke, removed): **67/82
  import warning-clean without a resolver, effectively 68 with the new
  hierarchy resolver** (class-d_starter's `deadtime` now inlines). The remaining
  ~15 are a long tail of **distinct one-off symbols** (each blocks ~1 file):
  dflop/sample (stateful digital — need a real digital engine), modulate,
  schmtbuf, nigbt (IGBT), iso16750-2/iso7637-2 (automotive pulse-gen blocks),
  towtom2, lt1184f (vendor subckts), xtal, diac/triac, varistor. The earlier
  "and:26 / inv:11" tallies were per-*symbol*; only **4 files** use DIGITAL
  devices and 2 of those also need sequential logic — so digital gates are far
  lower file-leverage than they first looked. No single high-leverage import
  item remains; logged for a future dedicated run.
- Polished the hierarchy feature: a bridged port net now resolves under the
  **user's own label** (e.g. `V(vpwm)`) instead of the synthetic `<inst>:<port>`.
  The body-side port label and parent-side bridge are deferred and registered
  after the parent's FLAGs, so a coincident parent net label wins the net name.
  Verified on the real `class-d_starter.asc`: nets now read
  `vpwm,vgp,vgn,vcc,vee,vo,vsine,vtr` (+ private `X1/vrcm`,`X1/vrcp`), 0 import
  warnings, 0 netlist warnings.

### Files touched
- src/io/ascImport.ts (split internal vs port labels; defer bridges past FLAGs)
- src/io/ascImport.test.ts (+1: parent net name wins over the synthetic)

### Tests
853 passing (was 852; +1 new). Typecheck clean.

### FEATURE_PARITY items updated
- §1 hierarchical (already 🟡) — port-net naming now author-faithful.

### UX issues found
- None new. UX debt unchanged (friendlier hierarchy sibling-discovery flow).

### Next step
A future run should tackle the stateful **digital A-device** engine (dflop/
sample/schmtbuf) or render imported symbols at LTspice geometry (§1 visual
parity); both are large enough to merit a dedicated session. Alternatively
validate the now-clean `class-d_starter.asc` `.tran`/Efficiency `.meas` once
the RSR015P06/QS6K1 power-MOSFET models are bundled (§7).

## 2026-06-30T02:25Z — auto/ltspice-parity — hierarchical `.asc` subcircuit flattening (§1)

### What I did
- A smoke over the user's own files showed the **only** remaining import warning
  on the **flagship** `class-d_starter.asc` was its `deadtime` X1 — a `.asc`
  used as a symbol (hierarchical block). Implemented import-time flattening:
  - `parseAsy()` reads LTspice `.asy` `BLOCK` symbols → ports sorted by
    SpiceOrder (name + symbol-local position).
  - `ascToSchematic(doc, { resolveSubcircuit })` resolves an unmapped symbol to
    a `{ symbol, body }` block and **inlines** the body: each `.asy` pin bridges
    to the parent net at the instance's world pin position via a synthetic
    `<inst>:<pin>` net label (parent side) + a same-named rename of the body's
    port net (body side); every other body net is privatised `<inst>/…`; ground
    (`0`/`GND`) stays global (ngspice subckt node-0 semantics); the body is
    packed into a disjoint X-region (shared placement cursor) so no body
    geometry can short against parent/sibling content. Body directives dropped.
    Recurses for nested blocks with depth + self-reference (cycle) guards.
  - `makeSubcircuitResolver(readFiles)` builds a resolver from sibling-file text
    (pure; FS stays out of the module).
  - Open dialog (`ShellPanels.tsx`) now multi-selects (and accepts `.asy`):
    sibling `.asy/.asc` are pre-read and fed as the resolver, so the user can
    open `class-d_starter.asc` + `deadtime.asy` + `deadtime.asc` together and
    the block inlines. Single-file open unchanged.
- Verified on the **real** files (throwaway smoke, since removed): class-d_starter
  imports with **zero** warnings — 33 components (X1.D1…X1.U2 all present), all
  five ports (pwm/gp/gn/vcc/vee) bridge to vpwm/vgp/vgn/vcc/vee, `extractCircuit`
  returns 16 nets with ground resolved and **no** net warnings.

### Files touched
- src/io/ascImport.ts (parseAsy, SubcircuitDef/Resolver, flattenSubcircuit,
  ascToSchematic options, makeSubcircuitResolver)
- src/io/ascImport.test.ts (+7: parseAsy order, inline+prefix, drop body
  directives, port-bridge topology, two-instance isolation, self-ref guard,
  no-resolver skip)
- src/components/ShellPanels.tsx (multi-file Open → sibling resolver)
- FEATURE_PARITY.md (§1 hierarchical ⬜→🟡)

### Tests
852 passing (was 845; +7 new). Typecheck clean.

### FEATURE_PARITY items updated
- §1 "Hierarchical schematics" ⬜ → 🟡 (import-flattening complete end-to-end;
  native subckt device / hierarchy re-export still ⬜).

### UX issues found
- Open is now multi-select; no visual layout change. Headless screenshot still
  blocked, so no pixel QA. UX debt: a friendlier hierarchy flow (auto-discover
  siblings, or a folder picker) would beat shift-selecting dependencies.

### Next step
Add `.meas`/run validation of the now-fully-imported `class-d_starter.asc`
against LTspice (it has `.tran 3m` + Efficiency `.meas`), or render imported
symbols at LTspice geometry (§1 visual parity) so inlined blocks draw correctly.

## 2026-06-30T02:00Z — auto/ltspice-parity — bank op-amp + E/G source pins from real .asy geometry (§1)

### What I did
- Ran a throwaway smoke over all 82 acceptance files: 82 import, 82 build a deck,
  but only **45 were warning-clean**. The dominant warning was "placed without
  pin-accurate geometry (connections may be wrong)" for **op-amps** (~18 files,
  incl. the key-goal `deadtime.asc`) and **E/G controlled sources** (~8 files).
- Read the real LTspice 17.2.4 `lib/sym/OpAmps/*.asy` + `e/e2/g/g2.asy` pin
  geometry and banked it into `LTSPICE_PINS`:
  - Two op-amp families: `opampC` (centered UniversalOpAmp/UniversalOpAmp2:
    In+(-32,16)/In-(-32,-16)/OUT(32,0)) and `opampO` (the offset layout shared by
    `opamp.asy`, `opamp2.asy` and EVERY vendor part — In+(-32,80)/In-(-32,48)/
    OUT(32,64)). Verified the offset family is universal across AD711/OP07/AD823/
    LT1001/LT1028/opamp2. Tau ignores the v+/v- supply pins (ideal 3-terminal
    model, `netlist.ts:229`) so banking in+/in-/out is exactly right.
  - VCVS `e`/`e2` and VCCS `g`/`g2`: control pair P/N on the left (x=-48), output
    pair on the right; the `2` variants swap controls, and `g` reverses output
    polarity vs `e`. Ordered to Tau's cp,cn,op,on roles.
- `ltPinKey` now detects op-amps via `base.includes("opamp")` (mirroring
  `ltspiceTypeToKind`) and maps e/e2/g/g2. F/H stay unbanked (their control is a
  named device, not a pin pair).

### Files touched
- src/io/ascImport.ts (LTSPICE_PINS: opampC/opampO/vcvs/vcvs2/vccs/vccs2; ltPinKey)
- src/io/ascImport.test.ts (+3 tests: centered opamp, offset opamp, E+G pins;
  fixed the now-stale "unmappable symbols" test that assumed opamps warn)
- FEATURE_PARITY.md (§1: opamp/E-G banking note; clean coverage 45→67/82)

### Tests
845 passing (was 842; +3 new). Typecheck clean.

### FEATURE_PARITY items updated
- §1 pin-banking: op-amp + E/G controlled-source geometry ✅. Warning-clean
  import 45→67/82 (22 files flipped to pin-accurate).

### UX issues found
- None (importer-only change). Imported op-amps still render at Tau's built-in
  symbol geometry; only the electrical pin positions are LTspice-accurate.

### Next step
The 15 still-warned files each need a NEW component kind: hierarchical sub-block
import (`deadtime` inside class-d_starter — highest leverage, a key-goal file),
DIGITAL `A`-devices (INV/XOR/dflop/SCHMTBUF), SpecialFunctions, DIAC/TRIAC/IGBT.
Alternatively render imported symbols at LTspice geometry (§1 visual parity).

## 2026-06-29T20:28Z — auto/ltspice-parity — map Misc/signal source; acceptance import 67/82 (§1)

### What I did
- Mapped LTspice's `Misc\signal` source variant (the generic DC/AC/PULSE/SINE/…
  voltage symbol, Prefix V, +/− pins identical to `voltage`) to `vsource`. Its
  SINE value + `AC` stimulus flow through `componentValueFromAttrs` unchanged.
- This cleans **Draft1.asc** (a key-goal acceptance file), raising acceptance
  import coverage to **67/82** of the user's own files importing with zero
  unmapped-symbol warnings (measured this run; up from 66).

### Files touched
- src/io/ascImport.ts (ltspiceTypeToKind + ltPinKey: signal → vsource/voltage)
- src/io/ascImport.test.ts (+2: type map + SINE/AC import with pins)
- FEATURE_PARITY.md (§1 signal note + acceptance-coverage line)

### Tests
842 passing (was 841; +1 net). Typecheck clean.

### FEATURE_PARITY items updated
- §1 alias-symbols: signal→vsource; recorded 67/82 acceptance import coverage.

### UX issues found
- None (importer-only change).

### Next step
The remaining 15 unmapped acceptance files need bigger items: hierarchical-block
import (`deadtime` used as a sub-schematic in class-d_starter — §2 hierarchy),
DIGITAL `A`-device primitives (160.asc), and DIAC/TRIAC/IGBT kinds (dimmer/IGBT).
Hierarchical blocks unblock the class-d key-goal file — highest leverage next.

## 2026-06-29T20:24Z — auto/ltspice-parity — bundle real LTspice JFET models by name (§3/§7)

### What I did
- Extended the standard-model bundle with 7 real LTspice JFETs from
  `lib/cmp/standard.jft` (verbatim params, `mfg=` stripped, `Vk= 80`→`Vk=80`
  normalized): NJF 2N3819/J309/J310/2N5484/2N5486, PJF 2N5460/J175. A JFET that
  references one of these by name now emits its real model into the deck (the
  device line uses the part name) instead of the generic `TAU_NJF`/`TAU_PJF`.
- Verified in ngspice-46: the models load and solve; the only warnings are
  LTspice-extra params ngspice ignores (Isr, Alpha, Vk, …) — non-fatal, exactly
  like the existing diode/BJT bundle.

### Files touched
- src/engine/standardModels.ts (7 JFET model lines + updated doc comment)
- src/engine/standardModels.test.ts (+1), src/engine/spiceNetlist.test.ts (+1)
- FEATURE_PARITY.md (§3 JFET note)

### Tests
841 passing (was 839; +2). Typecheck clean.

### FEATURE_PARITY items updated
- §3 JFET: bundled real models note added.

### UX issues found
- None (engine-only change).

### Next step
MESFET/IGBT kinds, or a browser TS-solver JFET stamp, or move to §2 capture
features (multi-select / rubber-band wire move) for UI parity.

## 2026-06-29T20:20Z — auto/ltspice-parity — import Misc\jumper as a wire net-tie (§1)

### What I did
- `Misc\jumper` (≈26 corpus uses) is a graphical 0 Ω net-tie — LTspice emits no
  SPICE device for it. `ascToSchematic` now detects the `jumper` leaf type and
  pushes a `WIRE` between its two pins (jumper.asy +(-32,64)/-(32,64), orientation
  transformed) instead of skipping it with a warning, so the shorted nets merge
  exactly as LTspice intends.

### Files touched
- src/io/ascImport.ts (jumper → wire in ascToSchematic)
- src/io/ascImport.test.ts (+1 test)
- FEATURE_PARITY.md (§1 alias note)

### Tests
839 passing (was 838; +1). Typecheck clean.

### FEATURE_PARITY items updated
- §1 alias-symbols: added the jumper→wire net-tie sub-bullet.

### UX issues found
- None (importer-only change).

### Next step
Bundle real JFET models (2N3819/J309) by name like the BJT/diode bundle, or add
MESFET/IGBT, or move to §2 capture (multi-select / rubber-band wire move).

## 2026-06-29T20:17Z — auto/ltspice-parity — JFET (njf/pjf) component kind (§3)

### What I did
- Added N- and P-channel JFETs end-to-end (`njf`/`pjf`), parallel to nmos/pmos
  — an explicitly-listed missing kind (§3 "JFET, MESFET, IGBT") with 15 corpus
  uses (previously skipped on import).
- 3-terminal D/G/S: pin geometry (`pins.ts`), schematic glyph (`symbols.tsx`,
  vertical channel + gate arrow whose direction encodes polarity), palette
  entries (`catalog.ts`, Semiconductors), and deck emission `J<name> d g s
  <model>` with bundled generic `TAU_NJF`/`TAU_PJF` `.model` lines
  (`Vto=∓2 Beta=1m Lambda=1e-4`). Prefix `J`; added to the model-emit /
  standard-model / SEMI_KINDS sets.
- Import maps LTspice `njf`/`pjf` with the real `.asy` pin offsets (D 48,0 /
  G 0,64 / S 48,96 — gate at dy=64, unlike the MOSFET's dy=80) banked in
  `LTSPICE_PINS`; export reverse-map round-trips. Native-engine only (nonlinear;
  not in any TS-solver allowlist).

### Files touched
- src/schematic/types.ts, pins.ts, catalog.ts, symbols.tsx
- src/engine/spiceNetlist.ts (models, needs/semi sets, deck case, prefix)
- src/engine/spiceNetlist.test.ts (+1), src/io/ascImport.ts, ascImport.test.ts (+2)
- src/io/ascExport.ts (round-trip map)
- FEATURE_PARITY.md (§3 JFET ⬜→🟡; kinds list)

### Tests
838 passing (was 835; +3 net). Typecheck clean. ngspice-46 live-verified the
NJF common-source bias: V(dr)=7.75 V → Id=2.25 mA = Beta·(Vgs−Vto)² exactly.

### FEATURE_PARITY items updated
- §3 "JFET, MESFET, IGBT": ⬜ → 🟡 (JFET done). Kinds list += NJF/PJF.

### UX issues found
- JFET palette entries have no hotkey (q/p taken); reachable via the palette.
  Imported JFETs still render at Tau's fixed geometry (pins override-accurate).

### Next step
MESFET/IGBT, or bundle real JFET models (2N3819/J309) by name like the BJT/diode
bundle. Or chip the unmapped list further (`Misc\jumper` = 26, a net-tie short).

## 2026-06-29T20:12Z — auto/ltspice-parity — map alias SYMBOL types to existing kinds (§1)

### What I did
- Surveyed the whole user corpus for `SYMBOL` types the importer still skipped,
  then mapped the ones that are just packaging variants of kinds Tau already has:
  `varactor`/`SMdiode` → diode, `Misc\battery` → vsource,
  `RN55upright`/`UprightPowerResistor` → resistor.
- Banked the two custom PAsystem pin layouts (`smdiode` A(0,-32)/K(0,32),
  `rn55` A(0,-32)/B(0,0) — both vertical, unlike the standard res/diode banks)
  in `LTSPICE_PINS`; varactor + battery reuse the existing diode/voltage banks.
- Result: **98 previously-skipped symbol instances across the user's `.asc`
  files now import** with pin-accurate connectivity instead of being dropped
  with a "no Tau equivalent" warning.

### Files touched
- src/io/ascImport.ts (ltspiceTypeToKind + LTSPICE_PINS + ltPinKey)
- src/io/ascImport.test.ts (+7 tests: type mapping + pin-geometry import)
- FEATURE_PARITY.md (§1 alias-symbol note)

### Tests
835 passing (was 832; +3 net after the survey throwaways removed). Typecheck
clean. A corpus re-survey confirms 98 instances now resolve a kind.

### FEATURE_PARITY items updated
- §1 import `.asy` symbols: added a 🟡 sub-bullet (alias symbols map to kinds).

### UX issues found
- A mapped varactor/SMdiode still needs its `.model` to behave correctly (it
  imports as a generic diode); tracked under §3 model coverage. Not a regression
  — it was fully skipped before.

### Next step
Continue chipping the unmapped list — `njf` (JFET, 15 uses) is a real new kind;
`Misc\jumper` (26) is a short (map to a 0 Ω tie); the `PowerProducts\*` vendor
parts need `.asy`+`.sub` import (the big ⬜). Or move to §2 capture features.

## 2026-06-29T20:10Z — auto/ltspice-parity — ideal lossless transmission line (`tline`) component kind (§3)

### What I did
- Added a full `tline` (ideal lossless transmission line) component kind
  end-to-end — the most-used missing component class in the user's circuits
  (15 `SYMBOL tline` across the corpus, incl. `examples/Educational/
  TransmissionLineInverter.asc`); previously skipped on import with a warning.
- `engine/tlineSpec.ts` (new): `parseTlineSpec` reads LTspice's order-independent
  `Td=<s> Z0=<Ω>` value (SI suffixes, `TD=`/`delay=` spellings, case-insensitive),
  with a robust fallback (Z0=50/Td=1n) that never throws on malformed text;
  `tlineDeckParams` → `Z0=<ohm> TD=<s>`.
- Deck: `buildSpiceDeck` emits `T<name> a1 a2 b1 b2 Z0=.. TD=..` (4-terminal
  2-port). Live-verified in ngspice-46 (matched 75 Ω line shows the correct
  TD-delayed step at the far end). Native engine only — added to no TS-solver
  allowlist, so it's cleanly reported as needing the native engine (like MOS).
- Wired through `types.ts` (kind), `pins.ts` (a1/a2/b1/b2, ordered to match
  LTspice SpiceOrder I1,R1,I2,R2), `catalog.ts` (Electromechanical palette),
  `symbols.tsx` (tapered two-conductor glyph + body/box), and the `.asc`
  importer (`ltspiceTypeToKind`/`ltPinKey`/`LTSPICE_PINS["tline"]` with the real
  `.asy` pin offsets; empty `Value` adopts the `.asy` default `Td=50n Z0=50`).
  Export reverse-map (`kindToLtspiceType`) round-trips `tline`→`tline`.

### Files touched
- src/engine/tlineSpec.ts (new), src/engine/tlineSpec.test.ts (new, 8 tests)
- src/schematic/types.ts, src/schematic/pins.ts, src/schematic/catalog.ts, src/schematic/symbols.tsx
- src/engine/spiceNetlist.ts (case + prefix map), src/engine/spiceNetlist.test.ts (+1 deck test)
- src/io/ascImport.ts (map + pins + default value), src/io/ascImport.test.ts (+3 tests)
- src/io/ascExport.ts (round-trip map)
- FEATURE_PARITY.md (§3 transmission lines ⬜→🟡; kinds list)

### Tests
832 passing (was 821; +11 new). Typecheck clean. Real-file proof: the
educational `TransmissionLineInverter.asc` imports T1 (default `Td=50n Z0=50`)
and T2 (`Td=30n Z0=150`) as `tline` with no "no Tau equivalent" warning.

### FEATURE_PARITY items updated
- §3 Transmission lines (T, LTRA, UR): ⬜ → 🟡 (ideal lossless `T` done).
- §3 kinds list: added `tline` (and `comparator`, previously omitted).

### UX issues found
- None blocking. The `tline` palette entry has no hotkey (the obvious `t` is
  taken by transformer); fine — it's reachable via the palette. Imported `tline`
  renders at Tau's fixed geometry (pins are override-accurate); same known
  cosmetic gap as other imported parts.

### Next step
Pick the next missing high-frequency component class — LTspice DIGITAL gates
(`DIGITAL\\AND`/`INV`, ~37 uses, `A`-device XSPICE primitives) or a structured
param editor (Td/Z0 fields) for `tline` — or move to §2 capture (multi-select).

## 2026-06-29T14:31Z — auto/ltspice-parity — overlay an LTspice .raw reference on the scope (§6/KEY GOAL)

### What I did
- The keystone acceptance-test feature: load LTspice's own `.raw` output and
  overlay it against Tau's results, with a numeric agreement verdict.
- New `simulation/rawOverlay.ts` `buildReferenceOverlay(data, times, tauSignals,
  colors)` — matches reference variables to plotted Tau traces by name
  (case/space-insensitive), resamples each onto Tau's time grid (`resampleOnto`),
  and compares (`compareWaveforms`) → returns dashed reference `Trace[]`,
  per-signal `{normalizedRms, maxAbsError, pass}`, and the unmatched names.
- Wired into `SimulationPanel`: a **Ref .raw** button (file input → `parseRaw`),
  a **Clear ref** button, the dashed overlay traces concatenated into the scope's
  `extraTraces`, and a `.ref-compare` readout showing each matched signal's
  **% RMS + ✓/✗**. New `.scope-trace.ref` dashed style + `REF_COLORS`.

### Files touched
- src/simulation/rawOverlay.ts (new), src/simulation/rawOverlay.test.ts (new, 4 tests)
- src/components/SimulationPanel.tsx (refData state, overlay memo, Ref/Clear buttons,
  comparison readout, dashed ref traces)
- src/App.css (.scope-trace.ref, .ref-compare/.ref-pass/.ref-fail)
- FEATURE_PARITY.md (§1 `.raw` scope overlay note; §6 overlay ✅)

### Tests
821 passing (was 817; +4 new). Typecheck clean. `vite build` succeeds.

### FEATURE_PARITY items updated
- §6 "Overlay an LTspice `.raw` reference on the scope" ✅ (new line); §1 `.raw`
  note updated.

### UX issues found
- UX debt: name-matching only overlays reference signals whose names match a
  plotted Tau trace (works for labelled nets; LTspice auto names like `V(n005)`
  won't match Tau's `N00x`). Acceptable; surfaced as "no reference signal
  matched" with the unmatched names listed. Visual QA of the dashed overlay still
  pending a headless screenshot path.

### Next step
Probe-in-place (§6 ⬜: click a node/wire to add its trace), or AC/step-pane
expression traces (§6), or tune ngspice defaults so the overlay verdict passes
across the real-deck suite (§7).

## 2026-06-29T14:22Z — auto/ltspice-parity — measurement cursors on the transient scope (§6)

### What I did
- New `simulation/cursors.ts` — pure cursor math (LTspice "1 & 2" cursors):
  `fractionToX` maps a 0–1 slider position to an axis value; `cursorReadout`
  interpolates every trace at both cursors and returns t1/t2/Δt/(1/Δt) plus each
  signal's y1/y2/Δy/slope. Clamps to range, NaN-guards coincident cursors,
  validates trace lengths. Reuses the tested `interpolateAt` resampler.
- New `CursorView` collapsible panel on the transient pane (`SimulationPanel`):
  two sliders position the cursors; a meter row shows t1/t2/Δt/(1/Δt) and a
  table lists each shown signal (node V + branch I + plotted expressions) at C1,
  C2, and the delta. Sliders + table (no canvas drag) keep visual risk low.
- New `.cursor-sliders`/`.cursor-table` CSS (theme variables only).

### Files touched
- src/simulation/cursors.ts (new), src/simulation/cursors.test.ts (new, 8 tests)
- src/components/SimulationPanel.tsx (CursorView + render + imports)
- src/App.css (.cursor-sliders/.cursor-table)
- FEATURE_PARITY.md (§6 "Measurement cursors" ⬜→✅)

### Tests
817 passing (was 809; +8 new). Typecheck clean. `vite build` succeeds (99
modules) — confirms the UI bundles. Visual QA still blocked (no headless
screenshot); component mirrors the existing FftView pattern exactly.

### FEATURE_PARITY items updated
- §6 "Measurement cursors (1 & 2, delta readout)" ⬜→✅.

### UX issues found
- UX debt: cursors are slider-driven, not draggable vertical lines on the plot
  (LTspice drags on the trace). Functional + testable now; drag-on-canvas is a
  visual-polish follow-up once headless screenshotting is unblocked.

### Next step
Overlay a loaded `.raw` reference trace on the scope (resample via `resampleOnto`,
show `compareWaveforms` metrics) — the last keystone for the acceptance test.

## 2026-06-29T14:12Z — auto/ltspice-parity — numeric waveform comparison vs LTspice (§7)

### What I did
- New `simulation/waveformCompare.ts` — turns the acceptance test ("reproduce
  LTspice's waveforms exactly") into a number:
  - `interpolateAt` / `resampleOnto` — linear resampling onto an arbitrary time
    grid (also the resampler the future `.raw` scope overlay needs).
  - `compareWaveforms(testT,testV, refT,refV, opts)` — resamples the reference
    onto the test's times over the overlapping interval and reports samples,
    overlap, max/RMS abs error, reference peak-to-peak range, normalized RMS/max,
    and a pass/fail verdict (default 5% RMS / 10% max of full scale). Handles a
    flat reference (no divide-by-zero), partial overlap, and empty/no-overlap
    inputs (throws).

### Files touched
- src/simulation/waveformCompare.ts (new), src/simulation/waveformCompare.test.ts (new, 10 tests)
- FEATURE_PARITY.md (§7 waveform-agreement: tooling 🟡 note)

### Tests
809 passing (was 799; +10 new). Typecheck clean. Tests: linear interp + clamp,
zero-error on mismatched grids, normalized-offset metrics, tolerance pass/fail,
overlap restriction, flat reference, error guards.

### FEATURE_PARITY items updated
- §7 "Match LTspice's defaults … for waveform-level agreement" — added a 🟡
  sub-bullet for the comparison tooling (the tuning itself stays ⬜).

### UX issues found
- None (pure logic). This unblocks an automated/visual LTspice-vs-Tau overlay.

### Next step
Overlay a loaded `.raw` reference trace on the transient scope using
`resampleOnto` + show `compareWaveforms` metrics (§6), or measurement cursors.

## 2026-06-29T14:06Z — auto/ltspice-parity — export Tau results as LTspice .raw (§1)

### What I did
- New `io/rawExport.ts` `serializeRaw(input)` — writes the canonical LTspice
  binary `.raw` (UTF-16LE header, `Variables:` table, `Binary:` marker, var0
  float64 / dependents float32; complex re/im float64 pairs). `inferRawType`
  classifies axis/signal names. `parseRaw(serializeRaw(x))` round-trips for both
  real and complex data.
- Wired a **Save .raw** button onto the transient pane (`SimulationPanel`):
  exports time + every node voltage / branch current / plotted expression so the
  result opens in LTspice's own waveform viewer for a side-by-side comparison.
  Generalized `downloadText` to accept `BlobPart` (string or bytes).
- **Made the `.raw` import test hermetic:** the prior commit's `rawImport.test.ts`
  used `node:fs` (no `@types/node` in this project → `tsc` failed). Replaced the
  on-disk reads with an embedded base64 fixture of the real `_t_startup.op.raw`
  (`rawFixture.ts`); typecheck is green again and the test still exercises the
  genuine UTF-16LE + float64/float32 binary layout.

### Files touched
- src/io/rawExport.ts (new), src/io/rawExport.test.ts (new, 5 tests)
- src/io/rawFixture.ts (new, embedded real .op.raw), src/io/rawImport.test.ts (hermetic)
- src/components/SimulationPanel.tsx (Save .raw button + exportRaw, downloadText BlobPart)
- FEATURE_PARITY.md (§1 `.raw` import+export 🟡→✅)

### Tests
799 passing (was 795). Typecheck clean (also fixes the regression the previous
commit introduced). Round-trip tests cover real transient + complex AC; the
import fixture is a genuine LTspice file.

### FEATURE_PARITY items updated
- §1 "`.raw` waveform export/import" 🟡→✅.

### UX issues found
- Save .raw is disabled until a transient result exists (matches Export CSV).
  Visual QA still blocked (dev port held) — button parallels existing exports.

### Next step
Overlay an imported `.raw` reference trace on the transient scope (§6), or
measurement cursors (§6 ⬜).

## 2026-06-29T13:55Z — auto/ltspice-parity — parse LTspice .raw waveform output (§1)

### What I did
- New `io/rawImport.ts` `parseRaw(buffer)` — reads LTspice's `.raw` simulation
  output so its reference waveforms can be loaded into Tau (the heart of the
  acceptance test: overlay LTspice vs Tau). Decodes the UTF-16LE/ASCII header,
  `Variables:` table, and `Binary:`/`Values:` data with the **exact LTspice
  precision layout** (independent var0 = float64, dependents = float32 unless
  the `double` flag; complex `.ac` = re/im float64 pairs). `rawTrace(data, name)`
  pairs a named variable with the independent axis (magnitude for complex).
- Verified the binary layout empirically against a real file in Python first
  (var0 double + 21 float32 = 92 bytes/point for `_t_startup.op.raw`).

### Files touched
- src/io/rawImport.ts (new), src/io/rawImport.test.ts (new, 7 tests)
- FEATURE_PARITY.md (§1 `.raw` import ⬜→🟡)

### Tests
795 passing (was 788; +7 new). Typecheck clean. Tests cover a synthetic binary
deck (deterministic float64/float32 layout), a synthetic ASCII `Values:` deck,
the no-marker error, and two REAL machine files: `_t_startup.op.raw`
(`V(n001)≈-0.9983`) and `_t_startup.raw` (monotonic time over No. Points). The
real-file tests self-skip (`describe.runIf`) on machines without them.

### FEATURE_PARITY items updated
- §1 "`.raw` waveform export/import" ⬜→🟡 (import parser done; scope overlay +
  export pending).

### UX issues found
- None (no UI surface changed).

### Next step
Overlay an imported `.raw` reference trace on the transient scope (§1/§6), or
measurement cursors (§6 ⬜).

## 2026-06-29T13:48Z — auto/ltspice-parity — import SPICE .cir netlists into a schematic (§1)

### What I did
- New `io/cirImport.ts` `parseCir(text)` — turns a SPICE deck into Tau schematic
  content. Connectivity is electrical via **one net label per device pin**,
  placed at the pin's exact world coordinate so it shares the pin's DSU point key
  in `extractCircuit` (same-named labels merge; `0`/`GND` → ground). No wire
  routing needed; devices land on a deterministic grid.
- Handles R/C/L, V/I, D, Q, M, E/G, B. Parses the title card, `+` continuations,
  `;`/`$` inline comments, `.model` polarity (npn↔pnp, nmos↔pmos), and the
  ambiguous 3-vs-4-terminal MOS/BJT node count by locating the model name in the
  `.model` map. Ties a 3-terminal MOS bulk to its source. Warns + skips
  X/K/F/H/T (subckt, coupling, current-controlled sources, transmission lines).
- Wired into the Open dialog (`.cir`/`.net`/`.sp`/`.spice`), with an empty-deck
  error message.

### Files touched
- src/io/cirImport.ts (new), src/io/cirImport.test.ts (new, 10 tests)
- src/components/ShellPanels.tsx (Open dialog branch + accept list)
- FEATURE_PARITY.md (§1 "import `.cir`" ⬜→✅, line now fully ✅)

### Tests
788 passing (was 778; +10 new). Typecheck clean. Validated with a throwaway test
(removed): real `deadtime.asc` → `buildSpiceDeck` → `parseCir` re-imports all 16
deck devices with 0 warnings, `extractCircuit` yields 10 nets with ground.

### FEATURE_PARITY items updated
- §1 "Export `.cir`/netlist to file; import `.cir`" 🟡→✅.

### UX issues found
- None new. Imported `.cir` parts render at Tau geometry on a grid (no original
  layout exists in a netlist) — expected; connectivity is correct.

### Next step
Measurement cursors on the transient/FFT plots (§6 ⬜, delta readout between two
clicked points), or `.raw` waveform export (§1 ⬜).

## 2026-06-29T13:36Z — auto/ltspice-parity — export Tau schematic → LTspice .asc (round-trip) (§1)

### What I did
- New `io/ascExport.ts` — the inverse of `ascImport.ts`:
  - `serializeAscDocument(doc)` serializes an `AscDocument` to `.asc` text;
    the round-trip `parseAsc(serializeAscDocument(doc)) ≅ doc` holds for all
    structured content (VERSION/SHEET/WIRE/FLAG/SYMBOL/SYMATTR/TEXT).
  - `schematicToAsc({components,wires,netLabels,directives,comments})` builds an
    `AscDocument` from Tau content and serializes it — `ground` parts + net
    labels → FLAGs, components → SYMBOL+SYMATTR (`InstName`/`Value`), Tau
    polyline wires split into single-segment WIREs, directives/comments → TEXT.
  - `kindToLtspiceType` / `rotationToOrientation` reverse maps (chosen so the
    banked-pin symbol type re-imports with the same `pinOverride`).
- Wired a **Save .asc** toolbar button into `ShellPanels` next to Save.

### Files touched
- src/io/ascExport.ts (new), src/io/ascExport.test.ts (new, 11 tests)
- src/components/ShellPanels.tsx (Save .asc button + saveAsc)
- FEATURE_PARITY.md (§1 "Export Tau schematic → .asc" ⬜→✅)

### Tests
778 passing (was 767; +11 new). Typecheck clean. Validated with a throwaway
test (since removed) that imports the real `deadtime.asc` (18 comps/59 wires/13
nets), `class-d_starter.asc` (15/46/8), and `Draft1.asc` (4/10), exports, and
re-imports: all counts/kinds preserved, re-export byte-idempotent, 0 warnings.

### FEATURE_PARITY items updated
- §1 "Export Tau schematic → `.asc` (round-trip)" ⬜→✅.

### UX issues found
- None new. Save .asc disabled on empty document, matching Save.

### Next step
Import a `.cir` netlist back into a schematic (§1, the other half of the 🟡
netlist line), or measurement cursors on the transient/FFT plots (§6 ⬜).

## 2026-06-29T06:56Z — auto/ltspice-parity — FFT THD readout + noise CSV + SPICE netlist export (§6/§1)

### What I did
Three follow-on increments after the FFT view:
- **THD-from-spectrum** (§6, `simulation/fft.ts` `spectrumThd`): fundamental =
  supplied freq or loudest bin above DC; harmonics = bins nearest `2f₀,3f₀,…` to
  Nyquist; `THD = √(Σ harmonic²)/fundamental`. Shown in the FFT view's meter row
  (replaced the BINS metric). +3 tests (50% THD for a half-amplitude 2nd
  harmonic; 0% for a pure tone; explicit-f₀ form), exact on a leakage-free signal.
- **Noise CSV export** (§6): an **Export CSV** button on the noise pane writes
  `freq` + `onoise (V/√Hz)` + `inoise (<unit>)` via the shared `seriesToCsv`/
  `downloadCsv` helpers.
- **SPICE netlist export** (§1, LTspice "View → SPICE Netlist"): a **Netlist**
  button on the transient pane builds the same deck the engine runs
  (`buildSpiceDeck` with the document's `.param` scope) and downloads it as
  `tau-netlist-<date>.cir`; build errors (no ground, no parts) surface inline.
  Generalized `downloadCsv` into a `downloadText` helper.

### Validation
- **End-to-end ngspice check** of the netlist export: imported the real
  `~/Downloads/LTspice_export/deadtime.asc` through `importAsc` → `buildSpiceDeck`,
  wrote the deck to `/tmp`, and ran it in ngspice 17 — parsed cleanly and solved
  a 1008-row transient (the batch-mode "needs .print" notice is expected; the FFI
  path reads vectors). Deck included the bundled `1N4148` model, both op-amp
  VCVS stages, and the resolved `.tran` line. (Throwaway test removed.)

### Files touched
- src/simulation/fft.ts (+spectrumThd), src/simulation/fft.test.ts (+3 tests)
- src/components/SimulationPanel.tsx (THD metric, noise CSV, netlist export, downloadText)
- FEATURE_PARITY.md (§6 FFT THD note; §6 CSV noise pane; §1 netlist export ⬜→🟡)

### Tests
767 passing (was 764; +3 new). Typecheck clean.

### FEATURE_PARITY items updated
- §6 FFT: THD readout done. §6 CSV: noise pane added. §1 "Export `.cir`/netlist
  to file" ⬜→🟡 (netlist export done; `.cir` import still pending).

### UX issues found
- None new.

### Next step
Import a `.cir` netlist back into a schematic (§1), or measurement cursors on the
transient/FFT plots (§6 ⬜) — delta readout between two clicked points.

## 2026-06-29T06:47Z — auto/ltspice-parity — FFT of a waveform on the transient scope (§6)

### What I did
- **FFT of a transient waveform** (§6 ⬜→🟡, LTspice "View → FFT"), pure-logic
  core in `simulation/fft.ts`:
  - `fftRadix2` — in-place iterative radix-2 Cooley–Tukey FFT (bit-reversal +
    butterflies); throws on non-power-of-two length.
  - `windowValue` — rectangular/Hann/Hamming/Blackman window coefficients.
  - `waveformSpectrum` — linear-resamples a (non-uniform) transient signal onto a
    power-of-two uniform grid over the time window, windows it, FFTs, and returns
    the **one-sided amplitude spectrum** (DC…Nyquist) with coherent-gain
    normalization so a pure `A·cos(ωt)` reads amplitude `A` at its bin (DC and
    Nyquist carry no ×2 fold). Magnitude in linear + dB (floored), phase in deg.
  - `runWaveformFft` resolves `V(node)`/bare-node/`I(ref)` against a transient
    `MeasWaveform`; `dominantFrequency` reports the loudest bin above DC.
- **UI:** collapsible **FFT spectrum** view under the transient scope
  (`SimulationPanel` `FftView`): signal + window selectors, magnitude on a
  log-frequency / dB axis (shares `bodePath` with the Bode plot), peak-frequency
  / bin-count / DC readout. Collapsed by default so the transform only runs when
  opened. New `.fft-toggle`/`.fft-view` CSS (theme variables, no hardcoded color).

### Files touched
- src/simulation/fft.ts (new), src/simulation/fft.test.ts (new, 19 tests)
- src/components/SimulationPanel.tsx (FftView + render in transient pane)
- src/App.css (.fft-toggle/.fft-view)
- FEATURE_PARITY.md (§6 FFT ⬜→🟡)

### Tests
764 passing (was 745; +19 new). Typecheck clean.

### FEATURE_PARITY items updated
- §6 "FFT of a waveform; THD readout" ⬜→🟡 (spectrum + UI done; THD-from-spectrum
  + FFT cursor still pending — `.four` already gives THD over a known fundamental).

### UX issues found
- None new. FFT view is collapsed by default to avoid recomputing on every
  transient run; reuses the Bode plot's log-frequency rendering for consistency.

### Next step
Add a THD-from-spectrum readout to the FFT view (pick the fundamental as the
dominant bin, sum harmonic bins) and/or measurement cursors (§6 ⬜) on the
transient/FFT plots — delta readout between two clicked points.

## 2026-06-29T06:37Z — auto/ltspice-parity — waveform viewer: expression plots + CSV export (§6)

### What I did
Two §6 waveform-viewer features, both with a pure testable core reused from
existing infrastructure:
- **Plot arbitrary expressions** (`simulation/plotExpression.ts`): an expression
  bar under the transient scope evaluates any expression of the simulated
  signals (`V(out)-V(in)`, power `V(out)*I(R1)`, `2*V(in)+1`) at every timestep
  and overlays it as a derived trace. Reuses the `.meas` compiler (`compileExpr`,
  now exported from `measure.ts`) so node voltages + branch currents resolve
  through one evaluator. Bad signal names show a clear error; traces managed via
  labelled removable chips. WaveformPlot gained an `extraTraces` prop folded into
  its bounds + rendering.
- **CSV export** (`simulation/waveformCsv.ts`): **Export CSV** buttons on the
  transient pane (`time` + node traces + branch currents + plotted expressions),
  the AC pane (`freq` + per-trace mag(dB)/phase(°)) and the DC pane (swept source
  + each net voltage), sharing a `downloadCsv` helper. RFC-4180 header quoting,
  non-finite samples as empty cells.

### Files touched
- src/simulation/plotExpression.ts (+ .test.ts, 6 tests)
- src/simulation/waveformCsv.ts (+ .test.ts, 4 tests)
- src/simulation/measure.ts (export compileExpr)
- src/components/SimulationPanel.tsx (expr bar, chips, export button, exprTraces)
- src/App.css (.expr-* styles)
- FEATURE_PARITY.md (§6 expression-plot + CSV notes)

### Tests
745 passing (was 735; +10 new). Typecheck clean. `pnpm vite build` succeeds.

### FEATURE_PARITY items updated
- §6 plot arbitrary expressions 🟡 (was ⬜); §6 export CSV 🟡 (was ⬜).

### UX issues found
- Live headless screenshot still blocked (dev port held per design log), so the
  new expression bar was verified via typecheck + production build + following
  existing CSS patterns, not a live screenshot — **UX debt: visual QA pending**.
- Expression traces (incl. power, in W) render on the scope's shared "V" axis;
  per-trace units/axis is future work.

### Next step
§6: measurement cursors (1 & 2 with delta readout) on the transient scope, or
add expression traces to the AC/Bode pane (reuse measureAc's compiler). Also a
good time for a live visual QA pass once the dev port is free (UX debt above).

## 2026-06-29T06:27Z — auto/ltspice-parity — .meas dc + .meas noise domains (§4)

### What I did
Closed the two remaining spectral/sweep `.meas` domains by reusing the
transient measurement core (axis-generic `evaluateMeasurement` + `compileExpr`)
against adapted waveforms — no duplicated parsing or crossing logic.
- **`.meas dc`** (`simulation/measureDc.ts`): `dcResultToWaveform` maps a
  DcSweepResult onto a MeasWaveform with the swept-source value as the axis, so
  `MAX/MIN/FIND AT/WHEN`/chained PARAMs evaluate over the sweep. Fixed a latent
  bug: `runMeasurements` used to route `dc` lines onto the *time* axis — it now
  takes only tran/untyped.
- **`.meas noise`** (`simulation/measureNoise.ts`): `noiseResultToWaveform`
  exposes `onoise`/`inoise` traces over frequency, so `V(onoise)`/`V(inoise)`
  measurements resolve.
- Wired both into `App.tsx` (`dcMeasurements`/`noiseMeasurements` memos) and a
  `MeasTable` under the DC and NOISE plots in `SimulationPanel`.

### Files touched
- src/simulation/measureDc.ts (+ .test.ts, 8 tests)
- src/simulation/measureNoise.ts (+ .test.ts, 7 tests)
- src/simulation/measure.ts (runMeasurements no longer routes `dc`)
- src/App.tsx, src/components/SimulationPanel.tsx (memos + MeasTables)
- FEATURE_PARITY.md (§4 .meas dc/noise notes)

### Tests
735 passing (was 720; +15 new). Typecheck clean.

### FEATURE_PARITY items updated
- §4 `.meas`: dc + noise domains ✅ (all of tran/ac/dc/noise now run).

### UX issues found
- None new.

### Next step
§4: expose branch currents in the waveform viewer (probe a device → plot its
current, §6), or a native (FFI) DC runner for nonlinear `.dc` sweeps.

## 2026-06-29T06:20Z — auto/ltspice-parity — nested 2nd-source .dc sweep (§4)

### What I did
- Implemented LTspice's **nested two-source `.dc` sweep** (`.dc V1 … V2 …`,
  used 37× by the user's circuits), the last documented gap on the `.dc` item.
  - `parseDcDirective` now reads an optional second leg (SPICE inner-source-first
    order); `DcSweepSpec` gains optional `source2/start2/stop2/step2`.
  - `runDcSweep` re-runs the inner sweep once per outer value and returns the
    result as a **fan of curves** — one annotated net trace per outer value
    (`V(out) (V2=2)`), sharing the inner sweep X axis, exactly how LTspice draws
    nested DC. Refactored the per-step solve into `solveInnerSweep`.
  - Each net now carries a `ground` flag; `DcPlot` filters on it (instead of the
    literal `"GND"` label, which the annotation broke). Outer loop capped at 64.
  - Native ngspice deck (`spiceNetlist.ts` `kind:"dc"`) appends
    `<src2> <start2> <stop2> <inc2>` to the `.dc` line.

### Files touched
- src/simulation/dcSweep.ts (nested parse + fan runner)
- src/simulation/dcSweep.test.ts (+5 tests)
- src/engine/spiceNetlist.ts (nested .dc emission)
- src/engine/spiceNetlist.test.ts (+1 test)
- src/components/SimulationPanel.tsx (DcPlot uses `ground` flag)
- FEATURE_PARITY.md (§4 .dc nested note)

### Tests
720 passing (was 714; +6 new). Typecheck clean. **Validated against ngspice 17**:
a summing node V(out)=(V1+V2)/2 with `.dc V1 0 4 2 V2 0 4 2` produces the same
9-row fan ([0,1,2],[1,2,3],[2,3,4]) as the TS solver — exact match.

### FEATURE_PARITY items updated
- §4 `.dc` nested 2nd-source sweep ✅ (line stays 🟡: native FFI DC runner for
  nonlinear sweeps + manual source picker still pending).

### UX issues found
- None new. DcPlot caps the fan at 6 traces (existing `.slice(0,6)`); a large
  nested sweep shows only the first few curves — acceptable, noted as future
  legend/pick work.

### Next step
Continue §4: add the `.meas dc` domain (run measurements over a DC sweep result),
or wire a native (FFI) DC runner so nonlinear `.dc` sweeps match ngspice.

## 2026-06-29T01:05Z — auto/ltspice-parity — real-.asc op-deck *run* 45 → 70/82 (§3/§4/§7)

### What I did
With all 82 acceptance files now building a deck, measured the next layer —
how many ngspice actually **solves an `.op` for** (a throwaway smoke ran each
deck through `ngspice -b`). Baseline 45/82; drove to **~70/82** with four fixes:
- **`rshunt=1e12` in the default `.options`** (`engine/spiceOptions.ts`): ngspice
  throws a fatal "singular matrix" the instant any node lacks a DC path to ground
  (floating op-amp input, AC-coupled stage, ideal-transformer winding). A 1 TΩ
  shunt from every node fixes it; numerically invisible (a 5 V divider still
  reads 5.000000 V). **+19 files** (Wien/Howland/phono/LoopGain/Linkwitz/GFT/…).
- **`LPNP`/`LNPN` → `PNP`/`NPN`** (`engine/modelDirectives.ts`): ngspice has no
  lateral-BJT model type, so the discrete LM741/LM308 `.model PN LPNP(...)` was
  "Unknown model type lpnp - ignored" → every transistor type-mismatched.
- **Split multi-directive TEXT blocks on `\n`** (`engine/spiceNetlist.ts`):
  LTspice packs `.ic v(vo)=0.5\n.tran 10m` into one TEXT; the single-line
  directive consumers (.options/.temp/.ic/K) now read `expandDirectiveLines`
  so two directives don't collapse into one malformed line (Draft6).
- **Rewrite `K` coupling refs to renamed inductors** (`engine/couplingDirectives.ts`):
  a K line names inductors by LTspice instance name, but the deck renames an
  inductor whose label isn't a valid ngspice `L…` name (T2a → transmission line),
  so ngspice hit "coupling to non-existent inductor t2b" (Electrometer). The deck
  now passes the label→emitted-name map and the K refs are rewritten.

### Files touched
- src/engine/spiceOptions.ts (+ test), modelDirectives.ts (+ test),
  couplingDirectives.ts (+ test), spiceNetlist.ts (flat directives, inductor map),
  spiceDeck.test.ts (+1 \n-split test)
- FEATURE_PARITY.md (§7 op-run ~70/82 + rshunt convergence aid)

### Tests
714 passing (was 692 at session start; +22 over the whole session). Typecheck
clean. ngspice-46 verified each fix end-to-end.

### FEATURE_PARITY items updated
- §7 added "op-deck *run* ~70/82" + flipped convergence-aids ⬜→🟡 (rshunt ships).
- §3 model-type translation + K-rename notes.

### UX issues found
- None (engine only).

### Next step
The ~12 non-running files are mostly out of ngspice's reach: 4 need external
`.sub` libs not on disk, PLL/PLL2 use `rand()`, SoftDiodeRecovery a proprietary
diode `Vp`, UHFpreamp an unbundled `mrf901`, 2 ISO demos time out, LoopGain2/P2
are deep loop-probe/connectivity cases. Highest-value next: a real **waveform
diff vs. LTspice** on the ~70 that run (the KEY GOAL needs values, not just
convergence) — or resolve `.lib`/`.inc` paths against LTspice's lib dir to
unblock the `.sub` files. P2's shorted-node connectivity (pin geometry on dense
multi-transistor sheets) is its own focused task.

## 2026-06-29T00:45Z — auto/ltspice-parity — real-.asc op-deck build 75 → 82/82 (§1/§3)

### What I did
Reproduced the 75/82 acceptance-deck-build metric (throwaway smoke over the 82
real files = 2 Downloads + 11 Documents/LTspice + 69 Educational) and drove it
to **82/82** with three targeted, fully-tested fixes:
- **Split-field source spec** (`io/ascImport.ts`): LTspice can spread one
  transient function across all four SYMATTR fields (P2.asc I1:
  `Value SINE(` / `Value2 0 100u` / `SpiceLine 5Meg` / `SpiceLine2 0 0 0 1)`).
  `componentValueFromAttrs` only joined the first three — append `SpiceLine2`.
- **`Laplace=H(s)` on E/G sources** (`engine/laplace.ts`, new): a symbolic
  rational expander (polynomial ± × ÷ ** over s, params resolved against the
  scope) emits ngspice XSPICE `s_xfer` num/den coefficient lists (highest-power
  first — empirically confirmed in ngspice-46). Non-rational transfers
  (`exp(-Ts)`, `sqrt`) fall back to the DC gain H(0), exact for an `.op`.
  Unblocked Draft8/PLL/PLL2/TwoTau/HalfSlope. Wired into `buildSpiceDeck`'s
  vcvs/vccs cases. Live-verified: `A0/(1+s/wp1)/(1+s/wp2)` → correct 60 dB
  two-pole AC rolloff in ngspice-46.
- **Chan magnetic-core inductor** (`engine/coreInductor.ts`, new): no ngspice
  saturable-core primitive exists, so size the unsaturated linear inductance from
  the magnetic reluctance `L = N²·µ0·A/(Lg + Lm/µi)`, `µi = Br/(µ0·Hc)`.
  `componentValueFromAttrs` now preserves the core geometry (was dropping
  A=/Lm=/Lg=/N=). Unblocked NonLinearTransformer (L1 → 45.7 mH, hand-verified).

### Files touched
- src/engine/laplace.ts (new), laplace.test.ts (new, 10)
- src/engine/coreInductor.ts (new), coreInductor.test.ts (new, 5)
- src/engine/spiceNetlist.ts (Laplace in vcvs/vccs; core inductor; thread params)
- src/engine/spiceDeck.test.ts (+2 Laplace deck-integration tests)
- src/io/ascImport.ts (SpiceLine2 for sources; preserve core geometry)
- src/io/ascImport.test.ts (+1 split-field test)
- FEATURE_PARITY.md (§1 deck-build 82/82; §3 Laplace sub-item)

### Tests
710 passing (was 692; +18 new). Typecheck clean. ngspice-46 verified the s_xfer
AC rolloff and the emitted decks.

### FEATURE_PARITY items updated
- §1 real-.asc op-deck build 75 → **82/82** (every acceptance file builds a deck).
- §3 E/F/G/H: added 🟡 `Laplace=H(s)` sub-item (s_xfer + DC fallback).

### UX issues found
- None (engine/import only; no UI surface changed).

### Next step
Deck-BUILD is 82/82 but build ≠ converge: pivot to **waveform fidelity** — run
each acceptance file's own analyses through native ngspice and diff node voltages
vs. LTspice (the KEY GOAL). Or pick a testable UI item: §6 probe-in-place /
expression plotting, or §2 multi-select. NonLinearTransformer's behavioral
G-source loop is singular in ngspice (genuinely needs the Chan model — document,
don't chase).

## 2026-06-28T19:09Z — auto/ltspice-parity — dedicated comparator component kind (§3)

### What I did
- Added a real `comparator` component kind so an **open-loop** comparator clamps
  to explicit rails instead of the shared op-amp's gain-1e6 model saturating to
  ~1e7 V (the documented class-d_starter.asc blocker, §3 finding).
- `engine/comparatorSpec.ts`: `parseComparator` (positional `5 0 0.1` or keyed
  `Vhigh=/Vlow=/Vhyst=` with aliases + SI suffixes, ignores stray tokens) and
  `comparatorDeckLine` emitting an ngspice **ternary** B-source
  `V=(V(in+)-V(in-))>0 ? vhigh : vlow`, with a self-referential `V(out)`-state
  hysteresis form for Schmitt behavior.
- Discovered ngspice rejects LTspice's `if()` ("no such function 'if'") outside
  compat mode; the ternary form is what works — **live-verified both ideal
  (clamps 5V/0V) and hysteretic (asymmetric ±0.5 switching) in ngspice 17.**
- Wired the new kind through types, catalog (palette, empty hotkey — all letters
  taken), pins (in+/in-/out, no supply pins), params (structured Output high/low/
  hysteresis fields), symbols (triangle + step glyph), and the native netlist.
  Nonlinear → stays out of the linear TS solver set (native-engine only).

### Files touched
- src/engine/comparatorSpec.ts (new), comparatorSpec.test.ts (new, 13)
- src/engine/spiceNetlist.ts (comparator case + prefix + import)
- src/engine/spiceDeck.test.ts (+2 deck-integration tests, +NetLabel import)
- src/schematic/{types,pins,catalog,params,symbols.tsx} (new kind plumbing)
- FEATURE_PARITY.md (§3 comparator ⬜ → 🟡)

### Tests
683 passing (was 668; +15). Typecheck clean. ngspice-validated decks.

### FEATURE_PARITY items updated
- §3 Comparators / logic gates ⬜ → 🟡 (comparator kind done; logic/A-devices +
  import mapping pending).

### UX issues found
- Comparator palette entry has an empty hotkey (all 26 letters already assigned);
  it's still placeable via the palette/command palette. UX debt: revisit hotkey
  scheme (e.g. shifted keys or a two-key chord) when the library grows further.

### Next step
Import-map LTspice `Comparators\\*` symbols to the new comparator kind, or pick
the next §3/§4 item (logic gates, or TS-solver mutual-inductance K stamp).

## 2026-06-28T18:55Z — auto/ltspice-parity — coupled-inductor K passthrough (§3)

### What I did
- Real LTspice transformer circuits (Transformer, varactor, Royer) keep winding
  coupling in on-canvas `K` TEXT directives; the deck builder only emitted
  .model/.lib/.options/.temp/.ic, so `K` lines were **silently dropped** —
  simulating a coupled transformer as independent inductors (wrong waveforms).
- New `engine/couplingDirectives.ts couplingLinesFromDirectives()` passes every
  K line through verbatim (ngspice shares LTspice's syntax) with any `{expr}`
  coefficient resolved against the param scope; wired into `buildSpiceDeck`.
- Live-verified in ngspice 17: a 1mH:4mH transformer with K=0.99 steps a 1 V
  sine up to ~1.9 V (turns ratio 2) — physically correct.

### Files touched
- src/engine/couplingDirectives.ts (new), couplingDirectives.test.ts (new, 7)
- src/engine/spiceNetlist.ts (emit coupling lines after model/lib)
- src/engine/spiceDeck.test.ts (+1 deck-integration test, +Lind builder)
- FEATURE_PARITY.md (§3 coupled-inductor K → 🟡)

### Tests
668 passing (was 659; +8 wait, +9 incl deck). Typecheck clean.

### FEATURE_PARITY items updated
- §3 Coupled inductors `K` ⬜ → 🟡 (native passthrough; TS-stamp + UI pending).

### UX issues found
- None (engine only).

### Next step
TS-solver mutual-inductance (`K`) stamp for the browser path; or a placeable K
symbol so users don't hand-edit the directive. Or continue native-only deck
blockers (Laplace E/G — note arbitrary s-expressions like exp(-.001*s) can't map
to ngspice's polynomial-only s_xfer, so full Laplace parity is partly
impossible). Or pivot to testable §6 (expression plotting) / §2 (multi-select).

## 2026-06-28T18:40Z — auto/ltspice-parity — real-.asc deck build 34→75/82 (§1/§5)

### What I did
Drove the real-acceptance op-deck build from **34/82 to 75/82** with four
targeted, fully-tested fixes (throwaway smoke over all 82 files guided each):
- **Windows-1252 decoding** (`io/ascImport.ts` `decodeSchematicText`): the single
  biggest blocker. LTspice saves many single-byte `.asc` files where the micro
  prefix is the lone high byte 0xB5 (`47µ`); decoding as UTF-8 mangled it to
  U+FFFD so `47µ` no longer parsed. Now strict-decode UTF-8 first and fall back
  to windows-1252 on invalid bytes → 0xB5 = µ (U+00B5). Unblocked 32 files.
- **Plural `.params`** (`simulation/paramScope.ts`): LTspice accepts both `.param`
  and `.params`; we only matched the singular, leaving `{6*R}` unresolved
  (notch, passive, varactor, phaseshift2).
- **`stripSourceModifiers`** (`engine/acSpec.ts`): ngspice rejects inline
  instance params on independent sources (`unknown parameter (rser)`), so a value
  of `AC 1 Rser=1K` left `Rser=1K` after the AC strip and failed as "needs a
  valid V value". Now drop every `key=value` token before the DC level parses
  (NoiseFigure, S-param, wavein). Transient functions carry no bare key=value.
- **LTspice statistical functions** (`simulation/expr.ts`): `mc`/`gauss`/`flat`/
  `rand`/`random`/`white` now resolve to their nominal/mean value (single
  deterministic run) instead of throwing "Unknown function" (MonteCarlo.asc).
- Verified end-to-end: built NoiseFigure.asc's op deck and ran it in **ngspice 17
  — clean solve**. (passive.asc is singular only under `.op` because it's an LC
  ladder = DC short; it's an `.ac` circuit, so that's expected, not a regression.)

### Files touched
- src/io/ascImport.ts (windows-1252 fallback), src/io/encoding.test.ts (+2)
- src/simulation/paramScope.ts (.params alias), paramScope.test.ts (+1)
- src/engine/acSpec.ts (stripSourceModifiers), acSpec.test.ts (+3)
- src/engine/spiceNetlist.ts (apply stripSourceModifiers to V/I sources)
- src/simulation/expr.ts (mc/gauss/flat/rand/random/white), expr.test.ts (+1)
- FEATURE_PARITY.md (§1 deck-build 75/82 summary)

### Tests
659 passing (was 653; +6 new across 4 files). Typecheck clean. 4 commits, each
pushed.

### FEATURE_PARITY items updated
- §1 import `.asc`: deck-build 34→75/82 (new summary bullet). §5 statistical fns.

### UX issues found
- None (no UI surface changed this run).

### Next step
Remaining 7 deck blockers are native-only: `Laplace=` transfer-function E/G
sources (PLL/PLL2/TwoTau/Draft8/HalfSlope ×5 — needs ngspice XSPICE `s_xfer` or
B-source mapping; untestable in the TS suite), a hysteretic/nonlinear inductor
(NonLinearTransformer), and one malformed WIP source (P2). Either implement the
native Laplace path (validate via `ngspice -b`), or pivot to a testable item:
§6 probe-in-place / expression plotting, or §2 multi-select / rubber-band move.

## 2026-06-28T13:00Z — auto/ltspice-parity — seed .step param first value (§5)

### What I did
- `buildParamScope` now seeds each `.step param X …` variable with its first
  enumerated value (reusing `parseStepDirective`), so a default/preview run can
  resolve `{X}` component values for circuits whose only definition of `X` is the
  `.step` line. A stepped run still overrides per value via `withStepValue`; a
  `.step` value overrides a same-named `.param` default.
- Import cycle paramScope→paramStep is benign (the imported fn is used only in
  the function body; paramStep's EMPTY_SCOPE is likewise body-only).
- Re-ran the real-`.asc` smoke (throwaway): deck-build success now **64/82**
  (session start was 43/82).

### Files touched
- src/simulation/paramScope.ts (step seeding + import), paramScope.test.ts (+2)
- FEATURE_PARITY.md (§5 .step seed note)

### Tests
653 passing (was 651; +2). Typecheck clean.

### FEATURE_PARITY items updated
- §5 `.step param`: base-scope first-value seeding.

### Session summary (this run, 9 commits)
605→653 tests. Real-circuit `.op` deck-build 43→64/82. Landed: source AC stimulus
(Value2), bundled LTspice standard models (diodes/zeners/BJTs + 1N4007), C/L `IC=`,
multi-line/`;`-comment `.param`, trailing-dot numbers, empty `""` source sentinel,
negative resistance, `.step param` seeding.

### Next step (remaining real-.asc deck blockers)
Laplace E/G sources (PLL/PLL2/HalfSlope/TwoTau/Draft8 — need `Laplace=` support);
`mc()` Monte-Carlo function; hierarchical IOPIN sheets (Draft4/5); a few sources
still "needs valid V value" (NoiseFigure/S-param — investigate Value2 path).
Or pivot to §3 VDMOS MOSFET models, or `.lib`/`.inc` file-path resolution.

## 2026-06-28T12:55Z — auto/ltspice-parity — real-.asc import robustness (§1/§5/§7)

### What I did
- Wrote a throwaway smoke test importing all 82 real acceptance `.asc` files and
  building an `.op` deck. Baseline: 82 import, **43 build a deck**. Used the
  failures to drive fixes; deck-build success rose to **58/82** (then more).
- **`.param` multi-line/comment** (`paramScope.ts` `expandDirectiveLines`):
  LTspice packs a whole param block into one TEXT entry with literal `\n` joins
  and inline `;` comments (e.g. Cohn.asc). `buildParamScope` now splits on `\n`
  and strips `;` before parsing — unblocked Cohn/100W/IdealTransformer/Linkwitz/
  MonteCarlo/Draft8/Draft10 and more.
- **Trailing/leading decimal point** (`quantity.ts`): `parseQuantity` rejected
  `10.` (LTspice style) — required a digit after the dot. Regex now accepts
  `10.`, `.5`, `2.k`. Unblocked Clapp/Hartly/Pierce/colpits/curvetrace/…
- **Empty source sentinel** (`ascImport.ts`): LTspice writes a 0 V source as
  `Value ""`; `componentValueFromAttrs` normalizes `""`/`''` to empty so the
  source emits `DC 0` (+ any AC spec). Unblocked GFT/S-param/MeasureBW/NoiseFigure.
- **Negative resistance** (`spiceNetlist.ts`): SPICE allows a negative (active)
  resistor (Draft7 `-1k`); resistors now use `nonZeroNumberValue` (reject only
  zero), C/L stay strictly positive. Removed the now-unused `positiveNumberValue`.

### Files touched
- src/simulation/paramScope.ts (+expandDirectiveLines), paramScope.test.ts (+1)
- src/simulation/quantity.ts (regex), quantity.test.ts (+2)
- src/io/ascImport.ts (empty sentinel), ascImport.test.ts (+1)
- src/engine/spiceNetlist.ts (nonZeroNumberValue; drop positiveNumberValue),
  spiceNetlist.test.ts (+2), spiceDeck.test.ts (message update)
- FEATURE_PARITY.md (§5 .param multi-line, §7 negative R)

### Tests
651 passing (was 645; +6 net). Typecheck clean.

### FEATURE_PARITY items updated
- §5 `.param`: multi-line `\n` block + `;` comment handling.
- §7: negative (active) resistance allowed.

### UX issues found
- None (import/deck plumbing).

### Next step
Remaining real-.asc deck blockers (lower priority — most run via their own
`.step`/`.ac` machinery): `.step param`-only `{x}` refs (seed base scope with
first step value — watch the paramStep↔paramScope import cycle), VCVS/VCCS `E/G`
value format (PLL/HalfSlope), `mc()` Monte-Carlo function, hierarchical/IOPIN
sheets (Draft4/5). Or: `.lib`/`.inc` file-path resolution for deadtime.asc.

## 2026-06-28T12:41Z — auto/ltspice-parity — C/L per-instance IC= initial condition (§3/§4)

### What I did
- Real acceptance circuit Draft10.asc has a cap with `SYMATTR SpiceLine2 IC=1`.
  New `engine/icSpec.ts` (`parseIcValue`/`stripIcSpec`/`icSpecDeckText`) extracts/
  removes an `IC=<token>` from a value (SI suffix preserved, spaces/`-` tolerated).
- Importer `componentValueFromAttrs`: for capacitor/inductor, pulls just the `IC=`
  token from `Value2`/`SpiceLine`/`SpiceLine2` (not the whole attr — avoids
  ngspice-incompatible LTspice keys like Rser) and appends it → `100p IC=1`.
- Native deck (`spiceNetlist.ts`): C/L emit the value (IC stripped) + ` IC=<v>`
  via new `positiveNumberFromText`; when any C/L (or `.ic`) carries an IC the
  `.tran` line gets `uic` so the value holds at t=0.
- Also added 1N4007 rectifier to the standard-model bundle (prior commit).

### Files touched
- src/engine/icSpec.ts (new), icSpec.test.ts (new, 9 tests)
- src/engine/spiceNetlist.ts (+positiveNumberFromText, C/L IC emit, uic), +2 tests
- src/io/ascImport.ts (componentValueFromAttrs C/L IC), ascImport.test.ts (+1)
- src/engine/standardModels.ts (1N4007)
- FEATURE_PARITY.md (§3 passives C/L IC, §4 .ic per-instance)

### Tests
645 passing (was 635; +10). Typecheck clean. ngspice CLI: `C1 ... 100p IC=1`
with uic → cap starts at 1 V.

### FEATURE_PARITY items updated
- §3 Passives: C/L initial conditions landed.
- §4 `.ic`/`.nodeset`: per-instance IC= attribute landed.

### UX issues found
- None (importer + deck plumbing).

### Next step
TS-solver IC support; or `.lib`/`.inc` file-path resolution (inject a file
reader, inline `.model`/`.subckt` blocks) so deadtime.asc's UniversalOpamp2
subcircuit resolves; or VDMOS MOSFET model support.

## 2026-06-28T12:33Z — auto/ltspice-parity — bundle LTspice standard device models (§3/§7)

### What I did
- New `engine/standardModels.ts`: a curated bundle of LTspice's shipped standard
  device models (`lib/cmp/standard.dio`/`.bjt`), keyed by lower-cased name →
  `.model` line. Parameters verbatim from LTspice 17.2.4, with LTspice-only
  annotation keys (mfg/Iave/Vpk/Vceo/Icrating/type) stripped so each is a clean
  ngspice line. Bundled: 1N4148/1N914/MMSD4148, 1N5817-19 + BAT54 Schottky,
  1N750/751/4733/5231 zeners, 2N2222/2N3904/BC547 NPN, 2N2907/2N3906/BC557 PNP.
  Only parts a Tau kind can instantiate (diode/zener/npn/pnp).
- `buildSpiceDeck` now, for each semiconductor referencing a model name that the
  document doesn't define but we bundle, emits the real `.model` line and uses
  the part name on the device line (union set drives `deviceModel`). Unbundled/
  unknown names still fall back to the generic `TAU_*` starter.

### Files touched
- src/engine/standardModels.ts (new), standardModels.test.ts (new, 7 tests)
- src/engine/spiceNetlist.ts (emit referenced standard models; knownModels union)
- src/engine/spiceNetlist.test.ts (+2 tests; retargeted 1 obsolete fallback test)
- FEATURE_PARITY.md (§3 semiconductors, §7 model bundle → 🟡)

### Tests
635 passing (was 626; +9 net). Typecheck clean. ngspice CLI: all 17 bundled
models parse; 1N750 zener clamps at 4.67 V; 1N4148 forward drop correct.

### FEATURE_PARITY items updated
- §3 Semiconductors: bundled standard models note (still 🟡 — MOS generic).
- §7 Ship a real device-model set: ⬜ → 🟡.

### UX issues found
- None (deck-only plumbing).

### Next step
Resolve `.lib`/`.inc` file paths (read referenced model files, inline blocks) so
deadtime.asc's UniversalOpamp2 subcircuit and any lib-referenced parts resolve;
or broaden the standard-model bundle / add VDMOS MOSFET support.

## 2026-06-28T12:24Z — auto/ltspice-parity — source AC stimulus (SYMATTR Value2) → deck + solvers (§1)

### What I did
- Found a concrete acceptance-test blocker: Draft1.asc / Draft2.asc carry their
  AC stimulus in `SYMATTR Value2 AC 1` (separate from the `SYMATTR Value SINE(...)`
  transient spec). The importer dropped `Value2`, so `.ac`/`.meas AC` ran against
  a 0 V source.
- New `engine/acSpec.ts`: `parseAcSpec`/`stripAcSpec`/`acSpecDeckText` extract /
  remove an `AC <mag> [phase]` chunk from a source value (SI suffixes, optional
  numeric phase, won't mistake a trailing `Rser=…` for phase).
- Importer (`componentValueFromAttrs`): for `vsource`/`isource` joins
  `Value`+`Value2`+`SpiceLine` onto the value (LTspice netlist concatenation).
  Non-source kinds keep `Value` only (semiconductor instance params deferred).
- Native deck (`spiceNetlist.ts`): vsource/isource emit the AC spec after the
  DC/function text (`V1 n1 0 SIN(0 1 1) AC 1`); DC level parsed from the
  AC-stripped text via new `numberFromText`.
- TS AC solver (`acSweep.ts`): vsource/isource with an AC spec now drive the
  sweep as a phasor (`acPhasor`), and `hasAcSource` recognizes them.
- TS transient/OP DC-parse sites strip the AC chunk so `5 AC 2` still reads 5 V.

### Files touched
- src/engine/acSpec.ts (new), src/engine/acSpec.test.ts (new, 13 tests)
- src/engine/spiceNetlist.ts (+numberFromText, AC emission), spiceNetlist.test.ts (+2)
- src/io/ascImport.ts (+componentValueFromAttrs), ascImport.test.ts (+4)
- src/simulation/acSweep.ts (+acPhasor, vsource/isource AC), acSweep.test.ts (+2)
- src/simulation/{linearTransient,operatingPoint}.ts (strip AC at DC parse)
- FEATURE_PARITY.md (§1 SYMATTR mapping ⬜ → 🟡)

### Tests
626 passing (was 605; +21 new). Typecheck clean. ngspice CLI confirmed:
`SIN(0 1 1) AC 1` → RC corner −3.01 dB / −45° at fc.

### FEATURE_PARITY items updated
- §1 SYMATTR Value/Value2/SpiceModel/ModelFile mapping ⬜ → 🟡 (source AC spec).

### UX issues found
- None (importer + deck + solver plumbing; no UI surface changed).

### Next step
Map semiconductor `Value2`/`SpiceLine` instance params and `SpiceModel`/`ModelFile`
to model selection; or resolve `.lib`/`.inc` file paths so deadtime.asc's
1N4148 / UniversalOpamp2 resolve.

## 2026-06-28T07:04Z — auto/ltspice-parity — .model/.lib/.inc/.subckt passthrough + model-name mapping (§3)

### What I did
- **Model/library directive passthrough** (`engine/modelDirectives.ts`):
  `modelLibLinesFromDirectives` pulls a document's `.model`/`.lib`/`.inc`
  (→`.include`)/`.subckt`…`.ends` directives out of the imported TEXT directives,
  expands LTspice multi-line blocks on the literal `\n` escape, normalizes the
  opening keyword (leading dot, `.inc`→`.include`), and skips analysis/param/
  option directives. `buildSpiceDeck` now emits these so an imported `.asc`
  simulates against its real device models, not just Tau's generic `TAU_*`.
  Live-verified in ngspice 17 (`.model MyDiode D(...)` picked up).
- **Model-name mapping**: `definedModelNames` collects the document's
  `.model`/`.subckt` names; the deck builder emits a semiconductor's own
  `SYMATTR Value` model name on its device line *when that model is defined*
  (else the generic `TAU_*`) — strictly improving, never an undefined-model error.

### Files touched
- src/engine/modelDirectives.ts (new), src/engine/modelDirectives.test.ts (new, 14 tests)
- src/engine/spiceNetlist.ts (emit model/lib lines; deviceModel() per semiconductor)
- src/engine/spiceNetlist.test.ts (+3 deck-integration tests)
- FEATURE_PARITY.md (§3 model/library import ⬜ → 🟡)

### Tests
605 passing (was 588; +17 new). Typecheck clean. ngspice CLI confirmed model pickup.

### FEATURE_PARITY items updated
- §3 **Model/library import** ⬜ → 🟡 (passthrough + model-name mapping; lib/inc
  file-path resolution + TS-solver model parsing remain).

### UX issues found
- None (no UI surface changed; deck-only plumbing).

### Next step
Resolve `.lib`/`.inc` *file paths* — read the referenced model file and inline its
`.model`/`.subckt` blocks into the deck (or hand the path to ngspice's search
path) so circuits referencing LTspice's shipped libraries simulate. Then bring
model parsing to the browser TS solver.

## 2026-06-28T06:53Z — auto/ltspice-parity — .ic/.nodeset passthrough + uic (§4)

### What I did
- Added **`.ic` / `.nodeset` initial-condition passthrough** to the native deck.
  `icLinesFromDirectives` in `spiceNetlist.ts` collects both (re-prefixed leading
  dot, lower-cased keyword) and reports whether any `.ic` is present; the lines are
  emitted and `analysisLine` gains a `useInitialConditions` flag that appends
  **`uic`** to the `.tran` line so initial values hold at t=0 (LTspice semantics),
  not merely bias the OP.

### Files touched
- src/engine/spiceNetlist.ts (icLinesFromDirectives + uic on .tran)
- src/engine/spiceNetlist.test.ts (+2)
- FEATURE_PARITY.md (§4 .ic/.nodeset 🟡)

### Tests
588 passing (was 586; +2 new). Typecheck clean. Live-verified in ngspice 17:
`.ic v(cap)=2` + `.tran … uic` → cap starts at 2 V.

### FEATURE_PARITY items updated
- §4 **Initial conditions `.ic`/`.nodeset`** ⬜ → 🟡 (native deck path; TS IC next).

### UX issues found
- None new.

### Next step
§3 coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §6
probe-in-place / arbitrary-expression plots, or finish `.step temp` family.

## 2026-06-28T06:50Z — auto/ltspice-parity — .temp → native deck temperature (§4)

### What I did
- Added **`.temp` temperature set** (used 4×). `parseTempDirective` (°C; leading
  `.`/`!`, SI suffixes, negatives, first value of a list) in
  `io/directiveAnalysis.ts`, surfaced on `DirectiveAnalyses.temp`. `buildSpiceDeck`
  emits `.temp <°C>` from the document directives so **native ngspice** runs its
  temperature-dependent device models at the authored temperature. TS solver still
  ignores temperature (→ 🟡, not ✅).

### Files touched
- src/io/directiveAnalysis.ts (parseTempDirective + temp discovery)
- src/engine/spiceNetlist.ts (emit .temp from directives)
- src/io/directiveAnalysis.test.ts (+3), src/engine/spiceNetlist.test.ts (+1)
- FEATURE_PARITY.md (§4 .temp 🟡)

### Tests
586 passing (was 582; +4 new). Typecheck clean. Live-verified in ngspice 17:
`.temp 100` shifts a diode forward drop (V(out) 0.499 vs ~0.52 at 27 °C).

### FEATURE_PARITY items updated
- §4 **`.temp`** ⬜ → 🟡 (native deck path; TS coefficients + `.step temp` next).

### UX issues found
- None new.

### Next step
§3 coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §6
probe-in-place / arbitrary-expression plots, or finish `.step temp` family.

## 2026-06-28T06:46Z — auto/ltspice-parity — .options passthrough (§4)

### What I did
- Implemented **`.options` passthrough** (used 7× in the user's circuits). New
  `engine/spiceOptions.ts`: `parseOptionsDirectives` (collects `.options`/`.option`
  key=val + bare flags; lower-cased keys; later lines win; leading `.`/`!` + comma
  separators tolerated), `mergeOptionsLine` (overlays document options on Tau's
  gmin/reltol/abstol/vntol defaults — document wins, deterministic order),
  `optionsLineFromDirectives`. `buildSpiceDeck` now emits the merged line from
  `schematic.directives`; `App.tsx` threads document `directives` into all three
  native run sites (tran/op/ac, deps updated). Schematic type bag gained an
  optional `directives?: string[]` in both spiceNetlist + nativeSpice (existing
  callers unaffected).

### Files touched
- src/engine/spiceOptions.ts (new), spiceOptions.test.ts (new, 10)
- src/engine/spiceNetlist.ts (merged options line + directives field)
- src/engine/nativeSpice.ts (directives field), src/App.tsx (thread directives)
- src/engine/spiceNetlist.test.ts (+2 deck override tests)
- FEATURE_PARITY.md (§4 .options ✅)

### Tests
582 passing (was 572; +10 new). Typecheck clean. Live-verified in ngspice 17:
LTspice-only keys (plotwinsize/numdgt/maxstep) tolerated, overridden reltol still
solves V(out)=2.5 V on a 1:1 divider.

### FEATURE_PARITY items updated
- §4 **`.options` passthrough** ⬜ → ✅.

### UX issues found
- None new.

### Next step
§3 coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §6
probe-in-place / arbitrary-expression plots, or §4 `.temp`.

## 2026-06-28T06:42Z — auto/ltspice-parity — Fourier results table UI (§4/§6)

### What I did
- Surfaced `.four` results in the UI: `App.tsx` memoizes `runFourier` off the
  transient `analysis` + the document's `.four` directive; a new `FourierTable`
  under the transient scope (`SimulationPanel.tsx`) shows, per output, the THD
  header and DC/fundamental/harmonic magnitudes (each ≥1 normalized to the
  fundamental). Reuses the existing `.meas` table styling — no new CSS. `.four`
  flipped ⬜→🟡→✅ (TS solver + UI; native path the remaining NEXT).

### Files touched
- src/App.tsx (fourier memo + prop), src/components/SimulationPanel.tsx
  (prop + FourierTable component + render under transient MeasTable)
- FEATURE_PARITY.md (§4 .four ✅)

### Tests
572 passing (unchanged; UI is presentational, logic covered by fourier.test.ts).
Typecheck clean.

### FEATURE_PARITY items updated
- §4 **`.four` Fourier analysis** 🟡 → ✅.

### UX issues found
- Visual QA still headless-blocked (§8) — FourierTable not screenshot-verified,
  but it reuses the verified meas-table layout.

### Next step
§3 coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §4
`.temp`, or §6 probe-in-place / expression plots.

## 2026-06-28T06:38Z — auto/ltspice-parity — .four Fourier analysis (§4)

### What I did
- Added **`.four` Fourier analysis** (§4 missing analysis), engine layer.
  `simulation/fourier.ts`: `parseFourDirective` (freq + optional bare-integer
  `[Nharmonics] [Nperiods]` + output list; leading `.`/`!` tolerated; SI freq),
  `computeFourier` (DC + fundamental + harmonics over the **last period** via
  direct trapezoidal integration of `a_k`/`b_k` — no resample error — with
  per-harmonic magnitude/phase/normalized + THD; guards an ill-defined fundamental
  so pure DC reads 0% THD), and `runFourier` (resolves `V(node)`/bare/`I(ref)`
  against the transient `MeasWaveform`). Wired into `analysesFromDirectives` so an
  imported `.asc`'s `.four` is discovered.

### Files touched
- src/simulation/fourier.ts (new), src/simulation/fourier.test.ts (new, 14)
- src/io/directiveAnalysis.ts (four discovery), directiveAnalysis.test.ts (+1)
- FEATURE_PARITY.md (§4 .four 🟡)

### Tests
572 passing (was 557; +15 new). Typecheck clean. Coefficients hand-verified
(pure sine A=1 phase 90°, fundamental+½·2nd-harmonic → THD 50%).

### FEATURE_PARITY items updated
- §4 **`.four` Fourier analysis** ⬜ → 🟡 (engine landed; UI tab + native path next).

### UX issues found
- No FOUR results tab in the SimulationPanel yet (engine-only this session).

### Next step
Wire a FOUR tab/table into `SimulationPanel` (mirror MeasTable), or §4 `.temp`
sweep, or §3 coupled-inductor `K` / comparators (A devices for class-d_starter).

## 2026-06-28T06:32Z — auto/ltspice-parity — Copy/paste + duplicate (Ctrl+C/V/D) (§2)

### What I did
- Added **copy / paste / duplicate** for the single selection (§2). Store gains an
  ephemeral `clipboard: SchematicComponent | null`, `copySelected`, `paste`,
  `duplicateSelected`, and a `placeClone` helper that produces a clone with a fresh
  id, the next ref-des for its kind, and a 2-grid diagonal offset. **`pinOverride`
  positions are offset by the same delta** so imported, pin-accurate parts stay
  connected the same way after a copy. Paste/duplicate are undoable and select the
  new copy. Bound Ctrl/Cmd+C / +V / +D in `App.tsx`; StatusBar hint adds ⌘D.

### Files touched
- src/store/useSchematic.ts (clipboard + placeClone + 3 actions)
- src/App.tsx (Ctrl+C/V/D), src/components/StatusBar.tsx (hint)
- src/store/useSchematic.test.ts (+4)
- FEATURE_PARITY.md (§2 copy/paste 🟡; §8 keyboard line)

### Tests
557 passing (was 553; +4 new). Typecheck clean.

### FEATURE_PARITY items updated
- §2 **Copy/paste, duplicate** ⬜ → 🟡 (single selection; multi-select still ⬜).
- §8 keyboard parity note extended (Ctrl+C/V/D).

### UX issues found
- Multi-select / drag-box / group move still absent — copy acts on one part only.

### Next step
§2 **multi-select + drag-box select** (bigger Canvas-interaction change), or §3
coupled-inductor `K` / comparators (A devices for class-d_starter.asc), or §4
`.four`/`.temp`.

## 2026-06-28T06:30Z — auto/ltspice-parity — Mirror/flip components (Ctrl+E) (§2)

### What I did
- Implemented **mirror/flip** — the top remaining ⬜ in §2 schematic capture and a
  keyboard-parity gap (LTspice Ctrl+E). Added a `mirrored?: boolean` to
  `SchematicComponent` (horizontal flip across the vertical axis, applied **before**
  rotation to match LTspice `M*` orientations + the importer's `transformLtPoint`).
- **Connectivity:** new `transformPoint(point, rotation, mirrored)` in
  `schematic/pins.ts` (mirror x→-x, then rotate); `getComponentPins` uses it, so
  net extraction / netlist emission see the flipped pin positions. **Rendering:**
  `symbolTransform` in `Canvas.tsx` emits `rotate(R) scale(-1 1)` (SVG right-to-left
  = flip then rotate) for the symbol, pin-layer, and placement ghost.
- **Store:** `placeMirror` state + `mirror()` action — toggles the placement ghost
  in place mode, else toggles the selection's flag (undoable). `addComponent`
  stamps `mirrored: placeMirror`. `documentValidation` preserves the flag on
  load/save round-trips.
- **Keyboard:** Ctrl/Cmd+E → mirror, Ctrl/Cmd+R → rotate bound in `App.tsx`
  (Space=rotate kept). StatusBar hint updated.
- **Import fidelity:** `ascImport` now sets `mirrored: true` for `M*` orientations,
  so imported parts render flipped as in LTspice (pins were already correct via
  pinOverride).

### Files touched
- src/schematic/types.ts (mirrored flag)
- src/schematic/pins.ts (transformPoint + getComponentPins)
- src/schematic/documentValidation.ts (preserve mirrored)
- src/store/useSchematic.ts (placeMirror + mirror action + addComponent)
- src/components/Canvas.tsx (symbolTransform, ghost, ComponentView, selector)
- src/components/StatusBar.tsx (hint), src/App.tsx (Ctrl+E/Ctrl+R)
- src/io/ascImport.ts (M* → mirrored)
- tests: pins.test.ts (+5), useSchematic.test.ts (+3), ascImport.test.ts (+1)
- FEATURE_PARITY.md (§2 mirror ✅; §8 keyboard 🟡)

### Tests
553 passing (was 544; +9 new). Typecheck clean.

### FEATURE_PARITY items updated
- §2 **Mirror/flip components** ⬜ → ✅; §2 place/move/rotate/mirror line ✅.
- §8 keyboard parity ⬜ → 🟡 (Ctrl+R/Ctrl+E bound).

### UX issues found
- Function-key shortcuts (F2–F8) still unbound (§8). Multi-select/copy-paste still
  ⬜ — mirror only acts on the single selection.

### Next step
§2 next ⬜: **copy/paste + duplicate + multi-select** (drag-box select), or §3
**coupled inductors K** (small, testable) / comparators (A devices, needed for
class-d_starter.asc).


## 2026-06-28T01:05Z — auto/ltspice-parity — Behavioral B-source end-to-end (§3)

### What I did
- Added the **behavioral B-source** (`bsource` kind) — the top remaining ⬜ in
  §3, "used constantly in real LTspice circuits". 2-terminal output; value carries
  `V=<expr>`/`I=<expr>`. Full plumbing: type, pin geometry (p/n), diamond symbol +
  bounds/box, palette entry (hotkey `j`).
- **Native ngspice deck**: emits `B p n V=…`/`I=…` verbatim (brace-substituted;
  bare expr → `V=`). Live-verified in ngspice 17 (`V=2*V(in)+0.5` → 4.5 V;
  `I=1m*V(ctrl)` polarity confirmed and matched in the TS stamp).
- **Import**: LTspice `bv`/`bi`/`b`/`b2` → `bsource`; value flows through; pin
  geometry banked (bv≈voltage, bi≈current), matching GFT.asc wiring.
- **TS solver (linear subset)**: `simulation/behavioral.ts` `linearizeBehavioral`
  reduces an affine expression to `const + Σ coeff·V(node)` via symbolic
  perturbation + a multi-point linearity check (rejects products/powers/`time`/
  `I(...)`/unknown params). Stamped in `.op`/`.tran`/`.ac`: V-type as a
  multi-input VCVS (branch unknown + offset), I-type as transconductance
  (constant drops at AC). Nonlinear/dynamic forms raise a clear "needs native
  engine" error instead of mis-solving.

### Files touched
- src/schematic/types.ts, pins.ts, symbols.tsx, catalog.ts (new kind plumbing)
- src/engine/spiceNetlist.ts (deck emission + prefix)
- src/io/ascImport.ts (bv/bi mapping + pin keys)
- src/simulation/behavioral.ts (new: parse/normalize/linearize/term-resolve)
- src/simulation/{operatingPoint,linearTransient,acSweep}.ts (stamps + offsets)
- tests: behavioral.test.ts (15), behavioralSolver.test.ts (9),
  engine/spiceDeck.test.ts (+2), io/ascImport.test.ts (+2)
- FEATURE_PARITY.md (§3 B-source ✅; kinds list)

### Tests
544 passing (was 516 at run start; +28 new). Typecheck clean. Native deck
validated in ngspice 17.

### FEATURE_PARITY items updated
- §3 **Behavioral sources (B)** ⬜ → ✅. Kinds list + §3 Sources note updated.

### UX issues found
- B-source value editing uses the plain value field (free-text `V=…`); no
  structured editor or syntax highlighting yet. Imported B-source renders at
  Tau's diamond geometry (pins correct via override). Logged as UX debt.

### Next step
§3 next ⬜: **Comparators / logic gates (LTspice `A` devices)** — needed for
class-d_starter.asc — or generic coupled-inductor `K`. Alternatively §2
mirror/flip (Ctrl+E), the next schematic-capture gap.

## 2026-06-27T19:33Z — auto/ltspice-parity — CCCS (F) + CCVS (H) current-controlled sources (§3)

### What I did
- Completed the controlled-source family **E/F/G/H** by adding the two
  current-controlled kinds — **CCCS (F)** and **CCVS (H)** — the documented NEXT
  step from the VCVS/VCCS session. Linear, so the existing TS MNA solvers handle
  them exactly with hand-computable expected values.
- Modelled the control port (like LTspice's F/H symbols) as an **internal
  zero-volt sense branch** across `cp`/`cn`; its branch current is the controlling
  current I(cp→cn). **CCCS** adds 1 MNA unknown (sense current) and stamps output
  current `gain·I_sense` leaving `op`/entering `on`. **CCVS** adds 2 unknowns
  (sense + output branch) and constrains `V(op)−V(on)=r·I_sense`. Added the same
  stamps to all three TS solvers (`.op`/`.tran`/`.ac`, complex in AC).
- New component kinds `cccs`/`ccvs` (4-pin 2-ports, same geometry as VCVS/VCCS):
  filled every exhaustive `Record<ComponentKind,…>` — `pins.ts`, `SYMBOL_BODY`/
  `SYMBOL_BOX` + render cases (current-sense arrow on the left port; diamond +
  arrow for F, diamond + ± for H), `catalog.ts` palette (F hotkey `f`, H hotkey
  `n`), and the `spiceNetlist` prefix map (F/H).
- Native ngspice deck: each F/H emits a per-device `V_<ref>_sense cp cn 0` plus
  `F/H op on V_<ref>_sense k` (the only correct way ngspice senses a current).
- `ascImport`: LTspice `f/f2`→cccs, `h/h2`→ccvs.
- Transient solver now reports F/H branch currents as `I(ref)`.

### Files touched
- src/schematic/types.ts (cccs/ccvs kinds)
- src/schematic/pins.ts, src/schematic/symbols.tsx, src/schematic/catalog.ts
- src/engine/spiceNetlist.ts (prefix + F/H emission w/ internal sense source)
- src/io/ascImport.ts (f/h→cccs/ccvs)
- src/simulation/operatingPoint.ts, linearTransient.ts, acSweep.ts (MNA stamps)
- src/simulation/controlledSources.test.ts (+9), src/io/ascImport.test.ts (+1)
- FEATURE_PARITY.md (§3 E/F/G/H ✅)

### Tests
516 passing (was 506; +10 new). Typecheck clean. Sign conventions cross-checked
live against ngspice 17 on an equivalent deck: CCCS V(out)=−gain·I_sense·R=−10 V,
CCVS V(out)=r·I_sense=+2 V — both exact.

### FEATURE_PARITY items updated
- §3 E/F/G/H controlled sources: 🟡 → ✅ (CCCS + CCVS complete the family).
- §3 component-kinds header: ~23 → ~25 kinds.

### UX issues found
- None new. Like VCVS/VCCS, imported F/H symbols have no banked `.asy` pin
  geometry yet, so they're placed-but-flagged on import (tracked under §1).

### Next step
Tackle §3 **behavioral B-source** (`V=…`/`I=…`), used constantly in real LTspice
circuits — but it's nonlinear in general, so scope a linear/native split first;
or do §4 `.four` (Fourier) / `.temp` which are smaller and fully testable in TS.

## 2026-06-27T18:52Z — auto/ltspice-parity — VCVS (E) + VCCS (G) controlled sources (§3)

### What I did
- Added the two **voltage-controlled linear sources** — VCVS (E) and VCCS (G) —
  which §3 flags as "used constantly in real LTspice circuits." Chose these (over
  more analyses) as the highest-leverage *testable* increment: linear, so the
  existing TS MNA solvers handle them exactly, with hand-computable expected values.
- New component kinds `vcvs`/`vccs` modelled as 4-pin 2-ports: control pair
  (`cp`/`cn`, left) + output pair (`op`/`on`, right). Filled every exhaustive
  `Record<ComponentKind,…>` — pin geometry (`pins.ts`), `SYMBOL_BODY`/`SYMBOL_BOX`
  + a drawn 2-port block symbol with source diamond (`symbols.tsx`), catalog
  entries (`catalog.ts`, Analog section, prefixes E/G).
- **MNA stamps in all three TS solvers**: VCCS is a pure transconductance stamp
  (`I(op→on)=gm·V(cp,cn)`, no extra unknown); VCVS adds a branch-current unknown
  with a controlled constraint row (`V(op)−V(on)=gain·V(cp,cn)`). Done for
  `operatingPoint.ts`, `linearTransient.ts` (incl. I(ref) current samples), and
  `acSweep.ts` (complex, real gain). Added to each solver's SUPPORTED set.
- Native ngspice deck (`spiceNetlist.ts`): emits `E op on cp cn gain` /
  `G op on cp cn gm`, prefixes E/G. `ascImport.ts`: LTspice `e`/`e2`→vcvs,
  `g`/`g2`→vccs (previously skipped as "no Tau equivalent").
- **Verified sign conventions live against ngspice 17** before coding tests:
  `E op 0 cp 0 10`→V(op)=10; `G op 0 cp 0 1m` with op-side 1k load →V(op)=−1;
  negative gain `E −5`→−10. All match.

### Files touched
- src/schematic/{types.ts,pins.ts,symbols.tsx,catalog.ts}
- src/simulation/{operatingPoint.ts,linearTransient.ts,acSweep.ts}
- src/engine/spiceNetlist.ts
- src/io/ascImport.ts (+ ascImport.test.ts mapping test)
- src/simulation/controlledSources.test.ts (new, 9 tests)
- FEATURE_PARITY.md (§3 E/G → 🟡 with detail; kind count 21→23)

### Tests
506 passing (was 496; +10 new). Typecheck clean. New tests are hand-computed
and cross-checked against ngspice 17 (gain·V, −gm·R·V, difference-amp, negative
gain, flat-gain AC, branch current, deck E/G emission, e/g import mapping).

### FEATURE_PARITY items updated
- §3 "Voltage/current-controlled sources E/F/G/H" ⬜ → 🟡 (E + G done; F/H pending).

### UX issues found
- Visual QA of the two new palette symbols not done this run (headless screenshot
  still blocked per prior runs). The symbols follow existing SVG patterns and
  typecheck; **UX debt:** eyeball the VCVS/VCCS glyphs + rotation in `pnpm dev:web`.

### Next step
Implement the current-controlled pair F (CCCS) and H (CCVS): they need a
controlling-current sense branch (current through a 0 V sense element), so add a
branch-current unknown for the control path and reference it in the output stamp.
Then flip §3 E/F/G/H to ✅.

## 2026-06-27T18:05Z — auto/ltspice-parity — wire `.noise` to a NOISE tab + log it (§4/§6)

### What I did
- The previous session landed the `.noise` solver + parser (`simulation/noise.ts`,
  commit ea6df81) but never wired it to the UI, flipped FEATURE_PARITY, or logged
  it. Closed all three so `.noise` is reachable end-to-end like `.tf`/`.dc`/`.step`.
- `App.tsx`: new `noiseAnalysis` state (reset in `invalidateAnalysis`) + a
  `runNoiseAnalysis_` callback that reads the document's own `.noise` via
  `analysesFromDirectives`, runs `runNoiseAnalysis({components,wires,netLabels,params},
  spec)` with the request-version guard, and prompts clearly when no `.noise`
  directive is present. Threaded `noiseResult`/`onRunNoise` props into `SimulationPanel`.
- `SimulationPanel.tsx`: added `"noise"` to the tab mode union, a **NOISE** tab
  button (runs on select), the panel title, and a new `NoisePlot` component —
  output-referred noise density on a **log–log** axis (frequency decades X, V/√Hz
  decades Y; `noisePath` maps through log10), a legend naming the output port, and
  a metric row with integrated total output / input-referred noise + point count.

### Files touched
- src/App.tsx (noiseAnalysis state, runNoiseAnalysis_, props)
- src/components/SimulationPanel.tsx (NOISE tab, NoisePlot, noisePath)
- FEATURE_PARITY.md (§4 `.noise` ⬜ → ✅)

### Tests
496 passing (unchanged; solver's 16 tests + directive mapping already covered).
Typecheck clean. NoisePlot/noisePath are presentational (no component-render test
infra in the repo); the numeric path is validated by the solver's textbook tests.

### FEATURE_PARITY items updated
- §4 `.noise` Noise analysis: ⬜ → ✅ (TS adjoint solver; native device noise NEXT).

### UX issues found
- None new — NOISE tab follows the established AC/DC plot styling (CSS variables,
  log axis, dense metric row). Native FFI noise path still pending (TS-only), same
  caveat as `.tf`/`.dc`.

### Next step
Either (a) start §3 behavioral B-source deck emission (needed for class-d_starter),
or (b) §6 waveform viewer: surface `I(...)` branch currents as probable traces.

## 2026-06-27T12:16Z — auto/ltspice-parity — `.tf` transfer-function analysis (solver + parser + UI) (§4/§6)

### What I did
- Implemented the `.tf` small-signal DC transfer function — the next ⬜ in §4
  analyses. `simulation/transferFunction.ts`:
  - `parseTfDirective(".tf V(out) V1")` → `{output, source}`. Outputs:
    `V(node)`, differential `V(a,b)` (commas + spaces ok), `I(device)`, and the
    bare-node form. Strips leading `.`/`!`.
  - `runTransferFunction` computes **gain**, **input impedance**, **output
    impedance** by perturbation around `runOperatingPoint` (same no-duplicated-
    stamping pattern as `dcSweep`): gain = Δoutput over a unit input step;
    Rin = drive input alone with a unit stimulus and read delivered current
    (voltage input) or terminal voltage (current input); Rout = zero every
    source, inject a unit test current into the output port, read the response.
  - Handles both voltage and current input sources; AC source kinds collapse to
    a DC stimulus for the small-signal solve.
- Extended the OP solver **additively** (`operatingPoint.ts`): new `OpOptions`
  `{ injectCurrents, returnBranches }` — test-current injection into named nets
  and voltage-source/inductor branch-current return. Default behavior unchanged
  (all 468 prior tests still green).
- `analysesFromDirectives` now also returns `tf` so an imported `.asc`'s own
  `.tf` runs as authored (`io/directiveAnalysis.ts`).
- UI: a **TF** tab in `SimulationPanel` (`TfTable`) shows gain/Zin/Zout in a
  metric row + table; `App.runTfAnalysis` runs it from the document directive
  with a clear prompt when none is present. Mirrors the DC tab wiring.

### Files touched
- src/simulation/transferFunction.ts (new), transferFunction.test.ts (new, 12)
- src/simulation/operatingPoint.ts (additive OpOptions + branches)
- src/io/directiveAnalysis.ts (+tf), directiveAnalysis.test.ts (+1)
- src/components/SimulationPanel.tsx (TF tab + TfTable)
- src/App.tsx (tfAnalysis state, runTfAnalysis, props)
- FEATURE_PARITY.md (§4 `.tf` ⬜ → ✅)

### Tests
480 passing (was 468; +12 new). Typecheck clean. **Cross-checked against
ngspice 17**: 1k:1k divider `.tf v(out) V1` → ngspice reports gain 0.5,
input_impedance 2000, output_impedance 500 — Tau matches exactly. Current-input
transimpedance case also hand-verified.

### FEATURE_PARITY items updated
- §4 `.tf` Transfer function: ⬜ → ✅ (TS path; native/nonlinear noted as NEXT).

### UX issues found
- None new. TF tab follows the established OP/DC table styling (CSS variables,
  dense metric row). Note: TF has no native FFI path yet (TS-only), same as DC.

### Next step
Either (a) add `.noise` analysis (§4, the last ⬜ analysis besides .four/.temp),
or (b) start §3 behavioral B-source deck emission (needed for class-d_starter).

## 2026-06-27T11:30Z — auto/ltspice-parity — expose I(...) branch currents to .meas (§4)

### What I did
- Closed the explicit §4 `.meas` NEXT: **branch-current signals `I(ref)`**. The
  measure engine previously returned NaN for every `I(...)`, which blocked
  deadtime.asc's `.meas` lines (`I(V1)`, `I(V2)`, `I(R1)` → PS/PL/Efficiency).
- **TS solver** (`linearTransient.ts`): added `CurrentTrace` + `currents:
  CurrentTrace[]` to the ok result. During the solve loop I now capture each
  device's branch current in SPICE sign convention — voltage-source & inductor
  currents straight from the MNA solution vector, resistor currents `(Va-Vb)/R`,
  capacitor `C·dV/dt`, independent-source currents from the set value. Keyed by
  ref-des (unlabeled parts skipped).
- **Native ngspice** (`nativeSpice.ts`): pulls source currents from ngspice's
  `<ref>#branch` vectors and derives R/C currents from the node voltages it
  already returns (`deriveRcCurrents` in `currents.ts`). Live-confirmed with
  `ngspice -b`: a 10 V / 1k:1k divider gives `v1#branch = -0.005 = I(V1)`,
  matching the TS convention exactly (resistor currents aren't in ngspice's
  default vector set, hence the derivation).
- **measure.ts**: `makeGetter` resolves `I(ref)` against `wf.currents`
  (case-insensitive); added optional `currents` to `MeasWaveform`. App already
  passes the AnalysisResult straight through, so both engine paths light up.

### Files touched
- src/simulation/linearTransient.ts (CurrentTrace + currents capture)
- src/simulation/currents.ts (deriveRcCurrents helper) + currents.test.ts (new, 4)
- src/simulation/measure.ts (I(ref) resolution + MeasWaveform.currents)
- src/simulation/linearTransient.test.ts (+4 hand-computed current tests)
- src/simulation/measure.test.ts (+5 I(...) tests incl. deadtime power forms)
- src/engine/nativeSpice.ts (currents from #branch + derived R/C)
- FEATURE_PARITY.md (§4 .meas I(...) note)

### Tests
468 passing (was 455; +13 new). Typecheck clean. Native `#branch` sign/value
live-validated against ngspice 17 CLI.

### FEATURE_PARITY items updated
- §4 `.meas` — `I(...)` branch-current signals ✅ (line stays 🟡 for `.meas dc`/
  `.meas noise` domains, now the NEXT).

### UX issues found
- None (no UI surface changed). Currents are now available to plot, but the
  waveform viewer doesn't yet offer a current probe — logged as the §6 NEXT.

### Next step
Surface `currents` in the waveform viewer (§6): let a probe/trace picker plot
`I(R1)` etc. alongside voltages; then add `.meas dc`/`.meas noise` domains.

---

## 2026-06-26T08:36Z — auto/ltspice-parity — wire .step sweep to UI + family overlay (§4/§6)

### What I did
- The `.step` parser + generic param-runner (`simulation/paramStep.ts`) existed
  but was unreachable from the UI: an imported circuit with `.step` never swept.
  Wired it end-to-end (used 34× in the user's circuits).
- New pure module `simulation/stepFamily.ts`: `stepContexts(spec, params,
  components)` expands a `StepSpec` into one concrete run context per swept value.
  Handles all three kinds — **param** injects into a scope copy (`withStepValue`),
  **source** overrides the matched component's `value` (case-insensitive ref-des,
  list untouched), **temp** throws a clear "not supported yet" message. Capped at
  `MAX_FAMILY_MEMBERS` (16) so a fine `.step` can't launch hundreds of sims.
  Added `isRunnableStep` + `StepFamilyResult`/`StepFamilyMember` types.
- `App.runStepAnalysis`: reads `stepFromDirectives`, expands contexts, re-runs the
  transient (native ngspice, TS fallback) once per context, stores a
  `StepFamilyResult`. Clear prompts for missing/temp specs. New `stepFamily` state,
  invalidated alongside the other analyses.
- `SimulationPanel`: new **STEP** tab + `StepPlot` overlay — draws the probed
  signal (first probed net, else first trace) across every step member in a
  trace-variable color ramp; legend lists each `name=value`; metrics show signal /
  step count / swept name. Honest empty states for no-directive / no-data.

### Files touched
- src/simulation/stepFamily.ts (new), src/simulation/stepFamily.test.ts (new, 10)
- src/App.tsx (state + runStepAnalysis + props)
- src/components/SimulationPanel.tsx (STEP tab + StepPlot + pickFamilyTraceId)
- FEATURE_PARITY.md (§4 .step note, §6 family-overlay 🟡)

### Tests
455 passing (was 445; +10 new). Typecheck clean. Source-sweep integration test
runs through the real OP solver and tracks a 1:1 divider's half-supply
(V1∈{4,8,12} → mid∈{2,4,6}).

### FEATURE_PARITY items updated
- §4 `.step` — UI dispatch + family overlay landed (stays 🟡: temp/nested/AC-DC
  families pending).
- §6 `.step` family-of-curves overlay ⬜ → 🟡 (transient overlay landed).

### UX issues found
- Step overlay plots a single signal (probe-driven). LTspice overlays *every*
  trace as its own family — per-trace selection is the next UI step. Logged as
  UX debt.

### Next step
Add the temp run path (set analysis temperature) and AC/DC-domain step families,
then a per-trace selector in the STEP legend so a user can choose which signal's
family to overlay.

---

## 2026-06-26T08:00Z — auto/ltspice-parity — wire .dc DC sweep end-to-end (§4)

### What I did
- The `.dc` solver + parser (`simulation/dcSweep.ts`) had been landed but was
  never reachable from the UI or from an imported circuit's directives. Wired it
  end-to-end so a `.dc` source sweep actually runs and plots.
- **Import mapping:** `analysesFromDirectives` (`io/directiveAnalysis.ts`) now
  also returns the first `.dc` directive as a `DcSweepSpec` (reusing
  `parseDcDirective`), so an imported `.asc` sweeps the source it specifies.
- **UI dispatch + plot:** added a **DC** tab to `SimulationPanel` and a new
  linear-axis `DcPlot` component (mirrors `AcPlot`: X = swept source value,
  Y = node voltages, the GND net dropped). `App.runDcAnalysis` pulls the sweep
  spec from the document's own `.dc` directive and runs `runDcSweep`; with no
  `.dc` present it shows a clear prompt instead of a silent no-op. DC result
  state is cleared by `invalidateAnalysis` like the other analyses.
- **Native deck:** `buildSpiceDeck` gained a `kind:"dc"` analysis emitting
  `.dc <src> <start> <stop> <inc>` with the increment signed toward `stop`.

### Files touched
- src/io/directiveAnalysis.ts (+ `.dc` recognition), directiveAnalysis.test.ts (+2)
- src/engine/spiceNetlist.ts (`SpiceAnalysis` dc kind + `analysisLine`), spiceNetlist.test.ts (+1)
- src/App.tsx (dcAnalysis state, runDcAnalysis, props, invalidate)
- src/components/SimulationPanel.tsx (DC tab + DcPlot + dcPath)
- FEATURE_PARITY.md (§4 `.dc` notes)

### Tests
444 passing (was 441; +3 new). Typecheck clean. Native `.dc` deck live-validated
in ngspice 17 (`ngspice -b`): a 1:1 divider sweep `.dc V1 0 10 2` prints
V(mid)=Vsweep/2 across all 6 points exactly.

### FEATURE_PARITY items updated
- §4 `.dc` — UI dispatch + plot pane + import mapping + native deck line all
  landed (line stays 🟡 only for native/FFI nonlinear DC runner, a manual
  source/range picker, and nested 2nd-source sweeps).

### UX issues found
- Visual QA still blocked headless (no playwright/puppeteer in node_modules,
  consistent with prior sessions). DcPlot is a faithful mirror of AcPlot; verify
  the DC tab visually on a real desktop run. Tracked as UX debt.
- DC sweep currently runs only via the TS OP solver, so nonlinear DC sweeps
  (diode/MOS curve tracer) on desktop need the native FFI runner — follow-up.

### Next step
Add a native ngspice DC runner (`runNativeDcSweep` in `engine/nativeSpice.ts`)
so nonlinear `.dc` sweeps (curve-tracer/varactor circuits) match LTspice on
desktop, then prefer it over the TS solver in `App.runDcAnalysis` exactly as the
other analyses do (`runNative… ?? runTS…`).

---

## 2026-06-26T02:05Z — auto/ltspice-parity — inline LTspice source functions in the ngspice deck (§3)

### What I did
- Found a hard blocker for the user's real files: an imported LTspice
  `voltage`/`current` symbol carries its stimulus inline on the Value attribute
  (`SINE(0 7.5 1k)`, `PULSE(-10 10 5u 25u 25u 0u 50u)` in class-d_starter.asc),
  but `buildSpiceDeck` only emitted `DC <number>` for `vsource`/`isource` — so it
  threw `needs a valid V value` on those decks and nothing simulated.
- New `engine/sourceFunction.ts`: `parseSourceFunction(rawValue, "V"|"A")` parses
  the five LTspice transient families — **SINE/SIN, PULSE, PWL, EXP, SFFM** — and
  re-emits an ngspice-ready spec (`DC <t0> SIN(...)` etc.). It (a) parses every
  numeric arg through `parseQuantity` so LTspice's `µ`/`meg`/unicode prefixes are
  normalized to plain numbers ngspice always accepts, (b) rounds to 12 sig-digits
  to kill binary-float noise (`10·1e-6` → `0.00001`, not `0.0000099999`), and
  (c) trims the trailing `Ncycles` slot that ngspice's SIN/PULSE reject. Returns
  `null` for a plain DC number so the existing numeric path still handles it.
- Wired it into `buildSpiceDeck`'s `vsource`/`isource` cases (keeping the isource
  node-swap polarity convention intact).

### Files touched
- src/engine/sourceFunction.ts (new), src/engine/sourceFunction.test.ts (new, 10 tests)
- src/engine/spiceNetlist.ts (vsource/isource try the function parser first)
- src/engine/spiceNetlist.test.ts (+2 deck-integration tests)
- FEATURE_PARITY.md (§3 Sources note)

### Tests
441 passing (was 429; +12 new). Typecheck clean. Live-validated both generated
decks in real ngspice 17 (`/opt/homebrew/bin/ngspice -b`): the SIN deck produces
v() output and the full-PULSE deck runs with zero errors/warnings.

### FEATURE_PARITY items updated
- §3 Sources — SINE/PULSE/PWL/EXP/SFFM inline functions now reach the deck
  (line stays 🟡: PWL FILE, behavioral B-source, AC spec, noise sources, and
  TS-fallback-solver support for these functions remain).

### UX issues found
- None (no UI surface touched). The TS fallback solver (web mode, no native
  ngspice) still treats a `vsource` SINE string as DC-only — native path is
  unaffected since ngspice now gets the real function.

### Next step
Teach the TS fallback solver (`simulation/linearTransient.ts`) to drive a
`vsource`/`isource` from `parseSourceFunction` (at least SINE + PULSE) so web-mode
sims match native; or add the behavioral **B-source** (`V=`/`I=` expressions),
the last remaining source family the user's circuits need.

## 2026-06-26T02:00Z — auto/ltspice-parity — AC-domain `.meas` engine + UI (§4/§6)

### What I did
- Generalized the `.meas` evaluation core in `simulation/measure.ts` to be
  **axis-agnostic**: extracted `evaluateOnAxis(spec, axis, compile, scope, funcs)`
  plus axis-generic `interpAt`/`findCrossing`/`evalAggregateOnAxis` that work on
  either the transient time axis or the AC frequency axis. The transient
  `evaluateMeasurement`/`runMeasurements` API is unchanged (delegates to the core).
- Tagged each parsed `MeasSpec` with its `analysis` domain (`tran`/`ac`/…),
  captured from the directive's type token, and **domain-routed** the runners so a
  `.meas ac …` line never runs against a transient result and vice-versa.
- New `simulation/measureAc.ts`: `runAcMeasurements`/`evaluateAcMeasurement` over
  an `AcMeasData {freqs, traces[{magDb,phaseDeg}]}`. An AC expression compiler
  reconstructs each node's complex phasor from dB/phase and resolves the LTspice
  wrappers `db/mag/ph(phase)/re/im` (bare `V` ⇒ magnitude) and two-node `V(a,b)`
  complex differences. So `FIND db(V(out)) AT=1k`, `WHEN mag(V(out))=0.707`,
  `MAX MAG(V(out))`, `PP/AVG`, and `TRIG/TARG` bandwidth all resolve over freq.
- Made crossing thresholds **scope-evaluated expressions** (`CrossingClause.value`
  is now a raw string) so real forms like `WHEN mag(V(out))=GAIN/sqrt(2)` and
  `=(vout_3db)` work — these previously threw at parse time with an empty scope
  (latent crash on the user's AD4080/AFE decks). Exposed the `freq`/`time`
  independent variable so `FIND freq WHEN …` (the AD4080 bandwidth idiom) returns
  the crossing frequency.
- Wired into the app: `App.tsx` memoizes `runAcMeasurements(directives, acAnalysis,
  params.scope, params.funcs)`; `SimulationPanel` renders a second `MeasTable`
  under the Bode plot in AC mode.

### Files touched
- src/simulation/measure.ts (axis-generic core, `analysis` tag, string thresholds,
  `time` var, exports `evaluateOnAxis`/`CompiledExpr`/`safeEvalScalar`)
- src/simulation/measureAc.ts (new), src/simulation/measureAc.test.ts (new, 19 tests)
- src/simulation/measure.test.ts (3 expectations updated for the new fields)
- src/components/SimulationPanel.tsx (acMeasurements prop + AC MeasTable)
- src/App.tsx (acMeasurements memo + prop wiring)
- FEATURE_PARITY.md (§4 `.meas` note: AC domain landed)

### Tests
423 passing (was 404; +19 new). Typecheck clean. AC math is hand-computed
against a 1-pole low-pass H(f)=1/(1+jf/fc): −3.01 dB / 0.707 / −45° at the corner,
WHEN/db corner detection, MAX/MIN/PP over the sweep, `V(a,b)` differential dB, and
the user's exact AD4080 `vout_max→vout_3db→FIND freq WHEN mag(V)=(vout_3db)` and
`WHEN mag(V) = GAIN/sqrt(2)` bandwidth chains.

### FEATURE_PARITY items updated
- §4 `.meas` — AC domain now covered (still 🟡 overall: `I(...)` branch currents
  and `.meas dc`/`.meas noise` remain).

### UX issues found
- Visual QA still blocked headless; AC MeasTable reuses the verified transient
  MeasTable component, so low risk.

### Next step
Add `I(...)` branch-current signals to `.meas` (requires the TS solver to expose
device currents), or wire the landed `.dc`/`.step` solvers into the UI (both
engines exist and are tested; only `.tran`/`.ac` dispatch today).

## 2026-06-26T01:06Z — auto/ltspice-parity — `.meas` transient measurement engine + UI (§4/§6)

### What I did
- Built `simulation/measure.ts`, a full LTspice `.meas`/`.measure` engine for
  transient results. `parseMeasDirective` covers the forms used in the user's
  circuits: `MAX/MIN/PP/AVG/RMS/INTEG` aggregates over `FROM/TO` windows,
  `PARAM <expr>`, `FIND <expr> AT=/WHEN`, bare `WHEN <cond>` (crossing time),
  and `TRIG ... TARG ...` timing with `RISE/FALL/CROSS`, occurrence count, and
  `TD`. SI suffixes via the existing expr engine; `=`/space option forms both.
- `runMeasurements` evaluates directives in order through an accumulating scope
  (seeded with circuit `.param`/`.func`) so later `PARAM` lines reference earlier
  measurements by name — reproducing deadtime.asc's
  `vmax→vmin→vamp→tper→freq→*_err` chain. Signals `V(node)`/`V(a,b)` resolve
  against trace ids/labels and combine with arbitrary expressions; crossing times
  and FIND...AT use linear interpolation.
- Wired into the app: `App.tsx` memoizes `runMeasurements(directives, analysis,
  params.scope, params.funcs)` off the transient result and passes a `MeasResult[]`
  to `SimulationPanel`, which renders a new `MeasTable` under the transient meters
  (op-table styling; failed measurements show their reason). New `.meas-table` CSS.

### Files touched
- src/simulation/measure.ts (new), src/simulation/measure.test.ts (new, 25 tests)
- src/components/SimulationPanel.tsx (measurements prop + MeasTable)
- src/App.tsx (memoized measurements + prop wiring)
- src/App.css (.meas-table styles)
- FEATURE_PARITY.md (§4 `.meas` ⬜→🟡)

### Tests
404 passing (was 379; +25 new). Typecheck clean. Measurement math is
hand-computed: triangle-wave MAX/MIN/PP, trapezoidal INTEG/AVG/RMS of constants,
interpolated FIND/WHEN, and a full deadtime.asc-style TRIG/TARG period →
frequency chain with `.param`-seeded percentage error.

### FEATURE_PARITY items updated
- §4 `.meas` ⬜ → 🟡 (transient domain done; AC-domain `.meas` and `I(...)`
  branch-current signals remain).

### UX issues found
- Visual QA still blocked headless (cannot screenshot the running dev server);
  MeasTable styling mirrors the verified op-table, so low risk. Tracked as UX debt.

### Next step
Map an imported `.dc`/`.step` directive to its landed solver and dispatch from the
UI (both engines exist; only `.tran`/`.ac` adopt directive options today), then
add AC-domain `.meas` so loop-gain circuits' `FIND v(vout) AT`/`WHEN db()=-3`
measurements resolve.

---

## 2026-06-26T00:10Z — auto/ltspice-parity — `.step` parametric-sweep parser + param runner (§4/§5)

### What I did
- Added `simulation/paramStep.ts`. `parseStepDirective` enumerates every LTspice
  `.step` form up front into `StepSpec.values`:
  - linear `start stop incr` (handles clean endpoints, descending ranges,
    negative increments normalized toward stop, SI suffixes),
  - `dec`/`oct` log ranges (N points per decade/octave, endpoint-inclusive),
  - explicit `list`,
  - `param <name>` / bare-source / `temp` kinds.
- `runParamStep` (param kind): injects each swept value into a copy of the
  `ParamScope` via `withStepValue` (exact + lowercased key, base untouched) and
  re-runs a caller-supplied analysis closure, returning a labelled family
  (`{value,label,result}`). Reuses existing `.op`/`.tran`/`.ac` solvers.
- `stepFromDirectives` picks an imported circuit's first `.step`.

### Files touched
- src/simulation/paramStep.ts (new)
- src/simulation/paramStep.test.ts (new, 25 tests)
- FEATURE_PARITY.md (§4 `.step` ⬜→🟡, §5 `.step param x list/range` ⬜→✅)

### Tests
379 passing (was 354; +25 new). Typecheck clean. Integration test sweeps a
divider's Rtop through the real `runOperatingPoint` solver and confirms the
midpoint voltage tracks 12·1k/(Rtop+1k) = 6 V then 3 V.

### FEATURE_PARITY items updated
- §4 `.step`: ⬜ → 🟡 (parser + param-runner done; UI dispatch/source-temp/nested pending)
- §5 `.step param x list/range`: ⬜ → ✅ (engine support complete + tested)

### UX issues found
- None (no UI surface changed this run).

### Next step
Wire `stepFromDirectives` + `runParamStep` into App.tsx's run path with a
family-of-curves overlay in the waveform pane (§6); then add source/temp step
run paths (override a component `value` / analysis temp) and nested `.step`.

## 2026-06-25T23:57Z — auto/ltspice-parity — `.dc` DC-sweep solver + directive parser (§4)

### What I did
- Added `simulation/dcSweep.ts`, a self-contained `.dc` analysis layer:
  - `parseDcDirective(line)` parses `.dc <src> <start> <stop> <incr>` (SI
    suffixes via `parseQuantity`, leading `.`/`!` stripped, returns `null` on
    non-`dc`/malformed/unparseable lines — `parseQuantity` throws, so wrapped).
  - `runDcSweep(schematic, spec)` builds the ordered sweep points (ascending or
    descending, endpoint-inclusive with a 1e-9 fudge), overrides the named
    independent source's `value` per step, and re-solves via `runOperatingPoint`
    — so it inherits the exact same MNA solver with zero duplicated stamping.
    Returns a per-net voltage series aligned to the sweep index. Guards a
    zero increment (no infinite loop) and a point count past MAX_POINTS=100001.
- This is the solver foundation; UI dispatch (a `.dc` run mode + a sweep
  waveform pane) and mapping an imported `.dc` directive to it are the next step.

### Files touched
- src/simulation/dcSweep.ts (new)
- src/simulation/dcSweep.test.ts (new, 9 tests)
- FEATURE_PARITY.md (§4 `.dc` ⬜ → 🟡)

### Tests
354 passing (was 345; +9 new). Typecheck clean. Hand-computed divider proof:
V1 swept 0→10 step 2 → midpoint net = [0,1,2,3,4,5] (Vsweep/2); descending
sweep, unknown-source / non-source / zero-increment / oversized-range all error.

### FEATURE_PARITY items updated
- §4 `.dc` DC sweep → 🟡 (solver + parser done; UI + directive mapping pending).

### UX issues found
- None (no UI surface this increment).

### Next step
Wire `runDcSweep` into the app: add a `.dc` run mode (dispatch when the active
circuit's directives contain a `.dc` line via `parseDcDirective`) and a sweep
plot pane in `SimulationPanel` (x = swept value, y = chosen net traces). Then
the imported class-d/Draft circuits with `.dc` directives run end-to-end.

## 2026-06-25T23:53Z — auto/ltspice-parity — Open dialog imports `.asc` files (§1c)

### What I did
- Wired the LTspice importer into the existing toolbar **Open** button so a user
  can actually open a real `.asc` (the §1 key-goal blocker). The file picker now
  accepts `.asc`; `ShellPanels.openCircuit` branches on extension and, for `.asc`,
  runs the new `importAsc(text)` convenience export (`parseAsc`→`ascToSchematic`),
  builds a `SchematicDocument` carrying `components/wires/netLabels/directives`,
  and hands it to `App.openDocument` — which already adopts the imported
  `.tran`/`.ac` window (`adoptDirectiveOptions`) and builds the param scope at run.
- Honest error states: a non-LTspice or content-free file throws
  "No schematic content found …" (caught → `window.alert`); banked-pin warnings
  for vendor symbols are logged non-fatally rather than blocking the open.

### Files touched
- src/io/ascImport.ts (`importAsc` convenience export)
- src/io/ascImport.test.ts (+2 tests: one-step import, empty-file guard)
- src/components/ShellPanels.tsx (`.asc` branch in `openCircuit`, `accept` attr, import)
- FEATURE_PARITY.md (§1c ✅, NEXT note trimmed)

### Tests
345 passing (was 343; +2 new). Typecheck clean. Validated end-to-end with a
throwaway smoke test over the user's **real** files (since removed):
class-d_starter.asc → 15 comps/46 wires/8 labels/4 directives, deadtime.asc →
18/59/13/0, Draft1.asc → 4/10/0/1. All import without throwing.

### FEATURE_PARITY items updated
- §1 import `.asc`: (c) Open dialog ✅. Line stays 🟡 overall (symbol geometry +
  `.asy` pin banking + `.meas`/`.dc`/`.step` directive mapping still pending).

### UX issues found
- Imported parts still render at Tau's built-in geometry (pins correct via
  override, drawn symbol won't match LTspice spacing) — tracked §1 follow-up.
- Desktop visual QA still blocked (dev port held); this change is a behavioral
  tweak to an existing toolbar button, no new visual surface.

### Next step
§4 analyses are the next blocker for the key goal: implement `.step` (used 34×)
or `.meas` (used 61×) so imported circuits' directives run, OR map
`.dc`/`.meas`/`.step` directive strings → analysis options once those runners
exist. Recommend `.dc` source sweep next (simplest, 37× usage), then `.step`.

## 2026-06-25 — auto/ltspice-parity — imported `.tran`/`.ac` directives drive the run options (§1 d-analyses)

### What I did
- Built `io/directiveAnalysis.ts` — pure parsers turning LTspice analysis
  directives into Tau's option shapes:
  - `parseTranDirective`: `.tran <Tstop>` (short) and `.tran <Tstep> <Tstop>
    [<Tstart> [<Tmax>]] [uic…]` (full) → `{ stopTime, steps }`. Steps derived
    from `Tstop/Tstep` (clamped to [2, MAX_TRANSIENT_STEPS]); zero/missing Tstep
    falls back to the editor default (240). SI suffixes via `parseQuantity`.
  - `parseAcDirective`: `.ac <dec|oct|lin> <N> <Fstart> <Fstop>` → `{ startHz,
    stopHz, pointsPerDecade }`. `dec` maps directly; `oct` → ×log2(10); `lin`'s
    total-point count normalized across the span's decades.
  - `analysesFromDirectives`: picks the first `.tran`/`.ac` from a directive list.
- Wired into `App.tsx`: `adoptDirectiveOptions(doc)` applies an imported circuit's
  own `.tran` window on document-open and tab-switch, so it runs as authored
  rather than with the hardcoded 6 ms / 240-sample default.

### Files touched
- src/io/directiveAnalysis.ts (new)
- src/io/directiveAnalysis.test.ts (new, 14 tests, hand-computed)
- src/App.tsx (import + adoptDirectiveOptions on open/switch)
- FEATURE_PARITY.md (§1 d-analyses .tran/.ac ✅)

### Tests
343 passing (was 329; +14 new). Typecheck clean.

### FEATURE_PARITY items updated
- §1 import `.asc`: (d-analyses) `.tran`/`.ac` directive→options ✅. `.meas`/
  `.dc`/`.step` directive mapping still pending (need those analyses first, §4).

### UX issues found
- None this run. Note: `analysisOptions` is app-global, not per-tab; switching
  tabs adopts the active circuit's `.tran` but a manual options edit isn't yet
  remembered per-tab. Tracked as minor UX debt — fine until §1(c) Open dialog.

### Next step
Either §1(c) — a real Open dialog (Tauri file picker → `parseAsc` →
`ascToSchematic` → `openDocument` with directives) so users open their own
`.asc` — or start §4 `.dc`/`.step` analyses (the next directive kinds to map and
high-value for the user's circuits: .dc ×37, .step ×34).

## 2026-06-25 — auto/ltspice-parity — directives carried on the document + fed to the param scope at every run site (§1 d-param)

### What I did
- Closed the §1(d) param half: an imported `.asc`'s `.param`/`.func`/`{expr}`
  values now resolve when the circuit simulates. Previously `ascToSchematic`
  surfaced directives but they died on the floor — nothing stored them, so the
  running app never built a param scope from an imported file.
- Added `directives: string[]` to the document model (`Doc` + `SchematicDocument`)
  and threaded it through the whole store: `docOf`, `copyDocument`,
  `copyHistoryEntry`, initial state, `loadCircuit`/`restoreCircuit`/`newCircuit`,
  persistence subscriber, and a new `setDirectives` action (undoable).
- Bounded-validated `directives` in `documentValidation` (≤1000 lines, ≤1024
  chars each, must be strings) so persisted/imported docs stay safe.
- Added `params?: ParamScope` to the native `Schematic` type; `buildSpiceDeck`
  already reads `schematic.params`, so native ngspice now resolves params too.
- `App.tsx`: memoized `params = buildParamScope(directives)` (falls back to
  `EMPTY_SCOPE` on a cycle/undefined rather than crashing the run) and passed
  `params` into all six run sites — native + TS `.tran`/`.op`/`.ac` — plus the
  tab snapshot so directives survive tab switches.

### Files touched
- src/store/useSchematic.ts (directives field + setDirectives + threading)
- src/store/useSchematic.test.ts (+3 tests: load/carry, setDirectives undo/redo, newCircuit clears)
- src/schematic/documentValidation.ts (validate directives array)
- src/schematic/documentValidation.test.ts (+1 test, validDocument carries directives)
- src/engine/nativeSpice.ts (params on Schematic type)
- src/io/ascImport.test.ts (+1 integration test: directives → buildParamScope → resolved value)
- src/App.tsx (memoized param scope + params at every run site + snapshot)
- FEATURE_PARITY.md (§1 d-param ✅; §5 .param NEXT note updated)

### Tests
329 passing (was 324; +5 new). Typecheck clean.

### FEATURE_PARITY items updated
- §1 import `.asc`: (d-param) directives-on-document + param-scope wiring ✅.
  Line stays 🟡 overall — (c) Open dialog and (d-analyses) directive→analysis
  mapping still pending.
- §5 `.param` NEXT note resolved (scope now built from imported directives).

### UX issues found
- None this run (no UI surface changed; the directive plumbing is invisible until
  an Open dialog (§1 c) or a canvas directive editor (§2) exposes it).

### Next step
Build §1(c): an Open dialog / file picker that runs `parseAsc` → `ascToSchematic`
and calls `loadCircuit(doc)` with `directives` populated, so a user can actually
open a `.asc`. Then §1(d-analyses): parse the stored `.tran`/`.ac` directives into
`AnalysisOptions` (stopTime/steps, start/stop Hz) so the imported analysis runs
with the circuit's own settings instead of the hardcoded defaults.


## 2026-06-25 — auto/ltspice-parity — LTspice expression engine + .param/.func resolved through every solver (§5)

### What I did
- Built a complete LTspice/SPICE **expression evaluator** (`simulation/expr.ts`):
  tokenizer + precedence-climbing parser + evaluator. SI-suffixed literals
  (1k/2.2meg/10n/1mil, trailing unit ignored), `+ - * / % ^ **` (power
  right-assoc, `-2^2 = -4`), comparison/logical/ternary, built-in functions
  (trig, exp/ln/log10, sqrt, abs, sgn, min/max, floor/ceil/round, pow/pwr/pwrs,
  if, limit, table w/ interpolation, uramp/u/buf/inv), constants (pi, e), and
  user `.func` calls (args bound into a child scope, nested funcs resolve).
- Built **`.param`/`.func` scope resolution** (`simulation/paramScope.ts`):
  `buildParamScope` parses directive strings (multi-assignment lines, the rare
  name-value form), resolves inter-param references in any order via an
  iterative fixpoint, and throws on cycles/undefined refs. `substituteBraces`
  does LTspice-style `{…}` → literal substitution (incl. inside compound specs
  like `PULSE(0 {Vhi} …)`); `resolveComponentValues` maps a component list.
- **Threaded the scope through every solve path** — `runTransientAnalysis`,
  `runOperatingPoint`, `runAcSweep`, and `buildSpiceDeck` now accept an optional
  `params: ParamScope` and resolve brace values before extraction. No-param
  circuits and brace-free components pay nothing (fast path returns the same
  array reference).
- End-to-end proof (`paramIntegration.test.ts`): a `{Vsrc}/{Rtop}/{Rbot}`
  divider with `.param Vsrc=12 Rtop=1k` / `.param Rbot={Rtop*3}` solves to the
  hand-computed 9 V, and the native deck emits concrete numbers (no braces).

### Files touched
- src/simulation/expr.ts (new), src/simulation/expr.test.ts (new, 32 tests)
- src/simulation/paramScope.ts (new), src/simulation/paramScope.test.ts (new, 22 tests)
- src/simulation/paramIntegration.test.ts (new, 7 tests)
- src/simulation/{linearTransient,operatingPoint,acSweep}.ts (thread params)
- src/engine/spiceNetlist.ts (thread params)
- FEATURE_PARITY.md (§5: .param/.func/{expr}/built-ins → ✅; .step still ⬜)

### Tests
324 passing (was 263; +61 new). Typecheck clean. (Note: the full suite is
timing-sensitive — saw a transient 2-test flake once under load that did not
reproduce on three subsequent clean runs; native-ngspice spawn latency suspected,
not a logic regression.)

### FEATURE_PARITY items updated
- §5 `.param` ✅, `.func` ✅, `{expression}` ✅, built-in functions+constants ✅.
  `.step param` remains ⬜ (needs the sweep driver in §4).

### UX issues found
- None (no UI surface changed).

### Next step
Add `directives?: string[]` to `SchematicDocument` (+ `Doc`, `docOf`,
`copyDocument`, persistence) and have `App.tsx` call `buildParamScope(directives)`
and pass `params` to all run sites — this lights up the chain for imported
`.asc` files (FEATURE_PARITY §1 d). Wire `ascToSchematic`'s parsed `TEXT !`
directives into that field at the same time, then map `.tran`/`.ac`/`.op`
directives to the matching analysis runner.

---

## 2026-06-25 — auto/ltspice-parity — ascToSchematic() + pinOverride + electrical net labels

### What I did
- Implemented `ascToSchematic()` (FEATURE_PARITY §1 task a) and pin-accurate
  connectivity via `pinOverride` (task b) — the documented next step for the key
  goal (open the user's real `.asc` files).
- Made net labels **electrical** (they were cosmetic): `extractCircuit` now takes
  an optional `netLabels` arg, merges same-named FLAGs into one net, treats
  `0`/`GND` as ground, and names the net after its label so `V(vcc)` resolves.
  Threaded `netLabels` through native ngspice + all three TS solvers + App.tsx.
- Added `PinOverride` (absolute world pin positions) to `SchematicComponent`;
  `getComponentPins` honors it (falls back to kind+rotation geometry otherwise).
- `ascToSchematic` maps symbols → components with `pinOverride = anchor +
  transformLtPoint(pin)`, wires 1:1, FLAGs → ground symbols / net labels, and
  `TEXT` → directives / comments. 3-terminal MOS bulk tied to source. Unmappable
  vendor symbols skipped with a warning; mapped-but-unbanked symbols (opamps)
  placed and honestly flagged.

### Files touched
- src/schematic/types.ts (PinOverride + field)
- src/schematic/pins.ts (honor pinOverride)
- src/schematic/netlist.ts (electrical net labels, net naming)
- src/schematic/netlist.test.ts (+7 tests), src/schematic/pins.test.ts (new, 4 tests)
- src/io/ascImport.ts (ascToSchematic + helpers), src/io/ascImport.test.ts (+6 tests)
- src/engine/spiceNetlist.ts, src/engine/nativeSpice.ts (thread netLabels)
- src/simulation/{linearTransient,acSweep,operatingPoint}.ts (thread netLabels)
- src/App.tsx (pass netLabels to run sites + deps)
- FEATURE_PARITY.md (§1 a/b ✅, net-labels-electrical note)

### Tests
263 passing (was 246; +17 new). Typecheck clean. Validated against the real
`~/Downloads/LTspice_export/deadtime.asc` and `class-d_starter.asc` via throwaway
tests (since removed): both import without throwing, ground resolves, vcc/vee/etc
collapse to single nets, directives parse.

### FEATURE_PARITY items updated
- §1 import `.asc`: (a) ascToSchematic ✅, (b) pinOverride connectivity ✅,
  net-labels-electrical ✅ (line remains 🟡 overall — (c) Open dialog and
  (d) directive→analysis mapping still pending).
- §2 net labels: annotated as now electrical.

### UX issues found
- None this run (no UI surface changed). Note: imported components still render
  at Tau's built-in geometry (pins are correct via override, but the drawn symbol
  won't visually match LTspice spacing) — tracked as a §1 follow-up.

### Next step
Wire `ascToSchematic` into an Open dialog / file picker so a user can actually
load a `.asc` into the store (FEATURE_PARITY §1 task c), then map parsed
`TEXT !` directives (`.tran`/`.ac`/`.param`/`.meas`) to runnable analyses (task d).

## 2026-06-30 — auto/ltspice-parity — TS-solver mutual-inductance (K) stamp (§3)

### What I did
- Built `simulation/coupling.ts`: `parseCouplingSpecs` parses a document's `K`
  directives (multi-winding `K1 L1 L2 L3 1`, fractional `.95`, `{param}` coeff,
  `\n`-joined TEXT blocks) into specs; `mutualTerms` turns specs + the circuit's
  inductor set into pairwise M = k·√(La·Lb) terms (|k| clamped to 1; all C(N,2)
  pairs per line; first-spec-wins dedupe; ignores missing labels).
- Stamped the terms in both interim solvers: `acSweep` adds −jωM to each coupled
  inductor branch row; `linearTransient` adds the backward-Euler (M/h) companion
  cross conductance + history RHS. M computed once (time/freq-invariant).
- `App.tsx` memoizes `couplings = parseCouplingSpecs(directives, params)` and
  threads it into both TS run sites (transient + AC). Native deck already carried
  K verbatim — this is the browser/test-engine half.

### Files touched
- src/simulation/coupling.ts (new), src/simulation/coupling.test.ts (new, 15 tests)
- src/simulation/transformerCoupling.test.ts (new, 5 e2e tests)
- src/simulation/acSweep.ts, src/simulation/linearTransient.ts (stamp + signature)
- src/App.tsx (couplings memo + thread to TS run sites)
- FEATURE_PARITY.md (§3 K coupling: TS-solver stamp landed)

### Tests
874 passing (was 854; +20). Typecheck clean. Ideal 1mH:4mH open-circuit
transformer steps 1V→2V (=√(L2/L1)) in AC (+6.02dB flat) and transient
(V(out)=2·V(in) every step); k=0.5→0dB; uncoupled→dead secondary.

### FEATURE_PARITY items updated
- §3 coupled inductors K: TS-solver mutual-inductance stamp 🟡→landed (line stays
  🟡 overall pending a placeable K symbol/UI).

### UX issues found
- None (no UI surface changed; coupling is invisible plumbing until a K symbol UI).

### Next step
Add a placeable K-coupling symbol/UI so a user can couple inductors without
hand-editing a TEXT directive; or pick the next §3 item (MOSFET VDMOS power
models — class-d's RSR015P06/QS6K1 need real VDMOS params).

## 2026-06-30 — auto/ltspice-parity — TS-solver per-instance IC= support (§3/§4)

### What I did
- TS transient now honors a cap/inductor `IC=` token: `positiveValue` strips it
  before parsing the magnitude (`1u IC=2` previously threw "Could not parse"),
  and the time loop seeds the backward-Euler companion state from the parsed IC
  (cap → initial voltage, inductor → initial current) so the value holds at t=0
  (LTspice `IC=`+`uic` semantics). Bad IC tokens are ignored, not fatal.

### Files touched
- src/simulation/linearTransient.ts (strip IC in positiveValue; seed state)
- src/simulation/initialConditions.test.ts (new, 3 hand-computed tests)
- FEATURE_PARITY.md (§3 passives + §4 .ic: TS-solver IC support landed)

### Tests
877 passing (was 874; +3). Typecheck clean. 1µF/1kΩ cap IC=2V discharges per
V[n]=IC/(1+h/RC)^(n+1) (≈2V→0.736V at t=RC); IC=1A inductor delivers ~1A at t=0
and decays; no-IC node starts at 0.

### FEATURE_PARITY items updated
- §3 passives C/L IC=: TS-solver IC support landed.
- §4 .ic/.nodeset: TS-solver IC support landed.

### UX issues found
- None (solver-internal).

### Next step
TS-transient PULSE/PWL/EXP source support (only sine works in the fallback today;
class-d's V4 uses PULSE), reusing engine/sourceFunction.ts as a shared evaluator.

## 2026-06-30 — auto/ltspice-parity — TS-solver time-domain source functions (§3/§4)

### What I did
- Built `simulation/sourceWaveform.ts`: `parseTransientSource(value, unit)` parses
  an LTspice/ngspice stimulus spec (SINE/SIN, PULSE, PWL, EXP, SFFM, or plain DC,
  trailing `AC <mag>` ignored) into `{ dc, at(time), maxFrequencyHz }` — a
  time-domain evaluator mirroring `engine/sourceFunction.ts`'s deck emitter.
  Handles SINE delay/damping/phase/Ncycles, PULSE finite edges + period +
  Ncycles, PWL linear interp with flat-held ends, EXP dual time-constants, SFFM.
- Wired it into `linearTransient.ts`: sources are parsed once into a
  per-id map; the `.tran` loop now drives `vsource`/`isource` (and the `vac`/
  `iac` AC symbols via `signalValue`) from the waveform instead of DC-only;
  `inspectTransientResolution` derives the sampling requirement from a function
  source's own frequency (previously only `vac`/`iac` set it). `operatingPoint.ts`
  seeds the t=0 DC bias for a function-valued source so `.op` no longer NaNs.

### Files touched
- src/simulation/sourceWaveform.ts (new), src/simulation/sourceWaveform.test.ts (new, 16 tests)
- src/simulation/linearTransient.ts (precompute map; vsource/isource/signalValue/resolution)
- src/simulation/linearTransient.test.ts (+2 e2e: PULSE + SINE drive a node)
- src/simulation/operatingPoint.ts (function-source DC bias)
- FEATURE_PARITY.md (§3 sources: TS-fallback solver support landed)

### Tests
895 passing (was 877; +18). Typecheck clean. ngspice cross-check: PULSE(0 5 1m
0 0 2m 4m) node = 0/5/0 V at t=0.5/2/3.5 ms in both Tau TS-solver and ngspice.

### FEATURE_PARITY items updated
- §3 Sources: "TS-fallback solver support for the non-DC functions" — now landed.

### UX issues found
- None (solver-internal; no UI surface changed).

### Next step
Class-d_starter.asc uses a triangle (PULSE) + sine into a comparator. With PULSE
now driving the TS solver, verify class-d's V4/Vtri sources simulate; then tackle
the comparator/logic component kind (§3) the class-d modulator needs.

### Addendum (class-d acceptance-file recon)
Inspected `~/Downloads/LTspice_export/class-d_starter.asc`: V3 `SINE(0 7.5 1k)`
and V4 `PULSE(-10 10 5u 25u 25u 0u 50u)` now drive both engines. Remaining
class-d blockers are NATIVE-ONLY: VDMOS power models `RSR015P06` (pmos M1) /
`QS6K1` (nmos M2), the `deadtime` subckt (X1), and `UniversalOpAmp2` with
`Avol/GBW/Slew`. The TS browser solver is linear so it can't run class-d; the
native ngspice path needs those model definitions bundled. Next high-leverage
native item: ship a VDMOS power-MOSFET model bundle (§7 real model bundle / §3
MOSFET VDMOS) so class-d's M1/M2 resolve in `ngspice -b`.
