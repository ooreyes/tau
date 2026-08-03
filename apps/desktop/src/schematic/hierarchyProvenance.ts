import type { NetLabel, SchematicComponent, SchematicWire } from "./types";

/**
 * Canonical, id-independent snapshots for the synthetic objects produced when
 * an LTspice hierarchical block is flattened for simulation. Object ids change
 * when a document is cloned/opened; electrical identity, geometry, source
 * symbol metadata, and presentation do not. These strings are deliberately
 * exact rather than lossy hashes: a collision must never let an edited child
 * disappear behind the original parent `SYMBOL` during save.
 */
export function hierarchyComponentFingerprint(component: SchematicComponent): string {
  return JSON.stringify({
    kind: component.kind,
    x: component.x,
    y: component.y,
    rotation: component.rotation,
    mirrored: component.mirrored === true,
    value: component.value,
    label: component.label,
    pinOverride: (component.pinOverride ?? []).map((pin) => ({
      id: pin.id,
      label: pin.label,
      x: pin.x,
      y: pin.y,
    })),
    ltSymbolType: component.ltSymbolType ?? null,
    ltWindows: (component.ltWindows ?? []).map((window) => ({ ...window })),
  });
}

export function hierarchyWireFingerprint(wire: SchematicWire): string {
  return JSON.stringify({
    points: wire.points.map((point) => ({ x: point.x, y: point.y })),
    resistance: wire.resistance ?? null,
  });
}

export function hierarchyNetLabelFingerprint(label: NetLabel): string {
  return JSON.stringify({
    x: label.x,
    y: label.y,
    text: label.text,
    dx: label.dx ?? null,
    dy: label.dy ?? null,
    port: label.port ?? null,
  });
}
