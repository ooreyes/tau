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

**Status:** IN PROGRESS
**Unit:** P9 second half - resolve a `.include`/`.lib` against the schematic's
own folder at open time and attach the text as a user model library, so the
common vendor-model case resolves instead of warning. Confined to the project
root (a `.include` is attacker-controlled text; absolute paths and `..` escapes
must stay refused) and reusing the existing byte/count caps.
**Started:** 2026-07-28
**Branch:** auto/ltspice-parity

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

---

## Next up

Ordered. Take the top item unless it is blocked. Class A outranks everything -
a plausible wrong number is worse than a refusal to run.

1. **P9 second half - actually READ the `.include`/`.lib` file.** The directive
   no longer sinks the run (landed 2026-07-28), so the deck reaches ngspice and
   names the file it could not resolve. What is still missing is resolving that
   name relative to the source `.asc` through the FS bridge
   (`project/fsBridge.ts` `readTextFile`) and registering the text as a model
   library, so the common case resolves instead of warning. The plumbing to
   use it already exists: `parseUserModelLibraries` +
   `schematic.userModelLibraries`. Note the netlist builder is deliberately
   pure (no FS access) - do the read at import/open time in `App.tsx` or
   `io/fileImport.ts`, not inside `buildSpiceDeck`. Also note `.include` is
   resolved by NAME, not by file: once the text is attached, every model and
   subckt in it resolves through the registry, so nothing has to match the
   `.include` path.
2. **P3 remainder - `.noise`/`.tf` on ngspice.** `.dc` landed 2026-07-28;
   these two still run only on the TS solver, which rejects transistors.
   Mirror `runNativeDcSweep`. Note `analysisLine` has no `noise`/`tf` branch
   yet, so this needs a deck line as well as a runner.
3. **A MOSFET DC-sweep corpus proof.** The native DC path is unit-tested
   against mocked vectors and its ngspice contract was checked by hand at the
   CLI, but nothing in the repo runs a real transistor sweep end to end. A
   `scripts/dcSweepNative.corpus.ts` in the shape of
   `scripts/sampleHoldParity.corpus.ts` would close that.
4. **P16 - engine badge**. Nothing tells the user whether ngspice or the TS
   solver produced a result. Also fix the two strings still calling ngspice
   "planned" (`simulation/noise.ts:332`, `simulation/acSweep.ts:291`).
5. **The next save blocker after `WINDOW`: drawing primitives.** With placement
   preserved, `LINE`/`RECTANGLE`/`CIRCLE`/`ARC` are the most common remaining
   reason an imported `.asc` still cannot be saved. `parseAsc` already keeps
   them in `doc.shapes`; the exporter drops them. Same passthrough shape as
   this unit.

---

## Landed

Newest first. One line each: date, unit, evidence.

- 2026-07-28 - An unresolvable `.include`/`.lib` is dropped from the deck and
  named on the warning channel instead of being emitted verbatim, which the
  native sanitizer rejected - so the whole schematic used to fail to run. Guard
  untouched; the card just never reaches it. Real-ngspice proof: same circuit,
  with the directive `fatal error in ngspice, exit(1)`, without it a full
  operating point. Two old tests asserting the passthrough were wrong about the
  native engine and now assert the drop.
- 2026-07-28 - `WINDOW` label placement survives a save instead of blocking it.
  Carried on the component, re-emitted when the part keeps its own symbol,
  warned about when it does not. Real-corpus proof: 1851 placements across 300
  files re-emitted byte-identical, 93 files newly saveable
  (`scripts/ascWindowRoundTrip.corpus.ts`).
- 2026-07-28 - `.dc` reaches ngspice: `runNativeDcSweep` + `App.tsx` wiring, so
  a transistor transfer curve can be swept at all. Nested runs split back out of
  ngspice's flat inner-major vector; mutation-checked.
- 2026-07-28 - Voltage-controlled switches emit a real `S` element instead of a
  permanent open circuit, with both control pins imported.
- 2026-07-28 - Vendor models read via `ltspiceLibRoot()` so no macOS TCC prompt
  can stall an unattended fire. 3 suites verified running, not skipping.
- 2026-07-28 - Trace palette replaced with validated Okabe-Ito. Old palette
  failed the normal-vision floor (green/cyan deltaE 11.6 vs 15). Both modes
  now ALL CHECKS PASS via `scripts/validate-palette.mjs`.
- 2026-07-28 - KiCad importer hardened: control-char strip (a newline in a
  quoted field forged `.asc` records), tokenizer cap fixed (only fired on one
  branch), input byte cap added before parsing.
- 2026-07-28 - Class A truth pass: model-substitution warnings, `.step`
  truncation warning (and it is now rendered), lossy `.asc` export warnings,
  transformer `L1`/`L2`/`k`, FET current probe, net-label collision.
- 2026-07-28 - Light theme with System/Light/Dark, applied before first render.
- 2026-07-28 - `deck_lines` folds `+` continuations before screening, closing a
  file-primitive smuggling path.

---

## Blocked on Omar

- **Notarization.** `tauri.conf.json` has `signingIdentity: "-"` and
  `hardenedRuntime: false`. That configuration cannot pass notarization. Needs
  his Apple Developer ID. Do not attempt.
- **Corpus inputs.** `~/Downloads/LTspice_export` was deleted in a disk
  cleanup, so the corpus is 80 files against a recorded baseline of 82 and
  `scripts/acceptance-corpus.sh` fails its `>= 82` assertion. This is missing
  input, not a regression. **Do not lower the baseline.** What matters is that
  imported / deck-built / op-converged / schema-valid all stay at 80.

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
6. **A proof pipeline that quietly stops proving.** `design-shot.mjs` broke
   when the workspace stopped seeding examples, then covered only light once
   light tokens landed. Look at the PNGs.
