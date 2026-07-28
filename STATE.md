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
**Unit:** none claimed
**Started:** -
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

1. **P2 - voltage-controlled switches** (Class A). Emit a real `S` element;
   today it is `R 1e12`, a permanent open circuit, and both control pins are
   dropped at import. Silently wrong on every SMPS, relay and ideal-switch
   circuit. `io/ascImport.ts:482`, `engine/spiceNetlist.ts:780-783`, plus a
   4-pin `switch` kind in `schematic/pins.ts` and its symbol.
2. **P3 - `runNativeDcSweep`** (Class B). `.dc` never reaches ngspice and the
   TS solver rejects transistors, so a MOSFET DC sweep is impossible. The deck
   branch at `engine/spiceNetlist.ts:946-968` already exists and is dead code;
   mirror `runNativeAcSweep`.
3. **P6 - opaque-record passthrough**. A `WINDOW` record blocks saving an
   imported `.asc`, and LTspice writes one whenever a label is nudged. Tau is a
   viewer, not an editor, until this lands. `project/types.ts:100-128`.
4. **P9 - resolve `.include`/`.lib`** relative to the source `.asc` through the
   existing FS bridge, instead of hard-failing the run.
5. **P16 - engine badge**. Nothing tells the user whether ngspice or the TS
   solver produced a result. Also fix the two strings still calling ngspice
   "planned" (`simulation/noise.ts:332`, `simulation/acSweep.ts:291`).

---

## Landed

Newest first. One line each: date, unit, evidence.

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
5. **A proof pipeline that quietly stops proving.** `design-shot.mjs` broke
   when the workspace stopped seeding examples, then covered only light once
   light tokens landed. Look at the PNGs.
