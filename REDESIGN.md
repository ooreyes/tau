# Tau canvas-first redesign

> **Status:** prerequisites in progress. No shell change has landed yet.
> **Normative sources, in order:** [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), then
> `.claude/skills/tau-instrument-aesthetic/` and its five reference plates.
> Where this file and `DESIGN_SYSTEM.md` disagree, `DESIGN_SYSTEM.md` wins and
> this file needs fixing.

## Why this document exists

The brief for this work was given verbally and lost when the conversation was
compacted. It was reconstructed once from memory. Writing it down is the first
unit of the work, so that never costs anything again.

## The goal

**The canvas becomes the full window. Chrome floats over it and collapses when
unused.**

- Nav rail: icon-only, always visible.
- Parts palette: floating and summoned, not a docked column.
- Inspector: appears at the selection, not in a fixed rail.
- Drawers: waveforms and telemetry slide over the canvas, they do not squeeze it.

The product bar is EveryCircuit and better.

## What the reference plates actually say

Read `05-complications-large.png` and `04-instrument-cluster.png` before making
any visual decision. The observations that govern a *shell*:

1. **Modules sit directly on the substrate.** Separation is gutter, not boxes.
   Across roughly thirty modules on the two densest plates, exactly **one** has
   a bezel: the timer, where a frame implies a physical device. A box around
   something already visually grouped is the primary antipattern.
2. **The substrate is the darkest surface and everything sits on it.** For Tau
   the canvas *is* the substrate. Chrome sits on the canvas, never beside it.
3. **Violent type hierarchy**, two steps of the scale apart, not five.
4. **The unit belongs to the number**: attached, baseline-aligned, one step down
   and dimmer. Never its own line, never a column header.
5. **One accent per module**, and it means something.
6. **Scales are labelled at their endpoints only.**

### The rule that follows, and that this redesign adds

> **Veil, not panel.** Persistent chrome (nav rail, transport, status readout)
> gets a low-alpha blurred veil and **no shadow**, so the grid stays faintly
> visible through it and it reads as *above* rather than *beside*. Only
> **summoned** surfaces get a shadow, because a shadow's job is to say "this
> came from somewhere and will go back".

Six shadowed floating panels is a generic dashboard, which is the failure mode
this rule exists to prevent. Rejected alternative: an opaque `--panel-3` rail,
which is a docked column wearing a float costume and re-creates the box the
plates forbid.

## The surfaces

