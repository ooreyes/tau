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
| Two related series (V and I, in and out) | [Mirrored pair](#9b-mirrored-pair) | Two stacked plots waste height and break comparison |
| A signal judged against bands (regions, limits) | [Zone band](#9c-zone-band) | A bare trace cannot be judged without its limits |
| Discrete state across a timeline | [State strip](#9d-state-strip) | A line chart of a digital signal is a lie |
| Measured versus expected | [Comparison pair](#9e-comparison-pair) | Two numbers lose the divergence |
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
- Unit travels with the number, and is **subordinate to it**: one step down the
  scale and dimmer, set immediately against the digits on the same baseline.
  Look at `2H 56M` and `126 mg/dL` on plate 5 — the digits carry the weight and
  the unit rides along. Never `2.5` with `V` promoted to a column header.
- A status word may share the value's line (`GOOD`, `converged`, `~settling`)
  in its semantic colour. This is the cheapest way to make a number judgeable.
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
- No gridlines and no ticks. Where the reader needs numbers, put **two or three
  values on the y-axis and bold the current one** — the power-curve module on
  plate 4 shows `310 / 261 / 210` with the live value emphasised in place. That
  is lighter than a separate readout and keeps the number next to its position.
- Min and max belong on the axis as annotations (`▲35`, `▼-16`), not in their
  own module.
- Prefer a relative time axis when the absolute time is meaningless:
  `40 MIN AGO → NOW` beats two timestamps.
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

## 9b. Mirrored pair

Two series sharing one plot, drawn above and below a common zero line — the
network-throughput module on plate 4.

Use when two quantities are read together and their *relative* size is the
point: V and I on one node, input versus output, source versus load current.

- Zero line: `--border-subtle` hairline across the full width.
- Upper series and lower series each take their own `--trace-*` colour.
- Axis labels mirror around zero (`0.4 / 0 / 0.4`); label each side's quantity
  and unit at the top corners.
- Only legitimate when both series genuinely share a time axis and a sign
  convention. If one is a voltage and the other a current, say so in the corner
  labels — the shared axis must not imply a shared unit.

Saves the vertical space two stacked plots would take and makes phase
relationships visible at a glance.

## 9c. Zone band

Shaded horizontal regions behind a trace, with inline labels — the heart-rate
zone module on plate 4. **The single most transferable idea for Tau.**

Use whenever a signal is judged against thresholds rather than read absolutely:
saturation and cutoff regions, supply rails, a spec limit, a safe operating
area, a noise floor.

- Band fill: the semantic colour at very low alpha (`--*-soft` tokens), never
  a solid.
- Band label: inline at the left edge of the band, `--fs-micro`, `--muted`.
- The trace draws *over* the bands at full strength.
- Boundaries are values, so label them on the y-axis.
- Two or three bands. More becomes a heatmap and the trace gets lost.

A trace with bands can be judged in a glance; a bare trace requires the reader
to remember the limits.

## 9d. State strip

A horizontal timeline of stacked coloured segments — the sleep-quality module
on plate 2.

Use for discrete state over time: a digital signal, a switching phase, per-step
run outcomes, convergence attempts.

- Full-width track, 8–12px, `--r-xs`.
- Each state its own colour; adjacent identical states merge into one segment.
- Endpoints labelled with the time domain; a summary value beneath
  (`QUALITY 79%` in the reference).
- Segments below a couple of pixels get merged rather than drawn — a strip of
  invisible slivers is noise pretending to be data.

## 9e. Comparison pair

Two lines on one plot, one measured and one reference, with a status word —
the traffic module on plate 2.

Use for measured versus expected: a `.meas` result against its target, this run
against the last, Tau against a reference simulator.

- Measured: full-strength `--trace-*`. Reference: `--muted`, or dashed.
- Divergence is the message, so do not autoscale them apart — share one axis.
- Status word (`within tolerance`, `12% high`) in semantic colour, top right.
- Legend both lines. Two unlabelled lines is a puzzle.

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
