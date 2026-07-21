# FIX_BUGS.md — Tau reliability / security audit log

> **Purpose.** This is the running bug ledger for Tau. The autobuilder
> (`~/.tau-autobuilder/`, model `claude-fable-5`) now runs in **audit-only mode**:
> it finds and *documents* problems here — it does **not** change source code.
> Each run appends/updates entries below, commits **only this file**, and pushes.
>
> **Rules for entries.** Only log a bug you have **reproduced** (mark it
> `CONFIRMED`). Ideas you suspect but haven't reproduced go under `PLAUSIBLE`.
> Never fabricate. Before adding, search this file for an existing entry and
> update its status instead of duplicating. Keep the newest audit pass at the
> top of the "Audit passes" log.

**Repo:** `auto/ltspice-parity` · **Audit date:** 2026-07-17 · **Auditor:** interactive session (Fable 5) + two background subagents (fuzz + sim cross-check).

## 2026-07-18 stress-test session (interactive, Fable 5) — fixes applied in working tree

Stress pass over `~/Downloads/LTspicePowerSim-main` (107 sym + 45 example
schematics: buck/boost families, LLC/DAB/PSFB, 3φ PFC, matrix converter, motor
FOC, battery CCCV) plus browser-UI testing. **Corpus op-convergence went
151/189 → 179/189; all 45 top-level example converters now import, deck-build,
and converge.** Remaining 10 ✗ are standalone runs of library-internal
sub-blocks (floating ports / no ground by design). All fixed in the working
tree, uncommitted; `pnpm test` 1961 passed, typecheck clean.

