// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks a minimal slice of the Anthropic SDK surface lib/assistant.ts uses:
// a constructible default export with `messages.stream()` returning an
// on/finalMessage/abort-shaped fake stream the tests drive by hand, plus the
// four typed error classes classifyAssistantError() checks via instanceof.
const { streams, streamRequests, MockAuthenticationError, MockRateLimitError, MockAPIConnectionError, MockAPIError } = vi.hoisted(() => {
  class MockAPIError extends Error {}
  class MockAuthenticationError extends MockAPIError {}
  class MockRateLimitError extends MockAPIError {}
  class MockAPIConnectionError extends MockAPIError {}
  return {
    streams: [] as Array<{
      on: (event: string, cb: (...args: unknown[]) => void) => void;
      finalMessage: () => Promise<{ content: Array<Record<string, unknown>> }>;
      abort: ReturnType<typeof vi.fn>;
      emitText: (delta: string, snapshot: string) => void;
      emitThinking: () => void;
      emitStreamEvent: (event: Record<string, unknown>) => void;
      resolve: (text: string) => void;
      resolveWithUsage: (text: string, usage: Record<string, number>) => void;
      resolveContent: (content: Array<Record<string, unknown>>) => void;
      reject: (error: unknown) => void;
    }>,
    streamRequests: [] as unknown[],
    MockAuthenticationError,
    MockRateLimitError,
    MockAPIConnectionError,
    MockAPIError,
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      stream: vi.fn((request: unknown) => {
        streamRequests.push(request);
        const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        let resolveFinal: (message: { content: Array<Record<string, unknown>>; usage?: Record<string, number> }) => void;
        let rejectFinal: (error: unknown) => void;
        const finalPromise = new Promise<{ content: Array<Record<string, unknown>>; usage?: Record<string, number> }>((resolve, reject) => {
          resolveFinal = resolve;
          rejectFinal = reject;
        });
        const fake = {
          on: (event: string, cb: (...args: unknown[]) => void) => {
            (listeners[event] ??= []).push(cb);
            return fake;
          },
          finalMessage: () => finalPromise,
          abort: vi.fn(),
          emitText: (delta: string, snapshot: string) => listeners.text?.forEach((cb) => cb(delta, snapshot)),
          emitThinking: () => listeners.thinking?.forEach((cb) => cb("private", "private")),
          emitStreamEvent: (event: Record<string, unknown>) => listeners.streamEvent?.forEach((cb) => cb(event, {})),
          resolve: (text: string) => resolveFinal({ content: [{ type: "text", text }] }),
          resolveWithUsage: (text: string, usage: Record<string, number>) => resolveFinal({ content: [{ type: "text", text }], usage }),
          resolveContent: (content: Array<Record<string, unknown>>) => resolveFinal({ content }),
          reject: (error: unknown) => rejectFinal(error),
        };
        streams.push(fake);
        return fake;
      }),
    };
    constructor(_opts: { apiKey: string; dangerouslyAllowBrowser: boolean }) {}
  }
  return {
    default: Object.assign(MockAnthropic, {
      AuthenticationError: MockAuthenticationError,
      RateLimitError: MockRateLimitError,
      APIConnectionError: MockAPIConnectionError,
      APIError: MockAPIError,
    }),
  };
});

// Isolates AssistantPanel's proactive local-AI onboarding card from real
// fetch/timer activity: the existing local-mlx tests below drive chat
// completions through a raw `fetch` mock, and without this the panel's own
// getLocalAiStatus() call would consume/interleave with those same fetch
// calls. Defaults to "ready" (card hidden) so unrelated tests are unaffected;
// onboarding-specific tests override the resolved value per case.
const { localAiStatusMock, startLocalAiMock } = vi.hoisted(() => ({
  localAiStatusMock: vi.fn(),
  startLocalAiMock: vi.fn(),
}));
vi.mock("../lib/localAiRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/localAiRuntime")>()),
  getLocalAiStatus: localAiStatusMock,
  startLocalAi: startLocalAiMock,
}));

import { AssistantPanel, type AssistantPanelProps } from "./AssistantPanel";
import {
  ASSISTANT_CONNECT_TIMEOUT_MS,
  ASSISTANT_HISTORY_CHAR_LIMIT,
  ASSISTANT_HISTORY_MESSAGE_LIMIT,
  ASSISTANT_MAX_OUTPUT_TOKENS,
  ASSISTANT_QUESTION_MAX_OUTPUT_TOKENS,
  ASSISTANT_REQUEST_TIMEOUT_MS,
  compactAssistantHistory,
  saveAssistantApiKey,
  streamAssistantReply,
} from "../lib/assistant";
import { saveAssistantPreferences } from "../lib/assistantPreferences";
import {
  createConversation,
  getActiveConversationId,
  listConversations,
  loadConversation,
  saveAssistantRecovery,
  saveConversationMessages,
  setActiveConversationId,
} from "../lib/assistantMemory";
import { EMPTY_SCOPE } from "../simulation/paramScope";
import type { AnalysisResult } from "../simulation/linearTransient";
import type { SchematicComponent } from "../schematic/types";
import type { LocalAiStatus } from "../lib/localAiRuntime";

