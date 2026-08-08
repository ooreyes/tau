import { getComponentPins, transformPoint } from "./pins";
import type { ComponentKind, Point, SchematicComponent, SchematicWire } from "./types";

/**
 * Terminals that have moved on a part since documents were saved against them.
 *
 * A saved document records where its wires end, not which pin they meant. When
 * a part is redrawn and a terminal changes coordinates, every wire that reached
 * it stays exactly where it was and the pin quietly stops being connected: the
 * circuit still opens, still runs, and now solves differently. That is the one
 * outcome this file exists to prevent.
 *
 * Redrawing a part therefore means adding a row here, the same way retiring a
 * kind means adding a row to {@link ./retiredKinds}.
 *
 * **Nothing here moves a wire.** Relocation was considered and rejected on the
 * evidence: the DAC's VREF crossed from the left edge to the right and the
 * 7-segment was re-banked onto two new columns, so "reattach the endpoint"
 * would route a conductor straight through the body, and the smaller 16-unit
 * moves would leave a diagonal or a bend the user never drew. Redrawing
 * somebody's schematic to make it match a new symbol is a worse answer than
 * telling them which two wires to move. So the parts are named and the drawing
 * is left alone.
 */

/** Local (unrotated) coordinates a terminal used to occupy, with its old name. */
interface FormerPin {
  id: string;
  label: string;
  x: number;
  y: number;
  /**
   * How to get this terminal back, when the part no longer has it at all.
   *
   * Absent means "it can be restored from Properties" — the gate's inputs 3..5
   * are a count away. Present means the part genuinely does not have that
   * terminal any more and the sentence says what to do instead, because
   * "reattach the wire" would be advice the reader cannot follow.
   */
  retiredFix?: string;
}

const former = (id: string, label: string, x: number, y: number): FormerPin => ({ id, label, x, y });

/** A terminal the part no longer has, with the sentence that replaces it. */
const retired = (id: string, label: string, x: number, y: number, retiredFix: string): FormerPin =>
  ({ id, label, x, y, retiredFix });

/**
 * What to tell someone whose wire ended on a gate's second output or its
 * reference. Both were LTspice's A-device pin contract showing through the
 * symbol rather than anything the function has.
 */
const GATE_OUTPUT_FIX =
  "A logic gate now draws its single output on the centreline: use the complementary "
  + "function (AND↔NAND, OR↔NOR, XOR↔XNOR, buffer↔NOT) where you need the inverted sense.";
const GATE_COM_FIX =
  "A placed gate no longer exposes the COM reference — its levels are referred to ground, "
  + "which is what a grounded COM already meant.";

/**
 * Positions as of before the 2026-08-08 digital redraw (mission items 5 and 9).
 *
 * Only terminals that actually moved are listed; a pin whose coordinates are
 * unchanged is skipped by the comparison below in any case, so a redundant row
 * is harmless and a missing one is the bug.
 */
export const FORMER_PIN_POSITIONS: ReadonlyMap<ComponentKind, readonly FormerPin[]> = new Map([
  // Item 5 pulled every digital terminal inside |y| = 32 so nothing clipped the
  // palette preview, and moved the COM reference onto a pin column.
  ["dflop", [former("pre", "PRE", 0, -48), former("clr", "CLR", 0, 48), former("com", "COM", -32, 48)]],
  ["tflop", [former("pre", "PRE", 0, -48), former("clr", "CLR", 0, 48), former("com", "COM", -32, 48)]],
  ["srflop", [former("com", "COM", -32, 48)]],
  ["jkflop", [
    former("j", "J", -32, -24),
    former("clk", "CLK", -32, 24),
    former("pre", "PRE", 0, -48),
    former("clr", "CLR", 0, 48),
    former("com", "COM", -32, 48),
  ]],
  ["counter", [former("com", "COM", 0, 48)]],
  ["adc", [former("com", "COM", 0, 48)]],
  ["dac", [former("vref", "VREF", -40, 40), former("com", "COM", 0, 48)]],
  ["sevenSeg", [
    former("a", "A", -8, -48),
    former("b", "B", 32, -24),
    former("c", "C", 32, 24),
    former("d", "D", -8, 48),
    former("e", "E", -32, 24),
    former("f", "F", -32, -24),
    former("dp", "DP", 40, 40),
    former("com", "COM", 0, 56),
  ]],
  ["sampleHold", [former("com", "COM", 0, 48)]],
  ["modulator", [former("com", "COM", 0, 48)]],
  // Item 9 made the gate's input count configurable. A gate saved before it
  // exposed all five inputs at these rows whatever it was, so a gate whose
  // value names no count now exposes two and in3..in5 are gone from the part
  // entirely - not moved, absent. `getComponentPins` reports them as missing
  // and the notice says so, because the fix is a different one: raise the
  // count. (A gate already set to five inputs sits on these exact rows, so it
  // reports nothing.)
  //
  // The single-output redraw then moved Q onto the centreline and retired both
  // the complementary output and the COM reference, which LTspice's `.asy` has
  // and a logic gate does not. Q is the row that matters most here: it is the
  // terminal most gates actually have a wire on.
  ["digitalGate", [
    former("in1", "1", -32, -32),
    former("in2", "2", -32, -16),
    former("in3", "3", -32, 0),
    former("in4", "4", -32, 16),
    former("in5", "5", -32, 32),
    former("q", "Q", 32, -16),
    retired("qbar", "Q̅", 32, 16, GATE_OUTPUT_FIX),
    // Three COM rows, because the reference moved twice before it was retired:
    // (0,48) is pre-item-5, then it followed the body — (-16,32) on a short
    // gate, (32,32) on a tall one. A row that no wire reaches costs nothing.
    retired("com", "COM", 0, 48, GATE_COM_FIX),
    retired("com", "COM", -16, 32, GATE_COM_FIX),
    retired("com", "COM", 32, 32, GATE_COM_FIX),
  ]],
]);

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** True when `point` is an endpoint of, or lies on, any segment of any wire. */
function wireTouches(wires: readonly SchematicWire[], point: Point): boolean {
  for (const wire of wires) {
    for (let index = 1; index < wire.points.length; index += 1) {
      const a = wire.points[index - 1];
      const b = wire.points[index];
      if (samePoint(a, point) || samePoint(b, point)) return true;
      // Axis-aligned interior hit. Tau routes wires orthogonally, and a
      // terminal landing mid-segment is connected exactly like an endpoint.
      if (a.x === b.x && point.x === a.x
        && point.y > Math.min(a.y, b.y) && point.y < Math.max(a.y, b.y)) return true;
      if (a.y === b.y && point.y === a.y
        && point.x > Math.min(a.x, b.x) && point.x < Math.max(a.x, b.x)) return true;
    }
  }
  return false;
}

