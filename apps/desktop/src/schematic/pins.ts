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
  ground: [{ id: "g", label: "0", x: 0, y: 0 }],
};

export const getLocalPins = (kind: ComponentKind): LocalPin[] => LOCAL_PINS[kind];

export function getComponentPins(component: SchematicComponent): ComponentPin[] {
  return getLocalPins(component.kind).map((pin) => {
    const rotated = rotatePoint(pin, component.rotation);
    return {
      ...pin,
      x: component.x + rotated.x,
      y: component.y + rotated.y,
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
