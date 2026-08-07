# Anti-patterns

Each of these has a specific cost. They are listed with the damage they do,
because knowing *why* something is wrong generalises better than a ban list.

## Colour

**A raw hex outside `:root`.** Breaks `scripts/design-system-drift.sh`, and
breaks light mode silently — a value tuned against black becomes invisible or
garish on white. Add a token, defined in both themes.

**Resaturating the palette.** The traces are Okabe-Ito snapped into the
surface's OKLCH lightness band, and the choice is verifiable: the previous
hand-tuned set put sage green and steel cyan at ΔE 11.6 for *normal* vision
against a floor of 15. "Make the colours pop" undoes a measurement.

**Reordering `TRACE_COLORS`.** The rotation is load-bearing. Olive after green
fails the normal-vision floor; vermillion beside olive collapses under
deuteranopia. The suite will fail, correctly. Run
`node scripts/validate-palette.mjs` before touching a value or the order.

**Turning `--accent` into a brand colour.** It is deliberately a neutral warm
graphite so chrome does not compete with measured data for colour attention.
A blue accent makes every button shout as loudly as a voltage trace.

**Colour as the only signal.** Fails colour-blind readers and anyone who has
not learned the convention. Pair colour with a letter, word, shape, or label —
`V ±157 mV`, lamp plus `COMPLETE`.

**Colouring the unmeasured.** A wire with no probe, a component with no result,
a panel with no state: neutral. Colour arriving *with data* is what makes it
informative.

## Form

**A gauge on an unbounded quantity.** An arc's end implies a maximum. Voltage,
current, impedance, and frequency have none, so the gauge invents one and the
reader believes it. Use a value block or a range bar.

**A line chart of a digital signal.** Implies intermediate values that never
existed. Use a dot matrix or a step plot.

**A chart of a single number.** Decoration. Use a value block.

**A wall of arcs.** The single clearest tell of a generic dashboard. One per
view at most.

**Silent clamping.** A value pegged outside its range drawn as if it were
in-range is the most dangerous item on this page. Clamp the drawing, mark the
overflow.

## Layout

**A box around everything.** Borders around already-grouped content add ink
without information. Space first; a hairline only when two things would
otherwise merge.

**Inconsistent spacing.** Density fails because gutters are arbitrary, not
because they are tight. Use the `--sp-*` steps.

**Loosening density toward web padding.** `--row-h: 28px` and `--fs-body: 11px`
are correct for a desktop instrument. Airy padding costs rows of data the
engineer wants on screen.

**Chrome competing with the canvas.** The circuit or waveform is the subject.
Collapse panels before compressing it.

**Readouts placed at a fixed offset.** They land on symbols and on other
labels. Tau has `buildOpAnnotationPlacements` for exactly this — it scores
candidates against symbols, wires and existing text. A hardcoded `y + 30` is
how a resistor's current ended up printed across its own value.

**A large empty panel.** An always-visible surface with nothing in it occupies
prime space and trains the eye to ignore that region. Make it contextual or
collapsible.

## Type

**A label competing with its value.** If they are within one step of the scale
the hierarchy has collapsed and the module reads as a form field. Two steps
apart: value at `--fs-heading`/`--fs-display`, label at `--fs-micro`/
`--fs-caption`.

**Proportional figures on numbers.** Digits change width, so a live value
jitters its neighbours. `--font-mono`, always, for engineering values.

**A number without its unit.** `2.5` is not a measurement.

**False precision.** Six digits from a solver that justifies three is a claim
the engine did not make. `formatEngineering` defaults to three significant
figures for that reason.

**A hardcoded font size.** `font-size: 10px` outside the `--fs-*` scale is
drift, and it is common in canvas label CSS. Use the scale.

## Motion

**Anything that loops.** A pulsing lamp or animated readout competes with data
and makes a stable system look unstable.

**Animating a value that is not changing.** On a measured number this actively
misleads — it was the original complaint that produced the settled-reading
work. A `.tran` result is static; render it statically.

**Ignoring `prefers-reduced-motion`.** Accessibility, and some engineers simply
turn it off to concentrate.

## Process

**Designing without looking.** Run the app or use
`node scripts/design-shot.mjs`. A change that was never viewed is not done.

**Changing one site instead of the token.** The second occurrence is where the
themes diverge.

**Skipping the gates.** `pnpm -C apps/desktop typecheck`,
`pnpm -C apps/desktop test`, `bash scripts/design-system-drift.sh`. The drift
script needs `ripgrep`; without it several checks report a false FAIL, so
install `rg` rather than assuming the gate is broken.
