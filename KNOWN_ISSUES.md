# Known issues

Everything here is reproduced and tracked; fixes land as they are ready. The
first section is the one to read before trusting a number.

## Which analyses actually use the native engine

Transient, operating point, AC sweep, DC sweep, transfer function and noise all
run on the embedded ngspice engine, so a noise analysis includes a transistor's
own shot and flicker noise rather than resistor thermal noise alone.

A `.noise` run needs an AC amplitude on its input source (`AC 1`), the same as
LTspice requires: the input-referred figure is the output noise divided by the
gain from that source, so without a stimulus there is nothing to refer it back
to. Tau names this before running rather than returning an empty result.

An `.ac` sweep needs the same stimulus somewhere in the circuit, for the same
reason: a plain DC source is a short at AC, so with no `AC` amplitude anywhere
the circuit is unexcited and every node solves to exactly zero. ngspice reports
that as a successful run, not an error, so Tau checks for the stimulus first and
says what is missing instead of drawing a flat trace at the bottom of the plot.

Outside the desktop app there is no native engine, so noise there falls back to
Tau's own smaller solver, which models R/C/L, sources, diodes, op-amps and
controlled sources but **not transistors** - on those it refuses to run and
says so.

Every result is labelled with the engine that produced it, on the status strip
above the plots - `ngspice` or `Preview solver`. The label follows the analysis
tab you are looking at, so switching tabs re-attributes rather than reporting
one engine for the whole session.

## Devices that are not modelled yet

- Current-controlled (`csw`/`iswitch`) and voltage-controlled (`sw`/`vswitch`)
  switches execute through native ngspice. Tau validates the named sensing
  voltage source, translates LTspice threshold/hysteresis cards, and refuses a
  missing, malformed, or wrong-kind control/model before execution. A browser-
  only preview still cannot stand in for that native proof.
- Tau ships 31 standard device models against LTspice's ~2,500. In the macOS
  desktop app it also reads the exact diode/BJT/MOS/JFET `standard.*` databases
  from the user's installed LTspice copy, ephemerally and read-only. A named
  part unresolved by the document, an attached library, Tau's exact bundle, or
  that installed database now refuses the entire run before ngspice starts.
  Choose a Generic device deliberately for a starter model, or attach the exact
  vendor `.lib` through Model Libraries; Tau never substitutes a generic
  waveform for an explicitly named device.
- A `.include`/`.lib` is read from disk only when the reference is relative,
  stays inside the project folder, and ends in `.lib`, `.sub`, `.subckt`,
  `.mod` or `.inc`; Tau looks beside the schematic first, then in the project's
  `lib` and `lib/sub` folders and its root, then (when available) the user's
  installed LTspice `lib/sub`. Nested `.include`/`.lib`/`.inc` cards inside an
  auto-resolved library are followed through the same confinement and attached
  as peer libraries. An absolute path, one that climbs out of the project, a
  model kept in a `.txt`, or a file past the 5 MB read limit is not opened on
  its own - attach that file through the Model libraries dialog instead. Either
  way the rest of the schematic still simulates and the run names any file it
  could not resolve.
- DIAC/TRIAC instances invoke the document's own `.subckt` definitions;
  voltage-controlled varistors and PHASEDET have LTspice-backed behavioral
  models. NIGBT and encrypted LT1184F remain unsupported and refuse every
  analysis explicitly—Tau does not substitute or drop them.
- `.step` runs every point through 256 members. A larger/nested product is
  rejected before the first solver call, so no partial family is presented.
- Transformer magnetizing and leakage inductance are read from `L1`, `L2` and
  `k` on the part; a bare turns ratio still defaults to 10 mH primary.

## Saving imported schematics

