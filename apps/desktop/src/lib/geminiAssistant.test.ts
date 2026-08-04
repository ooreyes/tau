import { describe, expect, it } from "vitest";
import { GeminiAssistant, GEMINI_MODEL_PRESETS, GEMINI_DEFAULT_MODEL } from "./geminiAssistant";
import { AssistantProviderError } from "./assistantProvider";

const PLAN = {
  mode: "create",
  filename: "divider.asc",
  components: [
    { ref: "V1", kind: "vsource", value: "5" },
    { ref: "R1", kind: "resistor", value: "1k" },
    { ref: "R2", kind: "resistor", value: "1k" },
  ],
  nets: [
    { name: "VIN", pins: ["V1.p", "R1.a"] },
    { name: "OUT", pins: ["R1.b", "R2.a"] },
    { name: "0", pins: ["R2.b", "V1.n"] },
  ],
  directives: [],
};

function completion(body: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function toolCallCompletion() {
  return completion({
    choices: [{
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "build_tau_circuit", arguments: JSON.stringify(PLAN) },
        }],
      },
    }],
  });
}

describe("GeminiAssistant", () => {
  it("posts to Google's OpenAI-compatible endpoint with a bearer key and no MLX-only fields", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const provider = new GeminiAssistant({
      apiKey: "AIzaTESTKEY",
      fetchImpl: async (input, requestInit) => {
        url = String(input);
        init = requestInit;
        return completion({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hello." } }] });
      },
    });

    const reply = await provider.complete({ contextText: "SPICE netlist:\n* empty", history: [{ role: "user", content: "hi" }] });

    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer AIzaTESTKEY");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe(GEMINI_MODEL_PRESETS[GEMINI_DEFAULT_MODEL].model);
    expect(body.stream).toBe(false);
    // Google's shim rejects unknown top-level fields.
    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(body).not.toHaveProperty("parallel_tool_calls");
    expect(reply.text).toBe("Hello.");
    expect(reply.actions).toEqual([]);
  });

  it("shares the catalog-grounded prompt with the local provider but drops Qwen thinking markers", async () => {
    let captured = "";
    const provider = new GeminiAssistant({
      apiKey: "k",
      fetchImpl: async (_input, init) => {
        captured = String(init?.body);
        return completion({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }] });
      },
    });
    await provider.complete({ contextText: "SPICE netlist:\n* empty", history: [{ role: "user", content: "hi" }] });
    const system = (JSON.parse(captured) as { messages: { content: string }[] }).messages[0].content;

    expect(system).toContain("<tau_context>\nSPICE netlist:");
    expect(system).toContain('"kind":"resistor"');
    expect(system).toContain("VDD=[Vdd.p,M2.s,M2.b]");
    expect(system).toContain("never invent comparator supply pins");
    expect(system).not.toContain("/no_think");
    // The bare-JSON escape hatch is local-only; Gemini emits native tool calls.
    expect(system).not.toContain("<tool_call>");
  });

  it("compiles a native tool call into a validated, placed-and-wired proposal", async () => {
    const provider = new GeminiAssistant({ apiKey: "k", fetchImpl: async () => toolCallCompletion() });
    const reply = await provider.complete({ contextText: "", history: [{ role: "user", content: "build a divider" }] });

    expect(reply.rejectedActionCount).toBe(0);
    expect(reply.actions).toHaveLength(1);
    const action = reply.actions[0];
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("unreachable");
    expect(action.filename).toBe("divider.asc");
    expect(action.componentCount).toBe(3);
    // Geometry is Tau's, never the model's.
    expect(action.source).toContain("Version 4");
    expect(action.source).toContain("WIRE");
  });

  it("refuses a replace_current plan when replacement is unavailable this turn", async () => {
    const provider = new GeminiAssistant({
      apiKey: "k",
      fetchImpl: async () => completion({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: {
                name: "build_tau_circuit",
                arguments: JSON.stringify({ ...PLAN, mode: "replace_current" }),
              },
            }],
          },
        }],
      }),
    });

    const reply = await provider.complete({
      contextText: "",
      history: [{ role: "user", content: "rebuild it" }],
      allowCurrentApply: false,
    });

    expect(reply.actions).toEqual([]);
    // Two rejections for one bad call, by design: the plan itself is refused,
    // and finish_reason=tool_calls with nothing usable adds the repair-hint
    // rejection that drives the retry loop.
    expect(reply.rejectedActionCount).toBe(2);
  });

  it("explains an auth rejection and a rate limit in the user's terms", async () => {
    const unauthorized = new GeminiAssistant({
      apiKey: "bad",
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) } as unknown as Response),
    });
    await expect(unauthorized.complete({ contextText: "", history: [] }))
      .rejects.toThrow(/rejected the API key .*401.*aistudio\.google\.com\/apikey/s);

    const limited = new GeminiAssistant({
      apiKey: "k",
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) } as unknown as Response),
    });
    await expect(limited.complete({ contextText: "", history: [] }))
      .rejects.toThrow(/rate-limited.*free tier has a daily request cap/s);
  });

  it("reports an unreachable network as an offline provider error, not a crash", async () => {
    const provider = new GeminiAssistant({
      apiKey: "k",
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(provider.complete({ contextText: "", history: [] })).rejects.toMatchObject({
      name: "AssistantProviderError",
      kind: "offline",
    });
  });

  it("stops a wedged request at its own deadline", async () => {
    const provider = new GeminiAssistant({
      apiKey: "k",
      timeoutMs: 10,
      fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    });
    const error = await provider.complete({ contextText: "", history: [] }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AssistantProviderError);
    expect((error as AssistantProviderError).kind).toBe("server");
    expect((error as AssistantProviderError).message).toContain("Gemini made no complete reply");
  });

  it("passes a custom model name through without the custom: prefix", async () => {
    let captured = "";
    const provider = new GeminiAssistant({
      apiKey: "k",
      model: "custom:gemini-3-experimental",
      fetchImpl: async (_input, init) => {
        captured = String(init?.body);
        return completion({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }] });
      },
    });
    await provider.complete({ contextText: "", history: [] });
    expect((JSON.parse(captured) as { model: string }).model).toBe("gemini-3-experimental");
  });
});
