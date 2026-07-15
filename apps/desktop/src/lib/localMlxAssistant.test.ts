import { describe, expect, it, vi } from "vitest";
import type { AssistantProvider } from "./assistantProvider";
import { LocalMlxAssistant, LOCAL_MLX_MODEL_PRESETS } from "./localMlxAssistant";

const VALID_ASC = `Version 4
SHEET 1 880 680
WIRE 80 96 144 96
WIRE 208 96 256 96
WIRE 256 96 256 160
FLAG 256 160 0
SYMBOL res 144 80 R0
SYMATTR InstName R1
SYMATTR Value 1k
`;

const VALID_PLAN = {
  mode: "create",
  filename: "local-filter.asc",
  components: [
    { ref: "V1", kind: "vsource", value: "5" },
    { ref: "R1", kind: "resistor", value: "1k" },
  ],
  nets: [
    { name: "vin", pins: ["V1.p", "R1.a"] },
    { name: "0", pins: ["V1.n", "R1.b"] },
  ],
  directives: [".op"],
};

const request = (overrides: Partial<Parameters<AssistantProvider["complete"]>[0]> = {}) => ({
  contextText: "SPICE netlist:\nR1 in 0 1k",
  history: [
    { role: "user" as const, content: "What does R1 do?" },
  ],
  ...overrides,
});

const completion = (message: Record<string, unknown>) => new Response(JSON.stringify({
  id: "chatcmpl-local",
  choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: "stop" }],
}), { status: 200, headers: { "Content-Type": "application/json" } });