1. **Web mode: any imported `.asc` failed to open** ("Cannot read properties of
   undefined (reading 'invoke')") — `importProjectAsc`'s hierarchy probes used
   fsBridge `readTextFile`/`pathExists`, which fall through to Tauri plugin-fs
   for `workspace://` paths. This was the "simple LED circuit doesn't work" bug,
   part 1. Fix: workspace-aware wrappers in App.tsx.
2. **Interim TS solver had no diode/LED/zener models** — part 2 of the LED bug:
   V+R+LED failed with "unsupported model". Fix: SPICE-style Newton companion
   models (`simulation/diodeCompanion.ts`) with pnjlim limiting + zener
   breakdown; LED+R+V now sims at 1.93 V @ 3.07 mA in-browser; half-wave
   rectifier verified end-to-end. 7 new regression tests.
3. **Hierarchical param loss** — block-local `.param` resolution was
   all-or-nothing (one parent-scope ref abandoned the whole block), instance
   params referenced bare in behavioral exprs (`TIMER`'s `time>=T`) never bound,
   and local params only the parent could evaluate (LPF's `Co=1/({f}*2k*PI)`)
   were dropped. Fix: `buildPartialParamScope` + per-component lenient
   resolution + textual expansion of unresolved params + bare-identifier
   binding in `V=`/`I=`/`R=` values.
4. **ngspice B-source translation gaps** — `atan2`/`round`/`int` ("no such
   function", 3φ PFC + QUANTIZE + PHASESHIFT3), `%` modulo (SRF_PLL), `table()`
   (BATTERY_ECM), `.func` bodies dropped at flatten (Voc SOC tables), and
   `I(R1)`-style element-current refs under flattened instance prefixes. Fixes
   in `behavioral.ts` (ltFuncsToNgspice/moduloToFloor), `paramScope.ts`
   (inlineFuncCalls), `spiceNetlist.ts` (branch-current rewrite to Ohm's-law /
   emitted instance names).
5. **Behavioral resistor** (`res` symbol with `V=IF(...)` value, PowerSim GD) —
   emitted as ngspice `r = 'expr'`; behavioral `{…}` values with runtime state
   (`time`, `V(node)`) no longer hard-fail the deck ("Unknown parameter
   \"time\"").
6. **Greek net-name collapse** — `sanitizeNetName` STRIPPED non-ASCII, so
   STEP2PH_FOC's `uα`/`uβ` both became node `u` (silent short → singular
   matrix), and behavioral refs like `V(θ_pll)` silently detached. Fix:
   name-preserving transliteration (`spiceSafeToken`) applied to nets AND
   behavioral node refs.
7. **Digital gate outputs were ideal B sources** — paralleled gate outputs
   (DEADTIME inside TLVR) → singular matrix. Fix: 1 Ω series output resistance
   (matches LTspice A-device finite drive); Schmitt state now reads the
   internal drive node.
8. **`.ic V(out)={vout}` passthrough kept braces** → ngspice fatal (deck has no
   `.param` lines). Fix: substitute known braces in `.ic`/`.nodeset` bodies.
9. **LTspice `load` flag on current sources** (CP_PLL `{gm} load`) rejected the
   deck. Fix: strip the flag (documented approximation).
10. **Transient yield used `setTimeout(0)`** — clamped up to ~1 s in
    occluded/background windows; a 321-step diode run took minutes of wall time
    (21 ms of math). Fix: MessageChannel yield (never throttled).
11. **Fit-to-view framed flattened block bodies** packed at x≈1e6, so a
    hierarchical import (BUCK_VM) looked like an EMPTY sheet. Fix: fit ignores
    the pack region.

Verified separately: browser UI import→open→run→plots for led/rectifier
(correct physics + telemetry), 2-bit dflop register renders with correct
"needs native engine" guidance, live local-MLX assistant suite 3/3 (divider
generates and sims to 3.333 V). Note: assistant Send is correctly disabled in
a plain browser against an unmanaged MLX server (ownership gate) — native-only
by design.

**Observations (not fixed):** standalone PMSM/STEPPER_2PH sub-blocks hit
"Duplicate SPICE instance name RB after sanitizing Rb and B" (naming edge;
in-context instances are fine). The `com.tau.autobuilder` launchd job is
committing SOURCE again (`auto:` commits on 07-18, §-numbered messages from the
old feature prompt) despite `~/.tau-autobuilder/prompt.md` being audit-only —
the runner appears to be using a different/embedded prompt; worth checking
before the next DMG cut.

## Baseline (green at audit time)
- `pnpm -C apps/desktop typecheck` — clean. (Re-confirmed clean 2026-07-18.)
- `pnpm -C apps/desktop test` — **1939 passed / 6 skipped** (133 files) when the
  machine is not otherwise loaded. **Flakiness note (2026-07-18):** running the
  full suite concurrently with a `cargo build` produced 9 spurious failures, all
  in `src/App.workspace.test.tsx`, all `renderOpenProject()` hitting vitest's
  5 000 ms `testTimeout`. Run in isolation the file is green (13/13 on the 2nd
  run; 1st cold run occasionally times out only its first test). This is a
  test-harness timeout sensitivity under CPU contention, **not** a product
  regression — `renderOpenProject()` routinely renders close to the 5 s budget.
  Consider raising that file's `testTimeout` or reducing its per-test render cost
  for CI stability.
- Native ngspice worker (BUG-8 fix) exercised directly this pass via
  `tau --tau-spice-worker` with a staged Homebrew `libngspice.dylib`: good RC
  step, `.four`, stiff/singular, and recursive-`.func` (SIGSEGV, contained) decks.
- Rust release fmt/clippy/tests — **25 passed / 1 ignored**; the ignored real
  ngspice integration also passed when explicitly enabled.
- Host disk exhaustion was recovered by removing only regenerable Rust target
  output; both release builds and every native gate subsequently completed.
- Real ngspice FFI integration test (`TAU_NGSPICE_LIB=…/libngspice.dylib cargo test -- --ignored`) — **passes**: op, transient, AC, MOSFET, BJT, rectifier, and the digital 2-bit register all solve correctly.
- Acceptance corpus (`scripts/acceptance-corpus.sh`, user's real LTspice files) — **82 imported / 82 op-converged / 79 warning-clean / 82 deck-built**.

---

## Confirmed bugs

### BUG-1 — `.asc` import path has no byte-size cap (resource exhaustion) — **FIXED 2026-07-17**
- **Severity:** Medium.
- **Where:** `apps/desktop/src/store/useProject.ts` → `importAscFile` (the "Import .asc" button / file-input path).
- **Problem:** `readTextFile` (`src/project/fsBridge.ts`) enforces `MAX_SCHEMATIC_FILE_BYTES` (5 MB) *before* reading, but `importAscFile` called `decodeSchematicText(await file.arrayBuffer())` with **no size check**. The web/workspace branch then stores unbounded text in memory (Zustand state); even the native branch reads the whole file into the renderer before the Rust 5 MB write cap can reject it. A large dragged-in `.asc` can exhaust the renderer.
- **Repro:** import a >5 MB `.asc` via the Import button; the 10 MB `gigantic-line.asc` stress file parsed in ~112 ms with no cap. (Contrast: File→Open of the same file is correctly rejected with "Schematic files are limited to 5,242,880 bytes.")
- **Fix applied 2026-07-17 (pass 1):** guard `file.size > MAX_SCHEMATIC_FILE_BYTES` at the top of `importAscFile`, matching `readTextFile`, plus a regression test in `useProject.test.ts`. It was left uncommitted in the working copy.
- **Final status:** recovered and committed at `cb26b01`; both `file.size` and
  the bytes actually read are bounded, including a stat/read race regression.

### BUG-2 — Op-amp `.asc` round-trip changes terminal connectivity — CONFIRMED (guarded from silent loss)
- **Severity:** Medium–High (functional/parity limitation; **not** silent corruption — see mitigation).
- **Where:** `apps/desktop/src/io/ascExport.ts` `kindToLtspiceType` maps `opamp → "opamp2"`. On re-import, `opamp2` resolves via a different LTspice pin family than the "centered" UniversalOpAmp/UniversalOpAmp2 family used on the original import, shifting every pin relative to the unchanged component anchor.
- **Impact (measured, real corpus files):** import → `schematicToAsc` → re-import changes the net partition. On **`deadtime.asc`** (a flagship real file) the op-amp pins collapse — after round-trip `u1:in-`, `u1:v+`, `u2:in-`, `u2:v+` all land on one net. On **`Linkwitz.asc`** `u1:out` and `u1:in-` detach from their nets. Data-dependent: `Howland.asc`, `LoopGain.asc`, `LoopGain2.asc` round-trip cleanly.
- **Repro:** import → export → re-import each file above and compare the pin→net partition (order-independent, pins-per-net sets). See `scratchpad/audit-artifacts/roundtrip-check.mjs`.
- **Mitigation already in the app:** `serializeSchematicFile` (`src/project/types.ts`) recomputes topology after a round-trip and, on change, emits "ASC round-trip changed terminal connectivity; save was not written."; `ascSaveBlockReason` also blocks on the "symbol-library identity" rewrite risk. `saveActiveToProject` (`App.tsx`) honors the block — so the app **refuses to save** rather than corrupting. Verified there is **no unguarded `.asc` write path** (the only other writer stores the original imported source verbatim; autosave is a lossless localStorage JSON snapshot).
- **Net effect:** you can open and simulate op-amp schematics, but **cannot save edits to them as `.asc`** (blocked with a message). Real gap for an LTspice replacement.
- **Suggested fix (do not apply blindly — risk to the 82-file corpus):** give the exported symbol type a pin family that re-imports to the same offsets, or emit explicit wires so connectivity survives regardless of pin geometry. Add a round-trip net-partition test over the real corpus.

### BUG-3 — 3-pin MOSFET bulk detaches from source on `.asc` round-trip — CONFIRMED (same guard as BUG-2)
- **Severity:** Medium (guarded; blocks save).
- **Where:** `ascExport.ts` maps `nmos/pmos → "nmos4"/"pmos4"`. First import of a 3-pin LTspice `nmos` ties bulk to the source node (correct LTspice semantics); export as 4-pin `nmos4` then re-import places bulk at the `mos4` symbol's fixed offset, which does **not** coincide with source → bulk becomes a floating node.
- **Impact:** `mosfet-ringosc.asc` round-trip turns `{m1n:b, m1n:s}` (bulk = source) into `{m1n:b}` alone (floating bulk).
- **Mitigation:** same save-block guard as BUG-2 (`nmos → nmos4` triggers the "symbol-library identity" rewrite risk → save blocked). Not silent corruption.
- **Note:** the export code comment claims `nmos4` was chosen *specifically* to avoid this — but the round-trip shows the 4-pin bulk offset still doesn't re-tie to source. Suggested fix: emit an explicit bulk-to-source wire on export, or map to a symbol whose bulk pin coincides with source.

### BUG-4 — Hierarchical `.subckt`/`.ends` split across separate TEXT boxes is silently dropped — **FIXED 2026-07-17**
- **Severity:** Medium (low real-world frequency).
- **Where:** `apps/desktop/src/engine/modelDirectives.ts` → `modelLibLinesFromDirectives`. `subcktDepth` / `prevEmitted` are declared **inside** the `for (const raw of directives)` loop, so they reset for every separate on-canvas TEXT directive. A `.subckt … .ends` block that lives in **one** multi-line TEXT box works; a block spread across **separate** TEXT annotations does not: the `.subckt` opener is emitted, but every body line and `.ends` is dropped (`.ends`'s keyword `"ends"` isn't in `BLOCK_KEYWORDS` and `subcktDepth` is 0). Result: an unclosed `.subckt` swallows the rest of the deck.
- **Impact:** ngspice fatally rejects with `Error: Mismatch of .subckt … .ends statements! … no simulations run`. `deck_lines` (Rust) doesn't check subckt/ends balance, so the user sees only an opaque engine error.
- **Repro:** `deep-hierarchy.asc`; also a minimal 3-box case (`.subckt X` / one instance line / `.ends X`).
- **Fix:** hoisted block state across directive records with a three-record
  regression. Project-open now also preloads bounded nested BLOCK/CELL sources.

### BUG-5 — Fast (TS) preview engine and native ngspice disagree on initial conditions — **FIXED 2026-07-20**
- **Severity:** Medium (fidelity/UX; the authoritative "Run" via ngspice is correct).
- **Where:** `apps/desktop/src/simulation/linearTransient.ts` (~lines 215–231): `capacitorVoltage`/`inductorCurrent` default to `0` unless an explicit `IC=` is present — i.e. the TS engine always behaves as `uic`. Native ngspice (and Tau's own `spiceNetlist.ts` deck builder, which omits `uic` unless `.ic`/instance IC is present) solves the DC operating point first and starts from steady state.
- **Impact:** for any circuit with reactive elements on a constant/biased source, the fast preview and the native "Run" show **different waveforms** for the identical schematic. Cross-check measured up to ~99% relative divergence on RC/RL step responses; forcing ngspice to the same zero state brought agreement to ~1% (integrators themselves agree — this is purely an IC-semantics gap).
- **Suggested fix:** compute a DC operating point in the TS engine to seed C/L state (matching SPICE default), or clearly label the preview as `uic`/approximate.
- **Fix applied 2026-07-20:** `runTransientAnalysis` now seeds `capacitorVoltage`/`inductorCurrent` from `runOperatingPoint` before integrating (unless the `.tran` carries `uic`); explicit per-instance `IC=` still wins. `runOperatingPoint` gained Newton support for the diode/LED/zener companion models so biased diode circuits seed too. When the OP is singular (e.g. an ideal source directly across an inductor at DC) the run falls back to zero state with a visible warning - the old behavior, now labeled. Regression tests: `initialConditions.test.ts` ("DC operating-point seeding"), `operatingPoint.test.ts` ("junction diodes"), `linearTransient.test.ts` ("without uic the run starts from the DC operating point"). Shipped example circuits switched from DC to PULSE stimuli so their waveforms stay demonstrative under the corrected semantics.

### BUG-6 — `deck_lines` command blocklist bypassed by `+`-continuation lines — **FIXED 2026-07-19**
- **Severity:** Low.
- **Where:** `apps/desktop/src-tauri/src/spice.rs` (~line 586): the per-line command token is `lower.split_whitespace().next()`. A SPICE continuation line begins with `+`, so its first token is `+` and never matches the blocklist (`shell|system|source|write|…`). A line like `+ quit` or `+shell foo` passes the sanitizer.
- **Why not exploitable:** ngspice merges a `+` line onto the preceding card as continuation parameters (`Warning: unrecognized parameter (quit) - ignored`); it is never executed as a command. The only place blocklisted commands run is a `.control` block, which the allowlist still rejects. Confirmed inert end-to-end.
- **Fix applied 2026-07-19:** the sanitizer strips a leading `+` before extracting the command token, so continuation lines are screened exactly like their unfolded form; regression test `screens_continuation_lines_like_their_unfolded_form` covers smuggled commands and benign PULSE continuations.

### BUG-7 — `classifySignal` rejects any pulse/PWM waveform whose duty cycle is outside ≈48–51% — **FIXED 2026-07-17**
- **Severity:** Medium. Non-50%-duty pulse trains are the bread and butter of the §11 priority area (vpulse sources, switching converters, logic clocks), and the misclassification silently degrades three shipped features at once.
- **Where:** `apps/desktop/src/simulation/measurementModel.ts:167-208` (`classifySignal`). Periodicity is estimated from **mean-crossing half-periods**; for a rectangular wave of duty `d` those alternate `d·T` and `(1−d)·T`, so the interval-consistency gate `maxRelativeError <= 0.08` (line 193, measured against the *median half-period*) fails for any duty outside roughly 48–51%.
- **Problem / Impact:** a perfectly clean, many-cycle pulse train is classified `"transient"` with no period/frequency. Measured downstream effects:
  1. **Dashboard headline reading** (`ComponentMeasurementsPanel.tsx:31-38` `primaryReading`): non-periodic series fall back to `FINAL` — the last instantaneous sample. For a 0–5 V PWM node that is whichever rail `.tran` happens to stop on, instead of the meaningful RMS (e.g. 2.24 V at 20% duty). The classification badge reads "transient" instead of "Periodic · 1.000 kHz".
  2. **Auto Frame** (`waveform.ts:103` `autoFrameWaveform`): frames the last N cycles only when a trace classifies periodic. Measured: 50%-duty 1 kHz square over 10 ms → framed to the last 4 ms (4 cycles); identical wave at 40% duty → no framing, full 10 ms window (its progressively-smaller-trailing-window retry can't help — the duty cycle is the same in every window).
  3. **Oscillation detection/telemetry** anywhere else `classification.kind` is consulted (e.g. `EngineeringTraceReadout`).
- **Repro:** bundle the real module (`esbuild src/simulation/measurementModel.ts --bundle`) and call `classifySignal` on a sampled 1 kHz 0–5 V square wave, 10 full cycles, 5001 points. Observed: duty 0.5 → `periodic 1.000 kHz`; duty 0.45/0.40/0.30/0.20/0.10 → `transient`, no frequency. Sine/triangle/sawtooth at the same settings → `periodic` (correct). Threshold sweep: 0.48–0.51 pass, 0.47 and 0.52 fail. Independently re-verified by a second agent with its own vectors (2.5 kHz, 0–3.3 V, 25% duty, 8 cycles → `transient`; 50% duty and sine → `periodic`).
- **Sub-issue (same root):** even inside the passing band the period is `2 × median half-period`, so an asymmetric duty biases the estimate — 48% duty of a true 1 000 Hz wave reports 965 Hz (~3.5% off) where the sine reports 1 000.00 Hz.
- **Mitigation:** none in code; statistics (min/max/avg/RMS in the expanded row) remain correct — only the *headline* reading, badge, and Auto Frame degrade.
- **Fix:** period now comes from same-direction crossings; 10/20/40/60/80/90%
  duty regressions pass with unbiased frequency and periodic classification.

### BUG-8 — In-process libngspice had no hard timeout or crash isolation — **FIXED 2026-07-18 (commit 7fe5362), one residual (see BUG-11)**
- **Severity (original):** High for hostile/arbitrary decks.
- **Where:** `src-tauri/src/spice.rs`.
- **Fix landed 2026-07-18 (`7fe5362`, "isolate native ngspice execution worker").**
  `simulate_spice` now spawns a disposable child process (`tau --tau-spice-worker`,
  dispatched from `main.rs` before Tauri starts). Every native run happens in that
  child; libngspice is no longer loaded in Tau's UI process. IPC is bounded
  (`MAX_WORKER_INPUT_BYTES`, `MAX_WORKER_OUTPUT_BYTES=256 MiB`,
  `MAX_WORKER_STDERR_BYTES=64 KiB`, drained with `read_bounded` so a full pipe
  can't deadlock); a `WORKER_TIMEOUT` of 120 s and a cooperative `AtomicBool`
  cancellation (`cancel_spice`, wired to the Stop button) both terminate the
  child via `child.kill()`; a non-zero/`signal` exit is turned into a structured
  `Err`. A single-flight guard rejects a second concurrent native run.
- **Re-verification this pass (2026-07-18):**
  1. **Crash containment CONFIRMED.** A recursive `.func` deck (`.func f(x)={f(x)+1}`)
     drives libngspice into a `SIGSEGV`: `tau --tau-spice-worker < rec-func.json`
     exits `139` (128+11) with empty stdout. In the old in-process model this
     would have taken down Tau; now it is a dead child and the parent returns
     `"…worker crashed or exited with signal: 11 (SIGSEGV)"`. (This exact deck is
     *not* reachable through Tau's own deck builder — only model/lib/subckt lines
     are forwarded to native, and Tau's TS expression evaluator caps `.func`
     recursion at depth 64 — but it is a clean, reproducible native crash proving
     the isolation works.)
  2. **Engine-unrecoverable state contained CONFIRMED.** A `.tran 50n 500m`
     (~1e7 points × ~40 vectors) trips ngspice's own output-memory guard:
     `Error: memory required … is more than memory available! … ngspice.dll cannot
     recover and awaits to be reset or detached`. In the old persistent-engine
     design that state poisoned every later run until app restart; the
     fresh-process-per-run worker discards it and the *next* run is clean.
  3. **Memory:** there is still **no explicit RSS/`setrlimit` cap** on the worker
     (only the 120 s wall clock). In practice ngspice's own output-memory
     pre-check plus Tau's 512 KiB / 30 000-line deck caps bound the realistic
     blow-up, so this residual is Low rather than High — but a solver working-set
     explosion within 120 s is not hard-limited. Worth a `setrlimit(RLIMIT_AS)`
     in the worker for defence in depth.
- **New side effect introduced by the fix:** see **BUG-11** (the worker's XSPICE
  code-model `TempDir` leaks on every SIGKILL/crash exit).

### BUG-9 — Ad-hoc hardened runtime rejects bundled libngspice — **FIXED 2026-07-17**
- **Repro:** fresh mounted DMG launched, but `led.asc` failed at `dlopen` because
  an ad-hoc app/library pair has no Team ID for hardened library validation.
- **Fix:** the unsigned build is ad-hoc sealed without hardened runtime; the
  human Developer-ID signing/notarization step must re-enable it. The rebuilt
  mounted DMG completed the LED transient and still passes strict code-sign and
  image verification.

### BUG-10 — XSPICE modules fail from a bundle path containing spaces — **FIXED 2026-07-17**
- **Repro:** `/Volumes/Tau 1/.../digital.cm` was split by ngspice's `codemodel`
  parser; quotes are treated literally and backslash-space still produces two
  arguments. Analog ran while `adc_bridge`/`d_dff` were unknown.
- **Fix:** copy the sealed fixed module set into a private `TempDir` with a
  no-whitespace path for the engine lifetime. The mounted two-DFF circuit then
  completed 575 samples and the real-ngspice register regression passed.

### BUG-11 — Native worker leaks its XSPICE code-model temp dir on every Stop/timeout/crash — **FIXED 2026-07-19**
- **Severity:** Low (bounded, reachable in normal use; a `/tmp` accumulation, not a correctness or security hole).
- **Where:** `apps/desktop/src-tauri/src/spice.rs` — `SpiceEngine::load_bundled_codemodels` (~lines 320–354) stages the bundled `.cm` modules into a `tempfile::TempDir` created with `tempdir_in("/tmp")` and held in `SpiceEngine._codemodel_cache`. Cleanup relies solely on `TempDir`'s `Drop`. The worker-process design (BUG-8 fix) terminates that process with `child.kill()` (SIGKILL) on **cancellation** (`run_spice_worker_process`, the `cancellation.load(...)` branch — wired to the Stop button via `cancel_spice`) and on the **120 s timeout** (`started.elapsed() >= timeout` branch), and a hostile/pathological deck can make it die by signal. SIGKILL and fatal signals do **not** run destructors, so the staged directory is never removed.
- **Problem / Impact:** every time a user clicks **Stop** while a native ngspice run is in flight, or a native run exceeds the 120 s cap, or the worker crashes, a `/tmp/tau-ngspice-XXXXXX` directory holding the 7 copied XSPICE modules (~692 KiB: `analog.cm`, `digital.cm`, `spice2poly.cm`, `table.cm`, `tlines.cm`, `xtradev.cm`, `xtraevt.cm`) is left behind. Repeated stops/timeouts accumulate in `/tmp` until the OS's periodic cleanup (macOS: files untouched for 3 days) or a reboot reclaims them. A normal completed run does **not** leak (Drop runs on clean exit).
- **Repro (built worker, Homebrew libngspice):**
  - Baseline `ls -d /tmp/tau-ngspice-* | wc -l`.
  - Clean run: `tau --tau-spice-worker < good.json` → count unchanged (Drop cleans).
  - Crash: `tau --tau-spice-worker < rec-func.json` (recursive `.func` → SIGSEGV, exit 139) three times → count rises by exactly **+3**.
  - Cancellation/timeout equivalent: start `tau --tau-spice-worker < mod.json` (`.tran 100n 200m`), `sleep 2`, then `kill -9 <worker-pid>` (what the parent's `child.kill()` does) → count rises by exactly **+1**. Contents: 7 `.cm` files, ~692 KiB.
- **Mitigation already present:** none in Tau. Only the OS's 3-day `/tmp` cleanup / reboot bounds it. Because the directory holds only sealed read-only module copies (no user or secret data), the leak is a disk-hygiene issue, not an information-exposure one.
- **Fix applied 2026-07-19 (variant of option c):** code models now stage into the STABLE dir `/tmp/tau-ngspice-codemodels` (create-if-missing, skip when bytes already match, atomic temp-file+rename writes so concurrent workers never see torn files); no Drop dependency remains, so SIGKILL exits cannot leak. Startup also sweeps legacy `tau-ngspice-*` dirs idle >10 min. Verified via the real-ngspice integration test (loads code models through the new path).
- **Original suggestion (for the record):** don't rely on `Drop` for a resource that can be SIGKILLed — either (a) have the *parent* stage the code-model dir once, reuse it across worker invocations, and clean it on app shutdown; or (b) on startup sweep stale `tau-ngspice-*` dirs under the temp root; or (c) since the modules are identical every run, stage them once into a stable per-user cache dir (e.g. under `TMPDIR`/app-cache) instead of a fresh randomized dir per run, so at most one directory ever exists. Note the current `tempdir_in("/tmp")` also ignores `TMPDIR`; combining (c) with the per-user temp base would also stop cluttering the shared `/tmp`.

### BUG-12 - Imported vendor models carry LTspice-only syntax ngspice rejects - CONFIRMED (`.model` cards FIXED 2026-07-21; `.subckt` macromodels open)
- **Severity:** Medium (credibility - the user-model-import flagship parses and inlines vendor definitions, but a real vendor file often would not actually simulate).
- **Where:** `apps/desktop/src/engine/userModelLibrary.ts` (inlined vendor text) plus the bundled ngspice build (`ngspice-46`, which reports "No compatibility mode selected!" and the embedded libngspice does not source a `spinit`). Reproduced against the real LTspice install at `~/Library/Application Support/LTspice/lib`.
- **Problem / Impact:** real LTspice vendor libraries pervasively use LTspice/PSpice-specific syntax that ngspice fatally rejects, so inlining a matched definition verbatim is not enough to simulate it:
  - `.model` device cards carry datasheet ANNOTATIONS with non-numeric values (`mfg=STMicro`, `mfg=NXP`). ngspice aborts the whole deck on a string-valued model parameter ("Error in netlist line …"); numeric annotations (`Vceo=60`, `Icrating=10`) only warn and are ignored. Reproduced with `standard.bjt`'s `2N3055`.
  - `.subckt` macromodels use constructs ngspice's build does not accept: `VSWITCH`/`ISWITCH` switch model types (AD8541 - "Unable to find definition of model vsy_switch"), the LTspice `noiseless` resistor flag, and LTspice built-in behavioral code models such as the `OTA` A-device (AD8601 - "MIF-ERROR - unable to find definition of model"). Three of the first three op-amp macromodels tried hit one of these.
- **Repro:** attach the vendor file through `userModelLibraries`, build a deck referencing the part, and run it through `ngspice -b`. The `.model` case: `2N3055` common-emitter aborts with the raw card, loads once `mfg=` is removed (`V(coll)=10.18 V`, `V(base)=0.291 V`, effective Ic/Ib = 72.9 matching the model's `Bf=73`). The `.subckt` cases: AD8541/AD8601 followers abort as above.
- **Fix applied 2026-07-21 (`.model` cards):** `parseUserModelLibraries` now strips a `.model` parameter whose value begins with a letter (a bare-word LTspice annotation ngspice rejects) while preserving the model name/type, bare flags, and every numeric parameter - the same cleanup Tau already hand-applies when curating its bundled models. Proven end to end by `scripts/userModelImport.corpus.ts` importing the real `2N3055` from `standard.bjt` and simulating the bias stage through native ngspice; unit coverage in `userModelLibrary.test.ts`.
- **Open (`.subckt` macromodels):** `VSWITCH`/`ISWITCH` -> ngspice `SW`/`CSW` translation, `noiseless` stripping, and the LTspice `OTA`/code-model devices are not yet handled; the block is still inlined verbatim. Tracked in `KNOWN_ISSUES.md` ("Importing vendor SPICE models"); the next credibility unit. Do NOT claim vendor op-amp macromodels simulate until this lands.

---

## Lower-severity / hardening notes

- **F-1 — No document validation on the `.asc` Open path. — PARTIALLY FIXED 2026-07-19:** duplicate reference designators are now detected at open time and shown in the schematic Diagnostics panel (App.tsx `openAscFromProject`), instead of surfacing as a deferred deck-build error. `MAX_ABS_COORDINATE` remains unenforced on open by design: hierarchical flattening legitimately packs block bodies at x=1e6. Original entry: `App.tsx`'s `openAscFromProject` never calls `validateSchematicDocument` (only the `.sim` JSON open path does). Duplicate `InstName`s import with **zero** warnings and only surface later as a deferred `buildSpiceDeck` throw ("Duplicate SPICE instance name …") far from the cause. `MAX_ABS_COORDINATE` is likewise unenforced on `.asc` open. Severity Low–Medium.
- **F-2 — NUL bytes survive into component labels. — FIXED 2026-07-19:** `decodeSchematicText` now strips NUL and all C0 control bytes (except tab/newline/CR) on every decode path, with a regression test. Original entry: `decodeSchematicText`'s strict-UTF-8 path accepts U+0000, so `nul-bytes.asc` yields labels like `"Vin middle"`. `validateSchematicDocument`'s `text()` bounds length, not content. Severity Low.

---

## Verified correct (no bug — recorded so future passes don't re-chase)
- **Netlist command injection is blocked in two layers.** A malicious `.asc` `!.control` / `!shell touch` / `!write /tmp/exfil` TEXT directive is stripped at the JS layer (`modelLibLinesFromDirectives` only emits model/lib/subckt keywords) **and** rejected by the Rust `deck_lines` allowlist. `.include`/`.lib`/`codemodel`/`alter`/`source`/`load` all rejected (covered by `spice.rs` tests).
- **Defensive deck rejections** are clean and correctly worded: 0 Ω resistor, missing ground, duplicate SPICE instance name, malformed-unicode value — no crashes, no NaN.
- **Encoding fallbacks** all correct: UTF-16 LE/BE (± BOM) and windows-1252.
- **Robustness:** the full decode→parse→import→extract→deck pipeline never crashed or hung across **24 adversarial files** (10 MB single line, 7502-component grid, 4 KB random binary, truncated, mixed CRLF, extreme coords). 600 seeded mutations of 3 real files → 0 uncontrolled exceptions, 0 >5 s stalls.
- **Path safety (Rust `project_fs.rs`):** create/move/rename are confined to the authorized project root; symlink sources rejected; descendant-move and overwrite rejected; scope must be pre-authorized by the folder picker. Well tested.
- **Local AI (`local_ai.rs`):** loopback-only (`127.0.0.1:8080`), origin allowlist has no `*`, pinned `uv` download with fixed URL + sha256, fixed `mlx-lm` install args (no renderer-supplied package/index/shell). Credentials live in the OS keychain (`credentials.rs`), never web storage.
- **`.subckt` recursion:** real hierarchy flattening (`resolveSubcircuit`) terminates via a by-name cycle guard + `MAX_SUBCIRCUIT_DEPTH=16`. `recursive-subckt.asc`'s self-reference is inert (encoded as opaque TEXT directives, not interpreted as hierarchy).
- **TS expression evaluator is recursion-safe.** `evalNode` (`simulation/expr.ts:401-402`) hard-caps at `depth > 64` ("Expression recursion too deep (cyclic .func?)"), so a recursive/cyclic `.func` (e.g. `.func f(x)={f(x)+1}`) throws cleanly in `buildParamScope`/component-value resolution rather than blowing the JS stack. It is also never forwarded to the native deck (only `model`/`lib`/`inc`/`include`/`subckt` keyword lines are emitted by `modelLibLinesFromDirectives`; `.func`/`.param` are resolved and substituted in TS), so the native recursive-`.func` SIGSEGV is not reachable from a Tau schematic.
- **`traceStatistics` (measurementModel.ts) is genuinely trapezoidal.** On a 1 kHz sine with seeded-random non-uniform time steps, RMS is within 0.006% of A/√2; with samples deliberately clustered near the peaks (worst case for naive sample averaging), still within 0.09%. AVG/RMS on 50%- and 20%-duty squares match analytic values. The §11 plot statistics themselves are sound — BUG-7 is purely the classifier.

---

## Benchmarks (audit machine, Apple silicon)
- huge-grid (7502 components): import ~1.6 s; generated deck 144 KB / 5005 lines (well under the 512 KB / 30 000-line Rust caps).
- Genuinely-connected 602-component RC ladder: TS engine ~433 ms; native ngspice ~40 ms wall.
- 10 MB single-line `.asc`: full pipeline ~112 ms (but rejected at the 5 MB open cap in the real app).
- `.op` accuracy vs ngspice: voltage divider exact to ~2 nV; RC `.ac` sweep < 0.0001 dB across 1 Hz–1 MHz.

---

## DMG readiness verdict (audit date 2026-07-18, updated pass 3)
**Not yet a complete LTspice replacement; substantially hardened.** BUG-1/4/7,
both packaged execution failures, **and now BUG-8 native isolation** are fixed:
libngspice runs in a disposable child process with bounded IPC, a 120 s wall
clock, and Stop-button cancellation, and a native `SIGSEGV`/`SIGABRT` or the
"engine cannot recover" state is now contained (re-verified this pass). Corrupt
round-trips remain blocked rather than silently written. Remaining release gaps:
BUG-2/3 guarded ASC saves, F-1/F-2
input validation, and two smaller worker residuals — no hard memory cap on the
worker (BUG-8 residual; ngspice's own output-memory guard mitigates) and the
`/tmp/tau-ngspice-*` code-model leak on Stop/timeout/crash (BUG-11, Low).

---

## Audit passes log
- **2026-07-18** — Native-execution isolation & resource pass on `auto/ltspice-parity` @ `90a9287`. Focus: the new ngspice worker (`7fe5362`). **Re-verified BUG-8 as FIXED** — spawned the real `tau --tau-spice-worker` (Homebrew `libngspice.dylib` staged into the gitignored resource path) and confirmed a native `SIGSEGV` (recursive `.func`, exit 139) and ngspice's "cannot recover" output-memory state are both contained by the disposable child + structured-error path; noted the remaining no-memory-cap residual. **Found BUG-11 (CONFIRMED, Low):** the worker's XSPICE code-model `TempDir` (`tempdir_in("/tmp")`) leaks ~692 KiB on every SIGKILL (Stop button / 120 s timeout) or crash exit because `Drop` doesn't run on signal death — reproduced deterministically (+1 per SIGKILL, +3 over 3 crashes; clean runs don't leak). Added verified-correct note (TS `evalNode` depth-64 recursion guard; `.func` not forwarded to native). Baseline re-run: typecheck clean; vitest green in isolation but flaky under CPU contention (9 `App.workspace.test.tsx` timeouts) — logged as harness timeout sensitivity, not a regression. Scratch harnesses in `/tmp/tau-audit` (outside the clone); leaked scratch temp dirs cleaned. **Next area:** AC/DC/TF native-vs-ngspice numeric parity, and F-1/F-2 `.asc` Open-path validation.
- **2026-07-17** — Full reliability/perf/security pass on `auto/ltspice-parity`. Found BUG-1…BUG-6 + F-1/F-2; fixed BUG-1 in working copy. Baselines and benchmarks above. Audit tooling preserved in `scratchpad/audit-artifacts/` (stress harness, round-trip checker, fuzz suite, sim cross-check).
