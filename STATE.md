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
**Unit:** Drawing primitives (`LINE`/`RECTANGLE`/`CIRCLE`/`ARC`) survive a save
instead of blocking it. Same passthrough shape as the `WINDOW` unit: carry them
on the document, re-emit them, drop the `drawing primitives` rewrite risk.
**Started:** 2026-07-29
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

1. **The next save blocker after `WINDOW`: drawing primitives.** With placement
   preserved, `LINE`/`RECTANGLE`/`CIRCLE`/`ARC` are the most common remaining
   reason an imported `.asc` still cannot be saved. `parseAsc` already keeps
   them in `doc.shapes`; the exporter drops them. Same passthrough shape as
   the `WINDOW` unit.
2. **`.dc` is proven, `.tran` and `.ac` are not.** With the DC-sweep proof
   landed, transient and AC are the two native paths left whose vector contract
   is only unit-tested against mocked vectors. `.tran` is the highest-traffic
   analysis in the app, and `runNativeTransient` carries the most unproven
   name-matching of any adapter (`componentCurrentVector`'s `<ref>#branch` /
   `i(<ref>)` / `@<ref>[id]` ladder). Same harness shape as
   `scripts/dcSweepNative.corpus.ts`.

---

## Landed

Newest first. One line each: date, unit, evidence.

- 2026-07-29 - Every analysis result now names the solver that produced it, so
  a number can be traced to ngspice or to the TypeScript preview solver instead
  of being read as though one engine answered everything. The two engines model
  different circuits (the preview solver has no semiconductor stamps and refuses
  transistors outright), so an unattributed figure was the last place Tau
  presented a subset answer as if it were the full one. The badge reads off the
  DISPLAYED result rather than the runtime, and `activeResult` was already
  mode-aware, so switching analysis tabs re-attributes; a result carrying no
  engine shows no badge rather than implying the native one. Provenance is an
  App-layer concern - the solvers do not know their own - so nothing was added
  to the six result contracts; the App state/panel props intersect them with
  `EngineProvenance` instead. All five native-first analyses route through one
  `resolveEngineResult(native, () => fallback())` seam, which makes naming the
  wrong engine unwritable at a call site and keeps the fallback lazy; transient
  and `.step` stamp explicitly because they branch further. A `.step` family
  whose members did not all come from one solver carries no badge. Mutation-
  checked four ways: badge read from the runtime instead of the result (kills 3),
  badge computed but never rendered (kills 4 - trap 1), the seam always claiming
  ngspice (kills 1), the fallback made eager (kills 2). Also retired the three
  strings still calling ngspice "planned" or the shipped solver "interim"
  (`acSweep.ts`, `linearTransient.ts` x2) - ngspice has shipped since v1.0.
  KNOWN_ISSUES said in as many words that nothing labelled the engine; that line
  is now the feature's description. Gates: tsc, full suite 2226 passed / 148
  files, cargo test + clippy clean, corpus held at 80/80/80/80.
- 2026-07-29 - A real transistor DC sweep runs end to end in the repo, so the
  native `.dc` path is checked against ngspice rather than against mocked
  vectors. Extracted the two engine-facing assumptions out of
  `runNativeDcSweep` so the proof exercises shipped code, not a copy:
  `DC_SWEEP_SCALE` (ngspice names the axis for the swept source's type -
  `v-sweep` or `i-sweep` - not for its refdes) and `splitDcSweepLegs` (a nested
  sweep returns as one flat inner-major run; the inner leg restarts when the
  axis returns to its first value). Real-ngspice proof:
  `scripts/dcSweepNative.corpus.ts` - an NMOS common-source stage swept
  gate-inner / rail-outer that the TS solver refuses outright, whose drain
  voltage is checked in closed form (Level 1 saturation with `Vds = Vdd - Id*Rd`
  gives `Id = a(1+lambda*Vdd)/(1+a*lambda*Rd)`) at all 33 points across 3 rails
  to 6 decimals; a divider both engines answer identically; and a current-source
  sweep, which is the only thing in the repo exercising the `i-sweep` half of
  the scale rule. Leg order pinned by holding each leg's `vdd` column against
  the outer values `sweepValues` computes - the same arithmetic the adapter
  captions with - so a mis-split cannot pass by smearing one rail's curve under
  another's caption. Mutation-checked four ways: dropped `i-sweep` (kills the
  current case), collapsed the splitter (kills the nested case), retuned the
  shipped `TAU_NMOS` starter model (kills the deck assertion), and perturbed the
  harness's own closed form by 0.001 in lambda (kills the 33-point comparison,
  so it is not vacuous). No guard moved, no shipped behaviour changed; the 34
  existing `nativeSpice.test.ts` cases still pass and the corpus held at
  80/80/80/80.
