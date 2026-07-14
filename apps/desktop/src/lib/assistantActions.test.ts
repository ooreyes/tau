import { describe, expect, it } from "vitest";

import {
  CREATE_ASC_TOOL_NAME,
  parseAssistantActions,
  parseCreateAscAction,
} from "./assistantActions";

const VALID_ASC = `Version 4
SHEET 1 880 680
WIRE 144 96 80 96
WIRE 304 96 224 96
WIRE 304 144 304 96
WIRE 80 192 80 96
WIRE 304 240 304 224
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

  it("never treats ordinary assistant prose or a fenced source block as a file action", () => {
    const prose = parseAssistantActions([{ type: "text", text: `Here is the file:\n\`\`\`\n${VALID_ASC}\`\`\`` }]);
    expect(prose).toEqual({ actions: [], rejected: [] });

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

  it("accepts no more than one creation action in a model turn", () => {
    const block = (id: string) => ({
      type: "tool_use",
      id,
      name: CREATE_ASC_TOOL_NAME,
      input: { filename: `${id}.asc`, source: VALID_ASC },
    });
    const result = parseAssistantActions([block("first"), block("second")]);
    expect(result.actions.map((action) => action.filename)).toEqual(["first.asc"]);
    expect(result.rejected).toEqual(["Only one circuit can be proposed in a turn."]);
  });
});
