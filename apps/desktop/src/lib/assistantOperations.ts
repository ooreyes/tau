/**
 * Read-only internal operations available to Tau's assistant after a real
 * simulation. Tool calls and their results stay in the API conversation and
 * are never rendered as chat messages.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { AnalysisResult } from "../simulation/linearTransient";
import { classifySignal, traceStatistics } from "../simulation/measurementModel";
import type { ParamScope } from "../simulation/paramScope";
import { evaluatePlotExpression } from "../simulation/plotExpression";

export const INSPECT_SIGNAL_TOOL_NAME = "inspect_simulation_signal";

export const INSPECT_SIGNAL_TOOL = {
  name: INSPECT_SIGNAL_TOOL_NAME,
  description:
    "Privately inspect an expression from the most recent completed transient result. "
    + "Use only when exact waveform statistics are needed to answer the user's question and are absent from the supplied summary. "
    + "Do not mention this tool, its expression, or its payload to the user; answer directly from its result.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      expression: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "A Tau/LTspice plot expression such as V(out), I(R1), V(out)-V(in), or V(out)*I(R1).",
      },
    },
    required: ["expression"],
  },
} satisfies Anthropic.Tool;

export interface AssistantOperationRequest {
  id: string;
  name: typeof INSPECT_SIGNAL_TOOL_NAME;
  input: unknown;
}

export interface AssistantOperationContext {
  analysis: AnalysisResult | null;
  params: ParamScope;
}

export interface AssistantOperationResult {
  ok: boolean;
  /** Compact JSON intended only for a `tool_result` content block. */
  content: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function findAssistantOperation(content: readonly unknown[]): AssistantOperationRequest | null {
  for (const block of content) {
    const candidate = record(block);
    if (!candidate || candidate.type !== "tool_use" || candidate.name !== INSPECT_SIGNAL_TOOL_NAME) continue;
    if (typeof candidate.id !== "string" || !candidate.id || candidate.id.length > 160) return null;
    return { id: candidate.id, name: INSPECT_SIGNAL_TOOL_NAME, input: candidate.input };
  }
  return null;
}

function failure(message: string): AssistantOperationResult {
  return { ok: false, content: JSON.stringify({ ok: false, error: message }) };
}

/** Execute one bounded, read-only operation against the supplied run snapshot. */
export function executeAssistantOperation(
  request: AssistantOperationRequest,
  context: AssistantOperationContext,
): AssistantOperationResult {
  const input = record(request.input);
  if (!input || Object.keys(input).some((key) => key !== "expression")) {
    return failure("Invalid signal-inspection request.");
  }
  if (typeof input.expression !== "string") return failure("The expression must be text.");
  if (input.expression.length > 200 || /[\u0000-\u001f]/.test(input.expression)) {
    return failure("The expression is empty or invalid.");
  }
  const expression = input.expression.trim();
  if (!expression) return failure("The expression is empty or invalid.");

  const evaluated = evaluatePlotExpression(
    expression,
    context.analysis,
    "var(--trace-cyan)",
    context.params.scope,
    context.params.funcs,
  );
  if (!evaluated.ok) return failure(evaluated.error);
  if (!context.analysis?.ok) return failure("No successful transient analysis is available.");

  const statistics = traceStatistics(context.analysis.times, evaluated.trace.values);
  if (!statistics) return failure("The expression has no finite samples.");
  const classification = classifySignal(context.analysis.times, evaluated.trace.values);

  return {
    ok: true,
    content: JSON.stringify({
      ok: true,
      expression,
      unit: evaluated.trace.unit,
      samples: Math.min(context.analysis.times.length, evaluated.trace.values.length),
      duration: context.analysis.times.length > 0
        ? context.analysis.times[context.analysis.times.length - 1]
        : 0,
      minimum: statistics.min,
      maximum: statistics.max,
      average: statistics.average,
      rms: statistics.rms,
      final: statistics.final,
      signalKind: classification.kind,
      ...(classification.frequency !== undefined ? { frequency: classification.frequency } : {}),
      ...(classification.period !== undefined ? { period: classification.period } : {}),
    }),
  };
}
