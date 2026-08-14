/**
 * The 25 V -> 5 V buck used as a project-linked child sheet.
 *
 * This lives in ONE place because two things consume it and they must not
 * diverge: the gate that proves the circuit compiles and simulates
 * (`buckSubcircuitProof.test.ts`), and the generator that writes the SUBCRKT
 * folder a human opens (`buckSubcircuitFolder.test.ts`). If the shipped files
 * were built from a second copy of these numbers, the folder could drift away
 * from the circuit under test and still look fine.
 *
 * DESIGN NOTES - why these values, since none of them are arbitrary:
 *
 * A 1 k load at 5 V draws only 5 mA, which is a very light load for a buck, and
 * that single fact drives everything else.
 *
 *  - Duty is 0.2214, NOT 5/25 = 0.2. It compensates the real catch-diode drop:
 *    D = (Vout + Vf) / (Vin + Vf) = 5.7 / 25.7. At D = 0.2 the same circuit
 *    measures 4.44 V - an 11 % error - so this is load-bearing, not polish.
 *  - L = 4.7 mH keeps the converter in continuous conduction at 5 mA:
 *    dIL = (Vin - Vout) * ton / L = 20 V * 1.107 us / 4.7 mH = 4.7 mA, so
 *    IL(min) = 5 - 2.35 = 2.65 mA > 0. In DCM, Vout would not equal D * Vin at
 *    all and the whole demonstration would be wrong.
 *  - Rd + Cd is a damping branch across the output, not decoration. Open loop at
 *    a light load the LC is very high-Q and the output rings to ~9.5 V on
 *    startup. The branch pulls that to 5.86 V at ZERO DC cost, because no DC
 *    current flows through a capacitor. Plain Cout ESR damping was rejected: it
 *    reduces the peak just as well but adds dIL * ESR of switching ripple.
 *  - 200 kHz over 5 ms is 1000 switching cycles, which fits inside the TS
 *    solver's MAX_TRANSIENT_STEPS budget. 500 kHz did not.
 *
 * Measured in real ngspice, on the deck Tau itself generates from these sheets:
 * V(out) = 5.00316 V, 6.06 mV ripple, 5.855 V startup peak, 5.00 mA load.
 */
import type { NetLabel, SchematicComponent, SchematicWire } from "./types";

/** Switching period and on-time, in seconds. */
export const PERIOD_S = 5e-6;
export const ON_TIME_S = 1.107e-6;
export const PWM_VALUE = `PULSE(0 5 0 1n 1n ${ON_TIME_S * 1e6}u ${PERIOD_S * 1e6}u)`;

/** Everything the compiler and the exporter need from a sheet. */
export interface FixtureSheet {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  directives?: string[];
}

/** Terse component builder, exported so other fixtures share one spelling. */
export const part = (
  id: string,
  kind: SchematicComponent["kind"],
  x: number,
  y: number,
  value: string,
  label: string,
  rotation: 0 | 90 | 180 | 270 = 0,
): SchematicComponent => ({ id, kind, x, y, rotation, value, label }) as SchematicComponent;

/** Polyline wire from explicit points. */
export const wire = (id: string, ...points: [number, number][]): SchematicWire => ({
  id,
  points: points.map(([x, y]) => ({ x, y })),
});

/**
 * The child sheet, laid out as a left-to-right power path so a human opening it
 * reads VIN -> switch -> SW node -> inductor -> VOUT, with the returns dropping
 * to ground symbols underneath.
 */
