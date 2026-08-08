import type { ComponentKind } from "./types";

/** World pixels per grid cell. Components span a few cells; pins land on grid. */
export const GRID = 16;

/** One centered sine glyph shared by every sine-bearing schematic symbol.
 *  Keeping the path in one place prevents AC sources and modulators from
 *  drifting a few pixels left/right as their surrounding symbols evolve. */
export const CENTERED_SINE_PATH = "M -11 0 C -8 -9 -3 -9 0 0 S 8 9 11 0";

/**
 * Shared independent-source body geometry. DC (vsource), AC (vac), pulse,
 * and current sources MUST use the same circle radius and pin extent so they
 * snap onto the same grid lines and read as the same size side-by-side.
 * LTspice voltage.asy uses a 64-unit diameter circle with pins 80 apart; Tau
 * keeps pins on the 16-unit grid at ±SOURCE_PIN_Y and a matching circle.
 */
export const SOURCE_CIRCLE_R = 15;
export const SOURCE_PIN_Y = 32;

/**
 * Amplifier (op-amp / comparator) body triangle.
 *
 * The old 54×52 triangle (`M -24 -26 L -24 26 L 30 0 Z`) could not hold the
 * "+" glyph: with the glyph on its pin row (|y| = 16) the lower hypotenuse at
 * x = −16 sits at y = 22.148, and the vertical bar of the "+" reached y = 20.
 * A 2.148-unit nominal gap is less than the paint: at selection weight the
 * 2.35 stroke projects 1.304 vertically across that 25.7° slant and the round
 * cap adds another 1.175, so the glyph overlapped the edge. The "−" is flat
 * and had 4.222 units, which is why only the "+" collided.
 *
 * The fix is the triangle, not the glyph: at half-height 32 (LTspice's opamp
 * proportions) the closest approach between any glyph centreline and any body
 * edge is 6.0 units — more than two full selected strokes, so the painted gap
 * is at least one whole selected-stroke width. `symbols.test.tsx` recomputes
 * that distance rather than trusting this comment.
 */
const AMP_LEFT_X = -24;
const AMP_APEX_X = 30;
const AMP_HALF_H = 32;
const AMP_BODY_PATH = `M ${AMP_LEFT_X} ${-AMP_HALF_H} L ${AMP_LEFT_X} ${AMP_HALF_H} L ${AMP_APEX_X} 0 Z`;
/** y where the body edges cross x = 0: where the supply leads land. */
const AMP_SUPPLY_Y =
  Math.round(((AMP_HALF_H * AMP_APEX_X) / (AMP_APEX_X - AMP_LEFT_X)) * 1000) / 1000;
/** Input polarity glyphs, both centred on x = −14, both on their pin rows. */
const AMP_PLUS_PATH = "M -18 16 H -10 M -14 13 V 19";
const AMP_MINUS_PATH = "M -18 -16 H -10";

function AmplifierBody() {
  return (
    <>
      <path data-amp-body="" d={AMP_BODY_PATH} />
      <line x1={-32} y1={-16} x2={AMP_LEFT_X} y2={-16} />
      <line x1={-32} y1={16} x2={AMP_LEFT_X} y2={16} />
      <line x1={AMP_APEX_X} y1={0} x2={32} y2={0} />
      <path data-amp-glyph="+" d={AMP_PLUS_PATH} />
      <path data-amp-glyph="-" d={AMP_MINUS_PATH} />
    </>
  );
}

/**
 * Controlled-source (E/G/F/H) shared frame.
 *
 * All four used to be the same rounded rect plus one tiny diamond, and the
 * declared body (±18 × ±22) did not match the drawn rect (±14 × ±20). They now
 * differ on both ports, which is the standard distinction:
 *  - control port: an OPEN PAIR (two facing contacts, no conductor between
 *    them) senses a voltage; a CLOSED conductor carrying a sense arrow carries
 *    the controlling current.
 *  - output: a diamond with +/− is a voltage source; a diamond with an arrow
 *    through it is a current source.
 */
const CS_HALF_W = 24;
const CS_HALF_H = 22;
/** x of the control-port spine, and of the output diamond's centre. */
const CS_PORT_X = -13;
const CS_DIAMOND_CX = 10;
/** Diamond apexes sit on the ±16 output rows, so the leads leave the vertices. */
const CS_DIAMOND_PATH = "M 10 -16 L 20 0 L 10 16 L 0 0 Z";

function ControlledSourceFrame() {
  return (
    <>
      <rect
        x={-CS_HALF_W}
        y={-CS_HALF_H}
        width={CS_HALF_W * 2}
        height={CS_HALF_H * 2}
        rx={2}
      />
      <path data-source-diamond="" d={CS_DIAMOND_PATH} />
      <line x1={CS_DIAMOND_CX} y1={-16} x2={32} y2={-16} />
      <line x1={CS_DIAMOND_CX} y1={16} x2={32} y2={16} />
    </>
  );
}

/** Voltage-controlled input: an open pair — the port draws no current. */
function VoltageControlPort() {
  return (
    <g data-control-port="voltage">
      <line x1={-32} y1={-16} x2={CS_PORT_X} y2={-16} />
      <line x1={CS_PORT_X} y1={-16} x2={CS_PORT_X} y2={-9} />
      <circle cx={CS_PORT_X} cy={-6} r={3} />
      <line x1={-32} y1={16} x2={CS_PORT_X} y2={16} />
      <line x1={CS_PORT_X} y1={16} x2={CS_PORT_X} y2={9} />
      <circle cx={CS_PORT_X} cy={6} r={3} />
    </g>
  );
}

/** Current-controlled input: a closed sense branch with the current arrow. */
function CurrentControlPort() {
  return (
    <g data-control-port="current">
      <line x1={-32} y1={-16} x2={CS_PORT_X} y2={-16} />
      <line x1={CS_PORT_X} y1={-16} x2={CS_PORT_X} y2={16} />
      <line x1={-32} y1={16} x2={CS_PORT_X} y2={16} />
      <path className="symbol-arrow" d="M -13 5 L -16.5 -3 L -9.5 -3 Z" />
    </g>
  );
}