- Imported `.asc` files whose parts come from the standard LTspice symbol
  library - including op-amps (vendor and generic) and 3-pin MOSFETs - save
  back in place with their original symbol identity intact. Attribute label
  placement (WINDOW records, which LTspice writes whenever a label is dragged)
  is carried through the save unchanged, as long as the part keeps its own
  symbol. Drawing primitives (`LINE`, `RECTANGLE`, `CIRCLE`, `ARC`) are drawn on
  the canvas with their pen width and dash style, survive a save byte-for-byte,
  and are framed by fit-to-view along with the circuit, so a sheet border - or a
  sheet that is nothing but a drawing - opens in view. Hierarchy ports (`IOPIN`
  records, which mark the nets a sheet exposes when it is used as a subcircuit
  symbol) survive a save with their direction, attached to the net label they
  name. Tau does not draw a port marker for them and does not yet resolve a
  hierarchy, so such a sheet still opens as a flat circuit - the ports are
  preserved, not acted on. The readouts LTspice paints on a schematic after a
  run (`DATAFLAG` records) survive a save with their expression intact; Tau
  does not evaluate or draw them, so they too are preserved rather than acted
  on. The extra symbol attributes that carry a part's
  parameters (`Value2`, `SpiceLine`, …) go back into the slots they came from,
  so a part whose whole spec lives in them - an op-amp with no `Value` at all -
  reopens as itself rather than with everything collapsed onto `Value`. Tau
  still refuses to overwrite a file when the rewrite would drop information it
  cannot yet reproduce: comment placement, those attributes on a symbol Tau
  would have to rewrite into a different real symbol (so the slots have nowhere
  to land), a joined-value edit that spans more than one original attribute slot
  (a change wholly inside one slot is written back there), and symbols whose pins
  and Tau's do not line up (a 4-pin BJT's substrate, which Tau does not model;
  a 2-pin current-controlled switch, which has nowhere to put the control pair
  Tau draws on every switch). A voltage-controlled switch (`sw`) is not one of
  them any more - it is written back as a `sw` with its four pins. A part saved
  under a placeholder symbol is the exception - it keeps its slots in a Tau-only
  attribute, so they are no longer a reason to refuse the save. Neither is a
  vendor symbol Tau has no equivalent for: its raw `SYMBOL` record, WINDOW
  placements and every SYMATTR are carried through the save verbatim, so the
  part comes back out exactly as it arrived. It still is not simulated, and the
  import warning still says so. A resolved `.asc` hierarchical block also saves
  in place while untouched: Tau keeps the original parent `SYMBOL` and suppresses
  only the exact flattened members used for simulation. Editing or deleting a
  member inside that flattened block stays blocked, because Tau cannot yet write
  the edit back into the child `.asc`; the message names the instance and whether
  its provenance is edited or incomplete.
  Native `.sim` saves are unaffected.

## Importing vendor SPICE models

- A vendor `.model` device card or `.subckt` macromodel attached through the
  Model libraries dialog resolves by name and simulates through the native
  engine. LTspice-only constructs common in vendor files are translated
  automatically: datasheet annotations ngspice rejects (for example
  `mfg=STMicro`), `VSWITCH`/`ISWITCH` switch model cards, parenthesized
  switch control nodes, and the bare `noiseless` device flag (which ngspice
  otherwise rejects as an unknown parameter, aborting the whole deck).
- Tau ships no manufacturer model files and bundles no example that depends on
  one. You attach your own `.lib`/`.subckt`; nothing vendor-specific is
  redistributed with the app.
- LTspice's built-in behavioral code models (for example the `OTA` A-device)
  and its soft-limit helper functions (`uplim`/`dnlim`, common in Analog
  Devices output stages) are not translated yet; a macromodel built from them
  will not simulate and says so at run time.
- If two attached files define the same subcircuit name, the first attached
  file wins; re-attaching a file with the same name replaces it. An attached
  definition that collides with a Tau built-in model name takes precedence -
  attaching a vendor model means you want the vendor's numbers.

## Browser preview vs native engine

- The preview solver covers R/C/L, sources, diodes/LEDs/zeners, op-amps and
  controlled sources. Transistors and digital parts need the native engine and
  say so when you press Run. Switches are accepted but not modelled - see
  "Devices that are not modelled yet" above.
- Like the native engine, the preview solves the DC operating point before a
  transient (unless the analysis specifies `uic`). If that solve is singular -
  for example an ideal source directly across an ideal inductor - the preview
  warns and starts from zero state instead. The native result is the
  authoritative one.
- The preview's operating-point table lists source and inductor currents only.
  Resistor and capacitor currents are reconstructed on the native path, so an
  operating point run without the native engine shows fewer rows.

## Corpus files that do not simulate

**Measured 2026-08-06 on `auto/ltspice-parity` @ `f77b831`. The canonical gate
is currently RED and 13 runnable circuits do not converge.** Reproduce in ~26
seconds with `CORPUS_CANONICAL_ONLY=1 scripts/acceptance-corpus.sh`.

Canonical 82-file corpus: **82 imported / 81 warning-clean / 79 deck-built /
65 op-converged.** Import, warning-clean and deck-built all sit exactly at the
documented honest ceiling; op-converged is 14 below its floor of 79.

Three files are refused at deck build. These are the expected, documented
refusals and are *not* regressions — Tau declines rather than substituting
something it cannot model:

- `Educational/IGBT.asc` — the `misc\nigbt` symbol has no electrical model.
- `Educational/NonLinearTransformer.asc` — an LTspice Chan magnetic core, which
  Tau refuses rather than silently sizing as an unsaturated linear inductor.
- `Educational/Royer.asc` — the encrypted `LT1184F` subcircuit is undefined, so
  the `unresolvedSubckts` guard stops the run before ngspice sees it.

