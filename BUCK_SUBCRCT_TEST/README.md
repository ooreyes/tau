# BUCK_SUBCRCT_TEST — a 25 V → 5 V buck block lighting a red LED

This folder proves Tau's hierarchical (child-sheet) subcircuit feature end to
end: **the nets really cross the block boundary.**

## What's here

| file | what it is |
| --- | --- |
| `Buck25to5.asc` | The **child sheet** — a 25 V → 5 V buck converter, as an ordinary LTspice `.asc`. Its two public pins are the net labels `VIN` and `VOUT`, marked as hierarchy ports (`IOPIN`). |
| `top.sim` | The **parent sheet** — 25 V source → the block → 330 Ω → red LED → ground. |
| `DECK.txt` | The SPICE deck Tau generates from the pair, kept as evidence. Runnable: `ngspice -b -r out.raw DECK.txt`. |

The child is byte-identical to the one in `SUBCRKT/`. That is the point: one
child sheet, two different parents, no edits to the child.

## Try it

1. Open this folder as a project in Tau.
2. Open `top.sim`. The block in the middle is `Buck25to5`, pointing at the
   `.asc` beside it.
3. Press **Run**.
4. Double-click the block to open the child sheet and see the converter inside.

## How to see the nets passing

The claim is that `VIN`/`VOUT` on the child are the *same electrical nodes* as
`VIN25`/`OUT` on the parent. Three independent ways to see it:

**On the parent sheet.** The block's left pin is labelled `VIN`, its right pin
`VOUT`, and the wires running into them carry the parent's own labels `VIN25`
and `OUT`. The sheet-interface indicator reports the pinout in order.

**In the generated deck** (`DECK.txt`):

```
.subckt Buck25to5 VIN VOUT     <- the child declares its interface
...
.ends Buck25to5
V1 vin25 0 DC 25               <- parent's 25 V rail
X1 vin25 out Buck25to5         <- vin25 -> VIN, out -> VOUT
R1 out led_a 330               <- the LED taps the block's output net
```

`X1` is the seam. `vin25` and `out` are the *parent's* nets; `VIN` and `VOUT`
are the *child's* ports. One line binds them, positionally, in the order the
parent's `p1…pN` pin bank fixes.

**In measurement.** Measured in real ngspice on this deck, averaged over 4–5 ms
(after the startup transient):

| node | value | why it matters |
| --- | --- | --- |
| `V(vin25)` | 25.000 V | what goes into the block |
| `V(out)` | **4.99125 V** | what comes out — 0.18 % from 5 V |
| `V(led_a)` | 2.00043 V | the red LED's forward drop |
| `I(D1)` | **9.06311 mA** | the LED is actually conducting |

Ripple is 6.81 mV pk-pk; the open-loop output overshoots to 5.31621 V at 198 µs
on startup before settling.

A voltage could in principle appear on a floating node. **9 mA flowing through a
diode cannot** — that current is generated inside the child, leaves through
`VOUT`, and returns through the parent's ground. That is the proof.

## Why 4.99 V and not exactly 5.00 V

The converter is **open loop** — a fixed duty cycle, no feedback. Duty is
0.2214, which compensates the catch diode's drop:
`D = (Vout + Vf) / (Vin + Vf) = 5.7 / 25.7`. At a plain `D = 5/25 = 0.2` the same
circuit measures 4.44 V, an 11 % error, so that compensation is load-bearing.

The remaining 0.18 % is real physics, not a bug: this sheet's LED draws ~9 mA
where the `SUBCRKT/` sheet's 1 k load draws 5 mA, and the catch diode's forward
drop grows with the current it freewheels. The duty is not retuned for it,
because the child sheet is shared with the 1 k parent and one file cannot hold
two duties. A closed-loop design would trim this out; showing it is more honest
than hiding it.

## Regenerating

Never edit these files by hand — they are written by Tau's own exporters:

```
WRITE_BUCK_LED=1 npx vitest run --root apps/desktop src/schematic/buckLedFolder.test.ts
```

`buckLedFolder.test.ts` also re-reads this folder from disk on every test run
and recompiles it, so if the files here go stale the suite fails.
