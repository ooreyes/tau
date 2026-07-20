# Known issues

Tau v1.0 is usable for real design work; like any engineering tool it has
limitations worth knowing about. Everything here is reproduced and tracked;
fixes land as they are ready.

## Saving imported schematics

- Schematics imported from LTspice that contain op-amps or 3-pin MOSFETs can
  be opened, edited, and simulated, but cannot yet be saved back to `.asc`.
  Tau detects that the round-trip would change terminal connectivity and
  refuses to write the file rather than corrupt it. You will see a clear
  message when this happens. Native `.sim` saves are unaffected.

## Browser preview vs native engine

- The in-browser preview solver starts capacitors and inductors from zero
  state (the same as SPICE `uic`). The native ngspice engine solves the DC
  operating point first, which is the standard SPICE behavior. For circuits
  with reactive parts on DC bias, preview waveforms can differ from a native
  run. The native result is the authoritative one.
- The preview solver covers R/C/L, sources, diodes/LEDs/zeners, switches,
  op-amps, and controlled sources. Transistors and digital parts need the
  native engine and say so when you press Run.

## Native engine limits

- A native simulation is capped at 120 seconds of wall time and its deck at
  512 KiB / 30,000 lines. There is currently no hard memory cap on the
  simulation worker process; ngspice's own output-memory guard is the
  effective bound.

## Import edge cases

- A few PowerSim library sub-blocks use reference designators that collide
  after SPICE name sanitizing (for example `Rb` next to a part named `B`).
  Opening them standalone reports a duplicate instance name. Instantiated
  inside a parent schematic they work normally.

## Install

- The preview build is not notarized. macOS Gatekeeper requires a one-time
  Control-click, then Open. See [SHARE.md](SHARE.md).
