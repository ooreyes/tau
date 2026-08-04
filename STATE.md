# Autobuilder state

The working memory of an unattended loop that starts from zero every fire.
**Read this first and read it fully. It is small on purpose.**

## Now

**Status:** NOT DONE - completion RETRACTED by the owner 2026-08-04

The 2026-08-03 "PROJECT COMPLETE" signal was wrong and has been withdrawn. A
four-part adversarial audit reproduced the gates and disagreed with these docs.
**Do not trust a status line in this file or in `PROGRESS.md` over your own
re-measurement.** The authoritative backlog is now "THE NEW BAR" in the
autobuilder driver prompt; `AGENTS.md`'s Definition of Done checkboxes and
`KNOWN_ISSUES.md` are the trustworthy in-repo signals.

What the audit measured, against what these docs claimed:

- **Vendor demo circuits do not work.** App-faithful probe over 392
  `examples/Applications` files: **1 converged, 0.3%**, operating point only.
  3.9% even with the corpus harness auto-attaching vendor libraries.
- **The Educational set is real:** 87% OP, 34/40 authored transients — but that
  is 86 files out of 4,012, and it is the honest product surface today.
- **99.4% of the vendor library is encrypted** (2,453/2,469 `.sub`). Unfixable
  by code. Vendor-model parity is not a goal any more.
- **The corpus gate currently FAILS on this tree:** 1,609 hard failures, 1,465
  `unknown subckt`. "Zero hard failures" in `PROGRESS.md` is false, and was
  satisfiable by error-message wording rather than capability.
- **"80/82" is a constructed subset** that excludes all 3,913 vendor files and
  counts 12 of the owner's own `Draft*`/`hw3` scratch files.
- **Three silent wrong answers still ship:** saturable core → linear `L` with no
  warning; non-rational/current-source `Laplace=` → DC gain with `exact:false`
  discarded; `load`/`load2` dropped.
- **Legal blockers:** no `LICENSE`/`THIRD_PARTY_NOTICES` at all; unused GPLv2
  `table.cm` in the bundle; ADI's `AD8541.lib` committed and advertised.
- Good news that is also verified: ngspice is Modified BSD and `dlopen`ed, so
  Tau's own source has no copyleft exposure, and all 725 npm deps are clean.

Landed since: a **Google Gemini assistant provider** (free tier, no credit card
— the student on-ramp), sharing one profile-driven OpenAI-compatible path with
the local MLX provider so their prompts cannot drift. Per-provider keychain
entries; CSP pins `generativelanguage.googleapis.com`. Unit-tested against a
stubbed fetch; **not yet exercised against the live Google API.**

Next up: P0 in THE NEW BAR — third-party attribution, then the three silent
substitutions, then the transitive `.subckt` closure check, then making the
corpus gate measure capability instead of message prefixes.

Previous completed unit:

Class-D measurements are menu-first. Imported aggregate and derived `.meas`
lines decode into named result rows; new rows select analysis, calculation,
node/component, absorbed or delivered power, derived formula, and optional
window. Tau derives hidden power expressions from real connectivity. The
Class-D PS/PL/Efficiency set round-trips, unsupported timing forms stay exact in
Expert, and malformed/duplicate results are refused. Typecheck, 2,443 tests,
web build, and the 900x600 live dialog pass. Scheduler remains unloaded.

Previous completed unit:

Transient settings now speak engineer semantics: Circuit duration (ns through
minutes), Quick/Balanced/Precision waveform detail, measured last-run elapsed
time, and an Expert-only exact output count. Raw Steps and the opaque Refine
button are gone from primary UI. AUTOMATIC/DOCUMENT/CUSTOM labels are truthful;
custom reset restores the imported `.tran`, and document changes clear prior
manual state. Typecheck, 2,438 frontend tests, web build, and Chrome minimum-
window containment pass. Scheduler remains unloaded.

Previous completed unit:

Direct transient trace interaction is complete. A trace can be selected and
recolored from Tau's validated palette beside its plot; C1/C2 glide by mouse,
touch, or keyboard and show an interpolated colored point plus inline time/value
chip. Pan remains an explicit mode, exact time fields stay synchronized, and
the cursor table no longer labels current/power as volts. All frontend/build/
unsigned-package checks pass. Packaged visual control is deferred only because
macOS is locked. Scheduler remains unloaded.

Previous completed unit:

