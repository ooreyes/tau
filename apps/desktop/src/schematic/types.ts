/**
 * Schematic document model (Phase 1, app-local).
 *
 * Canonical home is `@tau/schematic-core`; these are kept here during early
 * iteration for speed (see DESIGN_LOG.md → OQ3).
 */

/** The kinds of parts Tau can place in the v0 editor. */
export type ComponentKind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "vsource"
  | "isource"
  | "vac"
  | "iac"
  | "vpulse"
  | "diode"
  | "led"
  | "zener"
  | "opamp"
  | "comparator"
  | "vcvs"
  | "vccs"
  | "cccs"
  | "ccvs"
  | "bsource"
  | "nmos"
  | "pmos"
  | "njf"
  | "pjf"
  | "npn"
  | "pnp"
  | "potentiometer"
  | "switch"
  | "transformer"
  | "tline"
  | "testpoint"
  | "ground";

/** Allowed component rotations, in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * An absolute, world-coordinate pin position that overrides a component's
 * built-in (kind + rotation) pin geometry. Used by the LTspice importer, whose
 * symbols have different pin spacing than Tau's fixed symbols (e.g. an LTspice
 * resistor is 80 units pin-to-pin vs Tau's 64). Carrying world pin positions
 * lets imported parts meet the original wires exactly so nets extract as
 * LTspice intends. `id`/`label` map to the component kind's pin roles in order.
 */
export interface PinOverride {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** A placed component. Coordinates are world units and grid-snapped. */
export interface SchematicComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  rotation: Rotation;
  /**
   * Horizontal flip (mirror across the vertical axis), applied BEFORE rotation —
   * matching LTspice's `M*` orientations and {@link transformLtPoint}. Absent or
   * `false` means not mirrored. Toggled by Ctrl+E in the editor.
   */
  mirrored?: boolean;
  /** Display value, e.g. "1k", "10µ", "5V". */
  value: string;
  /** Reference designator, e.g. "R1". Empty for ground. */
  label: string;
  /**
   * Optional absolute world pin positions overriding the kind's built-in
   * geometry (see {@link PinOverride}). Set by the LTspice importer; absent for
   * parts placed in the editor (which use rotated kind geometry).
   */
  pinOverride?: PinOverride[];
}

/** A grid-snapped point in world coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** A wire drawn as an orthogonal polyline. Nets are derived from wires later. */
export interface SchematicWire {
  id: string;
  points: Point[];
}

/** A meter probe pinned to a world point; resolves to whatever net sits there.
 *  With `componentId` set it is a current probe (LTspice clamp-meter) instead:
 *  it follows the component and plots its branch current `I(ref)`. */
export interface Probe {
  id: string;
  x: number;
  y: number;
  color: string;
  componentId?: string;
}

/** A user-assigned name for a net, pinned to a world point that lies on it. */
export interface NetLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

/** The active editing tool. */
export type Tool =
  | { mode: "select" }
  | { mode: "place"; kind: ComponentKind }
  | { mode: "wire" }
  | { mode: "probe" };