Thirteen files build a valid deck and are then rejected by ngspice at `.op`.
These *are* real failures, in two groups:

- **XSPICE Laplace lowering — `Educational/TwoTau.asc`, `Draft8.asc`.**
  ngspice reports `singular matrix: check node a_e2#branch_1_0` (and
  `a_e1#branch_1_0`). The `s_xfer` lowering emits both the original VCVS and an
  XSPICE `A` block without linking their node names: in `TwoTau` the `A`
  device's input is node `b`, the VCVS's control is node `c`, neither node is
  referenced anywhere else in the deck, and both paths drive `n002`.
  `Educational/PLL.asc` and `PLL2.asc` also use `s_xfer` and do converge, so
  this is specific to the dual-deck Laplace path rather than to `s_xfer`.
- **Operating-point non-convergence — 11 files.** `class-d_starter.asc`,
  `deadtime.asc`, `Draft9.asc`, `Draft10.asc`, `Educational/Electrometer.asc`,
  `Howland.asc`, `LoopGain.asc`, `LoopGain2.asc`, `phono.asc`, `relax.asc`,
  `Wien.asc`. No singular matrix is reported; dynamic gmin stepping, true gmin
  stepping, source stepping and the transient operating point all fail in turn.
  Several of these decks also draw ngspice "Model issue" warnings for
  LTspice-only model parameters (`Iave`/`Vpk` on a `D`, `Vk`/`Alpha` on an
  `NJF`) and LTspice-only model types (`sidiode`, `VDMOS`). Those parameters are
  ignored by ngspice rather than fatal, and have **not** been confirmed as the
  cause — the root cause of this group is still open.

Note when debugging: the corpus reporter truncates the engine error at 320
characters, which hides the actual `singular matrix` / `Error:` lines. To see
the full output, dump the generated deck with `CORPUS_DECK_DIR=<dir>` and pipe
it to `apps/desktop/src-tauri/target/debug/tau --tau-spice-worker` as
`{"request":{"netlist":"..."},"libraryCandidates":["<path to libngspice.dylib>"]}`.

In the extended acceptance corpus (189 schematics when the full third-party
power-electronics tree is present), a further eight files produce no operating
point, and all eight are hierarchical symbol definition sheets (gate-driver,
AC-source, and monitor building blocks from a third-party power-electronics
library), not runnable circuits. Seven have no ground node by design and Tau
refuses their deck with "Add a ground symbol so node voltages have a
reference"; one (a current-monitor block) yields a singular matrix that its own
file comment predicts for small shunt values.

## Native engine limits

- A native simulation is capped at 120 seconds of wall time and its deck at
  512 KiB / 30,000 lines. There is currently no hard memory cap on the
  simulation worker process; ngspice's own output-memory guard is the
  effective bound.
- A document is capped at 5,000 components and 20,000 wires. An `.asc` that
  exceeds this is refused at import with a message naming the actual counts;
  every schematic in the acceptance corpus fits with room to spare.
- A part's own current reads as `I(Q1)` / `I(M1)`: a BJT's collector current, a
  three-terminal device's drain current. Naming that terminal explicitly reads
  the same current, so `Ic(Q1)` and `Id(M1)` work as well as the bare form. A
  BJT also reports its base and emitter
  as `Ib(Q1)` and `Ie(Q1)`, and a MOSFET its gate and source as `Ig(M1)` and
  `Is(M1)`, in a native transient - where plot expressions, `.meas` and the FFT
  picker all resolve them - and as their own rows in the operating-point table.
  These are ngspice's own values - the current INTO each terminal, so `Ie(Q1)`
  and `Is(M1)` read negative for a part carrying current, and they sum to zero
  with the part's own. A MOSFET's BULK current is not reported: a model with no
  bulk terminal, which is what an LTspice power MOSFET (VDMOS) is, has no such
  value, and ngspice answers a request for one with an empty result rather than
  an error. A diode or JFET still reports one current; its other terminals
  have no trace of their own. On the schematic itself, the in-place operating-
  point annotation shows one current per part - the part's own - because the
  per-terminal figures would all anchor to the same component position.
  Currents are reported in native transient, AC, and operating-point results.
  Native AC includes complex source/inductor and semiconductor phasors and
  reconstructs R/C phasors from the node voltages, so `I(L1)` and `.meas ac`
  current expressions work. Native `.op` also lists device bias voltages,
  gm/conductance, and an explicit operating region. ngspice returns a current
  of its own for sources, inductors and semiconductors; a resistor's and a
  capacitor's are reconstructed from the node voltages either side of them.

## Install

- The preview build is not notarized. macOS Gatekeeper requires a one-time
  Control-click, then Open. See [SHARE.md](SHARE.md).
