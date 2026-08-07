# Reference imagery

The five plates in `references/images/` are the specification for this language.
**Open them.** This file tells you which modules on each plate are worth
studying and what specifically to take from them — it is an index, not a
substitute.

## Plate 5 — `05-complications-large.png`

1698×956, the highest-resolution plate. Use this one for any decision about
type size, unit treatment, or label spacing.

| Module | What to take |
|---|---|
| **VO₂ max** `45.3` + `GOOD` | The canonical hierarchy: value ~3× the label. `GOOD` is a *status word in semantic colour on the value's line*. Segments are trapezoids that grow in height along a purple→magenta ramp, active one brightest. Breakpoints `>15 25 34 44 53+` beneath, tiny and muted. |
| **Flight** `2H 56M` | Unit treatment: `H` and `M` are smaller and dimmer than the digits, baseline-aligned. `Land on Time` is a green status word. The green curve *is* the data and the flight glyph rides it. |
| **Heart rate** `135` | The range bar. Endpoints `↓54` / `186↑` carry arrows for direction. Current value in a pill inside the bar. Note this is the only module with a glow — reserved for an active alert state, and Tau should keep it that way. |
| **Glucose** `126 mg/dL` | A *zoned* arc: 180°, four coloured bands, white needle, boundaries labelled `70 140 200`. Far more informative than a plain proportional fill. |
| **Steps** `6,317` | Label above value. Progress track with a circular knob at the current position, scale `0 · 5K · 10K`. `3.19 MI` / `6 FLOORS` as a secondary right-aligned column. |
| **Standing** | Vertical capsule bars, cyan, `0`/`60` axis on the left, day initials beneath with the current day bolded. |
| **UV index** | Bars that decay into dots as the value falls — magnitude encoded by height *and* colour simultaneously. Elegant and very dense. |
| **Rainfall** | Bars hang *downward* from the top because rain falls. Domain-appropriate orientation is allowed and good. |
| **Tide** | Sparkline with a blue gradient fill, dots at the extremes, a white vertical hairline at now, axis `00 06 12 18`. |
| **Spend** | Bar series with a dotted reference line and the current month (`OCT`) bolded. |
| **Timer** | The one heavy bezel on the plate. It implies a physical device. Everything else is unenclosed — that ratio is the lesson. |

## Plate 4 — `04-instrument-cluster.png`

The closest analogue to Tau's real problem: multi-series plots with axes.
Read this before building a waveform card.

| Module | What to take |
|---|---|
| **Heart-rate zones** | *Almost exactly a Tau waveform card.* Sparkline over shaded **zone bands** with inline labels (`ZONE 2`), y-axis endpoints `158` / `91 BPM`, x-axis times. Bands turn a plain trace into a judgeable one. |
| **Power curve** `278 W` | Y-axis shows three values — `310 / 261 / 210` — with the **current one bolded on the axis itself** rather than duplicated in a separate readout. |
| **Elevation gain** | Min/max as **axis annotations** (`▲35`, `▼-16`) rather than a separate module. X-axis is relative: `40 MIN AGO → NOW`. |
| **Network throughput** | Two series **mirrored about a zero line**, up purple / down white, axis `0.4 / 0 / 0.4`. A strong model for showing V and I together without two plots. |
| **Temperature bars** | Barcode-dense vertical hairlines for many samples. Stays legible where discrete bars would not. |
| **Room lamp** | Slider tracks whose **gradient encodes the physical domain** — the colour-temperature track literally runs warm→cool. |
| **Lap timer** | Two values compared inside one split capsule, one white one blue. |
| **Golden hour** | Two gradient-filled blocks representing time *windows*, endpoints labelled. |

## Plate 2 — `02-complications-dense.png`

Sixteen modules on one field. Study the lattice: strict alignment and equal
gutters are what make this dense rather than busy.

| Module | What to take |
|---|---|
| **Sleep quality** | A **state-over-time strip**: stacked coloured segments across a timeline, with `QUALITY 79%` summarising beneath. The right model for a digital signal or a step-sweep result row. |
| **Streak** | Discrete filled/unfilled rounded blocks — a completion matrix. Good for per-step pass/fail. |
| **AQI** | Value + status word (`42 GOOD`). Each bar carries its own green→red gradient, so the bar shows both its value and where that sits in the range. |
| **Pressure** | `1,013 hPa` with a **trend word and arrow** (`↗ RISING`). Area chart, y-axis `1020/1005/990/975`, `NOW` marker. |
| **Traffic** | **Two lines compared** — actual versus typical — with a status word (`Eased off`). The model for measured-versus-expected. |
| **Calories/HR** | Dual sparkline overlay with a **tabulated numeric strip beneath** aligned to the buckets. Chart and table reinforcing each other. |
| **Forecast** | A **column-per-interval grid**: value, coloured bar, secondary value, glyph. Compact multivariate table. |

## Plate 1 — `01-complications-grid.png`

The same vocabulary as plate 5 at lower resolution. Use it for a fast overview;
prefer plate 5 when precision matters.

## Plate 3 — `03-radial-set.png`

Dials and rings: sweep angles, cap treatment, centred values, tick density.
Consult it when a dial is genuinely justified. As a *set* it is exhausting to
look at, which is the strongest argument for the catalog's one-arc-per-view
rule — a screen that looks like this plate has failed.

## Ideas that transfer

- True black substrate; modules float on it without boxes.
- Large value, tiny label, two steps apart; unit attached and subordinate.
- One semantic accent per module, everything else grayscale.
- Explicit, labelled scale endpoints — and the current value marked *on the axis*.
- A `NOW` marker on any series with a current position.
- Status word in semantic colour beside the value.
- Form chosen to fit the data rather than a house chart type.
- Tabular numerals so changing values do not jitter their neighbours.

## Ideas that do not transfer

- **Circular frames.** A watch face is round; a 27-inch display is not. The
  discipline is the lesson, not the shape.
- **Saturated hues.** These are read for two seconds in sunlight. Tau is read
  for hours, its palette is deliberately desaturated (`--signal: #e6a23c`), and
  its traces are Okabe-Ito chosen for measured colour separation. Do not
  resaturate toward the references.
- **Glow.** It appears once, on an active alert. Everywhere else it would
  interfere with reading a trace.
- **Skeuomorphic texture.** The camera dial and vehicle render are product
  polish. In Tau the schematic symbol is the only picture that carries meaning.
- **A gauge per metric.** The plates are catalogs — every form at once, on
  purpose. A Tau screen showing that many gauges has failed.

## Using them in review

Ask what the plates get right that the surface under review does not:

1. Could you find the primary number in under a second?
2. Is anything coloured that is not carrying meaning?
3. Is any number missing its unit, its scale, or its identity?
4. Would removing every border lose any information?
5. Does the form match the data, or is it a default chart?
