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

1. **A primary terminal spelled out resolves to NOTHING.** `findCurrentTrace`
   demands an exact terminal match and the part's own trace carries
   `terminal: undefined`, so `Ic(Q1)` and `Id(M1)` - the natural spellings for a
   collector and a drain, and what LTspice itself calls them - parse as terminal
   signals (`c` and `d` are in `measure.ts`'s letter set for the BJT; `d` is not,
   yet) and then find no trace. Pre-existing for `Ic(Q1)`, found while adding the
   MOSFET's. The fix is to fold the primary letter onto the untagged trace in the
   one `findCurrentTrace` seam - but that widens what `.meas` accepts, so check
   every consumer first (trap 3).
2. **Tau's canvas does not draw the primitives it now preserves.** A saved file
   keeps its artwork byte-for-byte, but the author cannot see it in Tau. That is
   stated plainly in KNOWN_ISSUES; rendering them is the follow-up.
3. **The one Rust test that drives a real libngspice is red on this host and is
   not a gate.** `runs_an_operating_point_with_the_real_ngspice_library` is
   `#[ignore]`d behind `TAU_NGSPICE_LIB`, and with either staged dylib it dies
   partway through on `Unknown model type adc_bridge` - the XSPICE code models
   are not reachable from a bare `cargo test`. Everything in its body after the
   two-bit register case has not been running. Logged in FIX_BUGS 2026-07-29.
   Splitting it, or making the code models findable, would put the FFI vector
   read back under a gate. Run it with `--test-threads=1`: the two real-library
   tests SIGSEGV when they share a process.

---

## Landed

Newest first. One line each: date, unit, evidence.

- 2026-08-01 - A MOSFET reports its GATE AND SOURCE (`Ig(M1)`, `Is(M1)`) in a
  native transient and in the operating-point table, closing the "only a BJT has
  extra terminals" gap. **The unit was the engine question, not the code.** The
  previous fire refused to assume a MOSFET behaves like a BJT and left it to be
  proved at a CLI first; that was right, because the obvious four-param guess is
  WRONG. `@m1[ig]` and `@m1[is]` are real on every model tried (level 1, level 3,
  VDMOS), but **`@m1[ib]` is not, and asking for it fails SILENTLY**: ngspice
  neither errors nor warns on the card, it creates the vector ZERO-LENGTH. That
  matters in production, not just in theory - `spiceNetlist.ts:904` already emits
  a 3-terminal VDMOS line for any MOSFET on a user's `.model … VDMOS(…)`, which
  is exactly what an LTspice power MOSFET is, so the shipped-guess version would
  have hung an empty trace on the most common vendor part in the corpus. Worse at
  a CLI: `print all` refuses to print ANY vector when one is empty, so one bad
  param blanks the entire operating point - node voltages included. Both halves
  are now a gate (`opNative.corpus.ts`), the second asserting the blinding
  directly: same deck twice, `ok.values.size > 4` and `blinded.values.size === 0`
  with `@m1[ib]` listed among the names. **The sum identity needed re-deriving,
  not copying.** A BJT's three terminals sum to zero always; a level-1 MOSFET's
  three do so only when biased ON, because a cut-off device returns its whole
  drain leakage through the bulk (measured: id 5.01e-12 against is 8e-20). So the
  case biases into saturation and says why, and the VDMOS case - genuinely
  3-terminal - carries the exact form of the identity. Gate pinned separately as
  ~0 at DC and the drain held against Rd's own node voltages, so a swapped
  gate/source still fails after the sum passes. `measure.ts`'s letter set went
  `[bce]` -> `[bcegs]`, still closed against the `if(` collision it was closed
  for. Two existing deck assertions were REPOINTED, not deleted - the `.save`
  card legitimately changed shape. Mutation-checked three ways: drop the param
  entry (kills 2 unit + 1 real-engine), revert the letter set (kills 1), stop
  asking for the bulk in the blinded deck (kills 1). Deliberately NOT widened:
  `d` stays out of the letter set, because the drain IS the untagged trace and
  `Id(M1)` would parse and then resolve to nothing - that gap is now Next up #1
  rather than half-fixed here. Gates: tsc, full suite 2266 passed / 148 files
  with ZERO failures at `--maxWorkers=2`, cargo 32 passed + clippy clean, corpus
  80/80/80/80 warning-clean 77 with the proof inside it.
