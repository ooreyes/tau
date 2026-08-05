# AGENTS.md — autonomous build contract for Tau

This is the operating contract for **any** autonomous agent working on Tau
(the cloud `tau-autobuilder` routine, a local scheduled run, or an interactive
session). It exists to guarantee three things: **work is never lost**, **the
to‑do list is always current**, and **there is an objective finish line**.

`CLAUDE.md` points here. Read this file, then the **top of `PROGRESS.md`**
(the heartbeat), then the **active section of `FEATURE_PARITY.md`** (the
to‑do). Do not re-read the full `DESIGN_LOG.md` each run.

---

## North star

A macOS‑first, engineering‑grade **LTspice replacement** with an Apple‑quality
UI. The decisive test is loading **unmodified user `.asc` files** and
reproducing LTspice results. UI breadth without that path is not progress.

---

## The loop — every run does exactly this, in order

1. **Sync to latest (never work on stale code).**
   ```bash
   git fetch origin
   git switch auto/ltspice-parity 2>/dev/null || git switch -c auto/ltspice-parity origin/auto/ltspice-parity
   git reset --hard origin/auto/ltspice-parity
   pnpm install
   ```
2. **Read the heartbeat** at the top of `PROGRESS.md`. If a unit is still marked
   `IN PROGRESS` from an earlier timestamp, the previous run died mid‑unit:
   inspect `git log --oneline -8` for a `wip: checkpoint` commit, then **finish
   or revert that unit before starting anything new.**
3. **Claim the next unit.** Pick the highest‑leverage unfinished item from
   `FEATURE_PARITY.md` (prefer items that raise the acceptance metric — see
   Definition of Done). Write the heartbeat block (template in `PROGRESS.md`)
   with the claimed unit and `Status: IN PROGRESS`. Keep the unit **small**:
   one feature, finishable end‑to‑end with tests inside a single run.
4. **Do the work, test‑first where practical.** Verify the native path for
   engine changes (`pnpm dev:web` cannot prove ngspice behavior).
5. **Commit AND push after the unit — and after any meaningful sub‑step.**
   ```bash
   git add -A
   git commit -m "auto: <what landed> (§<section>)"
   git push origin HEAD:auto/ltspice-parity
   ```
   **Never hold more than one small unit of uncommitted work.** A `Stop` hook
   (`scripts/checkpoint.sh`) auto‑commits+pushes leftovers as a safety net, but
   do not rely on it — commit deliberately with a real message.
6. **Update the to‑do and the log.** Flip the `FEATURE_PARITY.md` item to ✅/🟡
   with a one‑line note, update the headline acceptance metric if it changed,
   then set the heartbeat `Status: DONE` and append a dated `PROGRESS.md` entry
   (What I did / Files / Tests / Parity items / Next step). Push again.
7. **Stop when the Definition of Done is met** (below). Otherwise loop to step 1.

---

## Durability rules (the "ran out before committing" fix)

- Commit + **push** continuously; the remote branch is the only durable store.
  An interrupted run loses at most the few minutes since the last push.
- The `Stop`/`SubagentStop` hooks run `scripts/checkpoint.sh`, which on `auto/*`
  branches commits any leftover changes as `wip: checkpoint …` and pushes them.
  Squash/replace a `wip:` commit with a real message when you next pick up.
- The **heartbeat** in `PROGRESS.md` makes a mid‑unit death visible to the next
  run. Always update it at claim and at done.

## Token discipline

- Start with `git status`, the `PROGRESS.md` heartbeat, the active
  `FEATURE_PARITY.md` section, and targeted `rg`. Do not dump whole large files.
- Do not re-audit completed features without evidence of regression.
- Smallest vertical change that advances the acceptance corpus. Avoid broad
  refactors during importer/engine work.

## Guardrails

- Tauri v2 + Rust; React 19 + TS + Vite; Zustand document store. Schematic is the
  source of truth; netlists are **derived**, never authored.
- Never fake a model, simulation, cancellation, or AI capability. Keep
  unsupported behavior explicit.
- User‑provided models/libraries only; never redistribute LTspice assets.
- Proprietary license stays: `LICENSE` grants no open-source rights over Tau's
  own code, and must not be replaced with an OSS license. Attribution for
  bundled third-party software is separate and mandatory - `THIRD_PARTY_NOTICES`
  must exist and stay accurate, and no GPL-licensed file may be shipped.
