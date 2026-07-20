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

## Browser preview vs native engine

- The preview solver covers R/C/L, sources, diodes/LEDs/zeners, switches,
  op-amps, and controlled sources. Transistors and digital parts need the
  native engine and say so when you press Run.
- Like the native engine, the preview solves the DC operating point before a
  transient (unless the analysis specifies `uic`). If that solve is singular -
  for example an ideal source directly across an ideal inductor - the preview
  warns and starts from zero state instead. The native result is the
  authoritative one.

## Native engine limits

- A native simulation is capped at 120 seconds of wall time and its deck at
  512 KiB / 30,000 lines. There is currently no hard memory cap on the
  simulation worker process; ngspice's own output-memory guard is the
  effective bound.

## Install

- The preview build is not notarized. macOS Gatekeeper requires a one-time
  Control-click, then Open. See [SHARE.md](SHARE.md).