export interface StrandedTerminal {
  componentId: string;
  /** Reference designator, or the kind when the part was never named. */
  name: string;
  /** Terminals a wire still reaches that the part has since moved away from. */
  moved: string[];
  /** Terminals a wire still reaches that this instance can expose again. */
  missing: string[];
  /** Terminals the part does not have any more, with the sentence that says
   *  what to do instead (one entry per distinct sentence). */
  retired: Array<{ labels: string[]; fix: string }>;
}

/**
 * Parts whose wires end where a terminal used to be and nowhere near where it
 * is now.
 *
 * Both halves of that are required. A terminal is allowed to be unconnected -
 * most COM pins are - so the trigger is positive evidence that a conductor was
 * drawn to the old position, plus the absence of one at the new position. A
 * part whose wires were already correct produces nothing, and so does a part
 * that has been reconnected since.
 *
 * Imported parts are skipped outright: `pinOverride` carries absolute
 * coordinates taken from the source file's own symbol, so those terminals never
 * moved with Tau's artwork.
 */
export function strandedTerminals(
  components: readonly SchematicComponent[],
  wires: readonly SchematicWire[],
): StrandedTerminal[] {
  if (wires.length === 0) return [];
  const stranded: StrandedTerminal[] = [];
  for (const component of components) {
    const formerPins = FORMER_PIN_POSITIONS.get(component.kind);
    if (!formerPins || component.pinOverride?.length) continue;
    const current = new Map(getComponentPins(component).map((pin) => [pin.id, pin]));
    const moved: string[] = [];
    const missing: string[] = [];
    const retiredByFix = new Map<string, string[]>();
    for (const pin of formerPins) {
      const offset = transformPoint(pin, component.rotation, component.mirrored ?? false);
      const was = { x: component.x + offset.x, y: component.y + offset.y };
      const now = current.get(pin.id);
      if (now && samePoint(now, was)) continue;
      if (!wireTouches(wires, was)) continue;
      if (now && wireTouches(wires, now)) continue;
      if (now) {
        moved.push(now.label || pin.label);
      } else if (pin.retiredFix) {
        const labels = retiredByFix.get(pin.retiredFix) ?? [];
        // A terminal that moved twice before it was retired has a row per
        // position; naming it twice in one sentence would just read as a bug.
        if (!labels.includes(pin.label)) labels.push(pin.label);
        retiredByFix.set(pin.retiredFix, labels);
      } else {
        missing.push(pin.label);
      }
    }
    const retired = [...retiredByFix].map(([fix, labels]) => ({ labels, fix }));
    if (moved.length > 0 || missing.length > 0 || retired.length > 0) {
      stranded.push({
        componentId: component.id,
        name: component.label.trim() || component.kind,
        moved,
        missing,
        retired,
      });
    }
  }
  return stranded;
}

/** "A", "A and B", "A, B and C". */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One sentence per affected part, naming its terminals and the way back. */
export function strandedTerminalNotices(
  components: readonly SchematicComponent[],
  wires: readonly SchematicWire[],
): string[] {
  return strandedTerminals(components, wires).map((entry) => {
    const parts: string[] = [];
    if (entry.moved.length > 0) {
      const terminals = entry.moved.length === 1 ? "terminal" : "terminals";
      parts.push(
        `${entry.name}: wires still end where the ${listOf(entry.moved)} ${terminals} sat before this part was `
        + `redrawn, so ${entry.moved.length === 1 ? "it is" : "they are"} no longer connected. `
        + "Reattach them in Schematic.",
      );
    }
    if (entry.missing.length > 0) {
      const terminals = entry.missing.length === 1 ? "input" : "inputs";
      parts.push(
        `${entry.name}: wires still reach ${terminals} ${listOf(entry.missing)}, which this part no longer has. `
        + "Raise its input count in Properties to get them back.",
      );
    }
    for (const group of entry.retired) {
      const terminals = group.labels.length === 1 ? "terminal" : "terminals";
      parts.push(
        `${entry.name}: wires still reach the ${listOf(group.labels)} ${terminals}, which this part no longer `
        + `has. ${group.fix}`,
      );
    }
    return parts.join(" ");
  });
}
