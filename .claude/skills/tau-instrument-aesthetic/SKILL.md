---
name: tau-instrument-aesthetic
description: The visual design language for Tau's UI — a precision-instrument aesthetic derived from Apple Watch complications and instrument clusters, expressed through Tau's existing Apple-HIG token system. Use this whenever you are designing, building, restyling, or reviewing any Tau interface surface: waveform cards, measurement and telemetry readouts, schematic annotations, the toolbar, panels, dialogs, the component palette, the AI assistant, status indicators, or anything that displays a number to an engineer. Also use it when the request is phrased as "make this look better", "polish the UI", "this feels cluttered", "match the reference", "redesign the simulator", or when adding any new panel, chart, gauge, badge, or readout — a new surface built without this language is how the app drifts into generic-dashboard styling. Not for non-visual work (solver math, netlist emission, file IO).
---

# Tau instrument aesthetic

Tau is an instrument, not a dashboard. The reader is an engineer deciding
whether to trust a number. Every visual decision serves that: legibility of
data, honesty about precision, and getting the chrome out of the way of the
circuit.

**The foundation already exists.** `apps/desktop/src/App.css` holds the single
`:root` token block — Apple HIG dark materials, SF typography, a 4pt grid, and
an Okabe-Ito trace palette that is *validated by a script*. `DESIGN_SYSTEM.md`
is the normative spec. This skill does not replace either. It describes how to
compose those tokens into the dense, modular, complication-style readouts the
product is aiming at.

Read `DESIGN_SYSTEM.md` before your first change in a session. If this skill
and that document ever disagree, `DESIGN_SYSTEM.md` wins and this file needs
fixing.

## The one rule that outranks taste

**Never introduce a raw color.** Every color comes from a token. This is
enforced, not advisory:

- `scripts/design-system-drift.sh` fails the build on a hex outside the token
  zone in `App.css`, with a narrow allowlist for `.ts`/`.tsx`.
- `src/styles/palette.test.ts` runs `scripts/validate-palette.mjs` over every
  renderer's `TRACE_COLORS` and fails if the lists drift apart or out of order.

The trace rotation order — green, vermillion, sky, olive, purple, orange — is
load-bearing, not cosmetic. Olive next to green fails the normal-vision ΔE
floor; vermillion next to olive collapses under deuteranopia. Both were
measured. Reorder the list and the suite fails, correctly.

If a design needs a color the tokens do not have, that is a design-system
decision: add the token to `:root` in both themes, document it in
`DESIGN_SYSTEM.md`, and re-run the validator. Do not inline it.

## Look at the reference plates first

Five images live in `references/images/`. **Open them with the Read tool before
you design anything** — at minimum `05-complications-large.png` (the clearest
statement of type hierarchy) and `04-instrument-cluster.png` (the closest
analogue to a Tau waveform card). They are the specification; the prose here is
a summary of them, and a summary always loses detail that matters at the pixel
level.

| File | Read it when |
|---|---|
| `05-complications-large.png` | Any type, spacing, or unit-treatment decision. Highest resolution. |
| `04-instrument-cluster.png` | Building a plot, sparkline, axis, or multi-series readout. |
| `02-complications-dense.png` | Laying out several modules together; state-over-time strips. |
| `01-complications-grid.png` | The core vocabulary at a glance. |
| `03-radial-set.png` | Only when a dial or arc is genuinely justified. |

`references/imagery.md` maps each plate to the specific modules worth copying.

## What the aesthetic actually is

The transferable ideas:

**1. Black is the substrate, not a background.** True black (`--bg: #000000`)
reads as an unlit instrument face. Modules sit *on* it. They are separated by
space, not by boxes. Most modules have no border and no fill at all.

**2. Data-ink maximalism.** Nearly every pixel is data, an axis, or a label
that identifies data. Ornament — outer glow, gradient fills, decorative rules,
container chrome around things that are already visually grouped — is what
makes a dense display feel cluttered rather than rich.

**3. Violent type hierarchy.** A large numeral against a very small caption is
the signature move: `6,317` over `STEPS`, `45.3` beside `VO₂ MAX`. Two steps of
the scale, not five. The value dominates; the label is a whisper that only has
to be found once. In Tau terms: `--fs-display`/`--fs-heading` for the number,
`--fs-micro`/`--fs-caption` with `--tracking-wide` and `--muted` for the label.

**3b. The unit is part of the number, and smaller than it.** Look closely at
`2H 56M`, `126 mg/dL`, `28MM`, `0.4 ↑Mbps`: the unit sits immediately against
the numeral, baseline-aligned, one step down and dimmer. It never gets its own
line and never leaves for a column header. For Tau this means `±157 mV` renders
as a `--fs-heading` mantissa with a `--fs-caption`/`--muted` unit — the value
stays scannable and the unit stays attached to it.

**4. One accent per module.** A module is grayscale plus a single hue that
means something. Cyan for a voltage trace, amber for the running lamp, red for
an error. Two accents in one small module means neither reads as significant.

**5. The form fits the data.** These references never reach for a generic bar
chart. A phase gets a dial, a bounded utilization gets an arc, a time series
gets a sparkline with a "now" hairline, a discrete state gets a dot matrix, a
min/max gets a range bar with labelled endpoints. Picking the wrong form is a
correctness bug, not a style preference. `references/modules.md` is the
catalog: read it before building any new readout.