- 2026-07-29 - `.noise` runs on ngspice end to end, so a noise figure now
  includes a transistor's own shot and flicker noise instead of resistor thermal
  noise alone. Recovered the `-wip` rescue commit's TS half (`analysisLine`
  noise branch, `runNativeNoise`, App wiring, unit tests) and added the
  real-engine proof its own comment referenced but never contained. Reads both
  plots ngspice splits a noise run across: density curves out of `extraPlots`,
  integrated totals out of the current plot. An input source carrying no AC
  amplitude is named before the round trip - verified at the CLI that ngspice
  aborts the whole run on one, leaving no plots at all, so there is no partial
  answer to salvage. `.noise` was already in the Rust card allowlist, so no
  guard moved. Real-ngspice proof: `scripts/noiseNative.corpus.ts` - a 10k/10k
  divider whose 5k of thermal noise must sit flat at sqrt(4kTR) =
  9.10 nV/sqrt(Hz) with the total at that times sqrt(bandwidth), agreeing with
  the shipped TS solver on the one case both engines can answer; plus a
  common-emitter NPN the TS solver refuses outright whose output noise is 57x
  Rc's own thermal floor. The proof parses ngspice's plot listing, so the
  two-plot split and every name in `NOISE_VECTOR_NAMES` is checked against a
  real run rather than restated. Mutation-checked three ways: a wrong spectrum
  vector name (kills the corpus and 5 unit tests), reading the spectrum from
  the current plot instead of `extraPlots` (kills 5), the AC precheck removed
  (kills 1). KNOWN_ISSUES / README / SHARE updated - all three named noise as
  a headline gap, and SHARE's blurb was separately wrong about which switch
  kind is unmodelled (`csw`, not the voltage-controlled one that landed
  2026-07-28) and still called DC sweep and `.tf` non-native.
- 2026-07-29 - The native bridge can see a run's secondary plots at all:
  `ngSpice_AllPlots` plus a before/after snapshot yields `SpiceResult.extraPlots`,
  which is what a `.noise` run's spectral-density curves live in - unreachable
  through `ngSpice_CurPlot`, which returns only the two integrated scalars. The
  primary read keeps its own untouched `MAX_TRANSFER_VALUES` budget so no deck
  that used to fit can newly overflow; extras get a separate smaller budget and
  are named on the message channel rather than dropped silently. Real-ngspice
  proof against Tau's bundled libngspice
  (`returns_both_plots_of_a_real_noise_run`): a 10k/10k divider whose output sees
  5k of thermal noise, so the spectrum must sit flat at sqrt(4kTR) =
  9.1 nV/sqrt(Hz) and the integrated total must equal that times sqrt(bandwidth) -
  both hold, and a following `.op` on the same engine reports no extra plots, so
  a later run cannot inherit an earlier one's. Mutation-checked: with capture
  disabled the test fails on an empty `extraPlots`.
- 2026-07-29 - `.tf` reaches ngspice, so gain / Zin / Zout can be taken on a
  circuit with a transistor in it. Port resolved before the round trip so a bad
  node or stimulus keeps the panel's own wording; ngspice's three scalars matched
  by shape through an exported `TF_VECTOR_MATCHERS`. `.tf` was already in the
  Rust card allowlist, so no guard moved. Real-ngspice proof:
  `scripts/tfNative.corpus.ts` - a 1k:1k divider where both engines and the hand
  computation agree (0.5 / 2 kΩ / 500 Ω), and a common-emitter NPN the TS solver
  refuses outright. Mutation-checked both ways.
- 2026-07-29 - A `.include`/`.lib` naming a file beside the schematic is now
  READ at import time and attached as a model library, so a vendor model
  resolves on its own instead of only warning. Confined like the symbol reads
  (relative, no `..`, inside the project) plus a model-file extension
  allowlist, and a read that fails no longer sinks the import. Real-ngspice
  proof: a 2N3055 from LTspice's `standard.bjt`, copied beside a temp `.asc`,
  resolves through `importProjectAsc`, inlines into the deck, and biases a
  common-emitter stage to its own Bf (`scripts/includeResolution.corpus.ts`).
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
