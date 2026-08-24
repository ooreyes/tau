// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { ComponentInspector, ComponentsRail, ExplorerPanel } from "./ShellPanels";
import { EditorToolbar } from "./editor/EditorChrome";
// Moved to drawer/ in redesign stage 2; it becomes the results drawer's Errors
// tab in stage 4. Imported from its new home rather than re-exported, so this
// file keeps pointing at where the component actually lives.
import { BottomPanel } from "./drawer/DiagnosticsTab";
import { behavioralSpecText, checkBehavioral } from "../simulation/behavioral";
import type { AnalysisResult } from "../simulation/linearTransient";
import type { SchematicComponent, SchematicPortDirection } from "../schematic/types";
import type { ProjectSheetInterfaceEntry } from "../schematic/projectSubcircuit";

/** An index entry for a readable child, built the way App's index will build it. */
function okEntry(
  sheetPath: string,
  ports: readonly [string, SchematicPortDirection][],
): ProjectSheetInterfaceEntry {
  return {
    sheetPath,
    fileName: sheetPath.split("/").pop() ?? sheetPath,
    status: "ok",
    ports: ports.map(([name, direction], index) => ({ name, labelId: `l${index}`, direction })),
  };
}
import { useSchematic } from "../store/useSchematic";
import { useProject } from "../store/useProject";
import { buildSubcircuitPinOverride } from "../schematic/subcircuitGeometry";
import { usePanelWidth } from "@/components/ui/resizable";

/**
 * The simulator view is read-only outside the schematic tab (pan/zoom/probe
 * only - see Canvas's `interactive` prop and App.tsx's keydown gate). This
 * toolbar renders unconditionally regardless of `mode` (App.tsx only swaps
 * the Canvas/Palette/ExplorerPanel), so its own editing controls need their
 * own `mode` gate - this was a second, mouse-driven bypass of the same bug
 * the keyboard gate fixes .
 */

