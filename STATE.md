# Autobuilder state

The working memory of an unattended loop that starts from zero every fire.
**Read this first and read it fully. It is small on purpose.**

## Now

**Status:** IN PROGRESS - 2026-08-02 19:02 CDT

Interactive parity unit claimed: hierarchical-block save, half 2 of 2. Preserve
the original block record and suppress its unchanged flattened simulation
members; an edited, deleted, duplicated, or incomplete child must remain a hard
save refusal. The scheduler is unloaded and its leaked Vite/esbuild children
were stopped before this claim, so no autonomous run can race the unit.

Landed the CONFIRMED `newCircuit` leak from the top of `FIX_BUGS.md`: the reset
had fallen one field behind, so a new circuit still held the previous file's
`ascDataFlags` and saving it wrote that file's `DATAFLAG` readouts into one that
never had them. **The reset is now derived from `blankDoc(): Doc`, so a carried
field added to `Doc` is a compile error until it is cleared** - a hand-listed
reset had already leaked model-library attachments once, and this was the second
time. Do not go back to listing the fields.

**A hierarchical block's record must NOT go on `ascForeignSymbols`.** That set
feeds `assertSimulationIntegrity` (`App.tsx:578`), which refuses to simulate
anything in it; a resolved block DOES simulate, so reusing the field would have
stopped the flagship class-d example running at all. `ascHierarchicalBlocks` is
a separate field for that reason, and a block nested inside a block's own body
stays with the child file. Half 2 of that unit is "Next up" item 1 below.

**Save-block census, measured over the 4,012 real `.asc` under `~/Documents`,
imported with a sibling resolver: 36 files blocked** - 20 `extended symbol
attributes` (item 2 below), 17 `symbol-library identity` (item 1 below), and 0
`unknown LTspice records`, a category `DATAFLAG` support emptied entirely.

A census MUST decode with `decodeSchematicText(readFileSync(f))`, never
`readFileSync(f, "latin1")` and never `grep`: `DCopPnt.asc` is UTF-16LE, so
both of those instruments miss it and under-count the category.

All frontend, production web, Rust, native operating-point and native XSPICE
gates pass, as do the packaged-app and Chrome UI checks. Completion verification
runs analog and XSPICE smoke tests against the library inside the mounted DMG,
not merely the pre-package resource.

**Engine build notes, learned the hard way 2026-08-01 - keep these:**

1. **Clone from the GitHub mirror, not SourceForge.** SourceForge served ~1.4
   MB/min (hours); `https://github.com/imr/ngspice.git` carries the identical
   pinned SHA and a `--depth 1` fetch of it took 4 seconds. The script takes
   `NGSPICE_REPOSITORY` as an override, and the SHA check makes the host
   irrelevant. `build/ngspice-src` is already at the pinned commit.
2. **Kill every stray `make` before re-running.** The script's
   `rm -rf "$BUILD_DIR"` races a previous run's surviving children and dies on
   "Directory not empty".
3. A full build is ~25 minutes on this host, nearly all of it ngspice's device
   library. Budget a whole fire.

If Status is IN PROGRESS with a timestamp older than ~2 hours, the previous
fire died mid-unit (usage limit or watchdog). Recover before starting anything
new:

1. `git log --oneline -8` and `git status` on the work branch.
2. Check for an `auto/ltspice-parity-wip` branch - the runner's durability
   rescue commits a dirty tree there before resetting.
3. Finish that unit or revert it cleanly. Then update this block.

Being killed mid-unit is normal and expected on a Pro plan. It is not a
failure, and it is not a reason to restart the unit from scratch. Pick up the
partial work.

No `-wip` rescue ref is outstanding. `45365c4` was inspected and deleted this
fire: it held only an interrupted heartbeat claim plus a census note, both of
which are folded into the block above.

---

## Next up

Ordered. Take the top item unless it is blocked. Class A outranks everything -
a plausible wrong number is worse than a refusal to run.