export function buckChildSheet(): FixtureSheet {
  const components: SchematicComponent[] = [
    // Power path. Tau's two-terminal parts are horizontal at rotation 0.
    part("s1", "switch", 256, 128, "TAU_SW", "S1"),
    part("l1", "inductor", 384, 128, "4.7m", "L1"),
    // Catch diode: rotation 270 maps (x,y)->(y,-x), which puts K above and A
    // below, so the arrow points up out of ground into the SW node.
    //
    // The value spells the junction explicitly rather than relying on a bare
    // `D`. A bare `D` resolves to Tau's textbook IDEAL junction unless the part
    // carries LTspice provenance - and provenance does NOT survive a `.asc`
    // round trip, because the exporter writes TauKind/TauValue and the importer
    // restores a native part with no `ltSymbolType`. So the same diode was real
    // in memory and ideal on reload, and the ideal one does not converge in a
    // hard-switched converter. Spelling Is=/N= makes it deterministic either way.
    part("d1", "diode", 320, 192, "D Is=1e-14 N=1", "D1", 270),
    // Gate drive. A source is vertical at rotation 0 (p above, n below).
    part("vpwm", "vsource", 176, 208, PWM_VALUE, "VPWM"),
    // Output filter capacitor, and the Rd+Cd damping branch beside it.
    part("c1", "capacitor", 480, 192, "0.5u", "C1", 90),
    part("rd", "resistor", 576, 176, "100", "RD", 90),
    part("cd", "capacitor", 576, 272, "10u", "CD", 90),
    // Ground symbols, one under each return.
    part("g1", "ground", 320, 256, "", ""),
    part("g2", "ground", 176, 272, "", ""),
    part("g3", "ground", 272, 256, "", ""),
    part("g4", "ground", 480, 256, "", ""),
    part("g5", "ground", 576, 336, "", ""),
  ];
  const wires: SchematicWire[] = [
    // VIN into the switch.
    wire("w-vin", [192, 128], [224, 128]),
    // SW node, split at x=320 so the diode's wire meets a real endpoint instead
    // of forming a mid-segment T junction.
    wire("w-sw-a", [288, 128], [320, 128]),
    wire("w-sw-b", [320, 128], [352, 128]),
    wire("w-d-k", [320, 160], [320, 128]),
    wire("w-d-a", [320, 224], [320, 256]),
    // Gate drive up and across to the switch's NC+ control pin.
    wire("w-gate", [176, 176], [176, 160], [240, 160]),
    wire("w-pwm-gnd", [176, 240], [176, 272]),
    // The switch's NC- control pin returns to ground.
    wire("w-nc-gnd", [272, 160], [272, 256]),
    // Inductor out to VOUT, split so the filter taps meet endpoints.
    wire("w-vout-a", [416, 128], [480, 128]),
    wire("w-vout-b", [480, 128], [576, 128]),
    wire("w-c1-top", [480, 128], [480, 160]),
    wire("w-c1-gnd", [480, 224], [480, 256]),
    wire("w-rd-top", [576, 128], [576, 144]),
    wire("w-rd-cd", [576, 208], [576, 240]),
    wire("w-cd-gnd", [576, 304], [576, 336]),
  ];
  // The two public ports. `port` is what serialises to an LTspice IOPIN, and is
  // the ONLY way a `.asc` can declare an interface.
  const netLabels: NetLabel[] = [
    { id: "n-vin", x: 192, y: 128, text: "VIN", port: "In" },
    { id: "n-vout", x: 480, y: 128, text: "VOUT", port: "Out" },
  ];
  return { components, wires, netLabels };
}

/**
 * The parent sheet: 25 V in, the block, a 1 k load.
 *
 * `childPath` is a parameter so a test can re-run the identical circuit under a
 * different extension. Real callers use the default.
 */
export function topSheet(childPath = "Buck25to5.asc"): FixtureSheet {
  const components: SchematicComponent[] = [
    part("v1", "vsource", 128, 208, "25", "V1"),
    part("rload", "resistor", 512, 208, "1k", "RLOAD", 90),
    part("gv", "ground", 128, 288, "", ""),
    part("gr", "ground", 512, 288, "", ""),
    {
      ...part("x1", "subckt", 320, 176, "Buck25to5", "X1"),
      // The ordered p1..pN bank the block contract requires. The ORDER lives
      // here, on the parent, which is why the child needs no ordering field -
      // and why a `.asc` child works at all.
      pinOverride: [
        { id: "p1", label: "VIN", x: 272, y: 176 },
        { id: "p2", label: "VOUT", x: 368, y: 176 },
      ],
      projectSubcircuit: {
        sheetPath: childPath,
        model: "Buck25to5",
        ports: ["VIN", "VOUT"],
      },
    } as SchematicComponent,
  ];
  const wires: SchematicWire[] = [
    wire("t-in", [128, 176], [272, 176]),
    wire("t-out-a", [368, 176], [440, 176]),
    wire("t-out-b", [440, 176], [512, 176]),
    wire("t-v-gnd", [128, 240], [128, 288]),
    wire("t-r-gnd", [512, 240], [512, 288]),
  ];
  const netLabels: NetLabel[] = [{ id: "t-out", x: 440, y: 176, text: "OUT" }];
  return { components, wires, netLabels, directives: [".tran 20n 5m"] };
}