describe("LocalMlxAssistant", () => {
  it("uses only the fixed 127.0.0.1 OpenAI endpoint, no API key, and a catalog-grounded prompt", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return completion({ content: "<think>private reasoning</think>R1 limits current." });
    });
    const provider: AssistantProvider = new LocalMlxAssistant({ model: "qwen3-1.7b-4bit", fetchImpl });

    const reply = await provider.complete(request());

    expect(reply).toEqual({ text: "R1 limits current.", actions: [], rejectedActionCount: 0 });
    expect(capturedUrl).toBe("http://127.0.0.1:8080/v1/chat/completions");
    expect(capturedInit?.headers).toEqual({ "Content-Type": "application/json" });
    expect(capturedInit?.credentials).toBe("omit");
    expect(capturedInit?.redirect).toBe("error");
    expect(JSON.stringify(capturedInit?.headers)).not.toMatch(/authorization|api.?key/i);
    const body = JSON.parse(String(capturedInit?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      stream: boolean;
      chat_template_kwargs: { enable_thinking: boolean };
      tools: Array<{ function: { name: string; parameters: unknown } }>;
    };
    expect(body.model).toBe(LOCAL_MLX_MODEL_PRESETS["qwen3-1.7b-4bit"].model);
    expect(body.stream).toBe(false);
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
    expect(body.messages[0].content).toContain("<tau_context>\nSPICE netlist:");
    expect(body.messages[0].content).toContain('"kind":"resistor"');
    expect(body.messages[0].content).toContain('"kind":"opamp"');
    expect(body.messages[1]).toEqual({ role: "user", content: "What does R1 do?" });
    expect(body.tools.map((tool) => tool.function.name)).toEqual(["build_tau_circuit"]);
    expect(body.tools.every((tool) => typeof tool.function.parameters === "object")).toBe(true);
  });

  it("offers both native-runtime Qwen3 presets at the fixed loopback endpoint", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      return completion({ content: "Ready." });
    });
    const provider = new LocalMlxAssistant({ model: "qwen3-4b-4bit", fetchImpl });

    await provider.complete(request());
    const body = JSON.parse(capturedBody) as { model: string };
    expect(body.model).toBe("Qwen/Qwen3-4B-MLX-4bit");
    expect(LOCAL_MLX_MODEL_PRESETS["qwen3-1.7b-4bit"].model).toBe("Qwen/Qwen3-1.7B-MLX-4bit");
    expect(capturedUrl).toBe("http://127.0.0.1:8080/v1/chat/completions");
  });

  it("turns a logical OpenAI function call into a Tau-built validated ASC action", async () => {
    const fetchImpl = vi.fn(async () => completion({
      content: `Version 4\nSHEET 1 880 680\n${VALID_ASC}`,
      tool_calls: [{
        id: "create-local-1",
        type: "function",
        function: {
          name: "build_tau_circuit",
          arguments: JSON.stringify(VALID_PLAN),
        },
      }],
    }));
    const provider = new LocalMlxAssistant({ fetchImpl });

    const reply = await provider.complete(request());

    expect(reply.text).toBe("");
    expect(reply.rejectedActionCount).toBe(0);
    expect(reply.actions).toHaveLength(1);
    expect(reply.actions[0]).toEqual(expect.objectContaining({
      type: "create_asc",
      filename: "local-filter.asc",
      componentCount: 2,
    }));
    expect(reply.actions[0]?.source).toMatch(/^Version 4\nSHEET /);
  });

  it("accepts Qwen's strict text tool-call fallback through the same plan compiler", async () => {
    const fetchImpl = vi.fn(async () => completion({
      content: `<tool_call>${JSON.stringify({
        name: "build_tau_circuit",
        arguments: { ...VALID_PLAN, filename: "fallback.asc" },
      })}</tool_call>`,
      tool_calls: [],
    }));
    const provider = new LocalMlxAssistant({ fetchImpl });

    const reply = await provider.complete(request());

    expect(reply.text).toBe("");
    expect(reply.rejectedActionCount).toBe(0);
    expect(reply.actions).toEqual([
      expect.objectContaining({
        id: "local-json-tool-1",
        type: "create_asc",
        filename: "fallback.asc",
        componentCount: 2,
      }),
    ]);
  });

  it("never promotes mixed prose or a non-canonical JSON fallback into an action", async () => {
    const responses = [
      completion({
        content: `Here is the change: ${JSON.stringify({
          name: "build_tau_circuit",
          arguments: { ...VALID_PLAN, filename: "mixed.asc" },
        })}`,
      }),
      completion({
        content: `<tool_call>${JSON.stringify({
          name: "build_tau_circuit",
          arguments: { ...VALID_PLAN, filename: "extra.asc" },
          directlyApply: true,
        })}</tool_call>`,
      }),
    ];
    const provider = new LocalMlxAssistant({
      fetchImpl: vi.fn(async () => responses.shift()!),
    });

    const mixed = await provider.complete(request());
    expect(mixed.actions).toEqual([]);
    expect(mixed.rejectedActionCount).toBe(0);
    expect(mixed.text).toBe("");

    const extra = await provider.complete(request());
    expect(extra).toEqual({ text: "", actions: [], rejectedActionCount: 1 });
  });

  it("keeps malformed or unavailable operations inert and reports only a rejection count", async () => {
    const invalidResponse = completion({
      content: "I prepared it.",
      tool_calls: [{
        id: "bad-create",
        type: "function",
        function: { name: "build_tau_circuit", arguments: JSON.stringify({ ...VALID_PLAN, components: [{ ref: "X1", kind: "imaginary" }] }) },
      }],
    });
    const capturedBodies: string[] = [];
    const invalidProvider = new LocalMlxAssistant({ fetchImpl: vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBodies.push(String(init?.body));
      return invalidResponse.clone();
    }) });

    const invalid = await invalidProvider.complete(request());
    expect(invalid).toEqual({ text: "I prepared it.", actions: [], rejectedActionCount: 1 });
    expect(capturedBodies).toHaveLength(3);
    expect(capturedBodies[1]).toContain("uses a component kind Tau cannot generate safely");

    const unavailableBodies: string[] = [];
    const unavailableProvider = new LocalMlxAssistant({ fetchImpl: vi.fn(async (_input, init) => {
      unavailableBodies.push(String(init?.body));
      return completion({
        content: "I changed it.",
        tool_calls: [{
          id: "forbidden-apply",
          type: "function",
          function: { name: "build_tau_circuit", arguments: JSON.stringify({ ...VALID_PLAN, mode: "replace_current", filename: undefined }) },
        }],
      });
    }) });
    const unavailable = await unavailableProvider.complete(request({ allowCurrentApply: false }));
    expect(unavailable).toEqual({ text: "I changed it.", actions: [], rejectedActionCount: 1 });
    const secondBody = JSON.parse(unavailableBodies[0]) as {
      tools: Array<{ function: { name: string } }>;
    };
    expect(secondBody.tools.map((tool) => tool.function.name)).toEqual(["build_tau_circuit"]);
  });

  it("repairs a model plan with a missing component before exposing a proposal", async () => {
    const responses = [
      completion({
        content: "",
        tool_calls: [{
          id: "incomplete",
          type: "function",
          function: { name: "build_tau_circuit", arguments: JSON.stringify({
            ...VALID_PLAN,
            components: VALID_PLAN.components.filter((component) => component.ref !== "V1"),
          }) },
        }],
      }),
      completion({
        content: "",
        tool_calls: [{
          id: "repaired",
          type: "function",
          function: { name: "build_tau_circuit", arguments: JSON.stringify(VALID_PLAN) },
        }],
      }),
    ];
    const bodies: string[] = [];
    const provider = new LocalMlxAssistant({ fetchImpl: vi.fn(async (_input, init) => {
      bodies.push(String(init?.body));
      return responses.shift()!;
    }) });

    const reply = await provider.complete(request());
    expect(reply.actions).toHaveLength(1);
    expect(reply.rejectedActionCount).toBe(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain("references an unknown component");
  });

  it("classifies aborts, an offline server, HTTP failures, and malformed JSON distinctly", async () => {
    const aborted = new LocalMlxAssistant({
      fetchImpl: vi.fn(async () => { throw new DOMException("stopped", "AbortError"); }),
    });
    await expect(aborted.complete(request(), new AbortController().signal)).rejects.toMatchObject({ kind: "aborted" });

    const offline = new LocalMlxAssistant({
      fetchImpl: vi.fn(async () => { throw new TypeError("fetch failed"); }),
    });
    await expect(offline.complete(request())).rejects.toMatchObject({
      kind: "offline",
      message: expect.stringContaining("127.0.0.1"),
    });

    const server = new LocalMlxAssistant({
      fetchImpl: vi.fn(async () => new Response("down", { status: 503 })),
    });
    await expect(server.complete(request())).rejects.toMatchObject({ kind: "server", message: expect.stringContaining("503") });

    const invalid = new LocalMlxAssistant({
      fetchImpl: vi.fn(async () => new Response("not-json", { status: 200 })),
    });
    await expect(invalid.complete(request())).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("rejects structurally invalid OpenAI responses instead of fabricating a reply", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    const provider = new LocalMlxAssistant({ fetchImpl });
    await expect(provider.complete(request())).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it.runIf(process.env.TAU_REAL_MLX === "1")(
    "live: Qwen 4B produces a Tau-validated protected LED schematic",
    async () => {
      const provider = new LocalMlxAssistant({ model: "qwen3-4b-4bit" });
      const reply = await provider.complete(request({
        contextText: "Current serialized LTspice ASC: unavailable. Components: none placed.",
        history: [{
          role: "user",
          content: "Create a safe 5 V LED circuit with a 330 ohm current-limiting resistor.",
        }],
        allowCurrentApply: false,
      }));
      expect(reply.actions).toHaveLength(1);
      expect(reply.actions[0]).toEqual(expect.objectContaining({ type: "create_asc" }));
      expect(reply.actions[0]?.document.components.map((component) => component.kind)).toEqual(
        expect.arrayContaining(["vsource", "resistor", "led", "ground"]),
      );
    },
    60_000,
  );
});
