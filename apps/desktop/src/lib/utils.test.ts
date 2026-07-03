import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins classes and drops falsy conditionals", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });

  it("lets the last conflicting Tailwind utility win (tailwind-merge)", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
    expect(cn("bg-primary", "bg-muted")).toBe("bg-muted");
  });

  it("keeps non-conflicting utilities and handles object/array forms", () => {
    expect(cn(["flex", { hidden: false, "items-center": true }], "gap-2")).toBe(
      "flex items-center gap-2",
    );
  });

  it("returns an empty string for no input", () => {
    expect(cn()).toBe("");
  });
});