1. **A hierarchical block still cannot be saved in place - half 2 of 2.**
   Half 1 landed: the un-flattened `SYMBOL` is now carried on the document as
   `ascHierarchicalBlocks` and the block reason names the hierarchy. What
   remains is the hard half - the exporter must emit that record and NOT the
   flattened parts. That needs per-component provenance (which flattened part
   came from which block instance) plus a guard: if the user edited a part
   inside the block, the edit belongs in the CHILD `.asc`, which Tau is not
   writing, so that case must stay blocked rather than be silently dropped.
2. **A folded value that was edited blocks the save.** By design: an op-amp's
   value IS its slots joined, so an edit cannot be split back across them. The
   honest fix is to stop folding - give the component structured parameters
   instead of one string - which is a much larger unit than this note implies.
   Logged so it is a decision, not an oversight.
3. **The provenance record describes the tree, not its contents.** The check
   landed 2026-08-01 refuses a staged resource whose `build-info.json` is absent,
   from another commit, or from another target, and it names every required file.
   It cannot tell that the library *file* was swapped after a legitimate build,
   because the record holds no digest. Recording a SHA-256 per staged file at
   staging time and verifying it in `build.rs` would close that; the cost is that
   adopting it needs a full engine rebuild (~25 min) to regenerate the record,
   which is why it was not folded into the same unit.

---

## Landed

Newest first, ONE line each. Full evidence for every unit is in PROGRESS.md
and in its commit message. This section exists so a fresh fire can see what
is already done at a glance, not so it can re-read the reasoning.

