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
  | "polarizedCapacitor"
  | "inductor"
  | "vsource"
  | "isource"
  | "vac"
  | "iac"
  | "vpulse"
  | "logicConstant"
  | "diode"
  | "led"
  | "zener"
  | "photodiode"
  | "opamp"
  | "comparator"
  | "digitalGate"
  | "dflop"
  | "srflop"
  | "tflop"
  | "jkflop"
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
  | "bulb"
  | "switch"
  | "pushButton"
  | "spdt"
  | "relay"
  | "motor"
  | "transformer"
  | "ctTransformer"
  | "tline"
  | "subckt"
  | "testpoint"
  | "ground";

/** Runtime companion to ComponentKind for validating persisted/imported data. */
export const COMPONENT_KINDS = [
  "resistor", "capacitor", "polarizedCapacitor", "inductor", "vsource", "isource", "vac", "iac", "vpulse",
  "logicConstant",
  "diode", "led", "zener", "photodiode", "opamp", "comparator", "digitalGate", "dflop", "srflop",
  "tflop", "jkflop", "sampleHold",
  "modulator", "vcvs", "vccs", "cccs", "ccvs", "bsource", "nmos", "pmos", "njf", "pjf",
  "npn", "pnp", "potentiometer", "bulb", "switch", "pushButton", "spdt", "relay", "motor",
  "transformer", "ctTransformer", "tline", "subckt", "testpoint",
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
  /** Simulation model selected by the source `.asy` defaults (often Value2).
   * Kept separate from the `.asc` instance attrs so an untouched save never
   * invents a SYMATTR record that the source file did not contain. */
  ltModelName?: string;
  /** User-owned model file declared by the source `.asy` (SpiceModel). */
  ltModelFile?: string;
  /**
   * LTspice `WINDOW` records retained from the source symbol - where that
   * symbol's attribute text is drawn. Purely presentational, but LTspice writes
   * one whenever a label is nudged, so dropping them would rewrite a quarter of
   * real schematics on save. Re-emitted verbatim by the ASC exporter when the
   * part keeps its original symbol; see {@link LtspiceWindow}.
   */
  ltWindows?: LtspiceWindow[];
  /**
   * The extended `SYMATTR` slots the source symbol carried, kept so a save can
   * put them back where LTspice expects them. See {@link LtspiceExtraAttrs}.
   */
  ltExtraAttrs?: LtspiceExtraAttrs;
  /** Internal ownership/snapshot for a component flattened from an LTspice
   * hierarchical block. The exporter suppresses it only while `original`
   * still matches the component's current electrical and geometric state. */
  ltHierarchy?: SchematicHierarchyMemberProvenance;
}

/**
 * The `SYMATTR` fields beyond `InstName`/`Value` a symbol carried on import,
 * with the `Value` they sat beside.
 *
 * These slots hold real electrical parameters, and which slot a value sits in
 * is part of its meaning: `UniversalOpamp2` reads its level from `Value` and
 * its behavior from `Value2`/`SpiceLine`. Tau folds several of them onto the
 * component's single {@link SchematicComponent.value} so the deck builder sees
 * one spec line, so writing that folded value back into `Value` alone would
 * hand LTspice a different part. The exporter restores the original split.
 */