function localAiStatus(overrides: Partial<LocalAiStatus> = {}): LocalAiStatus {
  return {
    state: "ready",
    endpoint: "http://127.0.0.1:8080/v1",
    managed: true,
    installed: true,
    modelId: null,
    modelRepository: null,
    detail: "Local inference is ready.",
    presets: [
      {
        id: "qwen3-4b-4bit",
        repository: "Qwen/Qwen3-4B-MLX-4bit",
        label: "Qwen3 4B · 4-bit",
        downloadMb: 2_300,
        downloaded: false,
      },
      {
        id: "qwen3-1.7b-4bit",
        repository: "Qwen/Qwen3-1.7B-MLX-4bit",
        label: "Qwen3 1.7B · 4-bit",
        downloadMb: 914,
        downloaded: false,
      },
    ],
    ...overrides,
  };
}

// This jsdom build has localStorage disabled — install an in-memory Storage
// (mirrors panelResize.test.tsx / TelemetryDock.test.tsx) so the API-key
// storage path is actually exercised instead of silently no-oping.
const backing = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  localStorage.clear();
  saveAssistantApiKey("");
  saveAssistantPreferences({ provider: "anthropic", localModel: "qwen3-1.7b-4bit" });
  streams.length = 0;
  streamRequests.length = 0;
  localAiStatusMock.mockReset();
  localAiStatusMock.mockResolvedValue(localAiStatus());
  startLocalAiMock.mockReset();
});

const resistor = (id: string, label: string): SchematicComponent => ({
  id,
  kind: "resistor",
  label,
  value: "1k",
  x: 0,
  y: 0,
  rotation: 0,
});

const completedAnalysis = (): AnalysisResult => ({
  ok: true,
  title: "Transient",
  times: [0, 0.25, 0.5, 0.75, 1],
  traces: [{ id: "out", label: "V(out)", unit: "V", color: "var(--trace-cyan)", values: [0, 2, 0, -2, 0] }],
  currents: [],
  stats: { netCount: 1, componentCount: 1, sampleCount: 5, stopTime: 1, stepSize: 0.25 },
  warnings: [],
  circuit: { nets: [], components: [], groundNetId: "0", warnings: [] },
});

const ASSISTANT_ASC = `Version 4
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
SYMATTR Value 5
TEXT 0 0 Left 2 !.tran 5m
`;

const ASSISTANT_PLAN = {
  mode: "create",
  filename: "rc-filter.asc",
  components: [
    { ref: "V1", kind: "vsource", value: "5" },
    { ref: "R1", kind: "resistor", value: "1k" },
    { ref: "C1", kind: "capacitor", value: "1u" },
  ],
  nets: [
    { name: "VIN", pins: ["V1.p", "R1.a"] },
    { name: "OUT", pins: ["R1.b", "C1.a"] },
    { name: "0", pins: ["V1.n", "C1.b"] },
  ],
  directives: [".tran 5m"],
};

