import { parseDigitalGate } from "../engine/digitalGateSpec";
import { parsePotentiometerSpec } from "../engine/potentiometerSpec";
import { isSpdtThrowToNo, isStaticContactClosed } from "./kindGroups";
import type { ComponentKind, Rotation } from "./types";

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

/* ── Potentiometer geometry (mission item 6) ─────────────────────────────────
 *
 * The wiper arrow is drawn where `Wiper=` says the tap is, not at a fixed x.
 * It has to be: in simulator mode the wiper is a live control the reader drags,
 * and an arrow that never moved would make a working control look inert.
 */

/** Resistance track, symmetric about the wiper pin so its centre peak is x = 0. */
const POT_TRACK_PATH = "M -25 0 L -20 -10 L -10 10 L 0 -10 L 10 10 L 20 -10 L 25 0";
/** Height of the track's peaks; the arrow tip rides this line. */
const POT_TRACK_PEAK_Y = -10;
/** Length of the wiper arrow, and half its width. */
const POT_ARROW_LEN = 8;
const POT_ARROW_HALF_W = 4.5;
/**
 * How far either side of centre the wiper arrow travels.
 *
 * Stopping on the track's outer peaks (±20) buys two things: the tip lands
 * exactly ON the zigzag at both end stops and at centre, and the arrow's own
 * half-width keeps the drawing inside the declared `SYMBOL_BODY` of ±25 at
 * every wiper position (20 + 4.5 = 24.5), so hit-testing and label clearance
 * stay honest without a value-dependent body box.
 */
export const WIPER_TRAVEL_X = 20;

/** Symbol-local x of the wiper arrow for a tap fraction 0..1 measured from pin A. */
export function wiperArrowX(wiper: number): number {
  const clamped = Math.min(1, Math.max(0, wiper));
  return Math.round((2 * clamped - 1) * WIPER_TRAVEL_X * 1000) / 1000;
}

/* ── Logic gate geometry (mission item 9) ────────────────────────────────────
 *
 * The gate used to draw five input leads whatever it was, declare `maxX: 28`
 * while its nose reached x = 40, and hide both output leads and the inversion
 * bubble INSIDE the body arc. All three are the same root cause: one hard-coded
 * silhouette that knew nothing about the gate it was drawing.
 *
 * Everything below is derived from the input count instead, so the pin bank in
 * `pins.ts` and the artwork are two readings of one geometry. The netlist
 * already supported 1..5 inputs (it counts wired pins), so this is the drawing
 * catching up with the deck rather than a new capability.
 */

/** Back edge of every gate body. Input leads run from the pin (x = -32) to here. */
const GATE_BACK_X = -24;
/** Nose tip. Fixed, so a gate keeps its width as the input bank grows taller. */
const GATE_NOSE_TIP_X = 28;
/** Rows the true/complementary outputs sit on. */
const GATE_OUT_Y = 16;
/** How far an OR/XOR back bulges into the body, and where the XOR's second arc sits. */
const GATE_BACK_BULGE = 8;
const GATE_XOR_ARC_X = -32;
const GATE_XOR_ARC_BULGE = 6;
/** Inversion bubble radius, and the clear space a lead needs beside the body. */
const GATE_BUBBLE_R = 3;

/**
 * Input rows for an N-input gate: symmetric about the body centre, every row on
 * a multiple of {@link GRID}.
 *
 * At a 16-unit pitch an even bank would straddle the centre at ±8, which is off
 * the connection grid, so an even bank skips the centre row instead — the
 * classic gate layout, and the same "keep every terminal on the grid" rule
 * `subcircuitGeometry.verticalOffsets` applies to a subcircuit's pin bank.
 */
export function gateInputRows(inputs: number): number[] {
  const count = Math.max(1, Math.round(inputs));
  if (count === 1) return [0];
  const even = count % 2 === 0;
  return Array.from({ length: count }, (_, index) => {
    const step = index - (count - 1) / 2;
    return (even ? (step > 0 ? Math.ceil(step) : Math.floor(step)) : step) * GRID;
  });
}

/** Body half-height: enough to clear the input bank and both output rows. */
export function gateBodyHalfHeight(inputs: number): number {
  const reach = Math.max(GATE_OUT_Y, ...gateInputRows(inputs).map(Math.abs));
  return reach + 8;
}

/** x where the nose crosses height `y` — where a lead on that row starts. */
function gateNoseCrossX(halfHeight: number, y: number): number {
  const centre = GATE_NOSE_TIP_X - halfHeight;
  return centre + Math.sqrt(Math.max(0, halfHeight * halfHeight - y * y));
}

/** Row the `com` reference sits on, whatever the gate's height. */
export const GATE_COM_Y = 32;
/** Where a short gate's reference drops from the floor. The floor runs from the
 *  back to `GATE_NOSE_TIP_X - halfHeight`, so x = 0 would hang off the end of a
 *  tall gate's floor; -16 is on the grid and on the floor of a short one. */
