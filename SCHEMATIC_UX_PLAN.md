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
- [x] 5b. Transistor arrows — `apps/desktop/src/schematic/symbols.tsx`: npn (~line 455) / pnp
      (~line 466) used open unfilled chevron paths that render as stray lines; nmos (~436) /
      pmos (~452) / njf / pjf arrows unfilled. Replaced with filled triangles (class
      `symbol-arrow`, CSS `fill: currentColor; stroke: none`) with correct conventions:
      NPN arrow on emitter pointing OUT, PNP pointing IN toward base, NMOS into channel,
      PMOS out of channel.
- [x] 6. Run button + Errors strip status color — Toolbar.tsx already has `result`/`runState`
      and a `.run-lamp-dot`. Added subtle gradient states on the Run button: `--success`-tinted
      gradient when last run ok / circuit clean, `--danger`-tinted when `result.ok === false`,
      neutral when idle. Same treatment on the schematic BottomPanel "Errors" header strip
      (ShellPanels.tsx ~line 568; it derives `hasIssues`/`hasError` from `result`). Tokens only,
      keep it restrained (Palantir, not candy).
- [x] 4. Click-to-delete affordance — Canvas.tsx: when a selection exists in the schematic
      editor (selectedIds / selectedWireIds / label / probe selections), render a 30×30 floating
      "✕" pill button near the selection's screen-space bbox top-right corner. Clicking calls the
      existing delete action (`deleteSelected` — the same one the Delete key uses, App.tsx
      keyboard handler). Pointer-events on, does not steal canvas drags. Hidden in simulator mode.
- [x] 1. Net-label placement avoiding wires/probes — `autoNetLabelOffset` in
      Canvas.geometry.ts currently only scores candidate offsets against component bboxes.
      Extended scoring to penalize: overlap of the label text box with wire segments, probe
      dots (r≈8 at probe.x/y), and other net labels' boxes. `autoNetLabelOffsets` places labels as
      a deterministic set: manually dragged labels reserve their chosen boxes first, then auto
      labels reserve slots in document order. The Canvas callsite passes wires + probes.
- [x] 2. Hop-over arcs at unconnected wire crossings — WireView/pathFromPoints in Canvas.tsx
      (~line 1193-1221). Plan implemented: compute crossings between HORIZONTAL segments of each
      wire and VERTICAL segments of all other wires; a crossing point that is NOT in the
      `junctions` set (Canvas.tsx ~line 172, same semantics as net extraction) and not an
      endpoint of either segment gets a semicircular hop (r=4, bulge up / −y) in the horizontal
      wire's path. Multiple crossings per segment sorted along travel direction; path arcs via
      `A 4 4 0 0 sweep` with sweep flipped for right-to-left segments so the bump always points up.
      Pure helper `pathWithHops(points, hopXsBySegment)` in Canvas.geometry.ts + unit tests;
      Canvas computes per-wire hop positions with a memo over (wires, junctions).
- [x] 3. Cleanest-path auto-routing — `routeWireSmart` (Canvas.geometry.ts ~line 669) already
      generates channel candidates and scores by `hits/length/corners`. Added two scoring terms
      between hits and length: `crossings` (count of intersections with existing wires — requires
      passing `wires` into the router; callsites: Canvas.tsx addWire (~line 383) and
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
