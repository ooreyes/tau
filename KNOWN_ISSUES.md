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

- **Current-controlled switches (`csw`) do not switch.** A `csw` is controlled
  by the current through a named source rather than by pins, which Tau does not
  model, so it simulates as a fixed open circuit - and says so with the result
  instead of returning a confident wrong waveform. Voltage-controlled switches
  (`sw`) do switch: they import with their NC+/NC- control pins and simulate as
  a real ngspice `S` device against the schematic's own `.model`.
- Tau ships 28 standard device models against LTspice's ~2,500. A part whose
  model name Tau cannot resolve is simulated on a generic starter device
  (`Level=1` MOSFET, textbook BJT/diode) and **says so before the run** - the
  warning names the part and the model it could not find. Attach the vendor
  `.lib` through the Model libraries dialog to get the real device.
- A `.include`/`.lib` is read from disk only when the reference is relative,
  stays inside the project folder, and ends in `.lib`, `.sub`, `.subckt`,
  `.mod` or `.inc`; Tau looks beside the schematic first, then in the project's
  `lib` and `lib/sub` folders and its root. An absolute path, one that climbs
  out of the project, a model kept in a `.txt`, or a file past the 5 MB read
  limit is not opened on its own - attach that file through the Model libraries
  dialog instead. Either way the rest of the schematic still simulates and the
  run names any file it could not resolve.
- TRIACs import as a BJT; DIACs and varistors as high-value resistors.
- `.step` runs at most 16 points. A wider sweep warns that it was truncated
  rather than plotting a short curve as if it were complete.
- Transformer magnetizing and leakage inductance are read from `L1`, `L2` and
  `k` on the part; a bare turns ratio still defaults to 10 mH primary.

## Saving imported schematics

- Imported `.asc` files whose parts come from the standard LTspice symbol
  library - including op-amps (vendor and generic) and 3-pin MOSFETs - save
  back in place with their original symbol identity intact. Attribute label
  placement (WINDOW records, which LTspice writes whenever a label is dragged)
  is carried through the save unchanged, as long as the part keeps its own
  symbol. Drawing primitives (`LINE`, `RECTANGLE`, `CIRCLE`, `ARC`) survive a
  save byte-for-byte, though Tau's canvas does not draw them yet - they are
  preserved, not displayed. Tau still refuses to overwrite a file when the
  rewrite would drop information it cannot yet reproduce: comment placement,
  extra symbol attributes such as SpiceLine, and symbols with pins Tau does not
  model (4-pin BJT substrate, switch control pins). The message names the
  specific reason. Native `.sim` saves are unaffected.

## Importing vendor SPICE models

- A vendor `.model` device card or `.subckt` macromodel attached through the
  Model libraries dialog resolves by name and simulates through the native
  engine. LTspice-only constructs common in vendor files are translated
  automatically: datasheet annotations ngspice rejects (for example
  `mfg=STMicro`), `VSWITCH`/`ISWITCH` switch model cards, parenthesized
  switch control nodes, and the bare `noiseless` device flag (which ngspice
  otherwise rejects as an unknown parameter, aborting the whole deck). The
  shipped AD8541 example runs a real Analog Devices macromodel end to end.
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

## Corpus files that do not simulate

- In the extended acceptance corpus (189 schematics when the full third-party
  power-electronics tree is present), eight files do not produce an operating
  point, and all eight are hierarchical symbol definition sheets
  (gate-driver, AC-source, and monitor building blocks from a third-party
  power-electronics library), not runnable circuits. Seven have no ground
  node by design and Tau refuses their deck with "Add a ground symbol so node
  voltages have a reference"; one (a current-monitor block) yields a singular
  matrix that its own file comment predicts for small shunt values. Every
  runnable circuit in the corpus converges.

## Native engine limits

- A native simulation is capped at 120 seconds of wall time and its deck at
  512 KiB / 30,000 lines. There is currently no hard memory cap on the
  simulation worker process; ngspice's own output-memory guard is the
  effective bound.
- A document is capped at 5,000 components and 20,000 wires. An `.asc` that
  exceeds this is refused at import with a message naming the actual counts;
  every schematic in the acceptance corpus fits with room to spare.
- In a native transient run, current is available for sources, inductors,
  resistors and capacitors, but **not for semiconductors**. ngspice returns a
  branch current only for sources and inductors; resistor and capacitor
  currents are derived from the node voltages. A transistor's or diode's own
  current has no trace - it is left blank rather than estimated.

## Install

- The preview build is not notarized. macOS Gatekeeper requires a one-time
  Control-click, then Open. See [SHARE.md](SHARE.md).
