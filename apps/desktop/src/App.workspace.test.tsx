// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("collapses only the physically conflicting Components column at 900px and restores it", () => {
    shellWidth = 900;
    render(<App />);

    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Components" })).toBeNull();
    expect(screen.getAllByRole("separator")).toHaveLength(2); // Explorer + Assistant.

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Tau assistant" }));
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Components" })).toBeNull();
  });

  it("uses the same independent Assistant column in simulator mode", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Simulator" }));

    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize assistant panel" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Components" })).toBeNull();
  });
});