- 2026-08-01 - The OPERATING-POINT TABLE lists a BJT's base and emitter beside
  its collector, closing the scope the previous unit left open: traces existed in
  a transient and stopped at the `.op`, the one analysis where reading a bias
  current is the whole point. **No engine work - the deck was already asking.**
  `wantsDeviceCurrents` covers `op` as well as `tran`, so `@q1[ib]`/`@q1[ie]`
  were being saved and then dropped by the read side's primary-only filter.
  Re-proved at the CLI first that a one-row `.op` plot really returns them: a
  `.tran` returning a vector is not evidence an `.op` does, and the two take
  different paths through ngspice. **The hazard was the read sides, again.**
  `branch.id` is a component id and is no longer unique; three consumers resolved
  a part through it. The table keyed each row by it, and **React renders
  duplicate keys with only a console warning** - the three rows still appear, so
  asserting they render passes WITHOUT the fix (trap 2 caught in the act, by
  running the mutation); the test asserts on the absence of that warning instead.
  `opAnnotations` anchors to the component's own position, so three terminals
  would have stacked three readings on one spot under one key - the canvas keeps
  the part's own current deliberately and the terminals stay in the table.
  `linearTransient` built a Map over the whole list to seed an inductor, the
  last-wins shape that would have taken a terminal's value. All three go through
  one `primaryBranches` seam in `operatingPoint.ts` (beside the contract it
  states) rather than per call site. `.tf` resolves a current output by LABEL and
  reads the TS solver only, so it was left alone rather than quietly widen which
  `.tf` outputs are accepted (trap 3, same trap the previous fire avoided).
  Real-engine proof in `opNative.corpus.ts`: on an `.op` the three sum to zero to
  1e-7 of the collector, emitter negative, base under a tenth of the collector so
  a swapped pair still fails after the sum passes, and the collector separately
  held against Rc's own nodes. Mutation-checked five ways: drop the terminal push
  (kills 1 unit), raw list in `opAnnotations` (kills 1), `primaryBranches` stops
  filtering (kills 2), revert the row key (kills 1), deck stops asking (kills 2
  real-engine). One existing test asserted the narrower behaviour and was
  REPOINTED, not deleted. KNOWN_ISSUES said in as many words that the table lists
  one current per part; it now says the canvas annotation does, and why. Gates:
  tsc, full suite 2264 passed / 147 files, cargo 32 passed + clippy clean, corpus
  80/80/80/80 warning-clean 77 with the proof inside it. One App render file
  timed out under contention (trap 5) and passes isolated; it is untouched here.
- 2026-08-01 - A BJT's BASE AND EMITTER have their own traces in a native
  transient (`Ib(Q1)`, `Ie(Q1)`), so a probe or a `.meas` on either resolves
  instead of silently having only the collector to offer. The blocker was never
  the `.save` card - it was that `CurrentTrace` was one entry per ref-des and
  every consumer looked a part up by that one key. `terminal` now distinguishes
  them, absent on the trace a bare `I(ref)` means. **The dangerous half was the
  read sides, not the feature.** `measurementModel.ts` built a Map over the whole
  current list, so LAST wins: adding the terminals would have made every BJT's
  dashboard row report its EMITTER - a different number with the opposite sign,
  on a table that still looked complete. `runNativeOperatingPoint` had the same
  Map over the deck's `deviceCurrents`. Both now go through one seam
  (`findCurrentTrace` / `primaryDeviceCurrents`) that states "a bare `I(ref)` is
  the part's own current" once instead of per call site; a clamp probe on a
  transistor still reads the collector. Widening `.meas`'s signal pattern to
  reach `Ie(Q1)` nearly broke something unrelated: `if(cond,a,b)` is a real
  expression function (`expr.ts:355`), and `I[a-z]?\(` matches `if(` - so the
  terminal letters are a closed `[bce]` set, with a test that measures an `if()`
  after the change. The FFT picker feeds a trace LABEL back into `resolveSignal`,
  so `parseCurrentSignal` handles the new spelling there too (trap 3 in the dress
  it already wore once). Real-engine proof in `tranNative.corpus.ts`: ngspice
  reports the current INTO each terminal, so the three sum to zero at every
  sample - an identity no scale error, stride error or swapped pair satisfies by
  accident - plus `Ie` negative and `Ib` under a tenth of `Ic`, so a swapped
  Ib/Ie still fails after the sum passes. Tolerance is `print`'s 7 digits, five
  orders of magnitude looser than any real defect. Mutation-checked three ways:
  drop the primary filter (kills 5 unit), stop asking for the terminals (kills 1
  unit + 1 real-engine), revert the signal regex (kills 1). Four existing
  assertions were REPOINTED, not deleted - the `.save` card and the
  `deviceCurrents` record both legitimately changed shape. **Scope stated, not
  papered over:** the `.op` table is unchanged and still lists one current per
  part, because `branches` is keyed by component id; that is Next up #1 and is in
  KNOWN_ISSUES. Only a BJT is widened - a MOSFET's `@m1[ig]`/`@m1[is]` were not
  verified against the engine, so they are not assumed. Gates: tsc, full suite
  2262 passed / 148 files with ZERO failures at `--maxWorkers=2`, cargo 32 passed
  + clippy clean, corpus 80/80/80/80 warning-clean 77 with the proof inside it.