const GATE_COM_FLOOR_X = -16;

/**
 * Where the `com` reference terminal sits.
 *
 * It follows the body, because the body grows with the input count and the
 * terminal has to stay on it AND inside the ±42 × ±40 preview. A short gate
 * (up to three inputs) drops its reference from the floor; a tall one has no
 * floor left under y = 32, so the reference leaves the nose on that row
 * instead. Both are on the 16 grid and both fit the preview - pinning the
 * reference at y = 48, as it was, put every gate 8 units outside it.
 *
 * The bank re-lays anyway at that transition (the input rows go from ±16 to
 * ±32), so the reference moving with it is the consistent rule rather than an
 * extra surprise.
 */
export function gateComPoint(inputs: number): { x: number; y: number } {
  const half = gateBodyHalfHeight(inputs);
  return half > GATE_COM_Y
    ? { x: 32, y: GATE_COM_Y }
    : { x: GATE_COM_FLOOR_X, y: GATE_COM_Y };
}

/** Radius of a circular arc spanning `2 * half` that bulges `depth` sideways. */
const arcRadius = (half: number, depth: number): number => (depth * depth + half * half) / (2 * depth);

/** x of an OR/XOR's concave back at height `y` — where that input lead ends. */
function gateCurvedBackX(halfHeight: number, y: number): number {
  const radius = arcRadius(halfHeight, GATE_BACK_BULGE);
  const centre = GATE_BACK_X + GATE_BACK_BULGE - radius;
  return centre + Math.sqrt(Math.max(0, radius * radius - y * y));
}

/**
 * The seven palette gates used to render byte-identical markup: one hard-coded
 * AND silhouette with five leads, whatever function the value named. The
 * function is now visible in the outline, the way every logic diagram draws it:
 *
 *  - AND / NAND      flat back, round nose
 *  - OR / NOR        concave back, round nose
 *  - XOR / XNOR      the same, plus the second arc outside the back
 *  - BUF / NOT       one input and a buffer triangle inside the body
 *  - Schmitt         one input and the hysteresis glyph
 *
 * The inversion bubble sits on whichever output actually carries the inverted
 * sense. `invertOut` (NAND/NOR/XNOR/NOT) swaps the levels driven onto q and
 * qbar — see `engine/digitalGateSpec.ts` — so on those parts the bubble belongs
 * on q, not on qbar. The old symbol always bubbled qbar and so mislabelled
 * every inverting gate on the sheet.
 */
