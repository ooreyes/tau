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

## Baseline (green at audit time)
- `pnpm -C apps/desktop typecheck` — clean. (Re-confirmed clean, pass 2.)
- `pnpm -C apps/desktop test --run` — **1919 passed / 6 skipped** (131 files).
- `cargo test --release` (src-tauri) — **25 passed / 1 ignored**.
  **Pass 2 (later on 2026-07-17): cargo baseline SKIPPED — host disk exhausted.**
  The APFS Data volume hit **0 bytes free mid-build** (`os error 28` while cargo
  wrote `target/release/deps/…`), which also broke every shell command on the
  machine. Recovery: deleted the regenerable `apps/desktop/src-tauri/target/`
  (366 MB) — no source touched. The volume remains ~100% full (414 GiB used,
  ≈460 MB free): **the next `cargo build/test` will refill it and fail again.**
  This is an environment hazard for the autobuilder loop itself, not a Tau bug;
  the host needs several GB freed before Rust baselines can run.
- Real ngspice FFI integration test (`TAU_NGSPICE_LIB=…/libngspice.dylib cargo test -- --ignored`) — **passes**: op, transient, AC, MOSFET, BJT, rectifier, and the digital 2-bit register all solve correctly.
- Acceptance corpus (`scripts/acceptance-corpus.sh`, user's real LTspice files) — **82 imported / 82 op-converged / 79 warning-clean / 82 deck-built**.

---

## Confirmed bugs

### BUG-1 — `.asc` import path has no byte-size cap (resource exhaustion) — **OPEN again (fix was lost, never committed)**
- **Severity:** Medium.
- **Where:** `apps/desktop/src/store/useProject.ts` → `importAscFile` (the "Import .asc" button / file-input path).
- **Problem:** `readTextFile` (`src/project/fsBridge.ts`) enforces `MAX_SCHEMATIC_FILE_BYTES` (5 MB) *before* reading, but `importAscFile` called `decodeSchematicText(await file.arrayBuffer())` with **no size check**. The web/workspace branch then stores unbounded text in memory (Zustand state); even the native branch reads the whole file into the renderer before the Rust 5 MB write cap can reject it. A large dragged-in `.asc` can exhaust the renderer.
- **Repro:** import a >5 MB `.asc` via the Import button; the 10 MB `gigantic-line.asc` stress file parsed in ~112 ms with no cap. (Contrast: File→Open of the same file is correctly rejected with "Schematic files are limited to 5,242,880 bytes.")
- **Fix applied 2026-07-17 (pass 1):** guard `file.size > MAX_SCHEMATIC_FILE_BYTES` at the top of `importAscFile`, matching `readTextFile`, plus a regression test in `useProject.test.ts`. It was left uncommitted in the working copy.
- **Status update (pass 2, same day):** that working-copy fix was **wiped by the runner's `git reset --hard`** before anyone committed it. Verified at `d7dc4a3`: `useProject.ts` `importAscFile` (line 340) still calls `decodeSchematicText(await file.arrayBuffer())` with no size guard, and `MAX_SCHEMATIC_FILE_BYTES` does not appear in the file. **The bug is live again.** Under audit-only rules the fix is not being re-applied; a human should land the one-line guard + test described above.

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

### BUG-4 — Hierarchical `.subckt`/`.ends` split across separate TEXT boxes is silently dropped — CONFIRMED (code + repro)
- **Severity:** Medium (low real-world frequency).
- **Where:** `apps/desktop/src/engine/modelDirectives.ts` → `modelLibLinesFromDirectives`. `subcktDepth` / `prevEmitted` are declared **inside** the `for (const raw of directives)` loop, so they reset for every separate on-canvas TEXT directive. A `.subckt … .ends` block that lives in **one** multi-line TEXT box works; a block spread across **separate** TEXT annotations does not: the `.subckt` opener is emitted, but every body line and `.ends` is dropped (`.ends`'s keyword `"ends"` isn't in `BLOCK_KEYWORDS` and `subcktDepth` is 0). Result: an unclosed `.subckt` swallows the rest of the deck.
- **Impact:** ngspice fatally rejects with `Error: Mismatch of .subckt … .ends statements! … no simulations run`. `deck_lines` (Rust) doesn't check subckt/ends balance, so the user sees only an opaque engine error.
- **Repro:** `deep-hierarchy.asc`; also a minimal 3-box case (`.subckt X` / one instance line / `.ends X`).
- **Suggested fix:** hoist `subcktDepth`/`prevEmitted` out of the per-directive loop so block state carries across TEXT entries; or reassemble all directive text before splitting into blocks. Add a `deck_lines` subckt/ends balance check as a backstop diagnostic.

### BUG-5 — Fast (TS) preview engine and native ngspice disagree on initial conditions — CONFIRMED
- **Severity:** Medium (fidelity/UX; the authoritative "Run" via ngspice is correct).
- **Where:** `apps/desktop/src/simulation/linearTransient.ts` (~lines 215–231): `capacitorVoltage`/`inductorCurrent` default to `0` unless an explicit `IC=` is present — i.e. the TS engine always behaves as `uic`. Native ngspice (and Tau's own `spiceNetlist.ts` deck builder, which omits `uic` unless `.ic`/instance IC is present) solves the DC operating point first and starts from steady state.
- **Impact:** for any circuit with reactive elements on a constant/biased source, the fast preview and the native "Run" show **different waveforms** for the identical schematic. Cross-check measured up to ~99% relative divergence on RC/RL step responses; forcing ngspice to the same zero state brought agreement to ~1% (integrators themselves agree — this is purely an IC-semantics gap).
- **Suggested fix:** compute a DC operating point in the TS engine to seed C/L state (matching SPICE default), or clearly label the preview as `uic`/approximate.

### BUG-6 — `deck_lines` command blocklist bypassed by `+`-continuation lines — CONFIRMED (not exploitable; defense-in-depth)
- **Severity:** Low.
- **Where:** `apps/desktop/src-tauri/src/spice.rs` (~line 586): the per-line command token is `lower.split_whitespace().next()`. A SPICE continuation line begins with `+`, so its first token is `+` and never matches the blocklist (`shell|system|source|write|…`). A line like `+ quit` or `+shell foo` passes the sanitizer.
- **Why not exploitable:** ngspice merges a `+` line onto the preceding card as continuation parameters (`Warning: unrecognized parameter (quit) - ignored`); it is never executed as a command. The only place blocklisted commands run is a `.control` block, which the allowlist still rejects. Confirmed inert end-to-end.
- **Suggested fix (hardening):** strip a leading `+` before extracting the command token, so continuation lines are checked too.

### BUG-7 — `classifySignal` rejects any pulse/PWM waveform whose duty cycle is outside ≈48–51% — CONFIRMED
- **Severity:** Medium. Non-50%-duty pulse trains are the bread and butter of the §11 priority area (vpulse sources, switching converters, logic clocks), and the misclassification silently degrades three shipped features at once.
- **Where:** `apps/desktop/src/simulation/measurementModel.ts:167-208` (`classifySignal`). Periodicity is estimated from **mean-crossing half-periods**; for a rectangular wave of duty `d` those alternate `d·T` and `(1−d)·T`, so the interval-consistency gate `maxRelativeError <= 0.08` (line 193, measured against the *median half-period*) fails for any duty outside roughly 48–51%.
- **Problem / Impact:** a perfectly clean, many-cycle pulse train is classified `"transient"` with no period/frequency. Measured downstream effects:
  1. **Dashboard headline reading** (`ComponentMeasurementsPanel.tsx:31-38` `primaryReading`): non-periodic series fall back to `FINAL` — the last instantaneous sample. For a 0–5 V PWM node that is whichever rail `.tran` happens to stop on, instead of the meaningful RMS (e.g. 2.24 V at 20% duty). The classification badge reads "transient" instead of "Periodic · 1.000 kHz".
  2. **Auto Frame** (`waveform.ts:103` `autoFrameWaveform`): frames the last N cycles only when a trace classifies periodic. Measured: 50%-duty 1 kHz square over 10 ms → framed to the last 4 ms (4 cycles); identical wave at 40% duty → no framing, full 10 ms window (its progressively-smaller-trailing-window retry can't help — the duty cycle is the same in every window).
  3. **Oscillation detection/telemetry** anywhere else `classification.kind` is consulted (e.g. `EngineeringTraceReadout`).
- **Repro:** bundle the real module (`esbuild src/simulation/measurementModel.ts --bundle`) and call `classifySignal` on a sampled 1 kHz 0–5 V square wave, 10 full cycles, 5001 points. Observed: duty 0.5 → `periodic 1.000 kHz`; duty 0.45/0.40/0.30/0.20/0.10 → `transient`, no frequency. Sine/triangle/sawtooth at the same settings → `periodic` (correct). Threshold sweep: 0.48–0.51 pass, 0.47 and 0.52 fail. Independently re-verified by a second agent with its own vectors (2.5 kHz, 0–3.3 V, 25% duty, 8 cycles → `transient`; 50% duty and sine → `periodic`).
- **Sub-issue (same root):** even inside the passing band the period is `2 × median half-period`, so an asymmetric duty biases the estimate — 48% duty of a true 1 000 Hz wave reports 965 Hz (~3.5% off) where the sine reports 1 000.00 Hz.
- **Mitigation:** none in code; statistics (min/max/avg/RMS in the expanded row) remain correct — only the *headline* reading, badge, and Auto Frame degrade.
- **Suggested fix (do not apply blindly):** derive the period from **same-direction crossings** (rising-to-rising intervals are duty-invariant: always exactly `T`) and apply the 8% consistency gate to those full periods; keep rise+fall half-periods only as the single-cycle fallback for near-symmetric waves. This also fixes the ~4% bias (period = median rising-to-rising interval, not 2× a half-period). Regression risk: the single-clean-cycle acceptance path (lines 194-198) and `autoFrameWaveform`/readout tests are tuned to current thresholds — re-run `measurementModel.test.ts`, `waveform.test.ts`, `engineeringTraceReadout.test.ts`.

---

## Lower-severity / hardening notes

- **F-1 — No document validation on the `.asc` Open path.** `App.tsx`'s `openAscFromProject` never calls `validateSchematicDocument` (only the `.sim` JSON open path does). Duplicate `InstName`s import with **zero** warnings and only surface later as a deferred `buildSpiceDeck` throw ("Duplicate SPICE instance name …") far from the cause. `MAX_ABS_COORDINATE` is likewise unenforced on `.asc` open. Severity Low–Medium.
- **F-2 — NUL bytes survive into component labels.** `decodeSchematicText`'s strict-UTF-8 path accepts U+0000, so `nul-bytes.asc` yields labels like `"Vin middle"`. `validateSchematicDocument`'s `text()` bounds length, not content. Severity Low.

---

## Verified correct (no bug — recorded so future passes don't re-chase)
- **Netlist command injection is blocked in two layers.** A malicious `.asc` `!.control` / `!shell touch` / `!write /tmp/exfil` TEXT directive is stripped at the JS layer (`modelLibLinesFromDirectives` only emits model/lib/subckt keywords) **and** rejected by the Rust `deck_lines` allowlist. `.include`/`.lib`/`codemodel`/`alter`/`source`/`load` all rejected (covered by `spice.rs` tests).
- **Defensive deck rejections** are clean and correctly worded: 0 Ω resistor, missing ground, duplicate SPICE instance name, malformed-unicode value — no crashes, no NaN.
- **Encoding fallbacks** all correct: UTF-16 LE/BE (± BOM) and windows-1252.
- **Robustness:** the full decode→parse→import→extract→deck pipeline never crashed or hung across **24 adversarial files** (10 MB single line, 7502-component grid, 4 KB random binary, truncated, mixed CRLF, extreme coords). 600 seeded mutations of 3 real files → 0 uncontrolled exceptions, 0 >5 s stalls.
- **Path safety (Rust `project_fs.rs`):** create/move/rename are confined to the authorized project root; symlink sources rejected; descendant-move and overwrite rejected; scope must be pre-authorized by the folder picker. Well tested.
- **Local AI (`local_ai.rs`):** loopback-only (`127.0.0.1:8080`), origin allowlist has no `*`, pinned `uv` download with fixed URL + sha256, fixed `mlx-lm` install args (no renderer-supplied package/index/shell). Credentials live in the OS keychain (`credentials.rs`), never web storage.
- **`.subckt` recursion:** real hierarchy flattening (`resolveSubcircuit`) terminates via a by-name cycle guard + `MAX_SUBCIRCUIT_DEPTH=16`. `recursive-subckt.asc`'s self-reference is inert (encoded as opaque TEXT directives, not interpreted as hierarchy).
- **`traceStatistics` (measurementModel.ts) is genuinely trapezoidal.** On a 1 kHz sine with seeded-random non-uniform time steps, RMS is within 0.006% of A/√2; with samples deliberately clustered near the peaks (worst case for naive sample averaging), still within 0.09%. AVG/RMS on 50%- and 20%-duty squares match analytic values. The §11 plot statistics themselves are sound — BUG-7 is purely the classifier.

---

## Benchmarks (audit machine, Apple silicon)
- huge-grid (7502 components): import ~1.6 s; generated deck 144 KB / 5005 lines (well under the 512 KB / 30 000-line Rust caps).
- Genuinely-connected 602-component RC ladder: TS engine ~433 ms; native ngspice ~40 ms wall.
- 10 MB single-line `.asc`: full pipeline ~112 ms (but rejected at the 5 MB open cap in the real app).
- `.op` accuracy vs ngspice: voltage divider exact to ~2 nV; RC `.ac` sweep < 0.0001 dB across 1 Hz–1 MHz.

---

## DMG readiness verdict (audit date 2026-07-17, updated pass 2)
**Not yet a complete LTspice replacement; safe but incomplete.** No crashes, hangs, data corruption, or security holes were found — the engine, security posture, and crash-robustness are release-quality, and corrupt round-trips are *guarded* (blocked saves, not silent loss). But real parity gaps remain: op-amp and 3-pin-MOSFET schematics **cannot be saved as `.asc`** (BUG-2/BUG-3), multi-TEXT-box hierarchies fail to build a deck (BUG-4), the preview and "Run" engines disagree on initial conditions (BUG-5), the §11 measurement dashboard mis-handles every non-50%-duty switching waveform (BUG-7), and BUG-1 is live again after its uncommitted fix was lost. Recommend addressing BUG-1/2/3/4/7 before a public DMG billed as an LTspice replacement.

---

## Audit passes log
- **2026-07-17** — Full reliability/perf/security pass on `auto/ltspice-parity`. Found BUG-1…BUG-6 + F-1/F-2; fixed BUG-1 in working copy. Baselines and benchmarks above. Audit tooling preserved in `scratchpad/audit-artifacts/` (stress harness, round-trip checker, fuzz suite, sim cross-check).