/** Voltage-source output: +/− inside the diamond. */
function VoltageSourceOutput() {
  return (
    <g data-source-output="voltage">
      <path d="M 7 -5 H 13 M 10 -8 V -2" />
      <path d="M 7 5 H 13" />
    </g>
  );
}

/** Current-source output: an arrow through the diamond. */
function CurrentSourceOutput() {
  return (
    <g data-source-output="current">
      <path d="M 10 -10 V 7" />
      <path d="M 5 2 L 10 9 L 15 2" />
    </g>
  );
}

/**
 * A vertical winding drawn as 8-unit semicircular turns running from `from` to
 * `to` on the line x = `x`. Both endpoints are exact, which is the whole point:
 * the transformer leads used to stop ~6.3 units short of the coil because the
 * coil was three 14-unit turns and ran past its own pins. `sweep` 1 bulges
 * right (primary), 0 bulges left (secondary) — both toward the core.
 */
function transformerWinding(x: number, from: number, to: number, sweep: 0 | 1): string {
  const turns = Math.round(Math.abs(to - from) / 8);
  const step = (to - from) / turns;
  let d = `M ${x} ${from}`;
  for (let i = 0; i < turns; i += 1) {
    d += ` A ${Math.abs(step) / 2} ${Math.abs(step) / 2} 0 0 ${sweep} ${x} ${from + step * (i + 1)}`;
  }
  return d;
}

function CenteredSineGlyph({ y = 0 }: { y?: number }) {
  return (
    <path
      data-sine-glyph=""
      d={CENTERED_SINE_PATH}
      fill="none"
      transform={y === 0 ? undefined : `translate(0 ${y})`}
    />
  );
}