- 2026-07-30 - A RESISTOR AND A CAPACITOR have a current in the operating-point
  table, so the two native runs list the same set of parts instead of a
  transient reconstructing passives and the `.op` leaving them to be worked out
  by eye. **The arithmetic is trivial at DC; the sign is the unit.** A
  two-terminal element's current sign follows its own orientation, so
  `deriveRcCurrents` and the new `deriveDcRcBranches` now share one
  `rcElements` enumeration - which parts qualify and which way round they run
  cannot drift between the two analyses. That shared pin order turns out to BE
  the MNA convention already in the list (both are the current entering the
  first terminal), which is why derived and engine numbers sit together
  unflipped. Proving it needed a vector ngspice DID return, since it returns
  none for a passive (the harness from the previous entry asserts exactly that):
  R1, L1 and R2 sit in ONE series leg of the existing ladder, so a derived
  current must equal `l1#branch` or Tau is reporting two elements of one loop
  running opposite ways - both match, positive; then KCL at the source node
  holds TWO derived currents against a third engine vector, `v1#branch` ==
  -(I(R1) + I(R3)), each leg separately pinned to its closed form so the sum
  cannot pass on one term. C1 is exactly 0 with 5 V across it, so a value
  tracking the node voltage would be conspicuous rather than plausible. An
  unknown terminal SKIPS its element rather than reading as ground - defaulting
  the gap to 0 V would report a confident wrong current for any resistor
  touching a node that never came back. Mutation-checked three ways: flip to
  `(Vb - Va)` (kills the real-engine case + 3 unit), unknown terminal reads as
  ground (kills 2), unwire the call from `runNativeOperatingPoint` (kills 3, so
  the helper is reached and not merely present). Three existing tests asserted
  the narrower behaviour and were REPOINTED, not deleted - "absent, not a
  fabricated zero" now rides on a resistor whose node the engine withheld, a
  sharper case than the one it replaced, plus a new dedupe test. **Scope is
  deliberate:** the TS solver's `branches` is UNCHANGED, because
  `transferFunction.ts:189` resolves a `.tf` current output by searching that
  same list and widening it would quietly change which `.tf` outputs are
  accepted (trap 3). KNOWN_ISSUES says both halves: both native runs list the
  same parts, and the preview's `.op` still lists fewer rows. Gates: tsc, full
  suite 2256 passed / 148 files with ZERO failures at `--maxWorkers=2`, cargo 32
  passed + clippy clean, corpus 80/80/80/80 warning-clean 77 with the proof
  inside it.
