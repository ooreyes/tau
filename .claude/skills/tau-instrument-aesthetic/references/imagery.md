# Reference imagery

The source plates for this language, what each one demonstrates, and — as
importantly — which ideas do *not* transfer to an EDA tool.

## The files

Drop the reference images in `references/images/` with these names. They are
the visual anchor for the whole language; the written descriptions below are
detailed enough to design from if the files are missing, but look at the actual
plates when they are present.

| File | Plate |
|---|---|
| `01-complications-grid.png` | Flight, VO₂ max, moon phase, rainfall, ISS, world clocks, timer, spend, standing, heart rate, glucose, compass, UV index, tide, steps |
| `02-complications-dense.png` | Delivery, running tempo, home status, stock bars, sleep quality, SO₂, to-do, AQI, golden hour, streak, workout, wind, contact, pressure, forecast, sunrise/sunset |
| `03-radial-set.png` | FM dial, route shield, fuel gauge, battery ring, timers, power button, lock, date ring, media progress, storage, transit, AQI dots, rain ring, cycling |
| `04-instrument-cluster.png` | Coordinates, EQ, heart-rate zones, lap timer, golden hour, elevation profile, vehicle, efficiency, camera dial, delivery, temperature bars, network, flight, activity, power curve, transit |
| `05-complications-large.png` | High-resolution crop of plate 1 — best for reading exact type hierarchy and spacing |

## What each plate teaches

**Plate 1 — the core vocabulary.** The clearest statement of the type
hierarchy: `45.3` at display size against `VO₂ MAX` at caption size, with
`GOOD` in semantic colour on the same baseline. Also the best example of
labelled scale endpoints (`>15 25 34 44 53+`) and of the range bar
(`↓54 … 186↑` around a marked `135`).

**Plate 2 — density without clutter.** Sixteen modules on one black field. The
lesson is the lattice: strict alignment and equal gutters are what make this
readable rather than busy. Note how few modules have any container at all.

**Plate 3 — radial forms, and their limits.** Useful for arc and dial
construction: sweep angles, cap treatment, centred values. Also the clearest
warning — as a *set* it is exhausting, which is exactly why the catalog says
one arc per view.

**Plate 4 — instrument-cluster density.** Closest to Tau's actual problem:
multi-series plots, elevation and power curves with fill gradients, zone bands,
and small multiples. The heart-rate-zone and power-curve modules are the best
models for a Tau waveform card.

**Plate 5 — type and spacing detail.** Use this one to match optical sizes and
label spacing precisely.

## Ideas that transfer

- True black substrate; modules float on it without boxes.
- Large value / tiny label, two steps apart, label above.
- One semantic accent per module, everything else grayscale.
- Explicit, labelled scale endpoints.
- A "now" marker on any series with a current position.
- Form chosen to fit the data rather than a house chart type.
- Tabular numerals so changing values do not jitter.
- Status as lamp + word, never colour alone.

## Ideas that do not transfer

- **Circular frames.** A watch face is round; a 27-inch display is not. The
  discipline is what to keep, not the shape.
- **Saturated hues.** Watch complications are viewed for two seconds in
  sunlight. Tau is read for hours. Tau's palette is deliberately desaturated
  (`--signal: #e6a23c` rather than a pure orange) and its traces are
  Okabe-Ito, chosen for measured colour separation. Do not resaturate toward
  the references.
- **Decorative gradients and glass.** Several plates use them for product
  polish. In an instrument they interfere with reading a trace.
- **Iconography as data.** Weather glyphs and vehicle renders carry meaning in
  a consumer app. In Tau the schematic symbol is the only picture that carries
  meaning.
- **A gauge per metric.** The plates are catalogs — every form at once, on
  purpose. A Tau screen showing that many gauges has failed.

## Using them in review

When judging a Tau surface against this language, ask what the plates get right
that the surface does not:

1. Could you find the primary number in under a second?
2. Is anything coloured that is not carrying meaning?
3. Is any number missing its unit, its scale, or its identity?
4. Would removing every border lose any information?
5. Does the form match the data, or is it a default chart?
