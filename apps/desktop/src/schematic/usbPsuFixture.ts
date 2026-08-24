/**
 * 120 V AC mains -> 5 V USB, built as a CHAIN of two project-linked child
 * sheets. This is the worked example the walkthrough teaches from.
 *
 * Why two children rather than one: a single sheet holding mains, a transformer,
 * a bridge and a switching converter is the exact drawing a beginner cannot
 * read. Split at the one place the signal changes character - AC becomes DC -
 * and each sheet answers one question. The parent then reads as a sentence:
 * mains -> rectify -> step down -> USB.
 *
 * EVERY sheet here is `.sim`, deliberately. Tau can link a `.asc` child, but
 * mixing formats in one project means two file types that look
 * interchangeable and are not: only `.sim` can carry `projectPorts`, so only
 * `.sim` can state its own interface explicitly. One format, one rule.
 *
 * DESIGN NOTES - none of these numbers are arbitrary.
 *
 * Mains and the transformer:
 *  - `SIN(0 170 60)` is 120 V RMS at 60 Hz. SPICE sine amplitude is PEAK, and
 *    120 * sqrt(2) = 169.7, so writing `120` here would model an 85 V outlet.
 *  - The transformer needs `L1=10` (10 H). Tau's default primary is 10 mH, whose
 *    reactance at 60 Hz is only 3.8 ohm - a dead short across the outlet. At
 *    10 H it is 3.8 kohm, so magnetizing current is a realistic ~32 mA.
 *  - `k=0.99`, not the 0.999 default. Ideal coupling plus a floating secondary
 *    is what makes this circuit fail: at k=0.999 ngspice dies with "Timestep too
 *    small; trouble with node l2_intern__" at 6.9 us. Verified, not guessed.
 *  - RP/RS1/RS2 are winding resistance, not padding. A real transformer has
 *    copper loss, and here it is also what damps the secondary enough to solve.
 *  - RBLEED gives the secondary a DC path to reference. With all four bridge
 *    diodes off at t=0 the secondary is a floating island; 100 kohm costs
 *    0.15 mW and removes the singularity.
 *
 * The bridge:
 *  - Each diode spells `D Is=1e-14 N=1` so it compiles to a real Shockley
 *    junction. A palette diode with no LTspice provenance compiles to Tau's
 *    IDEAL model, and the ideal one does not converge when hard-switched - which
 *    is exactly what a bridge does 120 times a second.
 *  - CBUS = 2200 uF. Ripple is I * t / C = 0.51 A * 8.33 ms / 2200 uF = 1.9 V of
 *    droop budget; measured 0.46 V because conduction refills it well before the
 *    next peak.
 *
 * The buck:
 *  - 200 kHz, ON time 2.040 us, so duty = 0.408. NOT (5+0.7)/(13.4+0.7) = 0.404
 *    from theory: duty was SOLVED against the real engine, because raising duty
 *    draws more bus current, which sags the bus, which lowers the output. The
 *    fixed point is what matters and theory only gets near it.
 *  - L = 220 uH keeps continuous conduction at the 0.5 A load: dIL =
 *    (Vbus - Vout) * ton / L = 8.4 V * 2.04 us / 220 uH = 78 mA, so
 *    IL(min) = 500 - 39 = 461 mA, far from zero.
 *  - COUT = 22 uF. No damping branch is needed here (unlike the light-load
 *    `buckSubcircuitFixture`), because 0.5 A into 10 ohm is a low-Q load that
 *    damps the LC itself.
 *
 * HONEST LIMIT, stated because a reader will otherwise assume otherwise: this
 * buck is OPEN LOOP. A real USB supply regulates - it measures its own output
 * and corrects the duty every cycle, so it holds 5 V as the load and the mains
 * move. This one holds 5 V only at the load it was tuned for. That is the right
 * scope for teaching hierarchy, and the wrong circuit to build a charger from.
 *
 * Measured in real ngspice on the deck Tau generates from these three sheets,
 * averaged over 50-60 ms so the mains and the bus have both settled:
 *
 * | quantity | value |
 * |---|---|
 * | V(VAC_IN) peak | 169.7 V |
 * | V(VBUS) | see usbPsuFolder.test.ts DECK_NOTES |
 * | V(VUSB) | ~5 V at ~0.5 A |
 */
