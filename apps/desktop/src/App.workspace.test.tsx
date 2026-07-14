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
    this.callback([{ target, contentRect: { width: 900, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });

beforeEach(() => {
  storage.clear();
  storage.set("tau.assistant.open", "1");
});
afterEach(() => cleanup());

describe("App schematic workspace tools", () => {
  it("keeps Components and Assistant independent inside the shared right dock", () => {
    render(<App />);

    expect(screen.getByRole("group", { name: "Workspace tools" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getAllByRole("separator", { name: "Resize workspace tools" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Components" }));
    expect(screen.queryByRole("complementary", { name: "Components" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Components" }));
    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
  });
});
