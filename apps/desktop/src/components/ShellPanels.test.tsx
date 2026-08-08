// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BottomPanel, ComponentInspector, ComponentsRail, EditorToolbar } from "./ShellPanels";
import type { AnalysisResult } from "../simulation/linearTransient";
import { useSchematic } from "../store/useSchematic";
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
}

beforeEach(() => resetStore());

const noopToolbarProps = {
  isRunning: false,
  onRun: () => {},
  onStop: () => {},
  onClearScratchpad: () => {},
  modelLibraryCount: 0,
  onOpenModelLibraries: () => {},
  onOpenSimulationSetup: () => {},
};

describe("EditorToolbar - read-only outside schematic view ", () => {
  it("keeps transport explicit: Run and Stop only, with no opaque refine button", () => {
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    expect(screen.getByRole("button", { name: "Run simulation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop simulation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refine transient resolution" })).toBeNull();
  });

  it("exposes a horizontally scrollable tool strip so Run stays reachable at the 900px floor", () => {
    // jsdom does not compute layout overflow, but the class contract is what
    // App.css keys the overflow-x:auto rule on - prove the affordance is wired.
    const { container } = render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    const toolbar = container.querySelector(".editor-toolbar");
    expect(toolbar).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run simulation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop simulation" })).toBeTruthy();
  });

  it("disables Wire, Net label, Undo, Redo, selection deletion, and Clear schematic in simulator mode", () => {
    const emptyDoc = { components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [], textAnnotations: [], ascShapes: [], ascDataFlags: [], ascForeignSymbols: [], ascHierarchicalBlocks: [], ascSheet: null, userModelLibraries: [] };
    // Both past and future populated so canUndo/canRedo would be true if the
    // mode gate weren't there - proves the gate, not just an empty history.
    useSchematic.setState({ past: [emptyDoc], future: [emptyDoc] });
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);

    for (const name of ["Wire", "Net label (F4)", "Undo", "Redo", "Delete selection (Delete)", "Clear schematic"]) {
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

  it("enables Wire, Undo (with history), and Clear schematic in schematic mode", () => {
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

    const remove = screen.getByRole("button", { name: "Delete selection (Delete)" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    fireEvent.click(remove);
    expect(useSchematic.getState().components).toEqual([]);
  });

  it("keeps the selection action disabled when there is nothing to remove", () => {
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    expect((screen.getByRole("button", { name: "Delete selection (Delete)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders a Model libraries button and calls the callback on click", () => {
    const onOpenModelLibraries = vi.fn();
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} onOpenModelLibraries={onOpenModelLibraries} />);
    const button = screen.getByRole("button", { name: "Model libraries" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onOpenModelLibraries).toHaveBeenCalledTimes(1);
  });

  it("shows a count indicator only when libraries are attached", () => {
    const { rerender } = render(<EditorToolbar mode="schematic" {...noopToolbarProps} modelLibraryCount={0} />);
    expect(screen.queryByText("3")).toBeNull();
    rerender(<EditorToolbar mode="schematic" {...noopToolbarProps} modelLibraryCount={3} />);
    expect(screen.getByText("3")).toBeTruthy();
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
    render(<ComponentInspector selected={selected} />);

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
    render(<ComponentInspector selected={selected} onOpenModelLibraries={openLibraries} />);

    expect((screen.getByRole("textbox", { name: "Op-amp part" }) as HTMLInputElement).value).toBe("OP07");
    const model = screen.getByRole("textbox", { name: "Op-amp simulation model" }) as HTMLInputElement;
    expect(model.value).toBe("LT1001");
    expect(screen.getByRole("status").textContent).toMatch(/Needs a library model · Tau will not substitute a generic gain block/);
    fireEvent.click(screen.getByRole("button", { name: "Attach Model Library" }));
    expect(openLibraries).toHaveBeenCalledOnce();

    fireEvent.change(model, { target: { value: "MY_OP07" } });
    expect(useSchematic.getState().components[0]).toMatchObject({
      value: "OP07 MY_OP07",
      ltExtraAttrs: { extras: { Value2: "MY_OP07" } },
    });
  });
});

describe("ComponentInspector - semiconductor model chooser", () => {
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
    render(<ComponentInspector selected={selected} />);

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
    render(<ComponentInspector selected={selected} />);

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
    render(<ComponentInspector selected={selected} onOpenModelLibraries={openLibraries} />);

    const chooser = screen.getByRole("combobox", { name: "Simulation model" });
    expect(chooser.tagName).toBe("BUTTON");
    expect(chooser.getAttribute("data-slot")).toBe("select-trigger");
    expect(chooser.textContent).toContain("IRF540");
    expect(document.querySelector("select[aria-label='Simulation model']")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Needs a model ·.*won't substitute a generic NMOS/);
    fireEvent.click(screen.getByRole("button", { name: "Attach Model Library" }));
    expect(openLibraries).toHaveBeenCalledOnce();
  });
});

describe("ComponentInspector - native subcircuit chooser", () => {
  it("places the bundled Class-D driver with exact terminals and bounded named knobs", async () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useSchematic.setState({ components: [selected] });
    const { rerender } = render(<ComponentInspector selected={selected} />);
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
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);

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

    const { rerender } = render(<ComponentInspector selected={selected} />);
    const chooser = screen.getByRole("combobox", { name: "Subcircuit model" });
    expect(chooser.tagName).toBe("BUTTON");
    expect(chooser.getAttribute("data-slot")).toBe("select-trigger");
    expect(chooser.textContent).toContain("deadtime");
    expect(document.querySelector("select[aria-label='Subcircuit model']")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("5 named terminals (vcc, vee, pwm, gp, gn)");
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();

    const dead = screen.getByRole("textbox", { name: "Subcircuit parameter dead" }) as HTMLInputElement;
    expect(dead.value).toBe("300n");
    fireEvent.change(dead, { target: { value: "400n" } });
    expect(useSchematic.getState().components[0].value).toBe("deadtime dead=400n");

    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);
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

  it("blocks an unresolved model and routes the user to Model Libraries", () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "vendor_driver", label: "X1",
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected] });
    render(<ComponentInspector selected={selected} onOpenModelLibraries={openLibraries} />);

    const chooser = screen.getByRole("combobox", { name: "Subcircuit model" });
    expect(chooser.tagName).toBe("BUTTON");
    expect(chooser.getAttribute("data-slot")).toBe("select-trigger");
    expect(chooser.textContent).toContain("vendor_driver");
    expect(document.querySelector("select[aria-label='Subcircuit model']")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Run won't invent pins");
    fireEvent.click(screen.getByRole("button", { name: "Attach Model Library" }));
    expect(openLibraries).toHaveBeenCalledOnce();
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
    expect(screen.getByText("Characteristic impedance of the ideal lossless line.")).toBeTruthy();

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

    expect(screen.getByText(/Output voltage is the transresistance times the current sensed at the control pins C\+ and C-/))
      .toBeTruthy();
    expect(screen.getByText(/1k gives 1 V per mA/)).toBeTruthy();

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
      expect(screen.getByText(/cannot watch an existing source such as V1/)).toBeTruthy();
      expect(screen.getByText(/Wire C\+ and C- in series with the branch whose current you want/)).toBeTruthy();
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
    kind: "diode" | "led" | "zener",
    value: string,
    extra: Record<string, unknown> = {},
  ) => ({ id: `${kind}-1`, kind, x: 160, y: 160, rotation: 0 as const, value, label: "D1", ...extra });

  const show = (component: ReturnType<typeof junction>, directives: string[] = []) => {
    useSchematic.setState({
      components: [component],
      selectedId: component.id,
      selectedIds: [component.id],
      directives,
    });
    render(<ComponentInspector selected={component} />);
  };

  it("says a placed diode is ideal, in the volts it will actually drop", () => {
    show(junction("diode", "D"));
    expect(screen.getByRole("status").textContent)
      .toContain("Ideal model · a fixed 0.7 V forward drop, no junction capacitance and no reverse recovery.");
  });

  it("states the LED's own drop and the zener's marked breakdown", () => {
    show(junction("led", "LED"));
    expect(screen.getByRole("status").textContent).toContain("a fixed 2 V forward drop");

    cleanup();
    show(junction("zener", "5V1"));
    expect(screen.getByRole("status").textContent)
      .toContain("a fixed 0.7 V forward drop, 5.1 V reverse breakdown");

    // A marking that names no library part is still a part the deck runs, so
    // it must not be reported as a missing model.
    cleanup();
    show(junction("zener", "12V"));
    expect(screen.getByRole("status").textContent).toContain("12 V reverse breakdown");
    expect(screen.getByRole("status").textContent).not.toContain("Needs a model");
  });

  it("keeps the model chooser behind Advanced while the part is ideal", async () => {
    show(junction("diode", "D"));
    expect(screen.queryByRole("combobox", { name: "Simulation model" })).toBeNull();

    const disclosure = screen.getByRole("button", { name: "Toggle advanced settings" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/replaces the ideal device with its measured curve/)).toBeTruthy();

    const chooser = screen.getByRole("combobox", { name: "Simulation model" });
    fireEvent.pointerDown(chooser, { button: 0, pointerId: 1, pointerType: "mouse" });
    const part = await screen.findByRole("option", { name: /1N4148 · Tau exact models/ });
    fireEvent.pointerUp(part, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(part);
    expect(useSchematic.getState().components[0].value).toBe("1N4148");
  });

  it("never calls an imported diode ideal, and leaves its real model in plain sight", () => {
    // The exact provenance test `engine/idealModels.ts` uses: one LTspice-only
    // field present means this part was read from an `.asc`.
    show(junction("diode", "D", { ltSymbolType: "diode" }));

    const status = screen.getByRole("status").textContent ?? "";
    expect(status).not.toContain("Ideal model");
    expect(status).toContain("This part came from an LTspice schematic, so it keeps that real model");
    expect(screen.getByRole("combobox", { name: "Simulation model" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Toggle advanced settings" })).toBeNull();
  });

  it("defers to a model this schematic defines rather than claiming ideal", () => {
    show(junction("diode", "D"), [".model D D(Is=1e-15 N=1.2)"]);

    const status = screen.getByRole("status").textContent ?? "";
    expect(status).not.toContain("Ideal model");
    expect(status).toContain("Defined by this schematic");
    expect(screen.getByRole("combobox", { name: "Simulation model" })).toBeTruthy();
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
    expect((screen.getByRole("textbox", { name: "DC operating point" }) as HTMLInputElement).value).toBe("0");
    expect((screen.getByRole("textbox", { name: "PWL time 3" }) as HTMLInputElement).value).toBe("+1");
    const pwlPrefix = screen.getByRole("combobox", { name: "PWL time 3 SI prefix" });
    expect(pwlPrefix.tagName).toBe("BUTTON");
    expect(pwlPrefix.getAttribute("data-slot")).toBe("select-trigger");
    expect(pwlPrefix.textContent).toContain("µs");
    expect((screen.getByRole("textbox", { name: "PWL level 3" }) as HTMLInputElement).value).toBe("1");
    expect((screen.getByRole("textbox", { name: "AC amplitude (.ac)" }) as HTMLInputElement).value).toBe("2");
    expect(screen.queryByRole("textbox", { name: "DC level" })).toBeNull();
    expect(screen.queryByDisplayValue(/PWL\(/)).toBeNull();
  });

  it("updates PWL rows and DC bias through controls", () => {
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
    const { rerender } = render(<ComponentInspector selected={selected} />);

    fireEvent.change(screen.getByRole("textbox", { name: "PWL level 2" }), { target: { value: "5" } });
    expect(useSchematic.getState().components[0].value).toBe("PWL(0 0 2u 5)");

    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);

    fireEvent.change(screen.getByRole("textbox", { name: "DC operating point" }), { target: { value: "2" } });
    expect(useSchematic.getState().components[0].value).toBe("DC 2 PWL(0 0 2u 5)");
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

  it("delegates its width boundary to the shared dock when embedded", () => {
    render(<Harness maxWidth={340} embedded />);
    expect(screen.getByRole("complementary", { name: "Components" }).classList.contains("components-rail--embedded")).toBe(true);
    expect(screen.queryByRole("separator", { name: "Resize properties panel" })).toBeNull();
  });

  it("opens Library by default and returns there whenever the active sheet becomes empty", () => {
    render(<Harness maxWidth={340} embedded />);
    expect(screen.getByRole("tab", { name: "Library" }).getAttribute("aria-selected")).toBe("true");

    act(() => useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      selectedId: "r-1",
      selectedIds: ["r-1"],
    }));
    expect(screen.getByRole("tab", { name: "Properties" }).getAttribute("aria-selected")).toBe("true");

    act(() => useSchematic.setState({ components: [], selectedId: null, selectedIds: [] }));
    expect(screen.getByRole("tab", { name: "Library" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByPlaceholderText("Filter")).toBeTruthy();
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
    expect(screen.getByRole("alert").textContent).toBe("timestep too small");
  });

  it("goes loud with an error token and a count when the run fails", () => {
    const { container } = render(<BottomPanel result={failed} />);
    expect(container.querySelector(".bottom-panel.has-error")).toBeTruthy();
    // message + warning = 2, in the alarm-red (not warnings-only) badge
    const count = container.querySelector(".bottom-panel-count")!;
    expect(count.textContent).toBe("2");
    expect(count.classList.contains("warnings-only")).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("singular matrix at t=0");
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