import type { NetLabel, ProjectSheetPort, SchematicComponent, SchematicWire } from "./types";
import { part, wire, type FixtureSheet } from "./buckSubcircuitFixture";

/** Mains peak volts (120 V RMS) and frequency. */
export const MAINS_PEAK_V = 170;
export const MAINS_HZ = 60;
/** Turns ratio and magnetizing inductance of the mains transformer. */
export const TRANSFORMER_VALUE = "10:1 L1=10 k=0.99";
/** Bulk capacitance on the rectified bus, in farads. */
export const BUS_CAP_F = 2200e-6;
/** Buck switching period and ON time, in seconds. Duty = 0.408. */
export const BUCK_PERIOD_S = 5e-6;
export const BUCK_ON_TIME_S = 2.04e-6;
export const BUCK_PWM_VALUE = `PULSE(0 5 0 1n 1n ${BUCK_ON_TIME_S * 1e6}u ${BUCK_PERIOD_S * 1e6}u)`;
/** A real Shockley junction, spelled so it is never the ideal substitute. */
export const REAL_DIODE_VALUE = "D Is=1e-14 N=1";
/** The USB load: 5 V into 10 ohm is 0.5 A, i.e. 2.5 W. */
export const USB_LOAD_OHMS = 10;
/** Power-on indicator: (5 - 2.0) / 330 = 9 mA through a red LED. */
export const LED_SERIES_OHMS = 330;

/** A sheet plus the interface it publishes, which only `.sim` can carry. */
export interface PortedSheet extends FixtureSheet {
  projectPorts: ProjectSheetPort[];
}

/**
 * Child 1 - both ends of the transformer secondary in, rectified DC bus out.
 *
 * THREE ports, and the transformer is NOT in here. That is not a layout
 * preference, it is the rule: a linked child sheet emits a `.subckt` body, and
 * `CHILD_DEVICE_RULES` in projectHierarchy.ts only emits devices that map to ONE
 * ngspice card. A transformer expands to two inductors plus a `K` coupling
 * statement, so a child sheet refuses it in as many words:
 *
 *   "T1 (transformer) on "Rectifier.sim" is not yet supported inside a linked
 *    sheet. It expands to several ngspice devices, which a linked sheet's block
 *    body does not generate yet."
 *
 * So the transformer lives on the parent and this block takes SEC1/SEC2 as
 * inputs. The split is honest anyway: the transformer is the mains-facing part,
 * and everything in here is low-voltage DC plumbing.
 *
 * The bridge is drawn as two vertical diode legs between a VBUS rail on top and
 * a ground rail underneath - the arrangement that keeps every wire orthogonal
 * and, importantly, crossing-free. Tau joins wires that share an ENDPOINT, so a
 * wire routed through another wire's midpoint would silently short two nets.
 * Every detour below exists to avoid exactly that.
 */
export function rectifierSheet(): PortedSheet {
  const components: SchematicComponent[] = [
    // Bridge leg A (SEC1) and leg B (SEC2). rot270 puts the anode BELOW the
    // cathode, so each diode points up toward the positive rail.
    part("d1", "diode", 256, 224, REAL_DIODE_VALUE, "D1", 270),
    part("d3", "diode", 256, 288, REAL_DIODE_VALUE, "D3", 270),
    part("d2", "diode", 352, 224, REAL_DIODE_VALUE, "D2", 270),
    part("d4", "diode", 352, 288, REAL_DIODE_VALUE, "D4", 270),
    part("cbus", "capacitor", 448, 256, "2200u", "CBUS", 90),
    part("rbleed", "resistor", 304, 416, "100k", "RBLEED"),
    part("gb", "ground", 304, 352, "", ""),
    part("gc", "ground", 448, 352, "", ""),
  ];
  const wires: SchematicWire[] = [
    // Port stubs, so each label sits on its own endpoint rather than on a
    // three-way junction.
    wire("r-sec1-in", [160, 256], [256, 256]),
    wire("r-sec2-in", [352, 256], [416, 256]),
    // Positive rail across both cathodes, then out to the cap and the port.
    wire("r-bus-a", [256, 192], [352, 192]),
    wire("r-bus-b", [352, 192], [448, 192]),
    wire("r-bus-c", [448, 192], [512, 192]),
    wire("r-cbus-top", [448, 192], [448, 224]),
    wire("r-cbus-gnd", [448, 288], [448, 352]),
    // Ground rail across both anodes.
    wire("r-gnd-a", [256, 320], [304, 320]),
    wire("r-gnd-b", [304, 320], [352, 320]),
    wire("r-gnd-c", [304, 320], [304, 352]),
    // Bleeder across the secondary. Both legs detour AROUND the ground rail
    // (x 256..352 at y=320) rather than dropping straight down through it.
    wire("r-bleed-l", [160, 256], [160, 416], [272, 416]),
    wire("r-bleed-r", [416, 256], [416, 416], [336, 416]),
  ];
  const netLabels: NetLabel[] = [
    { id: "r-sec1", x: 160, y: 256, text: "SEC1", port: "In" },
    { id: "r-sec2", x: 416, y: 256, text: "SEC2", port: "In" },
    { id: "r-vbus", x: 512, y: 192, text: "VBUS", port: "Out" },
  ];
  return {
    components,
    wires,
    netLabels,
    projectPorts: [
      { name: "SEC1", labelId: "r-sec1", direction: "In" },
      { name: "SEC2", labelId: "r-sec2", direction: "In" },
      { name: "VBUS", labelId: "r-vbus", direction: "Out" },
    ],
  };
}