**6. Scales are explicit and bounded.** `0 · 5K · 10K` under the steps bar;
`>15 25 34 44 53+` under the VO₂ ramp. A number without its scale is a number
the reader cannot judge. Endpoints and the current position get labelled;
everything between them does not.

**7. Bezels only where a bezel is meant.** One module in the references has a
heavy rounded outline — the timer, where the frame implies a physical device.
Everything else is unenclosed. Reach for `--r-md`/`--r-lg` and `--elev-2` only
for genuinely floating surfaces: popovers, the command palette, dialogs.

## Applying it to Tau

### Numbers

Every engineering value is monospaced and tabular — `--font-mono`, so digits
stay in their columns and a changing value does not jitter its neighbours.

Values carry their unit and their quantity. A bare `157 mV` on a schematic is
ambiguous between a node voltage and a drop; `V ±157 mV` is not. Colour alone
must never be the only carrier of meaning — that fails both the reader who has
not learned the convention and the reader who cannot separate the hues.

Precision is a claim. Show the digits the engine justifies and no more; three
significant figures is the house default (`formatEngineering`). Padding a
number with digits the solver did not earn is a form of lying.

Write a settled measurement the way it is read off a scope:

- DC level → `5 V`
- symmetric swing → `±157 mV`
- biased swing → `2.5 V ±157 mV`
- not yet settled → mark it (`~settling`) rather than quoting it as steady

### Color, semantically

| Meaning | Token | Notes |
|---|---|---|
| Measured traces | `--trace-*` | Okabe-Ito, fixed rotation order |
| Running / in progress | `--signal` | tactical amber lamp, not a siren |
| Error / invalid | `--danger` | lamps, hairlines, small text — never a large fill |
| Converged / valid | `--success` | |
| Selection, focus, chrome | `--accent` | deliberately neutral warm graphite |
| Everything unmeasured | `--comp`, `--text`, `--muted` | neutral until it carries data |

`--accent` being neutral is a deliberate decision, not an oversight: chrome
must not compete with measured data for the reader's colour attention. Do not
"improve" it into a brand blue.

A wire, symbol or panel that carries no measurement stays neutral. Colour
arrives when data does.

### Density

Tau's chrome is intentionally dense: `--row-h: 28px`, `--fs-body: 11px`, a 4pt
spacing grid. That is correct for a desktop instrument and should not be
loosened toward web-app padding. Density fails when *spacing is inconsistent*,
not when it is tight — reach for the `--sp-*` steps rather than inventing
values, and let one clear gap do the work a border was doing.

### Motion

`--motion-fast` for state changes, `--motion-med` for surfaces entering or
leaving, `--ease-snap`/`--ease-out` for both. Motion confirms an action or
shows where a surface came from. It never loops, pulses, or animates data that
is not itself changing — a permanently animated readout reads as unstable, and
on measured values it actively misleads. Honour `prefers-reduced-motion`.

### The canvas comes first

The schematic or waveform is the subject; everything else is apparatus. When
space is short, collapse the apparatus before compressing the canvas.

Readouts placed on the canvas must not cover it. Tau has a placement engine for
exactly this — `buildLabelPlacements` in `components/Canvas.geometry.ts`, which
scores candidate positions by overlap area against component bodies, wire
segments, and text already placed. Use it rather than hardcoding an offset. The
schematic deliberately carries **no numeric V/I readouts** today: they were
tried, they covered the drawing, and they were removed in favour of the flow
overlay plus the measurement panels. If you are adding anything textual to the
canvas, that history is the bar to clear.

## How to work

1. **Read `DESIGN_SYSTEM.md`**, then the relevant reference file here.
2. **Look at the actual screen before changing it.** Run the app
   (`pnpm dev`, or `pnpm dev:web` for browser-only UI work) and look. Tau also
   has a screenshot pipeline — `node scripts/design-shot.mjs [label]` captures
   named app states at fixed viewports so before/after pairs are comparable.
3. **Change tokens, not sites.** A value that appears twice belongs in `:root`.
4. **Verify, then look again.** `pnpm -C apps/desktop typecheck`,
   `pnpm -C apps/desktop test`, `bash scripts/design-system-drift.sh`. Then
   re-shoot the screen: a design change that was never looked at is not done.
5. **Check both themes and the responsive floor.** Light theme is the product
   default (`lib/theme.ts`), dark is what most engineers run. Every token is
   defined in both. The app must hold together at 1440×900.

## Reference files

- `references/imagery.md` — an index into the five plates: which module on which
  image demonstrates what, and which ideas are watch-specific. Read it
  alongside the images, not instead of them.
- `references/modules.md` — the readout module catalog: every form, when each is
  the right choice, and how to build it from Tau tokens. Read before creating
  any new readout, gauge, chart, or badge.
- `references/applying-to-tau.md` — concrete proposals for Tau's actual surfaces
  (measurement cards, waveform plots, zone bands, probe identity, step sweeps),
  ordered by payoff. Start here when the task is "improve this screen" rather
  than "build this component".
- `references/antipatterns.md` — the failure modes this language exists to
  prevent, each with the specific damage it does.

## What this is not

Not a cyberpunk theme. Not a SaaS dashboard. Not a gauge collection. The
references are dense because a watch face is 40mm and every pixel had to earn
its place — that constraint is the lesson, not the circular frames. Tau has a
27-inch display and should spend it on the circuit, not on decoration.
