# CURSOR_DO_THIS.md — Tau handoff

You (Cursor) are taking over **Tau**, a desktop circuit simulator meant to be a
commercial **LTspice replacement**: a real SPICE engine (bundled ngspice) behind
a modern, precise UI. This file is your single source of truth for *what's done,
what's left, how to work, and the bar to hit.*

---

## 0. Run it

```bash
pnpm install          # from repo root, once
pnpm dev              # native Tauri desktop app (real ngspice) — THE app
pnpm dev:web          # frontend only, browser at http://localhost:1420 (fast UI iteration)
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest (~2995 tests collected as of 2026-08-06)
bash scripts/acceptance-corpus.sh   # imports+simulates the user's real .asc corpus, prints scores
                                    # CORPUS_CANONICAL_ONLY=1 restricts it to the historical 82-file set
```

Stack: **Tauri v2 (Rust shell) + React 19 + TypeScript + Vite**, pnpm workspace.
Frontend in `apps/desktop/src/`, Rust in `apps/desktop/src-tauri/`.

---

## 1. Current state (verified, not aspirational)

- ✅ **Engine is essentially done.** On the canonical 82-file subset the gate in
  `apps/desktop/scripts/acceptanceCorpus.corpus.ts` asserts **82 imported /
  ≥80 warning-clean / ≥79 deck-built / ≥79 op-converged**, plus CAPABILITY
  success ≥79, deck-guard-leak 0, hard-failure 0, and success +
  capability-refusal === total. **79 is the honest deck/op ceiling, not 82:**
  three files are permanent fail-closed capability refusals (NIGBT in
  `IGBT.asc`, the Chan-core `NonLinearTransformer`, and the unresolved
  encrypted `LT1184F` subckt in `Royer.asc`). Do not weaken those refusals to
  reach a fake 82. Run `CORPUS_CANONICAL_ONLY=1 scripts/acceptance-corpus.sh`
  to reproduce — that script's stdout is the ONLY trustworthy corpus number.
- ✅ Analyses: `.op .tran .ac .dc .step .meas .noise .tf`, expressions/`.param`,
  controlled + behavioral sources, FFT, cursors, multi-pane plots, CSV export.
- ✅ Editor: place/move/rotate/mirror, multi-select, drag-box, group move,
  wire rubber-banding, copy/paste, undo/redo, multi-tab.
