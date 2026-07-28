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
  | "digitalGate"
  | "dflop"
  | "sampleHold"
  | "modulator"
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
  | "subckt"
  | "testpoint"
  | "ground";

/** Runtime companion to ComponentKind for validating persisted/imported data. */
export const COMPONENT_KINDS = [
  "resistor", "capacitor", "inductor", "vsource", "isource", "vac", "iac", "vpulse",
  "diode", "led", "zener", "opamp", "comparator", "digitalGate", "dflop", "sampleHold",
  "modulator", "vcvs", "vccs", "cccs", "ccvs", "bsource", "nmos", "pmos", "njf", "pjf",
  "npn", "pnp", "potentiometer", "switch", "transformer", "tline", "subckt", "testpoint",
  "ground",
] as const satisfies readonly ComponentKind[];

export function isComponentKind(value: string | undefined): value is ComponentKind {
  return !!value && (COMPONENT_KINDS as readonly string[]).includes(value);
}

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
   * Horizontal flip (mirror across the vertical axis), applied BEFORE rotation -
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
  /**
   * The exact LTspice symbol name this part was imported from (e.g. "nmos",
   * "Opamps\\AD823"). Set alongside {@link pinOverride}. When the symbol's
   * banked pin geometry round-trips fully, the ASC exporter re-emits this name
   * verbatim so the saved file keeps its original symbol identity instead of
   * being rewritten to Tau's canonical export symbol. Absent for parts placed
   * in the editor.
   */
  ltSymbolType?: string;
  /**
   * LTspice `WINDOW` records retained from the source symbol - where that
   * symbol's attribute text is drawn. Purely presentational, but LTspice writes
   * one whenever a label is nudged, so dropping them would rewrite a quarter of
   * real schematics on save. Re-emitted verbatim by the ASC exporter when the
   * part keeps its original symbol; see {@link LtspiceWindow}.
   */
  ltWindows?: LtspiceWindow[];
}

/**
 * An LTspice `WINDOW <attr> <x> <y> <justification> <size>` record: the on-canvas
 * placement of one symbol attribute's text. `attr` selects the attribute slot
 * (0 = InstName, 3 = Value, 39 = SpiceLine, …). Tau does not render these - it
 * carries them so an imported `.asc` can be saved back without moving the
 * user's labels.
 */
export interface LtspiceWindow {
  attr: number;
  x: number;
  y: number;
  /** One of {@link LTSPICE_WINDOW_JUSTIFICATIONS}. */
  justification: string;
  size: number;
}

/**
 * Justification tokens LTspice writes in a `WINDOW` record. `Invisible` hides
 * the attribute. Parsing is case-insensitive but re-emission uses this exact
 * spelling, so a record can only ever be written back well-formed.
 */
export const LTSPICE_WINDOW_JUSTIFICATIONS = [
  "Left", "Right", "Top", "Bottom", "Center",
  "VLeft", "VRight", "VTop", "VBottom", "VCenter",
  "Invisible",
] as const;

/** Canonical spelling for a justification token, or `null` if unrecognized. */
export function canonicalWindowJustification(token: string): string | null {
  const lower = token.toLowerCase();
  return LTSPICE_WINDOW_JUSTIFICATIONS.find((known) => known.toLowerCase() === lower) ?? null;
}

/** A grid-snapped point in world coordinates. */
export interface Point {
  x: number;
  y: number;
}

/**
 * An LTspice TEXT record retained with its canvas position. Directives also
 * live in `SchematicDocument.directives` for simulation; this annotation is
 * the lossless presentation record used when the `.asc` is saved again.
 */
export interface SchematicTextAnnotation {
  x: number;
  y: number;
  directive: boolean;
  text: string;
}

/** Original LTspice SHEET record retained so in-place saves keep canvas size. */
export interface SchematicSheet {
  index: number;
  width: number;
  height: number;
}

/** A wire drawn as an orthogonal polyline. Nets are derived from wires later.
 *  Optional `resistance` (engineering string, e.g. `"10m"`) models a non-ideal
 *  conductor: the wire no longer shorts its endpoints in the netlist and a
 *  series resistor is emitted instead. Empty / omitted = ideal (0 Ω). */
export interface SchematicWire {
  id: string;
  points: Point[];
  /** Series resistance in ohms (engineering notation). Ideal when absent/empty/0. */
  resistance?: string;
}

/** A meter probe pinned to a world point; resolves to whatever net sits there.
 *  With `componentId` set it is a current probe (LTspice clamp-meter) instead:
 *  it follows the component and plots its branch current `I(ref)`. */
export interface Probe {
  id: string;
  x: number;
  y: number;
  color: string;
  /** Resolved net id at placement - stabilizes dedup when the probe drifts off a wire segment. */
  netId?: string;
  componentId?: string;
}

/** A user-assigned name for a net, pinned to a world point that lies on it. */
export interface NetLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  /**
   * Text offset from the electrical anchor `(x, y)`, in world units. Both
   * undefined (never dragged, or an old .sim file predating this field) means
   * "auto-place" - Canvas.tsx resolves it via `autoNetLabelOffset` every
   * render instead of baking a placement into the document. Once the user
   * drags the label, dx/dy become explicit and auto-placement never runs
   * again for it, even if a component later moves into the old spot.
   */
  dx?: number;
  dy?: number;
}

/** The active editing tool. */
export type Tool =
  | { mode: "select" }
  | { mode: "place"; kind: ComponentKind }
  | { mode: "wire" }
  | { mode: "probe" }
  | { mode: "label" };
