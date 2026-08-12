import { describe, expect, it } from "vitest";
import { sourceValueLabel } from "./Canvas.geometry";

const thin = "\u2009";

/**
 * the canvas value label used to blindly suffix a catalog "unit"
 * onto the whole value string. For kinds that store several fields in one
 * string (comparator, vpulse - and previously tline), that produced garbled
 * text like "1 0Vhi Vlo" instead of a real per-field format. Each multi-field
 * kind now gets its own formatter built from the same `decodeParams` the
 * inspector uses. Units sit next to the number with a thin space so digits
 * don't collide with the unit glyph.
 */
describe("sourceValueLabel", () => {
  it("suffixes a plain single-value kind's unit as before (resistor)", () => {
    expect(sourceValueLabel("resistor", "1k")).toBe(`1k${thin}Ω`);
  });

  it("does not double-suffix a value that already carries its unit", () => {
    expect(sourceValueLabel("resistor", "1kΩ")).toBe("1kΩ");
  });

  it("formats AC sources as 'amplitude @ frequency' (pre-existing bespoke case)", () => {
    expect(sourceValueLabel("vac", "1 1k")).toBe(`1${thin}V @ 1k${thin}Hz`);
    expect(sourceValueLabel("iac", "5m 2k")).toBe(`5m${thin}A @ 2k${thin}Hz`);
  });

  it("summarizes independent-source waveforms without raw SPICE functions", () => {
    expect(sourceValueLabel("vsource", "SINE(0 7.5 1k)")).toBe(`Sine · 7.5${thin}V @ 1k${thin}Hz`);
    expect(sourceValueLabel("isource", "PULSE(0 5m 0 1u 1u 5u 10u)")).toBe(`Pulse · 0${thin}A→5m${thin}A`);
    expect(sourceValueLabel("vsource", "PWL(0 0 1m 5 2m 0)")).toBe("Piecewise · 3 points");
  });

  it("keeps a gate's input count off the label, where the drawing already says it", () => {
    // Every imported LTspice gate now carries `Inputs=` (the symbol's own
    // count), and the body draws that many leads. Printing the token beside the
    // symbol as well is raw syntax the reader did not write.
    expect(sourceValueLabel("digitalGate", "and Inputs=5")).toBe("and");
    expect(sourceValueLabel("digitalGate", "and Inputs=3 Vhigh=5")).toBe("and Vhigh=5");
    expect(sourceValueLabel("digitalGate", "nand")).toBe("nand");
  });

  it("names a potentiometer's track and tap as two quantities, not one string", () => {
    // The tap became a canvas control under mission item 6, so `Wiper=` reaches
    // this label constantly. The catalog unit belongs to the track only.
    expect(sourceValueLabel("potentiometer", "10k")).toBe(`10k${thin}Ω`);
    expect(sourceValueLabel("potentiometer", "10k Wiper=0.5")).toBe(`10k${thin}Ω`);
    expect(sourceValueLabel("potentiometer", "10k Wiper=0.8")).toBe(`10k${thin}Ω · 80%`);
    expect(sourceValueLabel("potentiometer", "10k Wiper=0")).toBe(`10k${thin}Ω · 0%`);
    expect(sourceValueLabel("potentiometer", "10k Wiper=1")).toBe(`10k${thin}Ω · 100%`);
  });

  it("formats the comparator as high/low volts, not a garbled unit suffix", () => {
    expect(sourceValueLabel("comparator", "1 0")).toBe(`1${thin}V/0${thin}V`);
    expect(sourceValueLabel("comparator", "")).toBe(`1${thin}V/0${thin}V`); // default spec
  });

  it("appends hysteresis to the comparator label only when non-zero", () => {
    expect(sourceValueLabel("comparator", "5 0 0.1")).toBe(`5${thin}V/0${thin}V ±0.1${thin}V`);
    expect(sourceValueLabel("comparator", "Vhigh=3.3 Vlow=0 Vhyst=0")).toBe(`3.3${thin}V/0${thin}V`);
  });

  it("formats a pulse source as 'low→high @ frequency', not one unit smeared across four tokens", () => {
    expect(sourceValueLabel("vpulse", "0 5 100k 0.5")).toBe(`0${thin}V→5${thin}V @ 100k${thin}Hz`);
  });

  it("shows the transmission line's key=value spec as raw text (no bogus 'Ω s' unit)", () => {
    expect(sourceValueLabel("tline", "Td=50n Z0=50")).toBe("Td=50n Z0=50");
  });

  // `ideal` is the schema's internal model token, and printing it verbatim
  // captioned every generic op-amp on the sheet with a word that describes
  // Tau's bookkeeping rather than the circuit (review item 13).
  it("captions a generic op-amp with its gain, or with nothing", () => {
    expect(sourceValueLabel("opamp", "ideal")).toBe("");
    expect(sourceValueLabel("opamp", "")).toBe("");
    expect(sourceValueLabel("opamp", "ideal Gain=200k")).toBe("200k\u2009V/V");
    expect(sourceValueLabel("opamp", "ideal Vmin=-12 Vmax=12")).toBe("");
  });

  it("never hides a named or imported op-amp's own identity", () => {
    expect(sourceValueLabel("opamp", "LT1001")).toBe("LT1001");
    expect(sourceValueLabel("opamp", "LT1001 Gain=1Meg")).toBe("LT1001");
  });

  it("keeps subcircuit knobs in Properties instead of the sketch label", () => {
    expect(sourceValueLabel("subckt", "deadtime dead=300n level=5")).toBe("deadtime");
  });
});

