# USB_PSU_WALKTHROUGH — 120 V AC to 5 V USB, as three sheets

A complete power supply built the way you would actually draw one: **one sheet
per job**, wired together on a parent sheet. This is the worked example for
Tau's hierarchical subcircuits.

Every file here is `.sim` — Tau's own format. There is deliberately no `.asc`
in this project.

## The three sheets

| file | what it is | ports |
| --- | --- | --- |
| `Rectifier.sim` | **child** — full-wave bridge + 2200 µF bulk cap + bleeder. Turns AC into a lumpy DC bus. | `SEC1` in, `SEC2` in, `VBUS` out |
| `Buck5V.sim` | **child** — 200 kHz switching buck converter. Steps the bus down to 5 V. | `VIN` in, `VOUT` out |
| `top.sim` | **parent** — the outlet, the transformer, both blocks, the USB load and a power-on LED. | — |
| `DECK.txt` | the SPICE deck Tau generates from all three, kept as evidence. | — |

Open the folder in Tau and open `top.sim`. Press **Run**.

## How subcircuits work in Tau, in four sentences

1. A **child sheet** is an ordinary schematic that publishes an interface: you
   mark some net labels as ports (In / Out / BiDir) and Tau compiles the sheet
   into a SPICE `.subckt`.
2. A **parent sheet** places a *block* — a `subckt` symbol whose value is the
   model name and whose pins are an ordered bank `p1…pN` labelled with the
   child's port names.
3. **Order lives on the parent.** The child says *what* its ports are; the
   parent's pin bank says *in what order*. That is why one child can serve
   several parents.
4. At Run, Tau resolves every link, emits one `.subckt` per child, and wires
   the parent's own nets into it positionally.

The whole binding is one line of the generated deck:

```
X1 n004 n005 vbus Rectifier      <- parent nets  ->  SEC1 SEC2 VBUS
X2 vbus vusb Buck5V              <- parent nets  ->  VIN  VOUT
```

`vbus` is the third node of `X1` **and** the first node of `X2`. One net, two
blocks: that is the rectifier handing its DC bus to the converter.

## What a child sheet may contain

This is a real restriction and worth knowing before you draw:

> A child sheet emits a `.subckt` **body**, so every device in it must map to a
> single ngspice card. Allowed today: ground, resistor, capacitor, polarized
> capacitor, inductor, diode, switch, voltage source, and nested blocks.

That is why the **transformer lives on `top.sim`, not in `Rectifier.sim`**. A
transformer expands to two inductors plus a `K` coupling statement — three
cards — so a child sheet refuses it, by name:

```
T1 (transformer) on "Rectifier.sim" is not yet supported inside a linked sheet.
It expands to several ngspice devices, which a linked sheet's block body does
not generate yet.
```

The LED is on the parent for a different reason: it needs a model library.

## The measured result

Real ngspice, on the deck in this folder, averaged over 50–60 ms so the mains
and the bulk cap have both settled:

| node | value | what it tells you |
| --- | --- | --- |
| `V(VAC_IN)` peak | 170.000 V | 120 V RMS — SPICE sine amplitude is *peak*, and 120 × √2 = 169.7 |
| `V(VBUS)` | **13.4236 V** | rectified and smoothed, with 468.9 mV of 120 Hz ripple |
| `V(VUSB)` | **4.99845 V** | 0.03 % from 5 V, 194.4 mV ripple |
| `I(DON)` | 9.08491 mA | the power-on LED is really conducting |

`RUSB` is 10 Ω, so the supply delivers 499.8 mA — about **2.5 W**, a plausible
USB load.

## Two honest limits

**The buck is open loop.** It runs a fixed 40.8 % duty cycle with no feedback,
so it holds 5 V *only at the load it was tuned for*. A real charger measures its
own output and corrects every cycle. Adding that is the natural next exercise.

**Duty was solved, not calculated.** Theory says
`D = (Vout + Vf) / (Vbus + Vf)`, which lands near 0.404 — but raising duty draws
more bus current, which sags the bus, which lowers the output. The fixed point is
what matters, so the ON time was swept against the real engine until `V(VUSB)`
hit 5 V. It came out at 2.040 µs.

## Recreating it from scratch

See `WALKTHROUGH.html` beside this file for the illustrated version, with
screenshots of every sheet. The short form:

1. **New project folder.** Tau keeps every schematic inside a project folder.
2. **New schematic → `Rectifier.sim`.** Draw the bridge: four diodes in two
   vertical legs between a positive rail and a ground rail. Give each diode the
   value `D Is=1e-14 N=1` — see the warning below. Add `CBUS` 2200 µF from the
   rail to ground, and `RBLEED` 100 kΩ across the two AC inputs.
3. **Mark its ports.** Label the two AC nodes `SEC1`/`SEC2` and the rail
   `VBUS`, then open **Sheet interface** and mark them In, In, Out — in that
   order.
4. **New schematic → `Buck5V.sim`.** Switch, catch diode, 220 µH inductor,
   22 µF output cap, and a voltage source with value
   `PULSE(0 5 0 1n 1n 2.04u 5u)` driving the switch's control pins. Label
   `VIN`/`VOUT` and mark them In/Out.
5. **New schematic → `top.sim`.** Place an AC source `170 60`, `RP` 20 Ω, a
   transformer `10:1 L1=10 k=0.99`, `RS1`/`RS2` 0.5 Ω, then two blocks pointing
   at the two children, then `RUSB` 10 Ω and the LED branch.
6. **Add `.tran 100n 60m`** and press Run.

### Three traps, all of which cost real debugging time

- **Write `D Is=1e-14 N=1` on every rectifier diode.** A palette diode with no
  LTspice provenance compiles to Tau's *ideal* model, and the ideal one will not
  converge when hard-switched — which is all a bridge ever does.
- **Give the transformer `L1=10`.** The default primary is 10 mH, whose
  reactance at 60 Hz is 3.8 Ω: effectively a short across the outlet.
- **Use `k=0.99`, not the 0.999 default.** Perfect coupling plus a floating
  secondary is singular. At 0.999 this exact circuit dies with
  `Timestep too small; trouble with node l2_intern__` at 6.9 µs.

## Regenerating

Never edit these files by hand — Tau's own writer produces them:

```
WRITE_USB_PSU=1 npx vitest run --root apps/desktop src/schematic/usbPsuFolder.test.ts
```

`usbPsuFolder.test.ts` also re-reads this folder from disk on every test run and
recompiles it, so if these files go stale the suite fails.
