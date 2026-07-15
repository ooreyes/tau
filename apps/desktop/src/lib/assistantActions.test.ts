import { describe, expect, it } from "vitest";

import {
  APPLY_CURRENT_ASC_TOOL_NAME,
  CREATE_ASC_TOOL_NAME,
  carryAssistantProbes,
  parseAssistantActions,
  parseApplyCurrentAscAction,
  parseCreateAscAction,
} from "./assistantActions";

const VALID_ASC = `Version 4
SHEET 1 880 680
WIRE 144 96 80 96
WIRE 304 96 224 96
WIRE 304 144 304 96
WIRE 80 192 80 96
WIRE 304 240 304 208
FLAG 80 192 0
FLAG 304 240 0
FLAG 304 96 vout
SYMBOL res 240 80 R90
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL cap 288 144 R0
SYMATTR InstName C1
SYMATTR Value 1u
SYMBOL voltage 80 80 R0
SYMATTR InstName V1
SYMATTR Value PULSE(0 5 0 1n 1n 1m 2m)
TEXT 72 280 Left 2 !.tran 5m
`;
const APPLY_ASC = VALID_ASC.replace("TEXT 72 280", "TEXT 0 0");

describe("assistant ASC action boundary", () => {
  it("turns a strict tool payload into validated ASC source and an importable document", () => {
    const action = parseCreateAscAction("tool-1", { filename: "rc-low-pass", source: VALID_ASC });

    expect(action.type).toBe("create_asc");
    expect(action.filename).toBe("rc-low-pass.asc");
    expect(action.source).toBe(VALID_ASC);
    expect(action.componentCount).toBe(3);
    expect(action.wireCount).toBe(5);
    expect(action.document.components.map((component) => component.label)).toEqual(["R1", "C1", "V1", "", ""]);
    expect(action.document.directives).toEqual([".tran 5m"]);
  });

  it("validates a complete current-circuit replacement through the same ASC boundary", () => {
    const action = parseApplyCurrentAscAction("apply-1", { source: APPLY_ASC });

    expect(action.type).toBe("apply_current_asc");
    expect(action.source).toBe(APPLY_ASC);
    expect(action.componentCount).toBe(3);
    expect(action.document.components.map((component) => component.label)).toEqual(["R1", "C1", "V1", "", ""]);
    expect(() => parseApplyCurrentAscAction("apply-2", { source: APPLY_ASC, filename: "escape.asc" })).toThrow(/unknown fields/i);
    expect(() => parseApplyCurrentAscAction("apply-3", {
      source: APPLY_ASC.replace(/FLAG \d+ \d+ 0\n/g, ""),
    })).toThrow(/ground reference/i);
    expect(() => parseApplyCurrentAscAction("apply-4", { source: VALID_ASC })).toThrow(/losslessly/i);
  });

  it("re-resolves voltage probes and follows same-reference current probes across apply", () => {
    const action = parseApplyCurrentAscAction("apply-probes", { source: APPLY_ASC });
    const nextR1 = action.document.components.find((component) => component.label === "R1")!;
    const currentComponents = [
      { ...nextR1, id: "old-r1" },
      { ...nextR1, id: "removed", label: "R9" },
    ];
    const carried = carryAssistantProbes(currentComponents, [
      { id: "pv", x: 144, y: 96, color: "var(--trace-red)", netId: "stale" },
      { id: "pi", x: 0, y: 0, color: "var(--trace-green)", componentId: "old-r1" },
      { id: "gone", x: 0, y: 0, color: "var(--trace-amber)", componentId: "removed" },
    ], action.document);

    expect(carried.map((probe) => probe.id)).toEqual(["pv", "pi"]);
    expect(carried[0].netId).not.toBe("stale");
    expect(carried[1]).toMatchObject({ componentId: nextR1.id, x: nextR1.x, y: nextR1.y });
  });

  it("never treats ordinary assistant prose or a fenced source block as a file action", () => {
    const prose = parseAssistantActions([{ type: "text", text: `Here is the file:\n\`\`\`\n${VALID_ASC}\`\`\`` }]);
    expect(prose).toEqual({ actions: [], rejected: [], rejectedToolUses: [] });

    const fenced = parseAssistantActions([{
      type: "tool_use",
      id: "tool-2",
      name: CREATE_ASC_TOOL_NAME,
      input: { filename: "filter.asc", source: `\`\`\`asc\n${VALID_ASC}\`\`\`` },
    }]);
    expect(fenced.actions).toEqual([]);
    expect(fenced.rejected).toHaveLength(1);
  });

  it("rejects traversal, unsupported records, and circuits without a ground reference", () => {
    expect(() => parseCreateAscAction("tool-3", { filename: "../escape.asc", source: VALID_ASC })).toThrow(/safe leaf/i);
    expect(() => parseCreateAscAction("tool-4", {
      filename: "unsafe.asc",
      source: `${VALID_ASC}TOTALLY_UNKNOWN 1 2 3\n`,
    })).toThrow(/unsupported ASC records/i);
    expect(() => parseCreateAscAction("tool-5", {
      filename: "floating.asc",
      source: VALID_ASC.replace(/FLAG \d+ \d+ 0\n/g, ""),
    })).toThrow(/ground reference/i);
  });

  it("rejects electrically dangling pins before a generated file can be created", () => {
    const disconnected = VALID_ASC.replace("WIRE 144 96 80 96\n", "");
    expect(() => parseCreateAscAction("tool-dangling", {
      filename: "broken.asc",
      source: disconnected,
    })).toThrow(/electrically incomplete.*only connected to one pin/i);
  });

  it("accepts no more than one create-or-apply action in a model turn", () => {
    const createBlock = (id: string) => ({
      type: "tool_use",
      id,
      name: CREATE_ASC_TOOL_NAME,
      input: { filename: `${id}.asc`, source: VALID_ASC },
    });
    const applyBlock = {
      type: "tool_use",
      id: "apply-second",
      name: APPLY_CURRENT_ASC_TOOL_NAME,
      input: { source: APPLY_ASC },
    };
    const result = parseAssistantActions([createBlock("first"), applyBlock]);
    expect(result.actions.map((action) => action.type === "create_asc" ? action.filename : action.type)).toEqual(["first.asc"]);
    expect(result.rejected).toEqual(["Only one circuit change can be proposed in a turn."]);
  });
});
