import { describe, it, expect } from "vitest";
import { EXAMPLE_CIRCUITS } from "./circuits";
import { runTransientAnalysis } from "../simulation/linearTransient";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { SYMBOL_BODY } from "../schematic/symbols";
import type { ComponentKind, Point, SchematicComponent } from "../schematic/types";

const OPTIONS = { stopTime: 0.005, steps: 200 };

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const rotatePoint = (point: Point, rotation: number): Point => {
  switch (rotation) {
    case 90:
      return { x: -point.y, y: point.x };
    case 180:
      return { x: -point.x, y: -point.y };
    case 270:
      return { x: point.y, y: -point.x };
    default:
      return point;
  }
};

const bodyRect = (kind: ComponentKind, x: number, y: number, rotation: number, inset = 0): Rect => {
  const body = SYMBOL_BODY[kind];
  const corners = [
    { x: body.minX, y: body.minY },
    { x: body.maxX, y: body.minY },
    { x: body.maxX, y: body.maxY },
    { x: body.minX, y: body.maxY },
  ].map((point) => rotatePoint(point, rotation));
  return {
    minX: x + Math.min(...corners.map((point) => point.x)) + inset,
    minY: y + Math.min(...corners.map((point) => point.y)) + inset,
    maxX: x + Math.max(...corners.map((point) => point.x)) - inset,
    maxY: y + Math.max(...corners.map((point) => point.y)) - inset,
  };
};

const rectsOverlap = (a: Rect, b: Rect) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

const segmentRect = (a: Point, b: Point): Rect => ({
  minX: Math.min(a.x, b.x) - 1,
  minY: Math.min(a.y, b.y) - 1,
  maxX: Math.max(a.x, b.x) + 1,
  maxY: Math.max(a.y, b.y) + 1,
});

const componentLabel = (component: SchematicComponent) =>
  component.label || `${component.kind}@${component.x},${component.y}`;

describe("EXAMPLE_CIRCUITS", () => {
  for (const circuit of EXAMPLE_CIRCUITS) {
    describe(circuit.name, () => {
      it("keeps component bodies from overlapping", () => {
        for (let i = 0; i < circuit.components.length; i += 1) {
          const a = circuit.components[i];
          const aRect = bodyRect(a.kind, a.x, a.y, a.rotation);
          for (let j = i + 1; j < circuit.components.length; j += 1) {
            const b = circuit.components[j];
            const bRect = bodyRect(b.kind, b.x, b.y, b.rotation);
            expect(
              rectsOverlap(aRect, bRect),
              `${circuit.name}: ${componentLabel(a)} overlaps ${componentLabel(b)}`,
            ).toBe(false);
          }
        }
      });

      it("routes example wires around symbol bodies", () => {
        for (const wire of circuit.wires) {
          for (let i = 1; i < wire.points.length; i += 1) {
            const segment = segmentRect(wire.points[i - 1], wire.points[i]);
            for (const component of circuit.components) {
              const body = bodyRect(component.kind, component.x, component.y, component.rotation, 4);
              expect(
                rectsOverlap(segment, body),
                `${circuit.name}: ${wire.id} crosses ${componentLabel(component)}`,
              ).toBe(false);
            }
          }
        }
      });

      it("simulates without error", () => {
        if (circuit.nativeOnly) {
          // Nonlinear (native-engine) circuit: the TS solver rejects it by
          // design, so validate the builder produces a runnable ngspice deck.
          const deck = buildSpiceDeck(
            { components: circuit.components, wires: circuit.wires },
            { kind: "tran", stopTime: OPTIONS.stopTime, steps: OPTIONS.steps },
          );
          expect(deck.netlist).toMatch(/\.tran /);
          expect(deck.netlist.trim().endsWith(".end")).toBe(true);
          expect(deck.circuit.warnings).toEqual([]);
          return;
        }
        const result = runTransientAnalysis(
          { components: circuit.components, wires: circuit.wires },
          OPTIONS,
        );
        expect(
          result.ok,
          `Circuit "${circuit.name}" failed: ${result.ok ? "" : result.message}`,
        ).toBe(true);
      });

      it("has at least one trace with real variation", () => {
        if (circuit.nativeOnly) {
          // Validate the derived netlist's topology instead of TS-simulating.
          const deck = buildSpiceDeck(
            { components: circuit.components, wires: circuit.wires },
            { kind: "tran", stopTime: OPTIONS.stopTime, steps: OPTIONS.steps },
          );
          const nonGround = deck.circuit.nets.filter((net) => !net.isGround);
          expect(nonGround.length).toBeGreaterThanOrEqual(4);
          return;
        }
        const result = runTransientAnalysis(
          { components: circuit.components, wires: circuit.wires },
          OPTIONS,
        );

        // This guard should never fire given the test above, but keeps TS happy.
        if (!result.ok) throw new Error(`Circuit "${circuit.name}" failed: ${result.message}`);

        expect(result.traces.length).toBeGreaterThanOrEqual(1);

        if (circuit.id === "divider.v1") {
          // Voltage divider: the mid-node should settle at ~5 V (DC).
          // The circuit has two non-ground nodes (top rail at 10 V, mid at 5 V).
          // Assert that at least one trace has a final value near 5 V.
          const hasMidNode = result.traces.some((trace) => {
            const finalValue = trace.values[trace.values.length - 1];
            return finalValue > 4.5 && finalValue < 5.5;
          });
          expect(
            hasMidNode,
            `Voltage divider: no trace found near 5 V. Traces: ${result.traces
              .map((t) => `${t.label}=${t.values[t.values.length - 1].toFixed(3)} V`)
              .join(", ")}`,
          ).toBe(true);
        } else {
          // All dynamic circuits must have a trace that actually changes.
          const hasVariation = result.traces.some((trace) => {
            const max = Math.max(...trace.values);
            const min = Math.min(...trace.values);
            return max - min > 1e-6;
          });
          expect(
            hasVariation,
            `Circuit "${circuit.name}" traces show no variation (max - min ≤ 1e-6)`,
          ).toBe(true);
        }
      });
    });
  }
});
