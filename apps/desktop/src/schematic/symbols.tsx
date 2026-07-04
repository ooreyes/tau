import type { ComponentKind } from "./types";

/** World pixels per grid cell. Components span a few cells; pins land on grid. */
export const GRID = 16;

/** Accurate local bounding box of each symbol's drawn body (excludes pin leads).
 *  Unlike SYMBOL_BOX these are NOT assumed symmetric about the origin — e.g.
 *  ground is drawn entirely below its pin — so they give correct hit-testing
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
  inductor: { minX: -26, minY: -10, maxX: 26, maxY: 10 },
  vsource: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  isource: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  vac: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  iac: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  vpulse: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  diode: { minX: -13, minY: -15, maxX: 13, maxY: 15 },
  led: { minX: -13, minY: -15, maxX: 16, maxY: 15 },
  zener: { minX: -13, minY: -15, maxX: 16, maxY: 15 },
  opamp: { minX: -24, minY: -26, maxX: 30, maxY: 26 },
  comparator: { minX: -24, minY: -26, maxX: 30, maxY: 26 },
  digitalGate: { minX: -24, minY: -38, maxX: 28, maxY: 40 },
  dflop: { minX: -24, minY: -40, maxX: 24, maxY: 40 },
  sampleHold: { minX: -24, minY: -40, maxX: 24, maxY: 40 },
  modulator: { minX: -24, minY: -32, maxX: 24, maxY: 32 },
  vcvs: { minX: -18, minY: -22, maxX: 18, maxY: 22 },
  vccs: { minX: -18, minY: -22, maxX: 18, maxY: 22 },
  cccs: { minX: -18, minY: -22, maxX: 18, maxY: 22 },
  ccvs: { minX: -18, minY: -22, maxX: 18, maxY: 22 },
  bsource: { minX: -16, minY: -16, maxX: 16, maxY: 16 },
  nmos: { minX: -12, minY: -20, maxX: 18, maxY: 20 },
  pmos: { minX: -12, minY: -20, maxX: 18, maxY: 20 },
  njf: { minX: -12, minY: -20, maxX: 18, maxY: 20 },
  pjf: { minX: -12, minY: -20, maxX: 18, maxY: 20 },
  npn: { minX: -8, minY: -20, maxX: 18, maxY: 20 },
  pnp: { minX: -8, minY: -20, maxX: 18, maxY: 20 },
  potentiometer: { minX: -28, minY: -18, maxX: 28, maxY: 12 },
  switch: { minX: -14, minY: -20, maxX: 14, maxY: 8 },
  transformer: { minX: -24, minY: -27, maxX: 24, maxY: 27 },
  tline: { minX: -20, minY: -16, maxX: 20, maxY: 16 },
  testpoint: { minX: -11, minY: -16, maxX: 11, maxY: 14 },
  ground: { minX: -12, minY: -3, maxX: 12, maxY: 22 },
};

/** Half-extents of each symbol body (excludes pin leads), used to keep labels clear of the symbol. */
export const SYMBOL_BOX: Record<ComponentKind, { halfW: number; halfH: number }> = {
  resistor: { halfW: 30, halfH: 12 },
  capacitor: { halfW: 8, halfH: 15 },
  inductor: { halfW: 26, halfH: 9 },
  vsource: { halfW: 16, halfH: 17 },
  isource: { halfW: 16, halfH: 17 },
  vac: { halfW: 16, halfH: 17 },
  iac: { halfW: 16, halfH: 17 },
  vpulse: { halfW: 16, halfH: 17 },
  diode: { halfW: 14, halfH: 15 },
  led: { halfW: 18, halfH: 22 },
  zener: { halfW: 16, halfH: 18 },
  opamp: { halfW: 28, halfH: 28 },
  comparator: { halfW: 28, halfH: 28 },
  digitalGate: { halfW: 28, halfH: 40 },
  dflop: { halfW: 26, halfH: 42 },
  sampleHold: { halfW: 26, halfH: 42 },
  modulator: { halfW: 26, halfH: 34 },
  vcvs: { halfW: 20, halfH: 24 },
  vccs: { halfW: 20, halfH: 24 },
  cccs: { halfW: 20, halfH: 24 },
  ccvs: { halfW: 20, halfH: 24 },
  bsource: { halfW: 16, halfH: 17 },
  nmos: { halfW: 26, halfH: 20 },
  pmos: { halfW: 26, halfH: 20 },
  njf: { halfW: 26, halfH: 20 },
  pjf: { halfW: 26, halfH: 20 },
  npn: { halfW: 22, halfH: 20 },
  pnp: { halfW: 22, halfH: 20 },
  potentiometer: { halfW: 30, halfH: 18 },
  switch: { halfW: 14, halfH: 20 },
  transformer: { halfW: 24, halfH: 27 },
  tline: { halfW: 20, halfH: 18 },
  testpoint: { halfW: 11, halfH: 16 },
  ground: { halfW: 12, halfH: 22 },
};

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

    case "vpulse":
      return (
        <>
          <line x1={0} y1={-32} x2={0} y2={-15} />
          <circle cx={0} cy={0} r={15} />
          {/* pulse train: low–high–low–high */}
          <path d="M -10 5 L -10 -5 L -2 -5 L -2 5 L 6 5 L 6 -5 L 10 -5" />
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

    case "comparator":
      return (
        <>
          {/* Same triangle body as the op-amp; pins on the −16/+16 grid. */}
          <path d="M -24 -26 L -24 26 L 30 0 Z" />
          <line x1={-32} y1={-16} x2={-24} y2={-16} />
          <line x1={-32} y1={16} x2={-24} y2={16} />
          <line x1={30} y1={0} x2={32} y2={0} />
          {/* + on the lower input, − on the upper (matches pin geometry). */}
          <path d="M -20 16 H -12 M -16 12 V 20" />
          <path d="M -20 -16 H -12" />
          {/* hysteresis/step glyph marks it as a comparator, not an op-amp */}
          <path d="M -8 6 H 0 V -6 H 8" fill="none" />
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
          <path d="M -14 0 Q -10 -10 -6 0 Q -2 10 2 0 Q 6 -10 10 0" fill="none" />
        </>
      );

    case "vcvs":
      return (
        <>
          {/* 2-port block: control pair (left), output pair (right) */}
          <rect x={-14} y={-20} width={28} height={40} rx={2} />
          <line x1={-32} y1={-16} x2={-14} y2={-16} />
          <line x1={-32} y1={16} x2={-14} y2={16} />
          <line x1={14} y1={-16} x2={32} y2={-16} />
          <line x1={14} y1={16} x2={32} y2={16} />
          {/* source diamond */}
          <path d="M 0 -11 L 9 0 L 0 11 L -9 0 Z" />
          {/* + / − (voltage source) */}
          <line x1={-3} y1={-5} x2={3} y2={-5} />
          <line x1={0} y1={-8} x2={0} y2={-2} />
          <line x1={-3} y1={6} x2={3} y2={6} />
        </>
      );

    case "vccs":
      return (
        <>
          {/* 2-port block: control pair (left), output pair (right) */}
          <rect x={-14} y={-20} width={28} height={40} rx={2} />
          <line x1={-32} y1={-16} x2={-14} y2={-16} />
          <line x1={-32} y1={16} x2={-14} y2={16} />
          <line x1={14} y1={-16} x2={32} y2={-16} />
          <line x1={14} y1={16} x2={32} y2={16} />
          {/* source diamond */}
          <path d="M 0 -11 L 9 0 L 0 11 L -9 0 Z" />
          {/* current arrow (top → bottom) */}
          <line x1={0} y1={-7} x2={0} y2={6} />
          <path d="M -3 1 L 0 7 L 3 1" />
        </>
      );

    case "cccs":
      return (
        <>
          {/* 2-port block: current-sense pair (left), output pair (right) */}
          <rect x={-14} y={-20} width={28} height={40} rx={2} />
          <line x1={-32} y1={-16} x2={-14} y2={-16} />
          <line x1={-32} y1={16} x2={-14} y2={16} />
          <line x1={14} y1={-16} x2={32} y2={-16} />
          <line x1={14} y1={16} x2={32} y2={16} />
          {/* control current-sense arrow on the left port (cp → cn) */}
          <line x1={-11} y1={-12} x2={-11} y2={11} />
          <path d="M -14 6 L -11 12 L -8 6" />
          {/* source diamond */}
          <path d="M 4 -11 L 13 0 L 4 11 L -5 0 Z" />
          {/* output current arrow (top → bottom) */}
          <line x1={4} y1={-7} x2={4} y2={6} />
          <path d="M 1 1 L 4 7 L 7 1" />
        </>
      );

    case "ccvs":
      return (
        <>
          {/* 2-port block: current-sense pair (left), output pair (right) */}
          <rect x={-14} y={-20} width={28} height={40} rx={2} />
          <line x1={-32} y1={-16} x2={-14} y2={-16} />
          <line x1={-32} y1={16} x2={-14} y2={16} />
          <line x1={14} y1={-16} x2={32} y2={-16} />
          <line x1={14} y1={16} x2={32} y2={16} />
          {/* control current-sense arrow on the left port (cp → cn) */}
          <line x1={-11} y1={-12} x2={-11} y2={11} />
          <path d="M -14 6 L -11 12 L -8 6" />
          {/* source diamond */}
          <path d="M 4 -11 L 13 0 L 4 11 L -5 0 Z" />
          {/* + / − (voltage source) */}
          <line x1={1} y1={-5} x2={7} y2={-5} />
          <line x1={4} y1={-8} x2={4} y2={-2} />
          <line x1={1} y1={6} x2={7} y2={6} />
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
          <path d="M -6 -5 L 4 0 L -6 5" />
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
          <path d="M 2 -5 L -6 0 L 2 5" />
        </>
      );

    case "potentiometer":
      return (
        <>
          <line x1={-32} y1={0} x2={-24} y2={0} />
          <path d="M -24 0 L -20 -10 L -12 10 L -4 -10 L 4 10 L 12 -10 L 20 10 L 24 0" />
          <line x1={24} y1={0} x2={32} y2={0} />
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
