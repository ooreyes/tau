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
  | "nmos"
  | "pmos"
  | "npn"
  | "pnp"
  | "potentiometer"
  | "switch"
  | "transformer"
  | "testpoint"
  | "ground";

/** Allowed component rotations, in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

/** A placed component. Coordinates are world units and grid-snapped. */
export interface SchematicComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  rotation: Rotation;
  /** Display value, e.g. "1k", "10µ", "5V". */
  value: string;
  /** Reference designator, e.g. "R1". Empty for ground. */
  label: string;
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

/** A meter probe pinned to a world point; resolves to whatever net sits there. */
export interface Probe {
  id: string;
  x: number;
  y: number;
  color: string;
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
