import type { ComponentKind, Point, Rotation, SchematicComponent } from "./types";

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

const LOCAL_PINS: Record<ComponentKind, LocalPin[]> = {
  resistor: TWO_TERMINAL_PINS,
  capacitor: TWO_TERMINAL_PINS,
  inductor: TWO_TERMINAL_PINS,
  vsource: [
    { id: "p", label: "+", x: 0, y: -32 },
    { id: "n", label: "-", x: 0, y: 32 },
  ],
  isource: [
    { id: "p", label: "+", x: 0, y: -32 },
    { id: "n", label: "-", x: 0, y: 32 },
  ],
  vac: [
    { id: "p", label: "+", x: 0, y: -32 },
    { id: "n", label: "-", x: 0, y: 32 },
  ],
  iac: [
    { id: "p", label: "+", x: 0, y: -32 },
    { id: "n", label: "-", x: 0, y: 32 },
  ],
  vpulse: [
    { id: "p", label: "+", x: 0, y: -32 },
    { id: "n", label: "-", x: 0, y: 32 },
  ],
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
  opamp: [
    { id: "in+", label: "+", x: -32, y: 16 },
    { id: "in-", label: "-", x: -32, y: -16 },
    { id: "out", label: "OUT", x: 32, y: 0 },
    { id: "v+", label: "V+", x: 0, y: -32 },
    { id: "v-", label: "V-", x: 0, y: 32 },
  ],
  // Comparator: differential inputs (left) drive a single-ended output (right)
  // that snaps to explicit high/low levels. No supply pins — rails are encoded
  // in the value (see engine/comparatorSpec.ts), so an open-loop comparator
  // clamps instead of saturating the way an ideal op-amp would.
  comparator: [
    { id: "in+", label: "+", x: -32, y: 16 },
    { id: "in-", label: "-", x: -32, y: -16 },
    { id: "out", label: "OUT", x: 32, y: 0 },
  ],
  // LTspice-style idealized digital gate (Digital\*.asy): up to five inputs on
  // the left, true (q) and complementary (qbar) outputs on the right, and a
  // com reference. Imported gates override this with the .asy's exact subset;
  // natively placed gates expose the full bank (extra pins are harmless — a
  // floating input is ignored, per LTspice semantics).
  digitalGate: [
    { id: "in1", label: "1", x: -32, y: -32 },
    { id: "in2", label: "2", x: -32, y: -16 },
    { id: "in3", label: "3", x: -32, y: 0 },
    { id: "in4", label: "4", x: -32, y: 16 },
    { id: "in5", label: "5", x: -32, y: 32 },
    { id: "q", label: "Q", x: 32, y: -16 },
    { id: "qbar", label: "Q̅", x: 32, y: 16 },
    { id: "com", label: "COM", x: 0, y: 48 },
  ],
  // Edge-triggered D flip-flop (LTspice Digital\dflop.asy roles): data/clock on
  // the left, active-high preset/clear top/bottom, complementary outputs right.
  dflop: [
    { id: "d", label: "D", x: -32, y: -16 },
    { id: "clk", label: "CLK", x: -32, y: 16 },
    { id: "pre", label: "PRE", x: 0, y: -48 },
    { id: "clr", label: "CLR", x: 0, y: 48 },
    { id: "q", label: "Q", x: 32, y: -16 },
    { id: "qbar", label: "Q̅", x: 32, y: 16 },
    { id: "com", label: "COM", x: -32, y: 48 },
  ],
  // Behavioral sample-and-hold (LTspice SpecialFunctions\sample): differential
  // analog input plus CLK (rising-edge sample) and S/H (track-while-high)
  // controls on the left, analog output right, com reference below. Imported
  // parts override this with the .asy's exact geometry.
  sampleHold: [
    { id: "in+", label: "+", x: -32, y: -32 },
    { id: "in-", label: "-", x: -32, y: -16 },
    { id: "clk", label: "CLK", x: -32, y: 0 },
    { id: "sh", label: "S/H", x: -32, y: 16 },
    { id: "out", label: "OUT", x: 32, y: 0 },
    { id: "com", label: "COM", x: 0, y: 48 },
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
  // JFET (3-terminal): drain top-right, gate left, source bottom-right — same
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
  switch: TWO_TERMINAL_PINS,
  transformer: [
    { id: "p1", label: "P1", x: -32, y: -16 },
    { id: "p2", label: "P2", x: -32, y: 16 },
    { id: "s1", label: "S1", x: 32, y: -16 },
    { id: "s2", label: "S2", x: 32, y: 16 },
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
  testpoint: [{ id: "tp", label: "TP", x: 0, y: 0 }],
  ground: [{ id: "g", label: "0", x: 0, y: 0 }],
};

export const getLocalPins = (kind: ComponentKind): LocalPin[] => LOCAL_PINS[kind];

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
  return getLocalPins(component.kind).map((pin) => {
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