/** True when a voltage/current source value is an explicit SINE/SIN function. */
export function valueLooksLikeSine(value: string | undefined): boolean {
  return /^\s*(SINE|SIN)\s*\(/i.test(value ?? "");
}

/** Accurate local bounding box of each symbol's drawn body (excludes pin leads).
 *  Unlike SYMBOL_BOX these are NOT assumed symmetric about the origin - e.g.
 *  ground is drawn entirely below its pin - so they give correct hit-testing
 *  and collision for asymmetric parts. Used for selection + overlap. */
export interface BodyBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export const SYMBOL_BODY: Record<ComponentKind, BodyBox> = {
  resistor: { minX: -28, minY: -12, maxX: 28, maxY: 12 },
  capacitor: { minX: -8, minY: -15, maxX: 8, maxY: 15 },
  polarizedCapacitor: { minX: -10, minY: -15, maxX: 12, maxY: 15 },
  inductor: { minX: -26, minY: -10, maxX: 26, maxY: 10 },
  vsource: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  isource: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  vac: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  iac: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  vpulse: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  logicConstant: { minX: -14, minY: -16, maxX: 14, maxY: 16 },
  diode: { minX: -13, minY: -15, maxX: 13, maxY: 15 },
  led: { minX: -13, minY: -15, maxX: 16, maxY: 15 },
  zener: { minX: -13, minY: -15, maxX: 16, maxY: 15 },
  photodiode: { minX: -13, minY: -20, maxX: 16, maxY: 15 },
  opamp: { minX: -24, minY: -32, maxX: 30, maxY: 32 },
  comparator: { minX: -24, minY: -32, maxX: 30, maxY: 32 },
  digitalGate: { minX: -24, minY: -38, maxX: 28, maxY: 40 },
  dflop: { minX: -24, minY: -40, maxX: 24, maxY: 40 },
  srflop: { minX: -24, minY: -24, maxX: 24, maxY: 40 },
  tflop: { minX: -24, minY: -40, maxX: 24, maxY: 40 },
  jkflop: { minX: -24, minY: -40, maxX: 24, maxY: 40 },
  counter: { minX: -32, minY: -32, maxX: 32, maxY: 40 },
  timer555: { minX: -32, minY: -40, maxX: 32, maxY: 40 },
  adc: { minX: -32, minY: -32, maxX: 32, maxY: 40 },
  dac: { minX: -32, minY: -40, maxX: 32, maxY: 40 },
  sevenSeg: { minX: -28, minY: -40, maxX: 28, maxY: 48 },
  sampleHold: { minX: -24, minY: -40, maxX: 24, maxY: 40 },
  modulator: { minX: -24, minY: -32, maxX: 24, maxY: 32 },
  vcvs: { minX: -24, minY: -22, maxX: 24, maxY: 22 },
  vccs: { minX: -24, minY: -22, maxX: 24, maxY: 22 },
  cccs: { minX: -24, minY: -22, maxX: 24, maxY: 22 },
  ccvs: { minX: -24, minY: -22, maxX: 24, maxY: 22 },
  bsource: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  nmos: { minX: -12, minY: -20, maxX: 18, maxY: 20 },
  pmos: { minX: -12, minY: -20, maxX: 18, maxY: 20 },
  njf: { minX: -12, minY: -20, maxX: 18, maxY: 20 },
  pjf: { minX: -12, minY: -20, maxX: 18, maxY: 20 },
  npn: { minX: -8, minY: -20, maxX: 18, maxY: 20 },
  pnp: { minX: -8, minY: -20, maxX: 18, maxY: 20 },
  potentiometer: { minX: -25, minY: -18, maxX: 25, maxY: 10 },
  bulb: { minX: -14, minY: -14, maxX: 14, maxY: 14 },
  switch: { minX: -18, minY: -20, maxX: 18, maxY: 20 },
  pushButton: { minX: -14, minY: -18, maxX: 14, maxY: 14 },
  spdt: { minX: -18, minY: -22, maxX: 18, maxY: 22 },
  relay: { minX: -18, minY: -20, maxX: 18, maxY: 22 },
  motor: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  transformer: { minX: -22, minY: -22, maxX: 22, maxY: 22 },
  ctTransformer: { minX: -22, minY: -28, maxX: 24, maxY: 28 },
  tline: { minX: -20, minY: -16, maxX: 20, maxY: 16 },
  subckt: { minX: -24, minY: -20, maxX: 24, maxY: 20 },
  ground: { minX: -12, minY: -3, maxX: 12, maxY: 22 },
};

/** Half-extents of each symbol body (excludes pin leads), used to keep labels clear of the symbol. */
export const SYMBOL_BOX: Record<ComponentKind, { halfW: number; halfH: number }> = {
  resistor: { halfW: 30, halfH: 12 },
  capacitor: { halfW: 8, halfH: 15 },
  polarizedCapacitor: { halfW: 12, halfH: 15 },
  inductor: { halfW: 26, halfH: 9 },
  vsource: { halfW: 16, halfH: 17 },
  isource: { halfW: 16, halfH: 17 },
  vac: { halfW: 16, halfH: 17 },
  iac: { halfW: 16, halfH: 17 },
  vpulse: { halfW: 16, halfH: 17 },
  logicConstant: { halfW: 14, halfH: 18 },
  diode: { halfW: 14, halfH: 15 },
  led: { halfW: 18, halfH: 22 },
  zener: { halfW: 16, halfH: 18 },
  photodiode: { halfW: 18, halfH: 22 },
  opamp: { halfW: 32, halfH: 34 },
  comparator: { halfW: 32, halfH: 34 },
  digitalGate: { halfW: 28, halfH: 40 },
  dflop: { halfW: 26, halfH: 42 },
  srflop: { halfW: 26, halfH: 34 },
  tflop: { halfW: 26, halfH: 42 },
  jkflop: { halfW: 26, halfH: 42 },
  counter: { halfW: 34, halfH: 42 },
  timer555: { halfW: 34, halfH: 42 },
  adc: { halfW: 34, halfH: 42 },
  dac: { halfW: 34, halfH: 46 },
  sevenSeg: { halfW: 32, halfH: 52 },
  sampleHold: { halfW: 26, halfH: 42 },
  modulator: { halfW: 26, halfH: 34 },
  vcvs: { halfW: 26, halfH: 24 },
  vccs: { halfW: 26, halfH: 24 },
  cccs: { halfW: 26, halfH: 24 },
  ccvs: { halfW: 26, halfH: 24 },
  bsource: { halfW: 16, halfH: 17 },
  nmos: { halfW: 26, halfH: 20 },
  pmos: { halfW: 26, halfH: 20 },
  njf: { halfW: 26, halfH: 20 },
  pjf: { halfW: 26, halfH: 20 },
  npn: { halfW: 22, halfH: 20 },
  pnp: { halfW: 22, halfH: 20 },
  potentiometer: { halfW: 27, halfH: 19 },
  bulb: { halfW: 16, halfH: 16 },
  switch: { halfW: 14, halfH: 20 },
  pushButton: { halfW: 14, halfH: 18 },
  spdt: { halfW: 16, halfH: 22 },
  relay: { halfW: 16, halfH: 22 },
  motor: { halfW: 16, halfH: 16 },
  transformer: { halfW: 24, halfH: 24 },
  ctTransformer: { halfW: 26, halfH: 30 },
  tline: { halfW: 20, halfH: 18 },
  subckt: { halfW: 26, halfH: 22 },
  ground: { halfW: 12, halfH: 22 },
};

/**
 * Renders the bare symbol for a component, centered on its origin (0,0).
 * Stroke/fill come from CSS (`.symbol` class on the parent <g>).
 *
 * Pin convention (used later for wiring):
 *  - 2-terminal horizontal parts: pins at (-32, 0) and (32, 0)
 *  - vertical source parts:        pins at (0, -SOURCE_PIN_Y) and (0, SOURCE_PIN_Y)
 *  - ground:                       single pin at (0, 0)
 *
 * Optional `value` lets a DC `vsource`/`isource` whose value is an explicit
 * SINE(...) draw the AC sine glyph so a waveform change matches the body.
 */
export function ComponentSymbol({ kind, value }: { kind: ComponentKind; value?: string }) {
  const r = SOURCE_CIRCLE_R;
  const pin = SOURCE_PIN_Y;
  switch (kind) {
    case "resistor":
      return (
        <>
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <path d="M -24 0 L -20 -10 L -12 10 L -4 -10 L 4 10 L 12 -10 L 20 10 L 24 0" />
          <line x1={24} y1={0} x2={32} y2={0} />
        </>
      );

    case "capacitor":
      return (
        <>
          <line x1={-32} y1={0} x2={-5} y2={0} />
          <line x1={-5} y1={-13} x2={-5} y2={13} />
          <line x1={5} y1={-13} x2={5} y2={13} />
          <line x1={5} y1={0} x2={32} y2={0} />
        </>
      );

    case "polarizedCapacitor":
      return (
        <>
          <line x1={-32} y1={0} x2={-6} y2={0} />
          <line x1={-6} y1={-13} x2={-6} y2={13} strokeWidth={2.5} />
          <path d="M 4 -13 Q 14 0 4 13" fill="none" />
          <line x1={6} y1={0} x2={32} y2={0} />
          <path d="M -18 -8 H -12 M -15 -11 V -5" />
        </>
      );

    case "inductor":
      return (
        <>
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <path d="M -24 0 A 6 6 0 0 1 -12 0 A 6 6 0 0 1 0 0 A 6 6 0 0 1 12 0 A 6 6 0 0 1 24 0" />
          <line x1={24} y1={0} x2={32} y2={0} />
        </>
      );

    case "vsource":
      if (valueLooksLikeSine(value)) {
        return (
          <>
            <line x1={0} y1={-pin} x2={0} y2={-r} />
            <circle cx={0} cy={0} r={r} />
            <CenteredSineGlyph />
            <line x1={0} y1={r} x2={0} y2={pin} />
          </>
        );
      }
      return (
        <>
          <line x1={0} y1={-pin} x2={0} y2={-r} />
          <circle cx={0} cy={0} r={r} />
          {/* + */}
          <line x1={-4} y1={-6} x2={4} y2={-6} />
          <line x1={0} y1={-10} x2={0} y2={-2} />
          {/* − */}
          <line x1={-4} y1={7} x2={4} y2={7} />
          <line x1={0} y1={r} x2={0} y2={pin} />
        </>
      );

    case "isource":
      return (
        <>
          <line x1={0} y1={-pin} x2={0} y2={-r} />
          <circle cx={0} cy={0} r={r} />
          <path d="M 0 -9 V 8" />
          <path d="M -5 3 L 0 9 L 5 3" />
          <line x1={0} y1={r} x2={0} y2={pin} />
        </>
      );

    case "vac":
      return (
        <>
          <line x1={0} y1={-pin} x2={0} y2={-r} />
          <circle cx={0} cy={0} r={r} />
          <CenteredSineGlyph />
          <line x1={0} y1={r} x2={0} y2={pin} />
        </>
      );

    case "iac":
      return (
        <>
          <line x1={0} y1={-pin} x2={0} y2={-r} />
          <circle cx={0} cy={0} r={r} />
          <CenteredSineGlyph y={-5} />
          <path d="M 0 1 V 10" />
          <path d="M -5 5 L 0 11 L 5 5" />
          <line x1={0} y1={r} x2={0} y2={pin} />
        </>
      );

    case "vpulse":
      return (
        <>
          <line x1={0} y1={-pin} x2={0} y2={-r} />
          <circle cx={0} cy={0} r={r} />
          {/* pulse train: low-high-low-high */}
          <path d="M -10 5 L -10 -5 L -2 -5 L -2 5 L 6 5 L 6 -5 L 10 -5" />
          <line x1={0} y1={r} x2={0} y2={pin} />
        </>
      );

    case "logicConstant":
      return (
        <>
          <line x1={0} y1={-pin} x2={0} y2={-14} />
          <rect x={-12} y={-14} width={24} height={28} rx={2} />
          <path d="M -4 -4 H 4 M 0 -8 V 0" />
          <line x1={-5} y1={7} x2={5} y2={7} />
          <line x1={0} y1={14} x2={0} y2={pin} />
        </>
      );

    case "diode":
      return (
        <>
          <line x1={-32} y1={0} x2={-12} y2={0} />
          <path d="M -12 -13 L 10 0 L -12 13 Z" />
          <line x1={10} y1={-14} x2={10} y2={14} />
          <line x1={10} y1={0} x2={32} y2={0} />
        </>
      );

    case "led":
      return (
        <>
          <line x1={-32} y1={0} x2={-12} y2={0} />
          <path d="M -12 -13 L 10 0 L -12 13 Z" />
          <line x1={10} y1={-14} x2={10} y2={14} />
          <line x1={10} y1={0} x2={32} y2={0} />
          <path d="M 14 -20 L 25 -31" />
          <path d="M 25 -31 L 23 -23 M 25 -31 L 17 -29" />
          <path d="M 5 -20 L 16 -31" />
          <path d="M 16 -31 L 14 -23 M 16 -31 L 8 -29" />
        </>
      );

    case "zener":
      return (
        <>
          <line x1={-32} y1={0} x2={-12} y2={0} />
          <path d="M -12 -13 L 10 0 L -12 13 Z" />
          <path d="M 10 -14 V 14 M 10 -14 L 16 -18 M 10 14 L 4 18" />
          <line x1={10} y1={0} x2={32} y2={0} />
        </>
      );

    case "photodiode":
      return (
        <>
          <line x1={-32} y1={0} x2={-12} y2={0} />
          <path d="M -12 -13 L 10 0 L -12 13 Z" />
          <line x1={10} y1={-14} x2={10} y2={14} />
          <line x1={10} y1={0} x2={32} y2={0} />
          {/* Incoming light arrows (opposite of LED emission arrows). */}
          <path d="M 25 -31 L 14 -20" />
          <path d="M 14 -20 L 16 -28 M 14 -20 L 22 -22" />
          <path d="M 16 -31 L 5 -20" />
          <path d="M 5 -20 L 7 -28 M 5 -20 L 13 -22" />
        </>
      );

    case "opamp":
      return (
        <>
          <AmplifierBody />
          {/* Supply leads stop exactly where the body edges cross x = 0. */}
          <line x1={0} y1={-32} x2={0} y2={-AMP_SUPPLY_Y} />
          <line x1={0} y1={AMP_SUPPLY_Y} x2={0} y2={32} />
        </>
      );

    case "comparator":
      return (
        <>
          {/* Same triangle body as the op-amp; no supply pins (the rails ride
              in the value - see engine/comparatorSpec.ts). */}
          <AmplifierBody />
          {/* hysteresis/step glyph marks it as a comparator, not an op-amp */}
          <path data-amp-glyph="hysteresis" d="M -8 6 H 0 V -6 H 8" fill="none" />
        </>
      );

    case "digitalGate":
      return (
        <>
          {/* Rounded-nose gate body (LTspice-style AND silhouette); the value
              text (and/or/xor/inv/…) names the function next to the symbol. */}
          <path d="M -24 -38 L 2 -38 A 38 38 0 0 1 2 38 L -24 38 Z" />
          {/* input leads on the ±16 grid rows */}
          <line x1={-32} y1={-32} x2={-24} y2={-32} />
          <line x1={-32} y1={-16} x2={-24} y2={-16} />
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <line x1={-32} y1={16} x2={-24} y2={16} />
          <line x1={-32} y1={32} x2={-24} y2={32} />
          {/* q / qbar output leads (qbar gets the inversion bubble) */}
          <line x1={26} y1={-16} x2={32} y2={-16} />
          <circle cx={24} cy={16} r={3} />
          <line x1={27} y1={16} x2={32} y2={16} />
          {/* com reference drops from the body floor */}
          <line x1={0} y1={38} x2={0} y2={48} />
        </>
      );

    case "dflop":
      return (
        <>
          <rect x={-24} y={-40} width={48} height={80} rx={2} />
          {/* D / CLK leads; CLK gets the edge-trigger wedge */}
          <line x1={-32} y1={-16} x2={-24} y2={-16} />
          <line x1={-32} y1={16} x2={-24} y2={16} />
          <path d="M -24 10 L -16 16 L -24 22" fill="none" />
          {/* PRE (top) / CLR (bottom) */}
          <line x1={0} y1={-48} x2={0} y2={-40} />
          <line x1={0} y1={40} x2={0} y2={48} />
          {/* Q / Q̅ (bubble) */}
          <line x1={24} y1={-16} x2={32} y2={-16} />
          <circle cx={27} cy={16} r={3} />
          <line x1={30} y1={16} x2={32} y2={16} />
          {/* com */}
          <line x1={-32} y1={48} x2={-24} y2={40} />
          {/* D-flop glyph */}
          <path d="M -8 -6 H 0 A 6 6 0 0 1 0 6 H -8 Z" fill="none" />
        </>
      );

    case "srflop":
      return (
        <>
          <rect x={-24} y={-24} width={48} height={56} rx={2} />
          <line x1={-32} y1={-16} x2={-24} y2={-16} />
          <line x1={-32} y1={16} x2={-24} y2={16} />
          <line x1={24} y1={-16} x2={32} y2={-16} />
          <circle cx={27} cy={16} r={3} />
          <line x1={30} y1={16} x2={32} y2={16} />
          <line x1={-32} y1={48} x2={-24} y2={32} />
          {/* SR glyph: crossed set/reset hint */}
          <path d="M -6 -4 L 6 4 M -6 4 L 6 -4" fill="none" />
        </>
      );

    case "tflop":
      return (
        <>
          <rect x={-24} y={-40} width={48} height={80} rx={2} />
          <line x1={-32} y1={-16} x2={-24} y2={-16} />
          <line x1={-32} y1={16} x2={-24} y2={16} />
          <path d="M -24 10 L -16 16 L -24 22" fill="none" />
          <line x1={0} y1={-48} x2={0} y2={-40} />
          <line x1={0} y1={40} x2={0} y2={48} />
          <line x1={24} y1={-16} x2={32} y2={-16} />
          <circle cx={27} cy={16} r={3} />
          <line x1={30} y1={16} x2={32} y2={16} />
          <line x1={-32} y1={48} x2={-24} y2={40} />
          {/* T glyph */}
          <path d="M -6 -6 H 6 M 0 -6 V 6" fill="none" />
        </>
      );

    case "jkflop":
      return (
        <>
          <rect x={-24} y={-40} width={48} height={80} rx={2} />
          <line x1={-32} y1={-24} x2={-24} y2={-24} />
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <line x1={-32} y1={24} x2={-24} y2={24} />
          <path d="M -24 18 L -16 24 L -24 30" fill="none" />
          <line x1={0} y1={-48} x2={0} y2={-40} />
          <line x1={0} y1={40} x2={0} y2={48} />
          <line x1={24} y1={-16} x2={32} y2={-16} />
          <circle cx={27} cy={16} r={3} />
          <line x1={30} y1={16} x2={32} y2={16} />
          <line x1={-32} y1={48} x2={-24} y2={40} />
          {/* JK glyph */}
          <path d="M -8 -8 V 8 M -8 0 L 0 8 M 4 -8 V 8 M 4 0 L 10 -8 M 4 0 L 10 8" fill="none" />
        </>
      );

    case "counter":
      return (
        <>
          <rect x={-32} y={-32} width={64} height={72} rx={2} />
          <line x1={-40} y1={-16} x2={-32} y2={-16} />
          <line x1={-40} y1={16} x2={-32} y2={16} />
          <path d="M -32 -22 L -24 -16 L -32 -10" fill="none" />
          <line x1={32} y1={-24} x2={40} y2={-24} />
          <line x1={32} y1={-8} x2={40} y2={-8} />
          <line x1={32} y1={8} x2={40} y2={8} />
          <line x1={32} y1={24} x2={40} y2={24} />
          <line x1={0} y1={40} x2={0} y2={48} />
          {/* binary stair glyph */}
          <path d="M -14 20 H -6 V 12 H 2 V 4 H 10 V -4" fill="none" />
        </>
      );

    case "timer555":
      return (
        <>
          <rect x={-32} y={-40} width={64} height={80} rx={2} />
          <line x1={-40} y1={-32} x2={-32} y2={-32} />
          <line x1={-40} y1={-16} x2={-32} y2={-16} />
          <line x1={-40} y1={16} x2={-32} y2={16} />
          <line x1={-40} y1={32} x2={-32} y2={32} />
          <line x1={32} y1={-32} x2={40} y2={-32} />
          <line x1={32} y1={0} x2={40} y2={0} />
          <line x1={32} y1={16} x2={40} y2={16} />
          <line x1={32} y1={32} x2={40} y2={32} />
          <text x={0} y={4} textAnchor="middle" fontSize={11} fill="currentColor" stroke="none">
            555
          </text>
        </>
      );

    case "adc":
      return (
        <>
          <rect x={-32} y={-32} width={64} height={72} rx={2} />
          <line x1={-40} y1={-16} x2={-32} y2={-16} />
          <line x1={-40} y1={16} x2={-32} y2={16} />
          <line x1={32} y1={-24} x2={40} y2={-24} />
          <line x1={32} y1={-8} x2={40} y2={-8} />
          <line x1={32} y1={8} x2={40} y2={8} />
          <line x1={32} y1={24} x2={40} y2={24} />
          <line x1={0} y1={40} x2={0} y2={48} />
          <path d="M -16 0 L -4 -10 L -4 10 Z" fill="none" />
          <path d="M 4 -8 H 16 M 4 0 H 12 M 4 8 H 16" fill="none" />
        </>
      );

    case "dac":
      return (
        <>
          <rect x={-32} y={-40} width={64} height={80} rx={2} />
          <line x1={-40} y1={-24} x2={-32} y2={-24} />
          <line x1={-40} y1={-8} x2={-32} y2={-8} />
          <line x1={-40} y1={8} x2={-32} y2={8} />
          <line x1={-40} y1={24} x2={-32} y2={24} />
          <line x1={-40} y1={40} x2={-32} y2={40} />
          <line x1={32} y1={0} x2={40} y2={0} />
          <line x1={0} y1={40} x2={0} y2={48} />
          <path d="M -14 -8 H -4 M -14 0 H -8 M -14 8 H -2" fill="none" />
          <path d="M 4 -10 L 16 0 L 4 10 Z" fill="none" />
        </>
      );

    case "sevenSeg":
      return (
        <>
          {/* Clear "8." glyph — raw segment pins, no digit decode. */}
          <rect x={-28} y={-40} width={56} height={88} rx={2} />
          <line x1={-8} y1={-48} x2={-8} y2={-40} />
          <line x1={32} y1={-24} x2={32} y2={-24} />
          <line x1={28} y1={-24} x2={32} y2={-24} />
          <line x1={28} y1={24} x2={32} y2={24} />
          <line x1={-8} y1={40} x2={-8} y2={48} />
          <line x1={-32} y1={24} x2={-28} y2={24} />
          <line x1={-32} y1={-24} x2={-28} y2={-24} />
          <line x1={-40} y1={0} x2={-28} y2={0} />
          <line x1={28} y1={40} x2={40} y2={40} />
          <line x1={0} y1={48} x2={0} y2={56} />
          {/* segment "8" */}
          <path d="M -12 -28 H 12" fill="none" strokeWidth={2.5} />
          <path d="M 14 -26 V -4" fill="none" strokeWidth={2.5} />
          <path d="M 14 4 V 26" fill="none" strokeWidth={2.5} />
          <path d="M -12 28 H 12" fill="none" strokeWidth={2.5} />
          <path d="M -14 4 V 26" fill="none" strokeWidth={2.5} />
          <path d="M -14 -26 V -4" fill="none" strokeWidth={2.5} />
          <path d="M -12 0 H 12" fill="none" strokeWidth={2.5} />
          <circle cx={18} cy={30} r={2.5} fill="currentColor" stroke="none" />
        </>
      );

    case "sampleHold":
      return (
        <>
          {/* Box with a pointed right nose toward the analog output (echoes
              LTspice's SpecialFunctions\sample silhouette). */}
          <path d="M -24 -40 L 16 -40 L 24 0 L 16 40 L -24 40 Z" />
          {/* in+ / in- / CLK / S/H leads; CLK gets the edge-trigger wedge */}
          <line x1={-32} y1={-32} x2={-24} y2={-32} />
          <line x1={-32} y1={-16} x2={-24} y2={-16} />
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <path d="M -24 -6 L -16 0 L -24 6" fill="none" />
          <line x1={-32} y1={16} x2={-24} y2={16} />
          {/* analog output from the nose */}
          <line x1={24} y1={0} x2={32} y2={0} />
          {/* com drops from the body floor */}
          <line x1={0} y1={40} x2={0} y2={48} />
          {/* staircase glyph: a held sample */}
          <path d="M -12 26 H -4 V 18 H 4 V 26 H 12" fill="none" />
        </>
      );

    case "modulator":
      return (
        <>
          {/* Box with a pointed right nose toward the sine output (echoes the
              sampleHold silhouette; the wave glyph marks it as a VCO). */}
          <path d="M -24 -32 L 16 -32 L 24 0 L 16 32 L -24 32 Z" />
          {/* FM / AM control leads */}
          <line x1={-32} y1={-16} x2={-24} y2={-16} />
          <line x1={-32} y1={16} x2={-24} y2={16} />
          {/* sine output from the nose */}
          <line x1={24} y1={0} x2={32} y2={0} />
          {/* com drops from the body floor */}
          <line x1={0} y1={32} x2={0} y2={48} />
          {/* sine-wave glyph: modulated carrier */}
          <CenteredSineGlyph />
        </>
      );

    // E — voltage-controlled voltage source: open control pair, +/− diamond.
    case "vcvs":
      return (
        <>
          <ControlledSourceFrame />
          <VoltageControlPort />
          <VoltageSourceOutput />
        </>
      );

    // G — voltage-controlled current source: open control pair, arrow diamond.
    case "vccs":
      return (
        <>
          <ControlledSourceFrame />
          <VoltageControlPort />
          <CurrentSourceOutput />
        </>
      );

    // F — current-controlled current source: sense branch, arrow diamond.
    case "cccs":
      return (
        <>
          <ControlledSourceFrame />
          <CurrentControlPort />
          <CurrentSourceOutput />
        </>
      );

    // H — current-controlled voltage source: sense branch, +/− diamond.
    case "ccvs":
      return (
        <>
          <ControlledSourceFrame />
          <CurrentControlPort />
          <VoltageSourceOutput />
        </>
      );

    case "bsource":
      return (
        <>
          {/* behavioral (arbitrary) source: a 2-terminal diamond with an "=" to
              denote that its value is an equation of other node quantities */}
          <line x1={0} y1={-32} x2={0} y2={-15} />
          <path d="M 0 -15 L 15 0 L 0 15 L -15 0 Z" />
          <line x1={-6} y1={-3} x2={6} y2={-3} />
          <line x1={-6} y1={3} x2={6} y2={3} />
          <line x1={0} y1={15} x2={0} y2={32} />
        </>
      );

    case "nmos":
      return (
        <>
          <line x1={16} y1={-32} x2={16} y2={-14} />
          <line x1={16} y1={14} x2={16} y2={32} />
          <line x1={-32} y1={0} x2={-10} y2={0} />
          <line x1={-10} y1={-18} x2={-10} y2={18} />
          <line x1={4} y1={-18} x2={4} y2={18} />
          <line x1={4} y1={-14} x2={16} y2={-14} />
          <line x1={4} y1={14} x2={16} y2={14} />
          <line x1={4} y1={0} x2={32} y2={0} />
          {/* NMOS: filled arrow pointing INTO the channel (tip on the bar).
              Open chevrons here render as stray strokes - see .symbol-arrow. */}
          <path className="symbol-arrow" d="M 4 0 L 12 -4.5 L 12 4.5 Z" />
        </>
      );

    case "pmos":
      return (
        <>
          <line x1={16} y1={-32} x2={16} y2={-14} />
          <line x1={16} y1={14} x2={16} y2={32} />
          <line x1={-32} y1={0} x2={-10} y2={0} />
          <line x1={-10} y1={-18} x2={-10} y2={18} />
          <line x1={4} y1={-18} x2={4} y2={18} />
          <line x1={4} y1={-14} x2={16} y2={-14} />
          <line x1={4} y1={14} x2={16} y2={14} />
          <line x1={4} y1={0} x2={32} y2={0} />
          {/* PMOS: filled arrow pointing OUT of the channel (tip away from
              the bar), the mirror of NMOS - direction IS the polarity cue. */}
          <path className="symbol-arrow" d="M 14 0 L 6 -4.5 L 6 4.5 Z" />
        </>
      );

    case "npn":
      return (
        <>
          <line x1={-32} y1={0} x2={-6} y2={0} />
          <line x1={-6} y1={-18} x2={-6} y2={18} />
          <line x1={-6} y1={-8} x2={16} y2={-32} />
          <line x1={-6} y1={8} x2={16} y2={32} />
          {/* NPN: filled emitter arrow pointing OUT (away from the base bar),
              sitting mid-leg on the (-6,8)→(16,32) emitter. */}
          <path className="symbol-arrow" d="M 12.7 28.4 L 2.1 22.7 L 8 17.3 Z" />
        </>
      );

    case "pnp":
      return (
        <>
          <line x1={-32} y1={0} x2={-6} y2={0} />
          <line x1={-6} y1={-18} x2={-6} y2={18} />
          <line x1={-6} y1={-8} x2={16} y2={-32} />
          <line x1={-6} y1={8} x2={16} y2={32} />
          {/* PNP: filled emitter arrow pointing IN (toward the base bar) -
              opposite of NPN; same mid-leg placement on the emitter. */}
          <path className="symbol-arrow" d="M 0.6 15.2 L 4.6 25.6 L 10.5 20.2 Z" />
        </>
      );

    case "njf":
      return (
        <>
          {/* JFET: vertical channel bar, drain top / source bottom, gate lead
              from the left with an arrow pointing INTO the channel (N-type). */}
          <line x1={16} y1={-32} x2={16} y2={-14} />
          <line x1={16} y1={14} x2={16} y2={32} />
          <line x1={4} y1={-18} x2={4} y2={18} />
          <line x1={4} y1={-14} x2={16} y2={-14} />
          <line x1={4} y1={14} x2={16} y2={14} />
          <line x1={-32} y1={0} x2={4} y2={0} />
          <path className="symbol-arrow" d="M 4 0 L -5 -4.5 L -5 4.5 Z" />
        </>
      );

    case "pjf":
      return (
        <>
          {/* P-JFET: same body, gate arrow pointing OUT of the channel. */}
          <line x1={16} y1={-32} x2={16} y2={-14} />
          <line x1={16} y1={14} x2={16} y2={32} />
          <line x1={4} y1={-18} x2={4} y2={18} />
          <line x1={4} y1={-14} x2={16} y2={-14} />
          <line x1={4} y1={14} x2={16} y2={14} />
          <line x1={-32} y1={0} x2={4} y2={0} />
          <path className="symbol-arrow" d="M -7 0 L 2 -4.5 L 2 4.5 Z" />
        </>
      );

    case "potentiometer":
      return (
        <>
          {/* The track is redrawn symmetric about the wiper pin so its centre
              peak sits at x = 0: the wiper arrow can then land ON the track
              instead of floating 8 units above it, which is what made the part
              read as a fixed resistor with a stray chevron. */}
          <line x1={-32} y1={0} x2={-25} y2={0} />
          <path data-track="" d="M -25 0 L -20 -10 L -10 10 L 0 -10 L 10 10 L 20 -10 L 25 0" />
          <line x1={25} y1={0} x2={32} y2={0} />
          {/* Wiper: a solid arrow whose tip touches the track — the standard
              "adjustable" marking (the tap fraction is the Wiper= parameter). */}
          <line x1={0} y1={-32} x2={0} y2={-18} />
          <path data-wiper="" className="symbol-arrow" d="M 0 -10 L -4.5 -18 L 4.5 -18 Z" />
        </>
      );

    case "bulb":
      return (
        <>
          {/* Glass envelope + filament cross (IEC lamp). The old circle-plus-
              squiggle was all but identical to the motor's circle-plus-M. The
              cross endpoints are 14/√2 so they land exactly on the glass. */}
          <line x1={-32} y1={0} x2={-14} y2={0} />
          <circle cx={0} cy={0} r={14} />
          <path d="M -9.9 -9.9 L 9.9 9.9 M -9.9 9.9 L 9.9 -9.9" />
          <line x1={14} y1={0} x2={32} y2={0} />
        </>
      );

    case "switch":
      return (
        <>
          <line x1={-32} y1={0} x2={-12} y2={0} />
          <line x1={12} y1={0} x2={32} y2={0} />
          <circle cx={-12} cy={0} r={3} />
          <circle cx={12} cy={0} r={3} />
          <line x1={-10} y1={-3} x2={11} y2={-18} />
          <line x1={-16} y1={32} x2={-16} y2={16} />
          <line x1={16} y1={32} x2={16} y2={16} />
          <line x1={-16} y1={16} x2={16} y2={16} />
        </>
      );

    case "pushButton":
      return (
        <>
          <line x1={-32} y1={0} x2={-14} y2={0} />
          <line x1={14} y1={0} x2={32} y2={0} />
          <circle cx={-14} cy={0} r={3} />
          <circle cx={14} cy={0} r={3} />
          <line x1={-14} y1={-3} x2={-14} y2={-14} />
          <line x1={14} y1={-3} x2={14} y2={-14} />
          <line x1={-18} y1={-14} x2={18} y2={-14} />
          <line x1={0} y1={-14} x2={0} y2={-22} />
        </>
      );

    case "spdt":
      return (
        <>
          <line x1={-32} y1={0} x2={-12} y2={0} />
          <circle cx={-12} cy={0} r={3} />
          <circle cx={12} cy={-16} r={3} />
          <circle cx={12} cy={16} r={3} />
          <line x1={12} y1={-16} x2={32} y2={-16} />
          <line x1={12} y1={16} x2={32} y2={16} />
          <line x1={-10} y1={-2} x2={10} y2={-14} />
        </>
      );

    case "relay":
      return (
        <>
          <line x1={-32} y1={0} x2={-12} y2={0} />
          <line x1={12} y1={0} x2={32} y2={0} />
          <circle cx={-12} cy={0} r={3} />
          <circle cx={12} cy={0} r={3} />
          <line x1={-10} y1={-3} x2={11} y2={-14} />
          <rect x={-14} y={14} width={28} height={14} rx={1} />
          <path d="M -10 21 L -6 17 L -2 25 L 2 17 L 6 25 L 10 21" />
          <line x1={-16} y1={32} x2={-16} y2={28} />
          <line x1={16} y1={32} x2={16} y2={28} />
        </>
      );

    case "motor":
      return (
        <>
          <line x1={-32} y1={0} x2={-14} y2={0} />
          <circle cx={0} cy={0} r={14} />
          <path d="M -6 5 L -6 -5 L -2 2 L 2 -5 L 6 5" fill="none" />
          <line x1={14} y1={0} x2={32} y2={0} />
        </>
      );

    case "transformer":
      return (
        <>
          {/* Both windings span exactly their own pin rows, so every lead ends
              on the coil instead of in mid-air. */}
          <line x1={-32} y1={-16} x2={-22} y2={-16} />
          <line x1={-32} y1={16} x2={-22} y2={16} />
          <path d={transformerWinding(-22, -16, 16, 1)} />
          <line x1={-2} y1={-22} x2={-2} y2={22} />
          <line x1={2} y1={-22} x2={2} y2={22} />
          <path d={transformerWinding(22, -16, 16, 0)} />
          <line x1={22} y1={-16} x2={32} y2={-16} />
          <line x1={22} y1={16} x2={32} y2={16} />
        </>
      );

    case "ctTransformer":
      return (
        <>
          <line x1={-32} y1={-16} x2={-22} y2={-16} />
          <line x1={-32} y1={16} x2={-22} y2={16} />
          <path d={transformerWinding(-22, -16, 16, 1)} />
          <line x1={-2} y1={-28} x2={-2} y2={28} />
          <line x1={2} y1={-28} x2={2} y2={28} />
          {/* Secondary split at the tap: both halves meet at y = 0, which is
              where the CT lead leaves — it used to land 4 units off the
              junction, on a coil that overran its own s2 pin by 8. */}
          <path d={transformerWinding(22, -24, 0, 0)} />
          <path d={transformerWinding(22, 0, 24, 0)} />
          <circle className="symbol-arrow" cx={22} cy={0} r={2} />
          <line x1={22} y1={-24} x2={32} y2={-24} />
          <line x1={22} y1={0} x2={32} y2={0} />
          <line x1={22} y1={24} x2={32} y2={24} />
        </>
      );

    case "tline":
      return (
        <>
          {/* Ideal lossless line: two conductors tapering between the ports,
              echoing LTspice's tline glyph. Port A pins left, port B right. */}
          <line x1={-32} y1={-16} x2={-16} y2={-16} />
          <line x1={-32} y1={16} x2={-16} y2={16} />
          <path d="M -16 -16 L 16 -8 M -16 16 L 16 8" />
          <path d="M -16 -8 L 16 -4 M -16 8 L 16 4" />
          <line x1={16} y1={-16} x2={32} y2={-16} />
          <line x1={16} y1={16} x2={32} y2={16} />
          <line x1={16} y1={-16} x2={16} y2={-4} />
          <line x1={16} y1={16} x2={16} y2={4} />
        </>
      );

    case "subckt":
      return (
        <>
          {/* Generic subcircuit box (SPICE X device). Imported LTspice-library
              parts carry their own pin geometry (pinOverride), so the body is
              a neutral rectangle with the default 2-port leads; the X glyph
              marks it as a subcircuit instance. */}
          <rect x={-24} y={-20} width={48} height={40} rx={2} />
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <line x1={24} y1={0} x2={32} y2={0} />
          <path d="M -7 -7 L 7 7 M -7 7 L 7 -7" />
        </>
      );

    case "ground":
      return (
        <>
          <line x1={0} y1={0} x2={0} y2={10} />
          <line x1={-11} y1={10} x2={11} y2={10} />
          <line x1={-7} y1={15} x2={7} y2={15} />
          <line x1={-3} y1={20} x2={3} y2={20} />
        </>
      );
  }
}