- 2026-07-30 - The `.op` current contract is a GATE now, not a shell transcript.
  The previous entry shipped the operating point's currents with their two
  engine-facing assumptions verified by hand at a prompt and never committed;
  `scripts/opNative.corpus.ts` closes that, and it was the one thing the last
  fire named as the next fire's first job. Four cases, all four
  mutation-checked. **The sign is the point.** ngspice's `v1#branch` and the TS
  solver's `branches` unknown are two independently-authored conventions that
  happen to agree, which is why the adapter stores ngspice's value unflipped -
  but the existing unit test feeds its OWN mocked vector, so it can only prove
  the adapter does no flip, never that no-flip is right. The proof runs both
  engines on one ladder and holds their branch currents against each other and
  against the closed form: `v1#branch` negative and equal to the two legs' total
  (1.677 mA), `l1#branch` POSITIVE - opposite sign to the source that drives it,
  same current round the loop - and the TS solver agreeing on both, with an
  explicit assertion that the two have opposite signs so the agreement cannot be
  two zeros or two copies of one number. Flipping the TS source branch kills it.
  Established against the real engine, not assumed: an `.op` returns **no scale
  vector at all** (ngspice marks a node `[default scale]`), so a read side that
  demanded one the way the transient path demands `time` would reject every
  operating point; nodes arrive bare; and a resistor or capacitor gets NO vector,
  which is exactly why the `.op` table lists fewer currents than a transient's -
  the KNOWN_ISSUES claim now tracks the engine. `print all` switches form for a
  one-row plot: `name = value` lines, not the paginated `Index` table the
  transient harness parses, and requiring the `=` is what keeps ngspice's batch
  `.op` summary and its full model-parameter dump out of the parse. Re-proved
  `all` on an `.op` deck rather than inheriting the transient's result: with the
  card 8 vectors, without it 6, and with `all` deleted the run collapses to the
  ONE named vector - every node voltage and both `#branch` currents gone, run
  still succeeding, nothing in the result saying so. Mutation-checked four ways
  in shipped code (flip the TS source sign, drop `all`, stop asking for device
  currents on `.op`, save a BJT's `ie` instead of its `ic`) and once in the
  harness's own arithmetic (perturb the ladder's closed form 0.3%, which kills
  the sign case, so it is not vacuous). No shipped code changed, so no guard
  moved and no doc went stale. Gates: tsc, full suite 2250 passed / 148 files
  with ZERO failures at `--maxWorkers=2`, cargo 32 passed + clippy clean, corpus
  80/80/80/80 warning-clean 77 with the new proof inside it.
- 2026-07-30 - The OPERATING POINT reports currents at all, and a semiconductor
  is one of them. Two halves were missing and either alone kept the number
  invisible: the native `.op` read side never populated `branches` (so on
  ngspice, the default engine, a DC operating point had NO current anywhere),
  and `OpTable` rendered the voltage table only - it never touched
  `result.branches` on EITHER engine, so even the TS solver's source/inductor
  currents, which it has always computed and always drawn as canvas
  annotations, had never appeared in the table. Trap 1 in a new dress, found by
  tracing the value to a visible element instead of trusting the read side.
  Widening the `.save` card to `.op` was proved at the CLI BEFORE writing code:
  `.save all @q1[ic] @q1[ib]` on an `.op` deck returns every node voltage and
  every `#branch` the plain deck did, plus the device currents - strict
  superset. All 80 op-converged corpus files build through this path and all 80
  still converge. Read side reuses the transient's `componentCurrentVector` so
  the two cannot drift. **The SIGN was the hazard**: ngspice's `v1#branch` is
  the negative of the conventional current out of a source's + terminal, which
  is exactly the raw MNA unknown the TS `branches` contract specifies, so the
  values go in UNFLIPPED - pinned by a unit test that feeds a negative reading
  and demands a negative one back, and against the real engine by holding
  `v1#branch` against `-((V(in)-V(coll))/2k + (V(in)-V(base))/470k)`. A flip
  would have shown every source current backwards while every voltage stayed
  right. A branch's `id` is the COMPONENT id, not the ref-des: `opAnnotations`
  finds its component by that id, so a ref-des would have placed zero canvas
  labels silently - guarded by a test. **The real-engine check was run at the
  CLI, by hand, and is NOT yet a repeatable gate** - a common-emitter stage with
  an inductor in the collector leg, where `@q1[ic] + l1#branch` matched
  `(V(in)-V(coll))/2k` (exact by KCL) and `v1#branch` matched the resistors' own
  total, both to the printed digits. **Committed as a gate the next day** -
  `scripts/opNative.corpus.ts`, see the entry above; nothing here is left to
  reproduce. Scope stated
  honestly, not papered over: a
  transient reconstructs R/C currents from node voltages and `.op` does not, so
  its table lists source, inductor and semiconductor currents only - in
  KNOWN_ISSUES, and Next up #1. No guard moved; `.save` was already allowlisted
  and its Rust test now covers the card ahead of an `.op` too. Gates: tsc, full
  suite 2250 passed / 148 files with ZERO failures at `--maxWorkers=2`, cargo 32
  passed + clippy clean, corpus 80/80/80/80 (warning-clean 77).
