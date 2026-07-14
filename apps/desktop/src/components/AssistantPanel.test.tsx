// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      resolve: (text: string) => void;
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
        let resolveFinal: (message: { content: Array<Record<string, unknown>> }) => void;
        let rejectFinal: (error: unknown) => void;
        const finalPromise = new Promise<{ content: Array<Record<string, unknown>> }>((resolve, reject) => {
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
          resolve: (text: string) => resolveFinal({ content: [{ type: "text", text }] }),
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

import { AssistantPanel, type AssistantPanelProps } from "./AssistantPanel";
import { saveAssistantApiKey } from "../lib/assistant";
import { EMPTY_SCOPE } from "../simulation/paramScope";
import type { AnalysisResult } from "../simulation/linearTransient";
import type { SchematicComponent } from "../schematic/types";

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

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.clear();
  saveAssistantApiKey("");
  streams.length = 0;
  streamRequests.length = 0;
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

describe("AssistantPanel", () => {
  it("shows the no-API-key empty state and never renders the composer without a key", () => {
    const onOpenSettings = vi.fn();
    render(<AssistantPanel {...baseProps({ onOpenSettings })} />);

    expect(screen.getByText("No API Key")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Message the assistant" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("sending a message appends the user turn and streams mock deltas into an assistant bubble", async () => {
    saveAssistantApiKey("test-key");
    render(<AssistantPanel {...baseProps()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), { target: { value: "What does R1 do?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("What does R1 do?")).toBeTruthy();
    expect(streams).toHaveLength(1);
    expect(streamRequests[0]).toEqual(expect.objectContaining({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "create_asc_circuit", strict: true }),
        expect.objectContaining({ name: "inspect_simulation_signal", strict: true }),
      ]),
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    }));
    const request = streamRequests[0] as { system: Array<{ text: string }> };
    expect(request.system[0].text).toContain("SPICE directives are internal working data");
    expect(request.system[0].text).toContain("Never claim an analysis ran");

    act(() => streams[0].emitText("It sets the", "It sets the"));
    await waitFor(() => expect(screen.getByText("It sets the")).toBeTruthy());

    // The "text" event's cumulative snapshot is what actually paints the
    // bubble (see AssistantPanel's onDelta) — finalMessage() just marks the
    // turn done, so a realistic mock streams the full text as a delta first.
    const full = "It sets the RC time constant with C1.";
    await act(async () => {
      streams[0].emitText(full.slice("It sets the".length), full);
      streams[0].resolve(full);
      await streams[0].finalMessage();
    });
    await waitFor(() => expect(screen.getByText(full)).toBeTruthy());
    // Streaming ended — composer is usable again for the next turn.
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Summarize my circuit" }));

    expect(screen.getByText("Summarize my circuit: what does it do, and what are the key stages?")).toBeTruthy();
    expect(streams).toHaveLength(1);
  });

  it("shows the ref-specific chip once a component is selected, and sends its prompt", () => {
    saveAssistantApiKey("test-key");
    const r1 = resistor("r1", "R1");
    render(<AssistantPanel {...baseProps({ components: [r1], selectedId: "r1" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Why does R1 behave this way?" }));
    expect(screen.getByText("Why does R1 behave this way, based on the current circuit and results?")).toBeTruthy();
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

  it("keeps model-authored ASC behind a validated, user-confirmed creation callback", async () => {
    saveAssistantApiKey("test-key");
    const onCreateAsc = vi.fn();
    render(<AssistantPanel {...baseProps({ onCreateAsc })} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Create an RC low-pass filter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const source = `Version 4
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
SYMATTR Value 5
TEXT 72 280 Left 2 !.tran 5m
`;
    await act(async () => {
      streams[0].resolveContent([
        { type: "text", text: "I prepared an RC low-pass schematic." },
        {
          type: "tool_use",
          id: "create-1",
          name: "create_asc_circuit",
          input: { filename: "rc-filter.asc", source },
        },
      ]);
      await streams[0].finalMessage();
    });

    expect(await screen.findByText("rc-filter.asc")).toBeTruthy();
    expect(screen.getByText("3 components · 5 wires")).toBeTruthy();
    // Raw file content is deliberately absent from the ordinary transcript.
    expect(screen.queryByText(source)).toBeNull();
    expect(onCreateAsc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create rc-filter.asc" }));
    await waitFor(() => expect(onCreateAsc).toHaveBeenCalledTimes(1));
    expect(onCreateAsc.mock.calls[0][0]).toEqual(expect.objectContaining({
      type: "create_asc",
      filename: "rc-filter.asc",
      source,
      componentCount: 3,
    }));
    expect(await screen.findByText("Created")).toBeTruthy();
  });

  it("rejects an invalid creation tool payload without invoking either apply boundary", async () => {
    saveAssistantApiKey("test-key");
    const onCreateAsc = vi.fn();
    const onApplyDocument = vi.fn();
    render(<AssistantPanel {...baseProps({ onCreateAsc, onApplyDocument })} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Create anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {
      streams[0].resolveContent([{
        type: "tool_use",
        id: "bad-create",
        name: "create_asc_circuit",
        input: { filename: "../../escape.asc", source: "not an ASC file" },
      }]);
      await streams[0].finalMessage();
    });

    expect((await screen.findByRole("alert")).textContent).toContain("couldn't validate that circuit proposal");
    expect(onCreateAsc).not.toHaveBeenCalled();
    expect(onApplyDocument).not.toHaveBeenCalled();
  });
});
