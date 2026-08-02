# Autobuilder state

The working memory of an unattended loop that starts from zero every fire.
**Read this first and read it fully. It is small on purpose.**

Rules:
- Rewrite `## Now` at claim, and again at end of fire. Never leave it stale.
- Append one line to `## Landed` per unit that lands green. Newest first.
- Anything a human must do goes in `## Blocked on Omar` and stays there.
- Keep this file under ~200 lines. Prune `## Landed` past 30 entries; the git
  log is the real history.
- `AUDIT_2026-07-27.md` is the backlog. `PROGRESS.md` (466 KB) and
  `FEATURE_PARITY.md` (142 KB) are archives - **do not read them to plan work.**
  Open them only to append, or when this file names a specific section.

---

## Now

**Status:** IDLE
**Unit:** -
**Started:** -
**Branch:** auto/ltspice-parity

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

**The `-wip` branch is currently already reconciled.** Its tip `3f69254` held
the `.noise` TypeScript half; that work landed 2026-07-29 as `dddda1c` (with
the real-engine proof it was missing), so `..-wip` still shows one commit
"missing" purely because the SHA differs. Nothing there needs re-applying -
do not spend a fire diffing it again. Re-check only if its tip moves past
`3f69254`.

---

## Next up

Ordered. Take the top item unless it is blocked. Class A outranks everything -
a plausible wrong number is worse than a refusal to run.

1. **The extended slots still cannot be restored onto a symbol Tau rewrites.**
   The 2026-08-02 unit carries `Value2`/`SpiceLine` back into their own slots,
   but only for a part re-emitted under its source symbol. A lossy-carrier kind
   (switch, comparator, subckt, test point) is written out as a placeholder
   resistor, so its slots have nowhere to land and the save is still refused.
   Closing that means giving the carrier a Tau-only slot to park them in - the
   same trick `TauKind`/`TauValue` already use - and is worth one unit.
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
- 2026-07-28 - An unresolvable `.include`/`.lib` is dropped from the deck and named on the warning channel instead of being emitted verbatim, which the native sanitizer....
- 2026-07-28 - `WINDOW` label placement survives a save instead of blocking it.
- 2026-07-28 - `.dc` reaches ngspice: `runNativeDcSweep` + `App.tsx` wiring, so a transistor transfer curve can be swept at all.
- 2026-07-28 - Voltage-controlled switches emit a real `S` element instead of a permanent open circuit, with both control pins imported.
- 2026-07-28 - Vendor models read via `ltspiceLibRoot()` so no macOS TCC prompt can stall an unattended fire. 3 suites verified running, not skipping.
- 2026-07-28 - Trace palette replaced with validated Okabe-Ito.
- 2026-07-28 - KiCad importer hardened: control-char strip (a newline in a quoted field forged `.asc` records), tokenizer cap fixed (only fired on one branch), input byte....
- 2026-07-28 - Class A truth pass: model-substitution warnings, `.step` truncation warning (and it is now rendered), lossy `.asc` export warnings, transformer....
- 2026-07-28 - Light theme with System/Light/Dark, applied before first render.
- 2026-07-28 - `deck_lines` folds `+` continuations before screening, closing a file-primitive smuggling path. ---.

## Blocked on Omar

- **Notarization.** `tauri.conf.json` has `signingIdentity: "-"` and
  `hardenedRuntime: false`. That configuration cannot pass notarization. Needs
  his Apple Developer ID. Do not attempt.
- **Corpus inputs.** `~/Downloads/LTspice_export` was deleted in a disk
  cleanup, so the corpus is 80 files against a recorded baseline of 82 and
  `scripts/acceptance-corpus.sh` fails its `>= 82` assertion. This is missing
  input, not a regression. **Do not lower the baseline.** What matters is that
  imported / deck-built / op-converged / schema-valid all stay at 80.
- **Disk.** 2026-08-01: 1.6 GiB free on a 100%-full volume, and `cargo clippy`
  died with `No space left on device` mid-fire;
  `apps/desktop/src-tauri/target/debug/incremental` (371 MB of regenerable
  cache) was removed to get past it. `target/` is still ~3.7 GB. A release
  build or a full engine rebuild needs room this host does not have - check
  `df -h /` before starting either.

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