- 2026-07-30 - A transistor, diode or JFET finally has a current in a native
  transient, so a clamp probe on one resolves to a trace instead of nothing.
  ngspice returns a device's own current only as `@<ref>[<param>]` and only for
  a deck that named it, so the deck now emits a `.save` card. **`all` is the
  whole safety of that card**: verified at the CLI that a bare
  `.save @q1[ic]` REPLACES the default set - 9 vectors collapsed to 2, every
  node voltage and source branch gone - while `.save all @q1[ic] ...` is a
  strict superset. The run still succeeds either way and says nothing, which is
  why it is proved against the engine rather than trusted to the spelling.
  Targets are read off the lines the emitter actually produced, not off the
  component kind, so a BJT whose Value names a `.subckt` (emitted as `XQ1`) is
  correctly skipped. The vector name is recorded on the deck per component and
  the adapter looks up exactly that, so the ask and the read cannot drift.
  Scoped to `.tran`, the one analysis that reads currents back. Kept the label
  `I(Q1)` rather than LTspice's `Ic(Q1)`: the FFT picker feeds a trace LABEL
  back into `runWaveformFft`, which resolves `I(ref)`, so a terminal-qualified
  label would have silently broken the spectrum of every device current - trap
  3 in a new dress. Real-ngspice proof in `tranNative.corpus.ts`: the
  common-emitter stage's `@q1[ic]` held against `(V(vdd) - V(coll))/2k` at every
  sample, which KCL makes exact, so a mis-strided or mis-scaled vector cannot
  pass; plus a superset case that runs the SAME deck with and without the card
  and asserts every vector of the plain run survives. Writing it surfaced that
  the harness's own vector-name regex had no `@` in its character class and had
  been silently skipping device vectors. Added a Rust test too - the corpus runs
  the ngspice binary directly and never sees `deck_lines`, so a card the
  sanitizer rejected would have broken every transistor transient in the app
  with every TypeScript gate green. No guard moved; `.save` was already
  allowlisted. Mutation-checked four ways: `all` dropped (kills 2 real-engine
  cases), card never emitted (kills 2 real-engine + 2 unit), read side ignoring
  the saved name (kills 2 unit, including the pre-existing diode case), `.save`
  removed from the Rust allowlist (kills 2 Rust). Gates: tsc, cargo 32 passed +
  clippy clean, corpus 80/80/80/80. Full suite 2203 passed with 40 render
  timeouts - trap 5, all 10 files pass isolated, and the clean-tree corpus
  baseline was re-measured identical (warning-clean 77) before blaming the diff.
- 2026-07-29 - `.ac` proven against a real ngspice run, which was the last
  native path standing on mocked vectors, and the proof surfaced a live
  divergence that is now closed: the preview solver REFUSES a sweep with no
  AC-excited source, while the native path returned a flat trace at the -300 dB
  floor. Verified at the CLI that ngspice treats an unexcited `.ac` as a clean
  run - no error, no warning, every node exactly 0 + 0j - so there was nothing
  in the result to tell Tau the answer was empty. `hasAcExcitation` +
  `NO_AC_SOURCE_MESSAGE` now live once in `acSweep.ts` and both engines refuse
  through them, param-resolved so an `AC {amp}` still counts. Extracted the
  adapter's two engine-facing conventions (`AC_SCALE_NAME`, `AC_DB_FLOOR`,
  `acTraceFromComplex`) so the proof exercises shipped arithmetic, not a copy.
  Real-ngspice proof: `scripts/acNative.corpus.ts` - an RC low-pass whose pole
  sits exactly on a `dec 4` grid point, with real/imag held against
  `H = 1/(1+jwRC)` at all 17 points, `magDb` against ngspice's own `vdb()`, and
  `phaseDeg` against its `vp()` AFTER conversion, because **ngspice's phase is
  RADIANS and Tau reports degrees** (-pi/4 vs -45 at the pole); plus a
  common-emitter NPN the preview solver refuses outright, and the unexcited deck
  the new refusal guards. `print all` is unusable on an AC run - a complex column
  prints as TWO cells under ONE header - so the harness prints `real()`/`imag()`
  explicitly. Rust side: the FFI complex read was only asserted `is_some()`, so a
  swapped or mis-strided phasor would have passed; now pinned numerically at the
  pole and a decade above, where imag is 10x real. Mutation-checked three ways:
  precheck removed (kills 1 unit test), degrees conversion dropped (kills 3 of 6
  corpus cases + 1 unit test), Rust complex halves swapped (moves the panic onto
  the new frequency-scale assertion). Gates: tsc, cargo test 31 + clippy clean,
  corpus 80/80/80/80 with the new AC proof inside it. Full suite: 2237 pass, and
  the 25 failures were trap 5 - all 6 files pass isolated at `--maxWorkers=2`.
