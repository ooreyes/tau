# Applying the language to Tau's surfaces

Concrete proposals, mapped to real screens. Each names the surface, what it
does today, the reference module that fits, and what changes. These are
starting points for a designer agent, not a locked backlog — but they are the
places where the gap between Tau today and the reference plates is widest.

Ordered by payoff.

---

## 1. Component measurement cards → engineering modules

**Today.** The bottom Measurements panel renders one card per component, each a
vertical list of `LABEL  value` rows: `VOLTAGE RMS 3.54 V`, `CURRENT FINAL
−207 fA`, `POWER FINAL 0 W`. Four components produce four near-identical cards.
Label and value are close in size, every card is boxed, and nothing indicates
which numbers matter.

**Reference.** Plate 5's value blocks; plate 2's forecast grid.

**Change.**
- One primary value per component at `--fs-heading`, the rest demoted to
  `--fs-caption` secondary rows. A resistor's story is its current; a source's
  is its voltage. Pick the primary by component kind rather than showing three
  co-equal numbers.
- Drop the card borders. Components separate by `--sp-4` and a hairline only
  where two would otherwise merge.
- Attach the unit to the value and subordinate it, rather than putting it in
  the row label.
- `−207 fA` is a solver zero. Render true zeros as `--faint` `—` so the eye
  skips them; three digits of femtoamp noise reads as a measurement and is not.
- Consider the column-per-component grid from plate 2's forecast module: parts
  across, quantities down, one scan instead of four card reads.

---

## 2. Waveform cards → instrument plots

**Today.** Each trace gets a bordered card: a `VOLTAGE (V)` axis caption, the
plot, a zoom-button cluster, then a separate chip row and a separate
measurements list (`RMS / PEAK-TO-PEAK / FREQUENCY`).

**Reference.** Plate 4's heart-rate zone and power-curve modules — the closest
analogue in the whole set.

**Change.**
- Put two or three values **on the y-axis** with the cursor value bolded in
  place, rather than repeating them in a list below. Plate 4's `310 / 261 / 210`
  is the model.
- Move `RMS` / `PEAK-TO-PEAK` / `FREQUENCY` onto one `--fs-micro` strip under
  the plot instead of a stacked list. They are context, not headline.
- Relative time axis where absolute time is meaningless.
- Reduce the card border to a background shift; separate plots by space.
- Trace colour comes from `--trace-*` and must match the schematic probe that
  produced it — see §5.

---

## 3. Zone bands on plots — the biggest single win

**Today.** Traces are drawn bare. The reader must know from memory whether
2.7 V is acceptable at that node.

**Reference.** Plate 4's heart-rate zones.

**Change.** Shade the regions that make a trace judgeable, using the `*-soft`
tokens at low alpha with an inline `--fs-micro` label:
- supply rails and ground on a voltage plot
- saturation / linear / cutoff on a transistor's operating point
- a `.meas` spec limit
- the noise floor on a noise plot
- absolute-maximum ratings from an imported model, where known

This converts every waveform from "a shape" into "a shape you can judge",
which is the entire difference between a chart and an instrument.

---

## 4. Schematic readouts

**Today.** Already close after recent work: `V ±157 mV` / `I ±978 µA` in
`--trace-cyan` / `--trace-green`, collision-placed, quantity-prefixed.

**Change.**
- Subordinate the unit — `--fs-caption`/`--muted` against a `--fs-body` value —
  so a dense schematic reads as numbers first.
- `~settling` should be a status word in `--signal`, not the same colour as the
  value. It is a caveat about the number, not part of it.
- Consider a `--fs-micro` `NOW` tick on the canvas when Live playback is
  running, so the animated flow dots have a stated reference. Do not animate
  the numbers; that was the original complaint.

---

## 5. Probe-to-trace identity

**Today.** A probe on the schematic and its trace in the scope are separate
objects that happen to share a colour.

**Reference.** The plates consistently colour a value the same as the series it
came from, and never reuse a hue for two meanings on one screen.

**Change.** One `--trace-*` slot per probe, assigned at probe creation in the
validated rotation order, and used everywhere that signal appears: the probe
dot, the trace, the trace chip, the measurement value, the schematic readout.
Selecting either end highlights the other. This is a correctness feature as
much as a visual one — it is how the reader knows which number belongs to
which node.

---

## 6. Status strip and run state

**Today.** `COMPLETE 2 ms · 20001 samples · 4 nets · 5 parts · 179 ms elapsed`,
plus a `Linear preview` badge.

**Reference.** Plate 5's `GOOD`, plate 2's `AQI 42 GOOD` and `↗ RISING`.

**Change.**
- Lamp plus word: a `--success` dot with `COMPLETE`, `--signal` with `RUNNING`,
  `--danger` with `FAILED`. Colour alone must never carry it.
- The engine badge is the most important token on the strip — it says whether
  these numbers came from ngspice or the preview solver. Give it the weight of
  a status word, not a muted chip.
- Demote the run statistics to `--fs-micro`/`--muted`. They are provenance, not
  results.

---

## 7. Step-sweep results

**Today.** A `.step` family produces N runs with little at-a-glance structure.

**Reference.** Plate 2's streak blocks (discrete completion) and sleep strip
(state over time).

**Change.** A row of blocks, one per step, `--success` converged /
`--danger` failed / `--panel-2` not run, with the swept value beneath at
`--fs-micro`. Click a block to load that member. A 64-run sweep becomes one
scannable line instead of a list.

---

## 8. Operating-point table

**Today.** A dense table of node voltages and branch currents.

**Change.** Keep the table — it is the right form for many exact values — but
align the numeric column on the decimal with `--font-mono`, and mark rows that
sit outside an expected band rather than making the reader compare every line
by eye. Region classification (`SAT`, `LIN`, `CUTOFF`) already exists in the
native `.op` result and belongs here as a status word.

---

## 9. Convergence and diagnostics

**Today.** Failures surface as engine text.

**Reference.** Plate 2's pressure module (`↗ RISING` with a trend), plate 4's
elevation profile.

**Change.** When gmin or source stepping runs, show the residual as a sparkline
with a `NOW` marker — a converging curve and a stalled one look completely
different, and that distinction is currently invisible. Pair with a trend word.

---

## What not to do here

- Do not add an arc gauge to any of the above. Voltage, current, impedance and
  frequency are unbounded; an arc would invent a maximum. Duty cycle and
  thermal-versus-rating are the only plausible candidates in the whole app.
- Do not colour a component or wire that carries no measurement.
- Do not animate a settled value.
- Do not add a border to fix a grouping problem that spacing solves.