- 2026-08-02 - A NEW CIRCUIT NO LONGER INHERITS THE PREVIOUS FILE'S `DATAFLAG` READOUTS, which a save wrote to disk. `newCircuit`'s reset now comes from `blankDoc(): Doc`, whose explicit return type makes an uncleared carried field a compile error instead of the next leak.
- 2026-08-02 - A HIERARCHICAL BLOCK'S SAVE-BLOCK REASON STOPS LYING (half 1 of 2): the resolved-and-flattened `SYMBOL` is carried as `ascHierarchicalBlocks`, turning `["symbol-library identity","partially supported devices"]` into `["hierarchical blocks"]` on the class-d starter. It is a SEPARATE field because `ascForeignSymbols` feeds the simulation-integrity refusal and a block must still simulate.
- 2026-08-02 - A `DATAFLAG` READOUT SURVIVES A SAVE, emptying the whole `unknown LTspice records` category: save-blocked over 4,012 real `.asc` falls 39 -> 36, and the 8 records in the 3 affected files round-trip identically with no save warning. The expression is carried as the verbatim line tail, never re-joined from split tokens.
- 2026-08-02 - FRESH PACKAGED-APP QA IS GREEN. The exact release `.app` opens the canonical `class-d_starter.asc` with its sibling `deadtime` block, runs bundled ngspice to 16,873 samples / 33 parts, renders the expected switching and sine/output waveforms, and reports Efficiency = 990.7 m (99.07%). The same top-level file without its required sibling sources refuses by name and shows no telemetry or partial plot. Chrome at the 900x600 minimum had zero clipped controls and zero console warnings/errors.
- 2026-08-02 - THE SCHEDULER IS ACTIVE AND ITS COMPLETION PROOF REACHES INSIDE THE DMG. Its first controlled fire honored quota backoff, exited 0, and released the PID lock. A completion marker now requires real OP and XSPICE runs against the mounted Tau.app's bundled library before notification.
- 2026-08-02 - UNSUPPORTED DEVICES CAN NO LONGER PRODUCE A PLAUSIBLE FALSE ANSWER. DIAC/TRIAC invoke the unmodified file's own `.subckt`s, VARISTOR and PHIDET have direct LTspice waveform parity proofs, and NIGBT/LT1184F refuse atomically by name. The canonical runner now truthfully proves 80/82 warning-clean, deck-built, and op-converged, with the two refusals separated from hard failures.
- 2026-08-02 - NATIVE AC returns source/inductor/semiconductor currents and OP exposes device bias, conductance, and region data, all held against real ngspice vectors.
- 2026-08-02 - WAVEFORM PNG EXPORT captures every visible pane at 2× with computed theme styles inlined.
- 2026-08-02 - `.step` RUNS COMPLETE FAMILIES through 256 points, refuses larger products before any solver call, and evaluates/renders `.meas` per member.
- 2026-08-02 - THE AUTOBUILDER CONTROL PLANE is atomic and proof-gated: PID-owned lock, dead-owner recovery, disk floors, exact-HEAD two-commit completion proof, and no stale sentinel can notify completion.
- 2026-08-02 - A VENDOR SYMBOL Tau cannot map no longer blocks the save: `ascRewriteRisks` takes the document's authoritative `ascForeignSymbols` and subtracts the risks those records raise. Save-blocked over 4,012 real `.asc` falls 3,509 -> 46, 0 newly blocked, and all 3,463 newly-saveable files survive a write-then-reimport with no lost record and no count change. The set MUST be passed in, not re-derived: a resolved hierarchical block flattens, so a locally derived set would unblock a lossy save.
- 2026-08-02 - A VOLTAGE-CONTROLLED SWITCH is written back as a `sw` with all four pins instead of a placeholder resistor; `sw.asy`'s bank was already complete, so the "drops the control pair" comment guarding it was stale. `examples/Educational/Vswitch.asc` saves with zero risks and zero warnings.
- 2026-08-02 - A PART SAVED UNDER A PLACEHOLDER SYMBOL keeps its extended slots in a Tau-only `TauAttrs` field. Measured over 3,999 real files: it unblocks ZERO of them - carrier kinds are blocked by symbol-library identity, which is the correct verdict.
- 2026-08-02 - EXTENDED SYMATTR SLOTS (`Value2`/`SpiceLine`) go back into the slots they came from instead of collapsing onto `Value`; `examples/class-d-amplifier/deadtime.asc` now saves end to end with zero risks and zero warnings.
- 2026-08-02 - HIERARCHY PORTS (`IOPIN`) survive a save instead of being silently discarded at parse; carried on the net label their FLAG became, so a port cannot outlive its label or be emitted without its FLAG.
- 2026-08-01 - THE DESKTOP BUILD REFUSES TO PACKAGE AN ENGINE THAT IS NOT THE PINNED BUILD. `build-info.json` was written by every successful run of the build script and read by nothing; `build.rs` now refuses a staged resource with no record, from another commit or target, whose recorded library is absent, or missing a code model. Each refusal proved through a real `cargo build` on a doctored tree....
- 2026-08-01 - THE BUNDLED ENGINE IS TAU'S OWN BUILD AND CARRIES ITS XSPICE CODE MODELS, so a D flip-flop, sample-and-hold or modulator runs. **The handed-down diagnosis....
- 2026-08-01 - A MISSING XSPICE CODE-MODEL BUNDLE stops being silent, and the real-library test that proves the FFI vector read stops dying on it. **Tau's bundled engine....
- 2026-08-01 - FIT-TO-VIEW FRAMES THE ARTWORK, not just the circuit, so the primitives that started rendering last fire are visible to the one thing that decides where the....
- 2026-08-01 - The CANVAS DRAWS the LTspice drawing primitives it has preserved byte-for-byte since 2026-07-29, so a schematic's borders, dividers and hand-drawn diagrams....
- 2026-08-01 - `Ic(Q1)` AND `Id(M1)` - what LTspice itself calls a collector and a drain - resolve to the real current instead of to nothing.
- 2026-08-01 - A MOSFET reports its GATE AND SOURCE (`Ig(M1)`, `Is(M1)`) in a native transient and in the operating-point table, closing the "only a BJT has extra....
- 2026-08-01 - The OPERATING-POINT TABLE lists a BJT's base and emitter beside its collector, closing the scope the previous unit left open: traces existed in a transient....
- 2026-08-01 - A BJT's BASE AND EMITTER have their own traces in a native transient (`Ib(Q1)`, `Ie(Q1)`), so a probe or a `.meas` on either resolves instead of silently....
- 2026-07-30 - A RESISTOR AND A CAPACITOR have a current in the operating-point table, so the two native runs list the same set of parts instead of a transient....
- 2026-07-30 - The `.op` current contract is a GATE now, not a shell transcript.
- 2026-07-30 - The OPERATING POINT reports currents at all, and a semiconductor is one of them.
- 2026-07-30 - A transistor, diode or JFET finally has a current in a native transient, so a clamp probe on one resolves to a trace instead of nothing. ngspice returns a....
- 2026-07-29 - `.ac` proven against a real ngspice run, which was the last native path standing on mocked vectors, and the proof surfaced a live divergence that is now....
- 2026-07-29 - `.tran` proven against a real ngspice run rather than mocked vectors, closing the highest-traffic analysis.
- 2026-07-29 - Drawing primitives (`LINE`/`RECTANGLE`/`CIRCLE`/`ARC`) survive a save instead of blocking it, retiring the most common remaining reason an imported `.asc`....
- 2026-07-29 - Every analysis result now names the solver that produced it, so a number can be traced to ngspice or to the TypeScript preview solver instead of being read....
- 2026-07-29 - A real transistor DC sweep runs end to end in the repo, so the native `.dc` path is checked against ngspice rather than against mocked vectors.
- 2026-07-29 - `.noise` runs on ngspice end to end, so a noise figure now includes a transistor's own shot and flicker noise instead of resistor thermal noise alone.
- 2026-07-29 - The native bridge can see a run's secondary plots at all: `ngSpice_AllPlots` plus a before/after snapshot yields `SpiceResult.extraPlots`, which is what a....
- 2026-07-29 - `.tf` reaches ngspice, so gain / Zin / Zout can be taken on a circuit with a transistor in it.
- 2026-07-29 - A `.include`/`.lib` naming a file beside the schematic is now READ at import time and attached as a model library, so a vendor model resolves on its own....
- 2026-07-28 - `.dc` reaches ngspice, voltage-controlled switches emit a real `S` element with both control pins, `WINDOW` label placement survives a save, and an unresolvable `.include`/`.lib` is dropped from the deck and named on the warning channel. Evidence for all four is in PROGRESS.md.