function DigitalGateArtwork({ value }: { value?: string }) {
  const spec = parseDigitalGate(value ?? "");
  const half = gateBodyHalfHeight(spec.inputs);
  const noseStart = GATE_NOSE_TIP_X - half;
  const curvedBack = spec.fn === "or" || spec.fn === "xor";
  const nose = `L ${noseStart} ${-half} A ${half} ${half} 0 0 1 ${noseStart} ${half} L ${GATE_BACK_X} ${half}`;
  const backRadius = arcRadius(half, GATE_BACK_BULGE);
  const body = curvedBack
    ? `M ${GATE_BACK_X} ${-half} ${nose} A ${backRadius} ${backRadius} 0 0 0 ${GATE_BACK_X} ${-half}`
    : `M ${GATE_BACK_X} ${-half} ${nose} Z`;
  const xorRadius = arcRadius(half, GATE_XOR_ARC_BULGE);
  const crossX = gateNoseCrossX(half, GATE_OUT_Y);
  const com = gateComPoint(spec.inputs);
  // q first: it is the output whose sense `invertOut` flips.
  const outputs = [
    { id: "q", y: -GATE_OUT_Y, bubble: spec.invertOut },
    { id: "qbar", y: GATE_OUT_Y, bubble: !spec.invertOut },
  ];
  return (
    <>
      <path data-gate-body={spec.fn} d={body} />
      {spec.fn === "xor" && (
        <path
          data-gate-xor-arc=""
          d={`M ${GATE_XOR_ARC_X} ${-half} A ${xorRadius} ${xorRadius} 0 0 1 ${GATE_XOR_ARC_X} ${half}`}
        />
      )}
      {gateInputRows(spec.inputs).map((y) => (
        <line
          key={`in-${y}`}
          x1={-32}
          y1={y}
          x2={curvedBack ? gateCurvedBackX(half, y) : GATE_BACK_X}
          y2={y}
        />
      ))}
      {outputs.map((output) =>
        output.bubble ? (
          <g key={output.id} data-gate-invert={output.id}>
            <circle cx={crossX + GATE_BUBBLE_R} cy={output.y} r={GATE_BUBBLE_R} />
            <line x1={crossX + GATE_BUBBLE_R * 2} y1={output.y} x2={32} y2={output.y} />
          </g>
        ) : (
          <line key={output.id} x1={crossX} y1={output.y} x2={32} y2={output.y} />
        ),
      )}
      {spec.fn === "buf" && <path data-gate-glyph="buf" d="M -10 -7 L 4 0 L -10 7 Z" />}
      {spec.fn === "schmitt" && <path data-gate-glyph="schmitt" d="M -9 5 H -1 V -5 H 7" />}
      {com.x > 0 ? (
        <line x1={gateNoseCrossX(half, com.y)} y1={com.y} x2={com.x} y2={com.y} />
      ) : (
        <line x1={com.x} y1={half} x2={com.x} y2={com.y} />
      )}
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

/* ── Digital chips: one body, labelled pins (mission item 5) ─────────────────
 *
 * Every digital IC now draws its pin names, because a 64×72 rectangle with
 * eight anonymous stubs tells a reader nothing at all — the 555 in particular
 * was a box with "555" in it and no way to tell TRIG from THRES.
 *
 * Two rules make that safe:
 *  - Terminals live in two side columns at x = ±CHIP_PIN_X against a
 *    ±CHIP_HALF_W × ±CHIP_HALF_H body, and none passes |y| = 32. Nothing is
 *    drawn outside the ±42 × ±40 palette/inspector preview any more.
 *  - The names are drawn by {@link PinLabel}, which undoes the wrapper's
 *    rotation so the text is upright at all four orientations.
 */
const CHIP_HALF_W = 32;
const CHIP_HALF_H = 36;
const CHIP_PIN_X = 40;
/** Centre of the label column inside each side of a chip body. */
const CHIP_LABEL_X = 20;
/**
 * Flip-flops keep the ±24 body and ±32 terminals they have always had, and only
 * PRE / CLR / COM move (in from |y| = 48, which the preview cut off). Holding
 * the rest still is not conservatism: the assistant's auto-layout aligns parts
 * by their pin offsets and routes wires through the gaps between symbols, and
 * every variant that moved a whole column re-routed one shift-register stage's
 * Q net through the next stage's - which `assistantCircuitPlan.stress.test.ts`
 * catches as two nets that were supposed to stay isolated.
 */
const FLOP_HALF_W = 24;
const FLOP_HALF_H = 24;
const FLOP_PIN_X = 32;
const FLOP_PIN_Y = 32;
const FLOP_LABEL_X = 13;
/** Same, for the nose-bodied parts (sample & hold, modulator). */
const NOSE_HALF_W = 24;
const NOSE_PIN_X = 32;

/** Body rectangle shared by every digital chip. */
function ChipBody({ halfW = CHIP_HALF_W, halfH = CHIP_HALF_H }: { halfW?: number; halfH?: number }) {
  return <rect x={-halfW} y={-halfH} width={halfW * 2} height={halfH * 2} rx={2} />;
}

/** Nose body shared by sample & hold and the modulator. */
function NoseBody() {
  return (
    <path
      d={`M ${-NOSE_HALF_W} ${-CHIP_HALF_H} L 16 ${-CHIP_HALF_H} L ${NOSE_HALF_W} 0 L 16 ${CHIP_HALF_H} L ${-NOSE_HALF_W} ${CHIP_HALF_H} Z`}
    />
  );
}

/** One lead per row, from the pin column to the body edge. */
function ChipLeads({
  rows,
  side,
  pinX = CHIP_PIN_X,
  bodyX = CHIP_HALF_W,
}: {
  rows: readonly number[];
  side: -1 | 1;
  pinX?: number;
  bodyX?: number;
}) {
  return (
    <>
      {rows.map((y) => (
        <line key={`${side}-${y}`} x1={side * pinX} y1={y} x2={side * bodyX} y2={y} />
      ))}
    </>
  );
}

/**
 * A pin name drawn inside the body.
 *
 * `<text>` in a symbol inherits the wrapper's `rotate(R) scale(-1 1)`, so a
 * naive caption is MIRRORED when the part is flipped and UPSIDE-DOWN at 180°.
 * That was a real bug, not a hypothetical: the old "555" caption did exactly
 * this, and adding eight more captions would have multiplied it by eight.
 *
 * The fix is the EDA convention, not a full counter-rotation. Undoing the
 * rotation entirely was tried and measured: at 90° the 555's five left-hand
 * captions land on one horizontal line 16 units apart, and "RESET" alone is
 * 21 units wide, so they overlap into an unreadable smear. Turning the caption
 * WITH the body keeps each one in the lane the layout gave it at every
 * orientation; all that has to be corrected is the half-turn that would leave
 * it upside-down, and the flip that would mirror the glyphs.
 *
 * So the caption's own transform is `translate(a) · M · rotate(θ)` with
 * θ ∈ {0°, 180°} chosen so the composed angle is 0° or 90° — never 180° or
 * 270° — and `M = scale(-1 1)` when the part is mirrored, which cancels the
 * wrapper's flip. The translation part is untouched either way, so the caption
 * still lands exactly on the point it annotates. Anchoring is `middle` so a
 * caption grows symmetrically about that point instead of running out through
 * the body edge when the part turns.
 */
function labelHalfTurn(rotation: Rotation): 0 | 180 {
  return rotation > 90 && rotation <= 270 ? 180 : 0;
}

function PinLabel({
  text,
  x,
  y,
  rotation,
  mirrored,
}: {
  text: string;
  x: number;
  y: number;
  rotation: Rotation;
  mirrored: boolean;
}) {
  const parts = [`translate(${x} ${y})`];
  if (mirrored) parts.push("scale(-1 1)");
  const turn = labelHalfTurn(rotation);
  if (turn !== 0) parts.push(`rotate(${turn})`);
  return (
    <text
      className="subckt-pin-label"
      data-pin-label={text}
      textAnchor="middle"
      // Half the 7px cap height, so the caption's midline sits on its own row.
      y={2.4}
      transform={parts.join(" ")}
    >
      {text}
    </text>
  );
}

/** Where each pin's name is drawn. `text` must match the pin's own label -
 *  `symbols.test.tsx` checks that against `getLocalPins` for every kind here. */
export interface PinLabelPlacement {
  pin: string;
  text: string;
  x: number;
  y: number;
}

const L = CHIP_LABEL_X;
const F = FLOP_LABEL_X;
const NL = 10; // nose-body label column

export const PIN_LABEL_LAYOUT: Partial<Record<ComponentKind, readonly PinLabelPlacement[]>> = {
  // CLK / R ride above their own row and COM sits below them: the reference
  // terminal leaves the bottom-left CORNER, so its caption has to share the
  // left column with the last input rather than sit beside a lead.
  //
  // The gap between those two is 11 units, not the 8 it started as. A caption
  // is taller than 8, so at 8 the two boxes touched -- measured at 0.9 px on
  // the real canvas. DESIGN_SYSTEM.md section 5 is absolute about this: labels
  // never overlap, and a near-miss is a bug.
  //
  // The room comes from raising the input, not from lowering COM: COM at 22
  // cleared the overlap but pushed the caption outside the body, which the
  // symbol suite catches. On the JK the left column carries four captions in
  // 40 units, so K gives up 3 units as well.
  dflop: [
    { pin: "d", text: "D", x: -F, y: -16 },
    { pin: "clk", text: "CLK", x: -F, y: 9 },
    { pin: "com", text: "COM", x: -F, y: 20 },
    { pin: "pre", text: "PRE", x: 2, y: -19 },
    { pin: "clr", text: "CLR", x: 2, y: 19 },
    { pin: "q", text: "Q", x: F, y: -16 },
    { pin: "qbar", text: "Q̅", x: F, y: 16 },
  ],
  srflop: [
    { pin: "s", text: "S", x: -F, y: -16 },
    { pin: "r", text: "R", x: -F, y: 9 },
    { pin: "com", text: "COM", x: -F, y: 20 },
    { pin: "q", text: "Q", x: F, y: -16 },
    { pin: "qbar", text: "Q̅", x: F, y: 16 },
  ],
  tflop: [
    { pin: "t", text: "T", x: -F, y: -16 },
    { pin: "clk", text: "CLK", x: -F, y: 9 },
    { pin: "com", text: "COM", x: -F, y: 20 },
    { pin: "pre", text: "PRE", x: 2, y: -19 },
    { pin: "clr", text: "CLR", x: 2, y: 19 },
    { pin: "q", text: "Q", x: F, y: -16 },
    { pin: "qbar", text: "Q̅", x: F, y: 16 },
  ],
  jkflop: [
    { pin: "j", text: "J", x: -F, y: -16 },
    { pin: "k", text: "K", x: -F, y: -3 },
    { pin: "clk", text: "CLK", x: -F, y: 9 },
    { pin: "com", text: "COM", x: -F, y: 20 },
    { pin: "pre", text: "PRE", x: 2, y: -19 },
    { pin: "clr", text: "CLR", x: 2, y: 19 },
    { pin: "q", text: "Q", x: F, y: -16 },
    { pin: "qbar", text: "Q̅", x: F, y: 16 },
  ],
  counter: [
    { pin: "clk", text: "CLK", x: -L, y: -16 },
    { pin: "rst", text: "RST", x: -L, y: 16 },
    { pin: "com", text: "COM", x: -L, y: 32 },
    { pin: "q0", text: "Q0", x: L, y: -24 },
    { pin: "q1", text: "Q1", x: L, y: -8 },
    { pin: "q2", text: "Q2", x: L, y: 8 },
    { pin: "q3", text: "Q3", x: L, y: 24 },
  ],
  timer555: [
    { pin: "reset", text: "RESET", x: -L, y: -32 },
    { pin: "vcc", text: "VCC", x: -L, y: -16 },
    { pin: "trig", text: "TRIG", x: -L, y: 16 },
    { pin: "gnd", text: "GND", x: -L, y: 32 },
    { pin: "cont", text: "CTRL", x: L, y: -32 },
    { pin: "out", text: "OUT", x: L, y: 0 },
    { pin: "thres", text: "THRES", x: L, y: 16 },
    { pin: "disch", text: "DISCH", x: L, y: 32 },
  ],
  adc: [
    { pin: "vin", text: "VIN", x: -L, y: -16 },
    { pin: "vref", text: "VREF", x: -L, y: 16 },
    { pin: "com", text: "COM", x: -L, y: 32 },
    { pin: "d0", text: "D0", x: L, y: -24 },
    { pin: "d1", text: "D1", x: L, y: -8 },
    { pin: "d2", text: "D2", x: L, y: 8 },
    { pin: "d3", text: "D3", x: L, y: 24 },
  ],
  dac: [
    { pin: "d0", text: "D0", x: -L, y: -24 },
    { pin: "d1", text: "D1", x: -L, y: -8 },
    { pin: "d2", text: "D2", x: -L, y: 8 },
    { pin: "d3", text: "D3", x: -L, y: 24 },
    { pin: "vref", text: "VREF", x: L, y: -32 },
    { pin: "out", text: "OUT", x: L, y: 0 },
    { pin: "com", text: "COM", x: L, y: 32 },
  ],
  sevenSeg: [
    { pin: "a", text: "A", x: -24, y: -32 },
    { pin: "f", text: "F", x: -24, y: -16 },
    { pin: "g", text: "G", x: -24, y: 0 },
    { pin: "e", text: "E", x: -24, y: 16 },
    { pin: "com", text: "COM", x: -24, y: 32 },
    { pin: "b", text: "B", x: 24, y: -32 },
    { pin: "c", text: "C", x: 24, y: -16 },
    { pin: "d", text: "D", x: 24, y: 0 },
    { pin: "dp", text: "DP", x: 24, y: 16 },
  ],
  sampleHold: [
    { pin: "in+", text: "+", x: -NL, y: -32 },
    { pin: "in-", text: "-", x: -NL, y: -16 },
    { pin: "clk", text: "CLK", x: -NL, y: 0 },
    { pin: "sh", text: "S/H", x: -NL, y: 16 },
    { pin: "com", text: "COM", x: -NL, y: 32 },
    { pin: "out", text: "OUT", x: 6, y: 0 },
  ],
  modulator: [
    { pin: "fm", text: "FM", x: -11, y: -16 },
    { pin: "am", text: "AM", x: -11, y: 16 },
    { pin: "com", text: "COM", x: -11, y: 32 },
    { pin: "out", text: "Q", x: 14, y: 0 },
  ],
};

/** Part captions — the one piece of symbol text that names a part rather than
 *  a terminal. They ride the same counter-rotation, because the 555's caption
 *  is precisely the label that used to read upside down at 180°. */
export const PART_CAPTIONS: Partial<Record<ComponentKind, { text: string; x: number; y: number }>> = {
  timer555: { text: "555", x: 0, y: -8 },
};

function SymbolPinLabels({
  kind,
  rotation,
  mirrored,
}: {
  kind: ComponentKind;
  rotation: Rotation;
  mirrored: boolean;
}) {
  const layout = PIN_LABEL_LAYOUT[kind];
  const caption = PART_CAPTIONS[kind];
  if (!layout && !caption) return null;
  return (
    <>
      {layout?.map((label) => (
        <PinLabel
          key={label.pin}
          text={label.text}
          x={label.x}
          y={label.y}
          rotation={rotation}
          mirrored={mirrored}
        />
      ))}
      {caption && (
        <PinLabel
          text={caption.text}
          x={caption.x}
          y={caption.y}
          rotation={rotation}
          mirrored={mirrored}
        />
      )}
    </>
  );
}

/**
 * The frame every flip-flop shares: inputs down the left, the true output and
 * the bubbled complement on the right, and the reference below them. `Q̅` is
 * the one output that is always inverted, so it is the one that always carries
 * a bubble - reading the drawing tells you which pin is which without counting
 * rows against the pin table.
 */
function FlopBody({
  left,
  clockRow,
  asyncControls = false,
}: {
  left: readonly number[];
  clockRow?: number;
  asyncControls?: boolean;
}) {
  return (
    <>
      <ChipBody halfW={FLOP_HALF_W} halfH={FLOP_HALF_H} />
      <ChipLeads rows={left} side={-1} pinX={FLOP_PIN_X} bodyX={FLOP_HALF_W} />
      {clockRow !== undefined && (
        // Edge-trigger wedge, kept short so the CLK caption clears it.
        <path d={`M ${-FLOP_HALF_W} ${clockRow - 5} L -21 ${clockRow} L ${-FLOP_HALF_W} ${clockRow + 5}`} />
      )}
      {asyncControls && (
        <>
          <line x1={0} y1={-FLOP_PIN_Y} x2={0} y2={-FLOP_HALF_H} />
          <line x1={0} y1={FLOP_HALF_H} x2={0} y2={FLOP_PIN_Y} />
        </>
      )}
      <line x1={FLOP_HALF_W} y1={-16} x2={FLOP_PIN_X} y2={-16} />
      <InvertedOutputLead y={16} bodyX={FLOP_HALF_W} pinX={FLOP_PIN_X} />
      {/* COM leaves the bottom-left corner: the left column is full at the
          rows the inputs need, and both side columns are on the 16 grid. */}
      <line x1={-FLOP_HALF_W} y1={FLOP_HALF_H} x2={-FLOP_PIN_X} y2={FLOP_PIN_Y} />
    </>
  );
}

/** An output lead carrying its inversion bubble, drawn just outside a chip. */
function InvertedOutputLead({
  y,
  bodyX = CHIP_HALF_W,
  pinX = CHIP_PIN_X,
}: {
  y: number;
  bodyX?: number;
  pinX?: number;
}) {
  return (
    <>
      <circle cx={bodyX + 3} cy={y} r={3} />
      <line x1={bodyX + 6} y1={y} x2={pinX} y2={y} />
    </>
  );
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
  // The gate's body grows with its input count; this is the largest it gets
  // (five inputs), so hit-testing and label clearance never under-cover it.
  // `minX` is the XOR's outer arc, `maxX` the nose tip plus an inversion bubble.
  digitalGate: { minX: -32, minY: -40, maxX: 31, maxY: 40 },
  // Flip-flops: shared ±24 body plus the Q̅ inversion bubble reaching x = 30.
  dflop: { minX: -24, minY: -24, maxX: 30, maxY: 24 },
  srflop: { minX: -24, minY: -24, maxX: 30, maxY: 24 },
  tflop: { minX: -24, minY: -24, maxX: 30, maxY: 24 },
  jkflop: { minX: -24, minY: -24, maxX: 30, maxY: 24 },
  counter: { minX: -32, minY: -36, maxX: 32, maxY: 36 },
  timer555: { minX: -32, minY: -36, maxX: 32, maxY: 36 },
  adc: { minX: -32, minY: -36, maxX: 32, maxY: 36 },
  dac: { minX: -32, minY: -36, maxX: 32, maxY: 36 },
  sevenSeg: { minX: -32, minY: -36, maxX: 32, maxY: 36 },
  sampleHold: { minX: -24, minY: -36, maxX: 24, maxY: 36 },
  modulator: { minX: -24, minY: -36, maxX: 24, maxY: 36 },
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
  // The plate spans ±18 and the plunger reaches y = -22; the old ±14 × -18
  // box did not contain either, so a button's label could land on its stem.
  pushButton: { minX: -18, minY: -22, maxX: 18, maxY: 3 },
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
  digitalGate: { halfW: 32, halfH: 40 },
  dflop: { halfW: 30, halfH: 26 },
  srflop: { halfW: 30, halfH: 26 },
  tflop: { halfW: 30, halfH: 26 },
  jkflop: { halfW: 30, halfH: 26 },
  counter: { halfW: 34, halfH: 38 },
  timer555: { halfW: 34, halfH: 38 },
  adc: { halfW: 34, halfH: 38 },
  dac: { halfW: 34, halfH: 38 },
  sevenSeg: { halfW: 34, halfH: 38 },
  sampleHold: { halfW: 26, halfH: 38 },
  modulator: { halfW: 26, halfH: 38 },
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
  pushButton: { halfW: 18, halfH: 22 },
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
 * `value` drives the drawing wherever the part's value changes what it *is*:
 * a DC source whose value is an explicit SINE(...) gets the AC glyph, a logic
 * gate draws the function and the input count its value asks for, and a
 * switch / push button / SPDT draws its contact where the value says it sits.
 *
 * `rotation` / `mirrored` are only needed by parts that carry text: the wrapper
 * `<g>` rotates the whole symbol, so a caption has to be told how far to turn
 * back. Everything else ignores them, and a preview that passes neither gets
 * the upright drawing it wants.
 */
export function ComponentSymbol({
  kind,
  value,
  rotation = 0,
  mirrored = false,
}: {
  kind: ComponentKind;
  value?: string;
  rotation?: Rotation;
  mirrored?: boolean;
}) {
  return (
    <>
      {symbolArtwork(kind, value)}
      <SymbolPinLabels kind={kind} rotation={rotation} mirrored={mirrored} />
    </>
  );
}

function symbolArtwork(kind: ComponentKind, value?: string) {
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
      return <DigitalGateArtwork value={value} />;

    case "dflop":
      return (
        <>
          <FlopBody left={[-16, 16]} clockRow={16} asyncControls />
          {/* D-flop glyph */}
          <path d="M -4 -5 H -1 A 5 5 0 0 1 -1 5 H -4 Z" />
        </>
      );

    case "srflop":
      return (
        <>
          <FlopBody left={[-16, 16]} />
          {/* SR glyph: crossed set/reset hint */}
          <path d="M -4 -5 L 4 5 M -4 5 L 4 -5" />
        </>
      );

    case "tflop":
      return (
        <>
          <FlopBody left={[-16, 16]} clockRow={16} asyncControls />
          {/* T glyph */}
          <path d="M -4 -5 H 4 M 0 -5 V 5" />
        </>
      );

    case "jkflop":
      return (
        <>
          <FlopBody left={[-16, 0, 16]} clockRow={16} asyncControls />
          {/* No centre glyph. The D and T flops keep theirs because a single
              letter still reads when the captions are too small to; "JK" drawn
              as five strokes in nine units does not, and an illegible mark is
              worse than none. Every pin here is named, so the part identifies
              itself without it. */}
        </>
      );

    case "counter":
      return (
        <>
          <ChipBody />
          <ChipLeads rows={[-16, 16, 32]} side={-1} />
          <path d="M -32 -22 L -24 -16 L -32 -10" />
          <ChipLeads rows={[-24, -8, 8, 24]} side={1} />
          {/* binary stair glyph */}
          <path d="M -10 8 H -4 V 2 H 2 V -4 H 8 V -10" />
        </>
      );

    case "timer555":
      return (
        <>
          <ChipBody />
          <ChipLeads rows={[-32, -16, 16, 32]} side={-1} />
          <ChipLeads rows={[-32, 0, 16, 32]} side={1} />
        </>
      );

    case "adc":
      return (
        <>
          <ChipBody />
          <ChipLeads rows={[-16, 16, 32]} side={-1} />
          <ChipLeads rows={[-24, -8, 8, 24]} side={1} />
          {/* analog ramp into a bit field */}
          <path d="M -10 6 L -2 -6 L -2 6 Z" />
          <path d="M 2 -6 H 10 M 2 0 H 7 M 2 6 H 10" />
        </>
      );

    case "dac":
      return (
        <>
          <ChipBody />
          <ChipLeads rows={[-24, -8, 8, 24]} side={-1} />
          <ChipLeads rows={[-32, 0, 32]} side={1} />
          {/* bit field into an analog ramp */}
          <path d="M -10 -6 H -2 M -10 0 H -5 M -10 6 H -2" />
          <path d="M 2 -6 L 10 0 L 2 6 Z" />
        </>
      );

    case "sevenSeg":
      return (
        <>
          {/* Raw segment pins, no digit decode - so the digit is a legend for
              which lead lights which bar, and every lead is named beside it.
              (The old drawing also carried a zero-length <line> at (32,-24),
              a degenerate element that painted nothing.) */}
          <ChipBody />
          <ChipLeads rows={[-32, -16, 0, 16, 32]} side={-1} />
          <ChipLeads rows={[-32, -16, 0, 16]} side={1} />
          {/* segment "8." — narrow, so the pin names own the two side columns */}
          <path d="M -6 -22 H 6" strokeWidth={2.5} />
          <path d="M 8 -20 V -3" strokeWidth={2.5} />
          <path d="M 8 3 V 20" strokeWidth={2.5} />
          <path d="M -6 22 H 6" strokeWidth={2.5} />
          <path d="M -8 3 V 20" strokeWidth={2.5} />
          <path d="M -8 -20 V -3" strokeWidth={2.5} />
          <path d="M -6 0 H 6" strokeWidth={2.5} />
          <circle className="symbol-arrow" cx={12} cy={22} r={2} />
        </>
      );

    case "sampleHold":
      return (
        <>
          {/* Box with a pointed right nose toward the analog output (echoes
              LTspice's SpecialFunctions\sample silhouette). */}
          <NoseBody />
          {/* in+ / in- / CLK / S/H / com leads; CLK gets the edge-trigger wedge */}
          <ChipLeads rows={[-32, -16, 0, 16, 32]} side={-1} pinX={NOSE_PIN_X} bodyX={NOSE_HALF_W} />
          <path d="M -24 -5 L -18 0 L -24 5" />
          {/* analog output from the nose */}
          <line x1={NOSE_HALF_W} y1={0} x2={NOSE_PIN_X} y2={0} />
        </>
      );

    case "modulator":
      return (
        <>
          {/* Box with a pointed right nose toward the sine output (echoes the
              sampleHold silhouette; the wave glyph marks it as a VCO). */}
          <NoseBody />
          {/* FM / AM control leads plus the com reference */}
          <ChipLeads rows={[-16, 16, 32]} side={-1} pinX={NOSE_PIN_X} bodyX={NOSE_HALF_W} />
          {/* sine output from the nose */}
          <line x1={NOSE_HALF_W} y1={0} x2={NOSE_PIN_X} y2={0} />
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

    case "potentiometer": {
      /* The track is drawn symmetric about the wiper pin so its centre peak
         sits at x = 0: the wiper arrow can then land ON the track instead of
         floating 8 units above it, which is what made the part read as a fixed
         resistor with a stray chevron.

         The arrow slides with `Wiper=`. Its tail stays on the wiper pin, which
         cannot move (wires end there), so the arm slants as the tap runs off
         centre — the same way a real wiper arm pivots about its terminal. A
         centred wiper draws exactly what it always did. */
      const wx = wiperArrowX(parsePotentiometerSpec(value ?? "").wiper);
      const baseY = POT_TRACK_PEAK_Y - POT_ARROW_LEN;
      return (
        <>
          <line x1={-32} y1={0} x2={-25} y2={0} />
          <path data-track="" d={POT_TRACK_PATH} />
          <line x1={25} y1={0} x2={32} y2={0} />
          {/* Wiper: a solid arrow whose tip touches the track — the standard
              "adjustable" marking (the tap fraction is the Wiper= parameter). */}
          <line x1={0} y1={-32} x2={wx} y2={baseY} />
          <path
            data-wiper=""
            className="symbol-arrow"
            d={`M ${wx} ${POT_TRACK_PEAK_Y} L ${wx - POT_ARROW_HALF_W} ${baseY} L ${wx + POT_ARROW_HALF_W} ${baseY} Z`}
          />
        </>
      );
    }

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

    /* ── Contacts draw where they actually sit (mission item 6) ──────────────
     *
     * `schematic/actuation.ts` made these parts operable on the simulator
     * canvas, but the drawing never moved: a switch you had just closed still
     * showed an open blade, which is worse than a dead click because it says
     * the circuit is one thing while the solver runs another. The contact
     * state already lives in the value (`kindGroups.isStaticContactClosed` /
     * `isSpdtThrowToNo` - the same readers the netlist uses, so the drawing
     * cannot disagree with the deck), and the moving part pivots on the same
     * fixed contacts either way.
     *
     * A closed contact is drawn as a genuinely continuous conductor from one
     * terminal to the other, not merely as a blade nudged closer: that is what
     * makes "closed" verifiable rather than a matter of a few units of slope.
     */
    case "switch": {
      const closed = isStaticContactClosed(value ?? "");
      return (
        <>
          <line x1={-32} y1={0} x2={-12} y2={0} />
          <line x1={12} y1={0} x2={32} y2={0} />
          <circle cx={-12} cy={0} r={3} />
          <circle cx={12} cy={0} r={3} />
          {closed ? (
            <line data-contact="closed" x1={-12} y1={0} x2={12} y2={0} />
          ) : (
            <line data-contact="open" x1={-12} y1={0} x2={9} y2={-15} />
          )}
          {/* NC+/NC− control pair (unwired → the static state above holds) */}
          <line x1={-16} y1={32} x2={-16} y2={16} />
          <line x1={16} y1={32} x2={16} y2={16} />
          <line x1={-16} y1={16} x2={16} y2={16} />
        </>
      );
    }

    case "pushButton": {
      const closed = isStaticContactClosed(value ?? "");
      // The plate rests clear of the contact faces and lands on them when
      // pressed; the plunger travels with it, so the drawing shows the stroke.
      const plate = closed ? -8 : -14;
      return (
        <>
          <line x1={-32} y1={0} x2={-14} y2={0} />
          <line x1={14} y1={0} x2={32} y2={0} />
          <circle cx={-14} cy={0} r={3} />
          <circle cx={14} cy={0} r={3} />
          <line x1={-14} y1={0} x2={-14} y2={-8} />
          <line x1={14} y1={0} x2={14} y2={-8} />
          <path
            data-contact={closed ? "closed" : "open"}
            d={`M -18 ${plate} L -14 ${plate} L 14 ${plate} L 18 ${plate}`}
          />
          <line x1={0} y1={plate} x2={0} y2={-22} />
        </>
      );
    }

    case "spdt": {
      const toNo = isSpdtThrowToNo(value ?? "");
      return (
        <>
          <line x1={-32} y1={0} x2={-12} y2={0} />
          <circle cx={-12} cy={0} r={3} />
          <circle cx={12} cy={-16} r={3} />
          <circle cx={12} cy={16} r={3} />
          <line x1={12} y1={-16} x2={32} y2={-16} />
          <line x1={12} y1={16} x2={32} y2={16} />
          <line
            data-contact={toNo ? "no" : "nc"}
            x1={-12}
            y1={0}
            x2={12}
            y2={toNo ? -16 : 16}
          />
        </>
      );
    }

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