/**
 * P3-07 - "Absolutely no overlap between labels EVER."
 *
 * Evidence `img-004-006.png`: a capacitor's "1u F" and a resistor's "1k Ω"
 * printed through each other as "1u F1k Ω". Three separate mechanisms produced
 * it, and this describe is the invariant that keeps all three shut:
 *
 * (A) the placement search had no escalation - when every candidate slot
 *     overlapped, `placeOverlay` returned the LEAST-overlapping one and the
 *     canvas drew it, overlap and all;
 * (B) the width estimate (5.5 / 4.9 px per character) under-measured the real
 *     ink by 21-26%, so the search scored colliding slots as clear;
 * (C) net labels had both faults independently.
 *
 * The assertions below are deliberately over RENDERED rects - the text that is
 * actually inked, measured through the same `labelLineRect` the placer uses -
 * rather than over the placer's own opinion of where things are.
 */
import {
  LABEL_TEXT_ADVANCE,
  LABEL_TEXT_HEIGHT,
  autoNetLabelOffsets,
  buildLabelPlacements,
  componentWorldRect,
  labelLineRect,
  netLabelTextRect,
} from "./Canvas.geometry";
import { overlapArea } from "./overlayPlacement";
import type { Rect } from "./overlayPlacement";
import type { ComponentKind, NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import { readFileSync } from "node:fs";

/** Mulberry32. Seeded so a failure is reproducible from the seed alone - a
 *  property test that finds a different counter-example every run cannot be
 *  debugged. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Every text line a placement actually draws, exactly as `ComponentLabels`
 *  renders it: the refdes (absent when the part has none), the value caption
 *  as the placer decided to shorten it, or the lone ellipsis affordance. */
const drawnLines = (
  placements: ReturnType<typeof buildLabelPlacements>,
  component: SchematicComponent,
): Array<{ text: string; rect: Rect }> => {
  const placement = placements.get(component.id);
  if (!placement) return [];
  const lines: Array<{ text: string; rect: Rect }> = [];
  if (placement.refText) {
    lines.push({
      text: placement.refText,
      rect: labelLineRect(placement.refText, placement.ref.x, placement.ref.y, placement.ref.anchor, "ref"),
    });
  }
  if (placement.valText) {
    lines.push({
      text: placement.valText,
      rect: labelLineRect(placement.valText, placement.val.x, placement.val.y, placement.val.anchor, "val"),
    });
  }
  return lines;
};

const describeRect = (r: Rect) =>
  `[${r.minX.toFixed(1)},${r.minY.toFixed(1)} .. ${r.maxX.toFixed(1)},${r.maxY.toFixed(1)}]`;

/** Every pairwise text-on-text collision in one layout, as a readable report. */
const textCollisions = (components: SchematicComponent[], wires: SchematicWire[]) => {
  const placements = buildLabelPlacements(components, wires);
  const lines = components.flatMap((c) =>
    drawnLines(placements, c).map((line) => ({ ...line, owner: c.id })),
  );
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[i].owner === lines[j].owner) continue;
      const area = overlapArea(lines[i].rect, lines[j].rect);
      if (area > 0) {
        hits.push(
          `"${lines[i].text}" ${describeRect(lines[i].rect)} over `
          + `"${lines[j].text}" ${describeRect(lines[j].rect)} = ${area.toFixed(1)}`,
        );
      }
    }
  }
  return hits;
};

