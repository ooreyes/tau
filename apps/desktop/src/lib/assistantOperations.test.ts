import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "../simulation/linearTransient";
import { EMPTY_SCOPE } from "../simulation/paramScope";
import {
  executeAssistantOperation,
  findAssistantOperation,
  INSPECT_SIGNAL_TOOL_NAME,
  type AssistantOperationRequest,
} from "./assistantOperations";

function successfulRun(): AnalysisResult {
  return {
    ok: true,
    title: "Transient",
    times: [0, 0.25, 0.5, 0.75, 1],
    traces: [{ id: "out", label: "V(out)", unit: "V", color: "var(--trace-cyan)", values: [0, 2, 0, -2, 0] }],
    currents: [],
    stats: { netCount: 1, componentCount: 1, sampleCount: 5, stopTime: 1, stepSize: 0.25 },
    warnings: [],
    circuit: { nets: [], components: [], groundNetId: "0", warnings: [] },
  };
}

const request = (input: unknown): AssistantOperationRequest => ({
  id: "inspect-1",
  name: INSPECT_SIGNAL_TOOL_NAME,
  input,
});

describe("assistant internal simulation operations", () => {
  it("computes real expression statistics from the completed transient snapshot", () => {
    const result = executeAssistantOperation(request({ expression: "V(out)" }), {
      analysis: successfulRun(),
      params: EMPTY_SCOPE,
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content)).toEqual(expect.objectContaining({
      ok: true,
      expression: "V(out)",
      unit: "V",
      samples: 5,
      duration: 1,
      minimum: -2,
      maximum: 2,
      average: 0,
      rms: Math.SQRT2,
      final: 0,
      signalKind: "transient",
    }));
  });

  it("returns a private error result rather than fabricating data without a run or known signal", () => {
    const noRun = executeAssistantOperation(request({ expression: "V(out)" }), {
      analysis: null,
      params: EMPTY_SCOPE,
    });
    expect(noRun.ok).toBe(false);
    expect(JSON.parse(noRun.content).error).toMatch(/run a transient analysis/i);

    const missing = executeAssistantOperation(request({ expression: "V(missing)" }), {
      analysis: successfulRun(),
      params: EMPTY_SCOPE,
    });
    expect(missing.ok).toBe(false);
    expect(JSON.parse(missing.content).error).toMatch(/no finite values/i);
  });

  it("rejects malformed inputs at the operation boundary", () => {
    expect(executeAssistantOperation(request({ expression: "V(out)", extra: true }), {
      analysis: successfulRun(),
      params: EMPTY_SCOPE,
    }).ok).toBe(false);
    expect(executeAssistantOperation(request({ expression: "\nV(out)" }), {
      analysis: successfulRun(),
      params: EMPTY_SCOPE,
    }).ok).toBe(false);
  });

  it("recognizes only the private operation tool, never ordinary assistant text", () => {
    expect(findAssistantOperation([{ type: "text", text: "inspect V(out)" }])).toBeNull();
    expect(findAssistantOperation([{
      type: "tool_use",
      id: "inspect-2",
      name: INSPECT_SIGNAL_TOOL_NAME,
      input: { expression: "V(out)" },
    }])).toEqual({
      id: "inspect-2",
      name: INSPECT_SIGNAL_TOOL_NAME,
      input: { expression: "V(out)" },
    });
  });
});