beforeAll(() => {
  // Radix Select (ui/Select) needs pointer-capture APIs jsdom omits.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => cleanup());

function resetStore() {
  useSchematic.setState({
    components: [],
    wires: [],
    counters: {},
    selectedId: null,
    selectedWireId: null,
    selectedWireIds: [],
    selectedIds: [],
    selectedLabelIds: [],
    selectedProbeIds: [],
    tool: { mode: "select" },
    placeRotation: 0,
    placeMirror: false,
    clipboard: null,
    probes: [],
    netLabels: [],
    directives: [],
    userModelLibraries: [],
    past: [],
    future: [],
  });
  useProject.setState({ rootPath: null, rootName: null, tree: [], expanded: [], error: null });
}

beforeEach(() => resetStore());

const noopToolbarProps = {
  isRunning: false,
  onRun: () => {},
  onStop: () => {},
  onClearScratchpad: () => {},
  onOpenSimulationSetup: () => {},
};

describe("EditorToolbar - read-only outside schematic view ", () => {
  it("keeps the transport explicit: idle Run only, with no opaque refine button", () => {
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    expect(screen.getByRole("button", { name: "Run simulation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop simulation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refine transient resolution" })).toBeNull();
  });

  it("seats the transport beside the hierarchy control, with the slack to its right", () => {
    // Omar's direction: "move this button to be next to heirarchy". The Sheet
    // interface control is the hierarchy one - it is the Network node-tree glyph
    // and it opens the child-sheet ports dialog. Run used to sit across a
    // flex-1 spacer from it, at the far end of the strip.
    //
    // Asserted as sibling order rather than pixels, because that is what the
    // change actually is: `.transport` is `flex: none`, the spacer is `flex: 1`,
    // and moving the spacer after the transport is the whole diff.
    const { container } = render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    const strip = container.querySelector(".editor-toolbar")!;
    const children = [...strip.children];
    const hierarchy = screen.getByTitle("Sheet interface");
    const transport = container.querySelector(".transport")!;
    const spacer = container.querySelector(".editor-toolbar-spacer")!;

    expect(children.indexOf(transport)).toBe(children.indexOf(hierarchy) + 1);
    expect(children.indexOf(spacer)).toBe(children.indexOf(transport) + 1);
    // The spacer survives: without it the strip would distribute its slack
    // between the tools instead of collecting it at the end.
    expect(children[children.length - 1]).toBe(spacer);
  });

  it("exposes a horizontally scrollable tool strip so Run stays reachable at the 900px floor", () => {
    // jsdom does not compute layout overflow, but the class contract is what
    // App.css keys the overflow-x:auto rule on - prove the affordance is wired.
    const { container } = render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    const toolbar = container.querySelector(".editor-toolbar");
    expect(toolbar).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run simulation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop simulation" })).toBeNull();
  });

  it("opens the child-sheet interface authoring surface from the production toolbar", () => {
    const onOpenProjectInterface = vi.fn();
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} onOpenProjectInterface={onOpenProjectInterface} />);
    fireEvent.click(screen.getByRole("button", { name: "Sheet interface" }));
    expect(onOpenProjectInterface).toHaveBeenCalledOnce();
  });

  it("disables Wire, Net label, Undo, Redo, erase-selection, and delete-schematic in simulator mode", () => {
    const emptyDoc = { components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [], textAnnotations: [], ascShapes: [], ascDataFlags: [], ascForeignSymbols: [], ascHierarchicalBlocks: [], ascSheet: null, userModelLibraries: [] };
    // Both past and future populated so canUndo/canRedo would be true if the
    // mode gate weren't there - proves the gate, not just an empty history.
    useSchematic.setState({ past: [emptyDoc], future: [emptyDoc] });
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);

    for (const name of ["Wire", "Net label (F4)", "Undo", "Redo", "Erase selection (Delete)", "Clear schematic"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("does not undo the document when the disabled Undo button is clicked in simulator mode", () => {
    useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      past: [{ components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [], textAnnotations: [], ascShapes: [], ascDataFlags: [], ascForeignSymbols: [], ascHierarchicalBlocks: [], ascSheet: null, userModelLibraries: [] }],
    });
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useSchematic.getState().components).toHaveLength(1); // untouched
    expect(useSchematic.getState().past).toHaveLength(1); // history untouched
  });

  it("does not arm the wire tool when the disabled Wire button is clicked in simulator mode", () => {
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Wire" }));
    expect(useSchematic.getState().tool).toEqual({ mode: "select" });
  });

  it("does not open the clear-schematic confirmation when clicked in simulator mode", () => {
    const onClearScratchpad = vi.fn();
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} onClearScratchpad={onClearScratchpad} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear schematic" }));
    expect(onClearScratchpad).not.toHaveBeenCalled();
  });

  it("keeps Select and Probe enabled in simulator mode (probing must still work)", () => {
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);
    expect((screen.getByRole("button", { name: "Select" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Probe" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens Simulation setup directly from the schematic toolbar", () => {
    const onOpenSimulationSetup = vi.fn();
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} onOpenSimulationSetup={onOpenSimulationSetup} />);
    fireEvent.click(screen.getByRole("button", { name: "Simulation setup" }));
    expect(onOpenSimulationSetup).toHaveBeenCalledOnce();
  });

  it("enables Wire, Undo (with history), and delete-schematic in schematic mode", () => {
    useSchematic.setState({ past: [{ components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [], textAnnotations: [], ascShapes: [], ascDataFlags: [], ascForeignSymbols: [], ascHierarchicalBlocks: [], ascSheet: null, userModelLibraries: [] }] });
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);

    for (const name of ["Wire", "Net label (F4)", "Undo", "Clear schematic"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("offers a direct toolbar action for the selected object", () => {
    useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      selectedId: "r-1",
      selectedIds: ["r-1"],
    });
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);

    const remove = screen.getByRole("button", { name: "Erase selection (Delete)" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    fireEvent.click(remove);
    expect(useSchematic.getState().components).toEqual([]);
  });

  it("keeps the selection action disabled when there is nothing to remove", () => {
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    expect((screen.getByRole("button", { name: "Erase selection (Delete)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not expose model-library authoring in the default toolbar", () => {
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    expect(screen.queryByRole("button", { name: "Model libraries" })).toBeNull();
  });
});

describe("ComponentInspector - no-selection empty state", () => {
  it("shows the No Selection title and full helper text when nothing is selected", () => {
    render(<ComponentInspector selected={null} />);
    expect(screen.getByText("No Selection")).toBeTruthy();
    expect(
      screen.getByText(
        "Select a component, wire, node, or label to view and edit its properties.",
      ),
    ).toBeTruthy();
  });

  it("renders no input fields or dead controls when nothing is selected", () => {
    const { container } = render(<ComponentInspector selected={null} />);
    expect(container.querySelectorAll("input, select, button").length).toBe(0);
    expect(container.querySelector(".property-grid")).toBeNull();
    expect(container.querySelector(".inspector-summary.empty")).toBeTruthy();
  });
});

describe("ComponentInspector - imported op-amp parameters", () => {
  it("labels a non-library LTspice model honestly and exposes its joined parameter line", () => {
    const selected = {
      id: "u-1",
      kind: "opamp" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "Avol=1Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0",
      label: "U1",
      ltExtraAttrs: {
        baseValue: "",
        derivedValue: "Avol=1Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0",
        extras: {
          Value2: "Avol=1Meg GBW=10Gig Slew=10Gig",
          SpiceLine: "ilimit=2 rail=0",
        },
      },
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} manualModelControls />);

    const model = screen.getByRole("combobox", { name: "Op-amp model" });
    expect(model.tagName).toBe("BUTTON");
    expect(model.getAttribute("data-slot")).toBe("select-trigger");
    expect(model.textContent).toContain("Universal / behavioral");
    expect(document.querySelector(".property-field select[aria-label='Op-amp model']")).toBeNull();
    const parameters = screen.getByRole("textbox", { name: "Advanced op-amp parameters" }) as HTMLInputElement;
    expect(parameters.value).toBe(selected.value);

    fireEvent.change(parameters, {
      target: { value: "Avol=2Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0" },
    });
    expect(useSchematic.getState().components[0].value)
      .toBe("Avol=2Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0");
  });

  it("shows separate part/model controls and an honest missing-model action", () => {
    const selected = {
      id: "u-vendor",
      kind: "opamp" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "OP07 LT1001",
      label: "U1",
      ltSymbolType: "Opamps\\OP07",
      ltExtraAttrs: {
        baseValue: "OP07",
        derivedValue: "OP07 LT1001",
        extras: { Value2: "LT1001" },
      },
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onAttachModelFile={openLibraries} manualModelControls />);

    expect((screen.getByRole("textbox", { name: "Op-amp part" }) as HTMLInputElement).value).toBe("OP07");
    const model = screen.getByRole("textbox", { name: "Op-amp simulation model" }) as HTMLInputElement;
    expect(model.value).toBe("LT1001");
    expect(screen.getByRole("status").textContent).toMatch(/Needs a library model · Tau will not substitute a generic gain block/);
    fireEvent.click(screen.getByRole("button", { name: "Attach .lib/.sub file" }));
    expect(openLibraries).toHaveBeenCalledOnce();

    fireEvent.change(model, { target: { value: "MY_OP07" } });
    expect(useSchematic.getState().components[0]).toMatchObject({
      value: "OP07 MY_OP07",
      ltExtraAttrs: { extras: { Value2: "MY_OP07" } },
    });
  });

  it("keeps an imported vendor identity and model read-only in the default inspector", () => {
    const selected = {
      id: "u-vendor-default",
      kind: "opamp" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "OP07 LT1001",
      label: "U1",
      ltSymbolType: "Opamps\\OP07",
      ltExtraAttrs: {
        baseValue: "OP07",
        derivedValue: "OP07 LT1001",
        extras: { Value2: "LT1001" },
      },
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    expect(screen.getByText("OP07")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Exact model" })).toBeNull();
    expect(screen.getByText("LT1001")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Op-amp model" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Open-loop gain" })).toBeNull();
  });
});

describe("ComponentInspector - semiconductor model chooser", () => {
  it("hides manual model controls by default while preserving exact refusal", () => {
    const selected = {
      id: "m-default",
      kind: "nmos" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "IRF540",
      label: "M1",
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onAttachModelFile={openLibraries} />);

    expect(screen.queryByRole("combobox", { name: "Simulation model" })).toBeNull();
    expect(screen.getByRole("button", { name: "Attach .lib/.sub file" })).toBeTruthy();
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain('Needs exact NMOS "IRF540"; attach .lib/.sub. Run is refused');
    fireEvent.click(screen.getByRole("button", { name: "Attach .lib/.sub file" }));
    expect(openLibraries).toHaveBeenCalledOnce();
  });

  it("selects the exact bundled Class-D PMOS and drops inapplicable Level-1 geometry", async () => {
    const selected = {
      id: "m-p",
      kind: "pmos" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "PMOS W=40u L=2u",
      label: "M1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} manualModelControls />);

    const chooser = screen.getByRole("combobox", { name: "Simulation model" });
    expect(chooser.tagName).toBe("BUTTON");
    expect(chooser.getAttribute("data-slot")).toBe("select-trigger");
    expect(document.querySelector("select[aria-label='Simulation model']")).toBeNull();

    fireEvent.pointerDown(chooser, { button: 0, pointerId: 1, pointerType: "mouse" });
    const rsr = await screen.findByRole("option", { name: /RSR015P06 · Tau exact models/ });
    expect(screen.queryByRole("option", { name: /^QS6K1/ })).toBeNull();
    fireEvent.pointerUp(rsr, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(rsr);

    expect(useSchematic.getState().components[0].value).toBe("RSR015P06");
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
  });

  it("offers compatible attached models with their filename and never wrong device types", async () => {
    const selected = {
      id: "q-n",
      kind: "npn" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "MY_NPN",
      label: "Q1",
    };
    useSchematic.setState({
      components: [selected],
      selectedId: selected.id,
      selectedIds: [selected.id],
      userModelLibraries: [{
        name: "transistors.lib",
        text: ".model MY_NPN NPN(Bf=175)\n.model NOT_FOR_Q1 PNP(Bf=90)",
      }],
    });
    render(<ComponentInspector selected={selected} manualModelControls />);

    const chooser = screen.getByRole("combobox", { name: "Simulation model" });
    expect(chooser.tagName).toBe("BUTTON");
    expect(chooser.getAttribute("data-slot")).toBe("select-trigger");
    expect(chooser.textContent).toContain("MY_NPN · transistors.lib");
    expect(screen.getByRole("status").textContent).toContain("Ready · exact NPN model from transistors.lib");

    fireEvent.pointerDown(chooser, { button: 0, pointerId: 1, pointerType: "mouse" });
    expect(await screen.findByRole("option", { name: "MY_NPN · transistors.lib" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /NOT_FOR_Q1/ })).toBeNull();
  });

  it("keeps an unresolved imported part visible and offers the library action", () => {
    const selected = {
      id: "m-missing",
      kind: "nmos" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "IRF540",
      label: "M1",
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onAttachModelFile={openLibraries} manualModelControls />);

    const chooser = screen.getByRole("combobox", { name: "Simulation model" });
    expect(chooser.tagName).toBe("BUTTON");
    expect(chooser.getAttribute("data-slot")).toBe("select-trigger");
    expect(chooser.textContent).toContain("IRF540");
    expect(document.querySelector("select[aria-label='Simulation model']")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Needs exact NMOS");
    fireEvent.click(screen.getByRole("button", { name: "Attach .lib/.sub file" }));
    expect(openLibraries).toHaveBeenCalledOnce();
  });

  it("routes a named switch through exact SW resolution instead of a static State field", () => {
    const selected = {
      id: "s-model",
      kind: "switch" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "MYSW",
      label: "S1",
    };
    useSchematic.setState({
      components: [selected],
      selectedId: selected.id,
      selectedIds: [selected.id],
      directives: [".model MYSW SW(Ron=1 Roff=1Meg Vt=1)"],
    });
    render(<ComponentInspector selected={selected} onAttachModelFile={vi.fn()} />);

    expect(screen.queryByRole("textbox", { name: "State" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Ready · exact SW model from This document");
    expect(screen.queryByRole("button", { name: "Attach .lib/.sub file" })).toBeNull();
    expect(useSchematic.getState().components[0].value).toBe("MYSW");
  });

  it("keeps exact-model recovery available only for an unresolved named switch", () => {
    const selected = {
      id: "s-missing",
      kind: "switch" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "MYSW",
      label: "S1",
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onAttachModelFile={openLibraries} />);

    expect(screen.queryByRole("textbox", { name: "State" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain('Needs exact SWITCH "MYSW"');
    fireEvent.click(screen.getByRole("button", { name: "Attach .lib/.sub file" }));
    expect(openLibraries).toHaveBeenCalledOnce();
    expect(useSchematic.getState().components[0].value).toBe("MYSW");
  });

  it("keeps a native static switch on its State field without a model-recovery action", () => {
    const selected = {
      id: "s-static",
      kind: "switch" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "open",
      label: "S1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onAttachModelFile={vi.fn()} />);

    expect((screen.getByRole("textbox", { name: "State" }) as HTMLInputElement).value).toBe("open");
    expect(screen.queryByRole("button", { name: "Attach .lib/.sub file" })).toBeNull();
  });
});

describe("ComponentInspector - native subcircuit chooser", () => {
  it("places the bundled Class-D driver with exact terminals and bounded named knobs", async () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useSchematic.setState({ components: [selected] });
    const { rerender } = render(<ComponentInspector selected={selected} manualModelControls />);
    const chooser = screen.getByRole("combobox", { name: "Subcircuit model" });
    expect(chooser.tagName).toBe("BUTTON");
    expect(chooser.getAttribute("data-slot")).toBe("select-trigger");
    expect(document.querySelector("select[aria-label='Subcircuit model']")).toBeNull();

    fireEvent.pointerDown(chooser, { button: 0, pointerId: 1, pointerType: "mouse" });
    const driver = await screen.findByRole("option", { name: /TauDeadtimeDriver · 5 terminals/ });
    fireEvent.pointerUp(driver, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(driver);

    expect(useSchematic.getState().components[0]).toMatchObject({
      value: "TauDeadtimeDriver",
      pinOverride: [
        { id: "p1", label: "vcc" },
        { id: "p2", label: "vee" },
        { id: "p3", label: "pwm" },
        { id: "p4", label: "gp" },
        { id: "p5", label: "gn" },
      ],
    });
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} manualModelControls />);

    const dead = screen.getByRole("textbox", { name: "Dead time" }) as HTMLInputElement;
    expect(dead.value).toBe("200");
    const deadPrefix = screen.getByRole("combobox", { name: "Dead time SI prefix" });
    expect(deadPrefix.tagName).toBe("BUTTON");
    expect(deadPrefix.getAttribute("data-slot")).toBe("select-trigger");
    expect(deadPrefix.textContent).toContain("ns");
    expect((screen.getByRole("textbox", { name: "Input threshold" }) as HTMLInputElement).value).toBe("0.5");
    expect(screen.queryByRole("combobox", { name: "Input threshold SI prefix" })).toBeNull();
    expect(screen.getByText(/Blanking interval between one gate turning off/)).toBeTruthy();

    fireEvent.change(dead, { target: { value: "250" } });
    expect(useSchematic.getState().components[0].value).toBe("TauDeadtimeDriver dead=250n");
  });

  it("shows a named model contract and edits declared parameters without a raw Value field", async () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "deadtime DEAD=300n", label: "X1",
    };
    useSchematic.setState({
      components: [selected],
      directives: [`.subckt deadtime vcc vee pwm gp gn params: dead=250n\\n.ends deadtime`],
    });

    const { rerender } = render(<ComponentInspector selected={selected} manualModelControls />);
    const chooser = screen.getByRole("combobox", { name: "Subcircuit model" });
    expect(chooser.tagName).toBe("BUTTON");
    expect(chooser.getAttribute("data-slot")).toBe("select-trigger");
    expect(chooser.textContent).toContain("deadtime");
    expect(document.querySelector("select[aria-label='Subcircuit model']")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("5 terminals from");
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();

    const dead = screen.getByRole("textbox", { name: "Subcircuit parameter dead" }) as HTMLInputElement;
    expect(dead.value).toBe("300n");
    fireEvent.change(dead, { target: { value: "400n" } });
    expect(useSchematic.getState().components[0].value).toBe("deadtime dead=400n");

    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} manualModelControls />);
    const nextChooser = screen.getByRole("combobox", { name: "Subcircuit model" });
    fireEvent.pointerDown(nextChooser, { button: 0, pointerId: 1, pointerType: "mouse" });
    const passthrough = await screen.findByRole("option", { name: /tau_passthrough · 2 terminals/ });
    fireEvent.pointerUp(passthrough, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(passthrough);
    expect(useSchematic.getState().components[0]).toMatchObject({
      value: "tau_passthrough",
      pinOverride: [
        { id: "p1", label: "1" },
        { id: "p2", label: "2" },
      ],
    });
  });

  /**
   * Item 4b. The status line names the terminals in one comma-separated run; it
   * cannot say which pin on the drawing each one is. The list does, in the
   * declaration order the netlist writes the nodes in.
   */
  it("lists the terminals in declaration order with the side each sits on", async () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useSchematic.setState({ components: [selected] });
    const { rerender } = render(<ComponentInspector selected={selected} manualModelControls />);

    const chooser = screen.getByRole("combobox", { name: "Subcircuit model" });
    fireEvent.pointerDown(chooser, { button: 0, pointerId: 1, pointerType: "mouse" });
    const driver = await screen.findByRole("option", { name: /TauDeadtimeDriver · 5 terminals/ });
    fireEvent.pointerUp(driver, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(driver);
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} manualModelControls />);

    const ports = screen.getByRole("list", { name: "Terminal order" });
    const rows = [...ports.querySelectorAll("li")].map((row) => row.textContent);
    expect(rows).toEqual(["1vccleft", "2veeleft", "3pwmleft", "4gpright", "5gnright"]);
    // The sides are read off the instance's own pin bank, so they describe this
    // placement rather than a generic guess.
    expect(useSchematic.getState().components[0].pinOverride?.map((pin) => pin.x))
      .toEqual([-48, -48, -48, 48, 48]);
  });

  it("offers the route from a .lib file to the sheet even once a model resolves", () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected] });
    render(<ComponentInspector selected={selected} onAttachModelFile={openLibraries} manualModelControls />);

    expect(screen.getByRole("status").textContent).toContain("Ready · 2 terminals from");
    expect(screen.getByText("Open or drop a compatible .lib/.sub into this schematic.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Attach .lib/.sub file" }));
    expect(openLibraries).toHaveBeenCalledOnce();
  });

  it("blocks an unresolved model and routes the user to the file-driven recovery path", () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "vendor_driver", label: "X1",
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected] });
    render(<ComponentInspector selected={selected} onAttachModelFile={openLibraries} manualModelControls />);

    const chooser = screen.getByRole("combobox", { name: "Subcircuit model" });
    expect(chooser.tagName).toBe("BUTTON");
    expect(chooser.getAttribute("data-slot")).toBe("select-trigger");
    expect(chooser.textContent).toContain("vendor_driver");
    expect(document.querySelector("select[aria-label='Subcircuit model']")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Run is refused");
    fireEvent.click(screen.getByRole("button", { name: "Attach .lib/.sub file" }));
    expect(openLibraries).toHaveBeenCalledOnce();
  });

  it("links a chosen sheet with ZERO retyping: the pinout arrives from the child", async () => {
    // PDF5 reason 1, closed. The old surface made you read the child's ports,
    // remember them, and retype them in the right order into a free-text box.
    // This test fires no change event on any textbox - see the meta-check
    // below, which reads this test's own source to prove it.
    const selected = {
      id: "x-project",
      kind: "subckt" as const,
      x: 0,
      y: 0,
      rotation: 0 as const,
      value: "tau_passthrough",
      label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
        { name: "legacy.asc", path: "/project/legacy.asc", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    const { rerender } = render(
      <ComponentInspector
        selected={selected}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[okEntry("child.sim", [["IN", "In"], ["OUT", "Out"], ["GND", "BiDir"]])]}
      />,
    );

    const sheet = screen.getByRole("combobox", { name: "Sheet interface" });
    fireEvent.pointerDown(sheet, { button: 0, pointerId: 5, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("option", { name: /child\.sim · 3 ports: IN, OUT, GND/ }));

    // The model name is derived from the file stem, already in the field.
    expect((screen.getByRole("textbox", { name: "Sheet block name" }) as HTMLInputElement).value)
      .toBe("Child");
    // The pinout is shown, in order, with the side each direction implies.
    const proposed = screen.getByRole("list", { name: "Proposed pin order" });
    expect(within(proposed).getAllByRole("listitem").map((row) => row.textContent))
      .toEqual(["1INinleft", "2OUToutright", "3GNDbidirleft"]);
    const contract = screen.getByRole("group", { name: "Parent block contract" });
    expect(contract.textContent).toContain("X1");
    expect(contract.textContent).toContain("child.sim");
    expect(screen.getByText(/Proposed mapping from the selected child sheet/i)).toBeTruthy();
    expect(screen.getByText(/only after the link is saved/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Link this sheet" }));

    // The production inspector receives the updated selected component from
    // the document store. Mirror that boundary here before checking the
    // post-commit wording; the first assertion above is intentionally the
    // pre-commit path.
    rerender(
      <ComponentInspector
        selected={useSchematic.getState().components[0]!}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[okEntry("child.sim", [["IN", "In"], ["OUT", "Out"], ["GND", "BiDir"]])]}
      />,
    );
    expect(screen.getByText(/this parent block’s stored p1…pN order/i)).toBeTruthy();

    expect(useSchematic.getState().components[0].projectSubcircuit).toEqual({
      sheetPath: "child.sim",
      model: "Child",
      ports: ["IN", "OUT", "GND"],
    });
    // The bank follows the child's directions: In left, Out right, BiDir to the
    // shorter column (ties left), while ids/labels stay in ports order.
    expect(useSchematic.getState().components[0].pinOverride).toEqual([
      { id: "p1", label: "IN", x: -48, y: -16 },
      { id: "p2", label: "OUT", x: 48, y: 0 },
      { id: "p3", label: "GND", x: -48, y: 16 },
    ]);
    expect(screen.queryByRole("option", { name: /legacy\.asc/ })).toBeNull();
  });

  it("proves the zero-retyping claim: that test drives no textbox at all", () => {
    // A test that says "no typing was needed" while typing is worthless, so the
    // claim is checked against the test's own source rather than trusted.
    const source = readFileSync(join(__dirname, "ShellPanels.test.tsx"), "utf8");
    const start = source.indexOf('it("links a chosen sheet with ZERO retyping');
    const end = source.indexOf('it("proves the zero-retyping claim');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toContain("fireEvent.change");
  });

  it("keeps the free-text ordered contract for an EE, behind Advanced", () => {
    // C1: the field is DEMOTED, not deleted. An EE may want a terminal order
    // the child did not declare, or a contract for a sheet not written yet.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(
      <ComponentInspector
        selected={selected}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[okEntry("child.sim", [["IN", "In"], ["OUT", "Out"], ["GND", "BiDir"]])]}
      />,
    );

    expect(screen.queryByRole("textbox", { name: "Ordered block ports" })).toBeNull();

    // The sheet is chosen by the reader, never pre-selected for them.
    const eeSheet = screen.getByRole("combobox", { name: "Sheet interface" });
    expect(eeSheet.textContent).toBe("Choose a Tau sheet");
    fireEvent.pointerDown(eeSheet, { button: 0, pointerId: 5, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("option", { name: /child\.sim/ }));

    fireEvent.click(screen.getByRole("button", { name: "Edit contract manually" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Manual sheet block name" }), { target: { value: "ChildModel" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Ordered block ports" }), { target: { value: "GND, IN, OUT" } });

    // A deliberate difference is framed as one, not as an error.
    expect(screen.getByText(/Your contract, deliberately different/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Link sheet block" }));
    expect(useSchematic.getState().components[0].projectSubcircuit).toEqual({
      sheetPath: "child.sim",
      model: "ChildModel",
      ports: ["GND", "IN", "OUT"],
    });
    expect(within(screen.getByRole("group", { name: "Sheet block" })).getAllByRole("status")
      .map((row) => row.textContent).join(" | "))
      .toContain("child’s public ports match in order");
  });

  // An `.asc` is a legal link TARGET and an illegal link OWNER
  // (canonicalProjectSheetPath vs canonicalProjectOwnerPath), so the panel has to
  // say which half of that it is refusing. It used to claim the whole feature was
  // shut, which is now false.
  const ascInspector = (onSaveSheetAsSim?: () => void) => {
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "legacy.asc", path: "/project/legacy.asc", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(
      <ComponentInspector
        selected={selected}
        projectFilePath="/project/legacy.asc"
        sheetInterfaces={[okEntry("child.sim", [["IN", "In"], ["OUT", "Out"]])]}
        onSaveSheetAsSim={onSaveSheetAsSim}
      />,
    );
    return screen.getByRole("group", { name: "Sheet block" });
  };

  it("tells an .asc sheet it can BE a block but cannot hold one, and offers no dead button", () => {
    const group = ascInspector();

    expect(within(group).getByRole("status").textContent)
      // The remedy has to be performable. "Save this sheet as .sim" was not:
      // no Save-As in the app changes an extension, and an Explorer rename to
      // `.sim` keeps the LTspice bytes, so the file would not reopen.
      .toBe("This .asc sheet can be used as a sheet block on a .sim parent, but it cannot hold one:"
        + " LTspice’s format has nowhere to store the link or its port order."
        + " To place blocks, put them on a Tau .sim sheet — a new sheet is one by default.");
    expect(screen.queryByRole("button", { name: "Link this sheet" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Sheet interface" })).toBeNull();
    // No caller in the app supplies the handler, so the row must not show a
    // button at all. The old panel always drew one and always disabled it.
    expect(within(group).queryByRole("button")).toBeNull();
  });

  it("shows the Save-as-.sim button only when a caller can actually perform it", () => {
    const saveAs = vi.fn();
    const group = ascInspector(saveAs);

    fireEvent.click(within(group).getByRole("button", { name: "Save as .sim" }));
    expect(saveAs).toHaveBeenCalledOnce();
  });

  it("annotates a sheet with no interface as selectable, and an unreadable one as disabled", async () => {
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    const openSheet = vi.fn();
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "mixer.sim", path: "/project/mixer.sim", kind: "file" },
        { name: "broken.sim", path: "/project/broken.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(
      <ComponentInspector
        selected={selected}
        projectFilePath="/project/root.sim"
        onOpenSheet={openSheet}
        sheetInterfaces={[
          { sheetPath: "mixer.sim", fileName: "mixer.sim", status: "no-interface", ports: [] },
          {
            sheetPath: "broken.sim", fileName: "broken.sim", status: "unreadable", ports: [],
            reason: "Unexpected token } in JSON at position 41",
          },
        ]}
      />,
    );

    const sheet = screen.getByRole("combobox", { name: "Sheet interface" });
    fireEvent.pointerDown(sheet, { button: 0, pointerId: 5, pointerType: "mouse" });
    const unreadable = await screen.findByRole("option", { name: /broken\.sim · unreadable/ });
    expect(unreadable.getAttribute("data-disabled")).not.toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: /mixer\.sim · no interface yet/ }));

    // Selectable, but the only honest confirm is "go mark its nets".
    expect(screen.queryByRole("button", { name: "Link this sheet" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open mixer.sim and mark its nets" }));
    expect(openSheet).toHaveBeenCalledWith("mixer.sim");
  });

  it("shows a reorder as drift, reviews it in two labelled columns, and adopts it once", () => {
    // PDF5 reason 3. The dangerous case: same names, new order, so the stored
    // contract still looks legal while the netlist's node order has changed.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "Child", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id], wires: [], netLabels: [], probes: [] });
    useSchematic.getState().setProjectSubcircuitLink(
      "x-project",
      { sheetPath: "child.sim", model: "Child", ports: ["IN", "OUT", "GND"] },
      { directions: ["In", "Out", "BiDir"] },
    );
    const linked = useSchematic.getState().components[0];
    // The child has since swapped its last two ports.
    const entry = okEntry("child.sim", [["IN", "In"], ["GND", "BiDir"], ["OUT", "Out"]]);
    render(
      <ComponentInspector
        selected={linked}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[entry]}
        comparedSource="disk"
      />,
    );

    const group = screen.getByRole("group", { name: "Sheet block" });
    expect(within(group).getByText(/reordered its connections: IN, OUT, GND -> IN, GND, OUT/)).toBeTruthy();

    fireEvent.click(within(group).getByRole("button", { name: "Review interface change…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("columnheader", { name: "This block’s contract" })).toBeTruthy();
    expect(within(dialog).getByRole("columnheader", { name: "child.sim now" })).toBeTruthy();
    expect(within(dialog).getByText(/Compared against child\.sim as saved on disk\./)).toBeTruthy();
    // Keeping is the default act; nothing has changed yet.
    expect(within(dialog).getByRole("button", { name: "Keep current contract" })).toBeTruthy();
    expect(useSchematic.getState().components[0].projectSubcircuit?.ports).toEqual(["IN", "OUT", "GND"]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Adopt sheet interface" }));

    const adopted = useSchematic.getState().components[0];
    expect(adopted.projectSubcircuit).toEqual({
      sheetPath: "child.sim", model: "Child", ports: ["IN", "GND", "OUT"],
    });
    // The X card's node order follows the contract - ids stay p1..pN in ports
    // order - and the geometry is whatever the ONE slot rule says for the
    // child's live directions, never a second layout rule in the inspector.
    expect(adopted.pinOverride?.map((pin) => [pin.id, pin.label])).toEqual([
      ["p1", "IN"], ["p2", "GND"], ["p3", "OUT"],
    ]);
    expect(adopted.pinOverride).toEqual(buildSubcircuitPinOverride(
      { x: 0, y: 0, rotation: 0, mirrored: false },
      ["IN", "GND", "OUT"],
      ["In", "BiDir", "Out"],
    ));
    // The pin that changed column really moved, so the picture is not stale.
    expect(adopted.pinOverride?.find((pin) => pin.label === "GND")?.x)
      .not.toBe(linked.pinOverride?.find((pin) => pin.label === "GND")?.x);
    expect(useSchematic.getState().past.length).toBeGreaterThan(0);
  });

  it("calls a direction-only change what it is: inert, with a relayout and no scare", () => {
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "Child", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id], wires: [], netLabels: [], probes: [] });
    useSchematic.getState().setProjectSubcircuitLink(
      "x-project",
      { sheetPath: "child.sim", model: "Child", ports: ["IN", "OUT", "GND"] },
      { directions: ["In", "Out", "BiDir"] },
    );
    const linked = useSchematic.getState().components[0];
    // GND was BiDir (bottom-LEFT, the way an EE draws a ground) and is now Out,
    // which moves it to the right column. Same names, same order, same nodes.
    expect(linked.pinOverride?.find((pin) => pin.label === "GND")?.x).toBe(-48);
    render(
      <ComponentInspector
        selected={linked}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[okEntry("child.sim", [["IN", "In"], ["OUT", "Out"], ["GND", "Out"]])]}
      />,
    );

    const group = screen.getByRole("group", { name: "Sheet block" });
    expect(within(group).getByText(/Nothing electrical changes\./)).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: "Review interface change…" }));
    const dialog = screen.getByRole("dialog");
    // The only offer is a redraw; nothing here may imply Run is about to fail.
    expect(within(dialog).getByRole("button", { name: "Re-lay out this block" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Adopt sheet interface" })).toBeNull();
  });

  it("never auto-repairs or auto-unlinks a vanished child sheet", () => {
    // C8. A parent's netlist must not change as a side effect of another file's
    // deletion, so the stored contract AND the pin bank are left intact and the
    // only remedies are explicit.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "Child", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [{ name: "root.sim", path: "/project/root.sim", kind: "file" }],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id], wires: [], netLabels: [], probes: [] });
    useSchematic.getState().setProjectSubcircuitLink("x-project", {
      sheetPath: "child.sim", model: "Child", ports: ["IN", "OUT", "GND"],
    });
    const before = JSON.stringify(useSchematic.getState().components[0]);
    const linked = useSchematic.getState().components[0];
    render(
      <ComponentInspector
        selected={linked}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[{ sheetPath: "child.sim", fileName: "child.sim", status: "missing", ports: [] }]}
      />,
    );

    const group = screen.getByRole("group", { name: "Sheet block" });
    expect(within(group).getByText(/child\.sim is missing from this project/)).toBeTruthy();
    expect(JSON.stringify(useSchematic.getState().components[0])).toBe(before);

    // Unlinking exists, but only as something a person did.
    fireEvent.click(within(group).getByRole("button", { name: "Unlink" }));
    expect(useSchematic.getState().components[0].projectSubcircuit).toBeUndefined();
  });

  it("recovers from a vanished child by pointing the block at a real sheet", async () => {
    // VERIFY: the missing-sheet row offered "Choose another sheet", which opened
    // the MANUAL CONTRACT editor - not a sheet chooser - while the control that
    // does choose a sheet sat two rows above it. The recovery has to be the
    // Select, and it has to actually rewrite the link.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "Child", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "rescue.sim", path: "/project/rescue.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id], wires: [], netLabels: [], probes: [] });
    useSchematic.getState().setProjectSubcircuitLink("x-project", {
      sheetPath: "gone.sim", model: "Child", ports: ["IN", "OUT", "GND"],
    });
    const linked = useSchematic.getState().components[0];
    render(
      <ComponentInspector
        selected={linked}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[
          { sheetPath: "gone.sim", fileName: "gone.sim", status: "missing", ports: [] },
          okEntry("rescue.sim", [["IN", "In"], ["OUT", "Out"], ["GND", "BiDir"]]),
        ]}
      />,
    );

    const group = screen.getByRole("group", { name: "Sheet block" });
    expect(within(group).getByRole("alert").textContent).toContain("“Sheet interface” above");
    expect(within(group).queryByRole("button", { name: "Choose another sheet" })).toBeNull();

    fireEvent.pointerDown(screen.getByRole("combobox", { name: "Sheet interface" }), { button: 0, pointerId: 5, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("option", { name: /rescue\.sim · 3 ports/ }));
    fireEvent.click(screen.getByRole("button", { name: "Relink this sheet" }));

    expect(useSchematic.getState().components[0].projectSubcircuit).toEqual({
      sheetPath: "rescue.sim", model: "Rescue", ports: ["IN", "OUT", "GND"],
    });
  });

  it("offers a derived model name that the compiler will not refuse", () => {
    // A student must never eat a Run refusal about a name they never typed, so
    // the derived default is pre-checked against the same collision sets
    // buildProjectHierarchyDeck checks - here, an inline .subckt named Child.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({
      components: [selected], selectedId: selected.id, selectedIds: [selected.id],
      directives: [".subckt Child a b", ".ends"],
    });
    render(
      <ComponentInspector
        selected={selected}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[okEntry("child.sim", [["IN", "In"], ["OUT", "Out"]])]}
      />,
    );

    const collisionSheet = screen.getByRole("combobox", { name: "Sheet interface" });
    fireEvent.pointerDown(collisionSheet, { button: 0, pointerId: 5, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("option", { name: /child\.sim/ }));

    expect((screen.getByRole("textbox", { name: "Sheet block name" }) as HTMLInputElement).value)
      .toBe("Child2");
    fireEvent.click(screen.getByRole("button", { name: "Link this sheet" }));
    expect(useSchematic.getState().components[0].projectSubcircuit?.model).toBe("Child2");
  });

  it("never links a sheet the reader did not choose", () => {
    // VERIFY: the Select used to open pre-filled with the alphabetically first
    // sibling, and "Link this sheet" was the panel's only prominent button - so
    // one click bound the block to a file nobody picked. A sheet is the one
    // irreversible choice on this panel (it decides the netlist), and the spec's
    // "a port is never created by the app choosing a net" applies to it too.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "aaa.sim", path: "/project/aaa.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(
      <ComponentInspector
        selected={selected}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[
          okEntry("aaa.sim", [["A", "In"], ["B", "Out"]]),
          okEntry("child.sim", [["IN", "In"], ["OUT", "Out"], ["GND", "BiDir"]]),
        ]}
      />,
    );

    // Nothing is chosen, so nothing is proposed and nothing can be committed.
    expect(screen.getByRole("combobox", { name: "Sheet interface" }).textContent)
      .toBe("Choose a Tau sheet");
    expect(screen.queryByRole("list", { name: "Proposed pin order" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Link this sheet" })).toBeNull();
    expect(useSchematic.getState().components[0].projectSubcircuit).toBeUndefined();
  });

  it("keeps a many-port sheet's annotation readable instead of pasting 20 names into a 168px control", async () => {
    // VERIFY: the option/trigger label listed EVERY port name, so a 20-port
    // block produced a 410-character string inside a max-w-[168px] trigger -
    // which in a 900x600 window is an ellipsis with no information in it.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    const many = Array.from({ length: 20 }, (_, index) => [
      `VERYLONGPORTNAME${index}`,
      (index % 3 === 0 ? "In" : index % 3 === 1 ? "Out" : "BiDir") as SchematicPortDirection,
    ] as [string, SchematicPortDirection]);
    render(
      <ComponentInspector
        selected={selected}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[okEntry("child.sim", many)]}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("combobox", { name: "Sheet interface" }), { button: 0, pointerId: 5, pointerType: "mouse" });
    const option = await screen.findByRole("option", { name: /child\.sim/ });
    const label = option.textContent ?? "";
    fireEvent.click(option);
    // The count is the fact that survives truncation, so it leads; the names
    // are a sample, not the list, and the list is the pin table below.
    expect(label).toContain("20 ports");
    expect(label.length).toBeLessThan(64);
    expect(label).toMatch(/…$/);
    // The full pinout is still available in full, one row per port.
    expect(within(screen.getByRole("list", { name: "Proposed pin order" })).getAllByRole("listitem"))
      .toHaveLength(20);
  });

  it("does not accuse an untouched pre-Item-14 document of changing its interface", () => {
    // VERIFY: a link stored before this change has the historical half-split
    // bank, so its pin SIDES disagree with the child's directions even though
    // the child never changed a thing. The panel reported that as
    // "child.sim changed its interface. 2 direction changes." - a sentence
    // about a file edit that did not happen, on every existing document, which
    // is how a drift indicator gets learned as noise and ignored.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "Child", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id], wires: [], netLabels: [], probes: [] });
    // No directions: exactly what the importer and every pre-Item-14 save did.
    useSchematic.getState().setProjectSubcircuitLink("x-project", {
      sheetPath: "child.sim", model: "Child", ports: ["IN", "OUT", "GND"],
    });
    const linked = useSchematic.getState().components[0];
    // The bank really is the legacy half-split, derived rather than asserted.
    expect(linked.pinOverride).toEqual(buildSubcircuitPinOverride(
      { x: 0, y: 0, rotation: 0, mirrored: false },
      ["IN", "OUT", "GND"],
    ));
    render(
      <ComponentInspector
        selected={linked}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[okEntry("child.sim", [["IN", "In"], ["OUT", "Out"], ["GND", "BiDir"]])]}
      />,
    );

    const group = screen.getByRole("group", { name: "Sheet block" });
    expect(group.textContent).not.toContain("changed its interface");
    // What IS true is said instead: the picture, not the contract, is old.
    expect(within(group).getByText(/older side layout/)).toBeTruthy();
    expect(within(group).getByText(/Nothing electrical changes/)).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: "Review interface change…" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).not.toContain("changed its interface");
    expect(within(dialog).getByRole("button", { name: "Re-lay out this block" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Adopt sheet interface" })).toBeNull();
    // And a genuine rename on the same legacy bank is still reported as one.
    cleanup();
    render(
      <ComponentInspector
        selected={linked}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[okEntry("child.sim", [["IN", "In"], ["VOUT", "Out"], ["GND", "BiDir"]])]}
      />,
    );
    expect(screen.getByRole("group", { name: "Sheet block" }).textContent)
      .toContain("changed its interface");
  });

  it("confirms a good link in the live app, where the panel is re-rendered from the store", () => {
    // VERIFY: every other test in this file holds ONE frozen `selected` object,
    // so it never sees what App shows - a fresh component prop after the write.
    // That re-render ran the reset effect and wiped the only success message the
    // panel had, so a student's zero-typing link landed with no confirmation at
    // all. The confirmation must be derived from the link's own verdict.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id], wires: [], netLabels: [], probes: [] });
    const interfaces = [okEntry("child.sim", [["IN", "In"], ["OUT", "Out"], ["GND", "BiDir"]])];
    const Host = () => {
      const live = useSchematic((state) => state.components[0]);
      return (
        <ComponentInspector
          selected={live}
          projectFilePath="/project/root.sim"
          sheetInterfaces={interfaces}
        />
      );
    };
    render(<Host />);

    const sheet = screen.getByRole("combobox", { name: "Sheet interface" });
    fireEvent.pointerDown(sheet, { button: 0, pointerId: 5, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("option", { name: /child\.sim · 3 ports/ }));
    fireEvent.click(screen.getByRole("button", { name: "Link this sheet" }));

    const group = screen.getByRole("group", { name: "Sheet block" });
    expect(within(group).getAllByRole("status").map((row) => row.textContent).join(" | "))
      .toMatch(/3 ports match child\.sim in order/);
    // And it is a verdict, not a toast: it is still there on the next render.
    act(() => {
      useSchematic.setState((state) => ({ components: state.components.map((part) => ({ ...part })) }));
    });
    expect(screen.getByRole("group", { name: "Sheet block" }).textContent)
      .toMatch(/3 ports match child\.sim in order/);
  });

  it("compiles the deck the UI-authored link promises, with the directed bank the panel drew", async () => {
    // VERIFY / spec D1 at the parent's own seam: the inspector now writes a
    // DIRECTED pin bank (In left, Out right, BiDir to the shorter column), which
    // is a different picture from every pre-Item-14 document. The compiler's
    // exact-bank check reads ids and labels only, so the emitted cards must be
    // unaffected - and that claim is worth nothing unless a deck is actually
    // built from what the panel wrote and read back.
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({
      components: [
        { id: "v1", kind: "vsource", x: -160, y: 0, rotation: 0, value: "10", label: "V1" },
        selected,
      ],
      selectedId: selected.id,
      selectedIds: [selected.id],
      wires: [],
      netLabels: [],
      probes: [],
      directives: [],
    });
    render(
      <ComponentInspector
        selected={selected}
        projectFilePath="/project/root.sim"
        sheetInterfaces={[okEntry("child.sim", [["VIN", "In"], ["VOUT", "Out"], ["GND", "BiDir"]])]}
      />,
    );
    const sheet = screen.getByRole("combobox", { name: "Sheet interface" });
    fireEvent.pointerDown(sheet, { button: 0, pointerId: 5, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("option", { name: /child\.sim/ }));
    fireEvent.click(screen.getByRole("button", { name: "Link this sheet" }));

    const instance = useSchematic.getState().components
      .find((part) => part.id === "x-project")!;
    const bank = instance.pinOverride!;
    // The bank really is the directed one, not the historical half-split.
    expect(bank).toEqual(buildSubcircuitPinOverride(
      { x: 0, y: 0, rotation: 0, mirrored: false },
      ["VIN", "VOUT", "GND"],
      ["In", "Out", "BiDir"],
    ));
    expect(bank).not.toEqual(buildSubcircuitPinOverride(
      { x: 0, y: 0, rotation: 0, mirrored: false },
      ["VIN", "VOUT", "GND"],
    ));

    // Every terminal is named on the parent's drawing, at the coordinate the
    // panel put it - read out of the bank, not retyped.
    const netLabelAt = (pin: { id: string; label: string; x: number; y: number }) => ({
      id: `n-${pin.id}`, x: pin.x, y: pin.y, text: pin.label,
    });
    const { buildProjectHierarchyDeck } = await import("../schematic/projectHierarchy");
    const { deck, blocks } = buildProjectHierarchyDeck({
      rootPath: "root.sim",
      root: {
        components: useSchematic.getState().components,
        wires: [],
        netLabels: [
          ...bank.map(netLabelAt),
          { id: "n-vsrc-hi", x: -160, y: -32, text: "VIN" },
          { id: "n-vsrc-lo", x: -160, y: 32, text: "GND" },
        ],
        directives: [],
      },
      sheets: [{
        path: "child.sim",
        document: {
          components: [
            { id: "r1", kind: "resistor", x: 32, y: 0, rotation: 0, value: "1k", label: "R1" },
            { id: "c1", kind: "capacitor", x: 96, y: 0, rotation: 0, value: "100n", label: "C1" },
          ],
          wires: [],
          netLabels: [
            { id: "in", x: 0, y: 0, text: "VIN", port: "In" as const },
            { id: "out", x: 64, y: 0, text: "VOUT", port: "Out" as const },
            { id: "gnd", x: 128, y: 0, text: "GND", port: "BiDir" as const },
          ],
          projectPorts: [
            { name: "VIN", labelId: "in", direction: "In" as const },
            { name: "VOUT", labelId: "out", direction: "Out" as const },
            { name: "GND", labelId: "gnd", direction: "BiDir" as const },
          ],
          directives: [],
        },
      }],
      analysis: { kind: "op" },
    });

    // The contract's ORDER, not the drawing's sides, is what the header and the
    // X card carry - which is the whole point of storing the snapshot.
    expect(blocks[0].text.split("\n")[0]).toBe(".subckt Child VIN VOUT GND");
    const blockLines = blocks[0].text.split("\n");
    expect(blockLines[blockLines.length - 1]).toBe(".ends Child");
    const xCard = deck.netlist.split("\n").find((line) => /^X1\s/.test(line))!;
    const xFields = xCard.split(/\s+/);
    expect(xFields[xFields.length - 1]).toBe("Child");
    // Three nodes, in the contract's order, taken from the parent's own nets.
    expect(xCard.split(/\s+/).slice(1, 4)).toEqual(["vin", "vout", "0"]);
    expect(deck.unresolvedSubckts).toEqual([]);
  });

  it("reports linked-sheet presence truthfully and suppresses contradictory attachment recovery", () => {
    const selected = {
      id: "x-project", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "ChildModel", label: "X1",
      projectSubcircuit: { sheetPath: "child.sim", model: "ChildModel", ports: ["IN", "OUT"] },
    };
    const openLibraries = vi.fn();
    useProject.setState({
      rootPath: "/project",
      tree: [
        { name: "root.sim", path: "/project/root.sim", kind: "file" },
        { name: "child.sim", path: "/project/child.sim", kind: "file" },
      ],
    });
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} projectFilePath="/project/root.sim" onAttachModelFile={openLibraries} />);

    const linkGroup = screen.getByRole("group", { name: "Sheet block" });
    // Two honest status rows now: presence, and "not checked yet" for an index
    // App has not supplied here. Neither may be dropped for the other's sake.
    expect(within(linkGroup).getAllByRole("status").map((row) => row.textContent).join(" | "))
      .toMatch(/child\.sim is present/i);
    expect(screen.getByText("Linked sheet block")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach .lib/.sub file" })).toBeNull();
    expect(screen.queryByText(/Needs definition/)).toBeNull();

    cleanup();
    useProject.setState({
      rootPath: "/project",
      tree: [{ name: "root.sim", path: "/project/root.sim", kind: "file" }],
    });
    render(<ComponentInspector selected={selected} projectFilePath="/project/root.sim" onAttachModelFile={openLibraries} />);
    expect(screen.getByRole("group", { name: "Sheet block" }).textContent).toMatch(/child\.sim is not present/i);
    expect(screen.queryByRole("button", { name: "Attach .lib/.sub file" })).toBeNull();
    expect(screen.queryByText(/Needs definition/)).toBeNull();
  });
});

describe("ComponentInspector - charge-defined capacitor", () => {
  it("exposes named charge and initial-voltage controls instead of one raw Q= field", () => {
    const selected = {
      id: "c-q",
      kind: "capacitor" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "Q=100p*x*sin(2*pi*2K*time) IC=0.25",
      label: "C1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    const charge = screen.getByRole("textbox", { name: "Charge expression" }) as HTMLInputElement;
    const initialVoltage = screen.getByRole("textbox", { name: "Initial voltage" }) as HTMLInputElement;
    expect(charge.value).toBe("100p*x*sin(2*pi*2K*time)");
    expect(initialVoltage.value).toBe("0.25");
    expect(screen.queryByRole("textbox", { name: "Capacitance" })).toBeNull();

    fireEvent.change(charge, { target: { value: "200p*x" } });
    expect(useSchematic.getState().components[0].value).toBe("Q=200p*x IC=0.25");
  });
});

describe("ComponentInspector - transmission line", () => {
  it("exposes delay and impedance as named controls and keeps the other on edit", () => {
    const selected = {
      id: "t-line",
      kind: "tline" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "Td=50n Z0=75",
      label: "T1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    // The nano prefix rides in the unit picker beside the mantissa.
    const delay = screen.getByRole("textbox", { name: "Delay" }) as HTMLInputElement;
    expect(delay.value).toBe("50");
    expect((screen.getByRole("textbox", { name: "Impedance" }) as HTMLInputElement).value).toBe("75");
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
    // The line's two knobs are self-describing, so item 14 removed their prose;
    // what has to survive is the labelled control, not the sentence beside it.
    expect(screen.queryByText(/ideal lossless line/)).toBeNull();

    fireEvent.change(delay, { target: { value: "10" } });
    expect(useSchematic.getState().components[0].value).toBe("Td=10n Z0=75");
  });
});

/**
 * Item 4's settings half. All four controlled sources used to render one
 * unlabelled "Value" box, so the panel could not say which of V/V, A/V, A/A and
 * V/A the number was, nor that the control pair of an F or H source is a sense
 * branch Tau supplies rather than a probe you point at an existing source.
 */
describe("ComponentInspector - controlled sources", () => {
  const source = (kind: "vcvs" | "vccs" | "cccs" | "ccvs", value: string, label: string) => ({
    id: `${kind}-1`, kind, x: 160, y: 160, rotation: 0 as const, value, label,
  });

  const show = (component: ReturnType<typeof source>) => {
    useSchematic.setState({
      components: [component],
      selectedId: component.id,
      selectedIds: [component.id],
    });
    render(<ComponentInspector selected={component} />);
  };

  it("names each gain with the unit its own netlist line is emitted in", () => {
    for (const [component, label, unit, mantissa] of [
      [source("vcvs", "10", "E1"), "Voltage gain", "V/V", "10"],
      [source("vccs", "1m", "G1"), "Transconductance", "mA/V", "1"],
      [source("cccs", "10", "F1"), "Current gain", "A/A", "10"],
      [source("ccvs", "1k", "H1"), "Transresistance", "kV/A", "1"],
    ] as const) {
      cleanup();
      show(component);
      expect((screen.getByRole("textbox", { name: label }) as HTMLInputElement).value).toBe(mantissa);
      expect(screen.getByRole("combobox", { name: `${label} SI prefix` }).textContent).toContain(unit);
      expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
    }
  });

  it("explains what a CCVS computes and edits it as a transresistance", () => {
    show(source("ccvs", "1k", "H1"));

    expect(screen.getByText(/Wire C\+\/C- in series with the sensed branch/)).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Transresistance" }), { target: { value: "2" } });
    expect(useSchematic.getState().components[0].value).toBe("2k");
  });

  // The gotcha: F and H synthesize `V_<base>_sense` between C+ and C-
  // (`spiceNetlist.ts`), so a user who wires them across an existing V1 gets a
  // short, not a measurement.
  it("warns on both current-controlled sources that the sense pair is Tau's own source", () => {
    for (const component of [source("cccs", "10", "F1"), source("ccvs", "1k", "H1")]) {
      cleanup();
      show(component);
      expect(screen.getByText(/Tau supplies the sense pair/)).toBeTruthy();
      expect(screen.getByText(/in series with the sensed branch/)).toBeTruthy();
    }
  });

  it("swaps the gain box for a transfer-function box when the value is a Laplace transfer", () => {
    show(source("vcvs", "Laplace=10/(1+0.001*s)", "E1"));

    const transfer = screen.getByRole("textbox", { name: "Transfer H(s)" }) as HTMLInputElement;
    expect(transfer.value).toBe("10/(1+0.001*s)");
    expect(screen.queryByRole("textbox", { name: "Voltage gain" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();

    fireEvent.change(transfer, { target: { value: "10/(1+0.01*s)" } });
    expect(useSchematic.getState().components[0].value).toBe("Laplace=10/(1+0.01*s)");
  });
});

/**
 * Item 8's disclosure. `engine/idealModels.ts` made a placed junction behave as
 * the textbook part and left an imported one on its real model; before this the
 * panel said "Generic starter" for both, which described neither.
 */
describe("ComponentInspector - ideal by default, real behind Advanced", () => {
  const junction = (
    kind: "diode" | "led" | "zener" | "photodiode",
    value: string,
    extra: Record<string, unknown> = {},
  ) => ({ id: `${kind}-1`, kind, x: 160, y: 160, rotation: 0 as const, value, label: "D1", ...extra });

  const show = (
    component: ReturnType<typeof junction>,
    directives: string[] = [],
    manualModelControls = false,
  ) => {
    useSchematic.setState({
      components: [component],
      selectedId: component.id,
      selectedIds: [component.id],
      directives,
    });
    render(<ComponentInspector selected={component} manualModelControls={manualModelControls} />);
  };

  it("says a placed diode is ideal, in the volts it will actually drop", () => {
    show(junction("diode", "D"));
    expect(screen.getByRole("status").textContent)
      .toContain("Generic diode · 0.7 V forward.");
  });

  it("states the LED's own drop and the zener's marked breakdown", () => {
    show(junction("led", "LED"));
    expect(screen.getByRole("status").textContent).toContain("Generic LED · Vf 2 V typical/default");
    expect(screen.getByRole("combobox", { name: "Color" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Forward voltage" }) as HTMLInputElement).value).toBe("2");
    expect(screen.getByText("Each color starts with a typical forward voltage.")).toBeTruthy();
    expect(screen.getByText("Uses the selected color’s default until you enter an override for this LED.")).toBeTruthy();

    cleanup();
    show(junction("zener", "5V1"));
    expect(screen.getByRole("status").textContent)
      .toContain("Generic Zener · 0.7 V forward · 5.1 V reverse.");
    expect(screen.getByRole("textbox", { name: "Breakdown voltage" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Forward voltage" })).toBeTruthy();

    // A marking that names no library part is still a part the deck runs, so
    // it must not be reported as a missing model.
    cleanup();
    show(junction("zener", "12V"));
    expect(screen.getByRole("status").textContent).toContain("Generic Zener · 0.7 V forward · 12 V reverse.");
    expect(screen.getByRole("status").textContent).not.toContain("Needs an exact model");
  });

  it("keeps the model chooser behind Advanced while the part is ideal", async () => {
    show(junction("diode", "D"), [], true);
    expect(screen.queryByRole("combobox", { name: "Simulation model" })).toBeNull();

    const disclosure = screen.getByRole("button", { name: "Toggle Advanced device model parameters" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Named or attached models replace this ideal/)).toBeTruthy();
    const modelParameters = screen.getByRole("group", { name: "Advanced device model parameters" });
    expect(modelParameters.contains(screen.getByRole("textbox", { name: "Saturation current" }))).toBe(true);
    expect(screen.getByText("Sets reverse leakage and shifts the forward current curve.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach .lib/.sub file" })).toBeNull();

    const chooser = screen.getByRole("combobox", { name: "Simulation model" });
    fireEvent.pointerDown(chooser, { button: 0, pointerId: 1, pointerType: "mouse" });
    const part = await screen.findByRole("option", { name: /1N4148 · Tau exact models/ });
    fireEvent.pointerUp(part, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(part);
    expect(useSchematic.getState().components[0].value).toBe("1N4148");
  });

  it("keeps generic saturation/model parameters collapsed in the production host", () => {
    const selected = junction("diode", "D");
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onAttachModelFile={openLibraries} />);

    const disclosure = screen.getByRole("button", { name: "Toggle Advanced device model parameters" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox", { name: "Saturation current" })).toBeNull();
    fireEvent.click(disclosure);
    expect(screen.getByRole("textbox", { name: "Saturation current" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach .lib/.sub file" })).toBeNull();
  });

  it("treats a generic voltage-marked zener as Tau-owned and hides attachment recovery", () => {
    const selected = junction("zener", "12V");
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onAttachModelFile={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Generic Zener · 0.7 V forward · 12 V reverse.");
    expect(screen.queryByRole("button", { name: "Attach .lib/.sub file" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Breakdown voltage" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Forward voltage" })).toBeTruthy();
  });

  it("keeps a named photodiode exact-or-refused instead of exposing generic photocurrent", () => {
    const selected = junction("photodiode", "BPW34");
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onAttachModelFile={openLibraries} />);

    expect(screen.getByRole("status").textContent).toMatch(/Needs exact PHOTODIODE "BPW34"/i);
    expect(screen.queryByRole("textbox", { name: "Photocurrent" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
    expect(screen.getByRole("button", { name: "Attach .lib/.sub file" })).toBeTruthy();

    cleanup();
    const exact = junction("photodiode", "BPW34");
    useSchematic.setState({
      components: [exact],
      selectedId: exact.id,
      selectedIds: [exact.id],
      userModelLibraries: [{ name: "photodiodes.lib", text: ".model BPW34 D(Is=10p N=1.2)" }],
    });
    render(<ComponentInspector selected={exact} onAttachModelFile={openLibraries} />);
    expect(screen.getByRole("status").textContent).toMatch(/Ready · exact D model from photodiodes\.lib/i);
    expect(screen.queryByText(/Generic photocurrent/i)).toBeNull();
  });

  it("never calls an imported diode ideal, and leaves its real model in plain sight", () => {
    // The exact provenance test `engine/idealModels.ts` uses: one LTspice-only
    // field present means this part was read from an `.asc`.
    show(junction("diode", "D", { ltSymbolType: "diode" }));

    const status = screen.getByRole("status").textContent ?? "";
    expect(status).not.toContain("Ideal model");
    expect(status).toContain("Imported exact model · identity and provenance are read-only");
    expect(screen.queryByRole("combobox", { name: "Simulation model" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Toggle Advanced device model parameters" })).toBeNull();
  });

  it("shows imported exact provenance without exposing generic Zener knobs", () => {
    show(junction("zener", "5V1", {
      ltSymbolType: "Zener",
      ltModelName: "BZX84C5V1",
      ltModelFile: "vendor.lib",
    }));

    expect(screen.getByRole("status").textContent)
      .toContain("Imported exact model · identity and provenance are read-only (BZX84C5V1 from vendor.lib).");
    expect(screen.queryByRole("textbox", { name: "Breakdown voltage" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Forward voltage" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Simulation model" })).toBeNull();
  });

  it("defers to a model this schematic defines rather than claiming ideal", () => {
    show(junction("diode", "D"), [".model D D(Is=1e-15 N=1.2)"]);

    const status = screen.getByRole("status").textContent ?? "";
    expect(status).not.toContain("Ideal model");
    expect(status).toContain("Document model · the authored .model card is used exactly");
    expect(screen.queryByRole("combobox", { name: "Simulation model" })).toBeNull();
  });
});

describe("ComponentInspector - independent source waveform controls", () => {
  it("renders PWL as a mode and point rows, never as a DC-level string", () => {
    const selected = {
      id: "v-pwl",
      kind: "vsource" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "PWL(0 0 2u 0 +1u 1) AC 2",
      label: "V6",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    const waveform = screen.getByRole("combobox", { name: "Waveform type" });
    expect(waveform.tagName).toBe("BUTTON");
    expect(waveform.getAttribute("data-slot")).toBe("select-trigger");
    expect(waveform.textContent).toContain("Piecewise linear");
    expect(document.querySelector(".source-value-editor select[aria-label='Waveform type']")).toBeNull();
    // Was: `DC operating point` reads "0". That row was the inferred bias
    // duplicating the waveform's own first level, and it is gone for function
    // waveforms (PDF-3 item 1). This source carries no explicit `DC <n>`, so
    // there must be no bias row at all under any of its three labels.
    expect(screen.queryByRole("textbox", { name: "DC operating point" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "DC bias" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "DC level" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "PWL time 3" }) as HTMLInputElement).value).toBe("+1");
    const pwlPrefix = screen.getByRole("combobox", { name: "PWL time 3 SI prefix" });
    expect(pwlPrefix.tagName).toBe("BUTTON");
    expect(pwlPrefix.getAttribute("data-slot")).toBe("select-trigger");
    expect(pwlPrefix.textContent).toContain("µs");
    expect((screen.getByRole("textbox", { name: "PWL level 3" }) as HTMLInputElement).value).toBe("1");
    const acDisclosure = screen.getByRole("button", { name: "Toggle AC analysis stimulus" });
    expect(acDisclosure.getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByRole("textbox", { name: "AC amplitude" }) as HTMLInputElement).value).toBe("2");
    expect(screen.queryByRole("textbox", { name: "DC level" })).toBeNull();
    expect(screen.queryByDisplayValue(/PWL\(/)).toBeNull();
  });

  it("updates PWL rows through controls", () => {
    const selected = {
      id: "v-pwl-edit",
      kind: "vsource" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "PWL(0 0 2u 0)",
      label: "V1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    fireEvent.change(screen.getByRole("textbox", { name: "PWL level 2" }), { target: { value: "5" } });
    expect(useSchematic.getState().components[0].value).toBe("PWL(0 0 2u 5)");
  });

  /*
   * This pair replaces a case that used to add `DC 2` to a bare PWL source
   * through an always-present "DC operating point" row.
   *
   * That row is gone for function waveforms (PDF-3 item 1). It was rendering an
   * INFERRED bias, not an authored one - `decodeIndependentSourceValue` seeds
   * `dcBias` from the waveform's own offset - so a sine printed
   * `DC operating point 5 V` directly above `Offset 5 V`: the same number twice
   * under two names, which is exactly the frame the report photographed.
   *
   * What must NOT be lost with it is an EXPLICIT `DC <n>`, which LTspice allows
   * beside a function (`DC 2 SINE(...)`) and which imports arrive holding. That
   * is a genuinely second quantity - the operating-point bias, independent of
   * the waveform's own offset - so it keeps an editable row and must survive a
   * round trip through the inspector untouched. The first test below is the
   * no-duplication claim; the second is the no-data-loss claim.
   */
  it("shows no inferred DC row beside a waveform's own offset control", () => {
    const selected = {
      id: "v-sine-nodup",
      kind: "vsource" as const,
      x: 160, y: 160, rotation: 0 as const,
      value: "SINE(5 1 1k)",
      label: "V1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    expect((screen.getByRole("textbox", { name: "Offset" }) as HTMLInputElement).value).toBe("5");
    expect(screen.queryByRole("textbox", { name: "DC operating point" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "DC bias" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "DC level" })).toBeNull();
  });

  it("keeps an explicitly authored DC bias editable beside the waveform, and does not drop it", () => {
    const selected = {
      id: "v-sine-explicit-dc",
      kind: "vsource" as const,
      x: 160, y: 160, rotation: 0 as const,
      value: "DC 2 SINE(0 1 1k)",
      label: "V1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    const { rerender } = render(<ComponentInspector selected={selected} />);

    // Two distinct quantities, two distinct numbers, two distinct names.
    expect((screen.getByRole("textbox", { name: "DC bias" }) as HTMLInputElement).value).toBe("2");
    expect((screen.getByRole("textbox", { name: "Offset" }) as HTMLInputElement).value).toBe("0");

    fireEvent.change(screen.getByRole("textbox", { name: "DC bias" }), { target: { value: "3" } });
    expect(useSchematic.getState().components[0].value).toBe("DC 3 SINE(0 1 1k)");

    // Editing the waveform must not silently discard the authored bias.
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Amplitude" }), { target: { value: "4" } });
    expect(useSchematic.getState().components[0].value).toBe("DC 3 SINE(0 4 1k)");
  });

  it("switches waveform modes without requiring raw SINE syntax", async () => {
    const selected = {
      id: "i-dc",
      kind: "isource" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "5m",
      label: "I1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    const { rerender } = render(<ComponentInspector selected={selected} />);

    const waveform = screen.getByRole("combobox", { name: "Waveform type" });
    expect(waveform.tagName).toBe("BUTTON");
    expect(waveform.getAttribute("data-slot")).toBe("select-trigger");
    expect(waveform.textContent).toContain("DC");
    // Radix Select opens on pointerdown; include button/pointerId so jsdom
    // matches the pointer-capture path used in the real UI.
    fireEvent.pointerDown(waveform, { button: 0, pointerId: 1, pointerType: "mouse" });
    const sine = await screen.findByRole("option", { name: "Sine" });
    fireEvent.pointerUp(sine, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(sine);
    expect(useSchematic.getState().components[0].value).toBe("SINE(5m 1 1k)");
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);
    expect(screen.getByRole("combobox", { name: "Waveform type" }).textContent).toContain("Sine");
    expect(screen.getByRole("textbox", { name: "Amplitude" })).toBeTruthy();
    expect(screen.queryByDisplayValue(/SINE\(/)).toBeNull();
    expect(document.querySelector(".source-value-editor select[aria-label='Waveform type']")).toBeNull();
  });
});

/**
 * Item 4b. The behavioral source reached the reader as one box labelled "Value"
 * holding `V=1`: nothing said it was an expression, what could appear in it, or
 * that deleting the `V=` head is what makes the run fail. The panel now judges
 * the value with the same code the deck builds it with.
 */
describe("ComponentInspector - behavioral source", () => {
  const bsource = (value: string) => ({
    id: "b-1",
    kind: "bsource" as const,
    x: 160,
    y: 160,
    rotation: 0 as const,
    value,
    label: "B1",
  });

  const place = (value: string) => {
    const selected = bsource(value);
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    return selected;
  };

  it("splits the value into an output mode and an expression, with no raw Value box", () => {
    render(<ComponentInspector selected={place("V=1")} />);

    const mode = screen.getByRole("combobox", { name: "Behavioral output" });
    expect(mode.tagName).toBe("BUTTON");
    expect(mode.getAttribute("data-slot")).toBe("select-trigger");
    expect(mode.textContent).toContain("Voltage (V=)");
    expect(document.querySelector("select[aria-label='Behavioral output']")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Expression" }) as HTMLInputElement).value).toBe("1");
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
  });

  it("writes an edited expression as exactly the spec the deck builder reads", () => {
    render(<ComponentInspector selected={place("V=1")} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Expression" }), {
      target: { value: "V(a)-V(b)" },
    });
    expect(useSchematic.getState().components[0].value).toBe("V=V(a)-V(b)");
    expect(behavioralSpecText(useSchematic.getState().components[0].value)).toBe("V=V(a)-V(b)");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("switches to a current output without the reader retyping the I= head", async () => {
    const selected = place("V=V(a)*2");
    const { rerender } = render(<ComponentInspector selected={selected} />);

    const mode = screen.getByRole("combobox", { name: "Behavioral output" });
    fireEvent.pointerDown(mode, { button: 0, pointerId: 1, pointerType: "mouse" });
    const current = await screen.findByRole("option", { name: "Current (I=)" });
    fireEvent.pointerUp(current, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(current);

    expect(useSchematic.getState().components[0].value).toBe("I=V(a)*2");
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);
    expect(screen.getByRole("combobox", { name: "Behavioral output" }).textContent).toContain("Current (I=)");
    expect((screen.getByRole("textbox", { name: "Expression" }) as HTMLInputElement).value).toBe("V(a)*2");
    expect(screen.getByText(/from the \+ pin through the source to the - pin/)).toBeTruthy();
  });

  it("refuses a malformed expression in the panel, with the reason, before any run", () => {
    const selected = place("V=1");
    const { rerender } = render(<ComponentInspector selected={selected} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Expression" }), {
      target: { value: "V(a)+" },
    });
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);
    expect(screen.getByRole("alert").textContent).toContain("Unexpected end of expression");
    expect(screen.getByRole("textbox", { name: "Expression" }).getAttribute("aria-invalid")).toBe("true");
    // The reason is the engine's, so the panel cannot disagree with the run.
    expect(() => behavioralSpecText("V=V(a) V(b)")).not.toThrow();
    expect(checkBehavioral("V=V(a)+").reason).toBe(screen.getByRole("alert").textContent);
  });

  it("names the missing expression rather than letting the run raise it", () => {
    const selected = place("V=1");
    const { rerender } = render(<ComponentInspector selected={selected} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Expression" }), { target: { value: "" } });
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);
    expect(screen.getByRole("alert").textContent).toBe("Behavioral source needs a V=/I= expression.");
    expect(() => behavioralSpecText(useSchematic.getState().components[0].value)).toThrow();
  });

  it("hands the reader the vocabulary and a worked expression to start from", () => {
    const selected = place("V=1");
    const { rerender } = render(<ComponentInspector selected={selected} />);

    expect(screen.queryByText("current through the part labelled R1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle expression reference" }));
    expect(screen.getByText("current through the part labelled R1")).toBeTruthy();
    expect(screen.getByText("seconds since the run started")).toBeTruthy();
    expect(screen.getByLabelText("Available functions").textContent).toContain("limit(x, lo, hi)");

    fireEvent.click(screen.getByRole("button", { name: /if\(V\(in\)>2\.5, 5, 0\)/ }));
    expect(useSchematic.getState().components[0].value).toBe("V=if(V(in)>2.5, 5, 0)");
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * Item 4b. The VCO's value is `mark=1K space=1K`, and nothing in the panel said
 * it was an oscillator, that those are frequencies, or what its FM, AM and COM
 * pins do - and two of those pins have no field to hang a description on.
 */
describe("ComponentInspector - modulator (VCO)", () => {
  it("names both frequencies and says what each pin drives", () => {
    const selected = {
      id: "a-vco",
      kind: "modulator" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "mark=1K space=1K",
      label: "A1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    const mark = screen.getByRole("textbox", { name: "Mark frequency" }) as HTMLInputElement;
    expect(mark.value).toBe("1");
    expect(screen.getByRole("combobox", { name: "Mark frequency SI prefix" }).textContent).toContain("kHz");
    expect((screen.getByRole("textbox", { name: "Space frequency" }) as HTMLInputElement).value).toBe("1");
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();

    // The group header names the part now, so the summary starts where the
    // header stops - at what the pins do.
    expect(screen.getByRole("button", { name: /Voltage-controlled oscillator/ })).toBeTruthy();
    expect(screen.getByText(/Q outputs a ±1 V sine/)).toBeTruthy();
    expect(screen.getByText(/AM scales amplitude/)).toBeTruthy();
    // The per-row sentences are gone; the two labelled frequency rows say it.
    expect(screen.queryByText(/Output frequency while the FM pin/)).toBeNull();

    fireEvent.change(mark, { target: { value: "2" } });
    expect(useSchematic.getState().components[0].value).toBe("mark=2k space=1K");
  });
});

describe("ComponentsRail - responsive shell budget", () => {
  function Harness({ maxWidth, embedded = false }: { maxWidth: number; embedded?: boolean }) {
    const resize = usePanelWidth({
      storageKey: "tau.test.componentsRailWidth",
      defaultWidth: 264,
      minWidth: 208,
      maxWidth,
      edge: "left",
    });
    return <ComponentsRail focusSignal={0} onNotice={() => {}} resize={resize} maxWidth={maxWidth} embedded={embedded} />;
  }

  it("renders the responsive maximum immediately when the shell tightens", () => {
    const { rerender } = render(<Harness maxWidth={240} />);

    const panel = screen.getByRole("complementary", { name: "Components" });
    expect(panel.style.width).toBe("240px");
    expect(screen.getByRole("separator", { name: "Resize properties panel" }).getAttribute("aria-valuemax")).toBe("240");

    rerender(<Harness maxWidth={208} />);
    expect(panel.style.width).toBe("208px");
    expect(screen.getByRole("separator", { name: "Resize properties panel" }).getAttribute("aria-valuemax")).toBe("208");
  });

  it("keeps the dense palette disclosures fully named and programmatically tied to their lists", () => {
    render(<Harness maxWidth={280} />);

    const sources = screen.getByRole("button", { name: "Sources" });
    const listId = sources.getAttribute("aria-controls");
    expect(listId).toBe("palette-section-sources");
    expect(document.getElementById(listId!)).toBeTruthy();
    expect(sources.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(sources);
    expect(sources.getAttribute("aria-expanded")).toBe("false");
    // The controlled list is intentionally unmounted while collapsed, so do
    // not leave a dangling aria-controls idref behind.
    expect(sources.getAttribute("aria-controls")).toBeNull();
    expect(document.getElementById(listId!)).toBeNull();
  });

  it("delegates its width boundary to the shared dock when embedded", () => {
    render(<Harness maxWidth={340} embedded />);
    expect(screen.getByRole("complementary", { name: "Components" }).classList.contains("components-rail--embedded")).toBe(true);
    expect(screen.queryByRole("separator", { name: "Resize properties panel" })).toBeNull();
  });

  it("is the parts library, and does not become a properties panel when a part is selected", () => {
    // The "Properties | Library" segmented control this used to assert is
    // gone. It was two unrelated things sharing one column - the parts you
    // might add, and the settings of the part you already have - and the
    // selection's properties now appear at the selection (inspector/), so
    // there is nothing left to segment. The rail always shows the library.
    render(<Harness maxWidth={340} embedded />);
    expect(screen.getByPlaceholderText("Filter")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Library" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Properties" })).toBeNull();

    act(() => useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      selectedId: "r-1",
      selectedIds: ["r-1"],
    }));
    // Selecting a part must not swap the library out from under someone who
    // is placing parts, which is exactly what the segmented control did.
    expect(screen.getByPlaceholderText("Filter")).toBeTruthy();
    // And the properties are not here, so they cannot be here AND at the
    // selection: two live surfaces under one name is the failure the shell
    // contract test exists to catch.
    expect(screen.queryByText("No Selection")).toBeNull();
  });

  it("keeps the components overlay to one named landmark", () => {
    render(<Harness maxWidth={340} embedded />);

    const landmarks = screen.getAllByRole("complementary");
    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].getAttribute("aria-label")).toBe("Components");
  });
});

describe("BottomPanel - errors tab states", () => {
  const failed = {
    ok: false,
    title: "Transient",
    message: "singular matrix at t=0",
    warnings: ["floating node n3"],
  } as AnalysisResult;

  it("shows a compact neutral diagnostic before a simulation has run", () => {
    const { container } = render(<BottomPanel result={null} />);
    expect(screen.getByRole("region", { name: "Simulation diagnostics" })).toBeTruthy();
    const clear = screen.getByRole("status");
    expect(clear.textContent).toContain("No analysis yet");
    expect(container.querySelector(".bottom-panel-state svg")).toBeTruthy();
    expect(screen.getByText("Diagnostics")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.has-error")).toBeNull();
    expect(container.querySelector(".bottom-panel.is-idle")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.is-clean")).toBeNull();
    expect(container.querySelector(".bottom-panel.is-collapsed")).toBeTruthy();
    expect(container.querySelector(".bottom-panel-count")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Errors/ })).toBeNull();
    expect(container.querySelector(".bottom-errors")).toBeNull();
  });

  it("uses the mint all-clear state only after a successful run", () => {
    const result: AnalysisResult = {
      ok: true,
      title: "Transient",
      times: [0],
      traces: [],
      currents: [],
      stats: { netCount: 0, componentCount: 0, sampleCount: 1, stopTime: 0, stepSize: 0 },
      warnings: [],
      circuit: {} as never,
    };
    const { container } = render(<BottomPanel result={result} />);
    expect(screen.getByRole("status").textContent).toContain("No issues");
    expect(container.querySelector(".bottom-panel.is-clean")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.is-idle")).toBeNull();
  });

  it("uses the amber running state instead of stale idle, success, or error diagnostics", () => {
    const clean = {
      ok: true,
      title: "Transient",
      times: [0],
      traces: [],
      currents: [],
      stats: { netCount: 0, componentCount: 0, sampleCount: 1, stopTime: 0, stepSize: 0 },
      warnings: [],
      circuit: {} as never,
    } as AnalysisResult;
    const { container, rerender } = render(<BottomPanel result={clean} isRunning />);

    const assertRunningOnly = () => {
      expect(screen.getByRole("status").textContent).toBe("Running");
      expect(container.querySelector(".bottom-panel.is-running")).toBeTruthy();
      expect(container.querySelector(".bottom-panel.is-idle")).toBeNull();
      expect(container.querySelector(".bottom-panel.is-clean")).toBeNull();
      expect(container.querySelector(".bottom-panel.has-error")).toBeNull();
      expect(container.querySelector(".bottom-errors")).toBeNull();
    };

    assertRunningOnly();
    rerender(<BottomPanel result={null} isRunning />);
    assertRunningOnly();
    rerender(<BottomPanel result={failed} isRunning />);
    assertRunningOnly();
  });

  it("toggles an issue body from its emphasized header button", () => {
    render(<BottomPanel result={failed} />);
    const toggle = screen.getByRole("button", { name: /^Errors/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("alert").textContent).toContain("singular matrix");
  });

  it("reopens when a newly reported issue replaces a collapsed one", () => {
    const { rerender } = render(<BottomPanel result={failed} />);
    const toggle = screen.getByRole("button", { name: /^Errors/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    rerender(<BottomPanel result={{ ...failed, message: "timestep too small" } as AnalysisResult} />);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // `toContain`, not `toBe`, since PDF-6 item 6: the row now carries its
    // severity ("Error") and its origin ("Run") as text beside the message,
    // because a problem list may not leave colour as the only signal.
    expect(screen.getByRole("alert").textContent).toContain("timestep too small");
  });

  it("goes loud with an error token and a count when the run fails", () => {
    const { container } = render(<BottomPanel result={failed} />);
    expect(container.querySelector(".bottom-panel.has-error")).toBeTruthy();
    // message + warning = 2, in the alarm-red (not warnings-only) badge
    const count = container.querySelector(".bottom-panel-count")!;
    expect(count.textContent).toBe("2");
    expect(count.classList.contains("warnings-only")).toBe(false);
    const alert = screen.getByRole("alert");
    // Same PDF-6 change as above: the message is now one span in a four-column
    // row (glyph, severity word, message, where), so the row's whole text is no
    // longer just the message.
    expect(alert.querySelector(".bottom-error-message")!.textContent).toBe("singular matrix at t=0");
    expect(alert.querySelector(".bottom-error-severity")!.textContent).toBe("Error");
  });

  it("uses the amber warnings-only badge when the run succeeded with warnings", () => {
    const ok = {
      ok: true,
      title: "Transient",
      times: [0],
      traces: [],
      currents: [],
      stats: { netCount: 1, componentCount: 1, sampleCount: 1, stopTime: 1, stepSize: 1 },
      warnings: ["R2 shorted by wire"],
      circuit: {} as never,
    } as AnalysisResult;
    const { container } = render(<BottomPanel result={ok} />);
    expect(container.querySelector(".bottom-panel.has-warning")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Warnings/ })).toBeTruthy();
    const count = container.querySelector(".bottom-panel-count")!;
    expect(count.textContent).toBe("1");
    expect(count.classList.contains("warnings-only")).toBe(true);
    expect(container.querySelector(".bottom-panel.has-error")).toBeNull();
  });
});

/**
 * The Inputs field accepted 21000. `schematic/params.ts` declared `min: 2,
 * max: 5` on it and nothing enforced them on commit, so the gate stored a
 * number it could not draw and then drew its five-lead maximum instead: the
 * saved value and the picture disagreed about the same part.
 *
 * These drive the panel, not the helper, because the panel must keep invalid
 * drafts visible and refuse to mutate the document until the value is valid.
 */
describe("ComponentInspector - a field with declared bounds enforces them", () => {
  const gate = (value = "and") => ({
    id: "a-1",
    kind: "digitalGate" as const,
    x: 160,
    y: 160,
    rotation: 0 as const,
    value,
    label: "A1",
  });

  const showGate = (value?: string) => {
    const selected = gate(value);
    useSchematic.setState({
      components: [selected],
      selectedId: selected.id,
      selectedIds: [selected.id],
    });
    render(<ComponentInspector selected={selected} />);
    return screen.getByRole("textbox", { name: "Inputs" });
  };

  const storedValue = () => useSchematic.getState().components[0].value;

  it("keeps an over-range draft visible and refuses the document mutation", () => {
    const inputs = showGate();
    fireEvent.change(inputs, { target: { value: "21000" } });
    fireEvent.blur(inputs);
    expect((inputs as HTMLInputElement).value).toBe("21000");
    expect(inputs.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("at or below 5");
    expect(storedValue()).toBe("and");
  });

  it("keeps an under-range draft visible and refuses the document mutation", () => {
    const inputs = showGate("and Inputs=4");
    fireEvent.change(inputs, { target: { value: "0" } });
    fireEvent.blur(inputs);
    expect((inputs as HTMLInputElement).value).toBe("0");
    expect(inputs.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("at or above 2");
    expect(storedValue()).toBe("and Inputs=4");
  });

  it("commits on Enter as well as on blur", () => {
    const inputs = showGate() as HTMLInputElement;
    // A real focus, so Enter's own `blur()` is what ends the edit rather than
    // a synthetic blur event the test supplied.
    inputs.focus();
    fireEvent.change(inputs, { target: { value: "4" } });
    fireEvent.keyDown(inputs, { key: "Enter" });
    expect(document.activeElement).not.toBe(inputs);
    expect(storedValue()).toBe("and Inputs=4");
  });

  it("keeps a half-typed out-of-range number visible with an explanation", () => {
    const inputs = showGate();
    fireEvent.change(inputs, { target: { value: "" } });
    expect((inputs as HTMLInputElement).value).toBe("");
    fireEvent.change(inputs, { target: { value: "1" } });
    expect((inputs as HTMLInputElement).value).toBe("1");
    expect(storedValue()).toBe("and");
    fireEvent.change(inputs, { target: { value: "15" } });
    fireEvent.blur(inputs);
    expect((inputs as HTMLInputElement).value).toBe("15");
    expect(screen.getByRole("alert").textContent).toContain("at or below 5");
    expect(storedValue()).toBe("and");
  });

  it("abandons the edit on Escape", () => {
    const inputs = showGate("and Inputs=3");
    fireEvent.change(inputs, { target: { value: "5" } });
    fireEvent.keyDown(inputs, { key: "Escape" });
    fireEvent.blur(inputs);
    expect(storedValue()).toBe("and Inputs=3");
  });

  it("prints the allowed range next to the field", () => {
    showGate();
    // A bound you only meet by having a value clamped is a surprise; this is
    // the same treatment the transient panel gives its output-point limit.
    expect(screen.getByText("2–5")).toBeTruthy();
  });

  it("prints the range for other bounded kinds too", () => {
    const pot = {
      id: "rv-1",
      kind: "potentiometer" as const,
      x: 0,
      y: 0,
      rotation: 0 as const,
      value: "10k Wiper=0.25",
      label: "RV1",
    };
    useSchematic.setState({ components: [pot], selectedId: pot.id, selectedIds: [pot.id] });
    render(<ComponentInspector selected={pot} />);
    // The wiper is stored as a 0..1 fraction and READ as a percentage, so the
    // bound the panel prints is the bound in the unit beside it.
    expect(screen.getByText("0–100")).toBeTruthy();

    const wiper = screen.getByRole("textbox", { name: "Wiper position" });
    fireEvent.change(wiper, { target: { value: "900" } });
    fireEvent.blur(wiper);
    expect((wiper as HTMLInputElement).value).toBe("900");
    expect(wiper.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("at or below 100");
    expect(useSchematic.getState().components[0].value).toBe("10k Wiper=0.25");
  });

  it("leaves an unbounded field committing as you type", () => {
    const resistor = {
      id: "r-1",
      kind: "resistor" as const,
      x: 0,
      y: 0,
      rotation: 0 as const,
      value: "1k",
      label: "R1",
    };
    useSchematic.setState({ components: [resistor], selectedId: resistor.id, selectedIds: [resistor.id] });
    render(<ComponentInspector selected={resistor} />);
    expect(screen.queryByText("2–5")).toBeNull();
  });

  it("keeps malformed transformer text visible and out of the document", () => {
    const transformer = {
      id: "t-1",
      kind: "transformer" as const,
      x: 0,
      y: 0,
      rotation: 0 as const,
      value: "1:1",
      label: "T1",
    };
    useSchematic.setState({ components: [transformer], selectedId: transformer.id, selectedIds: [transformer.id] });
    render(<ComponentInspector selected={transformer} />);

    const ratio = screen.getByRole("textbox", { name: "Turns ratio" }) as HTMLInputElement;
    fireEvent.change(ratio, { target: { value: "1:0" } });
    fireEvent.blur(ratio);

    expect(ratio.value).toBe("1:0");
    expect(ratio.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("positive turns ratio");
    expect(useSchematic.getState().components[0].value).toBe("1:1");
  });

  it("keeps an invalid native-switch State draft visible without rewriting it as a model", () => {
    const selected = {
      id: "s-1",
      kind: "switch" as const,
      x: 0,
      y: 0,
      rotation: 0 as const,
      value: "open",
      label: "S1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    const state = screen.getByRole("textbox", { name: "State" }) as HTMLInputElement;
    fireEvent.change(state, { target: { value: "ejeeje" } });
    fireEvent.blur(state);

    expect(state.value).toBe("ejeeje");
    expect(state.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Open or Closed");
    expect(useSchematic.getState().components[0].value).toBe("open");
  });

  it("does not classify an invalid persisted switch string as a static State field", () => {
    const selected = {
      id: "s-invalid",
      kind: "switch" as const,
      x: 0,
      y: 0,
      rotation: 0 as const,
      value: "closed ejeeje",
      label: "S1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onAttachModelFile={vi.fn()} />);

    expect(screen.queryByRole("textbox", { name: "State" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Needs exact SWITCH|Generic starter/i);
  });
});

/**
 * The Properties panel against the reference standard it is measured by: a
 * collapsible, titled group per selected component; the part's FULL name as the
 * title; one row per parameter with the name left and the value right; the unit
 * inline with the value and engineering-prefixed; an unset label reading
 * "none"; and the row being edited carrying an accent bar.
 *
 * The two things this fixes that the reference does not do at all are that the
 * groups stay directly editable (no click-to-reveal) and that a multi-part
 * selection was previously an EMPTY panel - the store nulls `selectedId` unless
 * exactly one thing is selected, so two selected parts produced "No Selection"
 * while two parts sat highlighted on the canvas.
 */
describe("ComponentInspector - titled property groups", () => {
  const part = (
    kind: SchematicComponent["kind"],
    id: string,
    value: string,
    label: string,
  ): SchematicComponent => ({ id, kind, x: 0, y: 0, rotation: 0, value, label });

  const show = (...components: SchematicComponent[]) => {
    useSchematic.setState({
      components,
      selectedId: components.length === 1 ? components[0].id : null,
      selectedIds: components.map((component) => component.id),
    });
    return render(
      <ComponentInspector selected={components.length === 1 ? components[0] : components} />,
    );
  };

  const headers = () => screen.getAllByRole("button", { expanded: true });

  it("titles the group with the part's full name, never the internal kind", () => {
    show(part("pmos", "m-1", "PMOS W=3u L=200n", "M1"));

    expect(screen.getByRole("button", { name: /P-channel MOSFET/ })).toBeTruthy();
    // "pmos" and the palette's short "PMOS" are both implementation-facing.
    expect(document.body.textContent).not.toMatch(/\bpmos\b/);
  });

  it("collapses to a header that still says which part it is and what it is set to", () => {
    show(part("resistor", "r-1", "4700", "R1"));

    expect(screen.getByRole("textbox", { name: "Resistance" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resistor/ }));

    expect(screen.queryByRole("textbox", { name: "Resistance" })).toBeNull();
    // formatEngineering, the app's one number formatter - not a second one.
    expect(screen.getByRole("button", { name: /R1 · 4\.7 kΩ/ })).toBeTruthy();
  });

  it("renders one group per selected component instead of an empty panel", () => {
    show(
      part("pmos", "m-1", "PMOS W=3u L=200n", "M1"),
      part("potentiometer", "rv-1", "1k Wiper=0.5", "RV1"),
      part("vcvs", "e-1", "2", "E1"),
    );

    expect(screen.queryByText("No Selection")).toBeNull();
    expect(screen.getByText("3 components")).toBeTruthy();
    expect(headers().map((header) => header.textContent)).toEqual([
      expect.stringContaining("P-channel MOSFET"),
      expect.stringContaining("Potentiometer"),
      expect.stringContaining("Voltage-controlled voltage source"),
    ]);
  });

  it("edits the right component when several are selected", () => {
    show(
      part("resistor", "r-1", "1k", "R1"),
      part("resistor", "r-2", "2k", "R2"),
    );

    const [first, second] = screen.getAllByRole("textbox", { name: "Resistance" }) as HTMLInputElement[];
    expect(first.value).toBe("1");
    expect(second.value).toBe("2");

    fireEvent.change(second, { target: { value: "9" } });
    const stored = useSchematic.getState().components;
    expect(stored.find((component) => component.id === "r-1")?.value).toBe("1k");
    expect(stored.find((component) => component.id === "r-2")?.value).toBe("9k");
  });

  it("collapses one group without touching its neighbour", () => {
    show(
      part("resistor", "r-1", "1k", "R1"),
      part("resistor", "r-2", "2k", "R2"),
    );

    fireEvent.click(headers()[1]);
    expect(screen.getAllByRole("textbox", { name: "Resistance" }).length).toBe(1);
  });

  it("shows a normalised wiper as a percentage and takes a percentage back", () => {
    show(part("potentiometer", "rv-1", "1k Wiper=0.5", "RV1"));

    const wiper = screen.getByRole("textbox", { name: "Wiper position" }) as HTMLInputElement;
    expect(wiper.value).toBe("50");
    expect(screen.getByText("%")).toBeTruthy();
    // A percentage is not SI-prefixable, so it must NOT get a prefix picker.
    expect(screen.queryByRole("combobox", { name: "Wiper position SI prefix" })).toBeNull();

    fireEvent.change(wiper, { target: { value: "25" } });
    fireEvent.blur(wiper);
    expect(useSchematic.getState().components[0].value).toBe("1k Wiper=0.25");
  });

  it("puts an engineering unit inline with a value stored without one", () => {
    show(part("resistor", "r-1", "1000", "R1"));

    // 1000 Ω is what a datasheet calls 1 kΩ. The stored spelling is untouched
    // until the reader edits it.
    expect((screen.getByRole("textbox", { name: "Resistance" }) as HTMLInputElement).value).toBe("1");
    expect(screen.getByRole("combobox", { name: "Resistance SI prefix" }).textContent).toContain("kΩ");
    expect(useSchematic.getState().components[0].value).toBe("1000");
  });

  it("keeps the geometry units the reference prints", () => {
    show(part("pmos", "m-1", "PMOS W=3u L=200n", "M1"));

    expect((screen.getByRole("textbox", { name: "Width (W)" }) as HTMLInputElement).value).toBe("3");
    expect(screen.getByRole("combobox", { name: "Width (W) SI prefix" }).textContent).toContain("µm");
    expect((screen.getByRole("textbox", { name: "Length (L)" }) as HTMLInputElement).value).toBe("200");
    expect(screen.getByRole("combobox", { name: "Length (L) SI prefix" }).textContent).toContain("nm");
  });

  it("reads an unset component ID as none rather than as an empty box", () => {
    show(part("resistor", "r-1", "1k", ""));

    const componentId = screen.getByRole("textbox", { name: "Component ID" }) as HTMLInputElement;
    expect(componentId.value).toBe("");
    expect(componentId.getAttribute("placeholder")).toBe("none");
  });

  it("keeps a case-insensitive component-ID collision as an invalid local draft", () => {
    show(
      part("resistor", "r-1", "1k", "R1"),
      part("resistor", "r-2", "2k", "R2"),
    );

    const [, second] = screen.getAllByRole("textbox", { name: "Component ID" }) as HTMLInputElement[];
    fireEvent.change(second, { target: { value: "r1" } });
    fireEvent.blur(second);

    expect(second.value).toBe("r1");
    expect(second.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Reference “r1” is already used by R1");
    expect(useSchematic.getState().components.map((component) => component.label)).toEqual(["R1", "R2"]);
  });

  it("explains that relay voltage controls the contact while resistance only sets coil current", () => {
    show(part("relay", "k-1", "100", "K1"));
    expect(screen.getByText("Coil voltage controls the contact; resistance affects coil current only.")).toBeTruthy();
  });

  it("still serves a kind's fields instead of one raw Value box", () => {
    show(part("vcvs", "e-1", "2", "E1"));
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Voltage gain" }) as HTMLInputElement).value).toBe("2");
    expect(screen.getByRole("combobox", { name: "Voltage gain SI prefix" }).textContent).toContain("V/V");
  });

  it("presents generic op-amp gain and output rails in shared rows", () => {
    show(part("opamp", "u-1", "ideal", "U1"));

    expect(screen.getByRole("status").textContent)
      .toContain("Generic Tau op-amp · validated gain and output limits.");
    expect((screen.getByRole("textbox", { name: "Open-loop gain" }) as HTMLInputElement).value).toBe("1");
    expect(screen.getByRole("combobox", { name: "Open-loop gain SI prefix" }).textContent).toContain("MegV/V");
    expect((screen.getByRole("textbox", { name: "Minimum output" }) as HTMLInputElement).value).toBe("-15");
    expect((screen.getByRole("textbox", { name: "Maximum output" }) as HTMLInputElement).value).toBe("15");
    expect(screen.queryByRole("combobox", { name: "Simulation model" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach .lib/.sub file" })).toBeNull();

    const rows = [...document.querySelectorAll(".property-field")];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(row.querySelector(":scope > span:first-child")).toBeTruthy();
    }
  });

  it("shows a rail-order error without mutating an invalid generic op-amp draft", () => {
    show(part("opamp", "u-1", "ideal", "U1"));
    const minimum = screen.getByRole("textbox", { name: "Minimum output" }) as HTMLInputElement;

    fireEvent.change(minimum, { target: { value: "20" } });
    fireEvent.blur(minimum);

    expect(useSchematic.getState().components[0].value).toBe("ideal");
    expect(minimum.getAttribute("aria-invalid")).toBe("true");
    const describedBy = minimum.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent)
      .toContain("Minimum output must be below maximum output.");
  });

  it("does not expose generic op-amp knobs for an imported behavioral identity", () => {
    const imported = part("opamp", "u-imported", "Avol=1Meg GBW=10Gig", "U1");
    const selected = { ...imported, ltSymbolType: "Opamps\\UniversalOpamp2" };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    expect(screen.getByRole("status").textContent)
      .toContain("Imported behavioral op-amp · exact identity and provenance are read-only.");
    expect(screen.queryByRole("textbox", { name: "Open-loop gain" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Minimum output" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Maximum output" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Op-amp model" })).toBeNull();
  });
});

/**
 * The row treatment, asserted against App.css because jsdom computes no
 * layout and no cascade.
 *
 * This is the half of the redesign a render test cannot see: rows are quiet,
 * borderless text until one is being edited, and the row being edited is boxed
 * and carries a short accent bar on its leading edge. Lose that and the panel
 * silently reverts to a stack of form fields that all look equally active,
 * which is the exact failure the reference is a corrective for.
 */
describe("property row focus treatment (App.css contract)", () => {
  const css = readFileSync(join(__dirname, "..", "App.css"), "utf8");
  const ruleBody = (selector: string): string => {
    const start = css.indexOf(`\n${selector} {`);
    expect(start, `${selector} is missing from App.css`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  it("draws the accent bar on the leading edge, from the token", () => {
    const bar = ruleBody(".property-field::before");
    expect(bar).toMatch(/background:\s*var\(--accent\)/);
    expect(bar).toMatch(/left:\s*0/);
    expect(bar).toMatch(/width:\s*2px/);
    // Collapsed to nothing at rest: an always-on bar is decoration, not focus.
    expect(bar).toMatch(/height:\s*0/);
  });

  it("boxes only the row that has focus inside it", () => {
    expect(ruleBody(".property-field:focus-within")).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--border-subtle\)/);
    expect(ruleBody(".property-field:focus-within::before")).toMatch(/height:\s*\d+%/);
  });

  it("sets the value column against the right edge, the way a spec table does", () => {
    expect(ruleBody(".property-field")).toMatch(/justify-items:\s*end/);
    expect(ruleBody(".property-field > span:first-child")).toMatch(/justify-self:\s*start/);
    expect(ruleBody(".property-field .eng-input")).toMatch(/justify-self:\s*end/);
    expect(ruleBody(".property-field input")).toMatch(/text-align:\s*right/);
    // Prose opts out: an expression box scrolled to its tail is unreadable.
    expect(ruleBody(".property-field input.property-text")).toMatch(/text-align:\s*left/);
  });

  it("renders an unset value's placeholder as a muted whisper", () => {
    expect(ruleBody(".property-field input::placeholder")).toMatch(/color:\s*var\(--faint\)/);
  });

  it("wraps its motion for prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.property-field,/);
  });
});

/**
 * A part with no parameters should say nothing, not show an empty control.
 * The flip-flops rendered a `Value` row containing a blank text box: their
 * catalog default is "" and nothing ever writes to it, so the row was a
 * control that looked broken rather than a control that was empty.
 */
describe("ComponentInspector - parts with no parameters", () => {
  afterEach(() => cleanup());

  const showBare = (component: SchematicComponent) => {
    useSchematic.setState({
      components: [component],
      selectedId: component.id,
      selectedIds: [component.id],
    });
    render(<ComponentInspector selected={component} />);
  };

  it("omits the raw Value row for a flip-flop", () => {
    showBare({ id: "a1", kind: "dflop", x: 0, y: 0, rotation: 0, value: "", label: "A1" });
    expect(screen.getByRole("textbox", { name: "Component ID" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
    expect(screen.queryByText("Value")).toBeNull();
  });

  it("keeps the escape hatch for a schema-less part that does carry a value", () => {
    showBare({ id: "t1", kind: "transformer", x: 0, y: 0, rotation: 0, value: "1:1", label: "T1" });
    const raw = screen.queryByRole("textbox", { name: "Value" }) as HTMLInputElement | null;
    if (raw) expect(raw.value).toBe("1:1");
  });
});


/**
 * The Explorer's own New-file affordance seeds the name the reader is about to
 * accept, so the extension it seeds decides what kind of sheet a new document
 * is. `.asc` can be a sheet block but can never own one (LTspice's format has
 * nowhere to put the link or the port order), so seeding `.asc` handed every
 * new sheet a ceiling nobody asked for.
 */
describe("ExplorerPanel - a new sheet is a .sim", () => {
  afterEach(() => cleanup());

  const openExplorer = () => {
    useProject.setState({
      rootPath: "/project",
      rootName: "project",
      tree: [{ name: "root.sim", path: "/project/root.sim", kind: "file" }],
      expanded: ["/project"],
    });
    render(
      <ExplorerPanel
        activeFilePath={null}
        onOpenSimFile={() => {}}
        onOpenAscText={() => {}}
        onNotice={() => {}}
      />,
    );
  };

  it("seeds the header's New schematic file draft with untitled.sim", () => {
    openExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New schematic file" }));
    expect((screen.getByRole("textbox", { name: "New schematic name" }) as HTMLInputElement).value)
      .toBe("untitled.sim");
  });

  // The second seed lives on a folder's context menu, which needs a real Radix
  // context-menu open in jsdom to reach; the fact under test is only which
  // extension is seeded, so it is asserted against the source instead. This also
  // catches a third seed being added later with the old extension.
  it("leaves no .asc seed anywhere in the panel", () => {
    expect(readFileSync(join(__dirname, "ShellPanels.tsx"), "utf8")).not.toContain("untitled.asc");
  });
});