/**
 * Child 2 - DC bus in, regulated-ish 5 V out.
 *
 * Same shape as `buckSubcircuitFixture`'s converter, retuned for this bus and
 * this load, and without the damping branch that a 5 mA load needed.
 */
export function buckSheet(): PortedSheet {
  const components: SchematicComponent[] = [
    part("s1", "switch", 256, 128, "TAU_SW", "S1"),
    part("l1", "inductor", 384, 128, "220u", "L1"),
    // Catch diode: rot270 puts K above and A below, so it points up out of
    // ground into the switching node. Real junction, for the reason in the
    // header - this is the hardest-switched device in the whole supply.
    part("dc", "diode", 320, 192, REAL_DIODE_VALUE, "DC", 270),
    part("vpwm", "vsource", 176, 208, BUCK_PWM_VALUE, "VPWM"),
    part("cout", "capacitor", 480, 192, "22u", "COUT", 90),
    part("g1", "ground", 320, 256, "", ""),
    part("g2", "ground", 176, 272, "", ""),
    part("g3", "ground", 272, 256, "", ""),
    part("g4", "ground", 480, 256, "", ""),
  ];
  const wires: SchematicWire[] = [
    wire("b-vin", [192, 128], [224, 128]),
    // Switching node, split at x=320 so the diode meets a real endpoint rather
    // than forming a mid-segment T junction.
    wire("b-sw-a", [288, 128], [320, 128]),
    wire("b-sw-b", [320, 128], [352, 128]),
    wire("b-d-k", [320, 160], [320, 128]),
    wire("b-d-a", [320, 224], [320, 256]),
    // Gate drive up and across to the switch's NC+ control pin.
    wire("b-gate", [176, 176], [176, 160], [240, 160]),
    wire("b-pwm-gnd", [176, 240], [176, 272]),
    // The switch's NC- control pin returns to ground.
    wire("b-nc-gnd", [272, 160], [272, 256]),
    wire("b-vout", [416, 128], [480, 128]),
    wire("b-cout-top", [480, 128], [480, 160]),
    wire("b-cout-gnd", [480, 224], [480, 256]),
  ];
  const netLabels: NetLabel[] = [
    { id: "bl-vin", x: 192, y: 128, text: "VIN", port: "In" },
    { id: "bl-vout", x: 480, y: 128, text: "VOUT", port: "Out" },
  ];
  return {
    components,
    wires,
    netLabels,
    projectPorts: [
      { name: "VIN", labelId: "bl-vin", direction: "In" },
      { name: "VOUT", labelId: "bl-vout", direction: "Out" },
    ],
  };
}

/**
 * The parent - the whole supply as four symbols and two blocks.
 *
 * Both blocks carry an explicit ordered `p1..pN` bank. The ORDER lives here, on
 * the parent, which is why neither child needs an ordering field.
 */
