# Known issues

Tau v1.0 is usable for real design work; like any engineering tool it has
limitations worth knowing about. Everything here is reproduced and tracked;
fixes land as they are ready.

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

- The preview solver covers R/C/L, sources, diodes/LEDs/zeners, switches,
  op-amps, and controlled sources. Transistors and digital parts need the
  native engine and say so when you press Run.
- Like the native engine, the preview solves the DC operating point before a
  transient (unless the analysis specifies `uic`). If that solve is singular -
  for example an ideal source directly across an ideal inductor - the preview
  warns and starts from zero state instead. The native result is the
  authoritative one.

## Corpus files that do not simulate

- Eight files in the extended 189-schematic acceptance corpus do not produce
  an operating point, and all eight are hierarchical symbol definition sheets
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
  every schematic in the 189-file acceptance corpus fits with room to spare.

## Install

- The preview build is not notarized. macOS Gatekeeper requires a one-time
  Control-click, then Open. See [SHARE.md](SHARE.md).