- Don't hardcode colors — every color goes through the design-token CSS
  variables (`src/App.css` today; the §10 shadcn token layer once it lands).
  No SPICE specifics in React components.

## Required gates before every push

```bash
pnpm -C apps/desktop typecheck
pnpm -C apps/desktop test
```
For engine/native or release changes also run: `pnpm --filter @tau/desktop build`,
`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` (all under
`apps/desktop/src-tauri/`), plus the ignored real‑ngspice smoke test.

Commit messages end with:
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## ✅ Definition of Done (the finish line — how we know it's complete)

The finish line is split in two. **The agent-provable list below gates the
completion signal** — every box must be true and proven in the packaged
desktop app (not just `dev:web`), with no ifs or buts. **Signing and
distribution are human-owned** (Omar's list, at the bottom) and must NOT block
or gate completion: the bot finishes at "production-ready, unsigned"; the
completion notification tells Omar it is time to create the Apple Developer
account and sign/notarize/ship.

- [x] **A committed, re‑runnable acceptance‑corpus script**
      (`scripts/acceptance-corpus.sh`) that imports every `.asc` under
      `~/Downloads/LTspice_export/` and `~/Documents/LTspice/**` and reports
      warning‑clean count / deck‑builds count / op‑point‑converges count.
      A number in a doc that nobody can reproduce with one command is not a
      fact; it is a claim.
- [x] **Acceptance corpus capability floor** per that script's own output
      (not a hand‑typed number — the script's stdout is the source of
      truth). Canonical subset must prove **82 imported / ≥80
      warning-clean / ≥79 deck-built / ≥79 op-converged** and CAPABILITY
      **success ≥79 · capability-refusal covering the remainder ·
      deck-guard-leak 0 · failure 0**. Proven 2026-08-04 at **82/81/79/79**
      with CAPABILITY **79/3/0/0**. The three permanent honest refusals on
      this 82-set are NIGBT, Chan-core inductor, and Royer `lt1184f`
      unresolved subckt — do **not** weaken those refusals to inflate
      deck/op toward a fake 80. The old "≥80/82" deck/op wording was
      wrong once fail-closed Chan + unresolvedSubckts landed.
- [x] **`class-d_starter.asc`** opens unmodified (with sibling `deadtime`
      hierarchy), runs `.tran`, and its Efficiency `.meas` matches LTspice
      within 2%. Proven 2026-08-04 by `scripts/dod-parity.sh` /
      `classdEfficiency.corpus.ts`: PS/PL/Efficiency via the same
      `deriveRcCurrents` path the UI uses; measured Efficiency relative error
      ≈ 0.24%. Missing `deadtime` siblings refuse Run (fail-closed). Historical
      "open-loop gain block" comparator note is obsolete — UniversalOpAmp2
      uses the rail-clamped tanh model (`engine/opampSpec.ts`).
- [x] **Waveform parity** demonstrated on at least RC, a Colpitts oscillator,
      and the Class‑D circuit (traces match LTspice within tolerance). Proven
      by `scripts/waveformParity.corpus.ts` via `scripts/dod-parity.sh`.
- [ ] All directives used in the corpus are supported: `.tran .ac .op .dc .step
      .meas .noise .tf .param .func .temp .options .model .inc .subckt`.
- [ ] Waveform viewer: arbitrary expressions, cursors, FFT/THD, stepped‑family
      overlays, CSV/image export.
- [ ] Editor: mirror/flip, copy/paste, multi‑select, rubber‑band wire moves.
- [ ] **§10 visual design system fully adopted** (see FEATURE_PARITY §10 —
      IMPERATIVE per Omar): shadcn‑grade component system with a design‑token
      layer, every panel migrated, zero leftover ad‑hoc styling drift. The app
      must *look* like a product someone pays for, not a prototype.
- [ ] **UI is usable down to the app's own stated minimum window size** — no
      column so narrow controls become unreachable, no header stuck above the
      scroll position. Verify with the screenshot pipeline (STEP 3.5 in the
      build prompt) at the minimum size, not just a comfortable one.
- [ ] **Named-device fidelity is fail-closed everywhere:** zero silent generic
      semiconductor, switch, op-amp, subcircuit, or vendor-symbol substitution;
      the full recursive corpus has zero non-refusal hard failures and at least
      95% of unencrypted circuits build their authored analysis using exact
      document, user-installed, user-attached, or Tau-owned compatible models.
      **Partial (2026-08-05):** unit proof `scripts/named-device-fidelity.sh`
      prints `NAMED-DEVICE: exact=2 refuse=4 silent=0` and recursive stdout
      `NAMED-DEVICE-RECURSIVE: unencrypted=2541 exact=1222 refuse=1319 silent=0 hard-failure=0 encrypted-excluded=1471 exact-rate=48.1%` — tip after
      TIP121/TIP127 Prefix-X + sibling `.lib` (+2 vs 1220; PowerAmpLayout).
      PAsystem discrete aliases (+1 HandsFree). Encrypted bare SYMBOL stay
      refuse. Full unique-leaf probe 33.4%/enc=2781 remains retracted
      (denominator game). Never silent substitution. ≥95% exact-rate **not**
      met; DoD box stays unchecked. SHIPPABLE? **NO**.
- [ ] **Broad differential parity, not a synthetic `.op` proxy:** the acceptance
      runner executes each circuit's authored `.tran` / `.ac` / `.dc` / `.op` /
      `.noise` / `.tf` / `.step` / `.meas` analyses and compares numeric outputs
      with LTspice over a representative device and topology matrix.
      **Partial (2026-08-05):** `scripts/differential-parity.sh` +
      `differentialParity.corpus.ts` (also under `dod-parity.sh`) prove
      pass=86 · sibling=5 · gap=0 on stdout: prior cells through SampleAndHold +
      Educational/contrib/elip_grd.asc authored `.ac` (elliptic RLC + K1; S21/S11
      nRms≈0.0057/0.0039 @ maxTol=0.10 peak) + Documents/LTspice/Draft3.asc
      authored `.ac` (series RLC L/C/R; v(vout) nRms=0 / nMax=0 span≈1.04) +
      Documents/LTspice/Draft7.asc authored `.ac` (series C + neg-R; v(vo)
      nRms=0 / nMax=0 span≈0.99) + Documents/LTspice/Draft2.asc authored
      `.tran` (series C–R highpass; v(vout) nRms≈0.0062 nMax≈0.021 span≈0.20) +
      Documents/LTspice/Draft1.asc authored `.tran` (series diode–L–R; v(n002)/
      v(n003) nRms≈0 nMax≈1e-4 span≈0.37) + Educational/BandGaps.asc authored
      `.dc temp` (four BJT bandgap refs A/B/C/D; nRms≈0.046–0.058 @
      rmsTol=0.06 / maxTol=0.07 BJT tempco) + Educational/waveout.asc authored
      `.tran` (BV product mixer; v(syn) nRms≈0.0078 nMax≈0.021 span≈1.57) +
      Educational/ISO16750-2_example.asc authored `.tran` (bundled 12V+24V
      starting profiles; v(n001)/v(n002) nRms≈0.035/0.025 @ rmsTol=0.05) +
      LTspice.app Resources/IGBTeq.asc authored nested `.dc` (NMOS+PNP IGBT-eq;
      index-aligned v(n002)/i(v1) nRms≈5e-4 / ≈0) + LTspice.app help
      Butterworth.asc authored `.ac` (normalized LC ladder; ≠ Educational
      butter.asc; v(n001)/v(n002)/v(out) nRms≈6e-4) + LTspice.app
      Resources/Draft1.asc authored `.dc` (BV soft `_exp`→`exp`; ≠ Documents
      Draft1; v(x)/v(n001) nRms=0) + Educational/100W.asc authored `.tran`
      (bundled IRFP240/IRFP9240 VDMOS; v(out)/v(out1) nRms≈1e-4 @ V=1.44) +
      LTspice.app help/ACstep.asc authored `.ac` (series RLC; list 1Meg→dec
      100k–10Meg; .step C first=20p; ≠ Educational stepAC; v(z) nRms≈1e-9) +
      LTspice.app help/NoiseStep.asc authored `.noise` (CE pair + 2N2222; list
      10K→9.5–10.5k; .step R first=500; ≠ Educational stepnoise) + LTspice.app
      Resources/MicroCode.asc authored `.tran` (BI Value+Value2 join; v(out)/
      v(out2) nRms≈6e-6) + Circuit_testing_v1/08_tran_rlc_ringing.asc authored
      `.tran` (underdamped RLC; v(out)/v(in) nRms≈8e-4 / 0; ≠ synthetic RC_TRAN)
      + Circuit_testing_v1/04_dc_diode_curve.asc authored `.dc` (1N4148 + 1k;
      v(anode)/i(v1) nRms≈1e-6; ≠ synthetic divider DC)
      + Circuit_testing_v1/05_step_loaded_divider.asc authored `.dc` + `.step
      param LOAD` expanded 1k/4k/7k/10k (v(out) nRms=0; ≠ synthetic divider DC /
      source-step OP / help ACstep).
      gr_del deferred (all-pass |V|≈1 hollow magnitude). TwoTau deferred
      (LTspice rejects Tau s_xfer same-deck). Draft8 Laplace brace-mangle
      deferred. Draft6 AD823 / Draft10 UOA2 same-deck not landed. HalfSlope
      Laplace not landed. SoftDiodeRecovery deferred. wavein (wavefile=)
      deferred. ISO7637 spike still misses. Educational/IGBT.asc NIGBT refuse (≠ IGBTeq).
      dimmer TRIAC deferred. Resources sinh / divide2 / inverter deferred
      (log-domain / `.machine`). Resources mextram deferred (no authored analysis).
      Harness-slice gap closed; broad topology/device matrix still open —
      DoD box stays unchecked.
- [ ] **AI is production-safe and genuinely circuit-aware:** a supported OpenAI
      path (Tau OAuth/backend or native BYOK with separate API billing) keeps
      service credentials out of the renderer, obtains explicit cloud-data
      consent, gives the model bounded exact schematic/netlist/analysis tools,
      validates generated schematics with packaged ngspice before apply, and
      has release-gated live evaluations. Never reuse ChatGPT browser cookies or
      imply that a ChatGPT subscription pays API usage.
- [ ] **Student, professional, and developer product gates:** a first-success
      learning path and contextual help; crash-safe unsaved recovery plus safe
      external-edit/conflict handling and reproducible run records; and a stable,
      documented, versioned CLI/API with machine-readable diagnostics.
- [x] All gates green; **unsigned release build is production‑ready**:
      `pnpm --filter @tau/desktop tauri build` succeeds, the DMG mounts, the
      built Tau.app launches and stays alive, and bundled ngspice simulates
      end‑to‑end in the packaged app. Signing is explicitly NOT required here.
      Proven 2026-08-04 this run: fresh `tauri build` → Tau.app +
      `Tau_1.0.0_aarch64.dmg`; `codesign --verify --deep --strict` OK;
      `hdiutil verify` VALID; mounted resource tree matches staged ngspice;
      10/10 ignored cargo tests against mounted `libngspice.dylib`;
      `scripts/packaged-engine-smoke.py` passed (336 samples); Tau binary
      stay-alive ≥5s. **Shippable? NO** — other DoD boxes remain open
      (broad differential, §10, named-device, UI/editor/waveform/AI/gates).

When every box is checked, **stop and report** — do not invent new scope.

### 🧑‍💻 Human‑owned (Omar) — happens AFTER the completion signal, never gates it
1. Create the Apple Developer account ($99/yr) and a Developer ID
   Application certificate.
2. Sign + hardened runtime + notarize the DMG; verify with
   `codesign --verify --deep --strict` and `spctl -a -vv`.
3. Install on a clean Mac and run one simulation.
4. Distribute.
The completion notification (run.sh) reminds Omar of this list and drops
`~/Desktop/TAU-READY-ACTION-REQUIRED.md` with the exact steps.

## Branch discipline (one lineage, no forks)

**`auto/ltspice-parity` is the only branch in play.** Every session — cloud
autobuilder, local scheduled run, or a human/agent reviewing the work —
reads and writes that branch and only that branch. `main` is the eventual
release target and is updated deliberately by a human decision, never by an
automated merge. Do not create a second long‑lived branch for "review" or
"parallel work" — if you need isolation for a risky change, use a short‑lived
local branch and merge/rebase it back into `auto/ltspice-parity` within the
same session, or don't branch at all. A second branch that anything is
"constantly improving" in parallel is exactly the fragmentation this rule
exists to prevent — it produces divergent metrics and unreviewable duplicate
work. The only sanctioned exception is the ephemeral `auto/ltspice-parity-wip`
rescue ref created by `scripts/checkpoint.sh` / `run.sh`'s durability net —
it is force‑pushed scratch space for crash recovery, always reconciled or
discarded within the next session (see STEP 0 in the build prompt), and is
deleted once consumed. It is not a parallel lineage of real work.