/** Every label-on-someone-else's-artwork collision in one layout. */
const artworkCollisions = (components: SchematicComponent[], wires: SchematicWire[]) => {
  const placements = buildLabelPlacements(components, wires);
  const hits: string[] = [];
  for (const owner of components) {
    for (const line of drawnLines(placements, owner)) {
      for (const other of components) {
        if (other.id === owner.id) continue;
        const area = overlapArea(line.rect, componentWorldRect(other));
        if (area > 0) {
          hits.push(`${owner.id}'s "${line.text}" on ${other.id} (${other.kind}) = ${area.toFixed(1)}`);
        }
      }
    }
  }
  return hits;
};

const layoutSource = (components: SchematicComponent[]) =>
  JSON.stringify(components.map((c) => [c.id, c.kind, c.x, c.y, c.rotation, c.value]));

describe("label placement never emits an overlap (P3-07)", () => {
  /** The exact pair from the evidence screenshot: a capacitor and a resistor,
   *  both rotated 90, six grid units apart. `dx = 96` is the spacing at which
   *  the old estimate scored the slot clear and the browser inked "1u F1k Ω". */
  it("keeps the evidence pair apart (img-004-006: C1 1u over R1 1k)", () => {
    const layout: SchematicComponent[] = [
      { id: "c1", kind: "capacitor", x: 0, y: 0, rotation: 90, value: "1u", label: "C1" },
      { id: "r1", kind: "resistor", x: 96, y: 0, rotation: 90, value: "1k", label: "R1" },
    ];
    expect(textCollisions(layout, [])).toEqual([]);
  });

  /** The worst placer-admitted case found by sweeping randomised layouts
   *  against the old code: six parts on a 16-unit grid, every rotation. */
  it("keeps the worst measured six-part crowd apart", () => {
    const layout: SchematicComponent[] = [
      { id: "R1", kind: "resistor", x: 80, y: 0, rotation: 0, value: "1k", label: "R1" },
      { id: "N2", kind: "nmos", x: 0, y: 0, rotation: 180, value: "NMOS", label: "N2" },
      { id: "C3", kind: "capacitor", x: 16, y: 0, rotation: 90, value: "1u", label: "C3" },
      { id: "L4", kind: "led", x: 64, y: 0, rotation: 180, value: "red", label: "L4" },
      { id: "C5", kind: "capacitor", x: 80, y: 32, rotation: 270, value: "10u", label: "C5" },
      { id: "R6", kind: "resistor", x: 80, y: 80, rotation: 180, value: "4.7k", label: "R6" },
    ];
    expect(textCollisions(layout, [])).toEqual([]);
    expect(artworkCollisions(layout, [])).toEqual([]);
  });

  const KINDS: Array<{ kind: ComponentKind; prefix: string; values: string[] }> = [
    { kind: "resistor", prefix: "R", values: ["1k", "4.7k", "100", "2.2Meg"] },
    { kind: "capacitor", prefix: "C", values: ["1u", "100n", "4.7p"] },
    { kind: "polarizedCapacitor", prefix: "C", values: ["10u", "470u"] },
    { kind: "inductor", prefix: "L", values: ["1m", "10u"] },
    { kind: "diode", prefix: "D", values: ["1N4148", "D"] },
    { kind: "led", prefix: "D", values: ["red", "green"] },
    { kind: "nmos", prefix: "M", values: ["NMOS", "Si4864DY"] },
    // The longest caption on the sheet, and the one the old estimator missed by
    // 23 px: "Sine · 1 V @ 1k Hz".
    { kind: "vsource", prefix: "V", values: ["SINE(0 1 1k)", "5", "PULSE(0 5 0 1u 1u 5u 10u)"] },
  ];

  /** Dense randomised layouts: 2-6 parts, all four rotations, mirrored or not,
   *  on a 16-unit grid (one grid pitch apart is a legal placement, and the
   *  reported bug was two parts six pitches apart). */
  const layouts = (count: number, seed: number): SchematicComponent[][] => {
    const random = rng(seed);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
    const out: SchematicComponent[][] = [];
    for (let i = 0; i < count; i += 1) {
      const parts = 2 + Math.floor(random() * 5);
      const components: SchematicComponent[] = [];
      for (let p = 0; p < parts; p += 1) {
        const spec = pick(KINDS);
        components.push({
          id: `${spec.prefix}${p + 1}`,
          kind: spec.kind,
          x: Math.floor(random() * 7) * 16,
          y: Math.floor(random() * 7) * 16,
          rotation: pick([0, 90, 180, 270] as const),
          mirrored: random() < 0.25 ? true : undefined,
          value: pick(spec.values),
          label: `${spec.prefix}${p + 1}`,
        });
      }
      out.push(components);
    }
    return out;
  };

  it("never inks one label through another, over 400 dense random layouts", () => {
    const failures: string[] = [];
    for (const layout of layouts(400, 0xc0ffee)) {
      const hits = textCollisions(layout, []);
      if (hits.length > 0) failures.push(`${layoutSource(layout)}\n    ${hits.join("\n    ")}`);
    }
    expect(failures.length, `text-on-text overlaps:\n  ${failures.slice(0, 6).join("\n  ")}`).toBe(0);
  });

  it("never inks a label over another part's artwork, over 400 dense random layouts", () => {
    const failures: string[] = [];
    for (const layout of layouts(400, 0x5eed)) {
      const hits = artworkCollisions(layout, []);
      if (hits.length > 0) failures.push(`${layoutSource(layout)}\n    ${hits.join("\n    ")}`);
    }
    expect(failures.length, `label-on-artwork overlaps:\n  ${failures.slice(0, 6).join("\n  ")}`).toBe(0);
  });

  it("holds with wires threaded through the layout", () => {
    const failures: string[] = [];
    const random = rng(0xbeef);
    for (const layout of layouts(200, 0xbeef)) {
      const y = Math.floor(random() * 7) * 16;
      const wires: SchematicWire[] = [
        { id: "w1", points: [{ x: -32, y }, { x: 160, y }] },
        { id: "w2", points: [{ x: 48, y: -32 }, { x: 48, y: 160 }] },
      ];
      const hits = [...textCollisions(layout, wires), ...artworkCollisions(layout, wires)];
      if (hits.length > 0) failures.push(`${layoutSource(layout)}\n    ${hits.join("\n    ")}`);
    }
    expect(failures.length, `overlaps with wires:\n  ${failures.slice(0, 6).join("\n  ")}`).toBe(0);
  });

  it("never inks a net label through component text, over 200 random layouts", () => {
    const failures: string[] = [];
    const random = rng(0x1abe1);
    for (const layout of layouts(200, 0x1abe1)) {
      const labels: NetLabel[] = [
        { id: "n1", x: Math.floor(random() * 7) * 16, y: Math.floor(random() * 7) * 16, text: "out" },
        { id: "n2", x: Math.floor(random() * 7) * 16, y: Math.floor(random() * 7) * 16, text: "vbias" },
      ];
      const offsets = autoNetLabelOffsets(labels, layout, []);
      const netRects = labels.map((l) => {
        const o = offsets.get(l.id)!;
        return { text: l.text, rect: netLabelTextRect(l, o.dx, o.dy, l.text) };
      });
      const placements = buildLabelPlacements(layout, []);
      const componentLines = layout.flatMap((c) => drawnLines(placements, c));
      const hits: string[] = [];
      for (const net of netRects) {
        for (const line of componentLines) {
          const area = overlapArea(net.rect, line.rect);
          if (area > 0) hits.push(`net "${net.text}" over "${line.text}" = ${area.toFixed(1)}`);
        }
      }
      for (let i = 0; i < netRects.length; i += 1) {
        for (let j = i + 1; j < netRects.length; j += 1) {
          const area = overlapArea(netRects[i].rect, netRects[j].rect);
          if (area > 0) hits.push(`net "${netRects[i].text}" over net "${netRects[j].text}" = ${area.toFixed(1)}`);
        }
      }
      if (hits.length > 0) failures.push(`${layoutSource(layout)}\n    ${hits.join("\n    ")}`);
    }
    expect(failures.length, `net-label overlaps:\n  ${failures.slice(0, 6).join("\n  ")}`).toBe(0);
  });
});