export function topSheet(
  rectifierPath = "Rectifier.sim",
  buckPath = "Buck5V.sim",
): FixtureSheet {
  const components: SchematicComponent[] = [
    part("v1", "vac", 128, 240, `${MAINS_PEAK_V} ${MAINS_HZ}`, "V1"),
    part("rp", "resistor", 256, 208, "20", "RP"),
    // The transformer and the LED both live HERE and not in a child, and for
    // two different reasons: the transformer expands to several ngspice cards,
    // and an LED needs a model library. See rectifierSheet's note.
    part("t1", "transformer", 352, 224, TRANSFORMER_VALUE, "T1"),
    part("rs1", "resistor", 448, 208, "0.5", "RS1"),
    part("rs2", "resistor", 448, 240, "0.5", "RS2"),
    part("r_usb", "resistor", 896, 288, String(USB_LOAD_OHMS), "RUSB", 90),
    part("r_led", "resistor", 992, 288, String(LED_SERIES_OHMS), "RLED", 90),
    part("d_on", "led", 992, 384, "LED red", "DON", 90),
    part("gv", "ground", 128, 320, "", ""),
    part("gp", "ground", 320, 272, "", ""),
    part("gu", "ground", 896, 352, "", ""),
    part("gl", "ground", 992, 448, "", ""),
    {
      ...part("x1", "subckt", 576, 224, "Rectifier", "X1"),
      // Three ordered pins. The ORDER lives here, on the parent, which is why
      // neither child needs an ordering field.
      pinOverride: [
        { id: "p1", label: "SEC1", x: 528, y: 208 },
        { id: "p2", label: "SEC2", x: 528, y: 240 },
        { id: "p3", label: "VBUS", x: 624, y: 224 },
      ],
      projectSubcircuit: {
        sheetPath: rectifierPath,
        model: "Rectifier",
        ports: ["SEC1", "SEC2", "VBUS"],
      },
    } as SchematicComponent,
    {
      ...part("x2", "subckt", 768, 224, "Buck5V", "X2"),
      pinOverride: [
        { id: "p1", label: "VIN", x: 720, y: 224 },
        { id: "p2", label: "VOUT", x: 816, y: 224 },
      ],
      projectSubcircuit: { sheetPath: buckPath, model: "Buck5V", ports: ["VIN", "VOUT"] },
    } as SchematicComponent,
  ];
  const wires: SchematicWire[] = [
    // Mains in, split so the label sits on an endpoint.
    wire("t-ac-a", [128, 208], [176, 208]),
    wire("t-ac-b", [176, 208], [224, 208]),
    wire("t-v-gnd", [128, 272], [128, 320]),
    // Primary: through the winding resistance into the transformer, return to
    // ground. One side of the outlet is the reference, as it is in a house.
    wire("t-rp-t", [288, 208], [320, 208]),
    wire("t-pri-gnd", [320, 240], [320, 272]),
    // Secondary: each end through its own winding resistance into the block.
    wire("t-s1-a", [384, 208], [416, 208]),
    wire("t-s1-b", [480, 208], [528, 208]),
    wire("t-s2-a", [384, 240], [416, 240]),
    wire("t-s2-b", [480, 240], [528, 240]),
    // Rectified bus between the two blocks: the seam a reader should look at.
    wire("t-bus-a", [624, 224], [672, 224]),
    wire("t-bus-b", [672, 224], [720, 224]),
    // 5 V rail out of the buck, to the USB load and the indicator.
    wire("t-usb-a", [816, 224], [864, 224]),
    wire("t-usb-b", [864, 224], [896, 224]),
    wire("t-usb-r", [896, 224], [896, 256]),
    wire("t-usb-gnd", [896, 320], [896, 352]),
    wire("t-led-rail", [896, 224], [992, 224]),
    wire("t-led-r", [992, 224], [992, 256]),
    wire("t-led-a", [992, 320], [992, 352]),
    wire("t-led-gnd", [992, 416], [992, 448]),
  ];
  const netLabels: NetLabel[] = [
    { id: "t-ac", x: 176, y: 208, text: "VAC_IN" },
    { id: "t-bus", x: 672, y: 224, text: "VBUS" },
    { id: "t-usb", x: 864, y: 224, text: "VUSB" },
  ];
  // 100 ns over 60 ms: 60 ms is ~3.6 mains cycles plus bus settling, and 100 ns
  // still gives 50 points per 5 us switching cycle. At Tau's default resolution
  // the switching edges alias and a reader measures noise, not a converter.
  return { components, wires, netLabels, directives: [".tran 100n 60m"] };
}