export interface LtspiceExtraAttrs {
  /** The source symbol's own `Value`; empty when it wrote none. */
  baseValue: string;
  /**
   * The component value Tau derived from the whole set. The exporter restores
   * the original split unchanged, and can map a minimal edit back when it stays
   * wholly inside one literal source slot. An edit spanning slot boundaries is
   * still refused rather than guessed. When this equals `baseValue`, nothing
   * was folded and an edit writes straight into `Value` while the independent
   * slots remain untouched.
   */
  derivedValue: string;
  /** Every other field, in the order the file wrote them. */
  extras: Record<string, string>;
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

/** An LTspice drawing primitive: pure annotation, no electrical meaning, but it
 *  must survive a save or reopening the file loses the author's diagram. */
/** LTspice hierarchy-port direction, carried by an `IOPIN` record. Marks which
 *  nets become a sheet's ports when it is used as a subcircuit symbol. */
export type SchematicPortDirection = "In" | "Out" | "BiDir";

export interface SchematicAscShape {
  kind: "LINE" | "RECTANGLE" | "CIRCLE" | "ARC";
  /** LTspice's pen-width word, which sits between the tag and the coordinates. */
  width: "Normal" | "Wide";
  /** The record's coordinates, then LTspice's optional dash-style index. */
  coords: number[];
}

/**
 * An LTspice `DATAFLAG` record: a readout LTspice paints at a point on the
 * schematic after a run. No electrical content and Tau does not evaluate it,
 * but it must survive a save or reopening the file loses the author's readouts.
 * Mirrors {@link SchematicAscShape}'s role for drawing primitives.
 */
export interface SchematicAscDataFlag {
  x: number;
  y: number;
  /**
   * Everything after the coordinates, verbatim. LTspice quotes the expression
   * and it may contain spaces, so the remainder is carried as one opaque string
   * rather than re-joined tokens: Tau never interprets it, and re-emitting it
   * byte for byte is what keeps the save faithful.
   */
  expr: string;
}

/**
 * A source `SYMBOL` record LTspice writes that Tau has no equivalent for (e.g.
 * a vendor part like "PowerProducts\\LTC4449"). Not interpreted or simulated -
 * carried verbatim so an in-place `.asc` save re-emits the SYMBOL, its WINDOW
 * placements, and its SYMATTRs exactly as imported instead of silently
 * dropping the part. Mirrors {@link SchematicAscShape}'s role for drawing
 * primitives.
 */
export interface SchematicForeignSymbol {
  /** LTspice symbol type, e.g. "PowerProducts\\LTC4449", "Optos\\PC817D". */
  type: string;
  x: number;
  y: number;
  orientation: "R0" | "R90" | "R180" | "R270" | "M0" | "M90" | "M180" | "M270";
  /** SYMATTR name → value, verbatim - Tau does not interpret these. */
  attrs: Record<string, string>;
  /** `WINDOW` label-placement records that followed this SYMBOL, in file order. */
  windows?: LtspiceWindow[];
}

/** Exact origin of one object generated by hierarchy flattening. The compact
 * owner links it to one source `SYMBOL`; `original` is a canonical snapshot
 * used to distinguish untouched simulation scaffolding from a user edit. */
export interface SchematicHierarchyMemberProvenance {
  owner: string;
  original: string;
}

/** Counts of all flattened objects owned by one source block. A deletion is
 * detectable even though the missing object's own provenance disappeared. */
export interface SchematicHierarchyBlockProvenance {
  owner: string;
  componentCount: number;
  wireCount: number;
  netLabelCount: number;
}

/** A resolved source block plus the proof needed to re-emit it losslessly. */
export interface SchematicHierarchicalBlock extends SchematicForeignSymbol {
  provenance?: SchematicHierarchyBlockProvenance;
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
  /** See {@link SchematicHierarchyMemberProvenance}. */
  ltHierarchy?: SchematicHierarchyMemberProvenance;
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
  /**
   * Hierarchy-port direction, set when the label came from a FLAG that an
   * `IOPIN` record marked as a port. Riding on the label rather than in a
   * parallel list keeps LTspice's invariant structural: a port cannot outlive
   * the net label it names, and cannot be emitted without its FLAG.
   */
  port?: SchematicPortDirection;
  /** See {@link SchematicHierarchyMemberProvenance}. */
  ltHierarchy?: SchematicHierarchyMemberProvenance;
}

/** The active editing tool. */
export type Tool =
  | { mode: "select" }
  | {
      mode: "place";
      kind: ComponentKind;
      /** Optional value override for EveryCircuit-style palette presets (AND vs NAND, NO vs NC). */
      value?: string;
    }
  | { mode: "wire" }
  | { mode: "probe" }
  | { mode: "label" };
