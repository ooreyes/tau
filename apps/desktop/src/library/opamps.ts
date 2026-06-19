/**
 * Op-amp parts library for Tau.
 *
 * All parts use the ideal (nullor) model in simulation for now.
 * The metadata here drives the part chooser and allows future real-model
 * substitution when the ngspice engine ships.
 *
 * Specs are sourced from manufacturer datasheets; descriptions are original.
 *
 * GBW in Hz, slew rate in V/µs, supply voltages are ±V limits (e.g. 18 means
 * ±18 V max). supplyMin is the minimum single-supply or ±supply-rail magnitude.
 */

export interface OpAmpPart {
  /** Part number as it appears on the datasheet (e.g. "LM741"). */
  part: string;
  manufacturer: string;
  package: "single" | "dual" | "quad";
  /** Gain-bandwidth product in Hz. */
  gbwHz: number;
  /** Slew rate in V/µs. */
  slewRate: number;
  /** Minimum supply voltage magnitude (V, single-supply or ± rail). */
  supplyMin: number;
  /** Maximum supply voltage magnitude (V, ± rail). */
  supplyMax: number;
  /** One-line summary of what makes this part distinctive. */
  description: string;
}

export const OPAMP_LIBRARY: OpAmpPart[] = [
  {
    part: "Ideal",
    manufacturer: "Tau",
    package: "single",
    gbwHz: Infinity,
    slewRate: Infinity,
    supplyMin: 0,
    supplyMax: Infinity,
    description: "Mathematically ideal nullor — infinite gain, bandwidth, and slew rate.",
  },
  {
    part: "LM741",
    manufacturer: "Texas Instruments",
    package: "single",
    gbwHz: 1e6,
    slewRate: 0.5,
    supplyMin: 5,
    supplyMax: 18,
    description: "The 1968 workhorse op-amp, still useful as a teaching reference for classic bipolar topology.",
  },
  {
    part: "LM358",
    manufacturer: "Texas Instruments",
    package: "dual",
    gbwHz: 1e6,
    slewRate: 0.6,
    supplyMin: 1.5,
    supplyMax: 16,
    description: "Dual op-amp designed for single-supply operation down to 3 V, widely used in sensor circuits.",
  },
  {
    part: "LM324",
    manufacturer: "Texas Instruments",
    package: "quad",
    gbwHz: 1e6,
    slewRate: 0.5,
    supplyMin: 1.5,
    supplyMax: 16,
    description: "Quad single-supply amplifier that runs from a single 3 V cell, a staple in low-cost analog designs.",
  },
  {
    part: "TL071",
    manufacturer: "Texas Instruments",
    package: "single",
    gbwHz: 3e6,
    slewRate: 13,
    supplyMin: 5,
    supplyMax: 18,
    description: "JFET-input single op-amp with fast slew rate and low noise for audio and instrumentation.",
  },
  {
    part: "TL072",
    manufacturer: "Texas Instruments",
    package: "dual",
    gbwHz: 3e6,
    slewRate: 13,
    supplyMin: 5,
    supplyMax: 18,
    description: "Dual JFET-input op-amp with low noise and 13 V/µs slew rate, the go-to for hi-fi audio.",
  },
  {
    part: "TL074",
    manufacturer: "Texas Instruments",
    package: "quad",
    gbwHz: 3e6,
    slewRate: 13,
    supplyMin: 5,
    supplyMax: 18,
    description: "Quad JFET-input op-amp — four TL071s in one package for active filter banks.",
  },
  {
    part: "TL081",
    manufacturer: "Texas Instruments",
    package: "single",
    gbwHz: 3e6,
    slewRate: 13,
    supplyMin: 5,
    supplyMax: 18,
    description: "Single JFET-input op-amp, electrically similar to TL071 but with an older pinout.",
  },
  {
    part: "NE5532",
    manufacturer: "Texas Instruments",
    package: "dual",
    gbwHz: 10e6,
    slewRate: 9,
    supplyMin: 5,
    supplyMax: 15,
    description: "Legendary low-noise dual op-amp with 10 MHz GBW, dominant in studio-grade audio gear for decades.",
  },
  {
    part: "OP07",
    manufacturer: "Analog Devices",
    package: "single",
    gbwHz: 600e3,
    slewRate: 0.17,
    supplyMin: 3,
    supplyMax: 18,
    description: "Ultra-low offset voltage (25 µV) precision op-amp ideal for DC instrumentation and strain-gauge bridges.",
  },
  {
    part: "LF356",
    manufacturer: "Texas Instruments",
    package: "single",
    gbwHz: 5e6,
    slewRate: 12,
    supplyMin: 5,
    supplyMax: 18,
    description: "JFET-input op-amp with high input impedance (10¹² Ω) suited to charge-amplifier and pH-probe circuits.",
  },
  {
    part: "OPA2134",
    manufacturer: "Texas Instruments",
    package: "dual",
    gbwHz: 8e6,
    slewRate: 20,
    supplyMin: 2.5,
    supplyMax: 18,
    description: "SoundPlus dual op-amp with ultra-low THD (0.00008%) and 8 MHz GBW for audiophile-grade converters.",
  },
  {
    part: "MCP6002",
    manufacturer: "Microchip",
    package: "dual",
    gbwHz: 1e6,
    slewRate: 0.6,
    supplyMin: 1.8,
    supplyMax: 5.5,
    description: "Rail-to-rail I/O dual op-amp for 1.8 V to 5.5 V microcontroller systems with minimal quiescent current.",
  },
];

/**
 * Look up a part by its part number (case-insensitive).
 * Returns undefined when no match is found.
 */
export function findOpAmp(part: string): OpAmpPart | undefined {
  const lower = part.toLowerCase();
  return OPAMP_LIBRARY.find((p) => p.part.toLowerCase() === lower);
}
