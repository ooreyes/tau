// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Forces the real useProject store's ensureDefaultWorkspace (see
// ExplorerPanel's mount effect in ShellPanels.tsx) to leave rootPath alone
// instead of seeding its in-memory browser fallback — the assistant
// scratchpad-fallback tests below need a genuine "no Schematics folder open"
// precondition, which normally only happens on the real desktop app before
// the user picks a folder (capability !== "none").
vi.mock("./project/fsBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project/fsBridge")>()),
  detectFsCapability: async () => "tauri" as const,
}));

// Keeps the assistant's proactive local-AI onboarding card (and the
// app-global LocalAiSetupDialog, which polls the same module) out of these
// layout/creation-flow tests — both are covered by their own component tests.
vi.mock("./lib/localAiRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/localAiRuntime")>()),
  isNativeDesktopApp: async () => false,
  getLocalAiStatus: async () => ({
    state: "ready" as const,
    endpoint: "http://127.0.0.1:8080/v1" as const,
    managed: true,
    installed: true,
    modelId: null,
    modelRepository: null,
    detail: "Local inference is ready.",
    presets: [],
  }),
}));

import App from "./App";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  },
});
class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: shellWidth, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });

let shellWidth = 1440;
beforeEach(() => {
  shellWidth = 1440;
  storage.clear();
  storage.set("tau.assistant.open", "1");
});
afterEach(() => cleanup());

describe("App schematic workspace tools", () => {
  it("keeps Components and Assistant as simultaneous independently resizable columns", () => {
    render(<App />);

    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize properties panel" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize assistant panel" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Workspace tools" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Tau assistant" }));
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
  });

  it("keeps AI and Components together at 900px, yielding Explorer until explicitly requested", () => {
    shellWidth = 900;
    render(<App />);

    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Project explorer" })).toBeNull();
    expect(screen.getAllByRole("separator")).toHaveLength(2); // Components + Assistant.

    fireEvent.click(screen.getByRole("button", { name: "Explorer" }));
    expect(screen.getByRole("complementary", { name: "Project explorer" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Components" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Components" }));
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Project explorer" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Project explorer" })).toBeTruthy();
  });

  it("uses the same independent Assistant column in simulator mode", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));

    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize assistant panel" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Components" })).toBeNull();
  });
});

// Drives the assistant's local-mlx chat path (the default provider — see
// lib/assistantPreferences.ts) through a raw `fetch` mock returning an
// OpenAI-shaped tool call, the same shape AssistantPanel.test.tsx's local
// tests use. This is the only way to reach App.tsx's own createAssistantCircuit
// callback: it's a closure, not an exported/mockable unit.
function stubLocalCreateCircuit(filename: string, directives: string[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    choices: [{
      message: {
        role: "assistant",
        content: "I put together a quick circuit.",
        tool_calls: [{
          id: "local-create",
          type: "function",
          function: {
            name: "build_tau_circuit",
            arguments: JSON.stringify({
              mode: "create",
              filename,
              components: [
                { ref: "V1", kind: "vsource", value: "5" },
                { ref: "R1", kind: "resistor", value: "1k" },
              ],
              nets: [
                { name: "vin", pins: ["V1.p", "R1.a"] },
                { name: "0", pins: ["V1.n", "R1.b"] },
              ],
              directives,
            }),
          },
        }],
      },
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("App assistant circuit creation without a Schematics folder", () => {
  it("opens the created circuit as an unsaved scratchpad tab with the fallback notice", async () => {
    stubLocalCreateCircuit("scratch-rc.asc", []); // no auto-runnable directive here
    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Create a quick RC circuit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    fireEvent.click(await screen.findByRole("button", { name: "Create scratch-rc.asc" }));

    // The tab opened with no on-disk path — the same schematic view stays up
    // (no auto-run directive to switch into the simulator) and shows the
    // scratchpad-specific notice instead of "Couldn't create …".
    expect(await screen.findByRole("tab", { name: /scratch-rc\.asc/ })).toBeTruthy();
    expect(await screen.findByText(
      "Opened scratch-rc.asc as a scratchpad — choose a Schematics folder to save files.",
    )).toBeTruthy();
    expect(screen.queryByText(/Couldn't create/)).toBeNull();
  });

  it("still latches and fires the assistant's requested analysis for a scratchpad circuit", async () => {
    stubLocalCreateCircuit("scratch-op.asc", [".op"]);
    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message the assistant" }), {
      target: { value: "Create a circuit and check its operating point" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    fireEvent.click(await screen.findByRole("button", { name: "Create scratch-op.asc" }));

    // pendingAutoRunRef is set before the pathless-tab branch returns, and the
    // directives-keyed effect in App.tsx still picks it up once loadCircuit
    // (inside openDocument) lands the scratchpad's .op directive in the
    // schematic store — evidenced by the switch into the simulator dashboard.
    await waitFor(() => expect(screen.getByRole("region", { name: "Circuit overview" })).toBeTruthy());
  });
});