## Human-owned after the bot's completion signal

- Signing/notarization/distribution are Omar's post-completion steps and never
  gate the unsigned production-ready completion signal. The corpus inputs are
  restored, and the runner enforces an 8 GiB fire floor plus 2 GiB session
  floor; still check `df -h /` before release or native-engine builds.

---

## Traps that have already bitten this project

Check for each before calling a unit done.

1. **A warning computed but never rendered.** `.step` truncation was stored on
   the result while `StepPlot` drew the plot, legend and meters and never
   touched `result.warnings`. Trace every new message to a visible element.
2. **A test that passes without its fix.** Two regression tests here did,
   because the fixture geometry did not reproduce the bug. Revert the fix,
   watch the test fail, restore it. A test that never failed proves nothing.
3. **A new warning silently becoming a blocker.** `ascSaveBlockReason` treated
   any export warning as fatal, so an informational notice would have refused
   to save any schematic with a switch or subcircuit. Grep every consumer of a
   list you add to.
4. **A "hardcoded color" scan that misses keywords.** `color-mix(..., white)`
   is invisible to a hex/rgba grep and made the light-mode Run button
   unreadable.
5. **Reading the full suite's red as a regression.** `pnpm test` runs 147 files
   at full worker concurrency and this machine has very little free RAM, so
   jsdom `render()` calls time out at 5 s and 20-40 tests fail *non-
   deterministically on a clean tree too*. Do not spend a fire bisecting it.
   Re-run with `--maxWorkers=2`, or run the failing files on their own; if they
   pass there, it is contention. Establish the clean-tree count before blaming
   your own diff.
6. **A subagent that outlives the fire interval gets its tree force-committed.**
   A single delegated edit ran ~12 minutes here; the durability net fired twice
   during it, rescued the half-written tree to `-wip`, hard-reset the clone
   mid-edit, and then committed the finished tree onto the work branch itself as
   `wip: checkpoint ...`. The work survived and the subagent's own gate run was
   unaffected, but the commit message cannot be rewritten (no history rewriting),
   so the unit lands under an ugly message with the real one on top. Keep a
   delegated edit well under the interval, or expect to review a checkpoint
   commit instead of a working tree. `git status` looking clean after a subagent
   returns does NOT mean the work vanished - check `git log` before redoing it.
7. **A proof pipeline that quietly stops proving.** `design-shot.mjs` broke
   when the workspace stopped seeding examples, then covered only light once
   light tokens landed. Look at the PNGs.
