# SUBCRKT — a buck converter as a subcircuit

This folder proves the child-subcircuit feature end to end, with an `.asc`
child sheet.

## What's here

| file | what it is |
| --- | --- |
| `Buck25to5.asc` | The **child sheet**: a 25 V → 5 V buck converter. An ordinary LTspice `.asc`. Its two public pins are the net labels `VIN` and `VOUT`, marked as hierarchy ports (`IOPIN`). |
| `top.sim` | The **parent sheet**: a 25 V source → the buck block → a 1 kΩ load. |
| `DECK.txt` | The SPICE deck Tau generates from the pair, kept as evidence. |

## Try it

1. Open this folder as a project in Tau.
2. Open `top.sim`. The block in the middle is `Buck25to5`, pointing at the
   `.asc` beside it.
3. Press **Run**. `V(out)` settles at **5.00 V**.
4. Double-click the block to open the child sheet and see the converter inside.

## The numbers, and why they are what they are

Measured in ngspice on the deck in `DECK.txt`:

| quantity | value |
| --- | --- |
| **V(out)** | **5.003 V** (target 5.000 V, +0.06 %) |
| output ripple | 6.06 mV pk-pk |
| startup peak | 5.855 V |
| load current | 5.00 mA |

A 1 kΩ load at 5 V draws only 5 mA, which is a very light load for a buck, and
that one fact drives every component value:

- **Duty is 22.14 %, not 20 %.** The textbook `D = Vout/Vin` ignores the catch
  diode's forward drop. The real relation is `D = (Vout+Vf)/(Vin+Vf)` =
  5.7/25.7. At `D = 0.2` this same circuit measures **4.44 V** — an 11 % error.
- **L = 4.7 mH** keeps it in continuous conduction at 5 mA. The ripple current is
  `(Vin−Vout)·ton/L` = 4.7 mA, so the inductor current never reaches zero
  (minimum 2.65 mA). In discontinuous conduction `Vout` would not equal
  `D·Vin` at all.
- **RD + CD is a damping branch**, not decoration. Open-loop at a light load the
  LC filter is very high-Q and the output rings to ~9.5 V on startup. This branch
  pulls that to 5.86 V at **zero** DC cost, because no DC current flows through a
  capacitor.
- **200 kHz over 5 ms** is 1000 switching cycles, which fits the solver's step
  budget.

## Notes

- The parent is `.sim` rather than `.asc` on purpose. LTspice's format cannot
  persist a subcircuit link — it has nowhere to record the child's path, the
  model name, or the pin order — so Tau refuses to write one instead of silently
  dropping it. A `.asc` is a fine **child**; it cannot be the sheet that owns
  the link.
- Inside `Buck25to5.asc`, the switch is stored as a placeholder resistor plus
  `SYMATTR TauKind switch`. Tau restores it exactly; LTspice can still open the
  file rather than choking on an unknown symbol.
- The catch diode's value spells its junction, `D Is=1e-14 N=1`, instead of a
  bare `D`. A bare `D` resolves to Tau's textbook *ideal* junction unless the
  part carries LTspice provenance — and provenance does not survive a `.asc`
  round trip, so the same diode would be real in memory and ideal after a
  reload. That matters here because the ideal junction does not converge in a
  hard-switched converter. (It aborts the same way in a flat circuit with no
  subcircuit at all, so that limitation is unrelated to hierarchy.)

Regenerate with:

```
WRITE_SUBCRKT=1 npx vitest run --root apps/desktop src/schematic/buckSubcircuitFolder.test.ts
```
