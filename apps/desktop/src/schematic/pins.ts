import { GATE_INPUTS_MAX, parseDigitalGate } from "../engine/digitalGateSpec";
import type { ComponentKind, Point, Rotation, SchematicComponent } from "./types";
import { GATE_COM_X, SOURCE_PIN_Y, gateComY, gateInputRows } from "./symbols";

export interface LocalPin {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface ComponentPin extends LocalPin {
  componentId: string;
  componentLabel: string;
  kind: ComponentKind;
}

const TWO_TERMINAL_PINS: LocalPin[] = [
  { id: "a", label: "A", x: -32, y: 0 },
  { id: "b", label: "B", x: 32, y: 0 },
];

/** Shared vertical source pin bank — DC/AC/pulse/current must match. */
const SOURCE_PINS: LocalPin[] = [
  { id: "p", label: "+", x: 0, y: -SOURCE_PIN_Y },
  { id: "n", label: "-", x: 0, y: SOURCE_PIN_Y },
];

/**
 * Terminal bank for a logic gate with `inputs` inputs.
 *
 * The gate is the one kind whose pin count is set by its value rather than by
 * its kind: the deck has always read only the inputs that are wired, so a
 * 2-input AND used to arrive with three terminals nobody could explain. The
 * rows and the reference row come from the same helpers the artwork uses
 * (`symbols.tsx`), so the drawing cannot disagree with the bank.
 */
function digitalGatePins(inputs: number): LocalPin[] {
  return [
    ...gateInputRows(inputs).map((y, index) => ({
      id: `in${index + 1}`,
      label: String(index + 1),
      x: -32,
      y,
    })),
    { id: "q", label: "Q", x: 32, y: -16 },
    { id: "qbar", label: "Q̅", x: 32, y: 16 },
    { id: "com", label: "COM", x: GATE_COM_X, y: gateComY(inputs) },
  ];
}

const LOCAL_PINS: Record<ComponentKind, LocalPin[]> = {
  resistor: TWO_TERMINAL_PINS,
  capacitor: TWO_TERMINAL_PINS,
  polarizedCapacitor: [
    { id: "a", label: "+", x: -32, y: 0 },
    { id: "b", label: "−", x: 32, y: 0 },
  ],
  inductor: TWO_TERMINAL_PINS,
  vsource: SOURCE_PINS,
  isource: SOURCE_PINS,
  vac: SOURCE_PINS,
  iac: SOURCE_PINS,
  vpulse: SOURCE_PINS,
  logicConstant: SOURCE_PINS,
  diode: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "k", label: "K", x: 32, y: 0 },
  ],
  led: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "k", label: "K", x: 32, y: 0 },
  ],
  zener: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "k", label: "K", x: 32, y: 0 },
  ],
  photodiode: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "k", label: "K", x: 32, y: 0 },
  ],
  opamp: [
    { id: "in+", label: "+", x: -32, y: 16 },
    { id: "in-", label: "-", x: -32, y: -16 },
    { id: "out", label: "OUT", x: 32, y: 0 },
    { id: "v+", label: "V+", x: 0, y: -32 },
    { id: "v-", label: "V-", x: 0, y: 32 },
  ],
  // Comparator: differential inputs (left) drive a single-ended output (right)
  // that snaps to explicit high/low levels. No supply pins - rails are encoded
  // in the value (see engine/comparatorSpec.ts), so an open-loop comparator
  // clamps instead of saturating the way an ideal op-amp would.
  comparator: [
    { id: "in+", label: "+", x: -32, y: 16 },
    { id: "in-", label: "-", x: -32, y: -16 },
    { id: "out", label: "OUT", x: 32, y: 0 },
  ],
  // LTspice-style idealized digital gate (Digital\*.asy): the inputs the gate's
  // own value asks for on the left, true (q) and complementary (qbar) outputs
  // on the right, and a com reference. This entry is the kind's full DICTIONARY
  // (every terminal the kind can expose); `getLocalPins(kind, value)` narrows it
  // to the instance. Imported gates override it with the .asy's exact subset.
  digitalGate: digitalGatePins(GATE_INPUTS_MAX),
  // ── Digital chips. Every terminal is on a side column at x = ±40 against a
  //    ±32 body, and no terminal passes |y| = 32, so the whole part clears the
  //    ±42 × ±40 palette/inspector preview. They used to run to y = 48 (the
  //    flip-flops' PRE/CLR and every `com`) and y = 56 (the 7-segment common),
  //    which the previews simply cut off. Inputs read down the left column and
  //    outputs down the right, so the pinout is legible without the datasheet.
  // Edge-triggered D flip-flop (LTspice Digital\dflop.asy roles): data, clock
  // and the active-high preset/clear on the left, complementary outputs right.
  dflop: [
    { id: "d", label: "D", x: -32, y: -16 },
    { id: "clk", label: "CLK", x: -32, y: 0 },
    { id: "pre", label: "PRE", x: -32, y: -32 },
    { id: "clr", label: "CLR", x: -32, y: 16 },
    { id: "q", label: "Q", x: 32, y: -16 },
    { id: "qbar", label: "Q̅", x: 32, y: 16 },
    { id: "com", label: "COM", x: 32, y: 32 },
  ],
  // Async SR latch (LTspice Digital\srflop.asy): S/R left, complementary outs.
  srflop: [
    { id: "s", label: "S", x: -32, y: -16 },
    { id: "r", label: "R", x: -32, y: 16 },
    { id: "q", label: "Q", x: 32, y: -16 },
    { id: "qbar", label: "Q̅", x: 32, y: 16 },
    { id: "com", label: "COM", x: 32, y: 32 },
  ],
  // Edge-triggered T flip-flop (XSPICE d_tff): T/CLK left, PRE/CLR, Q/Q̅.
  tflop: [
    { id: "t", label: "T", x: -32, y: -16 },
    { id: "clk", label: "CLK", x: -32, y: 0 },
    { id: "pre", label: "PRE", x: -32, y: -32 },
    { id: "clr", label: "CLR", x: -32, y: 16 },
    { id: "q", label: "Q", x: 32, y: -16 },
    { id: "qbar", label: "Q̅", x: 32, y: 16 },
    { id: "com", label: "COM", x: 32, y: 32 },
  ],
  // Edge-triggered JK flip-flop (XSPICE d_jkff): J/K/CLK left, PRE/CLR, Q/Q̅.
  jkflop: [
    { id: "j", label: "J", x: -32, y: -16 },
    { id: "k", label: "K", x: -32, y: 0 },
    { id: "clk", label: "CLK", x: -32, y: 16 },
    { id: "pre", label: "PRE", x: -32, y: -32 },
    { id: "clr", label: "CLR", x: -32, y: 32 },
    { id: "q", label: "Q", x: 32, y: -16 },
    { id: "qbar", label: "Q̅", x: 32, y: 16 },
    { id: "com", label: "COM", x: 32, y: 32 },
  ],
  // 4-bit ripple counter: CLK/RST/COM left, Q0..Q3 right.
  counter: [
    { id: "clk", label: "CLK", x: -40, y: -16 },
    { id: "rst", label: "RST", x: -40, y: 16 },
    { id: "q0", label: "Q0", x: 40, y: -24 },
    { id: "q1", label: "Q1", x: 40, y: -8 },
    { id: "q2", label: "Q2", x: 40, y: 8 },
    { id: "q3", label: "Q3", x: 40, y: 24 },
    { id: "com", label: "COM", x: -40, y: 32 },
  ],
  // Classic 555 / NE555 pinout (SpiceOrder 1..8). Supplies and trigger down the
  // left, timing network and output down the right, as the datasheet draws it.
  timer555: [
    { id: "gnd", label: "GND", x: -40, y: 32 },
    { id: "trig", label: "TRIG", x: -40, y: 16 },
    { id: "out", label: "OUT", x: 40, y: 0 },
    { id: "reset", label: "RESET", x: -40, y: -32 },
    // Spelled CTRL on the drawing and here: "CONT" reads as a continuation.
    { id: "cont", label: "CTRL", x: 40, y: -32 },
    { id: "thres", label: "THRES", x: 40, y: 16 },
    { id: "disch", label: "DISCH", x: 40, y: 32 },
    { id: "vcc", label: "VCC", x: -40, y: -16 },
  ],
  // 4-bit flash/quantizer ADC.
  adc: [
    { id: "vin", label: "VIN", x: -40, y: -16 },
    { id: "vref", label: "VREF", x: -40, y: 16 },
    { id: "d0", label: "D0", x: 40, y: -24 },
    { id: "d1", label: "D1", x: 40, y: -8 },
    { id: "d2", label: "D2", x: 40, y: 8 },
    { id: "d3", label: "D3", x: 40, y: 24 },
    { id: "com", label: "COM", x: -40, y: 32 },
  ],
  // 4-bit weighted DAC: the code word down the left, reference and output right.
  dac: [
    { id: "d0", label: "D0", x: -40, y: -24 },
    { id: "d1", label: "D1", x: -40, y: -8 },
    { id: "d2", label: "D2", x: -40, y: 8 },
    { id: "d3", label: "D3", x: -40, y: 24 },
    { id: "vref", label: "VREF", x: 40, y: -32 },
    { id: "out", label: "OUT", x: 40, y: 0 },
    { id: "com", label: "COM", x: 40, y: 32 },
  ],
  // Raw 7-segment + optional DP (no BCD decoder). Segments are split left/right
  // the way they sit on the digit: F/G/E left, B/C right, A top of the left
  // column and D top-ish of the right, with the common cathode/anode last.
  sevenSeg: [
    { id: "a", label: "A", x: -40, y: -32 },
    { id: "b", label: "B", x: 40, y: -32 },
    { id: "c", label: "C", x: 40, y: -16 },
    { id: "d", label: "D", x: 40, y: 0 },
    { id: "e", label: "E", x: -40, y: 16 },
    { id: "f", label: "F", x: -40, y: -16 },
    { id: "g", label: "G", x: -40, y: 0 },
    { id: "dp", label: "DP", x: 40, y: 16 },
    { id: "com", label: "COM", x: -40, y: 32 },
  ],
  // Behavioral sample-and-hold (LTspice SpecialFunctions\sample): differential
  // analog input plus CLK (rising-edge sample) and S/H (track-while-high)
  // controls on the left, analog output right, com reference last on the left.
  // Imported parts override this with the .asy's exact geometry.
  sampleHold: [
    { id: "in+", label: "+", x: -32, y: -32 },
    { id: "in-", label: "-", x: -32, y: -16 },
    { id: "clk", label: "CLK", x: -32, y: 0 },
    { id: "sh", label: "S/H", x: -32, y: 16 },
    { id: "out", label: "OUT", x: 32, y: 0 },
    { id: "com", label: "COM", x: -32, y: 32 },
  ],
  // Behavioral VCO/modulator (LTspice SpecialFunctions\modulate): FM and AM
  // control inputs on the left, sine output right, com reference last.
  // Imported parts override this with the .asy's exact geometry.
  modulator: [
    { id: "fm", label: "FM", x: -32, y: -16 },
    { id: "am", label: "AM", x: -32, y: 16 },
    { id: "out", label: "Q", x: 32, y: 0 },
    { id: "com", label: "COM", x: -32, y: 32 },
  ],
  // Voltage-controlled sources (4-terminal 2-port): control pair on the left,
  // output pair on the right. cp/cn sense the controlling voltage; op/on drive.
  vcvs: [
    { id: "cp", label: "C+", x: -32, y: -16 },
    { id: "cn", label: "C-", x: -32, y: 16 },
    { id: "op", label: "+", x: 32, y: -16 },
    { id: "on", label: "-", x: 32, y: 16 },
  ],
  vccs: [
    { id: "cp", label: "C+", x: -32, y: -16 },
    { id: "cn", label: "C-", x: -32, y: 16 },
    { id: "op", label: "+", x: 32, y: -16 },
    { id: "on", label: "-", x: 32, y: 16 },
  ],
  // Current-controlled sources (4-terminal 2-port): the control pair (cp/cn) is
  // an internal zero-volt sense branch whose current is the controlling current;
  // op/on drive the output. Same geometry as the voltage-controlled pair.
  cccs: [
    { id: "cp", label: "C+", x: -32, y: -16 },
    { id: "cn", label: "C-", x: -32, y: 16 },
    { id: "op", label: "+", x: 32, y: -16 },
    { id: "on", label: "-", x: 32, y: 16 },
  ],
  ccvs: [
    { id: "cp", label: "C+", x: -32, y: -16 },
    { id: "cn", label: "C-", x: -32, y: 16 },
    { id: "op", label: "+", x: 32, y: -16 },
    { id: "on", label: "-", x: 32, y: 16 },
  ],
  // Behavioral source (B): a 2-terminal output whose value is an arbitrary
  // expression of node voltages/currents/time. Output pair p/n like vsource.
  bsource: [
    { id: "p", label: "+", x: 0, y: -32 },
    { id: "n", label: "-", x: 0, y: 32 },
  ],
  nmos: [
    { id: "d", label: "D", x: 16, y: -32 },
    { id: "g", label: "G", x: -32, y: 0 },
    { id: "s", label: "S", x: 16, y: 32 },
    { id: "b", label: "B", x: 32, y: 0 },
  ],
  pmos: [
    { id: "d", label: "D", x: 16, y: -32 },
    { id: "g", label: "G", x: -32, y: 0 },
    { id: "s", label: "S", x: 16, y: 32 },
    { id: "b", label: "B", x: 32, y: 0 },
  ],
  // JFET (3-terminal): drain top-right, gate left, source bottom-right - same
  // role layout as the MOSFET but no bulk pin (D G S map straight to the SPICE
  // J device order).
  njf: [
    { id: "d", label: "D", x: 16, y: -32 },
    { id: "g", label: "G", x: -32, y: 0 },
    { id: "s", label: "S", x: 16, y: 32 },
  ],
  pjf: [
    { id: "d", label: "D", x: 16, y: -32 },
    { id: "g", label: "G", x: -32, y: 0 },
    { id: "s", label: "S", x: 16, y: 32 },
  ],
  npn: [
    { id: "c", label: "C", x: 16, y: -32 },
    { id: "b", label: "B", x: -32, y: 0 },
    { id: "e", label: "E", x: 16, y: 32 },
  ],
  pnp: [
    { id: "c", label: "C", x: 16, y: -32 },
    { id: "b", label: "B", x: -32, y: 0 },
    { id: "e", label: "E", x: 16, y: 32 },
  ],
  potentiometer: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "b", label: "B", x: 32, y: 0 },
    { id: "w", label: "W", x: 0, y: -32 },
  ],
  bulb: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "b", label: "B", x: 32, y: 0 },
  ],
  // Voltage-controlled switch (LTspice sw.asy): the switched path A/B plus the
  // NC+/NC- control pair, in SpiceOrder so an imported symbol's pins zip 1:1.
  // The control pair is optional - a switch with it unwired holds the static
  // open/closed state instead (engine/spiceNetlist.ts), so extractCircuit does
  // not report those two pins as unconnected.
  switch: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "b", label: "B", x: 32, y: 0 },
    { id: "cp", label: "NC+", x: -16, y: 32 },
    { id: "cn", label: "NC-", x: 16, y: 32 },
  ],
  // SPST momentary: same electrical path as a static switch, no control pins.
  pushButton: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "b", label: "B", x: 32, y: 0 },
  ],
  // SPDT: common + normally-open + normally-closed. Value selects throw.
  spdt: [
    { id: "com", label: "COM", x: -32, y: 0 },
    { id: "no", label: "NO", x: 32, y: -16 },
    { id: "nc", label: "NC", x: 32, y: 16 },
  ],
  // Relay: contact A/B + coil COIL+/COIL-. Coil R + V-controlled SW contact.
  relay: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "b", label: "B", x: 32, y: 0 },
    { id: "cp", label: "COIL+", x: -16, y: 32 },
    { id: "cn", label: "COIL-", x: 16, y: 32 },
  ],
  // DC motor armature (series R+L). Two terminals only — no shaft / back-EMF.
  motor: [
    { id: "a", label: "A", x: -32, y: 0 },
    { id: "b", label: "B", x: 32, y: 0 },
  ],
  transformer: [
    { id: "p1", label: "P1", x: -32, y: -16 },
    { id: "p2", label: "P2", x: -32, y: 16 },
    { id: "s1", label: "S1", x: 32, y: -16 },
    { id: "s2", label: "S2", x: 32, y: 16 },
  ],
  // Center-tapped secondary: primary p1/p2, secondary s1–ct–s2 (outer dots).
  ctTransformer: [
    { id: "p1", label: "P1", x: -32, y: -16 },
    { id: "p2", label: "P2", x: -32, y: 16 },
    { id: "s1", label: "S1", x: 32, y: -24 },
    { id: "ct", label: "CT", x: 32, y: 0 },
    { id: "s2", label: "S2", x: 32, y: 24 },
  ],
  // Ideal lossless transmission line (4-terminal 2-port). Port A = (a1,a2) on
  // the left, port B = (b1,b2) on the right. Order matches LTspice's tline
  // SpiceOrder (I1,R1,I2,R2) so imported pin overrides zip 1:1.
  tline: [
    { id: "a1", label: "A+", x: -32, y: -16 },
    { id: "a2", label: "A-", x: -32, y: 16 },
    { id: "b1", label: "B+", x: 32, y: -16 },
    { id: "b2", label: "B-", x: 32, y: 16 },
  ],
  // Generic subcircuit instance (SPICE X device). Pin ids are p1..pN in the
  // subcircuit's SpiceOrder; imported LTspice-library parts (TowTom2, capmeter,
  // ISO16750-2/ISO7637-2) override this bank with the .asy's exact pin count
  // and geometry. A natively placed instance gets a plain 2-port default.
  subckt: [
    { id: "p1", label: "1", x: -32, y: 0 },
    { id: "p2", label: "2", x: 32, y: 0 },
  ],
  ground: [{ id: "g", label: "0", x: 0, y: 0 }],
};

