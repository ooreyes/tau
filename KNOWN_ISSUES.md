# Known issues

Everything here is reproduced and tracked; fixes land as they are ready. The
first section is the one to read before trusting a number.

## Which analyses actually use the native engine

Transient, operating point and AC run on the embedded ngspice engine.

**DC sweep, noise and transfer function do not.** They run on Tau's own
smaller solver, which models R/C/L, sources, diodes, op-amps and controlled
sources but **not transistors**. So a MOSFET or BJT DC sweep - an Id-Vds
curve, a Vgs transfer curve, a bias sweep - refuses to run and says so. This
is the largest gap between Tau and LTspice today.

Nothing in the UI currently labels which engine produced a given result.

## Devices that are not modelled yet

- **Voltage-controlled switches do not switch.** A `sw` part imports without
  its two control pins and simulates as a permanent open circuit. Any SMPS,
  relay or ideal-switch circuit built around one will produce a confident,
  wrong waveform. Do not rely on a switching converter result.
- Tau ships 28 standard device models against LTspice's ~2,500. A part whose
  model name Tau cannot resolve is simulated on a generic starter device
  (`Level=1` MOSFET, textbook BJT/diode) and **says so before the run** - the
  warning names the part and the model it could not find. Attach the vendor
  `.lib` through the Model libraries dialog to get the real device.
- TRIACs import as a BJT; DIACs and varistors as high-value resistors.
- `.step` runs at most 16 points. A wider sweep warns that it was truncated
  rather than plotting a short curve as if it were complete.
- Transformer magnetizing and leakage inductance are read from `L1`, `L2` and
  `k` on the part; a bare turns ratio still defaults to 10 mH primary.

## Saving imported schematics

- Imported `.asc` files whose parts come from the standard LTspice symbol
  library - including op-amps (vendor and generic) and 3-pin MOSFETs - save
  back in place with their original symbol identity intact. Tau still refuses
  to overwrite a file when the rewrite would drop information it cannot yet
  reproduce: custom symbol-label placement (WINDOW records), drawing
  primitives, comment placement, extra symbol attributes such as SpiceLine,
  and symbols with pins Tau does not model (4-pin BJT substrate, switch
  control pins). The message names the specific reason. Native `.sim` saves
  are unaffected.

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

## Install

- The preview build is not notarized. macOS Gatekeeper requires a one-time
  Control-click, then Open. See [SHARE.md](SHARE.md).