/**
 * The advance constants are font arithmetic, not a DOM measurement (node tests
 * cannot call `measureText`), so the thing that can rot is their agreement with
 * the stylesheet. The comment on `NET_LABEL_CHAR_W` had already rotted - it
 * claimed the net label rendered at "9.5px mono" while App.css said 11px - and
 * that stale comment is why the number was 5.8 instead of 6.5.
 */
describe("label advance constants are derived from App.css, not guessed", () => {
  const css = readFileSync(new URL("../App.css", import.meta.url), "utf8");

  /** Merge every top-level block whose selector list mentions `selector`, in
   *  source order, so a later override wins the way the cascade would. */
  const declarations = (selector: string) => {
    const merged = new Map<string, string>();
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1].split(",").map((s) => s.trim());
      if (!selectors.includes(selector)) continue;
      for (const decl of match[2].split(";")) {
        const [prop, ...rest] = decl.split(":");
        if (rest.length === 0) continue;
        merged.set(prop.trim(), rest.join(":").trim());
      }
    }
    return merged;
  };

  /** `font-size * advance-ratio + letter-spacing`, with the ratio of the widest
   *  face in `--font-mono` (Menlo, 1233/2048 em). */
  const advance = (selector: string) => {
    const decls = declarations(selector);
    const size = Number.parseFloat(decls.get("font-size")!);
    const tracking = Number.parseFloat(decls.get("letter-spacing")!);
    expect(size, `${selector} font-size`).toBeGreaterThan(0);
    expect(Number.isFinite(tracking), `${selector} letter-spacing`).toBe(true);
    return size * (1233 / 2048) + size * tracking;
  };

  it("matches .label-layer .ref", () => {
    expect(LABEL_TEXT_ADVANCE.ref).toBeCloseTo(advance(".label-layer .ref"), 2);
    expect(LABEL_TEXT_HEIGHT.ref).toBe(Number.parseFloat(declarations(".label-layer .ref").get("font-size")!));
  });

  it("matches .label-layer .val", () => {
    expect(LABEL_TEXT_ADVANCE.val).toBeCloseTo(advance(".label-layer .val"), 2);
    expect(LABEL_TEXT_HEIGHT.val).toBe(Number.parseFloat(declarations(".label-layer .val").get("font-size")!));
  });

  it("matches .net-label-text", () => {
    expect(LABEL_TEXT_ADVANCE.net).toBeCloseTo(advance(".net-label-text"), 2);
  });
});