- 2026-07-29 - `.tran` proven against a real ngspice run rather than mocked
  vectors, closing the highest-traffic analysis. `scripts/tranNative.corpus.ts`
  pins the `time` scale, node vectors arriving BARE (not `v(x)`, which is why
  `nodeVectorName` strips the wrapper), `<ref>#branch` for sources/inductors,
  and `deriveRcCurrents` on ngspice's own non-uniform grid checked against a
  vector ngspice did return. Found one wrong number: `stats.stepSize` was
  `time[1] - time[0]`, which on a real adaptive-timestep run is 10 ps for a
  `.tran 10u 2m` - six orders of magnitude off the requested 10 us. Now the
  average interval over the returned span. Latent (nothing renders it), fixed
  before something does. Also established that two rungs of
  `componentCurrentVector` never fire on a real run - ngspice names no
  `i(<ref>)`, and `@<ref>[id]` needs a `.save` Tau does not emit - so a
  semiconductor has NO current trace; that is now in KNOWN_ISSUES and is Next
  up #2. Circuits: RC step in closed form on both engines, RL series
  (`v1#branch == -l1#branch`), derived R/C currents, and a common-emitter NPN
  the TS solver refuses, biased mid-rail and amplifying 16x with inversion.
  Writing it surfaced that `print all` paginates every ~50 rows and the older
  column-claim logic read that as a finished table - without the fix the
  harness saw only the first 0.25 ms of a 5 ms run. Mutation-checked both
  halves: restoring `time[1] - time[0]` kills the 2 new unit tests, removing
  the pagination handling kills 4 of the 6 corpus cases. Gates: tsc, full suite
  2235 passed / 148 files, cargo test 31 + clippy clean, corpus 80/80/80/80.
- 2026-07-29 - Drawing primitives (`LINE`/`RECTANGLE`/`CIRCLE`/`ARC`) survive a
  save instead of blocking it, retiring the most common remaining reason an
  imported `.asc` could not be written back. Same passthrough shape as the
  `WINDOW` unit: carried on the document as `ascShapes`, re-emitted by the
  exporter, and the `drawing primitives` rewrite risk dropped. The parse was
  wrong in a way that only mattered once the record was re-emitted: LTspice
  writes a pen-width word (`Normal`/`Wide`) between the tag and the
  coordinates, and the old parser ran `num()` over it, coercing it to a 0 that
  would have been written back as a coordinate. Anything the exporter could not
  reproduce exactly - an unknown width word, the wrong coordinate count for the
  kind, a non-integer or unparseable coordinate - falls through to `unknown`
  instead, which is already a rewrite risk, so the save stays blocked rather
  than silently moving someone's drawing to the origin. `documentValidation`
  enforces the same grammar on the `.sim` side, including whole-number
  coordinates, since the exporter rounds and a fraction arriving that way would
  shift the artwork. Real-corpus proof: `scripts/ascShapeRoundTrip.corpus.ts` -
  233 shape lines across 69 of the user's own files re-emitted byte-identically
  and in order, none lost or invented, all 69 newly free of this block.
  Mutation-checked both halves: dropping the width word from the exporter kills
  the corpus on the first file, and restoring the old
  `risks.add("drawing primitives")` kills its risk assertion. Two existing tests
  used a drawing primitive as their stand-in for "a record Tau cannot preserve"
  and were repointed at records that still are (`DATAFLAG`, `SpiceLine`) so the
  autosave-protection and assistant-replacement guards stay covered - the
  assistant boundary rejects a malformed primitive a step earlier than the
  lossless check, which is now asserted separately. KNOWN_ISSUES says plainly
  that the shapes are preserved, not displayed: Tau's canvas still does not draw
  them. Gates: tsc, full suite 2233 passed / 148 files, cargo test 31 passed +
  clippy clean, corpus held at 80/80/80/80.
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
