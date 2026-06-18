import type { ComponentKind } from "./types";

/** World pixels per grid cell. Components span a few cells; pins land on grid. */
export const GRID = 16;

/**
 * Renders the bare symbol for a component, centered on its origin (0,0).
 * Stroke/fill come from CSS (`.symbol` class on the parent <g>).
 *
 * Pin convention (used later for wiring):
 *  - 2-terminal horizontal parts: pins at (-32, 0) and (32, 0)
 *  - vertical source parts:        pins at (0, -32) and (0, 32)
 *  - ground:                       single pin at (0, 0)
 */
export function ComponentSymbol({ kind }: { kind: ComponentKind }) {
  switch (kind) {
    case "resistor":
      return (
        <>
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <path d="M -24 0 L -18 -10 L -10 10 L -2 -10 L 6 10 L 14 -10 L 22 10 L 28 0" />
          <line x1={28} y1={0} x2={32} y2={0} />
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

    case "inductor":
      return (
        <>
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <path d="M -24 0 A 6 6 0 0 1 -12 0 A 6 6 0 0 1 0 0 A 6 6 0 0 1 12 0 A 6 6 0 0 1 24 0" />
          <line x1={24} y1={0} x2={32} y2={0} />
        </>
      );

    case "vsource":
      return (
        <>
          <line x1={0} y1={-32} x2={0} y2={-15} />
          <circle cx={0} cy={0} r={15} />
          {/* + */}
          <line x1={-4} y1={-6} x2={4} y2={-6} />
          <line x1={0} y1={-10} x2={0} y2={-2} />
          {/* − */}
          <line x1={-4} y1={7} x2={4} y2={7} />
          <line x1={0} y1={15} x2={0} y2={32} />
        </>
      );

    case "isource":
      return (
        <>
          <line x1={0} y1={-32} x2={0} y2={-15} />
          <circle cx={0} cy={0} r={15} />
          <path d="M 0 -9 V 8" />
          <path d="M -5 3 L 0 9 L 5 3" />
          <line x1={0} y1={15} x2={0} y2={32} />
        </>
      );

    case "vac":
      return (
        <>
          <line x1={0} y1={-32} x2={0} y2={-15} />
          <circle cx={0} cy={0} r={15} />
          <path d="M -10 0 C -6 -10 -2 -10 2 0 S 10 10 14 0" />
          <line x1={0} y1={15} x2={0} y2={32} />
        </>
      );

    case "iac":
      return (
        <>
          <line x1={0} y1={-32} x2={0} y2={-15} />
          <circle cx={0} cy={0} r={15} />
          <path d="M -10 -5 C -6 -15 -2 -15 2 -5 S 10 5 14 -5" />
          <path d="M 0 1 V 10" />
          <path d="M -5 5 L 0 11 L 5 5" />
          <line x1={0} y1={15} x2={0} y2={32} />
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

    case "opamp":
      return (
        <>
          <path d="M -24 -26 L -24 26 L 30 0 Z" />
          <line x1={-32} y1={-16} x2={-24} y2={-16} />
          <line x1={-32} y1={16} x2={-24} y2={16} />
          <line x1={30} y1={0} x2={32} y2={0} />
          <line x1={0} y1={-32} x2={0} y2={-14} />
          <line x1={0} y1={14} x2={0} y2={32} />
          <path d="M -20 16 H -12 M -16 12 V 20" />
          <path d="M -20 -16 H -12" />
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
          <path d="M 11 5 L 4 0 L 11 -5" />
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
          <path d="M 4 0 L 11 5 L 11 -5 Z" />
        </>
      );

    case "npn":
      return (
        <>
          <line x1={-32} y1={0} x2={-6} y2={0} />
          <line x1={-6} y1={-18} x2={-6} y2={18} />
          <line x1={-6} y1={-8} x2={16} y2={-32} />
          <line x1={-6} y1={8} x2={16} y2={32} />
          <path d="M 7 23 L 16 32 L 4 29" />
        </>
      );

    case "pnp":
      return (
        <>
          <line x1={-32} y1={0} x2={-6} y2={0} />
          <line x1={-6} y1={-18} x2={-6} y2={18} />
          <line x1={-6} y1={-8} x2={16} y2={-32} />
          <line x1={-6} y1={8} x2={16} y2={32} />
          <path d="M 5 17 L -4 8 L 8 11" />
        </>
      );

    case "potentiometer":
      return (
        <>
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <path d="M -24 0 L -18 -10 L -10 10 L -2 -10 L 6 10 L 14 -10 L 22 10 L 28 0" />
          <line x1={28} y1={0} x2={32} y2={0} />
          <line x1={0} y1={-32} x2={0} y2={-9} />
          <path d="M -8 -16 L 0 -8 L 8 -16" />
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
        </>
      );

    case "transformer":
      return (
        <>
          <line x1={-32} y1={-16} x2={-22} y2={-16} />
          <line x1={-32} y1={16} x2={-22} y2={16} />
          <path d="M -22 -16 A 7 7 0 0 1 -22 -2 A 7 7 0 0 1 -22 12 A 7 7 0 0 1 -22 26" />
          <line x1={-2} y1={-25} x2={-2} y2={25} />
          <line x1={2} y1={-25} x2={2} y2={25} />
          <path d="M 22 -16 A 7 7 0 0 0 22 -2 A 7 7 0 0 0 22 12 A 7 7 0 0 0 22 26" />
          <line x1={22} y1={-16} x2={32} y2={-16} />
          <line x1={22} y1={16} x2={32} y2={16} />
        </>
      );

    case "testpoint":
      return (
        <>
          <circle cx={0} cy={0} r={10} />
          <line x1={0} y1={10} x2={0} y2={28} />
          <path d="M -8 -14 H 8 M 0 -14 V -2" />
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