Independent-source waveform editing is complete for DC, Sine, Pulse, PWL, EXP,
SFFM, and AC stimulus. DC operating-point bias is separate; PWL is an editable
point table; raw function strings no longer appear in Properties or schematic
labels. Both engines and LTspice ASC round-trip agree. All frontend, Rust,
real-ngspice, canonical 80/82, Class-D, web-build, unsigned app/DMG, signature,
checksum, and launch-stability gates pass. Computer Use visual inspection is
deferred only because macOS is locked. Scheduler remains unloaded.

**Product UX contract (Omar, 2026-08-03): Tau is not a prettier command-line
wrapper.** Known SPICE semantics must appear as named, editable controls in the
Value/Analysis UI, with units and validation. Users must not need to type or
place raw `.op`, `.tran`, `Q=...`, model-option, or similar syntax on the
schematic for normal work. Raw directives remain only for exact LTspice
round-trip, unsupported/unknown expert syntax, and an explicit advanced escape
hatch. Import should decode known syntax into controls; edits must encode it
back losslessly. Treat a known knob exposed only as a raw string as unfinished
UI parity.

Previous completed unit:

Native-engine content integrity is complete. The build script records SHA-256
for the exact staged tree; `build.rs` rejects missing/malformed/stale metadata,
changed or unrecorded bytes, missing entries, and symlink escapes. The pinned
engine, app, and DMG were rebuilt; 27/27 packaged resources match, real OP,
noise, and XSPICE tests pass from the mounted DMG, and launch stays alive. The
completion verifier now logs outside its read-only mount and compares the whole
packaged tree before it can notify. Scheduler remains unloaded.

Previous completed unit:

Extended LTspice value-slot editing is complete for unambiguous single-slot
changes. The real App validator now preserves and bounds `ltExtraAttrs` instead
of silently dropping it, exporter reconciliation updates only the owning slot,
and the packaged inspector exposes imported/custom op-amp parameters rather
than mislabeling them as Ideal. Cross-slot transformations remain blocked. The
scheduler remains unloaded.

Previous completed unit:

Hierarchical-block save half 2 is complete. A resolved, untouched block keeps
its original LTspice `SYMBOL`; its flattened simulation-only members carry exact
owner/fingerprint provenance and are suppressed only when the whole group still
matches. Edited/deleted/incomplete groups remain blocked by instance name.
`.sim`, hostile-input, copy/duplicate, canonical Class-D, corpus, packaged-app,
Chrome minimum-window, and security gates pass. Run no longer rewrites a clean
imported `.asc`; the disk write begins only after a semantic edit. The scheduler
is still deliberately unloaded so it cannot race interactive work.

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
stays with the child file. The guarded re-export now depends on that separation.

**The last pre-hierarchy-save census over the 4,012 real `.asc` under
`~/Documents` found 36 blocked files** - 20 `extended symbol attributes`, 17
`symbol-library identity`, and 0 `unknown LTspice records`. Rerun the exact
census before quoting a new post-fix total; hierarchy re-export should reduce
it, but an unmeasured number is not evidence.

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

1. **Eliminate the remaining named-vendor-op-amp model substitution.** A
   decoded census finds 683 named `Opamps/...` instances across 475 files and
   432 distinct part names (generic opamp/universal symbols excluded). Ordinary
   five-pin parts currently retain the right shared pin topology but still run
   Tau's generic rail-clamped gain block, not their vendor macromodel. Build a
   user-supplied symbol/model attachment path with a named Model control in the
   Value UI, then atomically refuse any part whose real model is absent. Do not
   preserve the 80/82 metric by simulating a different amplifier.

---

## Landed

Newest first, ONE line each. Full evidence for every unit is in PROGRESS.md
and in its commit message. This section exists so a fresh fire can see what
is already done at a glance, not so it can re-read the reasoning.