function baseProps(overrides: Partial<AssistantPanelProps> = {}): AssistantPanelProps {
  return {
    components: [],
    wires: [],
    netLabels: [],
    directives: [],
    params: EMPTY_SCOPE,
    analysis: null,
    componentRows: [],
    measurements: [],
    selectedId: null,
    resize: { width: 340, dragging: false, onPointerDown: () => {}, onKeyDown: () => {}, setWidth: () => 340 },
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

// Drives one full cloud turn to completion: types promptText, hits Send, and
// resolves the most recently created mock stream with replyText. Used by the
// conversation-history tests below, which each need several complete turns
// to build up more than one saved chat.
async function sendAndResolve(promptText: string, replyText: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), { target: { value: promptText } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const stream = streams[streams.length - 1];
  await act(async () => {
    stream.resolve(replyText);
    await stream.finalMessage();
  });
}

describe("AssistantPanel", () => {
  it("stops a cloud request that never starts responding instead of hanging for minutes", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    streamAssistantReply("test-key", "Circuit context", [{ role: "user", content: "Build an amplifier" }], {
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError,
    });

    vi.advanceTimersByTime(ASSISTANT_CONNECT_TIMEOUT_MS);

    expect(streams[0].abort).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      kind: "network",
      message: expect.stringMatching(/45 seconds/i),
    }));
  });
  it("enforces one overall deadline across active streaming and repair work", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    streamAssistantReply("test-key", "Circuit context", [{ role: "user", content: "Build an amplifier" }], {
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError,
    });
    streams[0].emitThinking(); // proves connection; the first-event timer is no longer relevant

    vi.advanceTimersByTime(ASSISTANT_REQUEST_TIMEOUT_MS);

    expect(streams[0].abort).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      kind: "network",
      message: expect.stringMatching(/90 seconds.*No file was created/i),
    }));
  });
  it("bounds recurring provider history without losing the newest user request", () => {
    const history = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `${index}: ${"x".repeat(1500)}`,
    }));
    // The real send path always ends in the new user turn.
    history.push({ role: "user", content: "Build the requested LC tank now." });
    const compacted = compactAssistantHistory(history);

    expect(compacted.length).toBeLessThanOrEqual(ASSISTANT_HISTORY_MESSAGE_LIMIT);
    expect(compacted.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(ASSISTANT_HISTORY_CHAR_LIMIT);
    expect(compacted[0].role).toBe("user");
    expect(compacted[compacted.length - 1]?.content).toBe("Build the requested LC tank now.");
  });
  it("shows the no-API-key empty state and never renders the composer without a key", () => {
    const onOpenSettings = vi.fn();
    render(<AssistantPanel {...baseProps({ onOpenSettings })} />);

    expect(screen.getByText("No API Key")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Message the assistant" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox", { name: "Assistant model" }).textContent).toContain("Sonnet 5");
  });

  it("centers the model selector between symmetric chat controls", () => {
    const { container } = render(<AssistantPanel {...baseProps()} />);
    const toolbar = container.querySelector(".assistant-toolbar");
    expect(toolbar).not.toBeNull();
    expect(Array.from(toolbar!.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"))).toEqual([
      "New chat",
      "Past chats",
      "Assistant model",
      "Delete conversation",
      "Close assistant",
    ]);
  });

  it("uses the selected local preset without a cloud key and consumes its non-streaming reply", async () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: "I prepared a local RC circuit.",
          tool_calls: [
            {
              id: "local-create",
              type: "function",
              function: {
                name: "build_tau_circuit",
                arguments: JSON.stringify({
                  mode: "create",
                  filename: "local-rc.asc",
                  components: [
                    { ref: "V1", kind: "vsource", value: "5" },
                    { ref: "R1", kind: "resistor", value: "1k" },
                  ],
                  nets: [
                    { name: "vin", pins: ["V1.p", "R1.a"] },
                    { name: "0", pins: ["V1.n", "R1.b"] },
                  ],
                  directives: [".op"],
                }),
              },
            },
            {
              id: "rejected-tool",
              type: "function",
              function: { name: "write_any_file", arguments: "{}" },
            },
          ],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssistantPanel {...baseProps()} />);

    expect(screen.getByRole("combobox", { name: "Assistant model" }).textContent).toContain("Qwen3 4B");
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toBeTruthy();
    expect(screen.queryByText("No API Key")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Create an RC circuit locally" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("I prepared a local RC circuit.")).toBeTruthy();
    expect(screen.getByText("local-rc.asc")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("No file was created");
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { model: string; stream: boolean };
    expect(request).toEqual(expect.objectContaining({
      model: "Qwen/Qwen3-4B-MLX-4bit",
      stream: false,
    }));
  });

  it("aborts a local request from Stop and when the panel unmounts", () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-1.7b-4bit" });
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error("missing signal");
      signals.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<AssistantPanel {...baseProps()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), { target: { value: "Explain this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(signals[0].aborted).toBe(true);
    first.unmount();

    const second = render(<AssistantPanel {...baseProps()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), { target: { value: "Explain again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    second.unmount();
    expect(signals[1].aborted).toBe(true);
  });

  it("delegates its width boundary to the shared dock when embedded", () => {
    render(<AssistantPanel {...baseProps({ embedded: true })} />);
    const panel = screen.getByRole("complementary", { name: "Assistant" });
    expect(panel.classList.contains("assistant-panel--embedded")).toBe(true);
    expect(screen.queryByRole("separator", { name: "Resize assistant panel" })).toBeNull();
  });

  it("sending a message appends the user turn and streams mock deltas into an assistant bubble", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), { target: { value: "What does R1 do?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("What does R1 do?")).toBeTruthy();
    expect(streams).toHaveLength(1);
    expect(streamRequests[0]).toEqual(expect.objectContaining({
      tools: [expect.objectContaining({ name: "inspect_simulation_signal", strict: true })],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      max_tokens: ASSISTANT_QUESTION_MAX_OUTPUT_TOKENS,
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
    }));
    const request = streamRequests[0] as { system: Array<{ text: string }> };
    expect(request.system[0].text).toContain("SPICE directives are internal working data");
    expect(request.system[0].text).toContain("Never claim an analysis ran");
    expect(JSON.stringify((streamRequests[0] as { tools: unknown[] }).tools[0])).not.toMatch(/minItems|maxItems/);

    act(() => streams[0].emitText("It sets the", "It sets the"));
    await waitFor(() => expect(screen.getByText("It sets the")).toBeTruthy());

    // The "text" event's cumulative snapshot is what actually paints the
    // bubble (see AssistantPanel's onDelta) — finalMessage() just marks the
    // turn done, so a realistic mock streams the full text as a delta first.
    const full = "It sets the RC time constant with C1.";
    await act(async () => {
      streams[0].emitText(full.slice("It sets the".length), full);
      streams[0].resolveWithUsage(full, {
        input_tokens: 24,
        output_tokens: 310,
        cache_creation_input_tokens: 5_800,
        cache_read_input_tokens: 0,
      });
      await streams[0].finalMessage();
    });
    await waitFor(() => expect(screen.getByText(full)).toBeTruthy());
    // Streaming ended — composer is usable again for the next turn.
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.getByLabelText("Assistant request usage").textContent).toContain("5.8k cache write");
  });

  it("shows honest request phases and automatically repairs one rejected cloud proposal", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Create a Class-D amplifier" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(streamRequests[0]).toEqual(expect.objectContaining({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "build_tau_circuit", strict: true }),
        expect.objectContaining({ name: "apply_current_asc_circuit", strict: true }),
        expect.objectContaining({ name: "inspect_simulation_signal", strict: true }),
      ]),
      max_tokens: ASSISTANT_MAX_OUTPUT_TOKENS,
      output_config: { effort: "medium" },
    }));

    expect(await screen.findByText("Connecting to Sonnet 5")).toBeTruthy();
    expect(screen.getByText("0s")).toBeTruthy();
    expect(screen.queryByText(/safety limit/)).toBeNull();
    expect(screen.queryByText("Plan")).toBeNull();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();

    act(() => streams[0].emitThinking());
    expect(await screen.findByText("Designing the circuit")).toBeTruthy();
    act(() => streams[0].emitStreamEvent({
      type: "content_block_start",
      content_block: { type: "tool_use", id: "bad-plan", name: "build_tau_circuit" },
    }));
    expect(await screen.findByText("Building a compact circuit plan")).toBeTruthy();

    await act(async () => {
      streams[0].resolveContent([{
        type: "tool_use",
        id: "bad-plan",
        name: "build_tau_circuit",
        input: {
          mode: "create",
          filename: "class-d.asc",
          components: [{ ref: "R1", kind: "resistor", value: "1k" }],
          nets: [{ name: "0", pins: ["R1.a"] }],
          directives: [],
        },
      }]);
      await streams[0].finalMessage();
    });
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(screen.getByText("Correcting the circuit plan")).toBeTruthy();
    expect(screen.queryByText("Validate")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    const repairRequest = streamRequests[1] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(repairRequest.messages[repairRequest.messages.length - 1]?.content).toMatch(/R1\.b.*not connected/i);
    expect(JSON.stringify(repairRequest.messages)).not.toContain("bad-plan");

    await act(async () => {
      streams[1].resolveContent([{
        type: "tool_use",
        id: "fixed-plan",
        name: "build_tau_circuit",
        input: { ...ASSISTANT_PLAN, filename: "class-d.asc" },
      }]);
      await streams[1].finalMessage();
    });
    expect(await screen.findByText("class-d.asc")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("Stop aborts the in-flight stream and re-enables the composer without waiting on the network", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), { target: { value: "Explain this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const stopButton = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);

    expect(streams[0].abort).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("a quick-action chip sends its canned prompt without typing", () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "Build an RC filter" }));

    expect(screen.getByText(/Build a practical first-order RC low-pass filter/)).toBeTruthy();
    expect(streams).toHaveLength(1);
  });

  it("shows the Tauri safety note and exposes the active model as a selector", () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    expect(screen.getByText("Tauri is an AI and can make mistakes.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Assistant model" }).textContent).toContain("Sonnet 5");
    expect(screen.queryByText(/Claude ·/)).toBeNull();
  });

  it("shows the ref-specific chip once a component is selected, and sends its prompt", () => {
    saveAssistantApiKey("test-key");
    const r1 = resistor("r1", "R1");
    render(<AssistantPanel {...baseProps({ components: [r1], selectedId: "r1" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Explain R1" }));
    expect(screen.getByText("Explain R1's role in this schematic and how its value affects the current circuit.")).toBeTruthy();
  });

  it("keeps current-circuit apply for a persisted Tau-native component", () => {
    saveAssistantApiKey("test-key");
    const unsupported: SchematicComponent = {
      id: "tp1",
      kind: "testpoint",
      label: "TP1",
      value: "",
      x: 0,
      y: 0,
      rotation: 0,
    };
    render(<AssistantPanel {...baseProps({ components: [unsupported] })} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Add a resistor to this circuit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const request = streamRequests[0] as { tools: Array<{ name: string }> };
    expect(request.tools.map((tool) => tool.name)).toContain("apply_current_asc_circuit");
    expect(request.tools.map((tool) => tool.name)).toContain("build_tau_circuit");
  });

  it("runs a private waveform inspection and renders only the final engineering answer", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps({ analysis: completedAnalysis() })} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "What is the exact RMS output voltage?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    act(() => streams[0].emitText("Let me inspect that.", "Let me inspect that."));
    expect(await screen.findByText("Let me inspect that.")).toBeTruthy();
    act(() => streams[0].emitStreamEvent({
      type: "content_block_start",
      content_block: { type: "tool_use", id: "inspect-1", name: "inspect_simulation_signal" },
    }));
    expect(await screen.findByText("Inspecting simulation data")).toBeTruthy();

    await act(async () => {
      streams[0].resolveContent([{
        type: "tool_use",
        id: "inspect-1",
        name: "inspect_simulation_signal",
        input: { expression: "V(out)" },
      }]);
      await streams[0].finalMessage();
    });
    await waitFor(() => expect(streams).toHaveLength(2));

    // The intermediate operation and payload stay out of the ordinary chat.
    expect(screen.queryByText("Let me inspect that.")).toBeNull();
    expect(screen.queryByText("inspect_simulation_signal")).toBeNull();
    expect(screen.queryByText("V(out)")).toBeNull();

    const continuation = streamRequests[1] as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    const resultTurn = continuation.messages[continuation.messages.length - 1];
    expect(resultTurn.role).toBe("user");
    const toolResult = resultTurn.content[0];
    expect(toolResult).toEqual(expect.objectContaining({
      type: "tool_result",
      tool_use_id: "inspect-1",
      is_error: false,
    }));
    expect(JSON.parse(String(toolResult.content))).toEqual(expect.objectContaining({
      expression: "V(out)",
      rms: Math.SQRT2,
      unit: "V",
    }));

    const answer = "The output RMS voltage is 1.41 V.";
    await act(async () => {
      streams[1].emitText(answer, answer);
      streams[1].resolve(answer);
      await streams[1].finalMessage();
    });
    expect(await screen.findByText(answer)).toBeTruthy();
  });

  it("renders an auth error with a Settings hint and wires it to onOpenSettings", async () => {
    saveAssistantApiKey("test-key");
    const onOpenSettings = vi.fn();
    render(<AssistantPanel {...baseProps({ onOpenSettings })} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await act(async () => {
      streams[0].reject(new MockAuthenticationError("invalid x-api-key"));
      await streams[0].finalMessage().catch(() => {});
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Authentication failed. Check your API key in Settings.")).toBeTruthy();

    const settingsButtons = screen.getAllByRole("button", { name: "Open Settings" });
    fireEvent.click(settingsButtons[settingsButtons.length - 1]);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps raw Anthropic request bodies out of the user-facing failure card", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), { target: { value: "Build a tank" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await act(async () => {
      streams[0].reject(new MockAPIError("400 {\"error\":{\"message\":\"internal schema detail\"}}"));
      await streams[0].finalMessage().catch(() => {});
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Anthropic rejected the assistant request");
    expect(alert.textContent).not.toContain("internal schema detail");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("restores an interrupted run as a visible exact retry instead of losing it on reload", () => {
    saveAssistantApiKey("test-key");
    saveAssistantRecovery("tank.asc", { status: "running", prompt: "Build an LC tank" });
    render(<AssistantPanel {...baseProps({ memoryKey: "tank.asc" })} />);

    expect(screen.getByRole("alert").textContent).toContain("previous assistant run was interrupted");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(streams).toHaveLength(1);
    expect(screen.getByText("Build an LC tank", { selector: ".assistant-message--user p" })).toBeTruthy();
  });

  it("compiles a compact cloud plan locally and keeps creation behind confirmation", async () => {
    saveAssistantApiKey("test-key");
    const onCreateAsc = vi.fn();
    const onApplyCurrent = vi.fn();
    render(<AssistantPanel {...baseProps({ onCreateAsc, onApplyCurrent })} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Create an RC low-pass filter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await act(async () => {
      streams[0].resolveContent([
        { type: "text", text: "I prepared an RC low-pass schematic." },
        {
          type: "tool_use",
          id: "plan-1",
          name: "build_tau_circuit",
          input: ASSISTANT_PLAN,
        },
      ]);
      await streams[0].finalMessage();
    });

    expect(await screen.findByText("rc-filter.asc")).toBeTruthy();
    expect(screen.getByText(/3 components · \d+ wires/)).toBeTruthy();
    // Plan JSON and locally generated ASC stay out of the transcript.
    expect(screen.queryByText(JSON.stringify(ASSISTANT_PLAN))).toBeNull();
    expect(onCreateAsc).not.toHaveBeenCalled();
    expect(onApplyCurrent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create rc-filter.asc" }));
    await waitFor(() => expect(onCreateAsc).toHaveBeenCalledTimes(1));
    expect(onCreateAsc.mock.calls[0][0]).toEqual(expect.objectContaining({
      type: "create_asc",
      filename: "rc-filter.asc",
      componentCount: 3,
    }));
    expect(onCreateAsc.mock.calls[0][0].source).toMatch(/^Version 4\nSHEET /);
    expect(onCreateAsc.mock.calls[0][0].document.components.some((component: SchematicComponent) => component.label === "R1")).toBe(true);
    expect(onApplyCurrent).not.toHaveBeenCalled();
    expect(await screen.findByText("Created")).toBeTruthy();
  });

  it("keeps a current-circuit revision private until Apply and selects only the apply handler", async () => {
    saveAssistantApiKey("test-key");
    const onCreateAsc = vi.fn();
    const onApplyCurrent = vi.fn();
    render(<AssistantPanel {...baseProps({ onCreateAsc, onApplyCurrent })} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Add a load resistor to the current circuit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {
      streams[0].resolveContent([
        { type: "text", text: "I prepared the revised circuit." },
        {
          type: "tool_use",
          id: "apply-1",
          name: "apply_current_asc_circuit",
          input: { source: ASSISTANT_ASC },
        },
      ]);
      await streams[0].finalMessage();
    });

    expect(await screen.findByText("Current circuit")).toBeTruthy();
    expect(screen.queryByText(ASSISTANT_ASC)).toBeNull();
    expect(onApplyCurrent).not.toHaveBeenCalled();
    expect(onCreateAsc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply to current circuit" }));
    await waitFor(() => expect(onApplyCurrent).toHaveBeenCalledTimes(1));
    expect(onApplyCurrent.mock.calls[0][0]).toEqual(expect.objectContaining({
      type: "apply_current_asc",
      source: ASSISTANT_ASC,
      componentCount: 3,
    }));
    expect(onCreateAsc).not.toHaveBeenCalled();
    expect(await screen.findByText("Applied")).toBeTruthy();
  });

  it("keeps a rejected plan visible with one-click retry and never invokes a mutation boundary", async () => {
    saveAssistantApiKey("test-key");
    const onCreateAsc = vi.fn();
    const onApplyCurrent = vi.fn();
    render(<AssistantPanel {...baseProps({ onCreateAsc, onApplyCurrent })} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Create anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {
      streams[0].resolveContent([{
        type: "tool_use",
        id: "bad-plan",
        name: "build_tau_circuit",
        input: { mode: "create", filename: "bad.asc", components: [{ ref: "R1", kind: "resistor" }], nets: [{ name: "0", pins: ["R1.a"] }] },
      }]);
      await streams[0].finalMessage();
    });

    await waitFor(() => expect(streams).toHaveLength(2));
    await act(async () => {
      streams[1].resolveContent([{
        type: "tool_use",
        id: "still-bad-plan",
        name: "build_tau_circuit",
        input: { mode: "create", filename: "bad.asc", components: [{ ref: "R1", kind: "resistor" }], nets: [{ name: "0", pins: ["R1.a"] }] },
      }]);
      await streams[1].finalMessage();
    });

    expect((await screen.findByRole("alert")).textContent).toContain("No file was created");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(streams).toHaveLength(3);
    expect(screen.getAllByText("Create anything")).toHaveLength(2);
    expect(onCreateAsc).not.toHaveBeenCalled();
    expect(onApplyCurrent).not.toHaveBeenCalled();
  });
});

describe("AssistantPanel local AI onboarding", () => {
  it("stays absent for the Anthropic provider even though the local runtime is unready", async () => {
    saveAssistantApiKey("test-key");
    localAiStatusMock.mockResolvedValue(localAiStatus({ state: "stopped", detail: "Choose a model to start local inference." }));
    render(<AssistantPanel {...baseProps()} />);

    // Give the (never-fired-for-anthropic) status effect a tick to prove it
    // really is gated on provider, not just not-yet-resolved.
    await Promise.resolve();
    expect(screen.queryByText("Download & start")).toBeNull();
    expect(screen.queryByText("Start")).toBeNull();
    expect(localAiStatusMock).not.toHaveBeenCalled();
  });

  it("is absent once the local runtime reports ready", async () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
    localAiStatusMock.mockResolvedValue(localAiStatus({ state: "ready", detail: "Local inference is ready." }));
    render(<AssistantPanel {...baseProps()} />);

    await waitFor(() => expect(localAiStatusMock).toHaveBeenCalled());
    expect(screen.queryByText("Local inference is ready.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("offers Download & start for an undownloaded preset, and just Start once it's downloaded", async () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
    localAiStatusMock.mockResolvedValue(localAiStatus({
      state: "stopped",
      installed: true,
      detail: "MLX LM is installed. Choose a model to start local inference.",
      presets: [
        { id: "qwen3-4b-4bit", repository: "Qwen/Qwen3-4B-MLX-4bit", label: "Qwen3 4B · 4-bit", downloadMb: 2_300, downloaded: false },
        { id: "qwen3-1.7b-4bit", repository: "Qwen/Qwen3-1.7B-MLX-4bit", label: "Qwen3 1.7B · 4-bit", downloadMb: 914, downloaded: false },
      ],
    }));
    const { unmount } = render(<AssistantPanel {...baseProps()} />);

    expect(await screen.findByRole("button", { name: "Download & start" })).toBeTruthy();
    expect(screen.getByText("MLX LM is installed. Choose a model to start local inference.")).toBeTruthy();
    expect(screen.getByText("2,300 MB")).toBeTruthy();
    // Composer stays usable while the setup card is showing.
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toBeTruthy();
    unmount();

    localAiStatusMock.mockResolvedValue(localAiStatus({
      state: "stopped",
      installed: true,
      detail: "MLX LM is installed. Choose a model to start local inference.",
      presets: [
        { id: "qwen3-4b-4bit", repository: "Qwen/Qwen3-4B-MLX-4bit", label: "Qwen3 4B · 4-bit", downloadMb: 2_300, downloaded: true },
        { id: "qwen3-1.7b-4bit", repository: "Qwen/Qwen3-1.7B-MLX-4bit", label: "Qwen3 1.7B · 4-bit", downloadMb: 914, downloaded: false },
      ],
    }));
    render(<AssistantPanel {...baseProps()} />);
    expect(await screen.findByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download & start" })).toBeNull();
  });

  it("starts the runtime, polls while starting, and hides the card once ready", async () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
    localAiStatusMock.mockResolvedValueOnce(localAiStatus({ state: "stopped", installed: true, detail: "Choose a model to start local inference." }));
    startLocalAiMock.mockResolvedValue(localAiStatus({ state: "starting", detail: "Loading model weights into unified memory…" }));

    render(<AssistantPanel {...baseProps()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download & start" }));

    expect(await screen.findByText("Loading model weights into unified memory…")).toBeTruthy();
    expect(startLocalAiMock).toHaveBeenCalledWith("qwen3-4b-4bit", true);
    // Starting hides the button (nothing to click while it's already working).
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download & start" })).toBeNull();

    // Poll picks up readiness and the card disappears.
    localAiStatusMock.mockResolvedValue(localAiStatus({ state: "ready", detail: "Local inference is ready." }));
    await waitFor(() => expect(screen.queryByText("Loading model weights into unified memory…")).toBeNull(), { timeout: 3000 });
  }, 10000);

  it("shows an error state's detail without a retry button when the preset isn't installed", async () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-1.7b-4bit" });
    localAiStatusMock.mockResolvedValue(localAiStatus({
      state: "error",
      installed: false,
      detail: "The MLX server exited unexpectedly.",
    }));
    render(<AssistantPanel {...baseProps()} />);

    expect(await screen.findByText("The MLX server exited unexpectedly.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download & start" })).toBeNull();
  });

  it("shows the browser-fallback detail text instead of a button (managed:false, not installed, stopped)", async () => {
    saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
    localAiStatusMock.mockResolvedValue(localAiStatus({
      state: "stopped",
      managed: false,
      installed: false,
      detail: "Open Tau desktop to start MLX local inference.",
    }));
    render(<AssistantPanel {...baseProps()} />);

    expect(await screen.findByText("Open Tau desktop to start MLX local inference.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download & start" })).toBeNull();
    // The composer is still fully usable in this browser dev fallback.
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toBeTruthy();
  });
});

describe("AssistantPanel conversation history", () => {
  it("disables the header delete-conversation button for an empty, never-saved thread", () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);
    expect((screen.getByRole("button", { name: "Delete conversation" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the previous conversation when starting a new chat, and lists it in the past-chats menu", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    await sendAndResolve("What does R1 do?", "R1 sets the gain.");
    expect(screen.getByText("What does R1 do?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    // The prior thread is gone from view (archived, not deleted) and the
    // composer/intro read as a genuinely fresh conversation.
    expect(screen.queryByText("What does R1 do?")).toBeNull();
    expect(screen.getByText(/Ask about this circuit/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete conversation" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Past chats" }));
    const menu = screen.getByRole("group", { name: "Past chats" });
    expect(within(menu).getByText("What does R1 do?")).toBeTruthy();
  });

  it("switches between two saved conversations via the past-chats menu without losing either transcript", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    await sendAndResolve("What does R1 do?", "R1 sets the gain.");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await sendAndResolve("What does C1 do?", "C1 sets the pole.");
    expect(screen.getByText("C1 sets the pole.")).toBeTruthy();
    expect(screen.queryByText("R1 sets the gain.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Past chats" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Past chats" })).getByText("What does R1 do?").closest("button")!);

    expect(screen.getByText("R1 sets the gain.")).toBeTruthy();
    expect(screen.queryByText("C1 sets the pole.")).toBeNull();
    // The composer draft and any transient error state don't leak across a switch.
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toHaveProperty("value", "");

    fireEvent.click(screen.getByRole("button", { name: "Past chats" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Past chats" })).getByText("What does C1 do?").closest("button")!);
    expect(screen.getByText("C1 sets the pole.")).toBeTruthy();
    expect(screen.queryByText("R1 sets the gain.")).toBeNull();
  });

  it("edits and resends an earlier user prompt as a new branch, removing later turns and renaming the chat", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);
    await sendAndResolve("What does R1 do?", "R1 sets the gain.");

    fireEvent.click(screen.getByRole("button", { name: "Edit message: What does R1 do?" }));
    const editor = screen.getByRole("textbox", { name: "Edit message text" });
    fireEvent.change(editor, { target: { value: "How does C1 set the cutoff?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & resend" }));

    expect(screen.queryByText("What does R1 do?")).toBeNull();
    expect(screen.queryByText("R1 sets the gain.")).toBeNull();
    expect(screen.getByText("How does C1 set the cutoff?")).toBeTruthy();
    expect(streams).toHaveLength(2);
    const request = streamRequests[1] as { messages: Array<{ role: string; content: string }> };
    expect(request.messages[request.messages.length - 1]).toEqual({ role: "user", content: "How does C1 set the cutoff?" });
    expect(JSON.stringify(request.messages)).not.toContain("What does R1 do?");

    await act(async () => {
      streams[1].resolveContent([{ type: "text", text: "C1 and R1 set the pole." }]);
      await streams[1].finalMessage();
    });
    fireEvent.click(screen.getByRole("button", { name: "Past chats" }));
    expect(within(screen.getByRole("group", { name: "Past chats" })).getByText("How does C1 set the cutoff?")).toBeTruthy();
  });

  it("deletes a non-active conversation from the past-chats menu without disturbing the active thread", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    await sendAndResolve("What does R1 do?", "R1 sets the gain.");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await sendAndResolve("What does C1 do?", "C1 sets the pole.");

    fireEvent.click(screen.getByRole("button", { name: "Past chats" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Past chats" })).getByRole("button", { name: 'Delete "What does R1 do?"' }));

    // Still on the active (C1) thread — deleting a different row doesn't touch
    // it, and the menu stays open (still showing the pruned list) so a delete
    // doesn't force a re-open to remove a second row.
    expect(screen.getByText("C1 sets the pole.")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Past chats" })).queryByText("What does R1 do?")).toBeNull();
  });

  it("the header's delete-conversation button removes the active thread and falls back to the newest remaining one", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    await sendAndResolve("What does R1 do?", "R1 sets the gain.");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await sendAndResolve("What does C1 do?", "C1 sets the pole.");

    fireEvent.click(screen.getByRole("button", { name: "Delete conversation" }));

    expect(screen.getByText("R1 sets the gain.")).toBeTruthy();
    expect(screen.queryByText("C1 sets the pole.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Past chats" }));
    expect(within(screen.getByRole("group", { name: "Past chats" })).queryByText("What does C1 do?")).toBeNull();
  });

  it("deleting the only conversation falls back to a fresh empty thread instead of an empty menu forever", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);
    await sendAndResolve("What does R1 do?", "R1 sets the gain.");

    fireEvent.click(screen.getByRole("button", { name: "Delete conversation" }));

    expect(screen.queryByText("What does R1 do?")).toBeNull();
    expect(screen.getByText(/Ask about this circuit/)).toBeTruthy();
    // A brand new thread is usable right away.
    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), { target: { value: "Another question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByText("Another question")).toBeTruthy();
  });

  it("closes the past-chats menu on Escape and on an outside click", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);
    await sendAndResolve("What does R1 do?", "R1 sets the gain.");

    fireEvent.click(screen.getByRole("button", { name: "Past chats" }));
    expect(screen.getByRole("group", { name: "Past chats" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Past chats" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Past chats" }));
    expect(screen.getByRole("group", { name: "Past chats" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "Past chats" })).toBeNull();
  });

  it("restores a conversation saved under a memoryKey the next time that circuit's panel mounts (reload survival)", () => {
    const id = createConversation();
    saveConversationMessages("persist.asc", id, [
      { role: "user", content: "What does R1 do?" },
      { role: "assistant", content: "R1 sets the gain." },
    ]);
    setActiveConversationId("persist.asc", id);

    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps({ memoryKey: "persist.asc" })} />);

    expect(screen.getByText("What does R1 do?")).toBeTruthy();
    expect(screen.getByText("R1 sets the gain.")).toBeTruthy();
  });

  it("keeps separate transcripts for separate circuits under the same session", () => {
    const id = createConversation();
    saveConversationMessages("circuit-a.asc", id, [{ role: "user", content: "Circuit A question" }]);
    setActiveConversationId("circuit-a.asc", id);

    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps({ memoryKey: "circuit-b.asc" })} />);

    expect(screen.queryByText("Circuit A question")).toBeNull();
    expect(screen.getByText(/Ask about this circuit/)).toBeTruthy();
  });

  it("flushes the active conversation synchronously on unmount so a close mid-debounce does not drop turns", async () => {
    saveAssistantApiKey("test-key");
    const { unmount } = render(<AssistantPanel {...baseProps({ memoryKey: "flush.asc" })} />);
    await sendAndResolve("What does R1 do?", "R1 sets the gain.");

    // Unmount before waiting out another debounce window — the unmount flush
    // must still have written the completed turn.
    unmount();

    const activeId = getActiveConversationId("flush.asc");
    expect(activeId).toBeTruthy();
    const saved = loadConversation("flush.asc", activeId!)?.messages ?? [];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ role: "user", content: "What does R1 do?" });
    expect(saved[1]).toMatchObject({ role: "assistant", content: "R1 sets the gain." });
    expect(listConversations("flush.asc")).toHaveLength(1);
  });
});
