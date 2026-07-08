// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Button } from "./button";
import { Input } from "./input";
import { Separator } from "./separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { ScrollArea } from "./scroll-area";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./context-menu";

/**
 * §10 shadcn primitive smoke tests: every Radix-backed primitive needs a
 * couple of DOM APIs jsdom doesn't implement (ResizeObserver, pointer
 * capture, scrollIntoView) — without these, mounting ScrollArea/Select
 * throws before a single assertion runs. Polyfilled once here rather than
 * per-test since every primitive in this file shares the same jsdom
 * environment (`@vitest-environment jsdom` pragma above, scoped to this
 * file only — every other suite in the repo stays on the fast `node`
 * environment from vitest.config.ts).
 */
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { writable: true, value: ResizeObserverStub });
  Object.defineProperty(global, "ResizeObserver", { writable: true, value: ResizeObserverStub });
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => cleanup());

describe("Button (existing primitive — sanity baseline for the pattern)", () => {
  it("renders and forwards className", () => {
    render(<Button className="extra-class">Run</Button>);
    const el = screen.getByRole("button", { name: "Run" });
    expect(el.className).toContain("extra-class");
  });
});

describe("Input", () => {
  it("renders and forwards className", () => {
    render(<Input aria-label="Resistance" className="extra-class" />);
    const el = screen.getByRole("textbox", { name: "Resistance" });
    expect(el.className).toContain("extra-class");
  });

  it("applies .mono-num for the mono variant", () => {
    render(<Input aria-label="Voltage" variant="mono" />);
    const el = screen.getByRole("textbox", { name: "Voltage" });
    expect(el.className).toContain("mono-num");
  });
});

describe("Separator", () => {
  it("renders and forwards className", () => {
    render(<Separator decorative={false} className="extra-class" />);
    const el = screen.getByRole("separator");
    expect(el.className).toContain("extra-class");
  });
});

describe("Tabs", () => {
  it("renders trigger/content and forwards className", () => {
    render(
      <Tabs defaultValue="op" className="extra-class">
        <TabsList>
          <TabsTrigger value="op">Op point</TabsTrigger>
          <TabsTrigger value="tran">Transient</TabsTrigger>
        </TabsList>
        <TabsContent value="op">op-point body</TabsContent>
        <TabsContent value="tran">transient body</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole("tab", { name: "Op point" })).toBeTruthy();
    expect(screen.getByText("op-point body")).toBeTruthy();
    expect(document.querySelector(".extra-class")).toBeTruthy();
  });
});

describe("Tooltip", () => {
  it("renders content when open and forwards className", () => {
    render(
      <Tooltip open>
        <TooltipTrigger>Run</TooltipTrigger>
        <TooltipContent className="extra-class">Run simulation</TooltipContent>
      </Tooltip>,
    );
    const content = document.querySelector('[data-slot="tooltip-content"]');
    expect(content?.textContent).toContain("Run simulation");
    expect(content?.className).toContain("extra-class");
  });
});

describe("Dialog", () => {
  it("renders content when open and forwards className", () => {
    render(
      <Dialog open>
        <DialogContent className="extra-class">
          <DialogTitle>Settings</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(document.querySelector('[data-slot="dialog-content"]')?.className).toContain("extra-class");
  });
});

describe("DropdownMenu", () => {
  it("renders content when open and forwards className", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent className="extra-class">
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(document.querySelector('[data-slot="dropdown-menu-content"]')?.className).toContain("extra-class");
  });
});

describe("Select", () => {
  it("renders the closed trigger and forwards className", () => {
    render(
      <Select value="r1">
        <SelectTrigger className="extra-class" aria-label="Component">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="r1">Resistor</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByRole("combobox", { name: "Component" });
    expect(trigger.className).toContain("extra-class");
  });
});

describe("ScrollArea", () => {
  it("renders content and forwards className", () => {
    render(
      <ScrollArea className="extra-class">
        <div>scrollable body</div>
      </ScrollArea>,
    );
    expect(screen.getByText("scrollable body")).toBeTruthy();
    expect(document.querySelector('[data-slot="scroll-area"]')?.className).toContain("extra-class");
  });
});

describe("ContextMenu", () => {
  it("renders content when open and forwards className", () => {
    render(
      <ContextMenu open>
        <ContextMenuTrigger>right-click surface</ContextMenuTrigger>
        <ContextMenuContent className="extra-class">
          <ContextMenuItem>Rename</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.getByText("Rename")).toBeTruthy();
    expect(document.querySelector('[data-slot="context-menu-content"]')?.className).toContain("extra-class");
  });
});