- 2026-08-03 - VERIFIED MULTI-PIN AMPLIFIERS ARE NEVER FORCED THROUGH A FIVE-PIN OP-AMP BANK. AD8235/LT1168/LT1194/LT1795 preserve losslessly and refuse by name, eliminating all remaining extended-corpus hard failures; 522 real decks/op points remain and canonical is still 80/82.
- 2026-08-03 - LTSPICE NEGATIVE CAPACITANCE IS PRESERVED EXACTLY AS `Q(V)=C*V`. A native RC proof holds the required +45-degree lead, `elip_grd.asc` now builds/converges, preview solvers refuse rather than alter the sign, and extended hard failures fall 5 -> 4.
- 2026-08-03 - SELF-CONTAINED LTSPICE BRACE ARITHMETIC AND `Q=` CAPACITORS ARE NATIVE. Empty `.param` scope no longer blocks valid arithmetic; `Q=` emits ngspice's charge device, preview solvers refuse rather than approximate, and the Value UI exposes Charge expression + Initial voltage without raw syntax. Extended hard failures fall 15 -> 5.
- 2026-08-03 - LTSPICE CURRENT-CONTROLLED SWITCHES ARE REAL W DEVICES. `SpiceModel` resolves the sensing voltage source, `Value` resolves CSW/translated ISWITCH, exact save/reopen is supported, and every unprovable identity refuses atomically. CLI ngspice and the rebuilt packaged app prove the 5 V switched output.
- 2026-08-02 - EVERY PACKAGED NGSPICE RESOURCE IS SHA-256 BOUND TO ITS BUILD RECORD. `build.rs` verifies exact set equality, contents, target and commit; doctored-tree tests cover swaps, corruption, injection, omission, malformed data and escaping symlinks. The rebuilt DMG's 27 resources match exactly and real OP/noise/XSPICE tests pass from inside it. Completion logging no longer writes into the read-only mount.
- 2026-08-02 - IMPORTED/CUSTOM OP-AMP PARAMETERS ARE HONEST AND EDITABLE in the packaged inspector; a one-slot Avol change writes back to Value2 and retains SpiceLine instead of collapsing both onto Value.
- 2026-08-02 - THE REAL APP PRESERVES EXTENDED LTSPICE VALUE PROVENANCE. The validator had silently dropped `ltExtraAttrs`; it now retains/bounds/sanitizes it, hierarchy fingerprints cover it, and single-slot joined-value edits reconcile to their owning slot while cross-slot edits remain blocked.
- 2026-08-02 - RUNNING A CLEAN IMPORTED `.asc` IS BYTE-PRESERVING. The pre-run save compares the live semantic signature first, so record order, micro glyphs and vendor attributes cannot change merely because the user pressed Run.
- 2026-08-02 - RESOLVED HIERARCHICAL BLOCKS SAVE LOSSLESSLY (half 2 of 2): exact owner/fingerprint provenance suppresses only unchanged flattened simulation members and re-emits the original parent `SYMBOL`; edited or incomplete groups remain instance-specific hard refusals.
- 2026-08-02 - A NEW CIRCUIT NO LONGER INHERITS THE PREVIOUS FILE'S `DATAFLAG` READOUTS, which a save wrote to disk. `newCircuit`'s reset now comes from `blankDoc(): Doc`, whose explicit return type makes an uncleared carried field a compile error instead of the next leak.
- 2026-08-02 - A HIERARCHICAL BLOCK'S SAVE-BLOCK REASON STOPS LYING (half 1 of 2): the resolved-and-flattened `SYMBOL` is carried as `ascHierarchicalBlocks`, turning `["symbol-library identity","partially supported devices"]` into `["hierarchical blocks"]` on the class-d starter. It is a SEPARATE field because `ascForeignSymbols` feeds the simulation-integrity refusal and a block must still simulate.
- 2026-08-02 - A `DATAFLAG` READOUT SURVIVES A SAVE, emptying the whole `unknown LTspice records` category: save-blocked over 4,012 real `.asc` falls 39 -> 36, and the 8 records in the 3 affected files round-trip identically with no save warning. The expression is carried as the verbatim line tail, never re-joined from split tokens.
- 2026-08-02 - FRESH PACKAGED-APP QA IS GREEN. The exact release `.app` opens the canonical `class-d_starter.asc` with its sibling `deadtime` block, runs bundled ngspice to 16,873 samples / 33 parts, renders the expected switching and sine/output waveforms, and reports Efficiency = 990.7 m (99.07%). The same top-level file without its required sibling sources refuses by name and shows no telemetry or partial plot. Chrome at the 900x600 minimum had zero clipped controls and zero console warnings/errors.
- 2026-08-02 - THE AUTOBUILDER CONTROL PLANE AND COMPLETION PROOF REACH INSIDE THE DMG. Its controlled fire honored quota backoff, exited 0, and released the PID lock; a completion marker requires real OP and XSPICE runs against the mounted Tau.app's bundled library. The launchd job is currently intentionally unloaded for interactive work.
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
