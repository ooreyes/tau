# Readout module catalog

Every form in the reference imagery, when it is the right choice, and how to
build it from Tau's tokens.

**Read the "choosing a form" table first.** Picking the wrong visualization is
a correctness problem: an arc gauge on an unbounded quantity invents a maximum
that does not exist, and a reader will believe it.

## Contents

1. [Choosing a form](#1-choosing-a-form)
2. [The value block](#2-the-value-block) — the base of every module
3. [Sparkline](#3-sparkline)
4. [Range bar](#4-range-bar)
5. [Segmented ramp](#5-segmented-ramp)
6. [Arc gauge](#6-arc-gauge)
7. [Phase dial](#7-phase-dial)
8. [Dot matrix](#8-dot-matrix)
9. [Bar series with a now-marker](#9-bar-series-with-a-now-marker)
10. [Status lamp and word](#10-status-lamp-and-word)
11. [Composition](#11-composition)

---

## 1. Choosing a form

| The data is… | Use | Why not something else |
|---|---|---|
| A single settled value | [Value block](#2-the-value-block) | A chart of one number is decoration |
| A value over time | [Sparkline](#3-sparkline) | Shape matters; the endpoints alone hide it |
| A min/max envelope | [Range bar](#4-range-bar) | Two numbers side by side lose the span |
| A value on a bounded, meaningful scale | [Segmented ramp](#5-segmented-ramp) | Communicates the band, not just the point |
| A bounded utilization or fraction of a real maximum | [Arc gauge](#6-arc-gauge) | Only legitimate when a true 100% exists |
| An angle or phase | [Phase dial](#7-phase-dial) | Degrees as text lose the wrap-around |
| Discrete states across channels | [Dot matrix](#8-dot-matrix) | A line chart of a digital signal is a lie |
| A series with a current position | [Bar series + now-marker](#9-bar-series-with-a-now-marker) | Without the marker there is no "now" |
| Run state, pass/fail, convergence | [Status lamp](#10-status-lamp-and-word) | A chart of a boolean is noise |
| Unbounded and non-temporal (impedance, count) | [Value block](#2-the-value-block) | Any gauge implies a maximum you invented |

When two forms both fit, prefer the one with less ink.

---

## 2. The value block

The base unit. Everything else decorates this.

```
V(out)                     ← label:  --fs-micro, --tracking-wide, --muted, uppercase
2.5 V ±157 mV              ← value:  --fs-heading/--fs-display, --font-mono, --text
RMS 3.54 V                 ← detail: --fs-caption, --muted (optional)
```

Rules that matter:

- The value is the largest thing in the module. If the label competes, the
  hierarchy has collapsed and the module reads as a form field.
- `--font-mono` with tabular figures, always. A value that changes must not
  reflow its neighbours.
- Unit travels with the number. `2.5 V`, never `2.5` with `V` in a header.
- Label above value. Reading order is identify-then-read; a trailing label
  makes the eye backtrack.
- No container. Grouping comes from proximity.

Colour: the value takes its trace colour when it *is* a trace. Otherwise
`--text`, with `--danger`/`--success`/`--signal` reserved for state.

---

## 3. Sparkline

A small line chart with no axes, showing shape rather than precise values.

Use for a time-varying signal where the trend is the point: a settling
waveform, a convergence history, an FFT envelope.

- Stroke: the series' `--trace-*` colour, 1.5px, no glow.
- Fill: optional, only as a low-alpha gradient to the baseline. The references
  do this on tide and elevation curves. Never a solid fill — it reads as area
  and implies integration.
- Baseline: `--border-subtle` hairline, only when zero is meaningful.
- Now-marker: 1px `--accent-line` vertical, plus a dot at the intersection.
- No gridlines, no ticks, no axis labels. If the reader needs values, pair it
  with a value block; if they need to measure, they should be in the scope.
- Endpoints may be labelled at `--fs-micro`/`--muted` when the domain is not
  obvious.

Degenerate cases: fewer than three points is a value block. A flat line should
still render — flat is information — but say so with a value block beside it.

---

## 4. Range bar

A horizontal track with a filled span and labelled endpoints. The reference
heart-rate module is the archetype: `↓54` and `186↑` at the ends, `135` marked
inside.

Use for min/max envelopes, tolerance bands, a measured value inside a spec
range.

- Track: `--fill-track`, height 4–6px, `--r-pill`.
- Span: the semantic colour at full strength.
- Current-value marker: 2px `--text` tick, or a small labelled pill when there
  is room.
- Endpoint labels: `--fs-micro`, `--muted`, at the two ends. Label the actual
  numbers, not "min"/"max".
- If the value sits outside the range, do not clamp silently — clamp the
  drawing and mark it (an arrow at the edge, `--danger`). A pegged reading that
  looks in-range is a dangerous lie.

This is the right form for a settled `min … max` where the span itself is the
message. When the swing is symmetric, a value block reading `±157 mV` is
lighter and says the same thing.

---

## 5. Segmented ramp

Discrete blocks, one highlighted, with scale breakpoints underneath — the VO₂
max and AQI modules.

Use when a value falls into a *named band* and the band matters as much as the
number: convergence quality, noise-figure grade, a pass/marginal/fail scale.

- Segments: 4–7. More becomes a bar chart; fewer is a status lamp.
- Inactive segments: `--panel-2`. Active: the semantic colour.
- Breakpoint labels beneath at `--fs-micro`/`--muted`, at the boundaries.
- The active segment may carry the value; the rest never carry text.
- Order the ramp so worse and better have a consistent direction, and keep that
  direction the same everywhere in the app.

Do not use a ramp for a continuous quantity with no meaningful bands — that
invents thresholds the physics does not have.

---

## 6. Arc gauge

A partial ring filled proportionally.

**The most over-used form, and legitimate only when a true maximum exists.**
Duty cycle (0–100%), a thermal limit against a rated maximum, a percentage of
a budget. Never for voltage, current, impedance, frequency, or anything else
unbounded — the arc's end implies a ceiling, and inventing one misleads.

- Sweep 180–270°, never a full ring (a full ring reads as a pie).
- Track `--fill-track`, fill the semantic colour, `stroke-linecap: round`.
- Value centred in the arc, `--font-mono`.
- Label the endpoints when they are not obvious.
- One arc per view, at most. A wall of arcs is the exact "dashboard" failure
  this language exists to avoid.

Before adding one, check whether a range bar carries the same information with
less ink. It usually does.

---

## 7. Phase dial

A circular indicator where angle *is* the quantity — the compass module.

Use for AC phase, phase margin, anything where 359° and 1° are neighbours and
a linear form would misrepresent that.

- Ring: `--border-subtle`. Ticks at 0/90/180/270, `--border-strong`.
- Needle or dot: the semantic colour.
- Numeric value at centre, `--font-mono`, with the unit (`°`).
- Reference direction (0° = in phase) marked and consistent app-wide.

---

## 8. Dot matrix

A grid of filled/unfilled dots or short bars for discrete state.

Use for digital signals, per-channel pass/fail, bus state, a step-sweep run
matrix. A digital waveform drawn as a smooth line is actively wrong; it implies
intermediate values that never existed.

- Dot: 4–6px, `--r-pill`. On = semantic colour, off = `--panel-2`.
- Group with `--sp-1`; separate channels with `--sp-2`.
- Row labels at `--fs-micro`/`--muted`.
- Above roughly 64 cells, switch to a heatmap strip — individual dots stop
  being readable and the grid becomes texture.

---

## 9. Bar series with a now-marker

Discrete bars over a domain with the current position called out — the rainfall
and monthly-spend modules.

Use for binned data: FFT bins, a histogram, per-step results, per-month runs.

- Bars: `--panel-2` at rest; the current or selected bar in the semantic colour.
- Gap: 1–2px. Bars should read as a series, not as separate objects.
- Domain labels only at the ends and at the marker. Labelling every bar is what
  turns a compact module into a cluttered chart.
- Now-marker: label it (`NOW`) at `--fs-micro`; position alone is ambiguous.

---

## 10. Status lamp and word

A small filled dot plus a short word — `COMPLETE`, `PREPARING`, `GOOD`.

Use for run state, convergence, validity.

- Lamp: 6–8px `--r-pill`, semantic colour, no glow and no pulse. A pulsing
  indicator competes with data for attention and makes a stable system look
  unstable.
- Word: `--fs-micro`, `--tracking-wide`, uppercase, in the same colour, at the
  quieter end of the ramp so a long status string never becomes a colour wash.
- Always pair lamp with word. Colour alone fails colour-blind readers; this is
  the cheapest place in the whole app to get that right.
- One lamp per surface. Several competing lamps and none of them reads.

---

## 11. Composition

**Grid.** Modules tile on the 4pt grid with `--sp-4`/`--sp-6` gutters. Equal
gutters horizontally and vertically — the references use a strict lattice, and
that regularity is what lets density feel calm instead of crowded.

**Separation.** Space first. A `--border-subtle` hairline only when two
adjacent modules would otherwise read as one. Never a full box per module.

**Alignment.** Values left-align with their labels. Numeric columns align on
the decimal — this is what `--font-mono` is for.

**Density budget.** Roughly one primary number per module. Two competing large
numerals means it should have been two modules.

**Emptiness.** A module with no data collapses or shows a single `--faint`
em-dash. It never shows a zero — a zero is a measurement, and an empty slot is
not. Never leave a large empty container occupying prime space.
