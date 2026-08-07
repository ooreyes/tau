# Schematic UX Plan — 2026-07-12

Continuation file: if the current session dies (rate limit), any agent (Claude, ChatGPT, human)
can resume from here. Repo: `~/Desktop/Tau`, branch `auto/ltspice-parity`. The working tree also
contains unrelated in-progress simulator/dashboard work, so stage schematic hunks selectively.
Run checks with `pnpm -C apps/desktop typecheck` and `pnpm -C apps/desktop test`.
Dev server: `pnpm -C apps/desktop dev --host 127.0.0.1` (Vite, port 1420). All
colors via App.css `:root` tokens (no hardcoded hex in components); comments explain non-obvious
constraints only.

User's requests (his words, paraphrased), all for the SCHEMATIC tab:

1. Net labels must not overlay other elements (his "Input" label's leader crossed a probe/wire).
2. Wire crossings are a visual nightmare — unconnected crossings need a "hump" (hop-over arc);
   connected joins already show junction dots.
3. Auto-routed wires should take the cleanest path (fewest crossings, no overlaps).
4. Deleting a selection is hard — want an easy click target to delete the selected thing.
5. Some component drawings look messed up (PNP/NMOS/PMOS arrows) and canvas label FONT looks
   broken ("PMOS W=10u L=1u" renders crushed).
6. Run button / error affordance should be gradient-colored: green when acceptable, red on error.

## Status checklist

- [x] 5a. Canvas label font fix — `.label-layer .ref/.val` in App.css: small glyphs with a heavy
      halo stroke produced crushed counters. Component references are now 11px, values 10px,
      net names 11px, all with a crisp 1.5px canvas-background halo.
- [x] 5b. Transistor arrows — `apps/desktop/src/schematic/symbols.tsx`: npn / pnp
      used open unfilled chevron paths that render as stray lines; nmos /
      pmos / njf / pjf arrows unfilled. Replaced with filled triangles (class
      `symbol-arrow`, CSS `fill: var(--comp); stroke: none` at `App.css:698`, with
      `fill: var(--text)` when selected) with correct conventions:
      NPN arrow on emitter pointing OUT, PNP pointing IN toward base, NMOS into channel,
      PMOS out of channel. (Still in place 2026-08-06; the six `symbol-arrow` paths are now
      at `symbols.tsx:701, 718, 731, 744, 759, 773` — the original `~line 4xx` pointers
      have drifted as the symbol library grew.)
- [x] 6. Run button + Errors strip status color — Toolbar.tsx already has `result`/`runState`
      and a `.run-lamp-dot`. Added subtle gradient states on the Run button: `--success`-tinted
      gradient when last run ok / circuit clean, `--danger`-tinted when `result.ok === false`,
      neutral when idle. Same treatment on the schematic BottomPanel "Errors" header strip
      (ShellPanels.tsx — `hasIssues`/`hasError` now at ~line 1383, derived from `result`). Tokens only,
      keep it restrained (Palantir, not candy).
- [x] 4. Click-to-delete affordance — Canvas.tsx: when a selection exists in the schematic
      editor (selectedIds / selectedWireIds / label / probe selections), render a 30×30 floating
      "✕" pill button near the selection's screen-space bbox top-right corner. Clicking calls the
      existing delete action (`deleteSelected` — the same one the Delete key uses, App.tsx
      keyboard handler). Pointer-events on, does not steal canvas drags. Hidden in simulator mode.

      > **Superseded 2026-08-06.** The floating `✕` pill was later removed. `deleteSelected`
      > is now a stable toolbar control — `<IconButton title="Delete selection (Delete)">` at
      > `apps/desktop/src/components/ShellPanels.tsx:1189` — and the Delete/Backspace key
      > still works via `apps/desktop/src/schematic/shortcuts.ts`. There is no
      > `.selection-delete-pill` in `Canvas.tsx` or `App.css`; `Canvas.simulator.test.tsx:574`
      > now asserts its absence. (TAU_DESIGN_VISION.md §11 records the same move.)
- [x] 1. Net-label placement avoiding wires/probes — `autoNetLabelOffset` in
      Canvas.geometry.ts (`autoNetLabelOffsets`, now ~line 718) currently only scores candidate offsets against component bboxes.
      Extended scoring to penalize: overlap of the label text box with wire segments, probe
      dots (r≈8 at probe.x/y), and other net labels' boxes. `autoNetLabelOffsets` places labels as
      a deterministic set: manually dragged labels reserve their chosen boxes first, then auto
      labels reserve slots in document order. The Canvas callsite passes wires + probes.
- [x] 2. Hop-over arcs at unconnected wire crossings — WireView/pathFromPoints in Canvas.tsx
      (`WireView` now ~line 1660). Plan implemented: compute crossings between HORIZONTAL segments of each
      wire and VERTICAL segments of all other wires; a crossing point that is NOT in the
      `junctions` set (Canvas.tsx now ~line 243, same semantics as net extraction) and not an
      endpoint of either segment gets a semicircular hop (r=4, bulge up / −y) in the horizontal
      wire's path. Multiple crossings per segment sorted along travel direction; path arcs via
      `A 4 4 0 0 sweep` with sweep flipped for right-to-left segments so the bump always points up.
      Pure helper `pathWithHops(points, hopXsBySegment)` in Canvas.geometry.ts + unit tests;
      Canvas computes per-wire hop positions with a memo over (wires, junctions).
- [x] 3. Cleanest-path auto-routing — `routeWireSmart` (Canvas.geometry.ts, now ~line 1118) already
      generates channel candidates and scores by `hits/length/corners`. Added two scoring terms
      between hits and length: `crossings` (count of intersections with existing wires — requires
      passing `wires` into the router; callsites: Canvas.tsx addWire (now ~line 522) and
      `rerouteMovedWires`) and `overlap` (length of collinear overlap with existing wire segments,
      to stop wires riding on top of each other). Existing segments also contribute one-grid
      clearance and end-run channels, so the router can find a clean alternative instead of only
      scoring an apparent crossing. Order: hits, overlap, crossings, length, corners. The
      wire-placement callback also tracks the live wire list, avoiding stale routing decisions.

Items get checked off as they land in the working tree (verify with git diff). Remaining nice-to-haves (not requested, skip unless asked):
- Junction dot size/contrast pass.

## Verification recipe (after each item)

1. `pnpm -C apps/desktop typecheck && pnpm -C apps/desktop test`
2. Open http://localhost:1420 → Schematic tab, inverting-amp example.
3. Item-specific: (1) place net label near the probe → leader must not cross probe/wires;
   (2) draw two crossing wires from different nets → hump on the horizontal one, no hump where a
   junction dot exists; (3) drag a component so its wires reroute → paths avoid bodies AND other
   wires; (4) select a part → ✕ pill appears, click deletes; (5) place PNP + NMOS + PMOS, check
   arrows + value label crispness; (6) break the circuit (delete ground) → Run turns red-tinted,
   fix it → green-tinted.

## Verification completed — 2026-07-13 UTC

- Focused gates: TypeScript typecheck passed; `Canvas.geometry.test.ts` and
  `Canvas.simulator.test.tsx` passed (42/42). Geometry coverage includes label-vs-label
  avoidance, manual label authority, hop direction/corner safety, parallel-wire avoidance, and
  routing around a finite crossing wire.
- In-app browser: loaded the Vite build, inspected the schematic at 1280×720, confirmed reference
  text at 11px/1.5px halo, selected `Rin`, measured the delete affordance at 30×30, clicked it to
  delete the component, and used Undo to restore the six-component circuit.
- Ran the valid inverting-amplifier example and confirmed the title-bar Run control received the
  `run-button--ok` success gradient.
- Final gates: `pnpm -C apps/desktop typecheck` passed; full Vitest suite passed
  (102 files / 1540 tests); `pnpm --filter @tau/desktop build` passed with only the existing
  browser-externalization and large-chunk advisories.
- Staged-only detached-worktree gate also passed: typecheck, 115 focused schematic/store tests,
  and production build. This proves the schematic commit does not depend on unrelated dirty-tree
  simulator/dashboard changes.

## Screenshot follow-up — 2026-07-13 UTC

- [x] Routing clearance hardened: a candidate route now treats an existing wire endpoint in the
  middle of its path as an accidental node contact, penalizes close parallel projection as well
  as exact collinear overlap, and still permits an intentional branch at the route's own start or
  end. Priority is component hits, exact overlap, accidental node contact, near-parallel run,
  ordinary crossing, then length/corners — small unconnected crossings remain the preferred
  compromise and keep their hop arc.
- [x] Explorer header now matches the four requested VS Code actions: New simulation, New folder,
  Refresh, and Collapse All. New items use an inline focused name field (Enter commits, Escape or
  blur cancels) instead of browser prompts; Open Folder and Import `.asc` remain available below
  the tree.
- [x] Run and Errors are real controls, not decorative states: Run invokes the existing simulation
  callback and is green until a known validation failure makes it red; Errors expands/collapses
  from its header and automatically reopens when a new issue arrives. Switching between Schematic
  and Simulator no longer discards the last result, so the red state remains visible on return.
- [x] Verification: 41 routing geometry tests, focused Explorer/Toolbar/Errors interaction tests,
  staged-only 100-file / 1499-test Vitest suite, TypeScript typecheck, production web build, and
  in-app browser checks of all four Explorer actions plus both green and red status states. The
  shared dirty tree's additional in-progress units also passed (104 files / 1550 tests), but are
  deliberately excluded from this schematic commit. An independent staged-diff review additionally
  caught and closed candidate-elbow junctions, changed-error re-expansion, and false refresh-success
  notices before publish.