/**
 * Local (unrotated) terminals for a kind.
 *
 * Called with a `value` this is the bank **this instance** exposes — the only
 * kind that differs today is `digitalGate`, whose input count is configurable.
 * Called with only a kind it is the full DICTIONARY of terminals the kind can
 * ever expose, which is what the LTspice importer needs: `buildPinOverride`
 * maps an `.asy`'s pin names onto Tau roles through this table, so narrowing it
 * there would drop `in2`..`in5` from every imported AND.
 *
 * Prefer {@link getComponentPins}, which has the component and therefore its
 * value, whenever the caller is asking about a real part on the sheet.
 */
export function getLocalPins(kind: ComponentKind, value?: string): LocalPin[] {
  if (kind === "digitalGate" && value !== undefined) {
    return digitalGatePins(parseDigitalGate(value).inputs);
  }
  return LOCAL_PINS[kind];
}

export function getComponentPins(component: SchematicComponent): ComponentPin[] {
  // Imported parts (e.g. from LTspice) carry absolute world pin positions that
  // override the kind's built-in geometry so they meet the original wires.
  if (component.pinOverride && component.pinOverride.length > 0) {
    return component.pinOverride.map((pin) => ({
      id: pin.id,
      label: pin.label,
      x: pin.x,
      y: pin.y,
      componentId: component.id,
      componentLabel: component.label,
      kind: component.kind,
    }));
  }
  return getLocalPins(component.kind, component.value).map((pin) => {
    const t = transformPoint(pin, component.rotation, component.mirrored ?? false);
    return {
      ...pin,
      x: component.x + t.x,
      y: component.y + t.y,
      componentId: component.id,
      componentLabel: component.label,
      kind: component.kind,
    };
  });
}

export function rotatePoint(point: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return { x: point.x, y: point.y };
    case 90:
      return { x: -point.y, y: point.x };
    case 180:
      return { x: -point.x, y: -point.y };
    case 270:
      return { x: point.y, y: -point.x };
  }
}

/**
 * Apply a horizontal mirror (across the vertical axis, `x → -x`) followed by a
 * rotation to a symbol-local point. Mirror-before-rotate matches LTspice's `M*`
 * orientations (see {@link transformLtPoint} in the importer), so an editor flip
 * and an imported `M0` part end up with identical geometry.
 */
export function transformPoint(point: Point, rotation: Rotation, mirrored: boolean): Point {
  const flipped = mirrored ? { x: -point.x, y: point.y } : point;
  return rotatePoint(flipped, rotation);
}
