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
- Proprietary license stays; do not add an OSS license file.
- Don't hardcode colors (use CSS vars in `src/App.css`). No SPICE specifics in
  React components.

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

Tau is a sellable LTspice replacement when **all** of these are true and proven
in the packaged desktop app (not just `dev:web`):

- [ ] **A committed, re‑runnable acceptance‑corpus script** (e.g.
      `scripts/acceptance-corpus.sh`) that imports every `.asc` under
      `~/Downloads/LTspice_export/` and `~/Documents/LTspice/**` and reports
      warning‑clean count / deck‑builds count / op‑point‑converges count.
      **This does not exist yet — build it before trusting any corpus number.**
      A number in a doc that nobody can reproduce with one command is not a
      fact; it is a claim.
- [ ] **Acceptance corpus ≥ 80/82** per that script's own output (not a
      hand‑typed number — the script's stdout is the source of truth).
- [ ] **`class-d_starter.asc`** opens unmodified, runs `.tran`, and its
      Efficiency `.meas` matches LTspice within tolerance. (Known blocker as of
      this writing: the imported op‑amp behaves as an open‑loop gain block —
      LTspice comparator symbols are not yet mapped to the `comparator` kind.)
- [ ] **Waveform parity** demonstrated on at least RC, a Colpitts oscillator,
      and the Class‑D circuit (traces match LTspice within tolerance).
- [ ] All directives used in the corpus are supported: `.tran .ac .op .dc .step
      .meas .noise .tf .param .func .temp .options .model .inc .subckt`.
- [ ] Waveform viewer: arbitrary expressions, cursors, FFT/THD, stepped‑family
      overlays, CSV/image export.
- [ ] Editor: mirror/flip, copy/paste, multi‑select, rubber‑band wire moves.
- [ ] **UI is usable down to the app's own stated minimum window size** — no
      column so narrow controls become unreachable, no header stuck above the
      scroll position. Verify with the screenshot pipeline (STEP 3.5 in the
      build prompt) at the minimum size, not just a comfortable one.
- [ ] All gates green; **signed, notarized DMG installs on a clean Mac and
      passes strict signature verification** (`codesign --verify --deep
      --strict`), not just "the DMG opens."

When every box is checked, **stop and report** — do not invent new scope.

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