- ✅ **Test suite green, typecheck clean** (~2995 vitest cases collected as of
  2026-08-06; `pnpm test` prints the live number — don't hardcode it here).
- 🟡 **UI/design is THE remaining work** — see §3. Foundation is set, most
  panels are not yet at the target bar.
- 🧑‍💻 **Signing/notarization/Apple Developer account = the human owner's job.**
  Do NOT work on it. Ship target is an *unsigned* production build that runs.

---

## 2. Non-negotiable conventions

- **TypeScript strict, no `any`** without a real reason. React function
  components + hooks. **Zustand** for document state (`store/useSchematic.ts`);
  keep view state (pan/zoom) local to the canvas.
- **The schematic is the source of truth; netlists are DERIVED**
  (`schematic/netlist.ts` → `engine/spiceNetlist.ts`). Never hand-author a
  netlist.
- **No hardcoded colors.** Every color goes through a CSS variable token defined
  in the token zone at the top of `apps/desktop/src/App.css` (lines ≤ 567).
  That zone deliberately contains several palette blocks — the base `:root`
  (dark default), a `@media (prefers-color-scheme: light)` `:root`, and explicit
  `:root[data-theme="light"]` / `[data-theme="dark"]` overrides — all exporting
  the same token names (see the comment at `App.css:217-229`). Add new *tokens*,
  not new palette layers. `scripts/design-system-drift.sh` is the enforcing
  gate: no hex below App.css line 567, and no hex in ts/tsx outside its
  documented allowlist.
- **No faking.** Never fake a model, a simulation result, or a capability. If
  something isn't supported, say so in the UI.
- **Verify every change:** `pnpm typecheck` + `pnpm test` must stay green. For
  engine/netlist changes, validate with `ngspice -b` and the corpus script.
- Commit style: small, imperative, one logical unit per commit.

---

## 3. THE MAIN JOB — finish the visual design (§10)

The app works but doesn't yet *look* like a serious instrument. The design
language is decided and the foundation is in; your job is to carry it through
every panel.

### Design language

> **⚠️ CORRECTION (verified 2026-08-06 against `apps/desktop/src/App.css`).**
> The "Anduril / Palantir, electric-cobalt `#4d9dff`" direction described below
> is **no longer what the code implements** and is kept only as a record of the
> original handoff. `App.css:1-2` now declares *"Apple HIG dark materials + SF
> typography … Engineering-instrument density on macOS/iOS system colors."*
> The real tokens today: `--bg: #000000` with Apple dark-hierarchy panels
> (`App.css:6-10`), and `--accent: #d6d3ca` in dark / `#0068D6` in light
> (`App.css:37`, `:267`, `:379`, `:485`) — **not** cobalt. The Cupertino chrome
> is `components/ui/instrument-icon-button.tsx`. Treat App.css as the source of
> truth for direction, not this section. The rules that *do* still hold are the
> mono-numerics rule, the amber-is-signal-only rule, and the depth/motion
> tokens — all three verified present below.

Original handoff text (historical):
**Anduril / Palantir operator-grade.** Reference feel: a defense-grade command
console / precision instrument. Concretely, tokens already live in `App.css`
`:root`:
- **Cool near-black graphite** surfaces (`--bg`, `--panel*`), layered depth.
- **Electric cobalt** single accent `--accent: #4d9dff`, used *sparingly*.
- **Crisp cool-blue hairline grid** (`--border*`) — defined, not fuzzy.
- **High-contrast cool text** (`--text`, `--muted`).
- **Monospace (`--font-mono`) for ALL technical/numeric readouts** — node
  voltages, component values, coordinates, counts, times. This is a big part of
  the operator feel and is mostly not done yet.
- **Amber is a tactical signal only** (`--signal`, e.g. active-sim / alert) —
  NEVER a primary UI color. Do not reintroduce amber-as-accent or Space Grotesk.
- Depth + motion tokens exist: `--elev-1/2/pop`, `--motion-fast/med`, `--spring`.
  Every interactive element should have resting elevation, a hover lift, and a
  pressed state. Interactions respond <120ms with spring motion, never a linear fade.

### The bar
*Would this ship in a Palantir Foundry / Anduril Lattice console?* If it looks
warm, generic, consumer, or "vibe-coded," it fails — redo it.

### How to work each panel (IMPORTANT — the prior failure mode)
The previous approach did **pixel-neutral token migration** — invisible by
design — and wasted weeks looking identical. Do NOT repeat that. Rule:
> **Every design commit must produce a screenshot that VISIBLY DIFFERS from
> before.** Screenshot before/after (`pnpm dev:web` + your browser, or
> playwright), compare, and if it looks the same you did token-shuffling — redo
> it as real depth/typography/spacing/motion work.

### Panel checklist (do one per commit, screenshot-proven)
1. Top bar / toolbar — real control depth, mono for the file/status readouts.
2. Segmented view toggle (schematic/simulator).
3. Part palette (right) — density, hairline rows, mono shortcuts.
4. Inspector / parameters panel — mono values, aligned label/value grid.
5. Analysis tabs + run bar.
6. Scope / plots — instrument grid, mono axis labels, cursor readouts.
7. Dialogs (Open/Save/settings) + empty/error states.
8. Status bar + left icon rail.
9. **Global type & spacing pass** — one type scale via tokens, 4pt spacing
   rhythm, kill one-off px sizes/margins.
10. **Density mode** — engineering users want dense; compact spacing default.
11. **Responsive floor** — every panel usable at the app's minimum window size
    AND ~1280×720 (both were noted broken). No column so narrow controls become
    unreachable; no header stuck above the scroll position.
12. **Sweep** — ✅ done and now gated. App.css's 142 hex literals are all
    *token definitions* confined to the token zone (lines ≤ 567); ts/tsx has 2
    hex literals, both inside the documented allowlist. Enforced by
    `scripts/design-system-drift.sh` — keep it green rather than chasing a
    raw hex count.

Note: the schematic **canvas keeps its bespoke SVG rendering** (it's the
product's soul) — only its chrome (zoom controls, hover cards, label popovers)
adopts the design system.

---

## 4. Secondary work (after or alongside design)

- ~~**Warning-clean 79 → ≥80/82.**~~ ✅ Met: the ≥80 warning-clean floor is now
  asserted by `apps/desktop/scripts/acceptanceCorpus.corpus.ts` and the corpus
  reports 81. Per-part pin banks live in `io/ascImport.ts` (`LTSPICE_PINS`) if
  you need to add more vendor symbols. The corpus script still names each
  non-clean file and why.
- **Waveform-vs-LTspice numerical parity**, tolerance-checked and documented,
  on RC, a Colpitts oscillator, and the Class-D circuit.
- **Unsigned production build** must work end-to-end: `pnpm build` succeeds, DMG
  mounts, the packaged app launches and runs a simulation. (Signing is NOT yours.)

---

## 5. Definition of Done (when Tau is shippable)

- [ ] `scripts/acceptance-corpus.sh` shows **≥80/82 warning-clean** and
      **≥79/82 op-converge** (79 is the honest ceiling — three permanent
      capability refusals; 82/82 was never achievable without faking them).
      Note: `AGENTS.md` holds the authoritative Definition of Done; this list
      is the abbreviated Cursor-handoff version.
- [ ] Class-D `.tran`/`.meas` matches LTspice within tolerance; waveform parity
      demonstrated on RC + Colpitts + Class-D.
- [ ] Full test suite green; typecheck clean.
- [ ] **§10 design fully done** — every panel at the Anduril/Palantir bar,
      mono numerics everywhere, 0 hardcoded colors, usable at min window size.
      Screenshot-proven.
- [ ] Unsigned `pnpm build` produces a DMG whose app launches and simulates.
- [ ] (Human owner) Apple Developer account → sign → notarize → ship.

---

## 6. ⚠️ Critical coordination note

**This branch (`auto/ltspice-parity`) is also being edited by an autonomous
build bot on this Mac** (a launchd job, `~/.tau-autobuilder/`). If you work in
Cursor on the same branch at the same time, you WILL collide.

Before doing real work, decide one of:
- **Take exclusive control (recommended):** stop the bot —
  `launchctl bootout gui/$(id -u)/com.tau.autobuilder` — then work freely.
- **Coordinate:** `git fetch && git reset --hard origin/auto/ltspice-parity`
  before each session and `git push` frequently, expecting occasional rebases.

Either way: **always sync to `origin/auto/ltspice-parity` before starting** — it
is the single canonical branch. `main` is the release target and is updated only
by a deliberate human decision.