| Surface | Where | Summoned by | Dismissed by | At 900x600 |
|---|---|---|---|---|
| Canvas | `inset: 0`, the only element in normal flow | always | never | gains space |
| Nav rail | left edge, veiled | always | never | unchanged, never collapses |
| Transport | top-right, veiled: Run, mode, assistant, Settings | always | never | icons only |
| Status readout | bottom-left, veiled, one line | always | never | hint drops |
| Parts palette | anchored to the rail | `P`, rail, `⌘K` | Esc, canvas click, after a place | overlay costs no width |
| Selection inspector | at the selection | a selection exists | Esc, keeps the selection | corner-dock more often |
| Explorer sheet | anchored to the rail | rail, `⌘⇧E` | Esc, canvas click, opening a file | unpins |
| Assistant sheet | right edge | transport, `⌘I` | Esc unless pinned | unpins |
| Results drawer | bottom, peek/half/full | Run, rail, `⌘\` | Esc to peek | full leaves 180px of canvas |
| Command palette | centred modal | `⌘K` | Esc | unchanged |

Three deliberate deletions: the Properties/Library segmented control (two
unrelated things crammed into one column to justify the column), the minimized
panel dock (the drawer's peek state is a better readout than a restore orb),
and the status bar's permanent keycap wall (moves to the command palette footer
and `?`).

One consolidation: `BottomPanel`, `TelemetryDock` and `SimulationPanel` are
three bottom-ish surfaces today. One drawer, four tabs, one geometry.

## The accessible-name contract

Frozen in `apps/desktop/src/components/shellContract.ts`, imported by both the
components and the tests, so a rename is a one-line diff in one reviewed file.

| Surface | Role | Name | Modal | Escape |
|---|---|---|---|---|
| Nav rail | `navigation` | `Workspace sections` | | |
| Canvas | `main` | `Schematic canvas` | | cancels the current tool |
| Parts palette | `dialog` | `Add component` | yes | closes |
| Selection inspector | `dialog`, no `aria-modal` | `<Designator> properties` | **no** | closes, keeps selection |
| Results drawer | `complementary` | `Waveforms` | no | only if focus is inside |
| Explorer / Assistant | `complementary` | unchanged | no | only if focus is inside |
| Settings | `dialog` | `Settings` | yes | closes |

### Five rules that are correctness, not style

Copy verbatim into every delegated unit spec. Cheaper models reliably invent
the wrong version when left to infer these.

1. **The inspector is not modal and must not steal focus on selection.** Radix
   Popover with `modal={false}`, never Dialog, because Dialog `aria-hidden`s the
   rest of the document and would make the canvas unreachable to assistive tech
   whenever a part is selected. The focus rule is two-branched: opening by
   **canvas selection must not move focus**; opening by **explicit keyboard
   command must move focus to the first field**. Wrong the first way and `r`
   types "r" into a value field instead of rotating the part; wrong the second
   way and the inspector is keyboard-unreachable. Test both directions.
2. **Focus restoration targets the canvas, not `document.body`**, so the canvas
   needs `tabIndex={-1}` and a ref. Assert `document.activeElement` after Escape.
   Note the Radix caveat found while fixing Settings: Radix restores focus only
   to a `Dialog.Trigger`, so any surface opened from an ordinary button must
   handle `onCloseAutoFocus` itself or the bug simply moves.
3. **Do not use `ui/sheet` for the results drawer.** Same modal reason. Its
   `SheetContent` is also hardcoded to a 360px top-right corner panel.
4. **A collapsed surface is unmounted or `hidden`, never translated off-screen.**
   Assert `queryByRole(...)` is null when collapsed; that one assertion enforces
   both the a11y rule and test determinism.
5. **Chrome never collapses while it contains focus**, and Escape only closes a
   floating surface when focus is inside it, because canvas-focused Escape must
   keep meaning "cancel the current tool". Specify the precedence or two units
   will each add a document-level listener and the last mounted wins.

## New tokens

Added to all four theme blocks in `App.css`, with `DESIGN_SYSTEM.md` updated in
the same commit. Already exist, do not re-add: `--scrim`, `--scrim-strong`,
`--elev-1`, `--elev-2`, `--elev-pop`, `--elev-inset`, `--panel-4`.

- `--chrome-veil`, `--chrome-veil-strong` — the persistent-chrome material.
  Alpha chosen so the grid stays faintly visible; that is what says "floats".
- `--chrome-blur`, `--chrome-blur-saturate` — `App.css` currently carries four
  hand-picked blurs (20/18/16/2px) and three saturates (180/160/145%).
- `--elev-float` — between `--elev-2` (docked, effectively none) and
  `--elev-pop` (modal). Without it every summoned surface reads as either
  docked or modal, and both are wrong.
- `--z-canvas/chrome/drawer/summoned/inspector/modal/toast` = 0/10/20/30/40/50/60.
  Today `App.css` uses 1, 2, 3, 5, 6, 8, 20, 22, 40, 90, assigned locally, with
  no order anyone can state.

**Deliberately no shadow token for the rail, transport or status readout.** That
absence *is* the two-tier rule, and having no token is how it is enforced.

## Stages

Each leaves the app usable and the suite green.

| # | Stage | Owner |
|---|---|---|
| 0 | Tokens, and `overlayPlacement.ts` extracted from `Canvas.geometry.ts`'s scoring loop | tokens by hand, extraction delegable |
| 1 | Chrome state model (`chrome/`, `store/useChrome.ts`) reading through a pure `resolveChrome`, still rendering today's layout | delegable, spec'd |
| 2 | File moves only, zero behaviour: `ShellPanels.tsx` dissolved | delegable |
| 3 | **The substrate**: canvas full-bleed, veiled transport, rail and status readout | by hand, the style stage |
| 4 | **The drawer**, plus plot viewBox made 1:1 with its container | delegable, reviewed closely |
| 5 | Summoned side surfaces; `ComponentsRail` deleted | delegable, spec'd |
| 6 | **Inspector at the selection** | by hand |
| 7 | Gates and record: `design-shot.mjs` states, `DESIGN_SYSTEM.md` §4, this file closed out | delegable |

### Three specifics decided up front

**The drawer is the EveryCircuit-beating move, not the floating chrome.**
EveryCircuit's scope is a squeezed strip. A full-width bottom instrument drawer
with 1:1 plot type, endpoint-labelled scales and zone bands is a difference an
engineer sees in ten seconds. The floating chrome is what makes room for it.
**If stages must be cut, cut 5 and 6 before 4.**

**Plot text scaling must be fixed inside stage 4.** `.scope-svg` is
`width:100%; aspect-ratio:340/190` against `viewBox="0 0 340 190"`, with
`PLOT_WIDTH = 340` used at roughly sixty sites. In a 1080px container that is
3.2x uniform scale, so a `--fs-caption` tick label renders around 32px. A
full-width drawer makes it worse. Audit `usePlotViewport.ts` and `cardLayout.ts`
before touching the call sites.

**`buildLabelPlacements` does not generalise; its scoring core does.** The
candidate offsets are sized for a ~60x20 world-unit text label and are
meaningless for a ~280x220 screen-px panel. Extract `padRect`, `overlapArea`,
`unionRect` and the scoring loop; generate inspector candidates in screen space
with viewport edges as a **hard reject**, not a score. The corner-dock fallback
gets a 1px `--accent-line` leader, because a detached panel with no leader is
just a panel that happens to be nearby.

## Migration policy

**In place, no feature flag.** A flag doubles the App-level render surface,
which is the measured cost driver; it doubles the screenshot matrix while
halving its clarity; and this repo cannot enforce flag removal, because the
checkpoint hook commits whatever is in the tree with `--no-verify` and there is
no CI or merge gate. The safety net is unit-level shippability, which is exactly
why stage 1 is a visually inert layout inversion rather than "start floating".

**Tag every accepted unit** `redesign/uNN-ok`. `git revert HEAD` is useless
here because the checkpoint hook interleaves `wip:` commits with real ones. A
unit is not accepted until it is tagged.

## Evidence protocol

**Never rename a captured state.** The filename is the join key for before and
after, and renaming destroys comparability with every existing label,
permanently. All eight current `design-shot` states survive as *concepts*
(`inspector` means "a component is selected and its properties are visible";
the drive changes, the concept does not). Add `drawer`, `chrome-idle`,
`chrome-active`.

Capture `redesign-baseline` once before stage 1 and never overwrite it. Each
accepted unit captures `uNN-<slug>`; the after of N is the before of N+1.
Compare previous-to-current and baseline-to-current, per state, per theme,
**at 900x600 first** — the floor is where a float-over-canvas redesign fails
first, and reviewing 1440x900 first trains you to miss it.

## Stop conditions

Observable, with thresholds. Any one of these pauses the work.

1. `App.workspace.test.tsx` exceeds 32s, or any App-level test exceeds 5s.
2. A unit needs a gate edit that was not pre-declared in the prerequisites. One
   planned amendment is engineering; a second unplanned one means the gates no
   longer describe the product.
3. `App.shellContract.test.tsx` changes in a unit not scoped to change it.
4. **A unit's diff removes more `expect(` lines than it adds** in any shell test
   file. This is the specific signature of a model satisfying a gate by deleting
   the check.
5. `App.tsx` grows in any unit. Growth means a second shell is accreting
   alongside the first: the flag failure mode arriving without a flag.
6. A 900x600 clipping defect survives into a second unit.
7. Two live surfaces share an accessible name, meaning old and new are both
   mounted.
8. Review rejection rate above one in three across three consecutive delegated
   units. That is a spec problem, not a model problem: rewrite the specs.

## Prerequisites

- **P0. Worker cap and timeouts.** Done. `vitest.config.ts` now caps workers at
  half the cores and sets a 15s timeout. Measured: at the default 7 workers on
  8 cores the suite took 62s with two App-level timeouts; at the cap it is
  ~43s with none, over three consecutive runs, and needs no `--testTimeout`
  override. This is a hard prerequisite because the delegation model's only
  mechanical signal is "did the suite stay green", and a flaky suite makes the
  reviewer unable to tell a broken unit from a timeout.
- **P1. This file.** Done.
- **P2. `shellContract.ts` and `App.shellContract.test.tsx`,** plus re-pointing
  the 35 coupled assertions while the shell is still the old one, so the rewrite
  is provably behaviour-preserving.
- **P3. Re-point `design-shot.mjs`** at roles and contract names before anything
  moves, or every later stage produces no evidence. Amend the drift gate's
  hardcoded primitive-to-file checks and its token-zone `awk`. Each amendment
  lands as its own commit and must be **green on the unmodified tree**; an
  amendment that only goes green after the change it was blocking is a weakened
  gate, and there is no way to tell after the fact.

**`TRACE_COLORS` is frozen for the whole migration.** Any unit whose diff
touches `TRACE_COLORS` or a `--trace-` line is rejected on sight.
