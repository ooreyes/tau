# Tau Autobuilder — Progress Log

<!-- ───────────────────────────────────────────────────────────────────────
     ⏱ HEARTBEAT — the single source of "what is happening right now".
     Every run REWRITES this block: at claim (Status: IN PROGRESS) and again at
     done (Status: DONE). If you start a run and Status is still IN PROGRESS
     from an OLD timestamp, the previous run died mid‑unit — run
     `git log --oneline -8`, recover/finish/revert that unit FIRST, then go on.
     ─────────────────────────────────────────────────────────────────────── -->
## HEARTBEAT

**Status: DONE - 2026-08-05 03:28 CDT**

Unit: Educational `varistor.asc` TRAN + `stepnoise.asc` noise → differential
**pass=61** (circuit ids `edu-varistor` / `stepnoise`; distinct from sibling
specialDeviceParity `varistor`). Named-device 47.9%. SHIPPABLE? **NO**

**SHIPPABLE?** **NO**



---


### 2026-08-05 — Educational varistor.asc + stepnoise.asc → pass=61 (§DoD)

**What I did**
- Educational `varistor.asc` authored `.tran`: A-device VARISTOR clamp
  (`B_A1_VAR`); probe `v(out)` nRms≈0.0126 nMax≈0.0583 (maxTol=0.06). Circuit
  id **`edu-varistor`** — not the sibling specialDeviceParity `varistor` row.
- Educational `stepnoise.asc`: `.noise … list 10K` + `.step oct param R`
  (first member R=500). Tau lacks `list` noise parse → same-deck 9.5–10.5 kHz
  band; V(onoise)/V(inoise) nRms≈0; exact 2N2222.
- Collision: Continue 13 Pierce WIP briefly overwrote the corpus working tree;
  left Pierce alone (cells not landed here). Tip was `b7cb1ed` pass=59 → 61.
- Never faked NE555/LoopGain/Vswitch/Howland/SoftDiode/phaseshift*/varactor*/
  MonteCarlo/2ndOrder*.

**Exact stdout**
```
SUMMARY pass=61 sibling=5 gap=0
```

**Files**
- `apps/desktop/scripts/differentialParity.corpus.ts`
- `AGENTS.md`, `FEATURE_PARITY.md`, `PROGRESS.md`
- `~/Desktop/TAU-MORNING-STATUS.md`

**Tests**
- `vitest … differentialParity.corpus.ts` → SUMMARY pass=61 sibling=5 gap=0
- `pnpm -C apps/desktop typecheck` + `test`

**Parity items**
- Differential 🟡 harness **pass=61 · sibling=5 · gap=0**; DoD broad box unchecked.
- Named-device 🟡 **47.9%** unchanged. SHIPPABLE? NO

**Next**
- Continue 13 Pierce/colpits2 (or non-colliding Educational). Leave Settings alone.


### 2026-08-05 — phaseshift/phaseshift2 AC stim → pass=59 (§DoD)

**What I did**
- Educational `phaseshift.asc` / `phaseshift2.asc`: BJT RC phase-shift oscillators
  (exact 2N2222 / 2N3904; phaseshift2 bakes `.params R=10K`). Authored `.tran`
  startup phase-misses vs LTspice (same class as astable) — landed same-deck
  AC stim on V1 (Colpitts/Clapp/Hartly pattern). |V(out)| nRms≈0.
- Tip was `5eeb141` varactor/varactor2 pass=57; this climbs 57→59.
- Collision-avoided Staff EE varistor/stepnoise. Never faked NE555/LoopGain/
  Vswitch/Howland/SoftDiode/HalfSlope/TLINE-inv/astable/100W/160.

**Exact stdout**
```
SUMMARY pass=59 sibling=5 gap=0
```

**Files**
- `apps/desktop/scripts/differentialParity.corpus.ts`
- `AGENTS.md`, `FEATURE_PARITY.md`, `PROGRESS.md`
- `~/Desktop/TAU-MORNING-STATUS.md`

**Tests**
- `vitest … differentialParity.corpus.ts` → SUMMARY pass=59 sibling=5 gap=0
- `pnpm -C apps/desktop typecheck` + `test` (2680 passed)

**Parity items**
- Differential 🟡 harness **pass=59 · sibling=5 · gap=0**; DoD broad box unchecked.
- Named-device 🟡 **47.9%** unchanged. SHIPPABLE? NO

**Next**
- Non-colliding Educational/Applications AC/TRAN (not varistor/stepnoise).
  Leave 100W/160 alone. Pierce XTAL import looks importable later.
